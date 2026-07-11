/**
 * Build step: copy the built build-agent artifacts (Dockerfile, bundled server,
 * source-hash manifest) into this package's agent/ directory so the published
 * CLI is self-contained — at runtime it never reaches into sibling packages.
 */
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const agentSrc = fileURLToPath(new URL('../../build-agent', import.meta.url));
const dest = fileURLToPath(new URL('../agent', import.meta.url));

await mkdir(dest, { recursive: true });
for (const [from, to] of [
  ['Dockerfile', 'Dockerfile'],
  ['dist/server.js', 'server.js'],
  ['dist/agent-manifest.json', 'agent-manifest.json'],
]) {
  await cp(`${agentSrc}/${from}`, `${dest}/${to}`);
}
console.log(`copied build-agent artifacts to ${dest}`);
