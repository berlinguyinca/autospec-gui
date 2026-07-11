import assert from "node:assert/strict";
import Module from "node:module";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import ts from "typescript";

const testDatabaseUrl = process.env.AUTOSPEC_TEST_DATABASE_URL?.trim();
if (!testDatabaseUrl) {
  console.log("skip: set AUTOSPEC_TEST_DATABASE_URL to run real Postgres fixture integration tests");
  process.exit(0);
}

const telemetryDatabaseUrl = process.env.AUTOSPEC_TELEMETRY_DATABASE_URL?.trim();
assert.notEqual(
  testDatabaseUrl,
  telemetryDatabaseUrl,
  "AUTOSPEC_TEST_DATABASE_URL must be separate from AUTOSPEC_TELEMETRY_DATABASE_URL for fixture writes"
);

const schemaName = `autospec_gui_fixture_${randomUUID().replaceAll("-", "_")}`;
const setupPool = new Pool({
  application_name: "autospec-gui-fixture-setup",
  connectionString: testDatabaseUrl,
  max: 1
});

const expectedReadOnlyStatement = "BEGIN READ ONLY";

try {
  await setupFixtureSchema(setupPool, schemaName);
  await runReadOnlyDataLayerAssertions({
    telemetryDatabaseUrl: testDatabaseUrl,
    telemetrySchema: schemaName,
    readOnly: true
  });
  console.log(`real Postgres fixture integration passed for schema ${schemaName}`);
} finally {
  await dropFixtureSchema(setupPool, schemaName);
  await setupPool.end();
}

async function setupFixtureSchema(pool, schema) {
  const client = await pool.connect();
  try {
    await client.query(`create schema ${quoteIdentifier(schema)}`);
    await client.query(`
      create table ${quoteIdentifier(schema)}.autospec_runs (
        id text primary key,
        repository text not null,
        branch text not null,
        status text not null,
        started_at timestamptz not null,
        ended_at timestamptz
      )
    `);
    await client.query(
      `insert into ${quoteIdentifier(schema)}.autospec_runs (id, repository, branch, status, started_at, ended_at)
       values ($1, $2, $3, $4, now() - interval '10 minutes', now() - interval '5 minutes'),
              ($5, $6, $7, $8, now() - interval '2 minutes', null)`,
      ["run-1", "berlinguyinca/autospec-gui", "main", "merged", "run-2", "berlinguyinca/autospec-gui", "feat/example", "open"]
    );
  } finally {
    client.release();
  }
}

async function dropFixtureSchema(pool, schema) {
  await pool.query(`drop schema if exists ${quoteIdentifier(schema)} cascade`);
}

async function runReadOnlyDataLayerAssertions(config) {
  const configModule = loadTsModule(join(process.cwd(), "src", "server", "config.ts"));
  const dbModule = loadTsModule(join(process.cwd(), "src", "server", "db.ts"), {
    "./config": { ...configModule, getAutospecServerConfig: () => config }
  });
  const telemetryModule = loadTsModule(join(process.cwd(), "src", "server", "telemetry.ts"), {
    "./config": { ...configModule, getAutospecServerConfig: () => config },
    "./db": dbModule
  });

  assert.equal(typeof dbModule.withReadOnlyTelemetryClient, "function", "withReadOnlyTelemetryClient must be callable");
  assert.equal(typeof telemetryModule.discoverTelemetrySchema, "function", "discoverTelemetrySchema must be callable");
  assert.equal(typeof telemetryModule.listRecentRuns, "function", "listRecentRuns must be callable");

  await dbModule.withReadOnlyTelemetryClient(async (client) => {
    const tx = await client.query("show transaction_read_only");
    assert.equal(tx.rows[0].transaction_read_only, "on", `${expectedReadOnlyStatement} must open a read-only transaction`);

    const searchPath = await client.query("show search_path");
    assert.match(searchPath.rows[0].search_path, new RegExp(`"?${config.telemetrySchema}"?`), "fixture schema must be first in search_path");

    const discovered = await telemetryModule.discoverTelemetrySchema(client, config.telemetrySchema);
    assert.deepEqual(
      discovered.tables.autospec_runs,
      ["id", "repository", "branch", "status", "started_at", "ended_at"],
      "schema discovery must read fixture columns from real Postgres"
    );

    const recentRuns = await telemetryModule.listRecentRuns(client, discovered, {
      hours: 1,
      from: new Date(Date.now() - 60 * 60 * 1000),
      to: new Date()
    });
    assert.deepEqual(
      recentRuns.map((run) => [run.id, run.repository, run.branch, run.status]),
      [
        ["run-2", "berlinguyinca/autospec-gui", "feat/example", "open"],
        ["run-1", "berlinguyinca/autospec-gui", "main", "merged"]
      ],
      "read model must return real fixture rows through the Postgres adapter"
    );

    assert.throws(
      () => client.query("insert into autospec_runs (id, repository, branch, status, started_at) values ('bad', 'repo', 'branch', 'open', now())"),
      /read-only/i,
      "guarded integration client must reject fixture writes"
    );
  }, config);
}

function loadTsModule(path, extraRequire = {}) {
  const source = readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: true
    },
    fileName: path
  }).outputText;

  const mod = new Module(path);
  mod.filename = path;
  mod.paths = Module._nodeModulePaths(process.cwd());
  const originalRequire = mod.require.bind(mod);
  mod.require = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier in extraRequire) return extraRequire[specifier];
    return originalRequire(specifier);
  };
  mod._compile(compiled, path);
  return mod.exports;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}
