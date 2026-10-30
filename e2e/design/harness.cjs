// Static server for frontend/dist + a Playwright page with a mocked API.
// Used by e2e/design/shots.cjs. No backend or database needed.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const { handle } = require('./mock.cjs');

const DIST = path.resolve(__dirname, '../../frontend/dist');
const PORT = Number(process.env.DESIGN_SHOTS_PORT || 3190);
const API = 'http://localhost:3001';

const TYPES = {
  '.js': 'application/javascript',
  '.html': 'text/html',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function startServer() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('frontend/dist is missing. Run `npm run build:frontend` first.');
  }
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let file = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(DIST, 'index.html');
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

function b64(o) {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u-1', email: 'andrii@gmail.com', exp: 4102444800, iat: 1790000000 })}.sig`;

/** Thursday 29 Oct 2026, 11:20 in Kyiv — the mock data is built around this moment. */
const NOW = new Date('2026-10-29T11:20:00+02:00');

async function newPage(browser, { theme = 'dark', lang = 'uk', scenario = 'full', width = 1440, height = 900, auth = true, state = {} } = {}) {
  const mobile = width < 768;
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    timezoneId: 'Europe/Kyiv',
    locale: lang === 'uk' ? 'uk-UA' : 'en-US',
    colorScheme: theme,
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();
  await page.clock.install({ time: NOW });
  const persist = JSON.stringify({
    auth: JSON.stringify({ isAuthenticated: true, accessToken: JWT, refreshToken: JWT, loginStatus: 'success', error: null }),
    _persist: JSON.stringify({ version: -1, rehydrated: true }),
  });
  await page.addInitScript(
    ({ jwt, persist, theme, lang, auth }) => {
      try {
        if (auth) {
          localStorage.setItem('access_token', jwt);
          localStorage.setItem('refresh_token', jwt);
          localStorage.setItem('persist:root', persist);
        }
        localStorage.setItem('luefy.theme', theme);
        localStorage.setItem('app_language', lang);
      } catch (e) {
        /* storage blocked */
      }
    },
    { jwt: JWT, persist, theme, lang, auth },
  );
  page.unhandled = new Set();
  page.mockState = state;
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    let body;
    try {
      body = req.postDataJSON();
    } catch {
      body = undefined;
    }
    const res = handle(req.method(), u.pathname, Object.fromEntries(u.searchParams), lang, scenario, body, state);
    if (res === undefined) {
      page.unhandled.add(`${req.method()} ${u.pathname}`);
      return route.fulfill({ status: req.method() === 'GET' ? 404 : 200, json: req.method() === 'GET' ? { message: 'not mocked' } : {} });
    }
    if (res && res.__status) {
      return route.fulfill({ status: res.__status, json: res.body ?? {} });
    }
    return route.fulfill({ status: 200, json: res });
  });
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  return { ctx, page };
}

module.exports = { startServer, newPage, chromium, PORT, NOW };
