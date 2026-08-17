// Opens a real browser window on this laptop that Claude can also inspect,
// so you can click through the app while Claude reads the errors live
// instead of you sending screenshots.
//
// Usage:
//   1. In one terminal:  npm run web            (starts the app on :8081)
//   2. In another:       node scripts/dev/watch.js
//   3. Use the browser window that opens. Just drive the app normally.
//
// Everything the page reports — console errors, uncaught exceptions, failed
// network calls with their response bodies — is appended to
// .dev-session/session.log, and Claude can screenshot the window at any
// moment with scripts/dev/peek.js. Leave this running.
//
// Requires playwright. If it is not installed:  npm i -D playwright
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const TARGET_URL = process.env.WATCH_URL || 'http://localhost:8081/';
const CDP_PORT = 9222;
const OUT_DIR = path.join(__dirname, '..', '..', '.dev-session');
const LOG_FILE = path.join(OUT_DIR, 'session.log');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(LOG_FILE, `=== session started ${new Date().toISOString()} ===\n`);

function log(line) {
  const stamped = `[${new Date().toISOString().slice(11, 19)}] ${line}`;
  fs.appendFileSync(LOG_FILE, stamped + '\n');
  console.log(stamped);
}

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: [`--remote-debugging-port=${CDP_PORT}`, '--window-size=460,960'],
  });

  const context = await browser.newContext({
    viewport: { width: 420, height: 880 },
    // Lets the app request camera without a blocking prompt, so proof-photo
    // capture can at least be exercised on the laptop.
    permissions: ['camera'],
  });
  const page = await context.newPage();

  page.on('pageerror', (e) => log(`PAGE ERROR: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') log(`CONSOLE ERROR: ${m.text().slice(0, 400)}`);
  });
  page.on('requestfailed', (r) => {
    log(`REQUEST FAILED: ${r.method()} ${r.url().slice(0, 120)} :: ${r.failure()?.errorText}`);
  });
  page.on('response', async (res) => {
    if (res.status() >= 400) {
      let body = '';
      try {
        body = await res.text();
      } catch {}
      log(`HTTP ${res.status()}: ${res.url().slice(0, 120)} :: ${body.slice(0, 400)}`);
    }
  });

  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  log(`watching ${TARGET_URL}`);
  log(`log file: ${LOG_FILE}`);
  log(`Claude can inspect this window over CDP on port ${CDP_PORT}`);
  log('Drive the app in the browser window. Ctrl+C here to stop.');

  // Keep the process alive until the browser is closed or Ctrl+C.
  await new Promise((resolve) => {
    browser.on('disconnected', resolve);
    process.on('SIGINT', resolve);
  });
  log('=== session ended ===');
  process.exit(0);
})().catch((e) => {
  console.error('watch.js failed:', e.message);
  process.exit(1);
});
