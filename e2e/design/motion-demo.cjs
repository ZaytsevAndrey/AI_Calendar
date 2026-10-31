#!/usr/bin/env node
// Card motion demo: a stateful mock API with a slow server, scripted actions,
// and a video per scenario. Look at what the calendar cards do while a task is
// saved, moved, created, deleted, scheduled from «На потім» or parked.
// Usage:
//   npm run build:frontend && node e2e/design/motion-demo.cjs [--only=drag,delete] [--size=d|m] [--theme=dark|light] [--server=1800] [--google=2500]
// Output: e2e/design/.out/motion/<theme>-<size>/<scenario>.webm
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const { startServer, PORT } = require('./harness.cjs');
const { handle, makeTasks, makeEvents } = require('./mock.cjs');

const API = 'http://localhost:3001';
const TZ = '+02:00';
const iso = (ymd, hm) => new Date(`${ymd}T${hm}:00${TZ}`).toISOString();

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
}

const SIZES = { d: { width: 1440, height: 900 }, m: { width: 390, height: 844 } };

function b64(o) {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u-1', email: 'andrii@gmail.com', exp: 4102444800, iat: 1790000000 })}.sig`;

/** Server state for one scenario: tasks, their events, and replan jobs whose stages advance with time. */
function makeServer(lang, serverMs, { parkOnMove = false, cascade = false, googleMs = 0 } = {}) {
  const parkedJobs = new Set();
  const tasks = makeTasks(lang);
  const events = makeEvents(lang);
  const jobs = new Map();
  let seq = 1;

  const job = () => {
    const id = `job-${seq++}`;
    jobs.set(id, Date.now());
    return id;
  };
  const eventFor = (task) => ({
    id: task.googleEventId,
    summary: task.name,
    calendarId: 'app-cal@group.calendar.google.com',
    provider: 'google',
    status: 'confirmed',
    start: { dateTime: task.scheduledStartTime, timeZone: 'Europe/Kyiv' },
    end: { dateTime: task.scheduledEndTime, timeZone: 'Europe/Kyiv' },
    isAppGenerated: true,
  });
  const upsertEvent = (task) => {
    const i = events.findIndex((e) => e.id === task.googleEventId);
    if (!task.scheduledStartTime || task.isUnscheduled || task.scheduleState === 'problematic') {
      if (i >= 0) events.splice(i, 1);
      return;
    }
    if (i >= 0) events[i] = { ...events[i], ...eventFor(task) };
    else events.push(eventFor(task));
  };

  // Like the real server, a new Google event can show up a while after the job is done;
  // until then the task does not know its event id either.
  const publishLater = (task) => {
    const eventId = task.googleEventId || `ge-${task.id}`;
    task.googleEventId = null;
    setTimeout(() => {
      task.googleEventId = eventId;
      upsertEvent(task);
    }, serverMs + googleMs);
  };

  /** A replan after a drag: peers shift, one leaves the week, one is parked, one comes back under a new id. */
  const replanAfterMove = () => {
    const byId = (id) => tasks.find((t) => t.id === id);
    const shift = (task, minutes) => {
      task.scheduledStartTime = new Date(Date.parse(task.scheduledStartTime) + minutes * 60000).toISOString();
      task.scheduledEndTime = new Date(Date.parse(task.scheduledEndTime) + minutes * 60000).toISOString();
    };
    const tax = byId('t-tax');
    shift(tax, 90);
    upsertEvent(tax);
    const read = byId('t-read');
    shift(read, 4 * 24 * 60);
    upsertEvent(read);
    const groc = byId('t-groceries');
    const old = events.findIndex((e) => e.id === groc.googleEventId);
    if (old >= 0) events.splice(old, 1);
    groc.googleEventId = 'ge-groc-v2';
    shift(groc, -45);
    upsertEvent(groc);
    const design = byId('t-design');
    Object.assign(design, { scheduleState: 'problematic', problematicDay: '2026-10-29', problematicReason: 'phase_full' });
    upsertEvent(design);
  };

  return {
    tasks,
    events,
    async respond(method, p, query, body) {
      if (p.startsWith('/schedule-jobs/') && p !== '/schedule-jobs/latest/done') {
        const started = jobs.get(p.split('/').pop()) ?? 0;
        const t = Date.now() - started;
        if (t < serverMs * 0.45) return { id: 'job', status: 'running', progressStage: 'placing', result: null };
        if (t < serverMs) return { id: 'job', status: 'running', progressStage: 'syncing', result: null };
        const parked = parkedJobs.has(p.split('/').pop()) ? { parked: 'problematic' } : {};
        return { id: 'job', status: 'done', result: { diff: [], warnings: [], errors: [], ...parked } };
      }
      if (p === '/tasks' && method === 'GET') return tasks;
      if (p === '/calendar-providers/events') return { events, totalEvents: events.length };
      const wait = () => new Promise((r) => setTimeout(r, serverMs * 0.35));
      if (p === '/schedule/free-slots') {
        // The shared mock answers for Fri 30 Oct; move every time to the asked day.
        const base = handle(method, p, query, lang, 'full', body, {});
        const shift = (Date.parse(`${query.ymd}T00:00:00Z`) - Date.parse('2026-10-30T00:00:00Z')) || 0;
        const move = (v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(Date.parse(v) + shift).toISOString() : v);
        const walk = (v) => (Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : move(v));
        return { ...walk(base), ymd: query.ymd };
      }
      if (p === '/schedule/move-event' && method === 'POST') {
        await wait();
        const ev = events.find((e) => e.id === body.googleEventId);
        if (ev) {
          ev.start = { ...ev.start, dateTime: body.start };
          ev.end = { ...ev.end, dateTime: body.end };
        }
        const task = tasks.find((t) => t.googleEventId === body.googleEventId);
        if (task) Object.assign(task, { scheduledStartTime: body.start, scheduledEndTime: body.end });
        if (cascade && body.googleEventId === 'ge-api') setTimeout(replanAfterMove, serverMs * 0.8);
        if (task && parkOnMove) {
          // No room in the phase there: the scheduler parks it.
          Object.assign(task, { scheduleState: 'problematic', problematicDay: '2026-10-30', problematicReason: 'phase_full' });
          const id = job();
          parkedJobs.add(id);
          setTimeout(() => upsertEvent(task), serverMs * 0.6);
          return { kind: 'slot', jobId: id };
        }
        return { kind: 'fixed', jobId: job() };
      }
      const taskMatch = p.match(/^\/tasks\/([^/]+)$/);
      if (taskMatch && method === 'PATCH') {
        await wait();
        const task = tasks.find((t) => t.id === taskMatch[1]);
        if (!task) return { __status: 404 };
        Object.assign(task, body);
        // A window from «Запланувати»: the scheduler seats it at the window start.
        if (body.isUnscheduled === false && !body.scheduledStartTime && body.earliestStartTime) {
          const start = new Date(body.earliestStartTime);
          body.scheduledStartTime = start.toISOString();
          task.scheduledStartTime = body.scheduledStartTime;
          task.scheduledEndTime = new Date(start.getTime() + (task.estimatedTimeInMinutes || 30) * 60000).toISOString();
        }
        const fresh = !task.googleEventId;
        if (body.scheduledStartTime) Object.assign(task, { isUnscheduled: false, scheduleState: 'none' });
        if (!task.googleEventId) task.googleEventId = `ge-${task.id}`;
        if (body.park) {
          task.scheduleState = 'problematic';
          task.problematicDay = '2026-10-30';
          task.problematicReason = 'phase_full';
        }
        if (fresh && googleMs) publishLater(task);
        else upsertEvent(task);
        return { ...task, jobId: job() };
      }
      if (taskMatch && method === 'DELETE') {
        await wait();
        const i = tasks.findIndex((t) => t.id === taskMatch[1]);
        if (i >= 0) {
          const [task] = tasks.splice(i, 1);
          for (let k = events.length - 1; k >= 0; k -= 1) {
            if (events[k].id === task.googleEventId || events[k].recurringEventId === task.googleEventId) events.splice(k, 1);
          }
        }
        return {};
      }
      if (p === '/tasks' && method === 'POST') {
        await wait();
        const id = `t-new-${seq++}`;
        const task = {
          ...makeTasks(lang)[3],
          ...body,
          id,
          googleEventId: `ge-${id}`,
          status: 'todo',
          scheduleState: 'none',
          phases: [],
        };
        tasks.push(task);
        // The Google event shows up only after the replan job.
        if (googleMs) publishLater(task);
        else setTimeout(() => upsertEvent(task), serverMs * 0.65);
        return { ...task, jobId: job() };
      }
      const place = p.match(/^\/schedule\/problematic\/([^/]+)\/place$/);
      if (place && method === 'POST') {
        await wait();
        const task = tasks.find((t) => t.id === place[1]);
        if (task) {
          Object.assign(task, {
            scheduleState: 'none',
            scheduledStartTime: body.start,
            scheduledEndTime: body.end,
            googleEventId: task.googleEventId || `ge-${task.id}`,
          });
          if (googleMs) publishLater(task);
          else upsertEvent(task);
        }
        return { placed: true, jobId: job() };
      }
      return handle(method, p, query, lang, 'full', body, {});
    },
  };
}

async function newPage(browser, { theme, size, lang, server, video }) {
  const { width, height } = SIZES[size];
  const mobile = width < 768;
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    timezoneId: 'Europe/Kyiv',
    locale: lang === 'uk' ? 'uk-UA' : 'en-US',
    colorScheme: theme,
    serviceWorkers: 'block',
    recordVideo: { dir: video, size: { width, height } },
  });
  const page = await ctx.newPage();
  // Thursday 29 Oct 2026, the day the mock data is built around; time runs.
  await page.clock.install({ time: new Date('2026-10-29T11:20:00+02:00') });
  await page.clock.resume();
  const persist = JSON.stringify({
    auth: JSON.stringify({ isAuthenticated: true, accessToken: JWT, refreshToken: JWT, loginStatus: 'success', error: null }),
    _persist: JSON.stringify({ version: -1, rehydrated: true }),
  });
  await page.addInitScript(
    ({ jwt, persist, theme, lang }) => {
      localStorage.setItem('access_token', jwt);
      localStorage.setItem('refresh_token', jwt);
      localStorage.setItem('persist:root', persist);
      localStorage.setItem('luefy.theme', theme);
      localStorage.setItem('luefy.hint.calendar-drag', '1');
      localStorage.setItem('luefy.hint.calendar-touch', '1');
      localStorage.setItem('app_language', lang);
      localStorage.setItem('luefy.todayPanel', 'open');
    },
    { jwt: JWT, persist, theme, lang },
  );
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    let body;
    try {
      body = req.postDataJSON();
    } catch {
      body = undefined;
    }
    const res = await server.respond(req.method(), u.pathname.replace(/\/+$/, ''), Object.fromEntries(u.searchParams), body);
    if (res === undefined) return route.fulfill({ status: req.method() === 'GET' ? 404 : 200, json: {} });
    if (res && res.__status) return route.fulfill({ status: res.__status, json: res.body ?? {} });
    return route.fulfill({ status: 200, json: res });
  });
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  return { ctx, page };
}

async function dragCard(page, eventId, dx, dy) {
  const card = page.getByTestId(`calendar-event-${eventId}`).locator('.calendar-chip__body');
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(14, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(x + (dx * i) / 12, y + (dy * i) / 12);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

const scenarios = {
  /** Drag within the week: the old card empties while the new one fills, then flies over. */
  drag: async (page) => {
    await dragCard(page, 'ge-api', 280, 40);
    await page.waitForTimeout(3500);
  },
  /** Delete from the chip's ×: hatched while the server works, then wiped. */
  delete: async (page) => {
    const chip = page.getByTestId('calendar-event-ge-tax');
    await chip.scrollIntoViewIfNeeded();
    await chip.hover();
    await chip.locator('.calendar-chip__delete').click();
    await page.getByRole('button', { name: /^(Видалити|Delete)$/ }).last().click();
    await page.waitForTimeout(3000);
  },
  /** «На потім» → «Запланувати» → slot: the row flies to the grid. */
  later: async (page) => {
    await page.locator('#today-later').getByRole('button', { name: /^(Запланувати|Schedule)$/ }).first().click();
    await page.waitForTimeout(700);
    await page.getByRole('dialog').getByRole('button', { name: /08:30/ }).first().click();
    await page.waitForTimeout(400);
    const confirm = page.getByRole('dialog').getByRole('button', { name: /^(Запланувати|Schedule|Поставити|Place)/ });
    if (await confirm.count()) await confirm.last().click().catch(() => {});
    await page.waitForTimeout(3500);
  },
  /** Problem list → «Поставити на …»: the card flies from the list to its slot. */
  problem: async (page) => {
    await page.getByRole('button', { name: /^(Переглянути|Review)/ }).first().click();
    await page.waitForTimeout(800);
    await page.getByRole('dialog').getByRole('button', { name: /^(Поставити на|Place at)/ }).first().click();
    await page.waitForTimeout(8000);
  },
  /** «Запланувати» on a day next week: the row flies into the «next» arrow, which names the day. */
  offscreen: async (page) => {
    await page.locator('#today-later').getByRole('button', { name: /^(Запланувати|Schedule)$/ }).first().click();
    await page.waitForTimeout(700);
    const next = page.getByRole('dialog').getByRole('button', { name: /(Наступний день|Next day)/ });
    for (let i = 0; i < 4; i += 1) {
      await next.click();
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(600);
    await page.getByRole('dialog').getByRole('button', { name: /^(Поставити на|Place at)/ }).last().click();
    await page.waitForTimeout(4000);
  },
  /** Drag into a full phase: the server parks it, the card flies into «Проблемні». */
  park: async (page) => {
    await dragCard(page, 'ge-api', 140, 60);
    await page.waitForTimeout(4500);
  },
  /**
   * Two drags in a row while the server replans around the first: peers slide,
   * one leaves for next week, one is parked, one comes back under a new id.
   */
  cascade: async (page) => {
    await dragCard(page, 'ge-api', 140, 0);
    await page.waitForTimeout(500);
    await dragCard(page, 'ge-report', 280, 120);
    await page.waitForTimeout(6000);
  },
  /** Not a scenario on its own: shared by `create`. */
  createStart: async (page) => {
    const col = page.getByTestId('calendar-day-column-4');
    const box = await col.boundingBox();
    const sbox = await page.getByTestId('calendar-hour-scroll').boundingBox();
    const x = box.x + box.width / 2;
    const y = sbox.y + 40;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 30);
    await page.mouse.move(x, y + 60);
    await page.mouse.up();
    await page.waitForTimeout(800);
    await page.getByRole('dialog').getByRole('textbox').first().fill('Нова задача');
    await page.getByRole('dialog').getByRole('button', { name: /^(Створити|Create|Зберегти|Save)/ }).last().click();
  },
  /** Drag on empty time → form → save: a dashed placeholder unfolds and fills, then the real card takes its place. */
  create: async (page) => {
    await scenarios.createStart(page);
    await page.waitForTimeout(7000);
  },
};

(async () => {
  const theme = arg('theme', 'dark');
  const size = arg('size', 'd');
  const lang = 'uk';
  const serverMs = Number(arg('server', '1800'));
  // Extra delay before a new Google event shows up (0: with the job).
  const googleMs = Number(arg('google', '2500'));
  const only = arg('only', '').split(',').filter(Boolean);
  const out = path.resolve(__dirname, '.out/motion', `${theme}-${size}`);
  fs.mkdirSync(out, { recursive: true });
  const srv = await startServer();
  const browser = await chromium.launch();
  for (const [name, run] of Object.entries(scenarios)) {
    if (name === 'createStart') continue;
    if (only.length && !only.includes(name)) continue;
    const server = makeServer(lang, serverMs, { parkOnMove: name === 'park', cascade: name === 'cascade', googleMs });
    const tmp = fs.mkdtempSync(path.join(out, '.rec-'));
    const { ctx, page } = await newPage(browser, { theme, size, lang, server, video: tmp });
    try {
      page.setDefaultTimeout(6000);
      await page.goto(`http://localhost:${PORT}/`);
      await page.getByTestId('calendar-time-grid').waitFor({ timeout: 15000 });
      await page.waitForTimeout(1200);
      await run(page);
      console.log(`ok   ${name}`);
    } catch (e) {
      console.log(`FAIL ${name}: ${e.message.split('\n').slice(0, 3).join(' | ')}`);
      await page.screenshot({ path: path.join(out, `${name}-fail.png`) }).catch(() => {});
    }
    const video = page.video();
    await ctx.close();
    if (video) fs.renameSync(await video.path(), path.join(out, `${name}.webm`));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  await browser.close();
  srv.close();
})();
