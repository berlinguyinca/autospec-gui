import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const explorerPath = join(process.cwd(), "app", "telemetry-explorer.tsx");
const overviewPath = join(process.cwd(), "app", "page.tsx");

assert.ok(existsSync(explorerPath), "interactive telemetry filters must live in app/telemetry-explorer.tsx");

const explorerSource = readFileSync(explorerPath, "utf8");
assert.match(explorerSource, /^"use client";/, "telemetry explorer must be a client component for browser-only filter and drilldown state");
assert.doesNotMatch(explorerSource, /<form\b|method=["']post["']|\b(insert|update|delete|drop|alter|create)\b/i, "filters must remain read-only and avoid write affordances");
assert.doesNotMatch(explorerSource, /DATABASE_URL|postgres:\/\//i, "client filters must not expose database URLs or secrets");

const compiled = ts.transpileModule(explorerSource, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true
  },
  fileName: explorerPath
}).outputText;

const tempDir = join(process.cwd(), ".tmp-test-telemetry-filters");
mkdirSync(tempDir, { recursive: true });
const modulePath = join(tempDir, "telemetry-explorer.mjs");
writeFileSync(modulePath, compiled);

const explorerModule = await import(pathToFileURL(modulePath).href);
const originalDateNow = Date.now;
Date.now = () => Date.parse("2026-07-11T12:00:00Z");

assert.equal(typeof explorerModule.default, "function", "telemetry explorer must default-export a component");
assert.equal(typeof explorerModule.filterTelemetryEvents, "function", "filterTelemetryEvents must be exported for deterministic unit coverage");
assert.equal(typeof explorerModule.summarizeVisibleEvents, "function", "summarizeVisibleEvents must be exported for deterministic unit coverage");

const sampleEvents = [
  { id: "run-42", category: "runs", label: "Run 42", status: "running", phase: "implement", repository: "berlinguyinca/autospec-gui", timestamp: "2026-07-11T06:00:00Z", detail: "Active implementation", value: 6 },
  { id: "issue-6", category: "issues", label: "Issue 6", status: "merged", phase: "verify", repository: "berlinguyinca/autospec-gui", timestamp: "2026-07-10T10:00:00Z", detail: "Interactive filters", value: 11 },
  { id: "pr-4", category: "pull-requests", label: "PR 4", status: "failed", phase: "ci", repository: "other/repo", timestamp: "2026-07-09T08:00:00Z", detail: "Checks failed", value: 1 }
];

assert.deepEqual(
  explorerModule.filterTelemetryEvents(sampleEvents, { category: "issues", status: "all", windowHours: 72, repository: "all" }).map((event) => event.id),
  ["issue-6"],
  "category filter must isolate issue telemetry"
);
assert.deepEqual(
  explorerModule.filterTelemetryEvents(sampleEvents, { category: "all", status: "failed", windowHours: 72, repository: "all" }).map((event) => event.id),
  ["pr-4"],
  "status filter must isolate failed telemetry"
);
assert.deepEqual(
  explorerModule.filterTelemetryEvents(sampleEvents, { category: "all", status: "all", windowHours: 12, repository: "all" }).map((event) => event.id),
  ["run-42"],
  "window filter must exclude events older than the selected lookback"
);
assert.deepEqual(
  explorerModule.filterTelemetryEvents(sampleEvents, { category: "all", status: "all", windowHours: 72, repository: "berlinguyinca/autospec-gui" }).map((event) => event.id),
  ["run-42", "issue-6"],
  "repository filter must preserve only matching repository telemetry"
);
assert.deepEqual(
  explorerModule.summarizeVisibleEvents(sampleEvents),
  { total: 3, running: 1, merged: 1, failed: 1 },
  "summary must count visible drilldown events by status"
);

const html = renderToStaticMarkup(React.createElement(explorerModule.default, { events: sampleEvents }));

assert.match(html, /aria-label="Telemetry filters"/, "filter controls need a labelled control region");
assert.match(html, /<select\b[^>]*aria-label="Telemetry category"/, "category filter must use an accessible select");
assert.match(html, /<select\b[^>]*aria-label="Telemetry status"/, "status filter must use an accessible select");
assert.match(html, /<select\b[^>]*aria-label="Telemetry time window"/, "date range control must use an accessible select");
assert.match(html, /<select\b[^>]*aria-label="Telemetry repository"/, "repository filter must use an accessible select");
assert.match(html, /<button\b(?=[^>]*type="button")(?=[^>]*aria-pressed="true")/, "drilldown controls must expose pressed state without submitting writes");
assert.match(html, /role="img"[^>]*aria-label="Filtered telemetry event volume"/, "interactive chart control must remain accessible as an SVG image");
assert.match(html, /data-testid="telemetry-drilldown-row"/, "visible events must render drilldown rows");
assert.doesNotMatch(html, /<form\b|method="post"|DATABASE_URL|postgres:\/\//i, "rendered filters must be read-only and avoid secret exposure");

const overviewSource = readFileSync(overviewPath, "utf8");
assert.match(overviewSource, /TelemetryExplorer/, "overview must embed the interactive telemetry explorer");

Date.now = originalDateNow;
