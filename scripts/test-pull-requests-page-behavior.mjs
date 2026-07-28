import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pagePath = join(process.cwd(), "app", "pull-requests", "page.tsx");
const source = readFileSync(pagePath, "utf8");

assert.match(source, /<h1[^>]*>Pull Requests<\/h1>/, "pull requests page must identify the route");
assert.match(source, /PR\/check detail/, "pull requests page must retain the PR and check health drilldown");
assert.match(source, /read-only/i, "pull requests page must communicate the read-only boundary");
assert.doesNotMatch(
  source,
  /<button\b|<form\b|method="post"|DATABASE_URL|postgres:\/\//i,
  "pull requests page must not expose merge controls, mutation actions, or database secrets"
);

console.log("1 passing behavior scenario: pull request health remains visible and read-only");
