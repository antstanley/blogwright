/**
 * Build step: stamp dist/agent-manifest.json with the reproducible source hash.
 * Runs after the rolldown bundle (cwd = the build-agent package root), so the
 * shipped artifact set — Dockerfile, server.js, manifest — is self-describing
 * and the CLI needs no access to the source trees.
 */
import { writeFile } from 'node:fs/promises';

import { agentSourceHash } from './agent-hash.js';

const hash = await agentSourceHash(process.cwd());
await writeFile('dist/agent-manifest.json', `${JSON.stringify({ hash }, null, 2)}\n`);
console.log(`agent-manifest.json: ${hash}`);
