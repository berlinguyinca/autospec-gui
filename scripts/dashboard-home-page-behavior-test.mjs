import assert from "node:assert/strict";
import Module from "node:module";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const pagePath = join(process.cwd(), "app", "page.tsx");
const tempDir = join(process.cwd(), ".tmp-dashboard-home-page-behavior-test");

try {
  const source = readFileSync(pagePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: true
    },
    fileName: pagePath
  }).outputText;

  mkdirSync(tempDir, { recursive: true });
  const modulePath = join(tempDir, "page.cjs");
  writeFileSync(modulePath, compiled);

  const pageModule = loadModule(modulePath, {
    "../src/server/config": { AutospecConfigError: class AutospecConfigError extends Error {} },
    "../src/server/telemetry": {
      getTelemetryOverview: async () => ({ autonomousRunStatus: null })
    },
    "./telemetry-explorer": {
      __esModule: true,
      default: () => React.createElement("section", { "aria-label": "Telemetry explorer" }),
      TelemetryEvent: undefined
    }
  });
  assert.equal(typeof pageModule.default, "function", "dashboard home page must default-export a component");

  const html = renderToStaticMarkup(await pageModule.default());

  assert.match(html, /<h1[^>]*>Overview telemetry<\/h1>/, "dashboard must identify the overview route");
  assert.match(html, /<section[^>]*aria-label="Telemetry summary"/, "dashboard must expose its telemetry summary");
  assert.match(html, /<h2[^>]*>No run telemetry yet<\/h2>/, "dashboard must degrade safely when no run telemetry exists");
  assert.match(html, /<h2>55 runs observed<\/h2>/, "dashboard must retain the representative run total");
  assert.match(html, /<h2>55 issue events<\/h2>/, "dashboard must retain the representative issue total");
  assert.match(html, /<h2>24 pull request signals<\/h2>/, "dashboard must retain the representative PR total");
  assert.match(html, /read-only/i, "dashboard must communicate the read-only boundary");
  assert.doesNotMatch(
    html,
    /<form\b|method="post"|DATABASE_URL|postgres:\/\//i,
    "dashboard must not expose mutation forms or database secrets"
  );

  console.log("1 passing behavior scenario: dashboard overview remains informative and read-only");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function loadModule(path, replacements) {
  const mod = new Module(path);
  mod.filename = path;
  mod.paths = Module._nodeModulePaths(process.cwd());
  const originalRequire = mod.require.bind(mod);
  mod.require = (specifier) => specifier in replacements ? replacements[specifier] : originalRequire(specifier);
  mod._compile(readFileSync(path, "utf8"), path);
  return mod.exports;
}
