import i18n from '@/lib/i18n';

/**
 * The language a PDF report is written in: the app's own (his request,
 * 2026-09-26 — an Arabic phone or app gets an Arabic report, English gets
 * English). Arabic reads right to left, so `start`/`end` are the physical
 * sides for text-align and padding. The words live in the i18n files under
 * `pdf`. Interpolation does not escape: pass user text already escaped.
 */
export function pdfLanguage(locale: string) {
  const ar = locale.startsWith('ar');
  const fixed = i18n.getFixedT(ar ? 'ar' : 'en');
  return {
    ar,
    lang: ar ? 'ar' : 'en',
    // For dates and numbers: Arabic words, but always the everyday 0-9 digits
    // (his call — "no need to be in Arabic, but show it the proper way").
    locale: ar ? 'ar-u-nu-latn' : 'en-US',
    dir: ar ? 'rtl' : 'ltr',
    start: ar ? 'right' : 'left',
    end: ar ? 'left' : 'right',
    t: (key: string, params?: Record<string, string | number>): string => fixed(`pdf.${key}`, params) as string,
  };
}

export type PdfLanguage = ReturnType<typeof pdfLanguage>;

/** A name or note inside a line in the other language: isolated, so its punctuation stays put. */
export function bdi(escaped: string): string {
  return `<bdi>${escaped}</bdi>`;
}
