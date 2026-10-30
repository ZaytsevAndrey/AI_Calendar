#!/usr/bin/env node
// Design screenshots: every page and dialog, both themes, five sizes, uk + en.
// Usage:
//   npm run build:frontend && node e2e/design/shots.cjs [--only=name1,name2] [--sizes=d,m] [--themes=dark] [--langs=uk]
// Output: e2e/design/.out/<lang>/<theme>/<size>/<name>.png and e2e/design/.out/index.html
const fs = require('fs');
const path = require('path');
const { startServer, newPage, chromium, PORT } = require('./harness.cjs');
const { scenarios } = require('./scenarios.cjs');

const SIZES = {
  d: { width: 1440, height: 900 },
  xl: { width: 1920, height: 1080 },
  t: { width: 768, height: 1024 },
  m: { width: 390, height: 844 },
  xs: { width: 320, height: 568 },
};

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1].split(',').filter(Boolean) : fallback;
}

(async () => {
  const only = arg('only', null);
  const sizes = arg('sizes', Object.keys(SIZES));
  const themes = arg('themes', ['dark', 'light']);
  const langs = arg('langs', ['uk', 'en']);
  const outRoot = path.resolve(__dirname, '.out');
  const srv = await startServer();
  const browser = await chromium.launch();
  const results = [];
  let failures = 0;

  for (const sc of scenarios) {
    if (only && !only.includes(sc.name)) continue;
    for (const lang of langs) {
      if (sc.langs && !sc.langs.includes(lang)) continue;
      for (const theme of themes) {
        for (const size of sizes) {
          if (sc.sizes && !sc.sizes.includes(size)) continue;
          const { width, height } = SIZES[size];
          const { ctx, page } = await newPage(browser, {
            theme,
            lang,
            width,
            height: sc.height?.[size] ?? height,
            scenario: sc.scenario,
            auth: sc.auth !== false,
            hints: !!sc.hints,
          });
          const file = path.join(outRoot, lang, theme, size, `${sc.name}.png`);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          try {
            await page.goto(`http://localhost:${PORT}${sc.route}`);
            await page.clock.runFor(2500);
            await page.waitForTimeout(800);
            if (sc.run) await sc.run(page, { size, lang, theme, mobile: width < 768 });
            await page.waitForTimeout(400);
            await page.screenshot({ path: file, fullPage: !!sc.full });
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
            results.push({ name: sc.name, lang, theme, size, file: path.relative(outRoot, file), overflow, unhandled: [...page.unhandled] });
            if (overflow) console.log(`  overflow-x: ${sc.name} ${lang}/${theme}/${size}`);
          } catch (e) {
            failures += 1;
            console.log(`FAIL ${sc.name} ${lang}/${theme}/${size}: ${e.message.split('\n')[0]}`);
            try {
              await page.screenshot({ path: file });
            } catch {
              /* ignore */
            }
            results.push({ name: sc.name, lang, theme, size, file: path.relative(outRoot, file), error: e.message.split('\n')[0] });
          }
          await ctx.close();
        }
      }
    }
  }

  await browser.close();
  srv.close();

  const rows = results
    .map(
      (r) =>
        `<figure><img src="${r.file}" loading="lazy"><figcaption>${r.name} · ${r.lang}/${r.theme}/${r.size}${r.error ? ` · <b>${r.error}</b>` : ''}${r.overflow ? ' · <b>overflow-x</b>' : ''}</figcaption></figure>`,
    )
    .join('\n');
  fs.writeFileSync(
    path.join(outRoot, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Design shots</title><style>body{font:13px system-ui;background:#888;margin:16px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px}figure{margin:0;background:#fff;padding:6px}img{width:100%}</style><main>${rows}</main>`,
  );
  fs.writeFileSync(path.join(outRoot, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`${results.length} shots, ${failures} failed → ${path.relative(process.cwd(), outRoot)}/index.html`);
  process.exit(failures ? 1 : 0);
})();
