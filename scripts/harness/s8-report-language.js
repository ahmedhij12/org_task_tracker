// The PDF reports follow the app's language (his request, 2026-09-26):
// Arabic → Arabic words, right to left, 0-9 digits; English → English, left
// to right. Nothing spills off the page, and a late checklist's report says
// it was late, why, and what the auditor decided. Each PDF is saved and
// turned into a PNG (first page) to look at.
const fs = require('fs');
const { execFileSync } = require('child_process');
const { open, snap, profileBy, teamBy } = require('./harness');
const OUT = require('path').join(__dirname, '..', '..', '.dev-session', 'harness');
const BASE = process.env.BASE || 'http://localhost:4173/';

const karam = profileBy('karam12');
const fatima = profileBy('fatima');
const baghdad = teamBy('Baghdad');
const base = snap.task_completions.find((r) => r.actor_id === karam.id && r.selfie_url);
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
// The real checklist's own id, so its real answers load into the report.
const LATE = base.id;
const answers = [
  ['المنطقة الخارجية', 'هل موقف السيارات نظيف ؟', true, null],
  ['المنطقة الخارجية', 'هل جميع الانارة الخارجية تعمل؟', false, 'مصباح واحد عاطل'],
  ['الحمامات', 'المياه متوفرة في المغاسل و في الحمام ؟', null, null],
].map(([section, question, answer, note], i) => ({ id: `00000000-0000-4000-8000-0000000c00${i}`, task_completion_id: base.id, section_title: section, question, answer, note, sort_order: i }));
const lateRow = { ...base, id: LATE, created_at: ago(1), was_late: true, checklist_slot: 'AM', due_at: ago(3), note: 'زحام على الجسر', late_outcome: 'penalty', late_penalty_iqd: 25000, reviewed_by: fatima.id, reviewed_at: ago(0.5), late_excused_at: null };

async function save(page, trigger, name) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }).catch(() => null), trigger()]);
  if (!dl) return null;
  const pdf = `${OUT}/${name}.pdf`;
  await dl.saveAs(pdf);
  try {
    execFileSync('sips', ['-s', 'format', 'png', pdf, '--out', `${OUT}/${name}.png`], { stdio: 'ignore' });
  } catch {}
  return pdf;
}
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
        window.__overflow.push({ dir: pageEl.dir, text: pageEl.innerText, bad: bad.slice(0, 5) });
      }
      return orig.call(this);
    };
  });
}

(async () => {
  const results = [];
  const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  for (const lang of ['ar', 'en']) {
    // ---------------- marination day report (branch manager, Karbala)
    // Chromium: headless WebKit offers a share sheet instead of a download.
    let s = await open('kayes11', { lang, engine: 'chromium' });
    await s.page.goto(BASE + 'history');
    await s.page.waitForTimeout(5000);
    await s.page.getByTestId('marination-branch-Karbala').first().click();
    await s.page.waitForTimeout(1000);
    await s.page.getByTestId('marination-day').first().click();
    await s.page.waitForTimeout(1200);
    await watchOverflow(s.page);
    await s.page.getByTestId('marination-export').click();
    await s.page.getByTestId('marination-share').waitFor({ timeout: 45000 }).catch(() => {});
    let pdf = await save(s.page, () => s.page.getByTestId('marination-share').click(), `s8-${lang}-marination`);
    let info = (await s.page.evaluate(() => window.__overflow))[0] || {};
    check(`${lang} marination: PDF made`, !!pdf);
    check(`${lang} marination: direction`, info.dir === (lang === 'ar' ? 'rtl' : 'ltr'), info.dir);
    check(`${lang} marination: nothing off the page`, info.bad && info.bad.length === 0, (info.bad || []).join(' '));
    check(`${lang} marination: language`, lang === 'ar' ? /تقرير تخليل الدجاج/.test(info.text || '') : /Chicken Marination Report/.test(info.text || ''));
    check(`${lang} marination: 0-9 digits`, !/[٠-٩]/.test(info.text || ''));
    await s.browser.close();

    // ---------------- a late checklist's report (the auditor)
    s = await open('fatima', { lang, engine: 'chromium', tables: { checklist_answers: answers, task_completions: [lateRow, ...snap.task_completions.filter((r) => r.id !== LATE)] } });
    await s.page.goto(BASE + 'checklists');
    await s.page.waitForTimeout(5000);
    await s.page.getByText('Baghdad', { exact: true }).first().click();
    await s.page.waitForTimeout(800);
    await s.page.getByTestId(`badge-${LATE}`).click();
    await s.page.waitForTimeout(2500);
    await watchOverflow(s.page);
    await s.page.getByTestId('record-export').click();
    await s.page.getByTestId('record-share').waitFor({ timeout: 60000 }).catch(() => {});
    pdf = await save(s.page, () => s.page.getByTestId('record-share').click(), `s8-${lang}-checklist`);
    info = (await s.page.evaluate(() => window.__overflow))[0] || {};
    const txt = info.text || '';
    check(`${lang} checklist: PDF made`, !!pdf);
    check(`${lang} checklist: direction`, info.dir === (lang === 'ar' ? 'rtl' : 'ltr'), info.dir);
    check(`${lang} checklist: nothing off the page`, info.bad && info.bad.length === 0, (info.bad || []).join(' '));
    check(
      `${lang} checklist: late, reason, decision`,
      lang === 'ar'
        ? /أُرسلت متأخرة/.test(txt) && /زحام على الجسر/.test(txt) && /غرامة 25,000 دينار/.test(txt)
        : /sent late/.test(txt) && /زحام على الجسر/.test(txt) && /Penalty 25,000 IQD/.test(txt),
      txt.split('\n').filter((l) => /متأخر|late|Penalty|غرامة|Deadline|الموعد|Decision|القرار/.test(l)).slice(0, 4).join(' | '),
    );
    check(`${lang} checklist: labels in language`, lang === 'ar' ? /السؤال/.test(txt) && !/\bQuestion\b/.test(txt) : /Question/.test(txt));
    check(`${lang} checklist: 0-9 digits`, !/[٠-٩]/.test(txt));
    const errs = s.errors.filter((e) => !e.includes('user gesture'));
    check(`${lang} no page errors`, errs.length === 0, errs.slice(0, 2).join(' || '));
    await s.browser.close();
  }
  console.log(results.join('\n'));
})();
