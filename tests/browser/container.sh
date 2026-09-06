#!/usr/bin/env bash
# Run inside the pinned Playwright image with source mounted read-only at /source.
set -euo pipefail
mkdir -p /work
cd /source
tar --exclude=node_modules --exclude=.git --exclude=.jj --exclude=.codegraph --exclude=test-results --exclude=playwright-report -cf - . | tar -xf - -C /work
cd /work
npm install -g pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm "$@"
