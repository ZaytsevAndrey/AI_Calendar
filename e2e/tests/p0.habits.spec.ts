import { test, expect, openAs, uniqueName } from '../helpers/fixtures';

test.describe('P0 habits UI', () => {
  test('U-HAB-001 habits page CRUD', async ({ page, auth }) => {
    const name = uniqueName('E2E habit');
    const renamed = `${name} edited`;

    await openAs(page, auth.onboarded, '/habits');
    await page.getByRole('button', { name: 'Add habit' }).click();
    const create = page.getByRole('dialog');
    await expect(create.getByText('New habit')).toBeVisible();
    await create.locator('#habit-name').fill(name);
    await create.getByRole('button', { name: 'Create habit' }).click();
    await expect(page.getByText('Habit added')).toBeVisible();
    await expect(page.getByRole('heading', { name })).toBeVisible();

    await page.getByRole('button', { name: `Edit ${name}` }).click();
    const edit = page.getByRole('dialog');
    await expect(edit.getByText('Edit habit')).toBeVisible();
    await edit.locator('#habit-name').fill(renamed);
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Habit updated')).toBeVisible();
    await expect(page.getByRole('heading', { name: renamed })).toBeVisible();

    await page.getByRole('button', { name: `Edit ${renamed}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'Delete habit' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Habit deleted')).toBeVisible();
    await expect(page.getByRole('heading', { name: renamed })).toHaveCount(0);
  });

  test('U-HAB-002 toggles today and an earlier day in the grid', async ({ page, auth }) => {
    const name = uniqueName('E2E checkin');
    await openAs(page, auth.onboarded, '/habits');
    await page.getByRole('button', { name: 'Add habit' }).click();
    const create = page.getByRole('dialog');
    await create.locator('#habit-name').fill(name);
    await create.getByRole('button', { name: 'Create habit' }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: name });
    const todayCell = row.getByRole('button', { name: `${name} today` });
    await expect(todayCell).toHaveAttribute('aria-pressed', 'false');

    await todayCell.click();
    await expect(todayCell).toHaveAttribute('aria-pressed', 'true');

    const earlier = row.getByRole('button', { name: `${name} on ` }).first();
    await earlier.click();
    await expect(earlier).toHaveAttribute('aria-pressed', 'true');

    await todayCell.click();
    await expect(todayCell).toHaveAttribute('aria-pressed', 'false');
  });
});
