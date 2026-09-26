// The oil test report in both app languages (never rendered before
// 2026-09-26): Arabic → right to left with 0-9 digits, the TPM scale still
// reading left to right; English → left to right. Uses the real late test on
// Baghdad's KFC fryer so the "minutes late" line and the reason show.
// Each PDF is saved and turned into a PNG (first page) to look at.
const { execFileSync } = require('child_process');
const { open, snap, teamBy } = require('./harness');
const OUT = require('path').join(__dirname, '..', '..', '.dev-session', 'harness');
const BASE = process.env.BASE || 'http://localhost:4173/';

const baghdad = teamBy('Baghdad');
const late = snap.oil_tests.find((x) => x.team_id === baghdad.id && x.minutes_late > 0 && x.late_reason);
const fryer = snap.oil_fryers.find((f) => f.id === late.fryer_id);

// Every text node inside the report page before html2pdf removes it: must sit inside the 794px page.
async function watchOverflow(page) {
  await page.evaluate(() => {
    const orig = HTMLElement.prototype.remove;
    window.__overflow = [];
    HTMLElement.prototype.remove = function () {
      if (this.style && this.style.left === '-10000px') {
        const pageEl = this.firstElementChild;
        const box = pageEl.getBoundingClientRect();
        const bad = [];
        for (const el of pageEl.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width && (r.left < box.left - 1 || r.right > box.right + 1)) bad.push(`${el.tagName}:${Math.round(r.left - box.left)}..${Math.round(r.right - box.left)}`);
        }
        const scale = pageEl.querySelector('[dir="ltr"]');
        window.__overflow.push({ dir: pageEl.dir, text: pageEl.innerText, bad: bad.slice(0, 5), scaleDir: scale ? getComputedStyle(scale).direction : null });
      }
      return orig.call(this);
    };
  });
}

(async () => {
  const results = [];
  const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  for (const lang of ['ar', 'en']) {
    // Chromium: headless WebKit offers a share sheet instead of a download.
    const s = await open('fatima', { lang, engine: 'chromium' });
    await s.page.goto(BASE + 'history');
    await s.page.waitForTimeout(5000);
    const branch = s.page.getByTestId('oil-branch-Baghdad').first();
    if (await branch.isVisible().catch(() => false)) await branch.click();
    await s.page.waitForTimeout(800);
    await s.page.getByTestId(`oil-fryer-${fryer.name}`).first().click();
    await s.page.waitForTimeout(1200);
    await watchOverflow(s.page);
    const name = `s9-${lang}-oil`;
    const [dl] = await Promise.all([
      s.page.waitForEvent('download', { timeout: 45000 }).catch(() => null),
      s.page.getByTestId(`oil-share-${late.id}`).click(),
    ]);
    let pdf = null;
    if (dl) {
      pdf = `${OUT}/${name}.pdf`;
      await dl.saveAs(pdf);
      try { execFileSync('sips', ['-s', 'format', 'png', pdf, '--out', `${OUT}/${name}.png`], { stdio: 'ignore' }); } catch {}
    }
    const info = (await s.page.evaluate(() => window.__overflow))[0] || {};
    const txt = info.text || '';
    check(`${lang} oil: PDF made`, !!pdf);
    check(`${lang} oil: direction`, info.dir === (lang === 'ar' ? 'rtl' : 'ltr'), info.dir);
    check(`${lang} oil: scale reads left to right`, info.scaleDir === 'ltr', info.scaleDir);
    check(`${lang} oil: nothing off the page`, info.bad && info.bad.length === 0, (info.bad || []).join(' '));
    check(`${lang} oil: language`, lang === 'ar' ? /تقرير فحص الدهن/.test(txt) && !/\bFryer\b/.test(txt) : /Fryer/.test(txt));
    // slot_time is a Postgres time ("19:00:00") — it once printed "Invalid Date".
    const slotLine = txt.split('\n').find((l) => /Scheduled slot|الموعد المجدول/.test(l)) || '';
    const want = lang === 'ar' ? `7:00 م — متأخر ${late.minutes_late} دقيقة` : `7:00 PM — ${late.minutes_late} minutes late`;
    check(`${lang} oil: slot time + minutes late`, slotLine.includes(want) && !/Invalid/.test(txt), slotLine);
    check(`${lang} oil: why late`, txt.includes(late.late_reason));
    check(`${lang} oil: 0-9 digits`, !/[٠-٩]/.test(txt));
    const errs = s.errors.filter((e) => !e.includes('user gesture'));
    check(`${lang} no page errors`, errs.length === 0, errs.slice(0, 2).join(' || '));
    await s.browser.close();
  }
  console.log(results.join('\n'));
})();
