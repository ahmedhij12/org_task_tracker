// Drives the REAL web build's photo viewer with synthetic TOUCH events and
// measures what the gestures actually did, because "it compiles" is not proof.
const { chromium } = require('playwright');

const W = 390, H = 844;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

  const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p[0], y: p[1], id: i })) });

  const drag = async (from, to, steps = 22, holdMs = 0) => {
    await touch('touchStart', [from]);
    for (let i = 1; i <= steps; i++) {
      const x = from[0] + ((to[0] - from[0]) * i) / steps;
      const y = from[1] + ((to[1] - from[1]) * i) / steps;
      await touch('touchMove', [[x, y]]);
      await sleep(8);
    }
    if (holdMs) await sleep(holdMs);
    await touch('touchEnd', []);
  };

  const pinch = async (cx, cy, from, to, steps = 20) => {
    const pts = (gap) => [[cx - gap / 2, cy], [cx + gap / 2, cy]];
    await touch('touchStart', pts(from));
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', pts(from + ((to - from) * i) / steps));
      await sleep(10);
    }
    await touch('touchEnd', []);
  };

  const tapAt = async (x, y) => { await touch('touchStart', [[x, y]]); await sleep(30); await touch('touchEnd', []); };
  const doubleTap = async (x, y) => { await tapAt(x, y); await sleep(70); await tapAt(x, y); await sleep(450); };

  // The photo's real on-screen size is the ground truth for "how zoomed is it".
  const photo = (i = null) =>
    page.evaluate((idx) => {
      const sel = idx == null ? '[data-testid^="photo-"]' : `[data-testid="photo-${idx}"]`;
      const els = Array.from(document.querySelectorAll(sel)).filter((n) => n.getAttribute('data-testid') !== 'photo-pager');
      if (!els.length) return null;
      const r = els.map((n) => n.getBoundingClientRect()).sort((a, b) => b.width - a.width)[0];
      return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), cx: +(r.left + r.width / 2).toFixed(1), cy: +(r.top + r.height / 2).toFixed(1) };
    }, i);

  const counter = () => page.evaluate(() => (document.body.innerText.match(/\d\s*\/\s*\d/) || [''])[0].replace(/\s/g, ''));
  const open = () => page.evaluate(() => !!document.body.innerText.match(/\d\s*\/\s*\d/));

  const results = [];
  const check = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  — ${detail}`); };

  await page.goto('http://localhost:4173/viewer-check', { waitUntil: 'networkidle' });
  await sleep(3000);

  const base = await photo();
  if (!base) { console.log('FAILED: the photo element was never found'); await browser.close(); process.exit(1); }
  console.log('baseline photo box:', base, 'counter:', await counter());
  check('opens at fit', Math.abs(base.w - W) < 2, `photo is ${base.w}px wide on a ${W}px screen`);

  // 1. Double-tap zooms in, anchored near the tap.
  await doubleTap(W * 0.3, H * 0.4);
  const z1 = await photo();
  check('double-tap zooms in', z1.w > base.w * 2, `${base.w} -> ${z1.w} (x${(z1.w / base.w).toFixed(2)})`);
  check('double-tap anchors at the tap', z1.cx > W / 2, `photo centre moved to x=${z1.cx} after tapping left of centre`);

  // 2. Pinch changes the zoom CONTINUOUSLY from there — not one fixed step.
  await pinch(W / 2, H / 2, 120, 260);
  const z2 = await photo();
  check('pinch keeps zooming past the double-tap step', z2.w > z1.w * 1.2, `${z1.w} -> ${z2.w} (x${(z2.w / base.w).toFixed(2)} of fit)`);

  await pinch(W / 2, H / 2, 260, 150);
  const z3 = await photo();
  check('pinch zooms back down by any amount', z3.w < z2.w * 0.95 && z3.w > base.w, `${z2.w} -> ${z3.w} (x${(z3.w / base.w).toFixed(2)} of fit — a free value, not a step)`);

  // 3. Drag moves the zoomed photo.
  const before = await photo();
  await drag([W * 0.5, H * 0.5], [W * 0.2, H * 0.5]);
  await sleep(600);
  const after = await photo();
  check('drag pans the zoomed photo', Math.abs(after.cx - before.cx) > 20, `centre x ${before.cx} -> ${after.cx}`);

  // 4. Double-tap returns to fit.
  await doubleTap(W / 2, H / 2);
  const fit = await photo();
  check('double-tap returns to fit', Math.abs(fit.w - W) < 4, `back to ${fit.w}px`);

  // 5. THE REGRESSION GUARD: swiping between photos still works.
  const c0 = await counter();
  await drag([W * 0.8, H * 0.5], [W * 0.1, H * 0.5], 18);
  await sleep(700);
  const c1 = await counter();
  check('swipe goes to the next photo', c0 === '1/2' && c1 === '2/2', `counter ${c0} -> ${c1}`);

  await drag([W * 0.15, H * 0.5], [W * 0.85, H * 0.5], 18);
  await sleep(700);
  const c2 = await counter();
  check('swipe goes back', c2 === '1/2', `counter ${c1} -> ${c2}`);

  // 6. Swipe down dismisses, the way every phone gallery does.
  await drag([W / 2, H * 0.4], [W / 2, H * 0.4 + 220], 18);
  await sleep(700);
  check('swipe down closes the viewer', !(await open()), `viewer open after the downward swipe: ${await open()}`);

  // 7. A fresh viewer: one tap hides the buttons, a hard squeeze dismisses.
  await page.goto('http://localhost:4173/viewer-check', { waitUntil: 'networkidle' });
  await sleep(3000);
  const chromeOn = () => page.evaluate(() => document.body.innerText.includes('double-tap'));
  check('chrome starts visible', await chromeOn(), 'the counter and hint are on screen');
  await tapAt(W / 2, H * 0.5);
  await sleep(600);
  const hidden = !(await chromeOn());
  check('one tap hides the chrome', hidden, `chrome visible after a single tap: ${!hidden}`);
  await tapAt(W / 2, H * 0.5);
  await sleep(600);
  check('another tap brings it back', await chromeOn(), `chrome visible again: ${await chromeOn()}`);

  await pinch(W / 2, H / 2, 300, 60);
  await sleep(700);
  check('squeezing the photo closes it', !(await open()), `viewer open after the squeeze: ${await open()}`);

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.stack); process.exit(1); });
