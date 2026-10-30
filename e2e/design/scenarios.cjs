// Screens and states for e2e/design/shots.cjs.
// Each scenario: { name, route, scenario?, auth?, sizes?, langs?, full?, run?(page, ctx) }.
// Prefer data-testid hooks; text selectors take both languages via L(uk, en).

const L = (uk, en) => new RegExp(`^(${uk}|${en})$`, 'i');
const desk = ['d', 'xl', 't'];
const phone = ['m', 'xs'];

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
      await page.getByRole('button', { name: /Далі|Next/ }).first().click();
    },
  },
  { name: 'calendar', route: '/' },
  { name: 'calendar-empty', route: '/', scenario: 'empty' },
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
      if (mobile) await openFirst(page, '[data-testid="view-month"], button[aria-label="Місяць"], button[aria-label="Month"]');
      else await page.getByRole('button', { name: L('Місяць', 'Month') }).first().click();
    },
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
    name: 'problematic',
    route: '/',
    run: async (page) => openFirst(page, '[data-testid="open-problematic"], button:has-text("Переглянути"), button:has-text("Review")'),
  },
  {
    name: 'calendars-menu',
    route: '/',
    sizes: desk,
    run: async (page) => openFirst(page, '[data-testid="calendars-menu"], button:has-text("Календарі"), button:has-text("Calendars")'),
  },
  { name: 'tasks', route: '/tasks' },
  { name: 'tasks-empty', route: '/tasks', scenario: 'empty' },
  { name: 'settings', route: '/settings' },
  { name: 'phases', route: '/phases' },
];

module.exports = { scenarios, L };
