import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import type { ChecklistAnswer, ChecklistSectionPhoto, TaskCompletion } from '@/types';

// Embedded as a data URI (via a real file read, not a hardcoded base64
// string in source) so the logo renders identically regardless of asset
// bundling — same reasoning as the .xlsx export's File/Paths usage.
let cachedLogoDataUri: string | null = null;
async function getLogoDataUri(): Promise<string> {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  const asset = Asset.fromModule(require('../../assets/basra-delight-logo-white-bg.png'));
  await asset.downloadAsync();
  const file = new File(asset.localUri!);
  const base64 = await file.base64();
  cachedLogoDataUri = `data:image/png;base64,${base64}`;
  return cachedLogoDataUri;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface AuditReportData {
  completion: TaskCompletion;
  branchName: string;
  subjectName: string;
  auditorName: string;
  answers: ChecklistAnswer[];
  photos: ChecklistSectionPhoto[];
  locale: string;
}

function buildHtml(data: AuditReportData, logoDataUri: string): string {
  const { completion, branchName, subjectName, auditorName, answers, photos, locale } = data;
  const points = completion.pointsAwarded ?? 0;
  const iqd = Math.abs(points * 25000).toLocaleString(locale);
  const shiftLabel = completion.shift === 'morning' ? 'AM' : completion.shift === 'evening' ? 'PM' : '—';
  const dateLabel = new Date(completion.createdAt).toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' });

  const bySection = new Map<string, ChecklistAnswer[]>();
  for (const a of answers) bySection.set(a.sectionTitle, [...(bySection.get(a.sectionTitle) ?? []), a]);

  const photosBySection = new Map<string, ChecklistSectionPhoto[]>();
  for (const p of photos) photosBySection.set(p.sectionTitle, [...(photosBySection.get(p.sectionTitle) ?? []), p]);

  const sectionsHtml = Array.from(bySection.entries())
    .map(([title, items]) => {
      const rows = items
        .map(
          (a) => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(a.question)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;color:${
            a.answer ? '#059669' : '#dc2626'
          };">${a.answer ? 'Yes' : 'No'}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${a.note ? escapeHtml(a.note) : ''}</td>
        </tr>`
        )
        .join('');
      const sectionPhotos = (photosBySection.get(title) ?? [])
        .map((p) => `<img src="${p.photoUrl}" style="width:110px;height:110px;object-fit:cover;border-radius:8px;margin:4px;" />`)
        .join('');
      return `
        <h3 style="margin:18px 0 6px;color:#1f2937;font-size:14px;">${title ? escapeHtml(title) : 'General'}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
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
  <h1 style="font-size:19px;margin:0 0 2px;text-align:center;">Branch Audit Report</h1>
  <p style="color:#6b7280;font-size:12px;margin:0 0 20px;text-align:center;">${dateLabel}</p>

  <table style="width:100%;font-size:13px;margin-bottom:18px;border-collapse:collapse;">
    <tr><td style="padding:4px 8px 4px 0;color:#6b7280;">Branch</td><td style="font-weight:700;">${escapeHtml(branchName)}</td></tr>
    <tr><td style="padding:4px 8px 4px 0;color:#6b7280;">Subject</td><td style="font-weight:700;">${escapeHtml(subjectName)}</td></tr>
    <tr><td style="padding:4px 8px 4px 0;color:#6b7280;">Auditor</td><td style="font-weight:700;">${escapeHtml(auditorName)}</td></tr>
    <tr><td style="padding:4px 8px 4px 0;color:#6b7280;">Shift</td><td style="font-weight:700;">${shiftLabel}</td></tr>
  </table>

  ${sectionsHtml}

  <div style="margin-top:22px;padding:14px;background:#f3f4f6;border-radius:10px;display:flex;justify-content:space-between;">
    <strong style="font-size:13px;">Total</strong>
    <strong style="font-size:13px;color:${points < 0 ? '#dc2626' : '#111827'};">${points} pts · ${iqd} IQD</strong>
  </div>

  ${
    completion.signatureUrl
      ? `<div style="margin-top:22px;">
    <p style="font-size:11px;color:#6b7280;margin-bottom:6px;">Signature</p>
    <img src="${completion.signatureUrl}" style="width:220px;height:110px;border:1px solid #e5e7eb;border-radius:8px;" />
  </div>`
      : ''
  }
</body>
</html>`;
}

export async function exportAuditReport(data: AuditReportData): Promise<void> {
  const logo = await getLogoDataUri();
  const html = buildHtml(data, logo);
  const { uri } = await Print.printToFileAsync({ html });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Audit — ${data.subjectName}`,
      UTI: 'com.adobe.pdf',
    });
  }
}
