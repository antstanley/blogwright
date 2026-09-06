/** Documentation navigation and reading remain usable in the built Starlight shell. */
import { test, expect, noOverflow } from './helpers';

test('homepage and reading routes preserve navigation and keyboard table access', async ({
  page,
  browserName,
}) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Get started', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Get started', exact: true }).click();
  await expect(page).toHaveURL(/getting-started\/introduction/);
  await page.goto('/reference/configuration/');
  await page.keyboard.press(
    browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab',
  );
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await noOverflow(page);
  const table = page.locator('.sl-markdown-content table').last();
  await table.focus();
  await expect(table).toBeFocused();
  await page.keyboard.press('ArrowRight');
  if (await table.evaluate((node) => node.scrollWidth > node.clientWidth)) {
    await expect.poll(() => table.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  }
  for (const route of ['/getting-started/quickstart/', '/guides/troubleshooting/']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await noOverflow(page);
  }
});

test('search opens and closes with keyboard and shows results and no results', async ({ page }) => {
  await page.goto('/getting-started/introduction/');
  const search = page.getByRole('button', { name: /Search/ }).first();
  await search.focus();
  await page.keyboard.press('Enter');
  const input = page.getByRole('textbox', { name: 'Search', exact: true });
  await expect(input).toBeVisible();
  await input.fill('bootstrap');
  await expect(page.locator('.pagefind-ui__result').first()).toBeVisible();
  await input.fill('zzzxnonexistentword');
  await expect(page.locator('.pagefind-ui__message')).toContainText(/no results/i);
  await page.keyboard.press('Escape');
  await expect(input).not.toBeVisible();
  await expect(search).toBeFocused();
});

test('machine-readable exports still resolve', async ({ request }) => {
  for (const route of [
    '/llms.txt',
    '/getting-started/quickstart.md',
    '/reference/configuration.md',
  ]) {
    const response = await request.get(route);
    expect(response.ok()).toBe(true);
    expect((await response.text()).length).toBeGreaterThan(100);
  }
});

test('mobile menu and theme selector retain keyboard access', async ({ page }) => {
  await page.goto('/getting-started/quickstart/');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) {
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
    await menu.click();
  }
  const theme = page.getByRole('combobox', { name: 'Select theme' }).first();
  await theme.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('code copying remains keyboard operable', async ({ page, browserName, context }) => {
  test.skip(
    browserName !== 'chromium',
    'Clipboard permission assertions use Chromium; focus and rendering are covered in all engines.',
  );
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const copy = page.getByRole('button', { name: 'Copy to clipboard' }).first();
  await copy.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('pnpm exec blogwright deploy');
});
