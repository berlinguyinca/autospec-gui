import assert from "node:assert/strict";
import Module from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const configPath = join(process.cwd(), "src", "server", "config.ts");
assert.ok(existsSync(configPath), "src/server/config.ts must exist");

const source = readFileSync(configPath, "utf8");
assert.match(source, /import\s+["']server-only["'];/, "server config must be marked server-only");
assert.doesNotMatch(source, /NEXT_PUBLIC_AUTOSPEC_TELEMETRY_DATABASE_URL/, "database URL must not be exposed through public env names");

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
    strict: true
  },
  fileName: configPath
}).outputText;

const mod = new Module(configPath);
mod.filename = configPath;
mod.paths = Module._nodeModulePaths(process.cwd());
const originalRequire = mod.require.bind(mod);
mod.require = (specifier) => (specifier === "server-only" ? {} : originalRequire(specifier));
mod._compile(compiled, configPath);

const { getAutospecServerConfig, parseAutospecServerConfig } = mod.exports;
assert.equal(typeof parseAutospecServerConfig, "function", "parseAutospecServerConfig must be exported for unit testing");
assert.equal(typeof getAutospecServerConfig, "function", "getAutospecServerConfig must be exported for app server modules");

const validUrl = "postgres://autospec:secret@localhost:5432/autospec";
assert.deepEqual(parseAutospecServerConfig({ AUTOSPEC_TELEMETRY_DATABASE_URL: validUrl }), {
  telemetryDatabaseUrl: validUrl,
  telemetrySchema: "public",
  readOnly: true
});

assert.equal(
  parseAutospecServerConfig({
    AUTOSPEC_TELEMETRY_DATABASE_URL: "postgresql://autospec:secret@localhost/autospec",
    AUTOSPEC_TELEMETRY_SCHEMA: "telemetry",
    AUTOSPEC_GUI_READ_ONLY: "1"
  }).telemetrySchema,
  "telemetry",
  "explicit telemetry schema should be preserved"
);

assert.throws(
  () => parseAutospecServerConfig({}),
  (error) => error instanceof Error && /AUTOSPEC_TELEMETRY_DATABASE_URL/.test(error.message) && !/postgres:\/\//i.test(error.message),
  "missing database URL must fail without printing a connection string"
);

assert.throws(
  () => parseAutospecServerConfig({ AUTOSPEC_TELEMETRY_DATABASE_URL: "https://example.test/db" }),
  /AUTOSPEC_TELEMETRY_DATABASE_URL must use postgres or postgresql protocol/,
  "non-Postgres URLs must be rejected"
);

for (const value of ["0", "false", "", "write", "2"]) {
  assert.throws(
    () => parseAutospecServerConfig({ AUTOSPEC_TELEMETRY_DATABASE_URL: validUrl, AUTOSPEC_GUI_READ_ONLY: value }),
    /AUTOSPEC_GUI_READ_ONLY must be 1/,
    `read-only guard should fail closed for ${JSON.stringify(value)}`
  );
}

assert.throws(
  () => parseAutospecServerConfig({ AUTOSPEC_TELEMETRY_DATABASE_URL: validUrl, AUTOSPEC_TELEMETRY_SCHEMA: "bad-schema" }),
  /AUTOSPEC_TELEMETRY_SCHEMA/,
  "schema names should be narrow SQL identifiers"
);
