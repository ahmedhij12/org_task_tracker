// Forces the browser window opened by watch.js to hard-reload, bypassing
// cache, so a fresh bundle is guaranteed rather than assumed.
const { chromium } = require('playwright');
const CDP_PORT = 9222;

(async () => {
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages[pages.length - 1];
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);
  console.log('reloaded:', page.url());
  await browser.close();
})();
