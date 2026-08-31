/*
 * Characterization tests for `status`, written before `readNodeStatus` is
 * extracted from it (task 15). They pin the exact lines `status` emits - in
 * both interactive and plain mode, including the read-failure path - against
 * a small fake node set standing in for the real (AWS-calling) production
 * graph `buildNodes(ctx)` returns. They must keep passing, unmodified, once
 * the per-node read loop moves into `readNodeStatus`.
 *
 * The fake node set is handed to `status` as a real argument - `status`'s
 * node set is a parameter (defaulting to `buildNodes(ctx)`), not a module
 * reached for internally - so no module or global is patched to isolate it
 * (see DEVELOPMENT.md: "Tests substitute at the port, not by patching
 * modules or globals").
 */

import {
  AwsError,
  colors,
  createMemoryFileSystem,
  createNodeFileSystem,
  createScriptedTerminal,
  findRepoRoot,
  stripColors,
  type Microvm,
  type ResourceNode,
  type S3Object,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import {
  assertNoScopedState,
  deploy,
  destroy,
  previewTeardown,
  readNodeStatus,
  status,
} from './commands.js';
import { cliPackageDir, type OpsContext } from './context.js';
import { destroyGraph } from './graph.js';
import { clearRunningMicrovms } from './microvms.js';
import { buildNodes } from './nodes.js';
import { createTestContext, TEST_AGENT_DIR } from './test-support.js';

/**
 * Three nodes - present, missing, and one whose `read` throws - small enough
 * to hand-verify every emitted line against, standing in for `buildNodes(ctx)`.
 */
function fakeNodes(): ResourceNode<OpsContext>[] {
  return [
    {
      id: 'state-bucket',
      dependsOn: [],
      title: 'state bucket',
      read: async () => true,
      create: async () => undefined,
      delete: async () => undefined,
    },
    {
      id: 'distribution',
      dependsOn: [],
      title: 'cloudfront distribution',
      read: async () => false,
      create: async () => undefined,
      delete: async () => undefined,
    },
    {
      id: 'iam-role',
      dependsOn: [],
      title: 'exec role',
      read: async () => {
        throw new Error('AccessDenied: iam:GetRole');
      },
      create: async () => undefined,
      delete: async () => undefined,
    },
  ];
}

/** Run `status` against the fake node set, capturing exactly what it logs. */
async function runStatus(interactive: boolean): Promise<{ info: string[]; warn: string[] }> {
  const info: string[] = [];
  const warn: string[] = [];
  const ctx = createTestContext({
    env: 'test',
    names: { bucket: 'test-bucket' },
    state: { resources: { 'state-bucket': { name: 'my-bucket' } } },
    ports: { terminal: createScriptedTerminal({ interactive }) },
    logger: {
      info: (msg) => info.push(msg),
      warn: (msg) => warn.push(msg),
    },
  });
  await status(ctx, fakeNodes());
  return { info: info.map(stripColors), warn: warn.map(stripColors) };
}

describe('status (interactive)', () => {
  it('renders the heading and a status tree: present, missing, and an error entry', async () => {
    const { info, warn } = await runStatus(true);

    expect(info).toEqual([
      'Status for "test" (bucket test-bucket)',
      '├─ ✓ state bucket {"name":"my-bucket"}',
      '├─ ◌ cloudfront distribution',
      '╰─ ✗ exec role AccessDenied: iam:GetRole',
    ]);
    expect(warn).toEqual([]);
  });

  it('reports a failed read as a tree entry carrying the exact error message', async () => {
    const { info } = await runStatus(true);

    expect(info.at(-1)).toBe('╰─ ✗ exec role AccessDenied: iam:GetRole');
  });
});

describe('status (plain)', () => {
  it('prints the heading and one line per node, plain form', async () => {
    const { info, warn } = await runStatus(false);

    expect(info).toEqual([
      'Status for "test" (bucket test-bucket)',
      '  present  state bucket {"name":"my-bucket"}',
      '  missing  cloudfront distribution ',
    ]);
    expect(warn).toEqual(['exec role: read failed (AccessDenied: iam:GetRole)']);
  });

  it('reports a failed read as a warning line carrying the exact error message', async () => {
    const { warn } = await runStatus(false);

    expect(warn).toEqual(['exec role: read failed (AccessDenied: iam:GetRole)']);
  });

  it('reconstructs the warning byte-identically even when the error message is empty', async () => {
    // The old code built this line inline, straight off the caught `err`:
    // `${node.title}: read failed (${(err as Error).message})`. The new code
    // rebuilds it from the returned StatusEntry's `detail`. Pin that the two
    // agree even at the edge - a message of '' - where a bug in the
    // reconstruction (e.g. `detail || 'unknown'`) would go unnoticed by every
    // other test here.
    const info: string[] = [];
    const warn: string[] = [];
    const ctx = createTestContext({
      env: 'test',
      names: { bucket: 'test-bucket' },
      ports: { terminal: createScriptedTerminal({ interactive: false }) },
      logger: {
        info: (msg) => info.push(msg),
        warn: (msg) => warn.push(msg),
      },
    });
    const nodes: ResourceNode<OpsContext>[] = [
      {
        id: 'blank-error',
        dependsOn: [],
        title: 'blank error node',
        read: async () => {
          throw new Error('');
        },
        create: async () => undefined,
        delete: async () => undefined,
      },
    ];

    await status(ctx, nodes);

    expect(warn).toEqual(['blank error node: read failed ()']);
  });
});

describe('status (default node set)', () => {
  it('falls back to the production graph (buildNodes(ctx)) when no node set is given', async () => {
    // No fake nodes here - this exercises the real `buildNodes(ctx)` default,
    // over a context whose AWS clients reject every call (createTestContext's
    // default). Some production nodes' read() consults recorded state before
    // ever calling AWS (so they resolve present/missing without touching the
    // client), others call AWS straight away (so they land in the reject-all
    // transport and come back as an error) - which nodes do which is
    // nodes.test.ts's concern, not this one. The point here is only that the
    // default parameter really does reach every node in the production
    // graph, the way every existing call site (no second argument) relies on.
    const info: string[] = [];
    const warn: string[] = [];
    const ctx = createTestContext({
      logger: {
        info: (msg) => info.push(msg),
        warn: (msg) => warn.push(msg),
      },
    });

    await status(ctx);

    expect(stripColors(info[0] ?? '')).toBe(`Status for "${ctx.env}" (bucket ${ctx.names.bucket})`);
    // One status line - present/missing (info) or a failed read (warn) - per
    // node in the real graph; the heading is the one `info` line that isn't one.
    expect(info.length - 1 + warn.length).toBe(buildNodes(ctx).length);
  });
});

describe('colors sanity (the pinned tests above strip colour to stay readable)', () => {
  it('the present/missing marks really are coloured in the raw (non-stripped) output', async () => {
    const info: string[] = [];
    const ctx = createTestContext({
      names: { bucket: 'test-bucket' },
      state: { resources: { 'state-bucket': { name: 'my-bucket' } } },
      ports: { terminal: createScriptedTerminal({ interactive: false }) },
      logger: { info: (msg) => info.push(msg) },
    });
    await status(ctx, fakeNodes());
    expect(info[1]).toBe(
      `  ${colors.green('present')}  state bucket ${colors.dim('{"name":"my-bucket"}')}`,
    );
  });
});

/*
 * `readNodeStatus` is the function task 15 extracts from `status` above, so
 * task 16's plugin `status` verb can hand it a plugin's own node set and
 * context instead of `buildNodes(ctx)` / `OpsContext`. These tests call it
 * directly - not through `status` - to pin that it (a) takes an arbitrary
 * node set and context, not just the CLI's production graph, and (b) is a
 * pure query: no logger writes, ever, even on the read-failure path.
 */
describe('readNodeStatus', () => {
  it('returns present/missing/error entries for an arbitrary node set', async () => {
    const ctx = createTestContext({
      state: { resources: { 'state-bucket': { name: 'my-bucket' } } },
    });

    const entries = await readNodeStatus(fakeNodes(), ctx);

    expect(entries).toEqual([
      { title: 'state bucket', state: 'present', detail: '{"name":"my-bucket"}' },
      { title: 'cloudfront distribution', state: 'missing', detail: undefined },
      { title: 'exec role', state: 'error', detail: 'AccessDenied: iam:GetRole' },
    ]);
  });

  it('never writes to the logger, on either the happy or the read-failure path', async () => {
    const info: string[] = [];
    const warn: string[] = [];
    const ctx = createTestContext({
      state: { resources: { 'state-bucket': { name: 'my-bucket' } } },
      logger: {
        info: (msg) => info.push(msg),
        warn: (msg) => warn.push(msg),
      },
    });

    await readNodeStatus(fakeNodes(), ctx);

    expect(info).toEqual([]);
    expect(warn).toEqual([]);
  });
});

/** One S3 object at `key`, with every other field a value the guard never reads. */
function s3Object(key: string): S3Object {
  return { key, size: 0, lastModified: undefined, etag: undefined };
}

/*
 * `assertNoScopedState` is the guard `destroy` (below) runs before
 * `destroyGraph(buildNodes(ctx), ctx)` - see its own doc comment for why:
 * scoping changes a state object's KEY, not the bucket, so the site's own
 * bucket node would otherwise empty a plugin's `state/<env>.<scope>.json`
 * along with everything else, orphaning every resource it records. These
 * tests pin it directly against a recording S3 client - task 16's own
 * definition of done asks that the refusal be asserted on the CLIENT, not
 * merely on the raised message.
 */
describe('assertNoScopedState', () => {
  function s3ListingContext(
    objects: S3Object[],
    env = 'production',
  ): { ctx: OpsContext; calls: string[] } {
    const calls: string[] = [];
    const ctx = createTestContext({
      env,
      names: { bucket: 'my-bucket' },
      clients: {
        s3: {
          listObjects: async (bucket, prefix) => {
            calls.push(`list ${bucket} ${prefix}`);
            return objects;
          },
        },
      },
    });
    return { ctx, calls };
  }

  it('resolves and lists exactly the "state/" prefix when only the site\'s own state object exists', async () => {
    const { ctx, calls } = s3ListingContext([s3Object('state/production.json')]);

    await expect(assertNoScopedState(ctx)).resolves.toBeUndefined();
    expect(calls).toEqual(['list my-bucket state/']);
  });

  it('resolves when the bucket has no state objects at all (a not-yet-bootstrapped environment)', async () => {
    const { ctx, calls } = s3ListingContext([]);

    await expect(assertNoScopedState(ctx)).resolves.toBeUndefined();
    expect(calls).toEqual(['list my-bucket state/']);
  });

  it('refuses, naming the scope and its own teardown verb, when one scoped state object exists', async () => {
    const { ctx, calls } = s3ListingContext([
      s3Object('state/production.json'),
      s3Object('state/production.analytics.json'),
    ]);

    await expect(assertNoScopedState(ctx)).rejects.toThrow(
      /analytics.*run `blogwright analytics destroy production --yes` first/s,
    );
    // The guard itself never issues anything but the one listing call.
    expect(calls).toEqual(['list my-bucket state/']);
  });

  it('names every scope, sorted, when more than one plugin still has state', async () => {
    const { ctx } = s3ListingContext([
      s3Object('state/production.json'),
      s3Object('state/production.pds.json'),
      s3Object('state/production.analytics.json'),
    ]);

    let message = '';
    await assertNoScopedState(ctx).catch((err: unknown) => {
      message = (err as Error).message;
    });
    expect(message).toContain('run `blogwright analytics destroy production --yes` first');
    expect(message).toContain('run `blogwright pds destroy production --yes` first');
    // Deterministic order regardless of the listing's own order.
    expect(message.indexOf('analytics')).toBeLessThan(message.indexOf('pds'));
  });

  it('ignores an object for a different environment under the same prefix', async () => {
    const { ctx, calls } = s3ListingContext([s3Object('state/staging.analytics.json')]);

    await expect(assertNoScopedState(ctx)).resolves.toBeUndefined();
    expect(calls).toEqual(['list my-bucket state/']);
  });

  /*
   * The remedy has to carry the ENVIRONMENT, not just the scope. A plugin
   * command resolves its own environment as `values.env ?? envPositional ??
   * DEFAULT_ENV` with `DEFAULT_ENV = 'production'` (`plugin-commands.ts`), so
   * an env-less `blogwright analytics destroy --yes` targets production
   * wherever it is printed. Against a refusal on any other environment that
   * is the wrong stack: at best it loads empty state and removes nothing,
   * leaving the operator stuck in this very refusal; at worst it tears down
   * the live production one. `preview` is the case that is ALWAYS wrong,
   * because `runPreview` builds `env: 'preview'` unconditionally
   * (`cli.ts`) - it can never coincide with the default.
   *
   * These assertions pin the WHOLE command, so dropping `${ctx.env}` back out
   * of the interpolation fails them; asserting only that the scope is named
   * would pass on the broken form just as well as on the fixed one.
   */
  it("names the environment being torn down, not the plugin verb's production default", async () => {
    const { ctx } = s3ListingContext([s3Object('state/preview.analytics.json')], 'preview');

    let message = '';
    await assertNoScopedState(ctx).catch((err: unknown) => {
      message = (err as Error).message;
    });
    expect(message).toContain('run `blogwright analytics destroy preview --yes` first');
    // The env-less form would silently mean production, which belongs
    // nowhere in a refusal raised over the preview environment.
    expect(message).not.toContain('production');
  });
});

/** The id the delivery source in {@link fullDestroyContext} reports for the site's own delivery. */
const OWN_DELIVERY_ID = 'site-own-delivery';

/**
 * A full, empty-state run of `buildNodes(ctx)`'s production graph through
 * `destroy` - not a fake node set, because the guard's own definition of
 * done requires the SITE verb's real call sequence, unchanged apart from
 * the guard's own `listObjects`. With state empty (the default
 * `createTestContext`), every node whose `delete()` is conditioned on a
 * recorded output (the microvm image, the OAC, the distribution) skips its
 * AWS call entirely - only the unconditional deletes below actually fire.
 */
function fullDestroyContext(
  scopedObjects: S3Object[],
  opts: {
    /** `preview: true` on the context - the shape `previewTeardown` runs against. */
    preview?: boolean;
    /** Raised by `listObjects` instead of answering, e.g. a bucket already deleted. */
    listFailure?: Error;
    /** Raised by the bucket node's own `deletePrefix`, as a missing bucket really would. */
    deletePrefixFailure?: Error;
    /** Environment name; the state key the store deletes is derived from it. */
    env?: string;
  } = {},
): { ctx: OpsContext; calls: string[] } {
  const calls: string[] = [];
  // Assigned from the derived names below, and read only when a delete
  // actually runs - so the site's own delivery carries the REAL destination
  // ARN this environment's node compares against, rather than a literal that
  // would keep matching if `deriveNames` changed shape underneath it.
  let ownDestinationArn = '';
  const ctx = createTestContext({
    env: opts.env ?? 'production',
    preview: opts.preview ?? false,
    names: { bucket: 'my-bucket' },
    ports: { terminal: createScriptedTerminal({ interactive: false }) },
    clients: {
      s3: {
        listObjects: async (bucket, prefix) => {
          calls.push(`s3.listObjects ${bucket} ${prefix}`);
          if (opts.listFailure) throw opts.listFailure;
          return scopedObjects;
        },
        deletePrefix: async (bucket, prefix) => {
          calls.push(`s3.deletePrefix ${bucket} ${prefix}`);
          if (opts.deletePrefixFailure) throw opts.deletePrefixFailure;
          return 0;
        },
        deleteBucket: async (bucket) => {
          calls.push(`s3.deleteBucket ${bucket}`);
        },
        putObject: async (bucket, key) => {
          calls.push(`s3.putObject ${key}`);
        },
        deleteObject: async (bucket, key) => {
          calls.push(`s3.deleteObject ${key}`);
        },
      },
      logs: {
        deleteLogGroup: async (name) => {
          calls.push(`logs.deleteLogGroup ${name}`);
        },
      },
      logsUsEast1: {
        deleteLogGroup: async (name) => {
          calls.push(`logsUsEast1.deleteLogGroup ${name}`);
        },
        // The site's own delivery, and nothing else. A delivery source is
        // shared - AWS permits exactly one per distribution - so the log
        // delivery node reads it before touching anything and refuses when it
        // carries a delivery pointed at some other stack's destination.
        // Answering with a delivery on THIS environment's destination
        // (`ownDestinationArn`, filled in below once the derived name exists)
        // runs that guard's proceed path. An empty list would also let the
        // teardown through, but by skipping the ownership comparison rather
        // than passing it - and would leave `deleteDelivery` unexercised.
        deliveriesForSource: async () => {
          calls.push('logsUsEast1.deliveriesForSource');
          return [{ id: OWN_DELIVERY_ID, deliveryDestinationArn: ownDestinationArn }];
        },
        deleteDelivery: async (id) => {
          calls.push(`logsUsEast1.deleteDelivery ${id}`);
        },
        deleteDeliverySource: async () => {
          calls.push('logsUsEast1.deleteDeliverySource');
        },
        deleteDeliveryDestination: async () => {
          calls.push('logsUsEast1.deleteDeliveryDestination');
        },
      },
      iam: {
        deleteRole: async (name) => {
          calls.push(`iam.deleteRole ${name}`);
        },
      },
      cloudfront: {
        deleteFunction: async (name) => {
          calls.push(`cloudfront.deleteFunction ${name}`);
        },
      },
      microvms: {
        listMicrovms: async (): Promise<Microvm[]> => [],
      },
    },
  });
  ownDestinationArn = `arn:aws:logs:us-east-1:123456789012:delivery-destination:${ctx.names.deliveryDestination}`;
  return { ctx, calls };
}

describe('destroy', () => {
  it('refuses without --yes and makes no client call at all', async () => {
    const { ctx, calls } = fullDestroyContext([]);

    await expect(destroy(ctx, { yes: false })).rejects.toThrow(
      'refusing to destroy "production" without --yes',
    );
    expect(calls).toEqual([]);
  });

  it('refuses while a plugin state object exists, issuing no delete at all', async () => {
    const { ctx, calls } = fullDestroyContext([
      s3Object('state/production.json'),
      s3Object('state/production.analytics.json'),
    ]);

    await expect(destroy(ctx, { yes: true })).rejects.toThrow(
      'run `blogwright analytics destroy production --yes` first',
    );
    // The guard's own listing is the ONLY call this run makes - in
    // particular, no deletePrefix/deleteBucket/deleteObject: the bucket
    // (and the plugin's own state object living in it) is untouched.
    expect(calls).toEqual(['s3.listObjects my-bucket state/']);
  });

  it('proceeds exactly as before the guard when no scoped state object exists', async () => {
    const { ctx, calls } = fullDestroyContext([s3Object('state/production.json')]);

    await destroy(ctx, { yes: true });

    // The guard's listing is the one call the guard itself adds, first;
    // every call after it is `destroy`'s own pre-existing sequence -
    // microvm listing, then each node's delete (in reverse dependency
    // order) interleaved with the state save after each, then the site's
    // own state object deleted last. The delivery-source read that now
    // follows the listing belongs to THAT sequence, not to this guard: it is
    // the log delivery node's own ownership check, pinned separately below.
    expect(calls[0]).toBe('s3.listObjects my-bucket state/');
    expect(calls.at(-1)).toBe('s3.deleteObject state/production.json');
    // The graph's own deletes genuinely ran - the guard did not swallow them.
    expect(calls).toContain('s3.deletePrefix my-bucket '); // bucketNode.delete's deletePrefix(bucket, '')
    expect(calls).toContain('s3.deleteBucket my-bucket');
    expect(calls).toContain(`iam.deleteRole ${ctx.names.buildRole}`);
    expect(calls).toContain(`iam.deleteRole ${ctx.names.execRole}`);
    expect(calls).toContain(`logs.deleteLogGroup ${ctx.names.microvmLogGroup}`);
    expect(calls).toContain(`logsUsEast1.deleteLogGroup ${ctx.names.cloudfrontLogGroup}`);
    expect(calls).toContain(`cloudfront.deleteFunction ${ctx.names.prefix}-router`);
    expect(calls).toContain('logsUsEast1.deleteDeliverySource');
    expect(calls).toContain('logsUsEast1.deleteDeliveryDestination');
    // The log delivery node's calls in full, as a SEQUENCE rather than a set.
    // `deliveriesForSource` is the ownership read the node makes before it
    // deletes anything, and its position is the whole point of it: AWS rejects
    // `DeleteDeliverySource` while a delivery is still attached, so a read
    // placed after either delete - or dropped entirely - would not be a guard.
    // The `toContain`s above pass either way; this does not.
    expect(
      calls.filter((call) => /^logsUsEast1\.(deliveriesForSource|deleteDelivery)/.test(call)),
    ).toEqual([
      'logsUsEast1.deliveriesForSource',
      `logsUsEast1.deleteDelivery ${OWN_DELIVERY_ID}`,
      'logsUsEast1.deleteDeliverySource',
      'logsUsEast1.deleteDeliveryDestination',
    ]);
    // Every production node, and no plugin node - the guard neither adds
    // nor removes any of the site's own graph.
    expect(buildNodes(ctx)).toHaveLength(11);
  });

  /*
   * The recovery path: a teardown interrupted after the bucket node ran
   * leaves an environment whose bucket is gone but whose roles, log groups,
   * CloudFront function and delivery trio are not. `listObjects` does NOT
   * swallow a 404 the way `getObjectText` does, so a guard that let
   * `NoSuchBucket` propagate would refuse to clean any of them up - causing
   * exactly the orphaning it exists to prevent. See `assertNoScopedState`'s
   * doc comment for the decision.
   */
  function bucketGone(): AwsError {
    return new AwsError({
      service: 's3',
      code: 'NoSuchBucket',
      message: 'The specified bucket does not exist',
      statusCode: 404,
    });
  }

  it('treats an already-deleted bucket as no scoped state, and still tears down every non-bucket resource', async () => {
    // Faithful to the real thing: with the bucket gone, its own node's
    // `deletePrefix` fails too - and always did, guard or no guard. What
    // must not change is everything that happens BEFORE it.
    const { ctx, calls } = fullDestroyContext([], {
      listFailure: bucketGone(),
      deletePrefixFailure: bucketGone(),
    });

    await expect(destroy(ctx, { yes: true })).rejects.toThrow('NoSuchBucket');

    // The eight non-bucket resources are gone - the pre-guard outcome,
    // restored. (The bucket node is last in reverse dependency order, so
    // its failure comes after all of them.)
    expect(calls).toContain(`iam.deleteRole ${ctx.names.buildRole}`);
    expect(calls).toContain(`iam.deleteRole ${ctx.names.execRole}`);
    expect(calls).toContain(`logs.deleteLogGroup ${ctx.names.microvmLogGroup}`);
    expect(calls).toContain(`logsUsEast1.deleteLogGroup ${ctx.names.cloudfrontLogGroup}`);
    expect(calls).toContain(`cloudfront.deleteFunction ${ctx.names.prefix}-router`);
    expect(calls).toContain('logsUsEast1.deleteDeliverySource');
    expect(calls).toContain('logsUsEast1.deleteDeliveryDestination');
    // The delivery is the eighth of them, and the first of its trio to go -
    // both the source and the destination are referenced by it. It is deleted
    // by id, from the ownership read the node makes before touching anything;
    // drop that read and this call disappears with it.
    expect(calls).toContain(`logsUsEast1.deleteDelivery ${OWN_DELIVERY_ID}`);
    // The guard ran first and got out of the way, rather than aborting ahead
    // of `clearRunningMicrovms`.
    expect(calls[0]).toBe('s3.listObjects my-bucket state/');
    expect(calls.at(-1)).toBe('s3.deletePrefix my-bucket ');
  });

  it('still propagates a listing failure that is NOT a missing bucket, deleting nothing', async () => {
    // A denied (or throttled) listing says nothing about whether scoped
    // state exists, so it must not be read as "clear" - only a not-found is.
    const denied = new AwsError({
      service: 's3',
      code: 'AccessDenied',
      message: 'Access Denied',
      statusCode: 403,
    });
    const { ctx, calls } = fullDestroyContext([], { listFailure: denied });

    await expect(destroy(ctx, { yes: true })).rejects.toThrow('AccessDenied');
    expect(calls).toEqual(['s3.listObjects my-bucket state/']);
  });

  it('propagates a 404 that is not a missing bucket, rather than reading it as "no scoped state"', async () => {
    // The clear-the-guard path matches `NoSuchBucket` specifically, not
    // `AwsError`'s broad `isNotFound` - which is equally true of `NoSuchKey`
    // and of ANY 404. A non-AWS, S3-compatible endpoint (`--endpoint`)
    // answering a listing with a spurious 404 must not be read as an empty
    // bucket: that would let the teardown empty a bucket whose plugin state
    // object is alive, which is precisely what the guard exists to stop.
    const spurious404 = new AwsError({
      service: 's3',
      code: 'NoSuchKey',
      message: 'The specified key does not exist',
      statusCode: 404,
    });
    const { ctx, calls } = fullDestroyContext([], { listFailure: spurious404 });

    await expect(destroy(ctx, { yes: true })).rejects.toThrow('NoSuchKey');
    expect(calls).toEqual(['s3.listObjects my-bucket state/']);
  });
});

/*
 * `previewTeardown` is the site teardown's own graph over the preview
 * environment's bucket - the same `destroyGraph(buildNodes(ctx), ctx)`, the
 * same `bucketNode().delete()` emptying every prefix - so a plugin
 * bootstrapped against the preview environment is orphaned by it in exactly
 * the way `destroy` above is guarded against. These pin the guard on the
 * SIBLING verb, on the client rather than on a printed message.
 */
describe('previewTeardown', () => {
  const PREVIEW_ENV = 'preview';

  function previewContext(scopedObjects: S3Object[]): { ctx: OpsContext; calls: string[] } {
    return fullDestroyContext(scopedObjects, { preview: true, env: PREVIEW_ENV });
  }

  it('refuses without --yes and makes no client call at all', async () => {
    const { ctx, calls } = previewContext([]);

    await expect(previewTeardown(ctx, { yes: false })).rejects.toThrow(
      'refusing to tear down the preview stack without --yes',
    );
    expect(calls).toEqual([]);
  });

  it('refuses while a plugin state object exists, issuing no delete at all', async () => {
    const { ctx, calls } = previewContext([
      s3Object(`state/${PREVIEW_ENV}.json`),
      s3Object(`state/${PREVIEW_ENV}.analytics.json`),
    ]);

    // Caught rather than matched, so the ONE run below is the only one this
    // test performs - the call assertion at the end depends on it.
    let message = '';
    await previewTeardown(ctx, { yes: true }).catch((err: unknown) => {
      message = (err as Error).message;
    });

    // The remedy names THIS environment. `previewTeardown` always runs with
    // `env: 'preview'`, while a plugin's own `destroy` falls back to
    // `DEFAULT_ENV = 'production'` - so the env-less form printed here would
    // point the operator at the production stack. This is the one case where
    // the default can never accidentally be right. See `assertNoScopedState`.
    expect(message).toContain(`run \`blogwright analytics destroy ${PREVIEW_ENV} --yes\` first`);
    expect(message).not.toContain('production');
    // The guard's own listing is the ONLY call this run makes. No
    // deletePrefix/deleteBucket/deleteObject in particular: the preview
    // bucket - and the plugin's own state object inside it - is untouched.
    expect(calls).toEqual(['s3.listObjects my-bucket state/']);
  });

  it('adds exactly one listObjects at the head and nothing else when no plugin state exists', async () => {
    // Proven by EQUIVALENCE, not by inspection: run the un-guarded body
    // (`clearRunningMicrovms` -> `destroyGraph(buildNodes(ctx))` ->
    // `store.delete()`, exactly what `previewTeardown` does after the guard)
    // against an identical recording context, then require the guarded
    // verb's calls to be that same sequence with one listing prepended.
    const baseline = previewContext([]);
    expect(await clearRunningMicrovms(baseline.ctx)).toBe(true);
    await destroyGraph(buildNodes(baseline.ctx), baseline.ctx);
    await baseline.ctx.store.delete();

    const { ctx, calls } = previewContext([s3Object(`state/${PREVIEW_ENV}.json`)]);
    await previewTeardown(ctx, { yes: true });

    expect(calls).toEqual(['s3.listObjects my-bucket state/', ...baseline.calls]);
    // Not a vacuous comparison: the preview graph genuinely tore itself down.
    expect(calls).toContain('s3.deleteBucket my-bucket');
    // ...including the log delivery node's ownership read and the delete it
    // authorises. The equality above is blind to both by construction: the
    // baseline runs the same node, so dropping the read would shorten the two
    // sides alike and still compare equal. These two lines are what notice.
    expect(calls).toContain('logsUsEast1.deliveriesForSource');
    expect(calls).toContain(`logsUsEast1.deleteDelivery ${OWN_DELIVERY_ID}`);
    expect(calls.at(-1)).toBe(`s3.deleteObject state/${PREVIEW_ENV}.json`);
    // The preview graph, unchanged by the guard: the production eleven plus
    // the wildcard DNS record and the preview GitHub OIDC role.
    expect(buildNodes(ctx)).toHaveLength(13);
  });
});

/*
 * TASK 29 - the post-deploy PDS sync, which the removal of `cli.ts`'s
 * hardcoded `pds` branch must leave untouched.
 *
 * `deploy` reaches `syncAfterDeploy` through the static import at the top of
 * `commands.ts` (see the comment there for why it stays), not through plugin
 * dispatch - the SPI has no lifecycle hook it could be registered on. That
 * makes it the one pds code path in the CLI with no dispatch test behind it,
 * and the one a reader of task 29's diff would most reasonably assume had
 * been migrated away. It has not been, and these cases say so by running the
 * real `deploy` end to end against stubbed ports and clients.
 *
 * The observable is `syncAfterDeploy`'s own "not initialised" line: it is
 * emitted only past BOTH of that function's guards (`ctx.env !==
 * 'production' || !ctx.config.pds` returns before it), and the memory
 * filesystem below carries no `atproto.json`, so a repo that has configured
 * the block but never run `pds init` is exactly the state that produces it.
 * Nothing is asserted about a real PDS: the point is which code the deploy
 * reaches, not what it would publish.
 */
describe('deploy reaches syncAfterDeploy', () => {
  const HASH = 'abc123';
  /** The agent bundle's own content hash, read from `agent-manifest.json`. */
  const AGENT_HASH = '0123456789ab';
  /** `syncAfterDeploy`'s line for a configured-but-uninitialised production site. */
  const NOT_INITIALISED =
    'standard.site publishing not initialised (`blogwright pds init`) - skipping';

  /**
   * Run the real `deploy` to completion. Every AWS call is answered by a
   * stub client and every file read by an in-memory filesystem - the same
   * substitution `deploy.test.ts`'s own `runBuild` fixture makes, extended
   * far enough forward to reach the post-deploy sync. The builder image is
   * seeded as already current (`builderImageAction` returns `skip`), the
   * build's completion artifact is present (`objectExists` - `pollBuild`'s
   * authoritative done signal), and the changed-paths manifest is empty, so
   * no CloudFront invalidation is attempted either.
   */
  async function runDeploy(opts: { env: string; pds: boolean }): Promise<string[]> {
    const repoRoot = await findRepoRoot(createNodeFileSystem());
    const fs = createMemoryFileSystem({
      [`${repoRoot}/.jj`]: '',
      [`${repoRoot}/README.md`]: '# example',
      [`${TEST_AGENT_DIR}/Dockerfile`]: 'FROM scratch',
      [`${TEST_AGENT_DIR}/server.js`]: 'export {};',
      [`${TEST_AGENT_DIR}/agent-manifest.json`]: JSON.stringify({ hash: AGENT_HASH }),
    });
    const logged: string[] = [];
    const record = (msg: string) => logged.push(stripColors(msg));
    const ctx = createTestContext({
      env: opts.env,
      config: opts.pds ? { pds: { name: 'Example', secretName: 'example/atproto' } } : {},
      ports: {
        fs,
        terminal: createScriptedTerminal({ interactive: false }),
        vcs: {
          revisionHash: async () => HASH,
          listFiles: async () => ['README.md'],
        },
      },
      clients: {
        s3: {
          putObject: async () => undefined,
          deleteObject: async () => undefined,
          // pollBuild's completion signal: the build finished.
          objectExists: async () => true,
          getObjectText: async (_bucket: string, key: string) =>
            key === `build/changed/${HASH}.json` ? '{"paths":[]}' : undefined,
        },
        microvms: {
          getImage: async () => ({
            imageArn: 'arn:img',
            imageName: 'builder',
            state: 'CREATED',
            imageVersion: '1',
          }),
          runMicrovm: async () => ({
            microvmId: 'vm-1',
            state: 'PENDING',
            endpoint: 'http://vm',
          }),
          getMicrovm: async () => ({
            microvmId: 'vm-1',
            state: 'RUNNING',
            endpoint: 'http://vm',
          }),
          createAuthToken: async () => 'tok',
          terminateMicrovm: async () => undefined,
        },
        logs: { filterEvents: async () => [] },
      },
      logger: { info: record, step: record, ok: record, warn: record },
    });
    // Seeded after construction because two of the three depend on names the
    // context itself derives: an image recorded as current for THIS agent
    // bundle and THIS log group is what makes `reconcileBuilderImage` skip.
    ctx.state.resources['microvm-image'] = {
      arn: 'arn:img',
      agentHash: AGENT_HASH,
      logGroup: ctx.names.microvmLogGroup,
    };
    ctx.state.resources['iam-build-role'] = { arn: 'arn:build' };
    ctx.state.resources['iam-exec-role'] = { arn: 'arn:role' };

    await deploy(ctx);
    return logged;
  }

  it('runs the sync for production with a pds block', async () => {
    const logged = await runDeploy({ env: 'production', pds: true });

    expect(logged).toContain(NOT_INITIALISED);
    // And the deploy itself completed - the line is from the post-deploy
    // step, not from a run that fell over before reaching it. Raw, with no
    // `✓` prefix: `createTestContext` takes a plain object logger, and the
    // level glyphs are `createLogger`'s (`logger.ts`), a layer above.
    expect(logged.some((line) => line.startsWith(`deployed ${HASH} in `))).toBe(true);
  });

  it('skips the sync outside production, even with a pds block', async () => {
    const logged = await runDeploy({ env: 'staging', pds: true });

    expect(logged).not.toContain(NOT_INITIALISED);
    expect(logged.some((line) => line.startsWith(`deployed ${HASH} in `))).toBe(true);
  });

  it('skips the sync for production when the site configures no pds block', async () => {
    const logged = await runDeploy({ env: 'production', pds: false });

    expect(logged).not.toContain(NOT_INITIALISED);
    expect(logged.some((line) => line.startsWith(`deployed ${HASH} in `))).toBe(true);
  });

  it('keeps blogwright-pds a non-optional dependency of the CLI package', async () => {
    // The other half of the guarantee: the static import above can only be
    // relied on while the package ships with the CLI. A move to
    // `optionalDependencies`, `peerDependencies` or `devDependencies` would
    // leave `deploy` importing something a consuming install need not have -
    // and would equally stop the bundled plugin from being discovered at all
    // (`plugins.test.ts`'s real-disk case resolves it from `cliPackageDir()`'s
    // own `dependencies`).
    const manifest = JSON.parse(
      await createNodeFileSystem().readText(`${cliPackageDir()}/package.json`),
    ) as Record<string, Record<string, string> | undefined>;

    expect(manifest.dependencies?.['blogwright-pds']).toBe('workspace:*');
    expect(manifest.optionalDependencies?.['blogwright-pds']).toBeUndefined();
    expect(manifest.peerDependencies?.['blogwright-pds']).toBeUndefined();
    expect(manifest.devDependencies?.['blogwright-pds']).toBeUndefined();
  });
});
