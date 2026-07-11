import assert from "node:assert/strict";
import Module from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

console.log("unit-only: discovery audit page tests mock server module results, not Postgres integration behavior");

const pagePath = join(process.cwd(), "app", "discovery-audit", "page.tsx");
assert.ok(existsSync(pagePath), "app/discovery-audit/page.tsx must exist");

const pageSource = readFileSync(pagePath, "utf8");
assert.doesNotMatch(pageSource, /^"use client";|^'use client';/m, "discovery audit page must remain a server component");
assert.match(pageSource, /src\/server\/telemetry/, "discovery audit page must fetch via the server-only telemetry read model");
assert.match(pageSource, /src\/server\/config/, "discovery audit page must handle server-only config errors without client exposure");
assert.match(pageSource, /listConfiguredDiscoveryAuditCycles/, "discovery audit page must use the configured discovery audit read model");
assert.doesNotMatch(pageSource, /DATABASE_URL|postgres:\/\//i, "discovery audit page source must not expose connection strings or secrets");
assert.doesNotMatch(pageSource, /<button\b|<form\b|method=["']post["']|\b(insert|update|delete|drop|alter|create)\b/i, "discovery audit page must stay read-only");
assert.match(pageSource, /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/, "discovery audit page must be rendered dynamically so configured telemetry is read at request time");

class MockAutospecConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "AutospecConfigError";
  }
}

function loadPage({ cycles, error }) {
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
    if (specifier === "../../src/server/config") return { AutospecConfigError: MockAutospecConfigError };
    if (specifier === "../../src/server/telemetry") {
      return {
        listConfiguredDiscoveryAuditCycles: async () => {
          if (error) throw error;
          return cycles;
        },
        formatDiscoveryAuditCount: (value) => value === null ? "Unavailable" : String(value),
        formatDiscoveryAuditField: (value) => value?.trim() ? value.replaceAll("_", " ") : "Unavailable"
      };
    }
    return originalRequire(specifier);
  };
  mod._compile(compiled, pagePath);
  return mod.exports;
}

async function renderPage(options) {
  const pageModule = loadPage(options);
  assert.equal(typeof pageModule.default, "function", "discovery audit page must default-export a component");
  const tree = await pageModule.default();
  return renderToStaticMarkup(tree);
}

const missingConfigHtml = await renderPage({ error: new MockAutospecConfigError("AUTOSPEC_TELEMETRY_DATABASE_URL is required") });
assert.match(missingConfigHtml, /Telemetry configuration needed/i, "missing telemetry env must render a clear non-fatal config state");
assert.match(missingConfigHtml, /AUTOSPEC_TELEMETRY_DATABASE_URL/i, "missing config state must name the required variable");
assert.match(missingConfigHtml, /read-only/i, "missing config state must preserve the read-only boundary");
assert.doesNotMatch(missingConfigHtml, /cycle-dry-1|postgres:\/\//i, "missing config state must not render static fallback rows or secrets");

const emptyHtml = await renderPage({ cycles: [] });
assert.match(emptyHtml, /No discovery audit telemetry found/i, "empty discovery telemetry must render a useful empty state");
assert.match(emptyHtml, /last 24 hours/i, "empty state must identify the lookback window");
assert.match(emptyHtml, /optional discovery schema/i, "empty state should explain schemas may not expose discovery data");

const liveHtml = await renderPage({ cycles: [
  {
    id: "cycle-dry-1",
    sourceType: "quality_audit",
    candidateCount: 4,
    filedCount: 0,
    dryReason: "dry_run_safety_gate",
    safetyResult: "blocked_by_scope",
    createdIssueNumbers: [],
    observedAt: new Date("2026-07-11T10:00:00Z")
  },
  {
    id: "cycle-filed-2",
    sourceType: "github_search",
    candidateCount: 2,
    filedCount: 2,
    dryReason: null,
    safetyResult: "passed",
    createdIssueNumbers: [27, 28],
    observedAt: new Date("2026-07-11T09:00:00Z")
  },
  {
    id: "cycle-sparse-3",
    sourceType: null,
    candidateCount: null,
    filedCount: null,
    dryReason: null,
    safetyResult: null,
    createdIssueNumbers: [],
    observedAt: null
  }
] });

assert.match(liveHtml, /Discovery Audit telemetry/i, "route must render a top-level discovery audit heading");
assert.match(liveHtml, /read-only/i, "live state must communicate read-only boundary");
for (const expected of [
  "cycle-dry-1",
  "quality audit",
  "4",
  "0",
  "dry run safety gate",
  "blocked by scope",
  "No issues filed",
  "cycle-filed-2",
  "github search",
  "passed",
  "cycle-sparse-3",
  "Unavailable"
]) {
  assert.match(liveHtml, new RegExp(escapeRegExp(expected)), `live discovery audit should render ${expected}`);
}
assert.match(liveHtml, /Dry cycle/, "dry cycles must be explicitly explainable");
assert.match(liveHtml, /<a\b[^>]*href="\/issues\/27"[^>]*>#27<\/a>/, "created issue identifiers must link to issue pages");
assert.match(liveHtml, /<a\b[^>]*href="\/issues\/28"[^>]*>#28<\/a>/, "each created issue identifier must link to issue pages");
assert.doesNotMatch(liveHtml, /DATABASE_URL|postgres:\/\//i, "live state must not expose secrets");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
