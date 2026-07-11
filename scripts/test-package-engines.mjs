import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));

const declaredNodeEngine = packageJson.engines?.node;
assert.equal(
  typeof declaredNodeEngine,
  'string',
  'package.json must declare engines.node so supported Node versions are explicit',
);

const nextNodeEngine = packageLock.packages?.['node_modules/next']?.engines?.node;
assert.equal(
  typeof nextNodeEngine,
  'string',
  'package-lock.json must include the installed Next.js Node engine requirement',
);

const lowerBoundPattern = /^>=(\d+)\.(\d+)\.(\d+)$/;
const declaredLowerBound = lowerBoundPattern.exec(declaredNodeEngine);
assert.ok(
  declaredLowerBound,
  `engines.node must use an explicit >=major.minor.patch lower bound, got ${JSON.stringify(declaredNodeEngine)}`,
);

const nextLowerBound = lowerBoundPattern.exec(nextNodeEngine);
assert.ok(
  nextLowerBound,
  `Next.js Node engine must use an explicit >=major.minor.patch lower bound, got ${JSON.stringify(nextNodeEngine)}`,
);

const toVersionParts = (match) => match.slice(1).map(Number);
const compareVersions = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
};

assert.ok(
  compareVersions(toVersionParts(declaredLowerBound), toVersionParts(nextLowerBound)) >= 0,
  `engines.node ${declaredNodeEngine} must not claim support below Next.js requirement ${nextNodeEngine}`,
);

console.log(`package engines.node ${declaredNodeEngine} satisfies Next.js ${nextNodeEngine}`);
