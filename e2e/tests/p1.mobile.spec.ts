import type { Locator, Page } from '@playwright/test';
import { test, expect, openAs, apiJson, expectOk, uniqueName, completeOpenTasks } from '../helpers/fixtures';

async function painted(locator: Locator) {
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    return { height: rect.height, visible: Math.max(0, visible) };
  });
}

async function expectHoursOnScreen(page: Page, label: string) {
  const hours = page.getByTestId('calendar-hour-scroll');
  await expect(hours).toBeVisible();
  const box = await painted(hours);
  expect(box.height, label).toBeGreaterThan(120);
  const slot = hours.getByText('08:00', { exact: true });
  await slot.scrollIntoViewIfNeeded();
  const slotBox = await painted(slot);
  expect(slotBox.visible, `${label} 08:00`).toBeGreaterThan(4);
  const later = hours.getByText('20:00', { exact: true });
  await later.scrollIntoViewIfNeeded();
  const laterBox = await painted(later);
  expect(laterBox.visible, `${label} 20:00`).toBeGreaterThan(4);
}

test.describe('phone layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('U-CAL-017 day fills the screen, week stays one column, tasks stay reachable', async ({ page, auth }) => {
    await openAs(page, auth.onboarded);
    await expect(page.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const hours = page.getByTestId('calendar-hour-scroll');
    await expect(hours).toBeVisible();

    const day = await page.evaluate(() => {
      const main = document.querySelector('main');
      const node = document.querySelector('[data-testid="calendar-hour-scroll"]');
      if (!main || !(node instanceof HTMLElement)) return null;
      const mainBox = main.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      const visible = Math.min(box.bottom, mainBox.bottom) - Math.max(box.top, mainBox.top);
      return {
        mainScroll: main.scrollTop,
        visible,
        pageWider: document.documentElement.scrollWidth > window.innerWidth + 2,
      };
    });
    expect(day).toBeTruthy();
    expect(day!.mainScroll).toBe(0);
    expect(day!.visible).toBeGreaterThan(160);
    expect(day!.pageWider).toBe(false);

    await page.getByRole('button', { name: 'Week', exact: true }).click();
    const grid = page.getByTestId('calendar-time-grid');
    await expect(grid).toBeVisible();
    const weekFits = await grid.evaluate((node) => node.scrollWidth <= node.clientWidth + 2);
    expect(weekFits).toBe(true);

    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await page.getByRole('button', { name: /^Show / }).first().click();
    await expect(page.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(hours).toBeVisible();

    await page.getByRole('button', { name: 'Events', exact: true }).click();
    const eventsDialog = page.getByRole('dialog').filter({ hasText: /events|No events found/i });
    await expect(eventsDialog).toBeVisible();
    await page.getByRole('button', { name: 'Close modal' }).click();

    await page.getByRole('link', { name: 'Tasks' }).click();
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();

    await page.getByRole('link', { name: 'Settings' }).click();
    const signOut = page.getByRole('button', { name: 'Sign out' });
    await signOut.scrollIntoViewIfNeeded();
    const signBox = await signOut.boundingBox();
    const navBox = await page.getByRole('navigation', { name: 'Main' }).boundingBox();
    expect(signBox).toBeTruthy();
    expect(navBox).toBeTruthy();
    expect(signBox!.y + signBox!.height).toBeLessThanOrEqual(navBox!.y + 2);
    const build = page.getByRole('main').getByText(/^Build /);
    await build.scrollIntoViewIfNeeded();
    await expect(build).toBeVisible();
  });

  test('U-CAL-024 create, voice, and generate are one tap', async ({ page, auth, request }) => {
    const name = uniqueName('Phone pill');
    expectOk(
      await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
        name,
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
      }),
    );
    await openAs(page, auth.onboarded);

    await expect(page.getByRole('button', { name: 'Create task', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add task by voice', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate schedule', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Create task', exact: true }).click();
    const createDialog = page.getByRole('dialog');
    await expect(createDialog.getByRole('textbox', { name: /Name/ })).toBeVisible();
    await expect(createDialog.getByRole('button', { name: 'Unscheduled', exact: true })).toHaveCount(0);
    await createDialog.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Generate schedule', exact: true }).click();
    await expect(page.getByRole('dialog').filter({ hasText: 'Generate preview' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'More schedule actions' }).click();
    const more = page.getByRole('dialog').filter({ hasText: 'Suggestions' });
    await expect(more.getByRole('button', { name: 'Suggestions' })).toBeVisible();
    await page.getByRole('button', { name: 'Close modal' }).click({ force: true });
    await expect(more).toHaveCount(0);

    await page.getByRole('link', { name: 'Tasks' }).click();
    await expect(page.getByRole('button', { name: 'Create task', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add task by voice', exact: true })).toBeVisible();
    const card = page.locator('.task-item').filter({ hasText: name });
    await expect(card.getByText('To Do', { exact: true })).toBeVisible();
    await expect(card.getByText('Medium', { exact: true })).toBeVisible();

    const scheduled = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Scheduled', exact: true }) });
    const searchBox = await scheduled.getByRole('searchbox', { name: 'Search scheduled' }).boundingBox();
    const filterBox = await scheduled.getByRole('button', { name: 'Filters' }).boundingBox();
    expect(searchBox).toBeTruthy();
    expect(filterBox).toBeTruthy();
    expect(Math.abs(searchBox!.y - filterBox!.y)).toBeLessThan(12);

    await page.getByRole('button', { name: 'Create task', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('textbox', { name: /Name/ })).toBeVisible();
  });

  test('320px phone does not scroll sideways and still shows hours', async ({ page, auth }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openAs(page, auth.onboarded);
    const hours = page.getByTestId('calendar-hour-scroll');
    await expect(hours).toBeVisible();
    const fit = await page.evaluate(() => {
      const main = document.querySelector('main');
      const node = document.querySelector('[data-testid="calendar-hour-scroll"]');
      if (!main || !(node instanceof HTMLElement)) return null;
      const mainBox = main.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      return {
        pageWider: document.documentElement.scrollWidth > window.innerWidth + 2,
        visible: Math.min(box.bottom, mainBox.bottom) - Math.max(box.top, mainBox.top),
      };
    });
    expect(fit).toBeTruthy();
    expect(fit!.pageWider).toBe(false);
    expect(fit!.visible).toBeGreaterThan(160);
  });
});

test.describe('week columns from 768px', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('seven day columns stay in the week grid', async ({ page, auth }) => {
    await openAs(page, auth.onboarded);
    const grid = page.getByTestId('calendar-time-grid');
    await expect(grid).toBeVisible();
    const minWidth = await grid.evaluate((node) => {
      const wide = node.querySelector<HTMLElement>('[style*="min-width"]');
      return wide ? Number.parseFloat(wide.style.minWidth) : 0;
    });
    expect(minWidth).toBeGreaterThan(600);
  });
});

test.describe('widths between the phone and desktop layouts', () => {
  test('U-CAL-023 calendar stays visible from 1024px through 1279px', async ({ page, auth, request }) => {
    expectOk(
      await apiJson(request, auth.onboarded.access_token, 'patch', '/user-settings', {
        wakeTime: '08:00',
        sleepTime: '23:00',
        timeZone: 'Europe/Kyiv',
      }),
    );
    await completeOpenTasks(request, auth.onboarded.access_token);
    const phasesListed = await apiJson(request, auth.onboarded.access_token, 'get', '/phases');
    expectOk(phasesListed);
    for (const phase of Array.isArray(phasesListed.body) ? phasesListed.body : []) {
      if (!phase?.id || phase.type !== 'time_phase') continue;
      expectOk(
        await apiJson(request, auth.onboarded.access_token, 'patch', `/phases/${phase.id}`, {
          startTime: '08:00',
          endTime: '23:00',
          weekDays: [0, 1, 2, 3, 4, 5, 6],
        }),
      );
    }
    await openAs(page, auth.onboarded);
    const sizes = [
      { width: 1024, height: 700 },
      { width: 1100, height: 800 },
      { width: 1279, height: 768 },
    ];

    for (const viewport of sizes) {
      await page.setViewportSize(viewport);
      const label = `${viewport.width}x${viewport.height} week`;
      await expectHoursOnScreen(page, label);
    }

    await page.setViewportSize({ width: 1024, height: 700 });
    const events = page.getByText(/Week events|No events found for this period/);
    await events.scrollIntoViewIfNeeded();
    const eventsBox = await painted(events);
    expect(eventsBox.visible).toBeGreaterThan(8);

    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await expectHoursOnScreen(page, '1024x700 day');

    await page.setViewportSize({ width: 1100, height: 800 });
    await page.getByRole('button', { name: 'Month', exact: true }).click();
    const month = page.getByTestId('calendar-month-grid');
    await month.scrollIntoViewIfNeeded();
    await expect(month).toBeVisible();
    const monthBox = await painted(month);
    expect(monthBox.height).toBeGreaterThan(120);
    expect(monthBox.visible).toBeGreaterThan(40);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    const hours = page.getByTestId('calendar-hour-scroll');
    await hours.scrollIntoViewIfNeeded();
    const desktop = await painted(hours);
    expect(desktop.height).toBeGreaterThan(40);
    expect(desktop.visible).toBeGreaterThan(40);
  });
});
