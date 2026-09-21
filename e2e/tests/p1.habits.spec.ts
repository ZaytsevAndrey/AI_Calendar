import { test, expect, openAs, uniqueName, apiJson } from '../helpers/fixtures';

test.describe('P1 habits UI', () => {
  test('U-HAB-003 summary bar tracks today and points', async ({ page, auth }) => {
    const name = uniqueName('P1 summary');
    await openAs(page, auth.onboarded, '/habits');
    await page.getByRole('button', { name: 'Add habit' }).click();
    const create = page.getByRole('dialog');
    await create.locator('#habit-name').fill(name);
    await create.getByRole('button', { name: 'Create habit' }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();

    const todaySummary = page.locator('span').filter({ hasText: /^Today \d+\// });
    await expect(todaySummary).toBeVisible();
    const before = await todaySummary.textContent();
    const match = before?.match(/^Today (\d+)\//);
    const doneBefore = match ? Number(match[1]) : 0;

    const row = page.getByRole('row').filter({ hasText: name });
    await row.getByRole('button', { name: `${name} today` }).click();
    await expect(todaySummary).toHaveText(new RegExp(`^Today ${doneBefore + 1}/`));
    await expect(page.getByText(/^\d+ points$/)).toBeVisible();
  });

  test('U-HAB-006 week dots open the day checklist', async ({ page, auth, request }) => {
    const name = uniqueName('E2E dots');
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/habits', {
      name,
      color: '#22c55e',
    });
    expect(created.status).toBeGreaterThanOrEqual(200);
    expect(created.status).toBeLessThan(300);

    await openAs(page, auth.onboarded);
    const todayCell = page.locator('.ring-ide-link');
    await todayCell.getByRole('button', { name: /Habits on / }).click();

    const dialog = page.getByRole('dialog');
    const row = dialog.getByRole('button', { name: `${name} on ` });
    await expect(row).toHaveAttribute('aria-pressed', 'false');
    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
  });

  test('U-HAB-007 saves a daily time block on the habit', async ({ page, auth }) => {
    const name = uniqueName('E2E block');
    await openAs(page, auth.onboarded, '/habits');
    await page.getByRole('button', { name: 'Add habit' }).click();
    const create = page.getByRole('dialog');
    await create.locator('#habit-name').fill(name);
    await create.getByRole('checkbox', { name: 'Reserve a daily time block' }).check();
    await expect(create.getByText(/added there every day/)).toBeVisible();
    await create.locator('#habit-block-start').fill('09:15');
    await create.locator('#habit-block-minutes').fill('45');
    await create.getByRole('button', { name: 'Create habit' }).click();
    await expect(page.getByRole('row').filter({ hasText: name })).toContainText('09:15 · 45 min');
  });
});
