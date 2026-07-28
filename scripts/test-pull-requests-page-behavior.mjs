import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const pagePath = join(process.cwd(), "app", "pull-requests", "page.tsx");
const source = readFileSync(pagePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true
  },
  fileName: pagePath
}).outputText;

const tempDir = join(process.cwd(), ".tmp-test-pull-requests-page-behavior");
mkdirSync(tempDir, { recursive: true });
const modulePath = join(tempDir, "page.mjs");
try {
  writeFileSync(modulePath, compiled);

  const pageModule = await import(pathToFileURL(modulePath).href);
  assert.equal(typeof pageModule.default, "function", "pull requests page must default-export a component");

  const html = renderToStaticMarkup(React.createElement(pageModule.default));
  const expectedSignals = [
    ["Open PRs", "7"],
    ["Merged PRs", "9"],
    ["Pending checks", "4"],
    ["Failed checks", "1"]
  ];

  assert.match(html, /<h1[^>]*>Pull Requests<\/h1>/, "pull requests page must identify the route");
  assert.match(
    html,
    /<section[^>]*aria-label="Pull request health summary"/,
    "pull requests page must identify the PR and CI health summary"
  );
  for (const [label, value] of expectedSignals) {
    assert.match(
      html,
      new RegExp(`<h2>${label}</h2><p class="metric-value">${value}</p>`),
      `pull requests page must show the ${label.toLowerCase()} health signal`
    );
  }
  assert.equal(
    (html.match(/<article class="panel">/g) ?? []).length,
    expectedSignals.length,
    "pull requests page must render one panel per health signal"
  );
  assert.match(html, /read-only/i, "pull requests page must communicate the read-only boundary");
  assert.doesNotMatch(
    html,
    /<button\b|<form\b|method="post"|DATABASE_URL|postgres:\/\//i,
    "pull requests page must not expose merge controls, mutation actions, or database secrets"
  );

  console.log("1 passing behavior scenario: pull request health remains visible and read-only");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
