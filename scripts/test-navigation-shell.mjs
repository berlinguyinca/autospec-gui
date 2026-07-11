import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const expectedSections = [
  ["Overview", "/"],
  ["Runs", "/runs"],
  ["Issues", "/issues"],
  ["Pull Requests", "/pull-requests"],
  ["Errors", "/errors"]
];

const layoutPath = join(process.cwd(), "app", "layout.tsx");
assert.ok(existsSync(layoutPath), "app/layout.tsx must exist");

const layoutHtml = await renderComponent(layoutPath, "layout", {
  children: React.createElement("main", null, "route content")
});

assert.match(layoutHtml, /<nav\b[^>]*aria-label="Primary navigation"/, "layout must expose semantic primary navigation");
for (const [label, href] of expectedSections) {
  assert.match(layoutHtml, new RegExp(`<a\\b[^>]*href="${escapeRegExp(href)}"[^>]*>${escapeRegExp(label)}</a>`), `${label} must be linked from primary navigation`);
}
assert.match(layoutHtml, /route content/, "layout must render route children below the shell navigation");
assert.doesNotMatch(layoutHtml, /DATABASE_URL|postgres:\/\//i, "navigation shell must not expose connection strings or secrets");

for (const [label, href] of expectedSections) {
  const pagePath = href === "/"
    ? join(process.cwd(), "app", "page.tsx")
    : join(process.cwd(), "app", href.slice(1), "page.tsx");
  assert.ok(existsSync(pagePath), `${label} route page must exist at ${pagePath}`);

  const html = await renderComponent(pagePath, label.toLowerCase().replaceAll(" ", "-"));
  assert.match(html, new RegExp(`<h1[^>]*>${escapeRegExp(label)}(?: telemetry)?</h1>`), `${label} route must render a top-level section heading`);
  assert.match(html, /read-only/i, `${label} route must communicate the read-only dashboard boundary`);
  assert.doesNotMatch(html, /<button\b|<form\b|method="post"|DATABASE_URL|postgres:\/\//i, `${label} route must stay read-only and avoid secret exposure`);
}

async function renderComponent(sourcePath, moduleName, props = {}) {
  const source = readFileSync(sourcePath, "utf8")
    .replace(/^import\s+["\']\.\/globals\.css["\'];\s*$/m, "")
    .replace(/^import\s+TelemetryExplorer[^;]+;\s*$/m, "")
    .replace(/^import\s+\{\s*AutospecConfigError\s*\}\s+from\s+["']\.\.\/\.\.\/src\/server\/config["'];\s*$/m, "class AutospecConfigError extends Error {}")
    .replace(/^import\s+\{\s*getTelemetryOverview[^;]+;\s*$/m, `async function getTelemetryOverview() {
  return {
    window: { hours: 24, from: new Date("2026-07-10T12:00:00Z"), to: new Date("2026-07-11T12:00:00Z") },
    runStatusCounts: [],
    recentRuns: [],
    issueThroughput: { created: 0, classified: 0, implemented: 0, merged: 0, failed: 0, paused: 0 },
    pullRequestHealth: { open: 0, merged: 0, failedChecks: 0, pendingChecks: 0, advisoryChecks: 0 },
    agentActivity: [],
    errorSummary: []
  };
}`)
    .replace(/<TelemetryExplorer\s+events=\{telemetryEvents\}\s+\/>/, "<section>Interactive telemetry filters placeholder</section>");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    },
    fileName: sourcePath
  }).outputText;

  const tempDir = join(process.cwd(), ".tmp-test-navigation-shell");
  mkdirSync(tempDir, { recursive: true });
  const modulePath = join(tempDir, `${moduleName}.mjs`);
  writeFileSync(modulePath, compiled);

  const mod = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}-${Math.random()}`);
  assert.equal(typeof mod.default, "function", `${sourcePath} must default-export a component`);
  const rendered = mod.default(props);
  return renderToStaticMarkup(await Promise.resolve(rendered));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
