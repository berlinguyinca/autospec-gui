import assert from "node:assert/strict";
import Module from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

console.log("unit-only: runs page tests mock server module results, not Postgres integration behavior");

const runsPagePath = join(process.cwd(), "app", "runs", "page.tsx");
assert.ok(existsSync(runsPagePath), "app/runs/page.tsx must exist");

const runsPageSource = readFileSync(runsPagePath, "utf8");
assert.doesNotMatch(runsPageSource, /^"use client";|^'use client';/m, "runs page must remain a server component");
assert.match(runsPageSource, /src\/server\/telemetry/, "runs page must fetch via the server-only telemetry read model");
assert.match(runsPageSource, /src\/server\/config/, "runs page must handle server-only config errors without client exposure");
assert.doesNotMatch(runsPageSource, /DATABASE_URL|postgres:\/\//i, "runs page source must not expose connection strings or secrets");
assert.doesNotMatch(runsPageSource, /<button\b|<form\b|method=["']post["']|\b(insert|update|delete|drop|alter|create)\b/i, "runs page must stay read-only");
assert.match(runsPageSource, /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/, "runs page must be rendered dynamically so configured telemetry is read at request time");

class MockAutospecConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "AutospecConfigError";
  }
}

function loadRunsPage({ overview, error }) {
  const compiled = ts.transpileModule(runsPageSource, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: true
    },
    fileName: runsPagePath
  }).outputText;

  const mod = new Module(runsPagePath);
  mod.filename = runsPagePath;
  mod.paths = Module._nodeModulePaths(process.cwd());
  const originalRequire = mod.require.bind(mod);
  mod.require = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier === "../../src/server/config") {
      return { AutospecConfigError: MockAutospecConfigError };
    }
    if (specifier === "../../src/server/telemetry") {
      return {
        getTelemetryOverview: async () => {
          if (error) throw error;
          return overview;
        }
      };
    }
    return originalRequire(specifier);
  };
  mod._compile(compiled, runsPagePath);
  return mod.exports;
}

async function renderRunsPage(options) {
  const pageModule = loadRunsPage(options);
  assert.equal(typeof pageModule.default, "function", "runs page must default-export a component");
  const tree = await pageModule.default();
  return renderToStaticMarkup(tree);
}

const baseOverview = {
  window: {
    hours: 24,
    from: new Date("2026-07-10T12:00:00Z"),
    to: new Date("2026-07-11T12:00:00Z")
  },
  runStatusCounts: [],
  recentRuns: [],
  issueThroughput: { created: 0, classified: 0, implemented: 0, merged: 0, failed: 0, paused: 0 },
  pullRequestHealth: { open: 0, merged: 0, failedChecks: 0, pendingChecks: 0, advisoryChecks: 0 },
  agentActivity: [],
  errorSummary: []
};

const missingConfigHtml = await renderRunsPage({
  error: new MockAutospecConfigError("AUTOSPEC_TELEMETRY_DATABASE_URL is required")
});
assert.match(missingConfigHtml, /Telemetry configuration needed/i, "missing telemetry env must render a clear non-fatal config state");
assert.match(missingConfigHtml, /AUTOSPEC_TELEMETRY_DATABASE_URL/i, "missing config state must name the required variable");
assert.match(missingConfigHtml, /read-only/i, "missing config state must preserve the read-only boundary");
assert.doesNotMatch(missingConfigHtml, /Representative recent runs|run-1|run-2|postgres:\/\//i, "missing config state must not render static fallback rows or secrets");

const emptyHtml = await renderRunsPage({ overview: baseOverview });
assert.match(emptyHtml, /No runs found/i, "configured schema with no run rows must render a useful empty state");
assert.match(emptyHtml, /last 24 hours/i, "empty state must identify the lookback window");
assert.doesNotMatch(emptyHtml, /run-1|run-2|Representative recent runs/i, "empty state must not render static fixture rows");

const liveHtml = await renderRunsPage({
  overview: {
    ...baseOverview,
    runStatusCounts: [
      { status: "running", count: 1 },
      { status: "merged", count: 1 }
    ],
    recentRuns: [
      {
        id: "run-live-2",
        repository: "berlinguyinca/autospec-gui",
        branch: "feat/issue-23-bind-runs-live-telemetry",
        status: "running",
        startedAt: new Date("2026-07-11T11:40:00Z"),
        endedAt: null,
        durationSeconds: null
      },
      {
        id: "run-live-1",
        repository: "berlinguyinca/autospec-gui",
        branch: "main",
        status: "merged",
        startedAt: new Date("2026-07-11T10:00:00Z"),
        endedAt: new Date("2026-07-11T10:12:30Z"),
        durationSeconds: 750
      }
    ]
  }
});
assert.match(liveHtml, /Live recent runs/i, "live state must label database-backed rows");
for (const expected of [
  "run-live-2",
  "berlinguyinca/autospec-gui",
  "feat/issue-23-bind-runs-live-telemetry",
  "running",
  "run-live-1",
  "main",
  "merged",
  "12m 30s"
]) {
  assert.match(liveHtml, new RegExp(escapeRegExp(expected)), `live runs should render ${expected}`);
}
assert.match(liveHtml, /2 recent runs/i, "live state must summarize live row count");
assert.doesNotMatch(liveHtml, /run-1|run-2|DATABASE_URL|postgres:\/\//i, "live state must not render static fixture rows or secrets");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
