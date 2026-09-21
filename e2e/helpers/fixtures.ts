import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
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
  await page.getByRole('button', { name: 'Create task' }).click();
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
  return page.locator('li, .rounded-md.border').filter({ hasText: name });
}

export function skippableStripCard(page: Page, name: string) {
  return page
    .locator('div.rounded-md.border')
    .filter({ hasText: name })
    .filter({ has: page.getByRole('button', { name: 'Skip' }) });
}

export async function waitForScheduleJob(
  request: APIRequestContext,
  token: string,
  jobId?: string | null,
): Promise<void> {
  if (!jobId) return;
  for (let i = 0; i < 40; i++) {
    const job = await apiJson(request, token, 'get', `/schedule-jobs/${jobId}`);
    if (job.body?.status === 'done' || job.body?.status === 'failed') return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

