import assert from "node:assert/strict";
import Module from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

console.log("unit-only: pull request drilldown page tests mock server module results, not Postgres integration behavior");

const pagePath = join(process.cwd(), "app", "pull-requests", "page.tsx");
const telemetryPath = join(process.cwd(), "src", "server", "telemetry.ts");
assert.ok(existsSync(pagePath), "app/pull-requests/page.tsx must exist");
assert.ok(existsSync(telemetryPath), "src/server/telemetry.ts must exist");

const pageSource = readFileSync(pagePath, "utf8");
assert.doesNotMatch(pageSource, /^"use client";|^'use client';/m, "pull requests page must remain a server component");
assert.match(pageSource, /src\/server\/telemetry/, "pull requests page must fetch via the server-only telemetry read model");
assert.match(pageSource, /getPullRequestDrilldowns/, "pull requests page must use the PR drilldown read model");
assert.match(pageSource, /src\/server\/config/, "pull requests page must handle server-only config errors without client exposure");
assert.match(pageSource, /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/, "pull requests page must render dynamically for request-time filters");
assert.doesNotMatch(pageSource, /DATABASE_URL|postgres:\/\//i, "pull requests page source must not expose connection strings or secrets");
assert.doesNotMatch(pageSource, /<button\b|<form\b|method=["']post["']|\b(insert|update|delete|drop|alter|create)\b/i, "pull requests page must stay read-only");

const telemetrySource = readFileSync(telemetryPath, "utf8");
for (const name of ["PullRequestDrilldown", "PullRequestDrilldownFilters"]) {
  assert.match(telemetrySource, new RegExp(`export\\s+type\\s+${name}\\b`), `${name} read model type must be exported`);
}
assert.match(telemetrySource, /export\s+async\s+function\s+getPullRequestDrilldowns\b/, "getPullRequestDrilldowns must be exported");
assert.match(telemetrySource, /failure_class|failureClass/, "PR drilldown read model must expose failure class when telemetry has it");

class MockAutospecConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "AutospecConfigError";
  }
}

function loadPullRequestsPage({ rows = [], error, captureFilters = () => {} } = {}) {
  const compiled = ts.transpileModule(pageSource, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: true
    },
    fileName: pagePath
  }).outputText;

  const mod = new Module(pagePath);
  mod.filename = pagePath;
  mod.paths = Module._nodeModulePaths(process.cwd());
  const originalRequire = mod.require.bind(mod);
  mod.require = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier === "../../src/server/config") {
      return { AutospecConfigError: MockAutospecConfigError };
    }
    if (specifier === "../../src/server/telemetry") {
      return {
        getPullRequestDrilldowns: async (filters) => {
          captureFilters(filters);
          if (error) throw error;
          return rows;
        }
      };
    }
    return originalRequire(specifier);
  };
  mod._compile(compiled, pagePath);
  return mod.exports;
}

async function renderPullRequestsPage(options, searchParams = {}) {
  const pageModule = loadPullRequestsPage(options);
  assert.equal(typeof pageModule.default, "function", "pull requests page must default-export a component");
  const tree = await pageModule.default({ searchParams: Promise.resolve(searchParams) });
  return { html: renderToStaticMarkup(tree), pageModule };
}

function loadTelemetryModule() {
  const compiled = ts.transpileModule(telemetrySource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: true
    },
    fileName: telemetryPath
  }).outputText;

  const mod = new Module(telemetryPath);
  mod.filename = telemetryPath;
  mod.paths = Module._nodeModulePaths(process.cwd());
  const originalRequire = mod.require.bind(mod);
  mod.require = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier === "./config") {
      return { getAutospecServerConfig: () => ({ telemetryDatabaseUrl: "postgres://unit:redacted@localhost/db", telemetrySchema: "public", readOnly: true }) };
    }
    if (specifier === "./db") {
      return {
        quoteIdentifier: (value) => `"${String(value).replaceAll('"', '""')}"`,
        withReadOnlyTelemetryClient: async (callback) => callback({ query: async () => ({ rows: [] }) })
      };
    }
    return originalRequire(specifier);
  };
  mod._compile(compiled, telemetryPath);
  return mod.exports;
}

const helperModule = loadPullRequestsPage();
assert.equal(typeof helperModule.parsePullRequestFilters, "function", "parsePullRequestFilters must be exported for deterministic unit coverage");
assert.equal(typeof helperModule.buildPullRequestFilterHref, "function", "buildPullRequestFilterHref must be exported for deterministic unit coverage");
assert.deepEqual(
  helperModule.parsePullRequestFilters({ repository: "berlinguyinca/autospec-gui", status: "failed", window: "72", failureClass: "validation" }),
  { repository: "berlinguyinca/autospec-gui", status: "failed", windowHours: 72, failureClass: "validation" },
  "valid search params must parse into PR drilldown filters"
);
assert.deepEqual(
  helperModule.parsePullRequestFilters({ repository: "", status: "", window: "999", failureClass: "" }),
  { repository: "all", status: "all", windowHours: 24, failureClass: "all" },
  "empty or unsupported search params must fall back to safe defaults"
);
assert.equal(
  helperModule.buildPullRequestFilterHref({ repository: "all", status: "failed", windowHours: 24, failureClass: "all" }, { repository: "berlinguyinca/autospec-gui", failureClass: "validation" }),
  "/pull-requests?repository=berlinguyinca%2Fautospec-gui&status=failed&failureClass=validation",
  "filter links must preserve non-default state in URL search params"
);

const telemetryModule = loadTelemetryModule();
assert.equal(typeof telemetryModule.listPullRequestDrilldowns, "function", "listPullRequestDrilldowns must be exported for query regression coverage");

let capturedSql = "";
let capturedParams = [];
const mixedRows = [
  {
    id: "pr-open-failed",
    repository: "berlinguyinca/autospec-gui",
    number: 28,
    title: "Mixed open PR with failed check",
    status: "open",
    checkStatus: "failed",
    validationSummary: "failed validation",
    linkedIssueNumber: "#28",
    branch: "feat/issue-28-pr-check-drilldowns",
    mergeState: "blocked",
    failureClass: "validation",
    updatedAt: "2026-07-11T19:30:00Z",
    url: "https://github.com/berlinguyinca/autospec-gui/pull/28",
    checkUrl: "https://github.com/berlinguyinca/autospec-gui/actions/runs/28"
  },
  {
    id: "pr-merged-success",
    repository: "berlinguyinca/autospec-gui",
    number: 29,
    title: "Merged PR with successful check",
    status: "merged",
    checkStatus: "success",
    validationSummary: "validation passed",
    linkedIssueNumber: "https://github.com/berlinguyinca/autospec-gui/issues/29",
    branch: "main",
    mergeState: "clean",
    failureClass: null,
    updatedAt: "2026-07-11T20:30:00Z",
    url: null,
    checkUrl: null
  },
  {
    id: "pr-nonnumeric-issue",
    repository: "berlinguyinca/autospec-gui",
    number: 30,
    title: "Non numeric issue text",
    status: "open",
    checkStatus: "pending",
    validationSummary: null,
    linkedIssueNumber: "not-an-issue",
    branch: null,
    mergeState: null,
    failureClass: null,
    updatedAt: "2026-07-11T21:30:00Z",
    url: null,
    checkUrl: null
  }
];
const fakeClient = {
  query: async (sql, params) => {
    capturedSql = sql;
    capturedParams = params;
    return { rows: mixedRows };
  }
};
const discovered = {
  schemaName: "public",
  tables: {
    pull_requests: [
      "id",
      "repository",
      "number",
      "title",
      "status",
      "check_status",
      "validation_summary",
      "linked_issue_number",
      "branch",
      "merge_state",
      "failure_class",
      "updated_at",
      "url",
      "check_url"
    ]
  }
};
const shapedRows = await telemetryModule.listPullRequestDrilldowns(fakeClient, discovered, { repository: "all", status: "open", windowHours: 24, failureClass: "all" }, 10);
assert.match(capturedSql, /lower\("status"::text\) = lower\(\$2::text\)/, "PR status filters must compare the PR status column directly");
assert.doesNotMatch(capturedSql, /coalesce\("check_status"::text, "status"::text, "merge_state"::text/, "PR status filter must not be hidden behind first-non-null check status coalescing");
assert.equal(capturedParams[1], "open", "mixed PR/check regression must exercise status=open filtering");
assert.deepEqual(
  shapedRows.map((row) => row.linkedIssueNumber),
  [28, 29, null],
  "linked issue parser must accept #28 and GitHub issue URLs while ignoring nonnumeric text"
);
assert.doesNotMatch(capturedSql, /linked_issue_number"::numeric/, "linked issue fields must be selected as text to avoid crashing on #28 or issue URLs");

let capturedFilters;
const { html: liveHtml } = await renderPullRequestsPage(
  {
    rows: [
      {
        id: "pr-91",
        repository: "berlinguyinca/autospec-gui",
        number: 91,
        title: "Add pull request drilldowns",
        status: "open",
        checkStatus: "failed",
        validationSummary: "bash scripts/validate.sh failed at typecheck",
        linkedIssueNumber: 28,
        branch: "feat/issue-28-pr-check-drilldowns",
        mergeState: "blocked",
        failureClass: "validation",
        updatedAt: new Date("2026-07-11T19:30:00Z"),
        url: "https://github.com/berlinguyinca/autospec-gui/pull/91",
        checkUrl: "https://github.com/berlinguyinca/autospec-gui/actions/runs/123"
      },
      {
        id: "pr-92",
        repository: "berlinguyinca/autospec-gui",
        number: null,
        title: null,
        status: "unknown",
        checkStatus: null,
        validationSummary: null,
        linkedIssueNumber: null,
        branch: null,
        mergeState: null,
        failureClass: null,
        updatedAt: null,
        url: null,
        checkUrl: null
      },
      {
        id: "pr-unsafe-url",
        repository: "berlinguyinca/autospec-gui",
        number: 93,
        title: "Unsafe URL should not link",
        status: "open",
        checkStatus: "pending",
        validationSummary: "waiting",
        linkedIssueNumber: 30,
        branch: "feat/unsafe-url",
        mergeState: "unknown",
        failureClass: "unknown",
        updatedAt: null,
        url: "javascript:alert(1)",
        checkUrl: "data:text/html,unsafe"
      }
    ],
    captureFilters: (filters) => {
      capturedFilters = filters;
    }
  },
  { repository: "berlinguyinca/autospec-gui", status: "failed", window: "72", failureClass: "validation" }
);
assert.deepEqual(
  capturedFilters,
  { repository: "berlinguyinca/autospec-gui", status: "failed", windowHours: 72, failureClass: "validation" },
  "page must pass parsed URL filters to the server read model"
);
for (const expected of [
  "Pull request drilldowns",
  "Filtered PR/check rows",
  "berlinguyinca/autospec-gui",
  "PR #91",
  "Add pull request drilldowns",
  "open",
  "failed",
  "bash scripts/validate.sh failed at typecheck",
  "Issue #28",
  "feat/issue-28-pr-check-drilldowns",
  "blocked",
  "validation",
  "View PR",
  "View check run",
  "Unsafe URL should not link",
  "PR URL unavailable",
  "Check URL unavailable",
  "Missing title",
  "No linked issue recorded",
  "No branch recorded",
  "No validation summary recorded",
  "No merge state recorded"
]) {
  assert.match(liveHtml, new RegExp(escapeRegExp(expected)), `pull request drilldown should render ${expected}`);
}
assert.match(liveHtml, /href="\/pull-requests\?repository=berlinguyinca%2Fautospec-gui&amp;status=failed&amp;window=72"/, "filter links must encode state in URL search params");
assert.doesNotMatch(liveHtml, /DATABASE_URL|postgres:\/\//i, "rendered PR drilldowns must not expose secrets");
assert.doesNotMatch(liveHtml, /<form\b|method="post"/i, "rendered PR drilldowns must not expose write forms");

const { html: emptyHtml } = await renderPullRequestsPage({ rows: [] });
assert.match(emptyHtml, /No pull request check rows found/i, "configured empty PR/check telemetry must render a useful empty state");
assert.match(emptyHtml, /last 24 hours/i, "empty state must identify the active lookback window");
assert.match(emptyHtml, /Adjust the URL-backed filters/i, "empty state must explain filter recovery");

const { html: missingConfigHtml } = await renderPullRequestsPage({ error: new MockAutospecConfigError("AUTOSPEC_TELEMETRY_DATABASE_URL is required") });
assert.match(missingConfigHtml, /Telemetry configuration needed/i, "missing telemetry env must render a clear non-fatal config state");
assert.match(missingConfigHtml, /AUTOSPEC_TELEMETRY_DATABASE_URL/i, "missing config state must name the required variable");
assert.match(missingConfigHtml, /read-only/i, "missing config state must preserve the read-only boundary");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
