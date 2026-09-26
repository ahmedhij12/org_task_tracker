import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import { htmlToPdfFile } from '@/lib/webPdf';
import { marinationStatus, type MarinationRules } from '@/lib/marination';
import { bdi as isolate, pdfLanguage } from '@/lib/pdfText';
import type { ChickenMarination } from '@/types';

/**
 * One branch's chicken marination for one day, as a PDF to share (his
 * request, 2026-09-26): every batch with when it went in (and any correction,
 * by whom and why), the buckets and chickens, when the vinegar came out and by
 * whom, the verdict against the frozen rule, and the removal photo. Built the
 * same way as the oil and audit reports (expo-print on a phone, html2pdf.js in
 * a browser) and styled to match them.
 */

const CHICKENS_PER_BUCKET = 8;

let cachedLogoDataUri: string | null = null;
async function getLogoDataUri(): Promise<string> {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  const asset = Asset.fromModule(require('../../assets/basra-delight-logo-white-bg.png'));
  await asset.downloadAsync();
  if (Platform.OS === 'web') return asset.uri;
  const file = new File(asset.localUri!);
  cachedLogoDataUri = `data:image/png;base64,${await file.base64()}`;
  return cachedLogoDataUri;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/** A name or note in the other script, isolated so its punctuation stays put. */
function bidi(s: string): string {
  return isolate(escapeHtml(s));
}
function safeFilenamePart(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '').trim().replace(/\s+/g, '-') || 'branch';
}

export interface MarinationReportData {
  branchName: string;
  /** The branch day, "YYYY-MM-DD". */
  day: string;
  records: ChickenMarination[];
  rules: MarinationRules;
  tz: string;
  locale: string;
  /** A profile id to a name (who corrected a start). */
  nameOf: (id: string | null | undefined) => string;
}

function buildHtml(data: MarinationReportData, logoDataUri: string): string {
  const { records, rules, tz, nameOf } = data;
  // In the app's language: Arabic right to left, English left to right.
  const L = pdfLanguage(data.locale);
  const locale = L.locale;
  const span = (ms: number) => {
    const mins = Math.max(0, Math.round(Math.abs(ms) / 60000));
    const h = Math.floor(mins / 60);
    return h > 0 ? L.t('spanH', { h, m: mins % 60 }) : L.t('spanM', { m: mins });
  };
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
  const dateLabel = new Date(data.day + 'T12:00:00Z').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const batches = [...records].sort((a, b) => a.marinatedAt.localeCompare(b.marinatedAt));

  const verdicts = batches.map((r) => marinationStatus(r, rules));
  const buckets = batches.reduce((n, r) => n + (r.countIn ?? 0), 0);
  const onTime = verdicts.filter((v) => v.state === 'onTime').length;
  const problems = verdicts.filter((v) => v.state === 'late' || v.state === 'early' || v.state === 'overdue').length;

  const verdictHtml = (r: ChickenMarination, i: number) => {
    const v = verdicts[i];
    const d = span(v.ms);
    switch (v.state) {
      case 'onTime': return `<span style="color:#047857;font-weight:700;">${L.t('onTime')}</span>`;
      case 'early': return `<span style="color:#B91C1C;font-weight:700;">${L.t('resEarly', { span: d })}</span><div style="font-size:10px;color:#767676;">${L.t('underMarinated')}</div>`;
      case 'late': return `<span style="color:#B91C1C;font-weight:700;">${L.t('resLate', { span: d })}</span>`;
      case 'overdue': return `<span style="color:#B91C1C;font-weight:700;">${L.t('resOverdue', { span: d })}</span>`;
      default: return `<span style="color:#B45309;font-weight:700;">${L.t('resIn')}</span><div style="font-size:10px;color:#767676;">${L.t('resLeft', { span: d })}</div>`;
    }
  };

  const rows = batches.map((r, i) => {
    const who = bidi(nameOf(r.startEditedBy));
    const corrected = r.startEditedAt
      ? `<div style="margin-top:4px;font-size:10px;color:#B45309;line-height:1.4;">${
          r.originalMarinatedAt ? L.t('correctedFrom', { time: time(r.originalMarinatedAt), name: who }) : L.t('corrected', { name: who })
        }${r.startEditReason ? `: ${bidi(r.startEditReason)}` : ''}</div>`
      : '';
    const photo = r.unloadPhotoUrl
      ? `<img src="${r.unloadPhotoUrl}" style="width:96px;height:96px;object-fit:cover;border:1px solid #d1d5db;border-radius:8px;display:block;" />`
      : '<span style="color:#9ca3af;">&mdash;</span>';
    const note = r.note ? `<div style="margin-top:4px;font-size:10px;color:#374151;">&ldquo;${bidi(r.note)}&rdquo;</div>` : '';
    return `<tr>
      <td style="padding:10px 6px;border-bottom:1px solid #e5e7eb;vertical-align:top;color:#767676;">${i + 1}</td>
      <td style="padding:10px 6px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
        <div style="font-weight:700;">${time(r.marinatedAt)}</div>
        <div style="font-size:10px;color:#767676;">${bidi(r.actorName ?? '')}</div>${corrected}${note}
      </td>
      <td style="padding:10px 6px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${
        r.countIn != null ? `<div style="font-weight:700;">${r.countIn}</div><div style="font-size:10px;color:#767676;">${L.t('chickens', { n: Math.round(r.countIn * CHICKENS_PER_BUCKET) })}</div>` : '&mdash;'
      }</td>
      <td style="padding:10px 6px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${
        r.dueAt ? time(r.dueAt) : '&mdash;'
      }</td>
      <td style="padding:10px 6px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${
        r.unloadedAt ? `<div style="font-weight:700;">${time(r.unloadedAt)}</div><div style="font-size:10px;color:#767676;">${bidi(r.unloadedByName ?? '')}</div>` : '&mdash;'
      }</td>
      <td style="padding:10px 6px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${verdictHtml(r, i)}</td>
      <td style="padding:10px 6px;border-bottom:1px solid #e5e7eb;vertical-align:top;width:100px;">${photo}</td>
    </tr>`;
  }).join('');

  const tile = (label: string, value: string, ink = '#111827') =>
    `<td style="width:25%;padding:12px;border:1px solid #e5e7eb;border-radius:10px;text-align:center;">
      <div style="font-size:20px;font-weight:700;color:${ink};">${value}</div>
      <div style="font-size:10.5px;color:#767676;margin-top:2px;">${label}</div>
    </td>`;

  return `<!DOCTYPE html>
<html dir="${L.dir}" lang="${L.lang}">
<head><meta charset="utf-8" /></head>
<body style="font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;margin:0;padding:40px 44px;color:#111827;background:#ffffff;">
  <div style="text-align:center;">
    <img src="${logoDataUri}" style="height:48px;" />
    <h1 style="margin:12px 0 2px;font-size:23px;font-weight:700;">${L.t('marTitle')}</h1>
    <p style="margin:0;font-size:12px;color:#767676;">${bidi(data.branchName)} &middot; ${dateLabel}</p>
  </div>

  <table style="width:100%;margin-top:20px;border-collapse:separate;border-spacing:8px 0;">
    <tr>
      ${tile(L.t('batches'), String(batches.length))}
      ${tile(L.t('buckets'), `${buckets}`, '#111827')}
      ${tile(L.t('onTime'), String(onTime), '#047857')}
      ${tile(L.t('problems'), String(problems), problems ? '#B91C1C' : '#111827')}
    </tr>
  </table>
  <p style="margin:6px 8px 0;font-size:10.5px;color:#767676;">${L.t('bucketsLine', { b: buckets, c: Math.round(buckets * CHICKENS_PER_BUCKET), per: CHICKENS_PER_BUCKET })}</p>

  <table style="width:100%;margin-top:16px;border-collapse:collapse;font-size:12px;">
    <tr style="text-align:${L.start};color:#767676;font-size:10.5px;text-transform:uppercase;letter-spacing:${L.ar ? 0 : 0.5}px;">
      <th style="padding:6px;border-bottom:2px solid #111827;">#</th>
      <th style="padding:6px;border-bottom:2px solid #111827;">${L.t('colIn')}</th>
      <th style="padding:6px;border-bottom:2px solid #111827;">${L.t('buckets')}</th>
      <th style="padding:6px;border-bottom:2px solid #111827;">${L.t('colDue')}</th>
      <th style="padding:6px;border-bottom:2px solid #111827;">${L.t('colOut')}</th>
      <th style="padding:6px;border-bottom:2px solid #111827;">${L.t('colResult')}</th>
      <th style="padding:6px;border-bottom:2px solid #111827;">${L.t('colPhoto')}</th>
    </tr>
    ${rows || `<tr><td colspan="7" style="padding:18px;text-align:center;color:#767676;">${L.t('noMarination')}</td></tr>`}
  </table>

  <table style="width:100%;margin-top:22px;border-top:1px solid #e5e7eb;font-size:10px;color:#767676;">
    <tr>
      <td style="padding-top:10px;text-align:${L.start};">${L.t('footer')}</td>
      <td style="padding-top:10px;text-align:${L.end};">${L.t('marFooter', { h: rules.hours, early: rules.earlyGraceMin, late: rules.lateGraceMin })}</td>
    </tr>
  </table>
</body>
</html>`;
}

function reportFilename(data: MarinationReportData): string {
  return `marination-${safeFilenamePart(data.branchName)}-${data.day}.pdf`;
}

/** Web only: builds the PDF file; sharing is a second tap (iPhone browsers open the share sheet only from a tap). */
export async function buildWebMarinationFile(data: MarinationReportData): Promise<globalThis.File> {
  const logo = await getLogoDataUri();
  return htmlToPdfFile(buildHtml(data, logo), reportFilename(data));
}

/** Phones: build the PDF and open the share sheet in one go. */
export async function exportMarinationReport(data: MarinationReportData): Promise<void> {
  const logo = await getLogoDataUri();
  const { uri } = await Print.printToFileAsync({ html: buildHtml(data, logo) });
  const source = new File(uri);
  const renamed = new File(Paths.cache, reportFilename(data));
  renamed.create({ overwrite: true });
  renamed.write(await source.bytes());
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(renamed.uri, { mimeType: 'application/pdf', dialogTitle: `Marination — ${data.branchName}`, UTI: 'com.adobe.pdf' });
  }
}
