import { test, expect, openAs } from '../helpers/fixtures';

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
