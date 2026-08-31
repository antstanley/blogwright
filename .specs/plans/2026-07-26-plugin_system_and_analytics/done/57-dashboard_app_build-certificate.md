# Done Certificate - Task 57: The SvelteKit dashboard app, built to dist/app and shipped prebuilt

**Task:** [57-dashboard_app_build.md](57-dashboard_app_build.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-31

> This certificate is a verification protocol for Task 57. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 57) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** The SvelteKit + LayerChart application under `packages/analytics/app/` builds to `dist/app` through the package's own `build` script, ships in its `files`, calls only the named-query routes, and every gate exclusion the new toolchain needs is recorded with its reason while CI stays unchanged.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the four existing packages' `build` scripts fanned out by the root `pnpm -r build` (`package.json:6`), the five gates as CI runs them (`.github/workflows/ci.yml:20-29`) for the TypeScript trees they already cover, or task 56's `packages/analytics/src/server.ts`, whose `appDir` contract this build satisfies.

## Obligations

- **O1 - Builds to `dist/app`, ships prebuilt, one build script.**
  - *Claim:* the app builds to `dist/app`, `dist/app` is in the package's `files`, and the package's `build` script runs both the TypeScript build and the app build so no consumer runs Vite.
  - *Evidence collected:* `packages/analytics/package.json:20` is `rolldown -c … && node dist/write-transform-manifest.mjs && tsc -p tsconfig.json && cd app && vite build` - the second step enters the package's own `app/` directory, matching `packages/cli/package.json:20`'s shape, with no root-level script and no consumer pre-step. `files` is `["dist", "dist/app"]` (`packages/analytics/package.json:9-12`). `packages/analytics/app/svelte.config.js:42-44` sets `adapter-static` `pages`/`assets` to `../dist/app` with `strict: true`. Ran `rm -rf packages/analytics/dist && pnpm -r build` from the workspace root: exit 0, and `ls packages/analytics/dist/app/index.html` printed the path. Output is 72 files, 784 KB, `index.html` at the root and everything else under `_app/immutable/**` with an explicit extension. `npm pack --dry-run --json` reports 122 files, 72 of them under `dist/app` including `dist/app/index.html`, and **no** `app/` source in the tarball; runtime `dependencies` remain `@duckdb/node-api`, `blogwright-core`, `fflate`, so installing the plugin pulls no Vite, Svelte or LayerChart. LayerChart is pinned exactly (`"layerchart": "2.0.2"`) on Svelte `^5.57.0`; `grep -l 'svelte\|layerchart' packages/*/package.json docs/package.json package.json` returns only `packages/analytics/package.json`.
  - *Checks resolved:* the second build step is package-local (`cd app && vite build`), not root-level. `dist/app` is redundant beside `dist` for tarball purposes but is what the DoD names, and it is harmless.
  - *Status:* ☑ SATISFIED

- **O2 - The app calls only the named-query routes.**
  - *Claim:* every network call the app makes names a query, a date range and a bot-inclusion flag against the server's own origin; none names another host and none sends SQL.
  - *Evidence collected:* `grep -rn "fetch(\|http" packages/analytics/app/src/` returns exactly **one** line - `app/src/lib/api.ts:150` - and no other match for `http` anywhere in the tree, so there is no absolute origin and no second host. The URL is `` `${QUERY_ROUTE_PREFIX}${name}?${searchParamsFor(request)}` `` with `QUERY_ROUTE_PREFIX = '/api/queries/'` (`api.ts:32`): site-root-relative, resolved against the page's own origin. `searchParamsFor` (`api.ts:81-86`) sends `from`, `to` and, for an explicit choice, `includeBots` - nothing else. Driven for real: the built `dist/app` served by task 56's `createDashboardServer` against the fixture query port, loaded in Chromium, recorded **exactly seven** requests on load, one per name, each `GET /api/queries/<name>?from=2026-08-02&to=2026-08-31`. Selecting *Exclude bots* re-issued the same seven with `&includeBots=false`. Grepping the built bundle for `SELECT `, `FROM page_views`, `GROUP BY`, `ORDER BY`, `count(DISTINCT`, `page_views`, `visitor_key`, `include_bots` returns **zero** hits, so the type-only imports of `QueryName`, `typeof ANALYTICS_QUERIES` and `QueryRow` keep the definition table and its SQL entirely on the server side of the wire.
  - *Checks resolved:* the base path derives from the page's own origin (a bare root-relative path), so the prebuilt bundle cannot be pointed elsewhere.
  - *Status:* ☑ SATISFIED

- **O3 - The gates pass with the app tree present, and each exclusion carries its reason.**
  - *Claim:* `pnpm lint`, `pnpm exec oxfmt --check .` and `pnpm knip` pass with the Svelte tree in the workspace, and every exclusion is written down with its reason and scoped no wider than that tree.
  - *Evidence collected:* all three exit 0 from the workspace root. **No exclusion was added anywhere.** `knip.json` gains no `ignoreDependencies` and no `ignoreWorkspaces` entry; `ignoreWorkspaces` is the pre-existing `[".", "docs"]`. `packages/analytics.project` is *widened* to `["src/**/*.ts", "app/**/*.{ts,js,svelte}"]` with a SvelteKit `config`/`entry` restatement, and `.oxlintrc.json`'s `ignorePatterns` is unchanged at `["dist", "node_modules"]` while the package's lint script widens to `oxlint src app`. Falsified rather than assumed - each probe run against a green control and reverted: an unused export in `app/src/lib/format.ts` -> knip exit 1 naming it; an orphan `app/src/lib/orphan.ts` -> knip exit 1; an orphan `packages/analytics/src/orphan.ts` -> knip exit 1 (the `src/` tree was not narrowed by adding `app/`); an orphan `packages/core/src/orphan.ts` -> knip exit 1 (other workspaces still gated); an unused devDependency added to `packages/analytics/package.json` -> knip exit 1 naming it. A planted `no-dupe-keys` in `app/src/lib/format.ts` -> `oxlint src app` exit 1; the same in `app/svelte.config.js` -> exit 1. A mangled `app/src/app.css` -> `oxfmt --check .` exit 1 (the new CSS is genuinely covered); a mangled `app/src/lib/format.ts` -> exit 1.
  - *Checks resolved:* every added glob is under `packages/analytics/app/**`; `src/**/*.ts` still stands on its own in `project`, proved by the `src/orphan.ts` probe.
  - *One recorded gap is half wrong - see D1.* `.oxfmtrc.json`'s claim is true: a mangled `.svelte` leaves `oxfmt --check .` at exit 0. `.oxlintrc.json:47-56`'s claim is false: oxlint 1.73.0 **does** lint `.svelte` script blocks under this repo's own config.
  - *Status:* ☑ SATISFIED (the DoD asks that exclusions carry a reason; no oxlint exclusion was added, so no exclusion's reason is wrong - the inaccuracy is in supplementary prose, recorded as D1)

- **O4 - CI needs no new step.**
  - *Claim:* the app build runs inside `pnpm build`, so `.github/workflows/ci.yml` is unchanged.
  - *Evidence collected:* `jj diff --stat .github/workflows/ci.yml` prints `0 files changed, 0 insertions(+), 0 deletions(-)` - no file listed. The app build runs inside `packages/analytics`' own `build`, which the existing `pnpm build` step fans out to, and `svelte-check` runs inside the existing `pnpm typecheck` step. The seven-step gate list at `ci.yml:20-29` is untouched.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* from the workspace root - `pnpm build` 0, `pnpm typecheck` 0 (`svelte-check … --fail-on-warnings` reports `337 FILES 0 ERRORS 0 WARNINGS`), `pnpm test` 0 (core 149, build-agent 27, pds 145, analytics 652, cli 353), `pnpm lint` 0, `pnpm exec oxfmt --check .` 0 over 201 files, `pnpm knip` 0. The security work landed 9 new tests in task 56's `server.test.ts` (45 -> 54); the only removed line in that file's diff is the `node:net` import line it replaced, so **no expected value was edited**. Limits are named constants with stated reasons: `RANKING_LIMIT`, `VALUE_AXIS_TICKS`, `CATEGORY_AXIS_TICKS`, `LABEL_LIMIT`, `DEFAULT_RANGE_DAYS`, `DAY_LENGTH`, `MILLISECONDS_PER_DAY`, `ALLOWED_HOST_NAMES`, `COMMON_HEADERS`. No changeset - consistent with every prior analytics implementation task in this build (builds 36/45, 46/47, 49/56 all added none), which is a build-level residue rather than this task's gap.
  - *Status:* ☑ SATISFIED

- **O6 - Run the clean-checkout build then the three gates (Reviewable).**
  - *Claim:* a reviewer can run the two command lines and observe the built entry point and three clean gates.
  - *Evidence collected:* ran verbatim. `rm -rf packages/analytics/dist && pnpm -r build && ls packages/analytics/dist/app/index.html` -> exit 0, printed `packages/analytics/dist/app/index.html`. `pnpm lint && pnpm exec oxfmt --check . && pnpm knip` -> exit 0, `All matched files use the correct format. Finished in 109ms on 201 files`. `jj diff --stat .github/workflows/ci.yml` -> no file listed.
  - *Status:* ☑ SATISFIED

## The chain this task terminates

Task 41 rotates `visitor_key` daily, so task 45 reports the range total as a sum of daily counts, labels the columns `daily_unique_visitors` / `summed_daily_unique_visitors`, and carries a `rowMeaning` saying so. Verified against the rendered application, not the source:

- The panel is titled **"Daily unique visitors"** (`panels.ts:78`), never "Unique visitors".
- All **seven** subtitles are the server's `rowMeaning` **verbatim** - compared programmatically against `ANALYTICS_QUERIES`; seven of seven byte-identical. `QueryPanel.svelte:95` renders `{result.rowMeaning}` with no interposed string.
- The range total is labelled **"Summed daily unique visitors"**, derived by `humaniseColumn('summed_daily_unique_visitors')` rather than hand-written, and read `735` against a fixture whose thirty daily counts sum to 735.
- Across the whole rendered document - `outerHTML`, SVG included - the string `unique visitors` occurs **exactly twice**, both qualified: the panel title and the total's label. Across the whole built bundle it occurs once, inside the panel title literal. Nothing renders the figure unqualified.

## The security work

- `rejectForeignHost(req)` is the **first statement** of `route()` (`server.ts:539`), before the method gate. Confirmed on the running artifact: a foreign-host `POST` is 403, a same-host `POST` is 405.
- `allowedHostHeaders` is built from the **bound** port inside the `listen` callback (`server.ts:602`), before the address promise resolves. Mutating it to `opts.port` fails **36 of 54** tests, exactly as reported.
- `nosniff` is on `sendJson` and `sendAsset` alike via `COMMON_HEADERS` (`server.ts:296`, `server.ts:313`), and therefore on refusals too. Removing it from `sendAsset` fails 1 test; from `sendJson`, 2.
- Removing the `rejectForeignHost` call fails 4 tests. Every mutation was run against a green 54/54 control immediately before it and reverted immediately after.
- Both harness claims hold. `fetch` cannot exercise this: `host` is a forbidden header name, undici drops it, and a `fetch` carrying `host: rebound.example:PORT` was answered **200** by the live server - a test written that way could not fail. The `node:http` helper with `setHost: false` genuinely sends a foreign `Host`: the 403 body echoes the offending value (`a request for host "evil.example:4319" …`). An absent `Host` over HTTP/1.1 is refused by Node's own parser with a bare `400 Bad Request` carrying neither `nosniff` nor a JSON body - proof it never reached the module - while the same omission over HTTP/1.0 reaches it and is answered `403 … host <absent>`. The companion test pinning Node's 1.1 behaviour is present and passes.
- Edge probes at the socket: uppercase `HOST` header name -> 200; `Host: LOCALHOST:PORT` -> 200 (the module lowercases); `Host: 127.0.0.1` portless -> 403, which is unreachable in practice because task 44 floors `dashboard.port` at `MIN_DASHBOARD_PORT = 1024`; duplicate `Host` headers -> Node keeps the first, so evil-then-good is 403 and good-then-evil is 200, neither of which a browser can produce.
- **Ruling on the CORS reasoning: correct.** The absence of `Access-Control-Allow-Origin` is what refuses an ordinary cross-origin read, and in the rebinding case the browser's origin genuinely *is* the attacker's name, so CORS never engages and no response header could refuse it. Nothing a CORS header could add is missing: there is no JSONP and no route returning executable content, JSON is not valid JS so `<script src>` embedding yields a syntax error, `nosniff` closes the sniffing path, and GET/HEAD-only with no body reader means there is no state to forge. A cross-origin page can still *frame* `http://127.0.0.1:PORT/` (the iframe sends the correct `Host`), but it cannot read the frame and there is nothing to click, so `X-Frame-Options` would buy nothing here.

## The routed finding, adjudicated

**The implementer is right and the routed note was wrong.** Verified empirically rather than by argument: a second route added at `app/src/routes/nested/+page.svelte` under SvelteKit's default `trailingSlash: 'never'` emits **`nested.html`**, not `nested/index.html`. The server's `handleAsset` (`server.ts:518`) appends `index.html` only when the trimmed path is empty or ends in `/`, then looks the key up in the exact-path allow-list - so against that build the live server answered `/nested` **404** (`no such file "nested"`), `/nested/` **404**, and `/nested.html` **200**. `/nested` does not resolve on its own. Setting `trailingSlash = 'always'` on that route instead emits `nested/index.html`, which the existing server serves at `/nested/` and which is the case where a 301 from `/nested` would be worth adding. Both options are recorded accurately in `svelte.config.js:19-32`. The probe route was removed and `dist/app` rebuilt.

Today the point is moot: the application emits exactly one HTML file (`index.html`) and no extensionless or directory-shaped output, so neither remedy has anything to act on.

## The closed query set

`panels.ts:25` type-imports `ANALYTICS_QUERIES` and `QueryName`; `ResultColumn<Name>` reads `(typeof ANALYTICS_QUERIES)[Name]['resultColumns'][number]`. **Four** typecheck failures reproduced, each restored after:

1. `name: 'unique-visitor'` -> `Type '"unique-visitor"' is not assignable to type '"views-over-time" | … | "unique-visitors"'. Did you mean '"unique-visitors"'?`
2. `value: 'views'` on `unique-visitors` -> `Type '"views"' is not assignable to type '"day" | "daily_unique_visitors" | "summed_daily_unique_visitors"'.`
3. `totalColumn: 'cache_hit_ratio'` on `unique-visitors` -> not assignable to that query's column union.
4. `category: 'country'` on `top-paths` -> `Type '"country"' is not assignable to type '"uri" | "views"'.`

Each drove `pnpm typecheck` to exit 1 and a clean tree back to exit 0. `svelte-check` also catches a planted type error inside a `.svelte` file (exit 1). The type-only import keeps SQL out of the browser: grepping the built chunks for SQL keywords, `page_views`, `visitor_key` and `include_bots` returns zero hits.

## Two calls, ruled

1. **`includeBots` tri-state: accepted.** *Site default* deliberately sends no parameter so `config.analytics.bots` decides inside the port, which is task 44's contract and is covered by two of task 56's existing tests. An always-sent flag would force the dashboard to invent a default and would silently override a site configured `bots: "filter"` - a real behavioural bug, not a stylistic one. The DoD's "every call names … a bot-inclusion flag" is a description of the closed request surface (a name, a range, a bot choice, and nothing else), and every call does carry a bot-inclusion *choice*; two of three states encode it on the wire and the third names the site's own setting. The reasoning is recorded on `BotInclusion` in `api.ts:44-51`. Confirmed live: the seven load requests carry no `includeBots`, and selecting *Exclude bots* re-issues all seven with `includeBots=false`.
2. **No changeset: accepted.** Every prior analytics implementation task in this build added none (verified against builds 36, 46 and 49 - zero `.changeset/` entries each), and the changesets that exist name the plugin-system and pds work. Recorded as a build-level residue: the analytics feature must not reach a release without at least one changeset covering it, and no task in this plan has yet taken that on.

## Regression check

- `package.json:6` (`pnpm -r build`) fans out to `packages/analytics` with the extended two-step script -> all five packages build from a deleted `dist`, exit 0, `packages/cli` still copies its build-agent artifacts : ☑ PRESERVED
- `packages/analytics/src/server.ts` (task 56) serves `appDir` -> the built `dist/app` satisfies the contract, `index.html` at its root; the live server serves it at `/` with `text/html; charset=utf-8` and the app loads and renders : ☑ PRESERVED
- `knip.json:4-12` workspaces map with the widened `project` -> knip still reports planted findings in `packages/core/src/**`, `packages/analytics/src/**` and `packages/analytics/package.json`, so it has not fallen silent : ☑ PRESERVED
- Task 56's 45 original tests -> all still pass with no expected value edited; suite is 54/54 : ☑ PRESERVED
- Integration -> a plain merge of task 57 onto the bookmark is clean with **no conflict**, both against build 49 combined with in-flight task 29 (`packages/cli/**`, disjoint) and against the now-landed build 50 (task 51), whose `.gitignore` edit merges cleanly with this task's `.svelte-kit/` line : ☑ PRESERVED

## Defects

- **D1 (low, documentation).** `.oxlintrc.json:47-56` records that oxlint "has no Svelte parser and skips them silently" and that the three `.svelte` files are "the one gap … covered instead by svelte-check". **This is false for oxlint 1.73.0 under this repo's own config.** Running `oxlint src app` reports `app/src/lib/QueryPanel.svelte:33:21: error eslint(no-dupe-keys)`, `…:19:3: error eslint(no-restricted-imports)` (the hexagonal-architecture guard) and `…:33:16: warning typescript(no-explicit-any)` from planted code, and its file count of 11 is the 8 `.ts`/`.js` files plus the 3 `.svelte` files. The real, narrower gap is that oxlint suppresses `no-unused-vars` inside `.svelte` (a planted unused variable is reported in a `.ts` and not in the `.svelte`) and does not check template syntax. Effect: no gate is weakened - coverage is *understated* - but a maintainer reading the comment would believe the architecture guard does not reach `.svelte` files and might add a second linter on a false premise. One-line fix: correct the comment to say oxlint lints `.svelte` script blocks with `no-unused-vars` and template syntax unchecked. The `.oxfmtrc.json:30-35` half of the same recorded gap is accurate and was confirmed by mutation.
- **D2 (trivial, cosmetic).** The day-axis tick labels on the three time-series panels overlap and are unreadable at panel width (`2026-08-2026-08-2026-08-…`) because `CATEGORY_AXIS_TICKS = 6` full `YYYY-MM-DD` labels do not fit a `minmax(360px, 1fr)` column. Visible in the rendered dashboard. No correctness consequence.
- **D3 (trivial, testing).** That `rejectForeignHost()` is the *first* statement of `route()` is true by inspection but is not pinned: moving it below the method gate leaves all 54 tests green. Both orderings refuse the request; only the status (403 vs 405) and the `allow` header differ for a foreign-origin non-GET.
- **N1 (note, not a defect).** `PANELS: readonly Panel[]` does not force the seven names to be exhaustive or unique, so deleting a panel would silently drop it rather than fail the typecheck. A `Record<QueryName, …>` keyed shape would close it; the current array is what preserves render order.
- **N2 (note).** `.github/workflows/ci.yml:26-28`'s inline comment still says oxfmt "formats TypeScript and JavaScript", which is now one language short of `.oxfmtrc.json`. Correctly left alone - the DoD requires that file unchanged.

## Residue

`.svelte-kit/` is gitignored with its reason and is not tracked; `dist/app` inherits the repo-wide `dist` ignore and is not committed. `dist/app` beside `dist` in `files` is redundant for npm's purposes but is what the DoD names. The prebuilt bundle is 784 KB across 72 files; bundle size, browser support and offline behaviour remain unaddressed. The app tree has no tests of its own, which the plan left undecided. A `prepack` guard against a stale `dist/app` remains a follow-up. Every mutation made during this validation was reverted and the revert proved: the workspace diff is byte-identical to its state at the start of validation (22 files, 2339 insertions, 23 deletions) and every touched file matches its recorded SHA-256.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are satisfied against executed evidence rather than assertion - a clean-checkout `pnpm -r build` produces `dist/app/index.html`, `npm pack` ships it with no app source and no Vite in a consumer's install, the rendered dashboard issues exactly seven named-query requests and presents the summed-daily figure only as "Daily unique visitors" and "Summed daily unique visitors" with all seven subtitles the server's `rowMeaning` verbatim, all six gates pass from the workspace root with no exclusion added anywhere and every gate proved falsifiable by a planted finding, and `ci.yml` is untouched; the one defect found (D1) is a factually wrong comment in `.oxlintrc.json` claiming a lint gap that does not exist, which understates coverage and changes no behaviour.
