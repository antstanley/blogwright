import { createServer, type ServerResponse } from 'node:http';

import {
  createAgentS3,
  fetchPendingJobs,
  runBuild,
  type BuildPayload,
  type PendingJob,
} from './build.js';

const PORT = Number(process.env.PORT ?? 8080);
const BUCKET = process.env.BUILD_BUCKET;
const REGION = process.env.BUILD_REGION ?? 'us-east-1';

type BuildState = 'idle' | 'building' | 'done' | 'failed';
const status: { state: BuildState; hash: string | undefined } = { state: 'idle', hash: undefined };
const s3 = BUCKET ? createAgentS3(REGION) : undefined;
// Hashes already built by this MicroVM, so the queue drains without rebuilding a job.
const processed = new Set<string>();
// Counter (not a one-shot flag) so diagnostics still fire at RUNTIME after the snapshot.
let pollCount = 0;

function record(line: string): void {
  console.log(line); // → CloudWatch (/aws/lambda/microvms/<image-name>); the CLI tails this
}

function credsLine(): string {
  const container = Boolean(
    process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI ??
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI,
  );
  return `[creds:poll] env=${Boolean(process.env.AWS_ACCESS_KEY_ID)} session=${Boolean(process.env.AWS_SESSION_TOKEN)} container=${container}`;
}

function startBuild(payload: BuildPayload): void {
  if (!s3 || status.state === 'building') return;
  status.state = 'building';
  status.hash = payload.hash;
  record(`build started for ${payload.hash}`);
  runBuild(s3, payload, record)
    .then(() => record(`##build:done:${payload.hash}`))
    .catch((err: unknown) =>
      record(`##build:failed:${payload.hash}: ${err instanceof Error ? err.message : String(err)}`),
    )
    .finally(() => {
      // Return to idle so a completed build can't disable the agent. This matters if a
      // build ever runs during image bake: without the reset, the snapshot would freeze
      // status.state !== 'idle' and every resumed MicroVM's poll() would short-circuit.
      status.state = 'idle';
      status.hash = undefined;
    });
}

/**
 * Poll s3://<bucket>/build/pending/ for jobs (the build trigger). Drains one unbuilt job
 * per tick — multiple targets (concurrent PR previews) each have their own key. The
 * MicroVM's ambient IMDS credentials are the build role, which holds the site-write perms.
 */
let polling = false;

async function poll(): Promise<void> {
  // The re-entrancy guard closes a check-then-act race: without it, a slow
  // fetchPendingJobs lets a second interval tick pass the idle check, and the
  // loser's job would be marked processed while startBuild refuses to run it.
  if (polling || !s3 || !BUCKET || status.state !== 'idle') return;
  polling = true;
  try {
    pollCount += 1;
    const diag = pollCount % 10 === 1;
    if (diag) record(credsLine());
    let jobs: PendingJob[];
    try {
      jobs = await fetchPendingJobs(s3, BUCKET);
    } catch (err) {
      if (diag) record(`[poll] error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const next = jobs.find((j) => !processed.has(j.hash));
    if (!next || status.state !== 'idle') return;
    processed.add(next.hash);
    startBuild({
      hash: next.hash,
      sourceKey: next.sourceKey,
      sitePrefix: next.sitePrefix ?? 'site/',
      bucket: BUCKET,
      region: REGION,
      appDir: next.appDir,
      distDir: next.distDir,
      robots: next.robots,
      sitemapBaseUrl: next.sitemapBaseUrl,
      objectTags: next.objectTags,
      refresh: next.refresh,
    });
  } finally {
    polling = false;
  }
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Minimal HTTP server (keeps the process alive; answers any probe). Build coordination
// is via S3 (trigger) + CloudWatch (status), so the endpoint is not on the critical path.
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  if (path === '/status') return json(res, 200, status);
  json(res, 200, { ok: true });
});
server.on('clientError', (_err, socket) => socket.destroy());
process.on('uncaughtException', (err) => console.log(`[uncaught] ${String(err?.stack ?? err)}`));
process.on('unhandledRejection', (err) => console.log(`[unhandledRejection] ${String(err)}`));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`build-agent up on 0.0.0.0:${PORT} (bucket=${BUCKET ?? 'unset'} region=${REGION})`);
  setInterval(() => void poll(), 3000);
});
