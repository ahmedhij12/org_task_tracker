import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import { htmlToPdfFile } from '@/lib/webPdf';
import { bdi as isolate, pdfLanguage, type PdfLanguage } from '@/lib/pdfText';
import type { OilGrade, OilTest } from '@/types';

/**
 * The one-page PDF for a single oil test, the sheet a supervisor sends on
 * WhatsApp the moment he has taken the reading. Built the same way the audit
 * report is (expo-print on a phone, html2pdf.js in a browser) and styled to
 * match it, so the two read as one set of documents.
 */

// The VITO thresholds, the same ones gradeForTpm applies: the PDF states them
// so whoever receives it can check the verdict without opening the app.
const TPM_WATCH = 20;
const TPM_CHANGE = 22;
/** The scale the strip is drawn against. */
const TPM_SCALE_MAX = 30;

// The words are in the i18n files (pdf.oilGood / oilGoodVerdict, …).
const GRADE: Record<OilGrade, { label: string; verdict: string; ink: string; wash: string; bar: string }> = {
  good: {
    label: 'oilGood',
    verdict: 'oilGoodVerdict',
    // Darker than the app's #10B981 on purpose: this has to hold up as text on
    // white paper, and in grayscale.
    ink: '#047857',
    wash: '#F0FDF4',
    bar: '#10B981',
  },
  watch: {
    label: 'oilWatch',
    verdict: 'oilWatchVerdict',
    ink: '#B45309',
    wash: '#FFFBEB',
    bar: '#F59E0B',
  },
  change: {
    label: 'oilChange',
    verdict: 'oilChangeVerdict',
    ink: '#B91C1C',
    wash: '#FEF2F2',
    bar: '#E8141A',
  },
};

let cachedLogoDataUri: string | null = null;
async function getLogoDataUri(): Promise<string> {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  const asset = Asset.fromModule(require('../../assets/basra-delight-logo-white-bg.png'));
  await asset.downloadAsync();
  // The browser can load the bundled asset by URL; there's no local file to read.
  if (Platform.OS === 'web') return asset.uri;
  const file = new File(asset.localUri!);
  const base64 = await file.base64();
  cachedLogoDataUri = `data:image/png;base64,${base64}`;
  return cachedLogoDataUri;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Keeps Arabic letters (fryer and branch names are usually Arabic) but strips
// anything unsafe or awkward in a filename.
function safeFilenamePart(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '').trim().replace(/\s+/g, '-') || 'oil-test';
}

export interface OilTestReportData {
  test: OilTest;
  branchName: string;
  fryerName: string;
  testerName: string;
  locale: string;
}

/** A name or note in the other script, isolated so its punctuation stays put. */
function bidi(s: string): string {
  return isolate(escapeHtml(s));
}

function slotLine(test: OilTest, locale: string, L: PdfLanguage): string {
  if (!test.slotTime) {
    // oil_slot_for returns no slot for an auditor's spot check, and for a
    // SECOND test in a slot another test already covered — deliberately, so
    // the same slot is never counted late twice. Neither is a failing.
    return `<span style="color:#767676;font-weight:400;">${L.t(test.isAudit ? 'spotCheck' : 'extraCheck')}</span>`;
  }
  const slot = new Date(test.slotTime).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true });
  if (test.minutesLate != null && test.minutesLate > 0) {
    return `${slot} <span style="font-weight:400;color:#B91C1C;">&mdash; ${L.t('minutesLate', { n: test.minutesLate })}</span>`;
  }
  return `${slot} <span style="font-weight:400;color:#047857;">&mdash; ${L.t('onTimeLower')}</span>`;
}

function buildHtml(data: OilTestReportData, logoDataUri: string): string {
  const { test, branchName, fryerName, testerName } = data;
  // In the app's language: Arabic right to left, English left to right.
  const L = pdfLanguage(data.locale);
  const locale = L.locale;
  const g = GRADE[test.grade];
  const when = new Date(test.testedAt);
  const dateLabel = when.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeLabel = when.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true });
  const markerLeft = `${Math.max(0, Math.min(100, (test.tpm / TPM_SCALE_MAX) * 100))}%`;

  const goodWidth = (TPM_WATCH / TPM_SCALE_MAX) * 100;
  const watchWidth = ((TPM_CHANGE - TPM_WATCH) / TPM_SCALE_MAX) * 100;
  const changeWidth = 100 - goodWidth - watchWidth;

  const row = (label: string, value: string, last = false) =>
    `<tr>
      <td style="padding:9px 0;padding-inline-end:10px;color:#767676;width:165px;${last ? '' : 'border-bottom:1px solid #e5e7eb;'}">${label}</td>
      <td style="padding:9px 0;font-weight:700;${last ? '' : 'border-bottom:1px solid #e5e7eb;'}">${value}</td>
    </tr>`;

  return `<!DOCTYPE html>
<html dir="${L.dir}" lang="${L.lang}">
<head><meta charset="utf-8" /></head>
<body style="font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;margin:0;padding:48px 56px;color:#111827;background:#ffffff;">

  <div style="text-align:center;">
    <img src="${logoDataUri}" style="height:52px;" />
    <h1 style="margin:14px 0 2px;font-size:25px;font-weight:700;">${L.t('oilTitle')}</h1>
    <p style="margin:0;font-size:12px;color:#767676;">${dateLabel} &middot; ${timeLabel}</p>
  </div>

  <table style="width:100%;margin-top:24px;border:1px solid #e5e7eb;border-radius:14px;background:${g.wash};border-collapse:separate;">
    <tr>
      <td style="width:130px;padding:20px 0;padding-inline-start:22px;">
        <div style="width:104px;height:104px;border:5px solid ${g.ink};border-radius:999px;box-sizing:border-box;text-align:center;padding-top:26px;">
          <div style="font-size:30px;font-weight:700;color:#111827;line-height:1;">${test.tpm}</div>
          <div style="font-size:11px;color:#767676;margin-top:3px;">TPM %</div>
        </div>
      </td>
      <td style="padding:20px 0;padding-inline-end:22px;vertical-align:middle;">
        <div style="font-size:20px;font-weight:700;color:${g.ink};">${L.t(g.label)}</div>
        <div style="font-size:13px;color:#374151;margin-top:5px;line-height:1.5;">${L.t(g.verdict)}</div>
      </td>
    </tr>
  </table>

  <div style="margin-top:22px;">
    <div style="font-size:11px;font-weight:700;color:#767676;text-transform:uppercase;letter-spacing:${L.ar ? 0 : 0.6}px;">${L.t('oilScale')}</div>
    <!-- The scale reads 0 → 30 left to right in both languages, so the marker's left:% stays true. -->
    <div dir="ltr">
    <table style="width:100%;margin-top:12px;border-collapse:collapse;table-layout:fixed;">
      <tr style="height:15px;">
        <td style="width:${goodWidth}%;background:#10B981;"></td>
        <td style="width:${watchWidth}%;background:#F59E0B;"></td>
        <td style="width:${changeWidth}%;background:#E8141A;"></td>
      </tr>
    </table>
    <div style="position:relative;height:30px;">
      <div style="position:absolute;top:0;left:${markerLeft};width:2px;height:9px;background:#111827;"></div>
      <div style="position:absolute;top:9px;left:${markerLeft};transform:translateX(-50%);white-space:nowrap;">
        <span style="font-size:13px;font-weight:700;color:${g.ink};">${test.tpm}</span><span style="font-size:10px;color:#767676;"> TPM</span>
      </div>
    </div>
    <table style="width:100%;font-size:11px;color:#767676;border-collapse:collapse;">
      <tr>
        <td style="text-align:left;">0 &middot; ${L.t('oilFresh')}</td>
        <td style="text-align:center;">${TPM_WATCH} &middot; ${L.t('oilWatchMark')}</td>
        <td style="text-align:center;">${TPM_CHANGE} &middot; ${L.t('oilChangeMark')}</td>
        <td style="text-align:right;">${TPM_SCALE_MAX}</td>
      </tr>
    </table>
    </div>
  </div>

  <table style="width:100%;margin-top:24px;border-collapse:collapse;font-size:13px;">
    ${row(L.t('branch'), bidi(branchName))}
    ${row(L.t('fryer'), bidi(fryerName))}
    ${row(L.t(test.isAudit ? 'testedByAuditor' : 'testedBy'), bidi(testerName))}
    ${row(L.t('slot'), slotLine(test, locale, L))}
    ${row(L.t('temperature'), test.tempC != null ? `<bdi>${test.tempC} &deg;C</bdi>` : '&mdash;')}
    ${row(L.t('filtered'), L.t(test.filtered ? 'yes' : 'no'))}
    ${row(L.t('note'), test.note ? `<span style="font-weight:400;color:#374151;">${bidi(test.note)}</span>` : '&mdash;', true)}
  </table>

  ${
    test.lateReason
      ? `<div style="margin-top:14px;padding:12px 14px;border:1px solid #FCA5A5;border-radius:10px;background:#FEF2F2;">
    <div style="font-size:11px;font-weight:700;color:#B91C1C;text-transform:uppercase;letter-spacing:${L.ar ? 0 : 0.6}px;">${L.t('whyLate')}</div>
    <div style="font-size:12.5px;color:#374151;margin-top:5px;line-height:1.5;">${bidi(test.lateReason)}</div>
  </div>`
      : ''
  }

  <table style="width:100%;margin-top:22px;border-collapse:collapse;">
    <tr>
      <td style="width:178px;vertical-align:top;">
        <img src="${test.photoUrl}" style="width:178px;height:178px;object-fit:cover;border:1px solid #d1d5db;border-radius:10px;display:block;" />
      </td>
      <td style="padding-inline-start:18px;vertical-align:top;">
        <div style="font-size:11px;font-weight:700;color:#767676;text-transform:uppercase;letter-spacing:${L.ar ? 0 : 0.6}px;">${L.t('proof')}</div>
        <p style="margin:8px 0 0;font-size:12.5px;color:#374151;line-height:1.6;">${L.t('oilProof', { name: bidi(testerName) })}</p>
      </td>
    </tr>
  </table>

  <table style="width:100%;margin-top:28px;border-top:1px solid #e5e7eb;font-size:10.5px;color:#767676;">
    <tr>
      <td style="padding-top:12px;text-align:${L.start};">${L.t('footer')}</td>
      <td style="padding-top:12px;text-align:${L.end};">${L.t('oilFooter', { watch: TPM_WATCH, top: TPM_CHANGE - 0.1, change: TPM_CHANGE })}</td>
    </tr>
  </table>

</body>
</html>`;
}

function reportFilename(data: OilTestReportData): string {
  const day = new Date(data.test.testedAt).toISOString().slice(0, 10);
  return `oil-${safeFilenamePart(data.branchName)}-${safeFilenamePart(data.fryerName)}-${day}.pdf`;
}

/**
 * Web only: builds the PDF file. Sharing is a separate tap
 * (shareOrDownloadFile) because iPhone browsers only open the share sheet
 * straight from a tap, and building the file takes a few seconds.
 */
export async function buildWebOilTestFile(data: OilTestReportData): Promise<globalThis.File> {
  const logo = await getLogoDataUri();
  return htmlToPdfFile(buildHtml(data, logo), reportFilename(data));
}

/** Phones: build the PDF and open the share sheet (WhatsApp lives in it) in one go. */
export async function exportOilTestReport(data: OilTestReportData): Promise<void> {
  const logo = await getLogoDataUri();
  const { uri } = await Print.printToFileAsync({ html: buildHtml(data, logo) });

  // printToFileAsync names its output a random UUID — rename it to the branch
  // and the day, so what lands in WhatsApp isn't a GUID.
  const source = new File(uri);
  const renamed = new File(Paths.cache, reportFilename(data));
  renamed.create({ overwrite: true });
  renamed.write(await source.bytes());

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(renamed.uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Oil test — ${data.branchName}`,
      UTI: 'com.adobe.pdf',
    });
  }
}
