// Frames of the home page's how-to-play demos (src/client/HowTo.tsx), for checking
// them by eye after a change: builds, starts the server on a spare port, films each
// demo for one loop at desktop and phone size in both themes, and lays each strip
// out as one contact sheet per demo.
//
//   npm run howto-frames              # into a fresh temp folder, printed at the end
//   npm run howto-frames -- --out dir # or into dir (created if missing)
//   npm run howto-frames -- --no-build
//
// Needs Playwright's Chromium once: npx playwright-core install chromium-headless-shell

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 8097;
const FRAMES = 14;
const EVERY_MS = 380;

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const out = arg('out') ? path.resolve(arg('out')) : fs.mkdtempSync(path.join(os.tmpdir(), 'wordbreak-howto-'));
fs.mkdirSync(out, { recursive: true });

if (!process.argv.includes('--no-build')) {
  const b = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
  if (b.status !== 0) process.exit(b.status ?? 1);
}

const server = spawn('node', ['dist/server/index.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const base = `http://localhost:${PORT}`;
try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch {
      // not up yet
    }
    if (i > 50) throw new Error('server did not start');
    await new Promise((r) => setTimeout(r, 200));
  }

  const browser = await chromium.launch();
  const SIZES = {
    desk: { viewport: { width: 1100, height: 900 } },
    phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  };
  const sheets = [];
  for (const [size, opts] of Object.entries(SIZES)) {
    for (const theme of ['light', 'dark']) {
      const tag = `${size}-${theme}`;
      const ctx = await browser.newContext({ ...opts, deviceScaleFactor: 2 });
      await ctx.addInitScript((t) => {
        localStorage.setItem('wordbreak.name', 'demo');
        localStorage.setItem('wordbreak.theme', t);
      }, theme);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.error(`${tag}: ${e.message}`));
      await page.goto(base);
      await page.waitForSelector('.howto .demo');
      await page.locator('.howto').screenshot({ path: path.join(out, `${tag}-section.png`) });
      const demos = await page.locator('.howto .demo').count();
      const t0 = Date.now();
      for (let k = 0; k < FRAMES; k++) {
        await page.waitForTimeout(Math.max(0, t0 + k * EVERY_MS - Date.now()));
        for (let d = 0; d < demos; d++) {
          await page.locator('.howto .demo').nth(d).screenshot({
            path: path.join(out, `${tag}-d${d + 1}-${String(k).padStart(2, '0')}.png`),
          });
        }
      }
      await ctx.close();

      // One sheet per demo: its frames in order, left to right, top to bottom.
      const sheetPage = await browser.newPage({ viewport: { width: 1400, height: 800 } });
      for (let d = 1; d <= demos; d++) {
        const imgs = fs.readdirSync(out).filter((f) => f.startsWith(`${tag}-d${d}-`)).sort();
        const html = path.join(out, `.sheet.html`);
        fs.writeFileSync(
          html,
          `<body style="margin:0;background:#888;display:grid;grid-template-columns:repeat(7,1fr);gap:4px;padding:4px">${imgs
            .map((f) => `<img src="${f}" style="width:100%">`)
            .join('')}</body>`,
        );
        await sheetPage.goto(`file://${html}`);
        await sheetPage.waitForLoadState('load');
        const sheet = path.join(out, `sheet-${tag}-${d}.png`);
        await sheetPage.screenshot({ path: sheet, fullPage: true });
        sheets.push(sheet);
      }
      await sheetPage.close();
    }
  }
  await browser.close();
  console.log(`\n${sheets.length} contact sheets in ${out}:\n${sheets.map((s) => `  ${path.basename(s)}`).join('\n')}`);
} finally {
  server.kill();
}
