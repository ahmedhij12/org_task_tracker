import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import { tileGrid } from '@/lib/maps';
import { htmlToPdfFile } from '@/lib/webPdf';
import { GRADE_HEX, formatScore, gradeOf, type ScoreGrade } from '@/lib/score';

const GRADE_LABEL: Record<ScoreGrade, string> = { excellent: 'Excellent', good: 'Good', needsWork: 'Needs work', critical: 'Critical' };
import type { ChecklistAnswer, ChecklistSectionPhoto, TaskCompletion } from '@/types';

// Embedded as a data URI (via a real file read, not a hardcoded base64
// string in source) so the logo renders identically regardless of asset
// bundling — same reasoning as the .xlsx export's File/Paths usage.
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

// Keeps Arabic letters (branch names are often Arabic) but strips anything
// unsafe or awkward in a filename.
function safeFilenamePart(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '').trim().replace(/\s+/g, '-') || 'report';
}

export interface AuditReportData {
  /** An admin's audit of someone, or a supervisor/manager's own daily checklist. */
  kind: 'audit' | 'checklist';
  completion: TaskCompletion;
  branchName: string;
  subjectName: string;
  auditorName: string;
  verifiedByName?: string | null;
  answers: ChecklistAnswer[];
  photos: ChecklistSectionPhoto[];
  locale: string;
}

function buildHtml(data: AuditReportData, logoDataUri: string): string {
  const { kind, completion, branchName, subjectName, auditorName, verifiedByName, answers, photos, locale } = data;
  const points = completion.pointsAwarded ?? 0;
  const iqd = Math.abs(points * completion.iqdPerPoint).toLocaleString(locale);
  const score = completion.score;
  const shiftLabel = completion.shift === 'morning' ? 'AM' : completion.shift === 'evening' ? 'PM' : '—';
  const dateLabel = new Date(completion.createdAt).toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' });

  const bySection = new Map<string, ChecklistAnswer[]>();
  for (const a of answers) bySection.set(a.sectionTitle, [...(bySection.get(a.sectionTitle) ?? []), a]);

  const photosBySection = new Map<string, ChecklistSectionPhoto[]>();
  for (const p of photos) photosBySection.set(p.sectionTitle, [...(photosBySection.get(p.sectionTitle) ?? []), p]);

  // Left-to-right, per explicit user feedback: an initial RTL version (the
  // Question column flipped to the right, matching the Arabic content)
  // tested as more confusing than familiar left-to-right, not less. Fixed
  // column widths (kept from that attempt) still keep Answer legible
  // regardless of how long a question runs.
  const sectionsHtml = Array.from(bySection.entries())
    .map(([title, items]) => {
      const rows = items
        .map(
          (a) => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(a.question)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;color:${
            a.answer == null ? '#9ca3af' : a.answer ? '#059669' : '#dc2626'
          };">${a.answer == null ? 'N/A' : a.answer ? 'Yes' : 'No'}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${a.note ? escapeHtml(a.note) : ''}</td>
        </tr>`
        )
        .join('');
      const sectionPhotos = (photosBySection.get(title) ?? [])
        .map((p) => `<img src="${p.photoUrl}" style="width:110px;height:110px;object-fit:cover;border-radius:8px;margin:4px;" />`)
        .join('');
      return `
        <h3 style="margin:18px 0 6px;color:#1f2937;font-size:14px;">${title ? escapeHtml(title) : 'General'}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;">
          <colgroup>
            <col style="width:55%;" />
            <col style="width:15%;" />
            <col style="width:30%;" />
          </colgroup>
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="text-align:left;padding:6px 8px;">Question</th>
              <th style="padding:6px 8px;">Answer</th>
              <th style="text-align:left;padding:6px 8px;">Note</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${sectionPhotos ? `<div style="margin-top:8px;">${sectionPhotos}</div>` : ''}
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, Helvetica, Arial, sans-serif; padding:28px; color:#111827;">
  <div style="text-align:center;margin-bottom:20px;">
    <img src="${logoDataUri}" style="height:56px;" />
  </div>
  <h1 style="font-size:19px;margin:0 0 2px;text-align:center;">${kind === 'audit' ? 'Branch Audit Report' : escapeHtml(completion.taskTitle)}</h1>
  <p style="color:#6b7280;font-size:12px;margin:0 0 20px;text-align:center;">${dateLabel}</p>
  ${
    score != null
      ? `<div style="text-align:center;margin:-6px 0 20px;">
    <div style="display:inline-block;border:4px solid ${GRADE_HEX[gradeOf(score)]};border-radius:999px;width:92px;height:92px;line-height:1;box-sizing:border-box;padding-top:22px;">
      <div style="font-size:30px;font-weight:800;color:#111827;">${formatScore(score)}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:3px;">/ 100</div>
    </div>
    <div style="font-size:13px;font-weight:700;color:${GRADE_HEX[gradeOf(score)]};margin-top:6px;">${GRADE_LABEL[gradeOf(score)]}</div>
  </div>`
      : ''
  }

  ${kind === 'audit' ? '' : checklistInfoHtml(completion, branchName, subjectName, verifiedByName ?? null)}
  ${kind === 'audit' ? `<table style="width:100%;font-size:13px;margin-bottom:18px;border-collapse:collapse;">
    <tr><td style="padding:4px 8px 4px 0;color:#6b7280;">Branch</td><td style="font-weight:700;">${escapeHtml(branchName)}</td></tr>
    <tr><td style="padding:4px 8px 4px 0;color:#6b7280;">Subject</td><td style="font-weight:700;">${escapeHtml(subjectName)}</td></tr>
    <tr><td style="padding:4px 8px 4px 0;color:#6b7280;">Auditor</td><td style="font-weight:700;">${escapeHtml(auditorName)}</td></tr>
    <tr><td style="padding:4px 8px 4px 0;color:#6b7280;">Shift</td><td style="font-weight:700;">${shiftLabel}</td></tr>
    <tr><td style="padding:4px 8px 4px 0;color:#6b7280;">Penalty</td><td style="font-weight:700;color:${points < 0 ? '#dc2626' : '#111827'};">${points} pts</td></tr>
    <tr><td style="padding:4px 8px 4px 0;color:#6b7280;">Amount</td><td style="font-weight:700;color:${points < 0 ? '#dc2626' : '#111827'};">${iqd} IQD</td></tr>
  </table>` : ''}

  ${sectionsHtml}


  ${signatureAndLocationHtml(completion)}
</body>
</html>`;
}

/** The header for a daily checklist: who filled it, where, the tally, the selfie. */
function checklistInfoHtml(completion: TaskCompletion, branchName: string, byName: string, verifiedByName: string | null): string {
  const row = (label: string, value: string, color = '#111827') =>
    `<tr><td style="padding:4px 8px 4px 0;color:#6b7280;">${label}</td><td style="font-weight:700;color:${color};">${value}</td></tr>`;
  const table = `<table style="font-size:13px;border-collapse:collapse;">
    ${row('Branch', escapeHtml(branchName))}
    ${row('Filled by', escapeHtml(byName))}
    ${row('Yes', String(completion.yesCount ?? 0), '#059669')}
    ${row('No', String(completion.noCount ?? 0), (completion.noCount ?? 0) > 0 ? '#dc2626' : '#111827')}
    ${row('Verified', verifiedByName ? `✓ ${escapeHtml(verifiedByName)}` : 'Waiting for the admin', verifiedByName ? '#059669' : '#d97706')}
  </table>`;
  const selfie = completion.selfieUrl
    ? `<img src="${completion.selfieUrl}" style="width:96px;height:120px;object-fit:cover;border-radius:8px;" />`
    : '';
  return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px;">${table}${selfie}</div>`;
}

/**
 * A static mini map for the PDF, built from OpenStreetMap's standard tiles
 * (CARTO's now need an API key and come back watermarked) laid out so the
 * signing point sits dead centre, with a pin on top. Tiles are fetched one
 * zoom level deeper and drawn at half size, so the print stays sharp.
 * Plain positioned <img>s, so it prints the same from expo-print and from
 * a browser. Only fetched when someone exports a PDF — light use, within
 * OSM's tile policy, attribution included.
 */
function miniMapHtml(lat: number, lng: number, width: number, height: number): string {
  const tiles = tileGrid(lat, lng, width, height).map(
    (t) =>
      `<img src="${t.url}" style="position:absolute;left:${t.left}px;top:${t.top}px;width:${t.size}px;height:${t.size}px;" />`
  );
  const pin = `<svg width="26" height="34" viewBox="0 0 26 34" style="position:absolute;left:${width / 2 - 13}px;top:${height / 2 - 32}px;">
      <path d="M13 1C6.4 1 1 6.3 1 12.8 1 21.6 13 33 13 33s12-11.4 12-20.2C25 6.3 19.6 1 13 1z" fill="#dc2626" stroke="#fff" stroke-width="2"/>
      <circle cx="13" cy="12.5" r="4.5" fill="#fff"/>
    </svg>`;
  return `<div style="position:relative;width:${width}px;height:${height}px;overflow:hidden;border:1px solid #e5e7eb;border-radius:8px;background:#eef0f3;">
    ${tiles.join('')}
    ${pin}
    <div style="position:absolute;right:3px;bottom:2px;font-size:7px;color:#6b7280;background:rgba(255,255,255,0.85);padding:0 3px;border-radius:3px;">© OpenStreetMap contributors</div>
  </div>`;
}

/** Signature on the left, where it was signed on the right — side by side, same height. */
function signatureAndLocationHtml(completion: TaskCompletion): string {
  const hasSig = !!completion.signatureUrl;
  const hasLoc = completion.signedLat != null && completion.signedLng != null;
  if (!hasSig && !hasLoc) return '';
  const sig = hasSig
    ? `<div>
    <p style="font-size:11px;color:#6b7280;margin:0 0 6px;">Signature</p>
    <img src="${completion.signatureUrl}" style="width:220px;height:130px;border:1px solid #e5e7eb;border-radius:8px;object-fit:contain;background:#fff;" />
  </div>`
    : '<div></div>';
  const loc = hasLoc
    ? `<div>
    <p style="font-size:11px;color:#6b7280;margin:0 0 6px;">Signed at</p>
    <a href="https://www.google.com/maps/search/?api=1&query=${completion.signedLat},${completion.signedLng}" style="text-decoration:none;color:inherit;">
      ${miniMapHtml(completion.signedLat!, completion.signedLng!, 240, 130)}
      <p style="font-size:11px;color:#111827;font-weight:600;margin:6px 0 0;max-width:240px;">${escapeHtml(completion.signedAddress ?? 'Open in Maps')}${
        completion.signedAccuracyM != null ? ` <span style="color:#6b7280;font-weight:400;">(±${Math.round(completion.signedAccuracyM)} m)</span>` : ''
      }</p>
    </a>
  </div>`
    : '';
  return `<div style="margin-top:22px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;page-break-inside:avoid;">${sig}${loc}</div>`;
}

function reportFilename(data: AuditReportData): string {
  const dateForFilename = new Date(data.completion.createdAt).toISOString().slice(0, 10);
  return `${safeFilenamePart(data.branchName)}-${dateForFilename}.pdf`;
}

/**
 * Web only: builds the PDF file. Sharing is a separate tap (shareOrDownloadFile)
 * because iPhone browsers only open the share sheet straight from a tap, and
 * building the file takes a few seconds — too long after the first tap.
 */
export async function buildWebReportFile(data: AuditReportData): Promise<globalThis.File> {
  const logo = await getLogoDataUri();
  return htmlToPdfFile(buildHtml(data, logo), reportFilename(data));
}

/** Phones: build the PDF and open the share sheet in one go. */
export async function exportAuditReport(data: AuditReportData): Promise<void> {
  const logo = await getLogoDataUri();
  const html = buildHtml(data, logo);
  const filename = reportFilename(data);

  const { uri } = await Print.printToFileAsync({ html });

  // printToFileAsync always names its output a random UUID — rename to
  // something meaningful (the branch, the date) before handing it to the
  // share sheet, so whatever the recipient sees/saves isn't a GUID.
  const source = new File(uri);
  const renamed = new File(Paths.cache, filename);
  renamed.create({ overwrite: true });
  renamed.write(await source.bytes());

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(renamed.uri, {
      mimeType: 'application/pdf',
      dialogTitle: `${data.kind === 'audit' ? 'Audit' : data.completion.taskTitle} — ${data.subjectName}`,
      UTI: 'com.adobe.pdf',
    });
  }
}
