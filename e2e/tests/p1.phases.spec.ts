import { test, expect, openAs, apiJson, expectOk, uniqueName } from '../helpers/fixtures';

async function createTimePhase(
  request: Parameters<typeof apiJson>[0],
  token: string,
  name: string,
  startTime = '10:00',
  endTime = '12:00',
) {
  const created = await apiJson(request, token, 'post', '/phases', {
    name,
    color: '#3366ff',
    startTime,
    endTime,
    weekDays: [1, 2, 3, 4, 5],
    type: 'time_phase',
  });
  expectOk(created);
  return created.body as { id: string; name: string; startTime: string; endTime: string };
}

test.describe('P1 phases UI', () => {
  test.beforeEach(async ({ auth, request }) => {
    expectOk(
      await apiJson(request, auth.onboarded.access_token, 'patch', '/user-settings', {
        wakeTime: '08:00',
        sleepTime: '23:00',
        googleCalendarLinked: true,
      }),
    );
  });
  test('U-PH-002 valid create appears on the list and grid', async ({ page, auth }) => {
    const name = uniqueName('P1 deep work');
    await openAs(page, auth.onboarded, '/phases');
    await page.getByRole('button', { name: 'Add Phase' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('#name').fill(name);
    await dialog.locator('#colorText').fill('#3366ff');
    await dialog.getByRole('button', { name: 'Create Phase' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.category-name').filter({ hasText: name })).toBeVisible();
    await expect(page.locator('#phase-col-1').getByText(name, { exact: true })).toBeVisible();
  });

  test('U-PH-003 phase outside wake–sleep is blocked on the client', async ({
    page,
    auth,
    request,
  }) => {
    try {
      expectOk(
        await apiJson(request, auth.onboarded.access_token, 'patch', '/user-settings', {
          wakeTime: '10:00',
          sleepTime: '11:00',
        }),
      );
      await openAs(page, auth.onboarded, '/phases');
      await page.getByRole('button', { name: 'Add Phase' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('#name').fill(uniqueName('P1 outside window'));
      await expect(dialog.getByText('Phase cannot be outside of active day time!')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Create Phase' })).toBeDisabled();
    } finally {
      await apiJson(request, auth.onboarded.access_token, 'patch', '/user-settings', {
        wakeTime: '08:00',
        sleepTime: '23:00',
      });
    }
  });

  test('U-PH-004 drag updates phase times', async ({ page, auth, request }) => {
    const name = uniqueName('P1 drag');
    await createTimePhase(request, auth.onboarded.access_token, name, '10:00', '12:00');
    await openAs(page, auth.onboarded, '/phases');
    const block = page.locator('#phase-col-1').locator('.absolute').filter({ hasText: name }).first();
    await expect(block).toBeVisible();
    const handle = block.locator('.cursor-ns-resize').last();
    const patched = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && /\/phases\/[^/]+$/.test(new URL(response.url()).pathname),
    );
    await handle.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const fire = (type: string, clientY: number, buttons: number, target: EventTarget) => {
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: x,
            clientY,
            buttons,
          }),
        );
      };
      fire('pointerdown', y, 1, el);
      for (let step = 1; step <= 8; step += 1) {
        fire('pointermove', y + step * 10, 1, window);
      }
      fire('pointerup', y + 80, 0, window);
    });
    await patched;
    const listed = await apiJson(request, auth.onboarded.access_token, 'get', `/phases`);
    expectOk(listed);
    const row = (listed.body as Array<{ name: string; startTime: string; endTime: string }>).find(
      (phase) => phase.name === name,
    );
    expect(row).toBeTruthy();
    expect(`${row!.startTime}-${row!.endTime}`).not.toBe('10:00-12:00');
  });

  test('U-PH-005 delete confirm removes an unused phase', async ({ page, auth, request }) => {
    const name = uniqueName('P1 delete phase');
    await createTimePhase(request, auth.onboarded.access_token, name);
    await openAs(page, auth.onboarded, '/phases');
    const card = page.locator('article.phase-card').filter({ hasText: name });
    page.once('dialog', (dialog) => dialog.accept());
    await card.getByRole('button', { name: 'Delete' }).click();
    await expect(card).toHaveCount(0);
  });
});
