import {
  test,
  expect,
  openAs,
  apiJson,
  expectOk,
  uniqueName,
  openCreateTaskDialog,
  expectMutationProgressToast,
  pickFixedSlot,
} from '../helpers/fixtures';

test.describe('P0 tasks UI', () => {
  test('U-TSK-001 /tasks create defaults to Flexible', async ({ page, auth }) => {
    await openAs(page, auth.onboarded, '/tasks');
    const dialog = await openCreateTaskDialog(page);
    await expect(dialog.getByRole('button', { name: 'Flexible', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('spinbutton', { name: /Duration/ })).toBeVisible();
    await expect(dialog.getByLabel(/^Start/)).toHaveCount(0);
    // Repeat is a property of the task, not a third type.
    await expect(dialog.getByRole('button', { name: 'Recurring' })).toHaveCount(0);
    await expect(dialog.locator('#task-form-recurrence')).toHaveValue('NONE');
  });

  test('U-TSK-003 fixed without a time is blocked with no POST', async ({ page, auth }) => {
    await openAs(page, auth.onboarded, '/tasks');
    const dialog = await openCreateTaskDialog(page);
    await dialog.getByRole('button', { name: 'Fixed', exact: true }).click();
    await dialog.getByRole('textbox', { name: /Name/ }).fill(uniqueName('E2E fixed no time'));

    let posted = false;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/tasks')) {
        posted = true;
      }
    });

    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(dialog.getByText('Start time is required for fixed tasks')).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(posted).toBe(false);
  });

  test('U-TSK-004 fixed valid slot creates', async ({ page, auth }) => {
    await openAs(page, auth.onboarded, '/tasks');
    const dialog = await openCreateTaskDialog(page);
    const name = uniqueName('E2E fixed slot');
    await dialog.getByRole('button', { name: 'Fixed', exact: true }).click();
    await dialog.getByRole('textbox', { name: /Name/ }).fill(name);
    await pickFixedSlot(page, dialog, '10');
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expectMutationProgressToast(page, name);
    await expect(page.getByRole('heading', { name })).toBeVisible();
    const card = page.locator('.task-item').filter({ hasText: name });
    await expect(card).toBeVisible();
    // Medium priority has no flag; status lives in the tabs, not on the row.
    await expect(card.getByText('Medium', { exact: true })).toHaveCount(0);
  });

  test('U-TSK-005/006 recurring Daily Mon–Fri creates; empty pattern is auto-filled', async ({
    page,
    auth,
  }) => {
    await openAs(page, auth.onboarded, '/tasks');
    const dialog = await openCreateTaskDialog(page);
    // Repeat is a property, not a task type: the flexible default plus the Repeat select.
    await dialog.locator('#task-form-recurrence').selectOption('DAILY');
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
    await openAs(page, auth.onboarded, '/tasks?tab=later');
    await expect(page.getByRole('button', { name: 'Add unscheduled' })).toHaveCount(0);

    const row = page.locator('.task-item').filter({ hasText: name });
    await expect(row.getByRole('heading', { name })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Schedule', exact: true })).toBeVisible();

    const dialog = await openCreateTaskDialog(page);
    await expect(dialog.getByRole('button', { name: 'Later', exact: true })).toBeVisible();
  });

  test('U-TSK-009 inbox Do now clears unscheduled', async ({ page, auth, request }) => {
    const name = uniqueName('E2E do now');
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name,
      isUnscheduled: true,
    });
    expectOk(created);

    await openAs(page, auth.onboarded, '/tasks?tab=later');
    const row = page.locator('.task-item').filter({ hasText: name });
    await row.getByRole('button', { name: 'Do now', exact: true }).click();
    await expectMutationProgressToast(page, name);

    await expect(row).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole('tab', { name: 'Scheduled' }).click();
    await expect(page.locator('.task-item').filter({ hasText: name }).getByRole('heading', { name })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('U-TSK-010 inbox Done completes without a confirm dialog', async ({ page, auth, request }) => {
    const name = uniqueName('E2E inbox done');
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name,
      isUnscheduled: true,
    });
    expectOk(created);

    await openAs(page, auth.onboarded, '/tasks?tab=later');
    const row = page.locator('.task-item').filter({ hasText: name });
    await row.getByRole('button', { name: 'Done', exact: true }).click();
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

    await openAs(page, auth.onboarded, '/tasks?tab=later');
    const row = page.locator('.task-item').filter({ hasText: name });
    await row.getByRole('button', { name: 'Skip', exact: true }).click();
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

    await openAs(page, auth.onboarded, '/tasks?tab=later');
    const row = page.locator('.task-item').filter({ hasText: name });
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('textbox', { name: /Name/ })).toHaveValue(name);
  });

  test('U-TSK-024 Later Schedule opens the slot sheet', async ({ page, auth, request }) => {
    const name = uniqueName('E2E inbox schedule');
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name,
      isUnscheduled: true,
    });
    expectOk(created);

    await openAs(page, auth.onboarded, '/tasks?tab=later');
    const row = page.locator('.task-item').filter({ hasText: name });
    await row.getByRole('button', { name: 'Schedule', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Schedule' });
    await expect(dialog).toBeVisible();
    // The name shows in the sheet header (and again in the slot preview once it loads).
    await expect(dialog.getByText(name, { exact: true }).first()).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Place( |$)/ })).toBeVisible();
  });

  test('U-TSK-025 edit modal delete removes a one-off task', async ({ page, auth, request }) => {
    const name = uniqueName('E2E edit delete');
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name,
      isUnscheduled: true,
    });
    expectOk(created);

    await openAs(page, auth.onboarded, '/tasks?tab=later');
    const row = page.locator('.task-item').filter({ hasText: name });
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Edit task' });
    await editor.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete task' });
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expectMutationProgressToast(page, name);
    await expect(row).toHaveCount(0);
  });
});
