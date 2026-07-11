import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

assert.equal(
  packageJson.scripts?.audit,
  "npm run audit:deps",
  "package.json must expose npm run audit as the repo-quality audit dependency-gate entrypoint"
);

const routeCatalogPath = "tests/route-coverage-catalog.txt";
assert.ok(existsSync(routeCatalogPath), "route coverage catalog must live under tests/ so repo-quality-audit can discover it");
const routeCatalog = readFileSync(routeCatalogPath, "utf8");
for (const route of ["/runs", "/runs/page", "/issues", "/issues/page", "/pull-requests", "/pull-requests/page", "/errors", "/errors/page", "/page"]) {
  assert.match(routeCatalog, new RegExp(`(^|\\n)${route.replaceAll("/", "\\/")}(\\n|$)`), `${route} must be listed in the test route catalog`);
}

const acceptedPath = ".autospec/quality-audit-accepted.json";
assert.ok(existsSync(acceptedPath), "generated Next.js false positives must be recorded as accepted audit debt");
const accepted = JSON.parse(readFileSync(acceptedPath, "utf8"));
const acceptedDebt = accepted.accepted_debt ?? [];

for (const key of ["route-coverage:/_global-error", "route-coverage:/_global-error/page", "route-coverage:/_not-found", "route-coverage:/_not-found/page"]) {
  assert.ok(acceptedDebt.includes(key), `${key} should be accepted as generated Next.js internal route debt`);
}

assert.ok(acceptedDebt.includes("route-coverage:/dashboard"), "stale generated .next dashboard typings should be accepted while no real dashboard route exists");
assert.ok(!existsSync("app/dashboard/page.tsx"), "if a real dashboard route is added, remove route-coverage:/dashboard from accepted debt and cover it in tests");

for (const route of ["/", "/page", "/runs", "/runs/page", "/issues", "/issues/page", "/pull-requests", "/pull-requests/page", "/errors", "/errors/page"]) {
  assert.ok(!acceptedDebt.includes(`route-coverage:${route}`), `${route} is user-facing or catalog-covered and must not be accepted away`);
}
for (const key of acceptedDebt.filter((value) => value.startsWith("large-files:"))) {
  assert.match(key, /^large-files:\.next\//, `${key} must only accept generated .next large-file artifacts`);
}

const gitignore = readFileSync(".gitignore", "utf8");
assert.match(gitignore, /^\.autospec\/\*$/m, "generated .autospec audit artifacts should be ignored by default");
assert.match(gitignore, /^!\.autospec\/quality-audit-accepted\.json$/m, "the accepted audit-debt config must remain trackable");
