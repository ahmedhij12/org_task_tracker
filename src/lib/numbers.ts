/**
 * Reads a number the way people here type it: an Arabic keyboard gives
 * Arabic-Indic digits (٣) and the Arabic decimal mark (٫), which Number()
 * does not understand — so "٣" silently became nothing (no "= 24 chickens",
 * and an empty count saved). Returns null for anything that is not a number.
 */
export function toNumber(text: string | null | undefined): number | null {
  if (text == null) return null;
  const latin = String(text)
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, '.')
    .replace(/٬/g, '');
  if (latin === '') return null;
  const n = Number(latin);
  return Number.isFinite(n) ? n : null;
}
