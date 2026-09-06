# Browser acceptance

Run `pnpm build` first. `pnpm test:ui` runs keyboard/pointer journeys in Chromium,
Firefox and WebKit at 390 and 1440 CSS pixels, plus layout/preference checks.
`pnpm test:a11y` scans the sampled dashboard states and five docs routes in both
themes. Install local browsers with `pnpm exec playwright install`.

The fixture server binds 127.0.0.1:4319, and the docs preview binds 127.0.0.1:4322.
Tests own and stop these processes; an occupied port fails rather than silently
reusing an unrelated server. All dashboard query results are synthetic, served
through the existing AnalyticsQuery port. No AWS credentials are needed.
`/empty`, `/failed` and `/loading` are fixture Path values, not production features.
The browser clock is fixed and non-loopback requests fail acceptance.

## Reference images

Screenshots belong to Linux ARM64 in Playwright 1.63.0 on Ubuntu Noble, pinned to
`mcr.microsoft.com/playwright@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27`.
The image supplies browser revisions, OS fonts and rendering libraries. CI uses
`ubuntu-24.04-arm` with that container. macOS runs report image tests as skipped;
they do not replace the Linux gate. Clipboard-content assertions use Chromium's
permission API; other engines still exercise navigation and accessible controls.

For local Linux verification, mount this repository read-only at `/source` and
an empty writable Docker volume at `/work`, then run
`bash /source/tests/browser/container.sh test:ui`. The helper copies the source
and existing production builds, installs the lockfile, and runs the chosen script.
Use `test:ui:update` only when intentionally generating/reviewing reference images.
Copy reviewed `tests/browser/*-snapshots/` from the volume back into this repository.

Dashboard and homepage snapshots capture the full page. Reference-page snapshots
capture the initial viewport and a representative wide table separately; semantic,
accessibility and overflow tests cover the reading content. Images cover widths
320, 390, 768 and 1440 in both themes. No pixel differences are accepted by default.
The ordinary test commands never create or update missing baselines.

Review each changed reference image and explain the change in the PR. Do not
regenerate references to hide an unexpected difference. Reports and traces live
in `playwright-report/{ui,a11y}` and `test-results/{ui,a11y}`; CI retains them for
14 days. These directories are ignored; reference images are committed.

## Evidence limits

Passing browser checks do not certify WCAG conformance. Manual text resize/zoom,
screen-reader journeys and criterion applicability still need recorded evidence.
The implementation acceptance report in `.specs/reviews/` lists those gaps.
