import assert from "node:assert/strict";
import Module from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

console.log("unit-only: autonomous status tests use source/shape/render checks and do not mock Postgres integration behavior");

function loadTsModule(path, extraRequire = {}) {
  const source = readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
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
const telemetrySource = readFileSync(telemetryPath, "utf8");
assert.match(telemetrySource, /export\s+type\s+AutonomousRunStatus\b/, "AutonomousRunStatus read model type must be exported");
assert.match(telemetrySource, /export\s+function\s+shapeAutonomousRunStatus\b/, "shapeAutonomousRunStatus helper must be exported for unit tests");
assert.match(telemetrySource, /export\s+async\s+function\s+getLatestAutonomousRunStatus\b/, "getLatestAutonomousRunStatus must be exported");

const telemetry = loadTsModule(telemetryPath, {
  "./config": { getAutospecServerConfig: () => ({ telemetryDatabaseUrl: "postgres://unit:redacted@localhost/db", telemetrySchema: "public", readOnly: true }) },
  "./db": { quoteIdentifier: (identifier) => `"${identifier}"`, withReadOnlyTelemetryClient: async (callback) => callback({ query: async () => ({ rows: [] }) }) }
});

const now = new Date("2026-07-11T12:10:00Z");
const fullStatus = telemetry.shapeAutonomousRunStatus({
  id: "run-26",
  repository: "berlinguyinca/autospec-gui",
  branch: "feat/issue-26-autonomous-run-status-panel",
  status: "running",
  heartbeatAt: "2026-07-11T12:05:00Z",
  phase: "implement",
  cycle: "4",
  issueNumber: "26",
  observedAt: "2026-07-11T12:00:00Z"
}, now);
assert.deepEqual(fullStatus, {
  id: "run-26",
  repository: "berlinguyinca/autospec-gui",
  branch: "feat/issue-26-autonomous-run-status-panel",
  status: "running",
  heartbeatAt: new Date("2026-07-11T12:05:00Z"),
  heartbeatAgeSeconds: 300,
  phase: "implement",
  cycle: "4",
  issueNumber: 26,
  observedAt: new Date("2026-07-11T12:00:00Z")
});

const sparseStatus = telemetry.shapeAutonomousRunStatus({ id: null, status: null, heartbeatAt: null, phase: null, cycle: null, issueNumber: null, branch: null, repository: null, observedAt: null }, now);
assert.equal(sparseStatus.status, "unknown", "missing status must degrade to unknown");
assert.equal(sparseStatus.heartbeatAgeSeconds, null, "missing heartbeat must not crash or fabricate an age");
assert.equal(sparseStatus.phase, null, "missing phase must stay unavailable");
assert.equal(telemetry.shapeAutonomousRunStatus(null, now), null, "no telemetry row should become an unavailable panel state");

const pagePath = join(process.cwd(), "app", "page.tsx");
assert.ok(existsSync(pagePath), "app/page.tsx must exist");

async function renderHomeWithTelemetry({ overview, configErrorMessage }) {
  let source = readFileSync(pagePath, "utf8")
    .replace(/^import\s+TelemetryExplorer[^;]+;\s*$/m, "")
    .replace(/<TelemetryExplorer\s+events=\{telemetryEvents\}\s+\/>/, "<section>Interactive telemetry filters placeholder</section>");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    },
    fileName: pagePath
  }).outputText;

  const tempDir = join(process.cwd(), ".tmp-test-autonomous-status");
  mkdirSync(tempDir, { recursive: true });
  const modulePath = join(tempDir, `page-${Math.random().toString(16).slice(2)}.cjs`);
  writeFileSync(modulePath, compiled);

  class AutospecConfigError extends Error {}
  const pageModule = loadTsModule(modulePath, {
    "../src/server/config": { AutospecConfigError },
    "../src/server/telemetry": {
      getTelemetryOverview: async () => {
        if (configErrorMessage) throw new AutospecConfigError(configErrorMessage);
        return overview;
      }
    }
  });
  const element = await pageModule.default();
  return renderToStaticMarkup(element);
}

const overview = {
  window: { hours: 24, from: new Date("2026-07-10T12:00:00Z"), to: now },
  runStatusCounts: [],
  recentRuns: [],
  issueThroughput: { created: 0, classified: 0, implemented: 0, merged: 0, failed: 0, paused: 0 },
  pullRequestHealth: { open: 0, merged: 0, failedChecks: 0, pendingChecks: 0, advisoryChecks: 0 },
  agentActivity: [],
  errorSummary: [],
  autonomousRunStatus: fullStatus
};

const readyHtml = await renderHomeWithTelemetry({ overview });
assert.match(readyHtml, /Autonomous run status/, "overview must render the autonomous status panel");
assert.match(readyHtml, /running/, "panel must show latest run status from telemetry");
assert.match(readyHtml, /Heartbeat\s*5m ago/, "panel must show heartbeat age when present");
assert.match(readyHtml, /Phase\s*implement/, "panel must show phase when present");
assert.match(readyHtml, /Issue\s*#26/, "panel must show active issue when present");
assert.match(readyHtml, /feat\/issue-26-autonomous-run-status-panel/, "panel must show active branch when present");

const sparseHtml = await renderHomeWithTelemetry({ overview: { ...overview, autonomousRunStatus: sparseStatus } });
assert.match(sparseHtml, /Status\s*unknown/, "missing status should render as unknown");
assert.match(sparseHtml, /Heartbeat\s*Unavailable/, "missing heartbeat should render an unavailable state");
assert.match(sparseHtml, /Phase\s*Unavailable/, "missing phase should render an unavailable state");

const missingConfigHtml = await renderHomeWithTelemetry({ overview, configErrorMessage: "AUTOSPEC_TELEMETRY_DATABASE_URL is required" });
assert.match(missingConfigHtml, /Telemetry status unavailable/, "missing configuration should render non-fatal status panel state");
assert.match(missingConfigHtml, /AUTOSPEC_TELEMETRY_DATABASE_URL is required/, "missing configuration message should be visible without crashing");
