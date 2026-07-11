import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
assert.equal(packageJson.scripts?.lint, "node scripts/lint.mjs", "package.json must expose the standard lint gate");
assert.equal(packageJson.scripts?.["audit:deps"], "node scripts/audit-dependencies.mjs", "package.json must expose the standard dependency audit gate");
assert.ok(existsSync(join(process.cwd(), "scripts", "lint.mjs")), "scripts/lint.mjs must implement the lint gate");
assert.ok(existsSync(join(process.cwd(), "scripts", "audit-dependencies.mjs")), "scripts/audit-dependencies.mjs must implement the dependency audit gate");

const validateSource = readFileSync(join(process.cwd(), "scripts", "validate.sh"), "utf8");
assert.match(validateSource, /npm run lint/, "scripts/validate.sh must run npm run lint during validation");
assert.match(validateSource, /npm run audit:deps/, "scripts/validate.sh must run npm run audit:deps during validation");
