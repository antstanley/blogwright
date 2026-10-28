#!/usr/bin/env node
/**
 * `pnpm size:check` / `pnpm size:update`, run from the repository root after
 * `pnpm build`. `check` fails when a published package's install size is above
 * its approved maximum in package-sizes.json; `update` rewrites that file with
 * the current sizes, for committing when an increase is intended.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createNpmRegistry } from './adapters/npm-registry.js';
import { createPnpmWorkspace } from './adapters/pnpm-workspace.js';
import {
  BASELINE_FILE,
  budgetPasses,
  compareToBaseline,
  parseBaseline,
  serializeBaseline,
  type Baseline,
} from './budget.js';
import { measureWorkspace } from './measure.js';
import { INSTALL_TARGET, targetLabel } from './platform.js';
import { APPROVAL_INSTRUCTIONS, formatReport } from './report.js';

const USAGE = 'usage: size-budget <check|update>';

async function main(command: string | undefined): Promise<number> {
  if (command !== 'check' && command !== 'update') {
    console.error(USAGE);
    return 2;
  }
  const root = process.cwd();
  if (!existsSync(join(root, 'pnpm-workspace.yaml'))) {
    throw new Error(`run from the repository root (no pnpm-workspace.yaml in ${root})`);
  }
  const baselinePath = join(root, BASELINE_FILE);
  const target = targetLabel(INSTALL_TARGET);
  const measurements = await measureWorkspace(
    {
      workspace: createPnpmWorkspace(root),
      registry: createNpmRegistry(process.env['npm_config_registry']),
    },
    INSTALL_TARGET,
  );

  if (command === 'update') {
    // Report against the maximums being replaced, so the change is visible before it is committed.
    const previous = existsSync(baselinePath) ? await readBaseline(baselinePath) : undefined;
    const replaced: Baseline =
      previous?.target === target ? previous : { target, maximums: new Map() };
    console.log(formatReport(compareToBaseline(measurements, replaced, target), target));
    await writeFile(baselinePath, serializeBaseline(measurements, target));
    console.log(`\nWrote ${BASELINE_FILE}. Commit it to approve these sizes.`);
    return 0;
  }

  const result = compareToBaseline(measurements, await readBaseline(baselinePath), target);
  console.log(formatReport(result, target));
  if (budgetPasses(result)) return 0;
  console.log(`\n${APPROVAL_INSTRUCTIONS}`);
  return 1;
}

async function readBaseline(path: string): Promise<Baseline> {
  if (!existsSync(path))
    throw new Error(`${BASELINE_FILE} does not exist - run pnpm size:update to create it`);
  return parseBaseline(await readFile(path, 'utf8'), BASELINE_FILE);
}

main(process.argv[2]).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`size-budget: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);
