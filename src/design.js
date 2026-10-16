// "Your own design": a PDF or image the user supplies, with text boxes filled from the sheet.
// One record (spreadsheet row) prints one copy of the design: the chosen pages, in order.
import { PDFDocument, PrintScaling, degrees } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { placeLines } from "./layout.js";

const MM = 72 / 25.4; // PDF points per millimetre
export const MAX_DESIGN_BYTES = 20 * 1024 * 1024;
export const MAX_DESIGN_PAGES = 50;
export const MAX_BLOCKS = 8;
export const MAX_BLOCK_LINES = 8;
const PROJECT_VERSION = 1;

// DIN 5008 form B address field: what most European C4/C5 window envelopes are made for,
// with an A4 letter flat (C4) or folded once (C5). Envelopes vary, so the UI says to check.
export const WINDOW_BOX = { left: 20, top: 45, width: 85, height: 45 };

// Page sizes offered for image designs, which carry no size of their own (mm, portrait).
export const imageSizes = [
  ["A4", 210, 297],
  ["A5", 148, 210],
  ["A6", 105, 148],
  ["DL", 99, 210],
  ["US Letter", 215.9, 279.4],
  ["Badge 90 × 55 mm", 55, 90],
  ["Badge 85 × 55 mm", 55, 85],
];

const sniff = (bytes) => {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  // PDFs may have junk before the header; readers allow it within the first 1 KB.
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  return head.includes("%PDF-") ? "pdf" : null;
};

const round = (n) => Math.round(n * 100) / 100;

// Reads and checks a design file. Pages are described as they display: width and height in mm
// after /Rotate, from the TrimBox (so bleed is dropped) or else the CropBox or MediaBox.
export async function readDesign(bytes, name) {
  if (bytes.length > MAX_DESIGN_BYTES) throw Error("Please use a design file smaller than 20 MB.");
  const type = sniff(bytes);
  if (!type) throw Error("Choose a PDF, PNG or JPEG file.");
  if (type !== "pdf") {
    let image;
    try {
      image = await (await PDFDocument.create())[type === "png" ? "embedPng" : "embedJpg"](bytes);
    } catch {
      throw Error("The image could not be read. Try saving it again as a PNG.");
    }
    return {
      name,
      kind: "image",
      type,
      bytes,
      pixels: { width: image.width, height: image.height },
    };
  }
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    // pdf-lib's EncryptedPDFError doesn't survive bundling as its own class; its message does.
    if (/encrypted/i.test(e?.message))
      throw Error(
        "This PDF is protected. Export or save it again without a password or restrictions.",
      );
    throw Error("The PDF could not be read. Try exporting it again.");
  }
  let count;
  try {
    count = doc.getPageCount();
  } catch {
    throw Error("The PDF could not be read. Try exporting it again.");
  }
  if (!count) throw Error("This PDF has no pages.");
  if (count > MAX_DESIGN_PAGES)
    throw Error(`Please use a design with no more than ${MAX_DESIGN_PAGES} pages.`);
  // Page embedding omits annotations. Flatten owned widgets and reject other annotations.
  const form = doc.getForm();
  const widgets = new Set(
    form.getFields().flatMap((field) => field.acroField.getWidgets().map((widget) => widget.dict)),
  );
  const widgetAnnotations = [];
  for (const page of doc.getPages()) {
    const annotations = page.node.Annots();
    for (let i = 0; i < (annotations?.size() ?? 0); i++) {
      const ref = annotations.get(i);
      if (!widgets.has(doc.context.lookup(ref)))
        throw Error(
          "This PDF has annotations that cannot be preserved. Flatten or export it to PDF first.",
        );
      widgetAnnotations.push([page, ref]);
    }
  }
  try {
    if (form.getFields().length) form.flatten();
    // pdf-lib 1.17 can leave dangling widget refs after flattening; these were all drawn above.
    for (const [page, ref] of widgetAnnotations) page.node.removeAnnot(ref);
  } catch {
    throw Error("This PDF has forms that cannot be preserved. Flatten or export it to PDF first.");
  }
  bytes = await doc.save({ updateFieldAppearances: false });
  const pages = doc.getPages().map((page) => {
    const rotate = ((page.getRotation().angle % 360) + 360) % 360;
    if (rotate % 90) throw Error("This PDF has a page at an unusual angle. Export it again.");
    const media = page.getMediaBox();
    const box = page.getTrimBox();
    const bled = box.width < media.width - 1 || box.height < media.height - 1;
    const turned = rotate % 180 !== 0;
    return {
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      rotate,
      width: round((turned ? box.height : box.width) / MM),
      height: round((turned ? box.width : box.height) / MM),
      bled,
      // A page with nothing on it (say, a blank back) has no content for pdf-lib to embed.
      blank: !page.node.Contents(),
    };
  });
  // Embedding is what the export does, so a file it would choke on is rejected now.
  try {
    const scratch = await PDFDocument.create();
    for (const [i, page] of pages.entries())
      if (!page.blank) await scratch.embedPage(doc.getPage(i), bounds(page));
    await scratch.flush();
  } catch {
    throw Error("The PDF could not be read. Try exporting it again.");
  }
  return { name, kind: "pdf", bytes, pages };
}

const bounds = ({ box }) => ({
  left: box.x,
  bottom: box.y,
  right: box.x + box.width,
  top: box.y + box.height,
});

// How to draw an embedded page (whose own coordinates ignore /Rotate) so it appears upright:
// drawPage rotates anticlockwise about (x, y), so turn it back and move it onto the page.
export function artworkPlacement({ rotate, box }) {
  const { width: w, height: h } = box;
  if (rotate === 90) return { x: 0, y: w, rotate: -90 };
  if (rotate === 180) return { x: w, y: h, rotate: 180 };
  if (rotate === 270) return { x: h, y: 0, rotate: 90 };
  return { x: 0, y: 0, rotate: 0 };
}

// The size of output page i of the design in mm; an image fills the size the user picked.
export const pageSize = (design, settings, i) =>
  design.kind === "image" ? settings.imageSize : design.pages[i];

// A fresh text box. Address boxes on letter-sized pages start in the window position.
export function newBlock(role, page) {
  const base = {
    id: Math.random().toString(36).slice(2, 10),
    source: "columns",
    fields: [[]],
    text: "",
    weight: "regular",
    align: "left",
    valign: "top",
  };
  const margin = round(Math.min(10, page.width * 0.08));
  const width = round(page.width - 2 * margin);
  if (role === "name")
    return {
      ...base,
      role,
      name: "Name",
      box: {
        left: margin,
        top: round(page.height * 0.38),
        width,
        height: round(page.height * 0.22),
      },
      size: 24,
      minSize: 12,
      weight: "bold",
      align: "center",
      valign: "middle",
    };
  if (role === "organisation")
    return {
      ...base,
      role,
      name: "Organisation",
      box: {
        left: margin,
        top: round(page.height * 0.62),
        width,
        height: round(page.height * 0.12),
      },
      size: 12,
      minSize: 7,
      align: "center",
    };
  if (role === "address")
    return {
      ...base,
      role,
      name: "Address",
      fields: [],
      box:
        page.width >= WINDOW_BOX.left + WINDOW_BOX.width + 10 &&
        page.height >= WINDOW_BOX.top + WINDOW_BOX.height + 10
          ? { ...WINDOW_BOX }
          : {
              left: margin,
              top: margin,
              width,
              height: round(Math.min(45, page.height - 2 * margin)),
            },
      size: 11,
      minSize: 6,
    };
  return {
    ...base,
    role: "text",
    name: "Text",
    box: {
      left: margin,
      top: margin,
      width,
      height: round(Math.min(20, page.height - 2 * margin)),
    },
    size: 11,
    minSize: 6,
  };
}

// Columns are saved by heading (and which of several same-named headings), not position, so a
// project still works when the spreadsheet is exported again with columns in another order.
export const normalizeHeading = (h) => String(h).trim().toLowerCase().replace(/\s+/g, " ");
export function columnRef(headers, i) {
  const name = headers[i];
  return {
    name,
    nth: headers.slice(0, i).filter((h) => normalizeHeading(h) === normalizeHeading(name)).length,
  };
}
export function columnIndex(headers, ref) {
  if (!ref) return -1;
  let seen = 0;
  return headers.findIndex(
    (h) => normalizeHeading(h) === normalizeHeading(ref.name) && seen++ === ref.nth,
  );
}

// Draws the records into a new PDF. fits[b] maps block b's lines to their fit; measure(weight)
// gives that weight's width function; fontBytes(weight) the font file.
export async function buildDesignPdf({ design, settings, records, fits, measure, fontBytes }) {
  const doc = await PDFDocument.create();
  doc.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  doc.registerFontkit(fontkit);
  const fonts = {};
  // Not subset: see embedFont in main.js.
  const font = async (weight) =>
    (fonts[weight] ??= await doc.embedFont(new Uint8Array(await fontBytes(weight)), {
      subset: false,
    }));
  const { blocks, pages } = settings;
  const art = {};
  if (settings.printArtwork) {
    if (design.kind === "pdf") {
      const source = await PDFDocument.load(design.bytes, { updateMetadata: false });
      for (const i of pages)
        if (!design.pages[i].blank)
          art[i] = await doc.embedPage(source.getPage(i), bounds(design.pages[i]));
    } else
      art[0] = await (design.type === "png"
        ? doc.embedPng(design.bytes)
        : doc.embedJpg(design.bytes));
  }
  for (const record of records) {
    for (const i of pages) {
      const size = pageSize(design, settings, i);
      const page = doc.addPage([size.width * MM, size.height * MM]);
      if (art[i] && design.kind === "pdf") {
        const place = artworkPlacement(design.pages[i]);
        page.drawPage(art[i], { x: place.x, y: place.y, rotate: degrees(place.rotate) });
      } else if (art[i])
        page.drawImage(art[i], { x: 0, y: 0, width: size.width * MM, height: size.height * MM });
      if (i !== settings.textPage) continue;
      for (const [b, block] of blocks.entries()) {
        const lines = record.blocks[b];
        if (!lines.length) continue;
        const fit = fits[b].get(lines);
        if (!fit)
          throw Error(`The ${block.name} box does not fit. Shorten its text and try again.`);
        const measured = measure(block.weight);
        const weightFont = await font(block.weight);
        for (const line of placeLines(fit, block.box, block, measured))
          page.drawText(line.text, {
            x: line.x * MM,
            y: (size.height - line.y) * MM,
            size: fit.size,
            font: weightFont,
          });
      }
    }
    if (settings.duplex && pages.length % 2) {
      const size = pageSize(design, settings, pages.at(-1));
      doc.addPage([size.width * MM, size.height * MM]);
    }
  }
  return doc.save();
}
export const recordPageCount = (settings) =>
  settings.pages.length + (settings.duplex ? settings.pages.length % 2 : 0);

// Project files: the design itself plus everything needed to print it again.
export function projectFile({ design, settings, toBase64 }) {
  const { blocks, textPage, pages, printArtwork, imageSize, copies, duplex } = settings;
  return JSON.stringify({
    app: "Mailroom",
    kind: "design-project",
    version: PROJECT_VERSION,
    design: { name: design.name, data: toBase64(design.bytes) },
    settings: { textPage, pages, printArtwork, imageSize, copies, duplex: Boolean(duplex), blocks },
  });
}

const PROJECT_ERROR = "This isn't a Mailroom project file, or it is damaged.";
const inRange = (n, min, max) =>
  typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
const oneOf = (value, options, fallback) => (options.includes(value) ? value : fallback);
const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");

function readRef(ref) {
  if (ref === null || ref === undefined) return null;
  if (typeof ref?.name !== "string" || !Number.isInteger(ref.nth) || ref.nth < 0 || ref.nth > 1000)
    throw Error(PROJECT_ERROR);
  return { name: ref.name.slice(0, 500), nth: ref.nth };
}

function readBlock(block) {
  const box = block?.box;
  if (
    !["left", "top", "width", "height"].every((k) => inRange(box?.[k], -1000, 2000)) ||
    !(box.width > 0 && box.height > 0) ||
    !inRange(block.size, 4, 200) ||
    !inRange(block.minSize, 4, 200) ||
    !Array.isArray(block.fields) ||
    block.fields.length > MAX_BLOCK_LINES
  )
    throw Error(PROJECT_ERROR);
  return {
    id: text(block.id, 20) || Math.random().toString(36).slice(2, 10),
    role: oneOf(block.role, ["address", "name", "organisation", "text"], "text"),
    name: text(block.name, 40) || "Text",
    source: oneOf(block.source, ["columns", "fixed"], "columns"),
    fields: block.fields.map((line) => {
      if (!Array.isArray(line) || line.length > 2) throw Error(PROJECT_ERROR);
      return line.map(readRef);
    }),
    text: text(block.text, 2000),
    box: { left: box.left, top: box.top, width: box.width, height: box.height },
    size: block.size,
    minSize: block.minSize,
    weight: oneOf(block.weight, ["regular", "bold"], "regular"),
    align: oneOf(block.align, ["left", "center", "right"], "left"),
    valign: oneOf(block.valign, ["top", "middle", "bottom"], "top"),
  };
}

// Checks a project file's shape and limits; the design inside is checked by readDesign.
export function readProject(textContent) {
  let project;
  try {
    project = JSON.parse(textContent);
  } catch {
    throw Error(PROJECT_ERROR);
  }
  // Mailroom used to be called LabelGen, so its project files are still accepted.
  if (!["Mailroom", "LabelGen"].includes(project?.app) || project.kind !== "design-project")
    throw Error(PROJECT_ERROR);
  if (project.version > PROJECT_VERSION)
    throw Error(
      "This project was saved by a newer version of Mailroom. Update Mailroom to open it.",
    );
  const { design, settings: s } = project;
  if (
    typeof design?.data !== "string" ||
    !s ||
    !Array.isArray(s.blocks) ||
    s.blocks.length > MAX_BLOCKS
  )
    throw Error(PROJECT_ERROR);
  const pages = Array.isArray(s.pages) ? s.pages.filter((n) => Number.isInteger(n)) : [];
  const imageSize =
    inRange(s.imageSize?.width, 10, 2000) && inRange(s.imageSize?.height, 10, 2000)
      ? { width: s.imageSize.width, height: s.imageSize.height }
      : { width: 210, height: 297 };
  return {
    design: { name: text(design.name, 200) || "design", data: design.data },
    settings: {
      textPage: Number.isInteger(s.textPage) ? s.textPage : 0,
      pages,
      printArtwork: s.printArtwork !== false,
      duplex: s.duplex === true,
      imageSize,
      copies: Number.isInteger(s.copies) && s.copies >= 1 && s.copies <= 100 ? s.copies : 1,
      blocks: s.blocks.map(readBlock),
    },
  };
}

// Keeps page choices that make sense for this design: the text page is always printed.
export function fitPages(design, textPage, pages) {
  const count = design.kind === "pdf" ? design.pages.length : 1;
  const text = Number.isInteger(textPage) && textPage >= 0 && textPage < count ? textPage : 0;
  const chosen = new Set(pages.filter((i) => Number.isInteger(i) && i >= 0 && i < count));
  chosen.add(text);
  return { textPage: text, pages: [...chosen].sort((a, b) => a - b) };
}
