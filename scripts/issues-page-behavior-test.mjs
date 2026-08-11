import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const pagePath = join(process.cwd(), "app", "issues", "page.tsx");
const tempDir = join(process.cwd(), ".tmp-issues-page-behavior-test");

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

  assert.match(
    html,
    /<main class="shell section-shell" id="main-content">/,
    "issues page must render the shared main landmark so in-page navigation targets stay stable"
  );

  const heroLabel = /<section class="hero" aria-labelledby="([^"]+)">/.exec(html);
  assert.ok(heroLabel, "issues page must label its hero section for assistive technology");
  assert.match(
    html,
    new RegExp(`<h1 id="${heroLabel[1]}">Issues</h1>`),
    "issues page hero label must resolve to the rendered page heading"
  );

  const panels = readPanels(html);
  assert.deepEqual(
    panels.map((panel) => panel.label),
    ["Created", "Classified", "Implemented", "Merged", "Failed"],
    "issues page must present the discovery-to-merge funnel in flow order, with failures last"
  );
  for (const panel of panels) {
    assert.equal(
      panel.kicker,
      "Issue throughput",
      `the ${panel.label.toLowerCase()} panel must state which telemetry family it belongs to`
    );
    assert.match(
      panel.rawValue,
      /^\d+$/,
      `the ${panel.label.toLowerCase()} panel must report a non-negative whole count`
    );
  }

  const funnel = panels.filter((panel) => panel.label !== "Failed");
  for (let index = 1; index < funnel.length; index += 1) {
    assert.ok(
      funnel[index].value <= funnel[index - 1].value,
      `${funnel[index].label} cannot exceed ${funnel[index - 1].label}; the funnel must not widen downstream`
    );
  }
  assert.ok(
    panels.at(-1).value <= funnel[0].value,
    "failed issues cannot exceed created issues"
  );

  assert.equal(
    renderToStaticMarkup(React.createElement(pageModule.default)),
    html,
    "issues page must render deterministically so the read-only summary is cacheable"
  );

  assert.match(html, /read-only/i, "issues page must communicate the read-only boundary");
  assert.doesNotMatch(
    html,
    /<button\b|<form\b|<input\b|method="post"|DATABASE_URL|postgres:\/\//i,
    "issues page must not expose mutation controls or database secrets"
  );

  console.log("1 passing behavior scenario: the issues page exposes an ordered, read-only issue throughput funnel");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function readPanels(html) {
  const pattern = /<article class="panel"><p class="panel-kicker">([^<]*)<\/p><h2>([^<]*)<\/h2><p class="metric-value">([^<]*)<\/p><\/article>/g;
  return [...html.matchAll(pattern)].map((match) => ({
    kicker: match[1],
    label: match[2],
    rawValue: match[3],
    value: Number(match[3])
  }));
}
