// Reads the TPM % and temperature off a tester photo via the bd-ocr worker.
// The worker holds the Anthropic key as a secret; this endpoint is public but
// CORS-locked to the app origin. Best-effort: the caller keeps the numbers
// editable, so a null or a wrong read is never blocking.
const OCR_URL = 'https://bd-ocr.ahmedhijazi09.workers.dev';

export interface OilReading {
  tpm: number | null;
  tempC: number | null;
}

export async function readTesterPhoto(base64: string, mediaType = 'image/jpeg'): Promise<OilReading> {
  const res = await fetch(OCR_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: base64, media_type: mediaType }),
  });
  if (!res.ok) throw new Error('ocr_failed');
  const data = (await res.json()) as { tpm?: number | null; temp_c?: number | null };
  return { tpm: data.tpm ?? null, tempC: data.temp_c ?? null };
}

export type OilGrade = 'good' | 'watch' | 'change';

/** The VITO rule from the usage instructions: <20 good, 20–<22 watch, >=22 change. */
export function gradeForTpm(tpm: number): OilGrade {
  if (tpm >= 22) return 'change';
  if (tpm >= 20) return 'watch';
  return 'good';
}
