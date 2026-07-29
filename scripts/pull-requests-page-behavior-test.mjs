import assert from "node:assert/strict";
import Module from "node:module";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const pagePath = join(process.cwd(), "app", "pull-requests", "page.tsx");
const tempDir = join(process.cwd(), ".tmp-pull-requests-page-behavior-test");

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

  class AutospecConfigError extends Error {}
  const pageModule = loadModule(modulePath, {
    "../../src/server/config": { AutospecConfigError },
    "../../src/server/telemetry": {
      getPullRequestDrilldowns: async () => {
        throw new AutospecConfigError("AUTOSPEC_DATABASE_URL is not configured");
      }
    }
  });

  const html = renderToStaticMarkup(await pageModule.default());

  assert.match(html, /<h1[^>]*>Pull Requests<\/h1>/, "the page must identify the route");
  assert.match(html, /Telemetry configuration needed/, "a missing server configuration must render a useful state");
  assert.match(html, /AUTOSPEC_DATABASE_URL is not configured/, "the configuration error must remain visible");
  assert.match(html, /does not attempt client-side telemetry access/, "the fallback must preserve the server-only boundary");
  assert.doesNotMatch(
    html,
    /<button\b|<form\b|method="post"|postgres:\/\//i,
    "the configuration state must not expose mutation controls or a database connection string"
  );

  console.log("1 passing behavior scenario: missing pull request telemetry configuration degrades safely");
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
