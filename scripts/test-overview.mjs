import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const pagePath = join(process.cwd(), "app", "page.tsx");
assert.ok(existsSync(pagePath), "app/page.tsx must exist");

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

const tempDir = join(process.cwd(), ".tmp-test-overview");
mkdirSync(tempDir, { recursive: true });
const modulePath = join(tempDir, "page.mjs");
writeFileSync(modulePath, compiled);

const pageModule = await import(pathToFileURL(modulePath).href);
assert.equal(typeof pageModule.default, "function", "app/page.tsx must default-export a component");

const html = renderToStaticMarkup(React.createElement(pageModule.default));

assert.match(html, /Last 24 hours/, "overview must state the telemetry time window");
assert.match(html, /Run throughput/, "overview must show run throughput visualization");
assert.match(html, /Issue throughput/, "overview must show issue throughput visualization");
assert.match(html, /PR\/CI health/, "overview must show PR/CI health visualization");
assert.match(html, /Agent activity/, "overview must show agent activity visualization");
assert.match(html, /Error summary/, "overview must show error summary visualization");

const svgCount = (html.match(/<svg\b/g) ?? []).length;
assert.ok(svgCount >= 3, `expected at least three inline chart SVGs, found ${svgCount}`);

const metricRows = (html.match(/data-testid="telemetry-metric"/g) ?? []).length;
assert.ok(metricRows >= 6, `expected dynamic metric rows, found ${metricRows}`);

assert.doesNotMatch(html, /Initial scaffold/, "overview should no longer be only the static intro shell");
assert.doesNotMatch(html, /DATABASE_URL|postgres:\/\//i, "overview must not expose connection strings or secrets");
