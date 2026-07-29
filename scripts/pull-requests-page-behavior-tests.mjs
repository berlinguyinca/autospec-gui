import assert from "node:assert/strict";
import Module from "node:module";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const pagePath = join(process.cwd(), "app", "pull-requests", "page.tsx");
const tempDir = join(process.cwd(), ".tmp-pull-requests-page-behavior-tests");
const observedFilters = [];

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
    "../../src/server/config": { AutospecConfigError: class AutospecConfigError extends Error {} },
    "../../src/server/telemetry": {
      getPullRequestDrilldowns: async (filters) => {
        observedFilters.push(filters);
        return [{
          id: "pr-42",
          repository: "berlinguyinca/autospec-gui",
          number: 42,
          title: null,
          status: "failed",
          checkStatus: "completed",
          validationSummary: null,
          linkedIssueNumber: 46,
          branch: "feat/autonomous-issue-46",
          mergeState: null,
          failureClass: "validation",
          updatedAt: null,
          url: "javascript:alert(1)",
          checkUrl: "https://github.com/berlinguyinca/autospec-gui/actions/runs/42"
        }];
      }
    }
  });

  const html = renderToStaticMarkup(await pageModule.default({
    searchParams: Promise.resolve({
      repository: " berlinguyinca/autospec-gui ",
      status: "failed",
      window: "72",
      failureClass: "validation"
    })
  }));

  assert.deepEqual(observedFilters, [{
    repository: "berlinguyinca/autospec-gui",
    status: "failed",
    windowHours: 72,
    failureClass: "validation"
  }], "the page must pass normalized URL filters to the telemetry query");
  assert.match(html, /<h1[^>]*>Pull Requests<\/h1>/, "the page must identify the route");
  assert.match(html, /1 pull request check rows match the active filters for the last 72 hours/, "the page must summarize the filtered result");
  assert.match(html, /PR #42/, "the page must render the pull request identity");
  assert.match(html, /Missing title/, "missing optional telemetry must render a non-fatal fallback");
  assert.match(html, /Issue #46/, "the page must retain linked issue telemetry");
  assert.match(html, /href="https:\/\/github\.com\/berlinguyinca\/autospec-gui\/actions\/runs\/42"/, "safe check links must remain available");
  assert.match(html, /PR URL unavailable/, "unsafe pull request links must be rejected");
  assert.doesNotMatch(
    html,
    /javascript:|<button\b|<form\b|method="post"|DATABASE_URL|postgres:\/\//i,
    "the rendered drilldown must not expose unsafe links, mutation controls, or database secrets"
  );

  console.log("1 passing behavior scenario: filtered pull request drilldowns remain safe and read-only");
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
