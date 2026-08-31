/**
 * A LEAF. This module must never import anything.
 *
 * Task 09 moved `KNOWN_COMMANDS` and `RESERVED_COMMANDS` here out of `cli.ts`
 * because `plugins.ts` needs the reserved set and `cli.ts` imports `plugins.ts`
 * for dispatch - a cycle between the composition root and a domain module. It
 * did not throw, because the set was only read inside a function body, but
 * adding one ordinary top-level derivation to `plugins.ts` under that cycle
 * produced `ReferenceError: Cannot access 'RESERVED_COMMANDS' before
 * initialization` and killed every command including `--help`.
 *
 * A single import added here re-opens that fault, silently, for whichever
 * module happens to be entered first. Keep it dependency-free.
 */
/**
 * The CLI's command-name registries, isolated in their own leaf module with
 * no imports of its own. Both `cli.ts` (the dispatcher - it pulls in every
 * built-in command implementation, and since task 29 no plugin package by
 * name: `blogwright-pds` reaches it only transitively, through the
 * post-deploy sync `commands.ts` imports) and
 * `plugins.ts` (a domain module that must stay inside the port boundary -
 * see DEVELOPMENT.md §Hexagonal architecture) need to read the same set of
 * reserved names, and neither may import the other: `plugins.ts` importing
 * `cli.ts` for this alone becomes a real cycle the moment `cli.ts` imports
 * `discover` from `plugins.ts` too (task 10 adds exactly that edge, to
 * dispatch `blogwright plugin list`) - two modules each waiting on the
 * other to finish initialising before either can run. This module gives
 * both callers a shared, dependency-free home instead.
 *
 * `KNOWN_COMMANDS` is the eight names `cli.ts`'s `main` dispatches through
 * its `switch`, after the `KNOWN_COMMANDS.has(command)` membership test:
 * `bootstrap`, `deploy`, `rollback`, `delete`, `destroy`, `history`, `logs`,
 * `status`.
 *
 * `RESERVED_COMMANDS` is every name a plugin may never claim as its own -
 * see `discover`'s namespace-collision check in `plugins.ts`. It is
 * deliberately NOT `KNOWN_COMMANDS` alone: `init` (dispatched in `cli.ts`
 * ahead of the `KNOWN_COMMANDS` membership test) and `preview` (likewise)
 * never enter that set, so deriving from it alone would under-reserve by
 * two and let a plugin shadow either one. `plugin` is named explicitly for
 * the same reason, one task early: `cli.ts` does not yet dispatch a
 * `blogwright plugin` namespace (task 10 adds `'plugin'` to
 * `KNOWN_COMMANDS`), but the name is reserved from the moment any plugin
 * could collide with it, and the union keeps this set correct both before
 * and after that command exists - no second edit required either way.
 *
 * `pds` is deliberately absent from `RESERVED_COMMANDS`, and adding it here
 * would break `blogwright pds` outright. There is no built-in `pds` command:
 * task 29 deleted `cli.ts`'s hardcoded `command === 'pds'` branch, and the
 * namespace is now served by the bundled `blogwright-pds` package, which
 * declares the plugin name `pds` and is discovered like any other plugin.
 * Reserving the name would make `discover`'s reserved-name check
 * (`plugins.ts`) reject that package - a load `failures` entry, never an
 * installed plugin - so `blogwright pds <action>` would exit 1 with `no
 * built-in command or installed plugin claims "pds"`, `--help` would list
 * none of its six actions, and `blogwright plugin list` would blame a
 * built-in command that does not exist. This is the one name in this file
 * whose reservation would REMOVE a working command rather than protect one;
 * it stays unreserved on purpose, pinned by a test in `plugins.test.ts` and
 * `cli.test.ts`. See `plugins.ts`'s module comment for the full reasoning.
 */

export const KNOWN_COMMANDS = new Set([
  'bootstrap',
  'deploy',
  'rollback',
  'delete',
  'destroy',
  'history',
  'logs',
  'status',
  'plugin',
]);

export const RESERVED_COMMANDS: ReadonlySet<string> = new Set([
  ...KNOWN_COMMANDS,
  'init',
  'preview',
  'plugin',
]);
