import assert from "node:assert/strict";
import Module from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

console.log("unit-only: telemetry read-model tests use source/shape checks and do not mock Postgres integration behavior");

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

const dbPath = join(process.cwd(), "src", "server", "db.ts");
const telemetryPath = join(process.cwd(), "src", "server", "telemetry.ts");
assert.ok(existsSync(dbPath), "src/server/db.ts must exist");
assert.ok(existsSync(telemetryPath), "src/server/telemetry.ts must exist");

const dbSource = readFileSync(dbPath, "utf8");
assert.match(dbSource, /import\s+["']server-only["'];/, "db module must be server-only");
assert.match(dbSource, /from\s+["']pg["']/, "db module must use the maintained pg client");
assert.doesNotMatch(dbSource, /NEXT_PUBLIC_AUTOSPEC_TELEMETRY_DATABASE_URL/, "db URL must not be exposed as a public env var");
assert.match(dbSource, /BEGIN\s+READ\s+ONLY/i, "db reads must run in a read-only transaction");
assert.match(dbSource, /assertReadOnlySql/, "db module must export a lightweight read-only SQL guard");

class FakePool {}
const db = loadTsModule(dbPath, { pg: { Pool: FakePool }, './config': { getAutospecServerConfig: () => ({ telemetryDatabaseUrl: 'postgres://unit:redacted@localhost/db', telemetrySchema: 'public', readOnly: true }) } });
assert.equal(typeof db.assertReadOnlySql, "function", "assertReadOnlySql must be exported for unit testing");
assert.equal(typeof db.withReadOnlyTelemetryClient, "function", "withReadOnlyTelemetryClient must be exported");

for (const sql of [
  "select * from runs",
  "WITH recent AS (SELECT 1) SELECT * FROM recent",
  "show search_path"
]) {
  assert.equal(db.assertReadOnlySql(sql), sql, `${sql} should be accepted as read-only`);
}

for (const sql of [
  "insert into runs default values",
  "update runs set status = 'done'",
  "delete from runs",
  "drop table runs",
  "select * from runs; update runs set status='done'"
]) {
  assert.throws(() => db.assertReadOnlySql(sql), /read-only/i, `${sql} should be rejected`);
}

const telemetrySource = readFileSync(telemetryPath, "utf8");
assert.match(telemetrySource, /import\s+["']server-only["'];/, "telemetry module must be server-only");
for (const name of [
  "TelemetryOverview",
  "RunStatusCount",
  "RecentRun",
  "IssueThroughput",
  "PullRequestHealth",
  "AgentActivity",
  "ErrorSummary",
  "RunDetail",
  "RunPhase",
  "ValidationEvidence",
  "RunRelatedError"
]) {
  assert.match(telemetrySource, new RegExp(`export\\s+type\\s+${name}\\b`), `${name} read model type must be exported`);
}
for (const fn of ["discoverTelemetrySchema", "getTelemetryOverview", "listRecentRuns", "getRunDetail"]) {
  assert.match(telemetrySource, new RegExp(`export\\s+async\\s+function\\s+${fn}\\b`), `${fn} must be exported`);
}
assert.match(telemetrySource, /information_schema\.columns/, "telemetry adapter must discover table columns before querying raw telemetry tables");
assert.doesNotMatch(telemetrySource, /\b(insert|update|delete|drop|alter|create)\b/i, "telemetry read model must not contain write SQL verbs");
