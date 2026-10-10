import {
  test,
  expect,
  openAs,
  apiJson,
  expectOk,
  uniqueName,
  openCreateTaskDialog,
  expectMutationProgressToast,
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
    await expectMutationProgressToast(page, name);
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
    await expectMutationProgressToast(page, name);
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
    await expect(row.getByLabel('Unscheduled', { exact: true })).toBeVisible();

    const dialog = await openCreateTaskDialog(page);
    await expect(dialog.getByRole('button', { name: 'Unscheduled', exact: true })).toBeVisible();
  });

  test('U-TSK-009 inbox Do now clears unscheduled', async ({ page, auth, request }) => {
    const name = uniqueName('E2E do now');
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name,
      isUnscheduled: true,
    });
    expectOk(created);

    await openAs(page, auth.onboarded, '/tasks');
    const row = page.locator('.task-item').filter({ hasText: name });
    await row.getByRole('button', { name: 'Do now' }).click();
    await expectMutationProgressToast(page, name);

    const scheduled = page.locator('section').filter({ hasText: 'Scheduled' });
    await expect(scheduled.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 });
    await expect(row.getByLabel('Unscheduled', { exact: true })).toHaveCount(0);
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
    await expectMutationProgressToast(page, name);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row).toHaveCount(0);
  });

  test('U-TSK-011 inbox Skip cancels without a confirm dialog', async ({ page, auth, request }) => {
    const name = uniqueName('E2E inbox skip');
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name,
      isUnscheduled: true,
    });
    expectOk(created);

    await openAs(page, auth.onboarded, '/tasks');
    const row = page.locator('.task-item').filter({ hasText: name });
    await row.getByRole('button', { name: 'Skip' }).click();
    await expectMutationProgressToast(page, name);
    await expect(row).toHaveCount(0);
  });

  test('U-TSK-012 inbox Open opens the editor', async ({ page, auth, request }) => {
    const name = uniqueName('E2E inbox open');
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name,
      isUnscheduled: true,
    });
    expectOk(created);

    await openAs(page, auth.onboarded, '/tasks');
    const row = page.locator('.task-item').filter({ hasText: name });
    await row.getByRole('button', { name: 'Open' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('textbox', { name: /Name/ })).toHaveValue(name);
  });

  test('U-TSK-024 inbox Schedule opens the schedule form', async ({ page, auth, request }) => {
    const name = uniqueName('E2E inbox schedule');
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name,
      isUnscheduled: true,
    });
    expectOk(created);

    await openAs(page, auth.onboarded, '/tasks');
    const row = page.locator('.task-item').filter({ hasText: name });
    await row.getByRole('button', { name: 'Schedule' }).click();
    const dialog = page.getByRole('dialog', { name: 'Schedule task' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: /Name/ })).toHaveValue(name);
    await expect(dialog.getByText('Phase', { exact: true })).toBeVisible();
  });

  test('U-TSK-025 edit modal delete removes a one-off task', async ({ page, auth, request }) => {
    const name = uniqueName('E2E edit delete');
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name,
      isUnscheduled: true,
    });
    expectOk(created);

    await openAs(page, auth.onboarded, '/tasks');
    const row = page.locator('.task-item').filter({ hasText: name });
    await row.getByRole('button', { name: 'Open' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit task' });
    await editor.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete task' });
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expectMutationProgressToast(page, name);
    await expect(row).toHaveCount(0);
  });
});
