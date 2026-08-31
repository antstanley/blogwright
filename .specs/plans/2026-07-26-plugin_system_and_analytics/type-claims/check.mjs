#!/usr/bin/env node
/**
 * Runs the type-claim gate: compiles transcriptions.ts + claims.ts with the
 * repo's own TypeScript against tsconfig.json here (which extends the root
 * tsconfig.base.json), and on failure names the claim nearest each error.
 *
 * Exit 0: every claim held. Exit 1: at least one claim broke (output names
 * it). Exit 2: the compiler itself could not run. No network, no AWS.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

// The repo's own TypeScript - resolved from packages/cli, never a global one.
const requireFromCli = createRequire(join(repoRoot, 'packages/cli/package.json'));
let tscJs;
try {
  tscJs = requireFromCli.resolve('typescript/lib/tsc.js');
} catch {
  console.error('FAIL: could not resolve typescript from packages/cli - run pnpm install first.');
  process.exit(2);
}

const claimFiles = ['transcriptions.ts', 'claims.ts'];

function claimStats() {
  let total = 0;
  let expectClean = 0;
  let expectError = 0;
  for (const file of claimFiles) {
    const text = readFileSync(join(here, file), 'utf8');
    for (const line of text.split('\n')) {
      if (!/^\s*\/\/ CLAIM C\d+/.test(line)) continue;
      total += 1;
      if (/expects clean/.test(line)) expectClean += 1;
      else expectError += 1;
    }
  }
  return { total, expectClean, expectError };
}

/** The nearest `// CLAIM …` line at or above `lineNo` (1-based) in `file`. */
function nearestClaim(file, lineNo) {
  const lines = readFileSync(join(here, file), 'utf8').split('\n');
  for (let i = Math.min(lineNo, lines.length) - 1; i >= 0; i -= 1) {
    const match = lines[i].match(/^\s*\/\/ (CLAIM C\d+.*)$/);
    if (match) return match[1];
  }
  return '(no claim comment above this line)';
}

const result = spawnSync(process.execPath, [tscJs, '-p', 'tsconfig.json', '--pretty', 'false'], {
  cwd: here,
  encoding: 'utf8',
});

if (result.error) {
  console.error(`FAIL: could not run tsc: ${String(result.error)}`);
  process.exit(2);
}

const stats = claimStats();

if (result.status === 0) {
  console.log(
    `PASS: ${stats.total} claims held ` +
      `(${stats.expectClean} compiled positives, ${stats.expectError} pinned compile-errors) ` +
      `against the repo's TypeScript.`,
  );
  process.exit(0);
}

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
const errorLine = /^(.+?)\((\d+),(\d+)\): (error TS\d+: .*)$/;
const broken = new Map();
let unparsed = '';

for (const line of output.split('\n')) {
  const match = line.match(errorLine);
  if (!match) {
    if (line.trim() !== '') unparsed += `${line}\n`;
    continue;
  }
  const [, file, lineNo, , message] = match;
  const claim = claimFiles.includes(file)
    ? nearestClaim(file, Number(lineNo))
    : `(outside the claim files: ${file})`;
  if (!broken.has(claim)) broken.set(claim, []);
  broken.get(claim).push(`  ${file}:${lineNo} ${message}`);
}

console.error(`FAIL: ${broken.size} claim(s) broke (of ${stats.total}):\n`);
for (const [claim, errors] of broken) {
  console.error(`BROKEN ${claim}`);
  for (const err of errors) console.error(err);
  console.error('');
}
if (unparsed.trim() !== '') {
  console.error('Compiler output not attributable to a claim:');
  console.error(unparsed);
}
console.error(
  'Each broken claim names the spec section or task it pins - that document ' +
    'now asserts a stale truth (or a transcription here is behind the spec). ' +
    'Fix the document or the transcription, never the claim alone.',
);
process.exit(1);
