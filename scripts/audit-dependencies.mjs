import { spawnSync } from "node:child_process";

const auditArgs = ["audit", "--omit=dev", "--audit-level=high", "--json"];
const result = spawnSync("npm", auditArgs, {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

const command = `npm ${auditArgs.join(" ")}`;

function parseAuditJson(output) {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

const audit = parseAuditJson(result.stdout);
const high = audit?.metadata?.vulnerabilities?.high ?? 0;
const critical = audit?.metadata?.vulnerabilities?.critical ?? 0;

if (result.status === 0) {
  console.log(`dependency audit passed (${command})`);
  process.exit(0);
}

if (high > 0 || critical > 0) {
  console.error(`dependency audit failed: ${high} high and ${critical} critical production vulnerabilities found`);
  console.error(`command: ${command}`);
  process.exit(1);
}

console.error(`dependency audit could not complete: ${command}`);
if (result.error) {
  console.error(result.error.message);
}
if (result.stderr.trim()) {
  console.error(result.stderr.trim());
}
if (result.stdout.trim()) {
  console.error(result.stdout.trim());
}
process.exit(result.status ?? 1);
