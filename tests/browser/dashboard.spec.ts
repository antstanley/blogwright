/** Keyboard and pointer journeys exercise real built components against the query fixture port. */
import { test, expect, dashboardReady, noOverflow } from './helpers';

test('filters, data disclosure and keyboard country dialog', async ({ page }) => {
  await dashboardReady(page);
  await noOverflow(page);
  const path = page.getByRole('textbox', { name: 'Path', exact: true });
  await path.fill('invalid');
  await expect(path).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toContainText('Enter a path');
  await expect(path).toHaveAttribute('aria-describedby', 'path-hint reporting-error');
  await path.fill('');
  await expect(page.locator('.panel')).toHaveCount(7);
  const data = page.locator('.panel-views').getByText('View chart data', { exact: true });
  await data.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.panel-views table')).toBeVisible();
  await expect(page.locator('.panel-views table')).toContainText('Bucket start (UTC)');
  await page.getByRole('searchbox', { name: 'Find country' }).fill('South Africa');
  const country = page.getByRole('button', { name: 'South Africa', exact: true });
  await country.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Viewers over time');
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(country).toBeFocused();
  await page.getByRole('radio', { name: 'Dark', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
});

test('chart window works by keyboard and pointer without refetching or truncating data', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/queries/')) requests.push(request.url());
  });
  await dashboardReady(page);
  expect(requests).toHaveLength(7);
  requests.length = 0;
  await page.locator('.panel-views').getByText('View chart data', { exact: true }).click();
  const table = page.locator('.panel-views table');
  const before = await table.innerText();
  await page.getByLabel('Chart start (UTC)').fill('2026-08-12T00:00');
  await page.getByLabel('Chart end (UTC)').fill('2026-08-20T00:00');
  await page.getByRole('button', { name: 'Apply chart window' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Chart window:' })).toContainText(
    '2026-08-12',
  );
  await expect(page.locator('.views-area-chart')).toContainText('08-15');
  expect(await table.innerText()).toBe(before);
  await page.getByRole('button', { name: 'Reset zoom' }).click();
  await expect(page.getByText('Showing the full reporting period.')).toBeVisible();
  await page.getByLabel('Chart start (UTC)').fill('2026-08-15T00:00');
  await page.getByLabel('Chart end (UTC)').fill('2026-08-21T00:00');
  await page.getByRole('button', { name: 'Apply chart window' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Chart window:' })).toContainText(
    '2026-08-15',
  );
  expect(requests).toEqual([]);
  expect(await table.innerText()).toBe(before);
});

test('loading, empty and independent report failure retain distinct feedback', async ({ page }) => {
  await dashboardReady(page);
  const path = page.getByRole('textbox', { name: 'Path', exact: true });
  await path.fill('/loading');
  await expect(page.getByText('Loading report…').first()).toBeVisible();
  await expect(page.getByText('Loading report…')).toHaveCount(0);
  await path.fill('/empty');
  await expect(page.getByText('No rows in this range.')).toHaveCount(7);
  await path.fill('/failed');
  await expect(page.getByRole('alert')).toContainText('Fixture report unavailable');
  await expect(page.locator('.views-area-chart')).toBeVisible();
});

test('query controls preserve scope and reset local zoom on new results', async ({ page }) => {
  await dashboardReady(page);
  const changed = page.waitForRequest(
    (request) =>
      request.url().includes('/api/queries/views-over-time') &&
      new URL(request.url()).searchParams.get('path') === '/guides',
  );
  await page.getByRole('textbox', { name: 'Path', exact: true }).fill('/guides');
  const query = new URL((await changed).url());
  expect(query.searchParams.get('from')).toMatch(/Z$/);
  expect(query.searchParams.get('splitBots')).toBe('true');
  await page.getByLabel('Chart start (UTC)').fill('2026-08-12T00:00');
  await page.getByLabel('Chart end (UTC)').fill('2026-08-20T00:00');
  await page.getByRole('button', { name: 'Apply chart window' }).click();
  const refresh = page.waitForRequest((request) =>
    request.url().includes('/api/queries/views-over-time'),
  );
  await page.getByRole('button', { name: 'Refresh data' }).click();
  expect(new URL((await refresh).url()).searchParams.get('path')).toBe('/guides');
  await expect(page.getByText('Showing the full reporting period.')).toBeVisible();
  const granularity = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get('granularity') === '1h',
  );
  await page.getByRole('radio', { name: '1 hour', exact: true }).check();
  await granularity;
});

test('dragging and explicit bounds select the same chart window', async ({ page }) => {
  await dashboardReady(page);
  const chart = page.locator('.views-area-chart');
  await chart.scrollIntoViewIfNeeded();
  const bounds = await chart.boundingBox();
  if (!bounds) throw new Error('Chart has no rendered bounds');
  await page.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.45, {
    steps: 8,
  });
  await page.mouse.up();
  const message = page.getByRole('status').filter({ hasText: 'Chart window:' });
  await expect(message).toBeVisible();
  const selected = await message.innerText();
  const first = await page.getByLabel('Chart start (UTC)').inputValue();
  const last = await page.getByLabel('Chart end (UTC)').inputValue();
  await page.getByRole('button', { name: 'Reset zoom' }).click();
  await page.getByLabel('Chart start (UTC)').fill(first);
  await page.getByLabel('Chart end (UTC)').fill(last);
  await page.getByRole('button', { name: 'Apply chart window' }).click();
  await expect(message).toHaveText(selected);
});

test('invalid chart windows preserve the displayed range and can be corrected', async ({
  page,
}) => {
  await dashboardReady(page);
  await page.getByLabel('Chart start (UTC)').fill('2026-08-20T00:00');
  await page.getByLabel('Chart end (UTC)').fill('2026-08-12T00:00');
  await page.getByRole('button', { name: 'Apply chart window' }).click();
  await expect(page.locator('.chart-window').getByRole('alert')).toContainText('at least 24 hours');
  await expect(page.getByText('Showing the full reporting period.')).toBeVisible();
  await page.getByLabel('Chart end (UTC)').fill('2026-08-20T23:59');
  await page.getByRole('button', { name: 'Apply chart window' }).click();
  await expect(page.locator('.chart-window').getByRole('alert')).toBeVisible();
  await page.getByLabel('Chart end (UTC)').fill('2026-08-21T00:00');
  await page.getByRole('button', { name: 'Apply chart window' }).click();
  await expect(page.locator('.chart-window').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Chart window:' })).toContainText(
    '2026-08-21',
  );
});
