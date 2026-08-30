/**
 * The bodies behind the three actions `plugin.ts` declares. The command
 * TABLE is written once, in `plugin.ts`, and no later task edits it; each
 * action's behaviour lands here instead - `status` at task 55, `dashboard`
 * at task 56, `backfill` at task 61 (whose body lives in `backfill.ts` and
 * is called from the stub here). Until then each raises naming the task
 * that fills it in, so an operator who reaches one gets a sentence rather
 * than a silent no-op, and so `plugin.commands` is complete and dispatchable
 * from the moment the manifest field makes this package discoverable.
 *
 * The three take no parameters yet. `PluginCommand.run(ctx, args)` accepts a
 * narrower function - a zero-argument function is assignable to it - so the
 * task that fills a body in adds exactly the parameters it needs
 * (`ctx: PluginContext<AnalyticsConfig>`, and `args` for the one that reads
 * a flag) without the table in `plugin.ts` changing at all.
 *
 * `bootstrap` and `destroy` are deliberately absent from this module as well
 * as from the table: they are always the CLI's generic lifecycle verbs, run
 * by an engine a plugin may not import - see `plugin.ts`'s own comment.
 */

/**
 * Raise for an action whose body has not landed yet, naming the plan task
 * that lands it. One helper rather than three literals, so the sentence
 * shape is identical for all three.
 */
function pendingAction(action: string, task: number): never {
  throw new Error(
    `blogwright analytics ${action} is not implemented yet - task ${task} lands this command`,
  );
}

/**
 * `analytics status`: the plugin's own nodes read against
 * `state/<env>.analytics.json`, plus the Firehose stream's delivery health
 * and the table's current row count. Declared rather than left to the
 * generic `status` verb because it does strictly more than that verb does
 * (§Analytics plugin → Namespace and commands), which task 16's precedence
 * permits: only `bootstrap` and `destroy` are reserved.
 */
export async function status(): Promise<void> {
  pendingAction('status', 55);
}

/**
 * `analytics dashboard`: start the local dashboard server (bound to
 * 127.0.0.1 on the resolved `dashboard.port`) over the Iceberg table. This
 * is the plugin's composition root - the one place the DuckDB adapter is
 * constructed.
 */
export async function dashboard(): Promise<void> {
  pendingAction('dashboard', 56);
}

/**
 * `analytics backfill`: the optional, one-shot, idempotent pull of history
 * that predates the Firehose delivery, from the site's CloudWatch log group
 * into the table. Never part of the steady-state pipeline.
 */
export async function backfill(): Promise<void> {
  pendingAction('backfill', 61);
}
