import { describe, expect, it } from 'vitest';

import {
  createClients,
  createMemoryFileSystem,
  deriveNames,
  emptyState,
  mergeConfig,
  StateStore,
  staticCredentials,
  type IamClient,
  type OpsConfig,
  type OpsState,
  type PdsConfig,
  type PluginContext,
  type PluginLogger,
  type ResourceOutputs,
  type Terminal,
  type Transport,
} from 'blogwright-core';

import { buildPdsNodes } from './nodes.js';

/**
 * The grant this node writes is *additive* on a role the site owns, so every
 * assertion here is made on what the IAM client was asked to do - never on a
 * return value or a log line alone. One ordered array records every call, so
 * "no other policy name was touched" is a property of the whole transcript
 * rather than of the one call a test remembered to look at.
 */
interface IamCall {
  op: 'listRolePolicies' | 'putRolePolicy' | 'deleteRolePolicy';
  roleName: string;
  policyName?: string | undefined;
  policy?: unknown;
}

/** The fixture's environment, unless a test names another one. */
const DEFAULT_ENV = 'test';
/** `deriveNames('test', …, { siteName: 'example' }).githubRole`. */
const ROLE = 'test-example-gh';
/** The site's own inline policy on the same role: present in every fixture, never this plugin's to touch. */
const SITE_POLICY = 'test-deploy';

const NOOP_LOGGER: PluginLogger = {
  info: () => undefined,
  step: () => undefined,
  ok: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const silentTerminal: Terminal = {
  isInteractive: false,
  write: () => undefined,
  error: () => undefined,
  status: () => undefined,
  question: async (prompt) => {
    throw new Error(`unexpected terminal prompt in test: ${prompt}`);
  },
};

/** Any AWS call this suite has not deliberately recorded is a defect, not a pass. */
const rejectAllTransport: Transport = async (req) => {
  throw new Error(`unexpected AWS request in test: ${req.method} ${req.url}`);
};

/**
 * A `pds` block for a fixture. The cast is the one this package cannot avoid
 * today: core still declares `secretName` as required, while a real config
 * file omits it and `mergeConfig` is what fills it in - and `mergeConfig`
 * validates the result on the very next line below.
 */
function pdsBlock(overrides: Partial<PdsConfig>): PdsConfig {
  return { name: 'Example', ...overrides } as PdsConfig;
}

interface NodeContextOverrides {
  /** The `pds` block, merged over `{ name: 'Example' }`. Absent means the site configures none. */
  pds?: Partial<PdsConfig> | undefined;
  /**
   * The environment the operator ran the lifecycle verb against. Defaults to
   * {@link DEFAULT_ENV}; the preview and staging tests below are the reason
   * this is settable at all.
   */
  env?: string | undefined;
  /** Merged over `{ siteName: 'example', githubRepo: 'antstanley/example' }`. */
  config?: Partial<OpsConfig> | undefined;
  /** The site's recorded outputs. Defaults to a bootstrapped stack - the deploy role's ARN present. */
  siteResources?: Record<string, ResourceOutputs> | undefined;
  /** Inline policies already on the deploy role. Defaults to the site's own. */
  policies?: string[] | undefined;
}

interface NodeFixture {
  ctx: PluginContext<PdsConfig>;
  /** The deploy role this fixture's environment derives - {@link ROLE} unless `env` was overridden. */
  role: string;
  /** Every IAM call the nodes made, in order. */
  calls: IamCall[];
  /** The role's live inline-policy names, as put/delete leave them. */
  policiesOn: () => string[];
  /** The plugin's own state - what `ctx.record` writes into. */
  state: OpsState;
}

/**
 * A real `PluginContext<PdsConfig>` over a recording IAM client. Every other
 * client is a genuine core client built on a transport that rejects: a fixture
 * that stubbed the whole bundle could not tell an unexpected call from a
 * missing one.
 */
function createNodeContext(overrides: NodeContextOverrides = {}): NodeFixture {
  const config = mergeConfig({
    siteName: 'example',
    githubRepo: 'antstanley/example',
    ...overrides.config,
    ...(overrides.pds ? { pds: pdsBlock(overrides.pds) } : {}),
  });
  const env = overrides.env ?? DEFAULT_ENV;
  const accountId = '123456789012';
  const calls: IamCall[] = [];
  let policies = [...(overrides.policies ?? [SITE_POLICY])];

  const base = createClients({
    region: config.region,
    credentials: staticCredentials({ accessKeyId: 'test', secretAccessKey: 'test' }),
    transport: rejectAllTransport,
  });
  const iam: IamClient = Object.assign(Object.create(base.iam) as IamClient, {
    listRolePolicies: async (roleName: string) => {
      calls.push({ op: 'listRolePolicies', roleName });
      return [...policies];
    },
    putRolePolicy: async (roleName: string, policyName: string, policy: object) => {
      calls.push({ op: 'putRolePolicy', roleName, policyName, policy });
      if (!policies.includes(policyName)) policies.push(policyName);
    },
    deleteRolePolicy: async (roleName: string, policyName: string) => {
      calls.push({ op: 'deleteRolePolicy', roleName, policyName });
      policies = policies.filter((name) => name !== policyName);
    },
  });

  const state = emptyState(env);
  const names = deriveNames(env, accountId, config);
  const ctx: PluginContext<PdsConfig> = {
    env,
    domain: undefined,
    // Hard-coded, and hard-coded to `false` even for the preview fixture: this
    // is not a convenience but a faithful reproduction of every plugin context
    // the CLI builds. `runPlugin` (`packages/cli/src/plugin-commands.ts`)
    // passes no `preview` key to its `ContextFactory` and `createContext`
    // defaults it to `false`, so `blogwright pds bootstrap --env preview`
    // produces `{ env: 'preview', preview: false }`.
    preview: false,
    config,
    pluginConfig: config.pds ?? pdsBlock({}),
    names,
    accountId,
    clients: { ...base, iam },
    ports: { fs: createMemoryFileSystem(), terminal: silentTerminal },
    logger: NOOP_LOGGER,
    store: new StateStore(base.s3, `${env}-example-${accountId}`, env, 'pds'),
    state,
    siteState: {
      resources: overrides.siteResources ?? {
        'gh-oidc-role': { arn: `arn:aws:iam::${accountId}:role/${names.githubRole}` },
      },
    },
    record: (nodeId, outputs) => {
      state.resources[nodeId] = outputs;
    },
    save: async () => undefined,
  };
  return { ctx, role: names.githubRole, calls, policiesOn: () => [...policies], state };
}

/** The single contributed node, or a failure naming what was contributed instead. */
function theNode(ctx: PluginContext<PdsConfig>): ReturnType<typeof buildPdsNodes>[number] {
  const nodes = buildPdsNodes(ctx);
  const node = nodes[0];
  if (nodes.length !== 1 || !node) {
    throw new Error(`expected one node, got ${JSON.stringify(nodes.map((n) => n.id))}`);
  }
  return node;
}

/**
 * Drive every contributed node through its whole lifecycle. A "skip" that
 * silently returned the node anyway would reach IAM here - which is what makes
 * the empty-transcript assertions in the skip tests below non-vacuous.
 */
async function runEveryNode(ctx: PluginContext<PdsConfig>): Promise<void> {
  for (const node of buildPdsNodes(ctx)) {
    await node.read(ctx);
    await node.create(ctx);
    await node.update?.(ctx);
    await node.delete(ctx);
  }
}

/**
 * The statement the site's own graph produces for this grant today, copied
 * field for field from the expectation in `packages/cli/src/nodes.test.ts`
 * (`oidcRolePolicyStatements` … "grants secret read/write scoped to the pds
 * secret when configured"). The move to this package is behaviour-preserving
 * only if this literal and the node's output agree, so it is written out here
 * rather than derived from the code under test.
 */
const SITE_SECRET_STATEMENT = {
  Effect: 'Allow',
  Action: [
    'secretsmanager:GetSecretValue',
    'secretsmanager:PutSecretValue',
    'secretsmanager:CreateSecret',
  ],
  Resource: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:example/atproto-*',
};

/** The document the node writes: the site's statement, under its own policy name. */
const SITE_EQUIVALENT_DOCUMENT = { Version: '2012-10-17', Statement: [SITE_SECRET_STATEMENT] };

/** The same document scoped to another secret - the one field a config change moves. */
function documentForSecret(secretName: string): object {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        ...SITE_SECRET_STATEMENT,
        Resource: `arn:aws:secretsmanager:us-east-1:123456789012:secret:${secretName}-*`,
      },
    ],
  };
}

describe('buildPdsNodes', () => {
  it('contributes exactly one node, the deploy-role grant', () => {
    const { ctx } = createNodeContext({ pds: {} });
    expect(buildPdsNodes(ctx).map((node) => node.id)).toEqual(['pds-oidc-policy']);
  });

  it('contributes nothing, and calls no IAM, when the site configures no pds block', async () => {
    const { ctx, calls, policiesOn } = createNodeContext();
    expect(ctx.config.pds).toBeUndefined();
    expect(buildPdsNodes(ctx)).toEqual([]);
    await runEveryNode(ctx);
    expect(calls).toEqual([]);
    expect(policiesOn()).toEqual([SITE_POLICY]);
  });

  it('contributes nothing, and calls no IAM, when githubRepo is unset - that site has no deploy role', async () => {
    const { ctx, calls, policiesOn } = createNodeContext({
      pds: {},
      config: { githubRepo: undefined },
    });
    expect(ctx.config.pds).toBeDefined();
    expect(buildPdsNodes(ctx)).toEqual([]);
    await runEveryNode(ctx);
    expect(calls).toEqual([]);
    expect(policiesOn()).toEqual([SITE_POLICY]);
  });

  it('contributes nothing, and calls no IAM, for the preview stack - whose role any ref can assume', async () => {
    const { ctx, calls, policiesOn } = createNodeContext({ pds: {}, env: 'preview' });
    // The preview role exists and its ARN IS in state here, and both other
    // skip conditions are satisfied - so nothing but the environment check can
    // be what withholds the grant. The site's own graph withholds the same
    // statement from the same role, because that role's OIDC subject claim is
    // `repo:<owner>/<repo>:*` while the secret (`<siteName>/atproto`) is
    // shared with production.
    expect(ctx.config.pds).toBeDefined();
    expect(ctx.config.githubRepo).toBe('antstanley/example');
    expect(ctx.siteState.resources['gh-oidc-role']?.arn).toContain('preview-example-gh');
    // NOT the discriminator: `runPlugin` passes no `preview` key to its
    // `ContextFactory` and `createContext` defaults the flag to `false`, so
    // this is exactly what `blogwright pds bootstrap --env preview` produces.
    // A skip rewritten as `ctx.preview` would fail this test.
    expect(ctx.preview).toBe(false);
    expect(buildPdsNodes(ctx)).toEqual([]);
    await runEveryNode(ctx);
    expect(calls).toEqual([]);
    expect(policiesOn()).toEqual([SITE_POLICY]);
  });

  it('still contributes on staging - staging is a real stack, not the preview one', async () => {
    const { ctx, role, calls } = createNodeContext({ pds: {}, env: 'staging' });
    expect(role).toBe('staging-example-gh');
    expect(buildPdsNodes(ctx).map((node) => node.id)).toEqual(['pds-oidc-policy']);
    await theNode(ctx).create(ctx);
    // The same document the site's `staging-deploy` policy already carries: a
    // skip written as "anything but production" would leave this empty.
    expect(calls).toEqual([
      {
        op: 'putRolePolicy',
        roleName: 'staging-example-gh',
        policyName: 'blogwright-pds',
        policy: SITE_EQUIVALENT_DOCUMENT,
      },
    ]);
  });
});

describe('pds-oidc-policy create', () => {
  it("writes a blogwright-pds inline policy byte-identical to the site's statement today", async () => {
    const { ctx, calls } = createNodeContext({ pds: {} });
    await theNode(ctx).create(ctx);
    expect(calls).toEqual([
      {
        op: 'putRolePolicy',
        roleName: ROLE,
        policyName: 'blogwright-pds',
        policy: SITE_EQUIVALENT_DOCUMENT,
      },
    ]);
  });

  it("leaves the site's own inline policy in place and never names it", async () => {
    const { ctx, calls, policiesOn } = createNodeContext({ pds: {} });
    await theNode(ctx).create(ctx);
    expect(policiesOn()).toEqual([SITE_POLICY, 'blogwright-pds']);
    expect(calls.map((call) => call.policyName)).toEqual(['blogwright-pds']);
  });

  it("scopes the ARN to the block's own secretName, not to the derived default", async () => {
    const { ctx, calls } = createNodeContext({ pds: { secretName: 'custom/atproto-key' } });
    await theNode(ctx).create(ctx);
    expect(calls[0]?.policy).toEqual(documentForSecret('custom/atproto-key'));
  });

  it("records the grant in the plugin's own state", async () => {
    const { ctx, state } = createNodeContext({ pds: {} });
    await theNode(ctx).create(ctx);
    expect(state.resources['pds-oidc-policy']).toEqual({
      roleName: ROLE,
      policyName: 'blogwright-pds',
    });
  });

  it('re-puts the document on update, so a changed secretName reaches the live policy', async () => {
    const { ctx, calls } = createNodeContext({
      pds: { secretName: 'rotated/atproto' },
      policies: [SITE_POLICY, 'blogwright-pds'],
    });
    await theNode(ctx).update?.(ctx);
    expect(calls).toEqual([
      {
        op: 'putRolePolicy',
        roleName: ROLE,
        policyName: 'blogwright-pds',
        policy: documentForSecret('rotated/atproto'),
      },
    ]);
  });
});

describe('pds-oidc-policy read', () => {
  it("reports absent, and records nothing, when only the site's own policy is on the role", async () => {
    const { ctx, calls, state } = createNodeContext({ pds: {} });
    expect(await theNode(ctx).read(ctx)).toBe(false);
    expect(calls).toEqual([{ op: 'listRolePolicies', roleName: ROLE }]);
    expect(state.resources['pds-oidc-policy']).toBeUndefined();
  });

  it('reports present, and records the grant, when its policy name is on the role', async () => {
    const { ctx, calls, state } = createNodeContext({
      pds: {},
      policies: [SITE_POLICY, 'blogwright-pds'],
    });
    expect(await theNode(ctx).read(ctx)).toBe(true);
    expect(calls).toEqual([{ op: 'listRolePolicies', roleName: ROLE }]);
    expect(state.resources['pds-oidc-policy']).toEqual({
      roleName: ROLE,
      policyName: 'blogwright-pds',
    });
  });
});

describe('pds-oidc-policy delete', () => {
  it("removes only its own named policy, leaving the site's document on the role", async () => {
    const { ctx, calls, policiesOn } = createNodeContext({
      pds: {},
      policies: [SITE_POLICY, 'blogwright-pds'],
    });
    await theNode(ctx).delete(ctx);
    expect(calls).toEqual([
      { op: 'listRolePolicies', roleName: ROLE },
      { op: 'deleteRolePolicy', roleName: ROLE, policyName: 'blogwright-pds' },
    ]);
    expect(policiesOn()).toEqual([SITE_POLICY]);
  });

  it('deletes nothing when its grant is already gone', async () => {
    const { ctx, calls, policiesOn } = createNodeContext({ pds: {} });
    await theNode(ctx).delete(ctx);
    expect(calls).toEqual([{ op: 'listRolePolicies', roleName: ROLE }]);
    expect(policiesOn()).toEqual([SITE_POLICY]);
  });

  it('calls no IAM at all when the site has no deploy role recorded', async () => {
    const { ctx, calls } = createNodeContext({ pds: {}, siteResources: {} });
    await theNode(ctx).delete(ctx);
    expect(calls).toEqual([]);
  });
});

describe('pds-oidc-policy against an un-bootstrapped site', () => {
  it('fails read with a message naming blogwright bootstrap, before any IAM call', async () => {
    const { ctx, calls } = createNodeContext({ pds: {}, siteResources: {} });
    await expect(theNode(ctx).read(ctx)).rejects.toThrow(/blogwright bootstrap --env test/);
    expect(calls).toEqual([]);
  });

  it('fails create with a message naming blogwright bootstrap, before any IAM call', async () => {
    const { ctx, calls, policiesOn } = createNodeContext({
      pds: {},
      // A site with other resources in state, but no deploy role: the check is
      // on the role's own entry, not on the state file being empty.
      siteResources: { 'cloudfront-distribution': { arn: 'arn:aws:cloudfront::1:distribution/D' } },
    });
    await expect(theNode(ctx).create(ctx)).rejects.toThrow(/blogwright bootstrap --env test/);
    expect(calls).toEqual([]);
    expect(policiesOn()).toEqual([SITE_POLICY]);
  });
});
