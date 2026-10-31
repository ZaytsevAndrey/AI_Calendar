import { test as base, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { API_BASE } from '../constants';
import { readAuthFile, seedBrowserAuth, type TokenPair } from './auth';

export { expect };

export const test = base.extend<{
  auth: ReturnType<typeof readAuthFile>;
}>({
  auth: async ({}, use) => {
    await use(readAuthFile());
  },
});

export async function openAs(page: Page, tokens: TokenPair, path = '/') {
  await seedBrowserAuth(page, tokens);
  await page.goto(path);
}

export async function apiJson(
  request: APIRequestContext,
  token: string,
  method: 'get' | 'post' | 'patch' | 'delete',
  urlPath: string,
  data?: unknown,
) {
  const response = await request[method](`${API_BASE}${urlPath}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status(), body };
}

export function expectOk(result: { status: number }): void {
  expect(result.status, JSON.stringify(result.body)).toBeGreaterThanOrEqual(200);
  expect(result.status).toBeLessThan(300);
}

export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}`;
}

export async function openCreateTaskDialog(page: Page) {
  await page.locator('header').getByRole('button', { name: 'Create task' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Shared SQLite keeps leftover time phases; they wrap the Day legend and block hour clicks. */
export async function deleteUnusedTimePhases(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  const tasksListed = await apiJson(request, token, 'get', '/tasks');
  expectOk(tasksListed);
  const usedPhaseIds = new Set<string>();
  for (const task of Array.isArray(tasksListed.body) ? tasksListed.body : []) {
    if (typeof task?.phaseId === 'string' && task.phaseId) usedPhaseIds.add(task.phaseId);
    for (const id of Array.isArray(task?.phaseIds) ? task.phaseIds : []) {
      if (typeof id === 'string' && id) usedPhaseIds.add(id);
    }
  }

  const listed = await apiJson(request, token, 'get', '/phases');
  expectOk(listed);
  const phases = Array.isArray(listed.body) ? listed.body : [];
  for (const phase of phases) {
    if (!phase?.id || phase.type !== 'time_phase' || usedPhaseIds.has(phase.id)) continue;
    const deleted = await apiJson(request, token, 'delete', `/phases/${phase.id}`);
    if (deleted.status === 409) continue;
    expectOk(deleted);
  }
}

export async function completeOpenTasks(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  const listed = await apiJson(request, token, 'get', '/tasks');
  expectOk(listed);
  const tasks = Array.isArray(listed.body) ? listed.body : [];
  for (const task of tasks) {
    if (!task?.id || task.status === 'completed' || task.status === 'canceled') {
      continue;
    }
    await apiJson(request, token, 'patch', `/tasks/${task.id}`, { status: 'completed' });
  }
}

export function stripBlock(page: Page, name: string) {
  // Now/Next cards only — not Generate warning <li> rows that quote the task name.
  return page.getByTestId('now-strip-card').filter({ hasText: name });
}

export function skippableStripCard(page: Page, name: string) {
  return page
    .getByTestId('now-strip-card')
    .filter({ hasText: name })
    .filter({ has: page.getByRole('button', { name: 'Skip' }) });
}

export async function waitForScheduleJob(
  request: APIRequestContext,
  token: string,
  jobId?: string | null,
): Promise<void> {
  if (!jobId || typeof jobId !== 'string') return;
  for (let i = 0; i < 80; i++) {
    const job = await apiJson(request, token, 'get', `/schedule-jobs/${jobId}`);
    if (job.body?.status === 'done' || job.body?.status === 'failed') return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Schedule job ${jobId} did not finish in time`);
}

/**
 * Task create/update/do-now/done/skip end with one result toast (title = task
 * name); the stages before it show on the calendar card, not in a toast.
 */
export async function expectMutationProgressToast(
  page: Page,
  title?: string | RegExp,
): Promise<void> {
  const toast = page.locator('.Toastify__toast.app-toast-stage-done').filter({
    has: page.locator('.app-toast-body'),
  });
  // Prefer the toast for this task — leftovers from prior mutations can still be open.
  const scoped = title
    ? toast.filter({
        has: page.locator('.app-toast-title').filter({ hasText: title }),
      })
    : toast;
  await expect(scoped.first()).toBeVisible({ timeout: 30_000 });
}

/**
 * The problematic block lives in «Today»: the side panel on wide screens, the sheet behind
 * the Today bar on a phone, the panel button in between. Opens it when needed.
 */
export async function problematicRegion(page: Page, timeout = 15_000) {
  const region = page.getByRole('region', { name: 'Tasks that fell out of the schedule' });
  const toggle = page.getByRole('button', { name: /^(Today panel|Open Today)$/ }).first();
  await expect(toggle).toBeVisible({ timeout });
  if (!(await region.isVisible())) {
    const pressed = await toggle.getAttribute('aria-pressed');
    if (pressed !== 'true') await toggle.click();
  }
  await expect(region).toBeVisible({ timeout });
  return region;
}

/**
 * Fixed slot through the shared DateTimeRangeField: open «When», go one month
 * ahead, pick the 15th, then the start hour. The end follows at the default
 * duration. Returns the picked civil day.
 */
export async function pickFixedSlot(page: Page, dialog: Locator, startHour: string) {
  await dialog.locator('#task-form-slot').click();
  await page.getByRole('button', { name: 'Next month' }).click();
  const day = page.locator('[data-ymd$="-15"]').first();
  const ymd = (await day.getAttribute('data-ymd')) ?? '';
  await day.click();
  await page.getByRole('option', { name: startHour, exact: true }).first().click();
  await page.keyboard.press('Escape');
  await expect(dialog.locator('#task-form-slot')).toContainText(`${startHour}:`);
  return ymd;
}

/** One civil day in a DateRangeField (`fieldId`): open it, find the month, click the day twice. */
export async function pickDayRange(page: Page, dialog: Locator, fieldId: string, ymd: string) {
  await dialog.locator(`#${fieldId}`).click();
  const day = page.locator(`[data-ymd="${ymd}"]`).first();
  for (let i = 0; i < 3 && !(await day.isVisible()); i += 1) {
    await page.getByRole('button', { name: 'Next month' }).click();
  }
  await day.click();
  if (await day.isVisible()) await day.click();
  if (await page.locator(`[data-ymd="${ymd}"]`).first().isVisible()) await page.keyboard.press('Escape');
}
