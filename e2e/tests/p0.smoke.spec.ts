import { test, expect, openAs, apiJson, uniqueName, completeOpenTasks, stripBlock } from '../helpers/fixtures';

test.describe('P0 UI smoke', () => {
  test('U-AUTH-001 logged-out / redirects to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });

  test('U-AUTH-006 missing Google link redirects to settings', async ({ page, auth }) => {
    await openAs(page, auth.needsSettings);
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('U-AUTH-007 required filled without phases redirects to setup', async ({ page, auth }) => {
    await openAs(page, auth.needsPhases);
    await expect(page).toHaveURL(/\/setup\/phases/);
    await expect(page.getByRole('heading', { name: 'Set up your phases' })).toBeVisible();
  });

  test('U-CAL-001 onboarded user sees calendar chrome', async ({ page, auth }) => {
    await openAs(page, auth.onboarded);
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
    await expect(page.getByText('Now', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Schedule' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create task' })).toBeVisible();
    await expect(
      page.getByText('Failed to load calendar events. Please check your Google Calendar connection.'),
    ).toHaveCount(0);
  });

  test('U-TSK-002 create flexible task from calendar', async ({ page, auth }) => {
    await openAs(page, auth.onboarded);
    await page.getByRole('button', { name: 'Create task' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: /Name/ }).fill('E2E flexible task');
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByText('Task created')).toBeVisible();
  });

  test('U-CAL-004 generate schedule', async ({ page, auth }) => {
    test.setTimeout(90_000);
    await openAs(page, auth.onboarded);
    await page.getByRole('button', { name: 'Schedule' }).click();
    await page.getByRole('menuitem', { name: 'Generate schedule' }).click();
    await page
      .getByLabel('Schedule generation progress')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => undefined);
    await expect(page.getByText(/Schedule generated/)).toBeVisible({ timeout: 60_000 });
  });

  test('U-CAL-013 Now Done completes a timed app task', async ({ page, auth, request }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const name = uniqueName('E2E now block');
    const start = new Date(Date.now() - 5 * 60_000).toISOString();
    const end = new Date(Date.now() + 25 * 60_000).toISOString();
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name,
      eventType: 'fixed',
      estimatedTimeInMinutes: 30,
      scheduledStartTime: start,
      scheduledEndTime: end,
      timeZone: 'Europe/Kyiv',
    });
    expect(created.status).toBeGreaterThanOrEqual(200);
    expect(created.status).toBeLessThan(300);

    await openAs(page, auth.onboarded);
    const nowCard = stripBlock(page, name);
    await expect(nowCard).toBeVisible();
    await nowCard.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Task completed')).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test('U-HAB-004 calendar habit chip toggles today', async ({ page, auth, request }) => {
    const name = uniqueName('E2E water');
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/habits', {
      name,
      color: '#22c55e',
    });
    expect(created.status).toBeGreaterThanOrEqual(200);
    expect(created.status).toBeLessThan(300);

    await openAs(page, auth.onboarded);
    const chip = page.getByRole('button', { name, exact: true });
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('link', { name: 'All habits' })).toBeVisible();
  });
});
