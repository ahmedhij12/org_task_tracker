// Looks at whatever is currently on screen in the browser window opened by
// scripts/dev/watch.js — a screenshot plus the visible text — without
// touching or navigating it.
//
// This is what Claude runs while you are clicking around, so it can see the
// same screen you are on.
//
// Usage: node scripts/dev/peek.js [outputName]
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const CDP_PORT = 9222;
const OUT_DIR = path.join(__dirname, '..', '..', '.dev-session');

(async () => {
  const name = process.argv[2] || 'peek';
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  } catch {
    console.error('Could not connect. Is scripts/dev/watch.js running?');
    process.exit(1);
  }

  const context = browser.contexts()[0];
  if (!context) {
    console.error('No browser context found.');
    process.exit(1);
  }
  const pages = context.pages();
  const page = pages[pages.length - 1];
  if (!page) {
    console.error('No open page found.');
    process.exit(1);
  }

  const shot = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: shot });

  const url = page.url();
  let text = '';
  try {
    text = await page.locator('body').innerText();
  } catch {
    text = '(could not read page text)';
  }

  console.log('URL:', url);
  console.log('Screenshot:', shot);
  console.log('--- visible text ---');
  console.log(text.slice(0, 2500));

  await browser.close();
})();
