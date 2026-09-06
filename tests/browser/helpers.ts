/** Shared acceptance setup: deterministic dates, local requests and explicit rendered readiness. */
import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(new Date('2026-09-06T12:00:00Z'));
    const external: string[] = [];
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (['127.0.0.1', 'localhost'].includes(url.hostname)) await route.continue();
      else {
        external.push(url.origin);
        await route.abort();
      }
    });
    await use(page);
    expect(external, 'No external network requests during acceptance').toEqual([]);
  },
});
export { expect };

export async function dashboardReady(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(7);
  await expect(page.getByText('Loading report…')).toHaveCount(0);
  await expect(page.locator('.views-area-chart svg').first()).toBeVisible();
}

export async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

export async function scan(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
  ).toEqual([]);
}

export async function textSpacing(page: Page) {
  await page.addStyleTag({
    content:
      '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }',
  });
  await noOverflow(page);
}
