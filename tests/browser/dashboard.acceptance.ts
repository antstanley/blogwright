/** Accessibility scans include modal, validation, theme and content-state variants. */
import { test, expect, dashboardReady, noOverflow, scan, textSpacing } from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`@a11y dashboard ${theme} states and dialog`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await dashboardReady(page);
    await scan(page);
    await page.getByRole('button', { name: 'Choose from date' }).click();
    await scan(page);
    await page.keyboard.press('Escape');
    await page.getByRole('searchbox', { name: 'Find country' }).fill('South Africa');
    await page.getByRole('button', { name: 'South Africa', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Unique viewers per UTC day');
    await scan(page);
    await page.keyboard.press('Escape');
    const path = page.getByRole('textbox', { name: 'Path', exact: true });
    for (const value of ['invalid', '/empty', '/failed']) {
      await path.fill(value);
      await expect(page.getByText('Loading report…')).toHaveCount(0);
      await scan(page);
    }
  });
  for (const width of [320, 390, 768, 1440]) {
    test(`dashboard ${theme} ${width} @visual`, async ({ page }) => {
      test.skip(
        process.platform !== 'linux',
        'Canonical image comparisons run in the pinned Linux container.',
      );
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await dashboardReady(page);
      await noOverflow(page);
      await expect(page).toHaveScreenshot(`dashboard-${theme}-${width}.png`, { fullPage: true });
    });
  }
}
test('text spacing and reduced motion preserve controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 900 });
  await dashboardReady(page);
  await textSpacing(page);
  expect(
    await page
      .locator('.pill-highlight')
      .first()
      .evaluate((node) => getComputedStyle(node).transitionDuration),
  ).toBe('0s');
});
test('storage failure explains visit-only theme', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('Storage unavailable');
    };
  });
  await dashboardReady(page);
  await page.getByRole('radio', { name: 'Dark', exact: true }).check();
  await expect(
    page.getByRole('status').filter({ hasText: 'browser storage is unavailable' }),
  ).toBeVisible();
});
