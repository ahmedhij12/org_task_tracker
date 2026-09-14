import * as XLSX from 'xlsx';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { BranchSummaryRow, ReportPeriod } from '@/types';

// expo-file-system's legacy string/base64 API (FileSystem.writeAsStringAsync,
// EncodingType.Base64) throws at runtime on this SDK — it's been replaced by
// the File/Directory class API. XLSX.write's 'array' output (a Uint8Array)
// writes directly via File.write(), so no base64 round-trip is needed.
export async function exportReportToExcel(period: ReportPeriod, rows: BranchSummaryRow[], locale: string): Promise<void> {
  const monthLabel = new Date(period.periodMonth).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  const sheetData = rows.map((r) => ({
    Name: r.subjectName,
    Branch: r.branchName,
    Brand: r.brandName ?? 'Unassigned',
    Points: r.totalPoints,
    'Amount (IQD)': r.iqdAmount,
  }));

  const worksheet = XLSX.utils.json_to_sheet(sheetData);
  const workbook = XLSX.utils.book_new();
  // Excel sheet names are capped at 31 characters.
  XLSX.utils.book_append_sheet(workbook, worksheet, monthLabel.slice(0, 31));

  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as Uint8Array;

  const file = new File(Paths.cache, `report-${period.periodMonth}.xlsx`);
  file.create({ overwrite: true });
  file.write(bytes);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      dialogTitle: monthLabel,
      UTI: 'org.openxmlformats.spreadsheetml.sheet',
    });
  }
}
