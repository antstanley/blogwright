/** Shared reading templates and built search output receive theme and layout coverage. */
import { test, expect, noOverflow, scan, textSpacing } from './helpers';

const routes = [
  '/',
  '/getting-started/introduction/',
  '/getting-started/quickstart/',
  '/reference/configuration/',
  '/guides/troubleshooting/',
];
for (const theme of ['light', 'dark'] as const) {
  test(`@a11y docs ${theme} routes and search`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: theme });
    for (const route of routes) {
      await page.goto(route);
      await scan(page);
    }
    await page
      .getByRole('button', { name: /Search/ })
      .first()
      .click();
    await page.getByRole('textbox', { name: 'Search', exact: true }).fill('bootstrap');
    await expect(page.locator('.pagefind-ui__result').first()).toBeVisible();
    await scan(page);
  });
  for (const width of [320, 390, 768, 1440]) {
    test(`docs ${theme} ${width} @visual`, async ({ page }) => {
      test.skip(
        process.platform !== 'linux',
        'Canonical image comparisons run in the pinned Linux container.',
      );
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      for (const [name, route] of [
        ['home', '/'],
        ['reference', '/reference/configuration/'],
      ] as const) {
        await page.goto(route);
        await noOverflow(page);
        await expect(page).toHaveScreenshot(`docs-${name}-${theme}-${width}.png`, {
          fullPage: name === 'home',
        });
        if (name === 'reference') {
          await page.locator('.sl-markdown-content table').last().focus();
          await expect(page).toHaveScreenshot(`docs-table-${theme}-${width}.png`);
        }
      }
    });
  }
}
test('reading reflows with text-spacing overrides', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/reference/configuration/');
  await textSpacing(page);
});
