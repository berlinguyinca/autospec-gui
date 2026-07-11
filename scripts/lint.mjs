import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const candidateFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const violations = [];

for (const path of candidateFiles) {
  const buffer = readFileSync(path);
  if (buffer.includes(0)) {
    continue;
  }

  const text = buffer.toString("utf8");
  if (text.includes("\r")) {
    violations.push(`${path}: contains carriage returns; use LF line endings`);
  }

  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (/[ \t]$/.test(line)) {
      violations.push(`${path}:${index + 1}: remove trailing whitespace`);
    }
  });
}

if (violations.length > 0) {
  console.error("lint failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(`lint passed (${candidateFiles.length} files checked)`);
