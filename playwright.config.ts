/** Built-surface browser checks; snapshots have one pinned Linux rendering environment. */
import { defineConfig } from '@playwright/test';

const surfaces = ['dashboard', 'docs'] as const;
const browsers: ('chromium' | 'firefox' | 'webkit')[] = ['chromium', 'firefox', 'webkit'];
const baseURL = { dashboard: 'http://127.0.0.1:4319', docs: 'http://127.0.0.1:4322' };

export default defineConfig({
  testDir: './tests/browser',
  outputDir: `test-results/${process.env.BROWSER_SUITE ?? 'ui'}`,
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-{platform}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixels: 0, animations: 'disabled' } },
  updateSnapshots: 'none',
  reporter: [
    ['list'],
    [
      'html',
      { open: 'never', outputFolder: `playwright-report/${process.env.BROWSER_SUITE ?? 'ui'}` },
    ],
  ],
  use: {
    locale: 'en-GB',
    timezoneId: 'UTC',
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node tests/browser/server.mjs',
      url: baseURL.dashboard,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter blogwright-docs preview --host 127.0.0.1 --port 4322',
      url: baseURL.docs,
      reuseExistingServer: false,
    },
  ],
  projects: [
    ...surfaces.flatMap((surface) =>
      browsers.flatMap((browserName) =>
        [390, 1440].map((width) => ({
          name: `${surface}-${browserName}-${width}`,
          testMatch: `${surface}.spec.ts`,
          use: { browserName, baseURL: baseURL[surface], viewport: { width, height: 900 } },
        })),
      ),
    ),
    ...surfaces.map((surface) => ({
      name: `${surface}-acceptance`,
      testMatch: `${surface}.acceptance.ts`,
      use: {
        browserName: 'chromium' as const,
        baseURL: baseURL[surface],
        viewport: { width: 390, height: 900 },
      },
    })),
  ],
});
