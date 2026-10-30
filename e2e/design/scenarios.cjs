// Screens and states for e2e/design/shots.cjs.
// Each scenario: { name, route, scenario?, auth?, sizes?, langs?, full?, run?(page, ctx) }.
// Prefer data-testid hooks; text selectors take both languages via L(uk, en).

const L = (uk, en) => new RegExp(`^(${uk}|${en})$`, 'i');
const desk = ['d', 'xl', 't'];
const phone = ['m', 'xs'];

async function openToday(page) {
  const region = page.locator('#today-later');
  if (await region.isVisible()) return;
  await openFirst(page, 'button[aria-label="Панель «Сьогодні»"], button[aria-label="Today panel"], [data-testid="today-bar"]');
}

async function openFirst(page, selector) {
  await page.locator(selector).first().click({ timeout: 8000 });
  await page.waitForTimeout(500);
}

const scenarios = [
  { name: 'login', route: '/login', auth: false },
  { name: 'setup-wake', route: '/setup/phases', scenario: 'needsPhases' },
  {
    name: 'setup-phases',
    route: '/setup/phases',
    scenario: 'needsPhases',
    run: async (page) => {
      await page.getByRole('button', { name: /Далі|Next|Continue/ }).first().click();
    },
  },
  { name: 'calendar', route: '/' },
  { name: 'calendar-empty', route: '/', scenario: 'empty' },
  { name: 'calendar-coachmark', route: '/', hints: true, sizes: ['d', 'm'] },
  {
    name: 'calendar-day',
    route: '/',
    sizes: desk,
    run: async (page) => page.getByRole('button', { name: L('День', 'Day') }).first().click(),
  },
  {
    name: 'calendar-month',
    route: '/',
    run: async (page, { mobile }) => {
      await page.getByRole('button', { name: L('Місяць', 'Month') }).first().click();
    },
  },
  {
    name: 'calendar-3day',
    route: '/',
    sizes: phone,
    run: async (page) => page.getByRole('button', { name: L('3 дні', '3 days') }).first().click(),
  },
  {
    name: 'calendar-panel-closed',
    route: '/',
    sizes: ['xl'],
    run: async (page) => page.getByRole('button', { name: L('Сховати панель', 'Hide panel') }).first().click(),
  },
  {
    name: 'today-sheet',
    route: '/',
    sizes: phone,
    run: async (page) => openFirst(page, '[data-testid="today-bar"], section button[aria-expanded="false"]'),
  },
  {
    name: 'create-task',
    route: '/',
    run: async (page) => openFirst(page, '[data-testid="create-task"], button:has-text("Створити"), button:has-text("Create")'),
  },
  {
    name: 'picker-datetime',
    route: '/',
    run: async (page) => {
      await openFirst(page, '[data-testid="create-task"], button:has-text("Створити"), button:has-text("Create")');
      await openFirst(page, '#task-form-slot');
    },
  },
  {
    name: 'picker-time',
    route: '/',
    run: async (page) => {
      await openFirst(page, '[data-testid="create-task"], button:has-text("Створити"), button:has-text("Create")');
      await openFirst(page, '#task-form-slot');
      await page.getByRole('tab').nth(1).click();
      await page.waitForTimeout(300);
    },
  },
  {
    name: 'picker-goto-date',
    route: '/',
    run: async (page) => openFirst(page, 'button[aria-haspopup="dialog"][aria-label*="дат"], button[aria-haspopup="dialog"][aria-label*="date"]'),
  },
  {
    name: 'problematic',
    route: '/',
    run: async (page) => {
      await openToday(page);
      await page.getByRole('button', { name: L('Переглянути', 'Review') }).last().click();
      await page.waitForTimeout(600);
    },
  },
  {
    name: 'problematic-more',
    route: '/',
    run: async (page) => {
      await openToday(page);
      await page.getByRole('button', { name: L('Переглянути', 'Review') }).last().click();
      await page.waitForTimeout(600);
      await page.getByRole('button', { name: L('Інші дії', 'More actions') }).last().click();
      await page.waitForTimeout(300);
    },
  },
  {
    name: 'plan-later',
    route: '/',
    run: async (page) => {
      await openToday(page);
      await page.locator('#today-later').getByRole('button', { name: L('Запланувати', 'Schedule') }).first().click();
      await page.waitForTimeout(800);
    },
  },
  {
    name: 'calendars-menu',
    route: '/',
    sizes: desk,
    run: async (page) => openFirst(page, '[data-testid="calendars-menu"], button:has-text("Календарі"), button:has-text("Calendars")'),
  },
  {
    name: 'event-preview',
    route: '/',
    run: async (page, { mobile }) => {
      await page.locator('[data-testid^="calendar-event-"] [role="button"]').first().click();
      await page.waitForTimeout(600);
    },
  },
  {
    name: 'edit-task',
    route: '/tasks',
    run: async (page) => {
      await page.locator('.task-item h3 button').first().click();
      await page.waitForTimeout(800);
    },
  },
  {
    name: 'voice',
    route: '/',
    run: async (page) => {
      await page.getByRole('button', { name: L('Відкрити Помічника', 'Open Companion') }).first().click();
      await page.waitForTimeout(800);
    },
  },
  {
    name: 'reminder-form',
    route: '/',
    run: async (page) => {
      await openFirst(page, '[data-testid="create-task"], button:has-text("Створити"), button:has-text("Create")');
      await page.getByRole('button', { name: L('Нагадування', 'Reminder') }).last().click();
      await page.waitForTimeout(500);
    },
  },
  { name: 'settings-day-empty', route: '/settings/day', scenario: 'empty' },
  { name: 'tasks', route: '/tasks' },
  { name: 'tasks-later', route: '/tasks?tab=later' },
  { name: 'tasks-reminders', route: '/tasks?tab=reminders' },
  { name: 'tasks-done', route: '/tasks?tab=done' },
  {
    name: 'tasks-menu',
    route: '/tasks?tab=later',
    sizes: phone,
    run: async (page) => {
      await page.getByRole('button', { name: L('Інші дії', 'More actions') }).first().click();
      await page.waitForTimeout(300);
    },
  },
  { name: 'tasks-empty', route: '/tasks', scenario: 'empty' },
  { name: 'settings', route: '/settings' },
  { name: 'settings-general', route: '/settings/general' },
  { name: 'settings-day', route: '/settings/day', full: true },
  { name: 'settings-planning', route: '/settings/planning' },
  { name: 'settings-calendars', route: '/settings/calendars' },
  { name: 'settings-notifications', route: '/settings/notifications' },
  { name: 'settings-assistant', route: '/settings/assistant' },
  { name: 'settings-account', route: '/settings/account' },
  {
    name: 'phase-edit',
    route: '/settings/day',
    run: async (page) => {
      await page.getByTestId('phase-row').first().click();
      await page.waitForTimeout(700);
    },
  },
  {
    name: 'phase-presets',
    route: '/settings/day',
    run: async (page) => {
      await page.getByRole('button', { name: L('Шаблони', 'Templates') }).first().click();
      await page.waitForTimeout(500);
    },
  },
];

module.exports = { scenarios, L };
