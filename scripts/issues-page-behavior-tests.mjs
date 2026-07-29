import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const pagePath = join(process.cwd(), "app", "issues", "page.tsx");
const tempDir = join(process.cwd(), ".tmp-issues-page-behavior-tests");

try {
  const source = readFileSync(pagePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: true
    },
    fileName: pagePath
  }).outputText;

  mkdirSync(tempDir, { recursive: true });
  const modulePath = join(tempDir, "page.mjs");
  writeFileSync(modulePath, compiled);

  const pageModule = await import(pathToFileURL(modulePath).href);
  assert.equal(typeof pageModule.default, "function", "issues page must default-export a component");

  const html = renderToStaticMarkup(React.createElement(pageModule.default));
  const expectedSignals = [
    ["Created", "18"],
    ["Classified", "15"],
    ["Implemented", "11"],
    ["Merged", "9"],
    ["Failed", "2"]
  ];

  assert.match(html, /<h1[^>]*>Issues<\/h1>/, "issues page must identify the route");
  assert.match(
    html,
    /<section[^>]*aria-label="Issue throughput summary"/,
    "issues page must identify the throughput summary"
  );
  for (const [label, value] of expectedSignals) {
    assert.match(
      html,
      new RegExp(`<h2>${label}</h2><p class="metric-value">${value}</p>`),
      `issues page must show the ${label.toLowerCase()} throughput signal`
    );
  }
  assert.equal(
    (html.match(/<article class="panel">/g) ?? []).length,
    expectedSignals.length,
    "issues page must render one panel per throughput signal"
  );
  assert.match(html, /read-only/i, "issues page must communicate the read-only boundary");
  assert.doesNotMatch(
    html,
    /<button\b|<form\b|method="post"|DATABASE_URL|postgres:\/\//i,
    "issues page must not expose mutation actions or database secrets"
  );

  console.log("1 passing behavior scenario: issue throughput remains visible and read-only");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
