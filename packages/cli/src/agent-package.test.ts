import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { createMemoryFileSystem } from 'blogwright-core';

import { packageAndUploadAgent } from './agent-package.js';
import { createTestContext, TEST_AGENT_DIR } from './test-support.js';

const AGENT_HASH = 'abc123def456';
const DOCKERFILE = 'FROM node:24-slim\nCOPY server.js /srv/server.js\n';
const SERVER_JS = 'export const answer = 42;\n';

function agentArtifacts(manifest: string): Record<string, string> {
  return {
    [`${TEST_AGENT_DIR}/Dockerfile`]: DOCKERFILE,
    [`${TEST_AGENT_DIR}/server.js`]: SERVER_JS,
    [`${TEST_AGENT_DIR}/agent-manifest.json`]: manifest,
  };
}

interface RecordedPut {
  bucket: string;
  key: string;
  body: string | Uint8Array;
  contentType: string | undefined;
}

function contextWithArtifacts(manifest: string) {
  const puts: RecordedPut[] = [];
  const ctx = createTestContext({
    ports: { fs: createMemoryFileSystem(agentArtifacts(manifest)) },
    clients: {
      s3: {
        putObject: async (bucket, key, body, contentType) => {
          puts.push({ bucket, key, body, contentType });
        },
      },
    },
  });
  return { ctx, puts };
}

describe('packageAndUploadAgent', () => {
  it('zips the artifacts and uploads them under the manifest hash', async () => {
    const { ctx, puts } = contextWithArtifacts(JSON.stringify({ hash: AGENT_HASH }));

    const artifact = await packageAndUploadAgent(ctx);

    expect(artifact).toEqual({ key: `build/agent/agent-${AGENT_HASH}.zip`, hash: AGENT_HASH });
    expect(puts).toHaveLength(1);
    const put = puts[0]!;
    expect(put.bucket).toBe(ctx.names.bucket);
    expect(put.key).toBe(`build/agent/agent-${AGENT_HASH}.zip`);
    expect(put.contentType).toBe('application/zip');

    const entries = unzipSync(put.body as Uint8Array);
    expect(Object.keys(entries).sort()).toEqual(['Dockerfile', 'package.json', 'server.js']);
    expect(strFromU8(entries['Dockerfile']!)).toBe(DOCKERFILE);
    expect(strFromU8(entries['server.js']!)).toBe(SERVER_JS);
    expect(JSON.parse(strFromU8(entries['package.json']!))).toEqual({
      name: 'site-builder',
      private: true,
      type: 'module',
    });
  });

  it('fails with the directory and the build remedy when the artifacts are absent', async () => {
    const ctx = createTestContext(); // empty in-memory fs: nothing under /agent

    await expect(packageAndUploadAgent(ctx)).rejects.toThrow(
      `build-agent artifacts not found in ${TEST_AGENT_DIR}. ` +
        'Run "pnpm --filter blogwright build" first.',
    );
  });

  it('names the injected agent directory when artifacts are missing there', async () => {
    const ctx = createTestContext({ agentDir: '/elsewhere/agent' });

    await expect(packageAndUploadAgent(ctx)).rejects.toThrow(
      'build-agent artifacts not found in /elsewhere/agent',
    );
  });

  it('fails with the directory and the rebuild remedy when the manifest has no hash', async () => {
    const { ctx } = contextWithArtifacts(JSON.stringify({}));

    await expect(packageAndUploadAgent(ctx)).rejects.toThrow(
      `agent-manifest.json in ${TEST_AGENT_DIR} has no valid hash — rebuild the agent`,
    );
  });

  it('rejects a malformed manifest hash', async () => {
    const { ctx, puts } = contextWithArtifacts(JSON.stringify({ hash: 'NOT-A-HEX-KEY' }));

    await expect(packageAndUploadAgent(ctx)).rejects.toThrow(/has no valid hash/);
    expect(puts).toHaveLength(0); // nothing was uploaded
  });
});
