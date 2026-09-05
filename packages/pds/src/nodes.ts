/**
 * The resource topography this plugin owns: one node attaching a
 * `blogwright-pds`-named **inline policy** to the site's GitHub-OIDC deploy
 * role, granting Secrets Manager access to the plugin's own secret.
 *
 * The grant lives here rather than in the site's resource graph because it is
 * plugin topography: the site graph used to branch on `ctx.config.pds` and
 * interpolate this plugin's secret name into an IAM ARN
 * (`packages/cli/src/nodes.ts`), which was the CLI knowing something only this
 * package should know. That branch is gone, and this node is now the only
 * thing that grants it. The move was safe because IAM inline policies are
 * *named*: the site's `<env>-deploy` document and this plugin's
 * `blogwright-pds` document are independent objects on the same role, created,
 * reconciled and removed with no read of each other. That is what made the
 * migration additive - both grants were live at once for the release between
 * this node landing and the site's statement being removed - and it is why
 * `delete()` can safely remove this document without touching the role's own.
 *
 * The node's own state (the site's deploy role) is not something this plugin
 * creates, so `read()` never reports the role - only whether the policy this
 * plugin owns is attached to it.
 */

import type { PdsConfig, PluginContext, ResourceNode } from 'blogwright-core';

import { resolvePdsSecretName } from './config.js';

/**
 * A node in this plugin's own graph. Instantiated on the context the
 * lifecycle verbs build (`PluginContext<PdsConfig>`), not on the SPI's bare
 * `ResourceNode` default (`PluginContext<never>`), so a caller - the plugin's
 * `nodes(ctx)` member, or a test - can invoke a node's methods with the very
 * context it was handed. `ResourceNode`'s methods are method-declared and
 * therefore bivariant in their parameter, so this is still assignable to the
 * `ResourceNode[]` `Plugin.nodes` declares.
 */
type PdsNode = ResourceNode<PluginContext<PdsConfig>>;

/** The graph id this plugin records the grant under, in its own scoped state. */
const NODE_ID = 'pds-oidc-policy';

/**
 * The inline policy's name on the role. Deliberately the **package** name and
 * not the `pds` CLI namespace: this string is on-the-wire IAM state that
 * `delete()` has to find again through `listRolePolicies` on a later run, while
 * a namespace is a local label a manifest can re-declare (core's
 * `resolveNamespaceCollisions` renames a colliding one). A rename of the
 * namespace must not orphan a live IAM object.
 */
const POLICY_NAME = 'blogwright-pds';

/**
 * The site graph's node id for the GitHub OIDC deploy role
 * (`packages/cli/src/nodes.ts`). Only the role's ARN is recorded there, which
 * is why the *name* comes from `ctx.names.githubRole` and this id is used only
 * to confirm the site has been bootstrapped.
 */
const SITE_OIDC_ROLE_NODE = 'gh-oidc-role';

/**
 * The shared preview stack's environment name - the one environment this grant
 * must never reach. The CLI spells it as a literal at its single call site
 * (`runPreview`, `packages/cli/src/cli.ts`), so there is no exported constant
 * to import; see {@link buildPdsNodes} for why the skip is written against
 * `ctx.env` and not `ctx.preview`.
 */
const PREVIEW_ENV = 'preview';

/** The three actions the post-deploy PDS sync needs: it reads the OAuth secret and writes the rotated session back. */
const SECRET_ACTIONS = [
  'secretsmanager:GetSecretValue',
  'secretsmanager:PutSecretValue',
  'secretsmanager:CreateSecret',
];

/**
 * The policy document, scoped to this plugin's own secret. The trailing `-*`
 * matches the six random characters Secrets Manager appends to a secret's ARN.
 * A `*` resource here would hand the deploy role every secret in the account,
 * including every other plugin's - the scoping is the point of the node.
 */
function policyDocument(ctx: PluginContext<PdsConfig>, secretName: string): object {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: SECRET_ACTIONS,
        Resource: `arn:aws:secretsmanager:${ctx.config.region}:${ctx.accountId}:secret:${secretName}-*`,
      },
    ],
  };
}

/**
 * The deploy role's name, once the site's state proves the role exists. The
 * name itself is always derivable (`deriveNames`), so the presence check is
 * against the site's recorded ARN - the only thing the site's node records for
 * that role - and not against the name.
 */
function requireRoleName(ctx: PluginContext<PdsConfig>): string {
  if (ctx.siteState.resources[SITE_OIDC_ROLE_NODE]?.arn === undefined) {
    throw new Error(
      `the site's GitHub OIDC deploy role is not in the "${ctx.env}" state - run \`blogwright bootstrap --env ${ctx.env}\` before \`blogwright pds bootstrap\``,
    );
  }
  return ctx.names.githubRole;
}

/**
 * The plugin's grant on the site's deploy role. `secretName` is resolved once,
 * at graph-build time, where the `pds` block's presence is already the
 * condition for building the node at all.
 */
function oidcPolicyNode(secretName: string): PdsNode {
  function recordGrant(ctx: PluginContext<PdsConfig>, roleName: string): void {
    ctx.record(NODE_ID, { roleName, policyName: POLICY_NAME });
  }
  async function applyPolicy(ctx: PluginContext<PdsConfig>): Promise<void> {
    const roleName = requireRoleName(ctx);
    await ctx.clients.iam.putRolePolicy(roleName, POLICY_NAME, policyDocument(ctx, secretName));
    recordGrant(ctx, roleName);
  }
  return {
    id: NODE_ID,
    // The role belongs to the site's graph, not this one - there is no node
    // here to depend on. `requireRoleName` is what orders this after the site.
    dependsOn: [],
    title: 'PDS secret access on the deploy role',
    async read(ctx) {
      const roleName = requireRoleName(ctx);
      if (!(await ctx.clients.iam.listRolePolicies(roleName)).includes(POLICY_NAME)) return false;
      recordGrant(ctx, roleName);
      return true;
    },
    create: applyPolicy,
    // Re-put rather than leave the document as found: a changed `secretName`
    // must reach the live policy, exactly as the site's own role node
    // re-applies its document on every `blogwright bootstrap`.
    update: applyPolicy,
    async delete(ctx) {
      // No role recorded means no role, and therefore no document of ours on
      // it. Teardown after `blogwright destroy` is a no-op here, not the
      // `blogwright bootstrap` failure the apply path raises: there is nothing
      // an operator could do to make it succeed.
      if (ctx.siteState.resources[SITE_OIDC_ROLE_NODE]?.arn === undefined) return;
      const roleName = ctx.names.githubRole;
      // Delete only this plugin's own named document, and only when it is
      // there - a second `pds destroy` must not fail on a NoSuchEntity, and no
      // other policy name on this shared role is ever read or written.
      if (!(await ctx.clients.iam.listRolePolicies(roleName)).includes(POLICY_NAME)) return;
      await ctx.clients.iam.deleteRolePolicy(roleName, POLICY_NAME);
    },
  };
}

/**
 * The nodes `blogwright-pds` contributes, for the plugin's `nodes(ctx)` member
 * to return.
 *
 * Empty - a no-op `pds bootstrap`, not a failure - in three cases:
 *
 * 1. The site configures no `pds` block.
 * 2. `config.githubRepo` is unset. A non-preview site graph only adds the
 *    deploy role when it is set (`packages/cli/src/nodes.ts`), so such a site
 *    is fully bootstrapped and simply has no role to attach to.
 * 3. The target environment is the shared **preview** stack. That one is a
 *    privilege boundary, not an absence: the preview stack's role does exist
 *    (`buildNodes` adds `githubOidcRoleNode(true)` for it unconditionally),
 *    but its OIDC trust policy accepts the subject claim `repo:<owner>/<repo>:*`
 *    - **any ref** - where production accepts only the release-gated
 *    `repo:...:environment:production` (`oidcSubClaim`). `resolvePdsSecretName`
 *    is environment-independent (`<siteName>/atproto`), so there is ONE PDS
 *    credential for the whole site: granting it here would let anyone who can
 *    push a branch read or rotate the site's ATProto session. The site's own
 *    graph withheld exactly this Secrets Manager statement from that role for
 *    that reason, for as long as it carried the statement at all. `staging` is
 *    NOT a preview stack - the site granted it this statement - so the skip is
 *    on the preview environment specifically, never on "not production".
 *
 * The preview check is `ctx.env === PREVIEW_ENV` and deliberately **not**
 * `ctx.preview`, which would be dead code here: `runPlugin` builds its
 * `ContextOptions` with no `preview` key at all
 * (`packages/cli/src/plugin-commands.ts`), `createContext` defaults the flag to
 * `false` (`context.ts`) and `toPluginContext` copies it, so `ctx.preview` is
 * `false` for every plugin context the CLI builds - including the one
 * `blogwright pds bootstrap --env preview` produces. `ctx.env` is what carries
 * the stack's identity into a plugin.
 *
 * The `pds` block is read from `ctx.config`, not `ctx.pluginConfig`: core's
 * `OpsConfig` still declares `pds` as a typed member (it keeps the type after
 * the validation moves here), and the CLI does not populate `pluginConfig`
 * from a plugin's own validator until later in this migration.
 */
export function buildPdsNodes(ctx: PluginContext<PdsConfig>): PdsNode[] {
  const pds = ctx.config.pds;
  if (!pds || !ctx.config.githubRepo || ctx.env === PREVIEW_ENV) return [];
  return [oidcPolicyNode(resolvePdsSecretName(pds, ctx.config.siteName))];
}
