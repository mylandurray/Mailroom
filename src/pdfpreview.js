// Draws design pages as images for the preview. pdf.js is large, so it is only loaded the
// first time a PDF design is shown; the labels and envelopes never pay for it.
let pdfjs;
async function load() {
  pdfjs ??= (async () => {
    // Reject before starting the worker: older browsers otherwise throw inside it and hang.
    if (typeof Promise.try !== "function")
      throw Error("PDF preview needs a current browser with Promise.try support.");
    const lib = await import("pdfjs-dist");
    // The single-file build has no separate files to fetch, so its worker is inlined as a blob.
    const { default: PdfWorker } =
      import.meta.env?.MODE === "single"
        ? await import("pdfjs-dist/build/pdf.worker.min.mjs?worker&inline")
        : await import("pdfjs-dist/build/pdf.worker.min.mjs?worker");
    lib.GlobalWorkerOptions.workerPort = new PdfWorker();
    return lib;
  })().catch((e) => {
    pdfjs = null;
    throw e;
  });
  return pdfjs;
}

// One pdf.js document and its rendered pages per design, so re-renders are free.
const cache = new WeakMap();
// pdf.js refuses to open a document while the last one is still being torn down.
let closing = Promise.resolve();

// Resolves to a blob URL of page i of a PDF design, cropped to the page's trim box and upright,
// `pixels` wide. Rejects if pdf.js or canvases aren't available; callers show an outline instead.
export function renderPage(design, i, pixels) {
  let entry = cache.get(design);
  if (!entry) {
    const task = load().then(async (lib) => {
      await closing;
      return lib.getDocument({ data: design.bytes.slice() });
    });
    entry = { task, doc: task.then((t) => t.promise), urls: new Map() };
    cache.set(design, entry);
  }
  const key = `${i}:${pixels}`;
  if (!entry.urls.has(key))
    entry.urls.set(
      key,
      entry.doc.then(async (doc) => {
        const page = await doc.getPage(i + 1);
        const { box, width } = design.pages[i];
        // pdf.js lays out the crop box with /Rotate applied; scale so the trim box is `pixels` wide.
        const scale = pixels / (width * (72 / 25.4));
        const viewport = page.getViewport({ scale });
        const full = document.createElement("canvas");
        full.width = Math.ceil(viewport.width);
        full.height = Math.ceil(viewport.height);
        await page.render({ canvas: full, viewport }).promise;
        const [x1, y1] = viewport.convertToViewportPoint(box.x, box.y);
        const [x2, y2] = viewport.convertToViewportPoint(box.x + box.width, box.y + box.height);
        const crop = document.createElement("canvas");
        crop.width = Math.round(Math.abs(x2 - x1));
        crop.height = Math.round(Math.abs(y2 - y1));
        crop.getContext("2d").drawImage(full, -Math.min(x1, x2), -Math.min(y1, y2));
        const blob = await new Promise((resolve) => crop.toBlob(resolve, "image/png"));
        if (!blob) throw Error("The page could not be drawn.");
        return URL.createObjectURL(blob);
      }),
    );
  return entry.urls.get(key);
}

// Frees a design's rendered pages and its pdf.js document when it is replaced.
export function forget(design) {
  const entry = design && cache.get(design);
  if (!entry) return;
  cache.delete(design);
  for (const url of entry.urls.values()) url.then(URL.revokeObjectURL, () => {});
  closing = entry.task.then((task) => task.destroy()).catch(() => {});
}
