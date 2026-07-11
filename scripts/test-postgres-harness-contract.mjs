import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
assert.equal(
  packageJson.scripts?.["test:integration:postgres"],
  "node scripts/test-postgres-fixtures.mjs",
  "package.json must expose an opt-in real-Postgres integration harness"
);

const harnessPath = join(process.cwd(), "scripts", "test-postgres-fixtures.mjs");
assert.ok(existsSync(harnessPath), "scripts/test-postgres-fixtures.mjs must exist");

const harnessSource = readFileSync(harnessPath, "utf8");
assert.match(harnessSource, /AUTOSPEC_TEST_DATABASE_URL/, "harness must require AUTOSPEC_TEST_DATABASE_URL for fixture writes");
assert.doesNotMatch(
  harnessSource,
  /AUTOSPEC_TELEMETRY_DATABASE_URL[\s\S]{0,120}(CREATE|DROP|INSERT|UPDATE|DELETE)/i,
  "harness must not write fixtures through the production telemetry URL"
);
assert.match(harnessSource, /create\s+schema/i, "harness must create an isolated fixture schema in the explicit test database");
assert.match(harnessSource, /drop\s+schema/i, "harness must drop the isolated fixture schema after the test");
assert.match(harnessSource, /withReadOnlyTelemetryClient/, "harness must exercise the server read-only Postgres data path");
assert.match(harnessSource, /BEGIN\s+READ\s+ONLY/i, "harness must prove reads run through a read-only transaction");
assert.doesNotMatch(harnessSource, /FakePool|mock/i, "integration harness must not mock Postgres behavior");
