/**
 * Shrinks a captured photo before upload. Phone cameras produce ~3000-4000 px
 * images; a checklist with 27 of them made uploads and the PDF crawl.
 *
 * Native has no canvas, so this is a pass-through there for now (the admin's
 * app uploads far fewer photos). The web build uses resizeImage.web.ts.
 */
export async function resizeImage(base64: string, _maxEdge = 2200, _quality = 0.82): Promise<string> {
  return base64;
}
