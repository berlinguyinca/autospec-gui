import assert from "node:assert/strict";
import Module from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

console.log("unit-only: discovery audit read-model tests use fake query rows and do not mock Postgres integration behavior");

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

const telemetryPath = join(process.cwd(), "src", "server", "telemetry.ts");
assert.ok(existsSync(telemetryPath), "src/server/telemetry.ts must exist");

const telemetrySource = readFileSync(telemetryPath, "utf8");
assert.match(telemetrySource, /export\s+type\s+DiscoveryAuditCycle\b/, "DiscoveryAuditCycle read model type must be exported");
assert.match(telemetrySource, /export\s+async\s+function\s+listDiscoveryAuditCycles\b/, "listDiscoveryAuditCycles must be exported for the route");
assert.match(telemetrySource, /export\s+function\s+formatDiscoveryAuditCount\b/, "formatDiscoveryAuditCount helper must be exported for unit checks");
assert.match(telemetrySource, /export\s+function\s+formatDiscoveryAuditField\b/, "formatDiscoveryAuditField helper must be exported for optional-field checks");
assert.match(telemetrySource, /discovery_cycles|discovery_audit|discovery_candidates/, "read model must look for discovery telemetry tables");
assert.doesNotMatch(telemetrySource, /\b(insert|update|delete|drop|alter|create)\b/i, "discovery audit read model must not contain write SQL verbs");

const telemetry = loadTsModule(telemetryPath, {
  './config': { getAutospecServerConfig: () => ({ telemetryDatabaseUrl: 'postgres://unit:redacted@localhost/db', telemetrySchema: 'public', readOnly: true }) },
  './db': {
    quoteIdentifier: (identifier) => `"${String(identifier).replaceAll('"', '""')}"`,
    withReadOnlyTelemetryClient: async (callback) => callback({ query: async () => ({ rows: [] }) })
  }
});

assert.equal(telemetry.formatDiscoveryAuditCount(7), "7", "numeric counts should render as numbers");
assert.equal(telemetry.formatDiscoveryAuditCount(null), "Unavailable", "missing counts should render as unavailable");
assert.equal(telemetry.formatDiscoveryAuditField(""), "Unavailable", "blank optional fields should render as unavailable");
assert.equal(telemetry.formatDiscoveryAuditField("dry_run_safety_gate"), "dry run safety gate", "snake case values should be humanized");

const discovered = {
  schemaName: "public",
  tables: {
    discovery_cycles: [
      "id",
      "source_type",
      "candidate_count",
      "filed_count",
      "dry_reason",
      "safety_result",
      "created_issue_numbers",
      "created_at"
    ]
  }
};
const queries = [];
const client = {
  async query(sql, params) {
    queries.push({ sql, params });
    return {
      rows: [
        {
          id: "cycle-dry-1",
          sourceType: "quality_audit",
          candidateCount: "4",
          filedCount: "0",
          dryReason: "dry_run_safety_gate",
          safetyResult: "blocked_by_scope",
          createdIssues: "[]",
          observedAt: "2026-07-11T10:00:00Z"
        },
        {
          id: "cycle-filed-2",
          sourceType: "github_search",
          candidateCount: "2",
          filedCount: "2",
          dryReason: null,
          safetyResult: "passed",
          createdIssues: "[27,28]",
          observedAt: "2026-07-11T09:00:00Z"
        }
      ]
    };
  }
};

const cycles = await telemetry.listDiscoveryAuditCycles(client, discovered, { hours: 24, from: new Date("2026-07-10T12:00:00Z"), to: new Date("2026-07-11T12:00:00Z") });
assert.equal(cycles.length, 2, "rows returned by telemetry should be shaped into cycles");
assert.deepEqual(cycles[0], {
  id: "cycle-dry-1",
  sourceType: "quality_audit",
  candidateCount: 4,
  filedCount: 0,
  dryReason: "dry_run_safety_gate",
  safetyResult: "blocked_by_scope",
  createdIssueNumbers: [],
  observedAt: new Date("2026-07-11T10:00:00Z")
});
assert.deepEqual(cycles[1].createdIssueNumbers, [27, 28], "JSON issue number arrays should become numeric links");
assert.equal(queries.length, 1, "listDiscoveryAuditCycles should issue one read query");
assert.match(queries[0].sql, /select/i, "query must be read-only");
assert.match(queries[0].sql, /limit \$2/i, "query must use a parameterized limit");
assert.deepEqual(queries[0].params, ["2026-07-10T12:00:00.000Z", 25], "query must use window and limit parameters");

const sparseCycles = await telemetry.listDiscoveryAuditCycles({
  async query() {
    return { rows: [{ id: null, sourceType: null, candidateCount: null, filedCount: null, dryReason: null, safetyResult: null, createdIssues: null, observedAt: null }] };
  }
}, { schemaName: "public", tables: { discovery_audit: ["id"] } }, { hours: 24, from: new Date("2026-07-10T12:00:00Z"), to: new Date("2026-07-11T12:00:00Z") });
assert.deepEqual(sparseCycles[0], {
  id: "unknown",
  sourceType: null,
  candidateCount: null,
  filedCount: null,
  dryReason: null,
  safetyResult: null,
  createdIssueNumbers: [],
  observedAt: null
}, "schemas missing optional discovery fields must still shape an unavailable row");

const noTable = await telemetry.listDiscoveryAuditCycles({ query: async () => { throw new Error("should not query without discovery table"); } }, { schemaName: "public", tables: {} });
assert.deepEqual(noTable, [], "missing discovery telemetry table should be an empty audit list");
