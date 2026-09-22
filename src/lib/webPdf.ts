/** Phones build the PDF with expo-print; only the web needs this (see webPdf.web.ts). */
export async function htmlToPdfFile(_html: string, _filename: string): Promise<File> {
  throw new Error('htmlToPdfFile is web-only');
}

export async function shareOrDownloadFile(_file: File): Promise<void> {
  throw new Error('shareOrDownloadFile is web-only');
}
