import { test, expect, openAs } from '../helpers/fixtures';

test.describe('P1 auth and phases UI', () => {
  test('U-AUTH-003 login error query shows a message', async ({ page }) => {
    await page.goto('/login?error=access_denied');
    await expect(page.getByText('Google sign-in failed. Try again.')).toBeVisible();
  });

  test('U-AUTH-008 settings stay reachable when required is empty', async ({ page, auth }) => {
    await openAs(page, auth.needsSettings, '/settings');
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('U-AUTH-009 phase setup stays reachable without phases', async ({ page, auth }) => {
    await openAs(page, auth.needsPhases, '/setup/phases');
    await expect(page).toHaveURL(/\/setup\/phases/);
    await expect(page.getByRole('heading', { name: 'When do you wake and sleep?' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  });

  test('U-PH-001 /phases opens Settings → My day; Focus hours stays hidden', async ({ page, auth }) => {
    await openAs(page, auth.onboarded, '/phases');
    await expect(page).toHaveURL(/\/settings\/day/);
    await expect(page.getByRole('heading', { name: 'Phases' })).toBeVisible();
    await expect(page.getByText('Bedtime', { exact: true })).toBeVisible();
    await expect(page.getByText('Focus hours', { exact: true })).toHaveCount(0);
  });

  test('U-ONB-003 empty weekday picker blocks Save', async ({ page, auth }) => {
    await openAs(page, auth.needsPhases, '/setup/phases');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Set up your phases' })).toBeVisible();
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
      await page.getByRole('button', { name: day, exact: true }).click();
    }
    await expect(page.getByText('Select at least one day')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save and create phases' })).toBeDisabled();
  });

  test('U-ONB-004 setup-defaults error is surfaced', async ({ page, auth }) => {
    await page.route('**/phases/setup-defaults', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Default phases already exist for this user' }),
      });
    });
    await openAs(page, auth.needsPhases, '/setup/phases');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Skip — default phases' }).click();
    await expect(page.getByText('Could not create phases')).toBeVisible();
  });

  test('U-NAV-001 header routes match labels', async ({ page, auth }) => {
    await openAs(page, auth.onboarded);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Tasks' }).click();
    await expect(page).toHaveURL(/\/tasks/);
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Phases' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Habits' })).toHaveCount(0);
    await nav.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await nav.getByRole('link', { name: 'Calendar' }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  });
});
