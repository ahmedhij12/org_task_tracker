// Navigates the browser window opened by watch.js to a specific path.
// Usage: node scripts/dev/goto.js [path]  (defaults to "/")
const { chromium } = require('playwright');
const CDP_PORT = 9222;
const BASE = 'http://localhost:8081';

(async () => {
  const path = process.argv[2] || '/';
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages[pages.length - 1];
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  console.log('now at:', page.url());
  await browser.close();
})();
