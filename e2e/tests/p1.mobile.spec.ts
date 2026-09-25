import type { Locator, Page } from '@playwright/test';
import { test, expect, openAs } from '../helpers/fixtures';

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

  test('U-CAL-017 day fits, week scrolls sideways, tasks stay reachable', async ({ page, auth }) => {
    await openAs(page, auth.onboarded);
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    const grid = page.getByTestId('calendar-time-grid');
    await expect(grid).toBeAttached();

    const day = await page.evaluate(() => {
      const main = document.querySelector('main');
      const header = document.querySelector('header');
      const node = document.querySelector('[data-testid="calendar-time-grid"]');
      if (!main || !header || !(node instanceof HTMLElement)) return null;
      const delta = node.getBoundingClientRect().top - main.getBoundingClientRect().top;
      main.scrollTop += delta;
      const mainBox = main.getBoundingClientRect();
      const headerBox = header.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      return {
        overflowY: getComputedStyle(main).overflowY,
        headerPosition: getComputedStyle(header).position,
        mainScrolls: main.scrollHeight > main.clientHeight + 8,
        headerAboveMain: headerBox.bottom <= mainBox.top + 1,
        gridAligned: Math.abs(box.top - mainBox.top) <= 2,
        gridFitsWidth: node.scrollWidth <= node.clientWidth + 2,
        pageWider: document.documentElement.scrollWidth > window.innerWidth + 2,
      };
    });
    expect(day).toBeTruthy();
    expect(day!.overflowY).toBe('auto');
    expect(day!.headerPosition).not.toBe('fixed');
    expect(day!.mainScrolls).toBe(true);
    expect(day!.headerAboveMain).toBe(true);
    expect(day!.gridAligned).toBe(true);
    expect(day!.gridFitsWidth).toBe(true);
    expect(day!.pageWider).toBe(false);

    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(grid).toBeVisible();
    const weekWider = await grid.evaluate((node) => node.scrollWidth > node.clientWidth + 8);
    expect(weekWider).toBe(true);
    await grid.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });
    const scrolled = await grid.evaluate((node) => node.scrollLeft > 8);
    expect(scrolled).toBe(true);

    await page.getByRole('link', { name: 'Tasks' }).click();
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
    const tasks = await page.evaluate(() => {
      const main = document.querySelector('main');
      const header = document.querySelector('header');
      const title = document.querySelector('h1');
      if (!main || !header || !title) return null;
      return {
        titleTop: title.getBoundingClientRect().top,
        headerBottom: header.getBoundingClientRect().bottom,
        overflowY: getComputedStyle(main).overflowY,
      };
    });
    expect(tasks!.titleTop).toBeGreaterThanOrEqual(tasks!.headerBottom - 1);
    expect(tasks!.overflowY).toBe('auto');
  });
});

test.describe('widths between the phone and desktop layouts', () => {
  test('U-CAL-023 calendar stays visible from 1024px through 1279px', async ({ page, auth }) => {
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
