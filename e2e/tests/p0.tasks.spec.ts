import {
  test,
  expect,
  openAs,
  apiJson,
  expectOk,
  uniqueName,
  openCreateTaskDialog,
} from '../helpers/fixtures';

test.describe('P0 tasks UI', () => {
  test('U-TSK-001 /tasks create defaults to Flexible', async ({ page, auth }) => {
    await openAs(page, auth.onboarded, '/tasks');
    const dialog = await openCreateTaskDialog(page);
    await expect(dialog.getByRole('button', { name: 'Flexible' })).toBeVisible();
    await expect(dialog.getByLabel(/Duration/)).toBeVisible();
    await expect(dialog.getByLabel(/^Start/)).toHaveCount(0);
  });

  test('U-TSK-003 fixed missing end is blocked with no POST', async ({ page, auth }) => {
    await openAs(page, auth.onboarded, '/tasks');
    const dialog = await openCreateTaskDialog(page);
    await dialog.getByRole('button', { name: 'Fixed' }).click();
    await dialog.getByRole('textbox', { name: /Name/ }).fill(uniqueName('E2E fixed missing end'));
    await dialog.locator('#task-form-start').fill('2030-06-15T10:00');

    let posted = false;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/tasks')) {
        posted = true;
      }
    });

    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(dialog.getByText('End time is required for fixed tasks')).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(posted).toBe(false);
  });

  test('U-TSK-004 fixed valid slot creates', async ({ page, auth }) => {
    await openAs(page, auth.onboarded, '/tasks');
    const dialog = await openCreateTaskDialog(page);
    const name = uniqueName('E2E fixed slot');
    await dialog.getByRole('button', { name: 'Fixed' }).click();
    await dialog.getByRole('textbox', { name: /Name/ }).fill(name);
    await dialog.locator('#task-form-start').fill('2030-06-15T10:00');
    await dialog.locator('#task-form-end').fill('2030-06-15T11:00');
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByText('Task created')).toBeVisible();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    const card = page.locator('.task-item').filter({ hasText: name });
    await expect(card.getByText('To Do', { exact: true })).toBeVisible();
    await expect(card.getByText('Medium', { exact: true })).toBeVisible();
  });

  test('U-TSK-005/006 recurring Daily Mon–Fri creates; empty pattern is auto-filled', async ({
    page,
    auth,
  }) => {
    await openAs(page, auth.onboarded, '/tasks');
    const dialog = await openCreateTaskDialog(page);
    await dialog.getByRole('button', { name: 'Recurring' }).click();
    await expect(dialog.locator('#task-form-recurrence')).toHaveValue('DAILY');
    await expect(dialog.getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: 'Fri' })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: 'Sat' })).toHaveAttribute('aria-pressed', 'false');

    const name = uniqueName('E2E recurring');
    await dialog.getByRole('textbox', { name: /Name/ }).fill(name);
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByText('Task created')).toBeVisible();
    await expect(page.getByRole('heading', { name })).toBeVisible();
  });

  test('U-TSK-007 unscheduled name-only lands in inbox', async ({ page, auth, request }) => {
    const name = uniqueName('E2E inbox');
    expectOk(
      await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
        name,
        isUnscheduled: true,
      }),
    );
    await openAs(page, auth.onboarded, '/tasks');
    await expect(page.getByRole('button', { name: 'Add unscheduled' })).toHaveCount(0);

    const inbox = page.locator('section').filter({ hasText: 'Unscheduled' }).first();
    const row = inbox.locator('.task-item').filter({ hasText: name });
    await expect(row.getByRole('heading', { name })).toBeVisible();
    await expect(row.getByText('Unscheduled', { exact: true })).toBeVisible();

    const dialog = await openCreateTaskDialog(page);
    await expect(dialog.getByRole('button', { name: 'Unscheduled', exact: true })).toHaveCount(0);
  });

  test('U-TSK-009 inbox Schedule saves without isUnscheduled', async ({ page, auth, request }) => {
    const name = uniqueName('E2E schedule me');
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name,
      isUnscheduled: true,
    });
    expectOk(created);

    await openAs(page, auth.onboarded, '/tasks');
    const row = page.locator('.task-item').filter({ hasText: name });
    await row.getByRole('button', { name: 'Schedule' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Schedule task')).toBeVisible();
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Task updated')).toBeVisible();

    const scheduled = page.locator('section').filter({ hasText: 'Scheduled' });
    await expect(scheduled.getByRole('heading', { name })).toBeVisible();
    await expect(row.getByText('Unscheduled', { exact: true })).toHaveCount(0);
  });

  test('U-TSK-010 inbox Done completes without a confirm dialog', async ({ page, auth, request }) => {
    const name = uniqueName('E2E inbox done');
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name,
      isUnscheduled: true,
    });
    expectOk(created);

    await openAs(page, auth.onboarded, '/tasks');
    const row = page.locator('.task-item').filter({ hasText: name });
    await row.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Task completed')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row).toHaveCount(0);
  });
});
