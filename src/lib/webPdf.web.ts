/**
 * A real PDF file built in the browser, so it can go through the phone's
 * share sheet (WhatsApp etc.). Printing from the page — the first approach —
 * does nothing in Chrome on iPhone, which can't print from a web page.
 */
export async function htmlToPdfFile(html: string, filename: string): Promise<File> {
  const { default: html2pdf } = await import('html2pdf.js');
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // The offscreen positioning sits on a wrapper: html2pdf clones the element
  // it's given, and a clone carrying left:-10000px would render blank.
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:fixed;left:-10000px;top:0;';
  const page = document.createElement('div');
  page.setAttribute('style', `width:794px;background:#fff;box-sizing:border-box;${doc.body.getAttribute('style') ?? ''}`);
  page.innerHTML = doc.body.innerHTML;
  wrapper.appendChild(page);
  document.body.appendChild(wrapper);
  try {
    await Promise.all(
      Array.from(page.querySelectorAll('img')).map((img) => {
        img.crossOrigin = 'anonymous';
        return img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 8000); });
      })
    );
    const blob: Blob = await html2pdf()
      .set({
        margin: 0,
        image: { type: 'jpeg', quality: 0.85 },
        // 1.5, not 2: the whole report is one canvas before it's cut into
        // pages, and iPhone Safari refuses canvases over ~16.7M pixels.
        html2canvas: { scale: 1.5, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'pt', format: 'a4' },
        // Supported at runtime, missing from the bundled types.
        pagebreak: { mode: ['css'], avoid: ['tr', 'img', 'h3'] },
      } as any)
      .from(page)
      .outputPdf('blob');
    return new File([blob], filename, { type: 'application/pdf' });
  } finally {
    wrapper.remove();
  }
}

/** The share sheet where the browser has one (iPhone Safari/Chrome, Android), a download otherwise. */
export async function shareOrDownloadFile(file: File): Promise<void> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (e: any) {
      if (e?.name !== 'AbortError') throw e; // closing the share sheet isn't an error
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
