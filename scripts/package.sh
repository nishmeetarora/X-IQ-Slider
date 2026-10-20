#!/usr/bin/env bash
# Builds dist/iq-slider-<version>.zip for the Chrome Web Store.
# Only runtime files go in; tests, the mock page and docs stay out.
set -euo pipefail
cd "$(dirname "$0")/.."

node dev/test.js > /dev/null
node dev/test-background.js > /dev/null

version=$(node -p "require('./manifest.json').version")
out="dist/iq-slider-$version.zip"
mkdir -p dist
rm -f "$out"
zip -qrX "$out" manifest.json LICENSE icons options src -x '*.DS_Store'
echo "Built $out"
unzip -l "$out" | tail -1
