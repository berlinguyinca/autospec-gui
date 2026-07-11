#!/usr/bin/env bash
set -euo pipefail

required_files=(
  "AGENTS.md"
  "README.md"
  "package.json"
  "next.config.ts"
  "tsconfig.json"
  "app/layout.tsx"
  "app/page.tsx"
  "docs/specs/2026-07-11-autospec-gui-telemetry-dashboard-design.md"
)

for path in "${required_files[@]}"; do
  if [ ! -f "$path" ]; then
    echo "missing required file: $path" >&2
    exit 1
  fi
done

if grep -RInE 'TBD|TODO|FIXME|XXX' AGENTS.md README.md docs/specs app package.json next.config.ts tsconfig.json; then
  echo "placeholder text found" >&2
  exit 1
fi

node -e 'JSON.parse(require("fs").readFileSync("package.json", "utf8"))'

npm run lint
npm run typecheck
npm run test
npm run build

echo "validation passed"
