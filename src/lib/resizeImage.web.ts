/**
 * Shrinks a captured photo before upload, in the browser. A phone camera gives
 * ~3000-4000 px; a checklist with 27 of those made uploads and the exported PDF
 * crawl. Scaling the long edge to 2200 px cuts the data about five-fold while
 * leaving room to zoom in on a label or a date.
 *
 * Returns the original string unchanged if anything fails — a slow upload is
 * far better than a lost photo.
 */
export async function resizeImage(base64: string, maxEdge = 2200, quality = 0.82): Promise<string> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = `data:image/jpeg;base64,${base64}`;
    });

    const longest = Math.max(img.width, img.height);
    if (!longest || longest <= maxEdge) return base64;

    const scale = maxEdge / longest;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return base64;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const out = canvas.toDataURL('image/jpeg', quality).split(',')[1];
    // Guard against a pathological case where re-encoding grew the file.
    return out && out.length < base64.length ? out : base64;
  } catch {
    return base64;
  }
}
