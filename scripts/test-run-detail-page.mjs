import assert from "node:assert/strict";
import Module from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

console.log("unit-only: run detail page tests mock server module results, not Postgres integration behavior");

const runDetailPath = join(process.cwd(), "app", "runs", "[runId]", "page.tsx");
assert.ok(existsSync(runDetailPath), "app/runs/[runId]/page.tsx must exist");

const runDetailSource = readFileSync(runDetailPath, "utf8");
assert.doesNotMatch(runDetailSource, /^"use client";|^'use client';/m, "run detail page must remain a server component");
assert.match(runDetailSource, /src\/server\/telemetry/, "run detail page must fetch via the server-only telemetry read model");
assert.match(runDetailSource, /getRunDetail/, "run detail page must use the run detail read model");
assert.match(runDetailSource, /src\/server\/config/, "run detail page must handle server-only config errors without client exposure");
assert.doesNotMatch(runDetailSource, /DATABASE_URL|postgres:\/\//i, "run detail source must not expose connection strings or secrets");
assert.doesNotMatch(runDetailSource, /<button\b|<form\b|method=["']post["']|\b(insert|update|delete|drop|alter|create)\b/i, "run detail page must stay read-only");
assert.match(runDetailSource, /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/, "run detail page must be rendered dynamically so configured telemetry is read at request time");

class MockAutospecConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "AutospecConfigError";
  }
}

function loadRunDetailPage({ detail, error }) {
  const compiled = ts.transpileModule(runDetailSource, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: true
    },
    fileName: runDetailPath
  }).outputText;

  const mod = new Module(runDetailPath);
  mod.filename = runDetailPath;
  mod.paths = Module._nodeModulePaths(process.cwd());
  const originalRequire = mod.require.bind(mod);
  mod.require = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier === "../../../src/server/config") {
      return { AutospecConfigError: MockAutospecConfigError };
    }
    if (specifier === "../../../src/server/telemetry") {
      return {
        getRunDetail: async (runId) => {
          if (error) throw error;
          assert.equal(runId, "run-live-25", "route param must be passed to getRunDetail");
          return detail;
        }
      };
    }
    return originalRequire(specifier);
  };
  mod._compile(compiled, runDetailPath);
  return mod.exports;
}

async function renderRunDetailPage(options, runId = "run-live-25") {
  const pageModule = loadRunDetailPage(options);
  assert.equal(typeof pageModule.default, "function", "run detail page must default-export a component");
  const tree = await pageModule.default({ params: Promise.resolve({ runId }) });
  return renderToStaticMarkup(tree);
}

const detail = {
  run: {
    id: "run-live-25",
    repository: "berlinguyinca/autospec-gui",
    branch: "feat/issue-25-run-detail-timeline-pages",
    status: "failed",
    startedAt: new Date("2026-07-11T10:00:00Z"),
    endedAt: new Date("2026-07-11T10:07:05Z"),
    durationSeconds: 425,
    issueNumber: 25,
    pullRequestNumber: 42
  },
  phases: [
    {
      name: "tests_started",
      status: "passed",
      startedAt: new Date("2026-07-11T10:01:00Z"),
      endedAt: new Date("2026-07-11T10:02:30Z"),
      durationSeconds: 90,
      summary: "Unit tests started"
    },
    {
      name: "validation",
      status: "failed",
      startedAt: new Date("2026-07-11T10:05:00Z"),
      endedAt: null,
      durationSeconds: null,
      summary: "validate.sh failed"
    }
  ],
  validations: [
    { name: "bash scripts/validate.sh", status: "failed", evidence: "typecheck failed", checkedAt: new Date("2026-07-11T10:07:00Z") }
  ],
  errors: [
    { message: "TypeScript route params mismatch", count: 1, latestOccurrence: new Date("2026-07-11T10:07:05Z") }
  ]
};

const liveHtml = await renderRunDetailPage({ detail });
for (const expected of [
  "Run run-live-25",
  "berlinguyinca/autospec-gui",
  "feat/issue-25-run-detail-timeline-pages",
  "failed",
  "7m 5s",
  "Issue #25",
  "PR #42",
  "Phase timeline",
  "tests_started",
  "Unit tests started",
  "Validation evidence",
  "bash scripts/validate.sh",
  "typecheck failed",
  "Related errors",
  "TypeScript route params mismatch"
]) {
  assert.match(liveHtml, new RegExp(escapeRegExp(expected)), `run detail should render ${expected}`);
}
assert.doesNotMatch(liveHtml, /DATABASE_URL|postgres:\/\//i, "run detail must not render secrets");

const emptyDetailHtml = await renderRunDetailPage({ detail: { ...detail, phases: [], validations: [], errors: [] } });
assert.match(emptyDetailHtml, /No phase timeline events are available/i, "run detail must explain empty phase timeline state");
assert.match(emptyDetailHtml, /No validation evidence is available/i, "run detail must explain empty validation state");
assert.match(emptyDetailHtml, /No related errors are available/i, "run detail must explain empty error state");

const notFoundHtml = await renderRunDetailPage({ detail: null });
assert.match(notFoundHtml, /Run not found/i, "unknown run ids must render a non-fatal not-found state");
assert.match(notFoundHtml, /run-live-25/i, "not-found state must include the requested run id");

const missingConfigHtml = await renderRunDetailPage({ error: new MockAutospecConfigError("AUTOSPEC_TELEMETRY_DATABASE_URL is required") });
assert.match(missingConfigHtml, /Telemetry configuration needed/i, "missing telemetry env must render a clear non-fatal config state");
assert.match(missingConfigHtml, /AUTOSPEC_TELEMETRY_DATABASE_URL/i, "missing config state must name the required variable");
assert.match(missingConfigHtml, /read-only/i, "missing config state must preserve the read-only boundary");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
