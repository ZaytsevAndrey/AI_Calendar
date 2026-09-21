import { test, expect, openAs, uniqueName } from '../helpers/fixtures';

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

    const card = page.locator('article').filter({ hasText: name });
    await card.getByRole('button', { name: /^Today/ }).click();
    await expect(todaySummary).toHaveText(new RegExp(`^Today ${doneBefore + 1}/`));
    await expect(page.getByText(/^\d+ points$/)).toBeVisible();
  });
});
