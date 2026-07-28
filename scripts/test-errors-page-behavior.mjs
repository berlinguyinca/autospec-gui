import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const pagePath = join(process.cwd(), "app", "errors", "page.tsx");
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

const tempDir = join(process.cwd(), ".tmp-test-errors-page-behavior");
mkdirSync(tempDir, { recursive: true });
const modulePath = join(tempDir, "page.mjs");
writeFileSync(modulePath, compiled);

const pageModule = await import(pathToFileURL(modulePath).href);
assert.equal(typeof pageModule.default, "function", "errors page must default-export a component");

const html = renderToStaticMarkup(React.createElement(pageModule.default));

assert.match(html, /<h1[^>]*>Errors<\/h1>/, "errors page must identify the route");
assert.match(html, /<h2[^>]*>Grouped failures<\/h2>/, "errors page must identify the grouped failure summary");
assert.match(
  html,
  /<li><strong>Validation timeout while waiting for checks<\/strong><span>3 occurrences · latest 18m ago<\/span><\/li>/,
  "errors page must show the validation timeout group with count and recency"
);
assert.match(
  html,
  /<li><strong>Telemetry schema missing optional PR health view<\/strong><span>1 occurrences · latest 42m ago<\/span><\/li>/,
  "errors page must show the telemetry schema group with count and recency"
);
assert.equal((html.match(/<li>/g) ?? []).length, 2, "errors page must render one row per grouped error");
assert.match(html, /read-only/i, "errors page must communicate the read-only boundary");
assert.doesNotMatch(
  html,
  /<button\b|<form\b|method="post"|DATABASE_URL|postgres:\/\//i,
  "errors page must not expose recovery writes or database secrets"
);

console.log("1 passing behavior scenario: grouped errors remain visible and read-only");
