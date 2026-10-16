import { test } from "node:test";
import assert from "node:assert/strict";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFDict,
  StandardFonts,
  decodePDFRawStream,
  degrees,
} from "pdf-lib";
import "./node-assets.js";
import {
  BASELINE,
  PT,
  blockItems,
  checkBlocks,
  fitLines,
  pageSizeName,
  placeLines,
} from "./layout.js";
import {
  WINDOW_BOX,
  artworkPlacement,
  buildDesignPdf,
  columnIndex,
  columnRef,
  fitPages,
  newBlock,
  projectFile,
  readDesign,
  readProject,
} from "./design.js";

// After node-assets.js, which teaches Node the font's ?url import.
const { fontBytes } = await import("./font.js");
const MM = 72 / 25.4;
const measures = {};
for (const weight of ["regular", "bold"]) {
  const font = fontkit.create(new Uint8Array(await fontBytes(weight)));
  measures[weight] = (text, size) =>
    ([...text].reduce((w, c) => w + font.glyphForCodePoint(c.codePointAt(0)).advanceWidth, 0) *
      size) /
    font.unitsPerEm;
}
const measure = (weight = "regular") => measures[weight];
const near = (a, b, tolerance = 0.01) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);

// A PDF with one page per size (mm), with optional rotation and trim box per page.
async function pdf(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const { width, height, rotate, trim } of pages) {
    const page = doc.addPage([width * MM, height * MM]);
    page.drawText("artwork", { x: 20, y: 20, size: 12, font });
    if (rotate) page.setRotation(degrees(rotate));
    if (trim)
      page.setTrimBox(trim * MM, trim * MM, (width - 2 * trim) * MM, (height - 2 * trim) * MM);
  }
  return doc.save();
}

// Text drawn on a page: [text-ish hex, x, y] from its content stream(s), in points.
function textOps(page) {
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFDict || contents?.asArray === undefined
      ? [contents]
      : contents.asArray();
  const source = streams
    .map((ref) => page.doc.context.lookup(ref))
    .map((stream) =>
      stream instanceof PDFRawStream
        ? new TextDecoder().decode(decodePDFRawStream(stream).decode())
        : "",
    )
    .join("\n");
  return source;
}

test("placeLines aligns fitted lines left, centre and right, top, middle and bottom", () => {
  const box = { left: 10, top: 20, width: 80, height: 40 };
  const fit = { lines: ["Ada", "Lovelace Ltd"], size: 10 };
  const m = measure();
  const widths = fit.lines.map((l) => m(l, 10) * PT);
  const lineHeight = 12 * PT;
  const top = placeLines(fit, box, { align: "left", valign: "top" }, m);
  near(top[0].x, 10);
  near(top[0].y, 20 + BASELINE * 10 * PT);
  near(top[1].y, 20 + lineHeight + BASELINE * 10 * PT);
  const centre = placeLines(fit, box, { align: "center", valign: "middle" }, m);
  near(centre[0].x, 10 + (80 - widths[0]) / 2);
  near(centre[1].x, 10 + (80 - widths[1]) / 2);
  near(centre[0].y, 20 + (40 - 2 * lineHeight) / 2 + BASELINE * 10 * PT);
  const right = placeLines(fit, box, { align: "right", valign: "bottom" }, m);
  near(right[1].x + widths[1], 90);
  near(right[1].y, 60 - lineHeight + BASELINE * 10 * PT);
});

test("fitLines never goes below the minimum size", () => {
  const long = ["A name far too long for a very small badge box indeed"];
  assert.throws(() => fitLines(long, measure(), 40, 20, 24, 14));
  assert.equal(fitLines(["Ada"], measure(), 200, 40, 24, 14).size, 24);
});

test("blockItems keeps fixed text shared, drops empty rows and flags incomplete addresses", () => {
  const blocks = [
    { role: "name", source: "columns", fields: [[0, 1]] },
    { role: "address", source: "columns", fields: [[2], [3]] },
    { role: "text", source: "fixed", text: "Summit 2026\n\n Dublin " },
  ];
  const rows = [
    ["Ada", "Lovelace", "1 Road", "Dublin"],
    ["", "", "", ""],
    ["Bob", "", "2 Lane", ""],
  ];
  const items = blockItems(rows, blocks);
  assert.deepEqual(
    items.map((i) => i.row),
    [0, 2],
  );
  assert.deepEqual(items[0].blocks[0], ["Ada Lovelace"]);
  assert.deepEqual(items[0].blocks[2], ["Summit 2026", "Dublin"]);
  assert.equal(items[0].blocks[2], items[1].blocks[2]);
  assert.equal(items[0].incomplete, false);
  assert.equal(items[1].incomplete, true);
  // With only fixed text every row is a record.
  assert.equal(blockItems(rows, [blocks[2]]).length, 3);
});

test("checkBlocks fits each block in its own box with its own weight", () => {
  const blocks = [
    { ...newBlock("name", { width: 90, height: 55 }), fields: [[0]] },
    {
      ...newBlock("text", { width: 90, height: 55 }),
      fields: [[1]],
      box: { left: 0, top: 0, width: 5, height: 5 },
      minSize: 6,
    },
  ];
  const items = blockItems([["Ada Lovelace", "Too long for five millimetres"]], blocks);
  const [names, texts] = checkBlocks(items, blocks, (t, s, w) => measure(w)(t, s));
  assert.equal(names.failed, 0);
  assert.ok(names.fits.get(items[0].blocks[0]).size <= 24);
  assert.equal(texts.failed, 1);
});

test("pageSizeName names common sizes in either orientation", () => {
  assert.equal(pageSizeName(210, 297), "A4 portrait");
  assert.equal(pageSizeName(297.2, 210), "A4 landscape");
  assert.equal(pageSizeName(90, 55), "Badge landscape");
  assert.equal(pageSizeName(100, 100), "100 × 100 mm");
});

test("column references survive reordered and repeated headings", () => {
  const headers = ["Name", "Email", "Name"];
  const ref = columnRef(headers, 2);
  assert.deepEqual(ref, { name: "Name", nth: 1 });
  assert.equal(columnIndex(["Name", "Name", "Email"], ref), 1);
  assert.equal(columnIndex(["Email", "Name"], ref), -1);
  assert.equal(columnIndex(["Email"], ref), -1);
  assert.equal(columnIndex(["email", " first  NAME "], { name: "First name", nth: 0 }), 1);
});

test("readDesign reads page sizes after rotation and trims bleed", async () => {
  const design = await readDesign(
    await pdf([
      { width: 216, height: 303, trim: 3 },
      { width: 210, height: 297, rotate: 90 },
    ]),
    "mailer.pdf",
  );
  assert.equal(design.kind, "pdf");
  const [front, back] = design.pages;
  near(front.width, 210, 0.05);
  near(front.height, 297, 0.05);
  assert.equal(front.bled, true);
  near(back.width, 297, 0.05);
  near(back.height, 210, 0.05);
  assert.equal(back.rotate, 90);
});

test("readDesign rejects protected, empty and unknown files", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: "Standard" });
  await assert.rejects(readDesign(await doc.save(), "x.pdf"), /protected/);
  await assert.rejects(readDesign(new TextEncoder().encode("hello"), "x.txt"), /PDF, PNG or JPEG/);
  await assert.rejects(
    readDesign(new TextEncoder().encode("%PDF-1.7\ngarbage"), "x.pdf"),
    /could not be read|no pages/,
  );
});

test("artworkPlacement turns each rotation back upright onto the page", () => {
  // Map the embedded page's corners through drawPage's rotate-then-translate and check they
  // land exactly on the displayed page (w × h before rotation).
  const w = 100;
  const h = 50;
  for (const rotate of [0, 90, 180, 270]) {
    const { x, y, rotate: r } = artworkPlacement({ rotate, box: { width: w, height: h } });
    const rad = (r * Math.PI) / 180;
    const corners = [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ].map(([px, py]) => [
      x + px * Math.cos(rad) - py * Math.sin(rad),
      y + px * Math.sin(rad) + py * Math.cos(rad),
    ]);
    const xs = corners.map((c) => Math.round(c[0]) + 0);
    const ys = corners.map((c) => Math.round(c[1]) + 0);
    const [pw, ph] = rotate % 180 ? [h, w] : [w, h];
    assert.deepEqual([Math.min(...xs), Math.max(...xs)], [0, pw], `x at ${rotate}°`);
    assert.deepEqual([Math.min(...ys), Math.max(...ys)], [0, ph], `y at ${rotate}°`);
  }
});

async function build(overrides = {}) {
  const design =
    overrides.design ??
    (await readDesign(
      await pdf([
        { width: 210, height: 297 },
        { width: 210, height: 297 },
      ]),
      "mailer.pdf",
    ));
  const blocks = overrides.blocks ?? [
    { ...newBlock("address", design.pages[0]), fields: [[0], [1]] },
  ];
  const rows = overrides.rows ?? [
    ["Ada Lovelace", "Dublin"],
    ["Bob Byrne", "Cork"],
    ["Cat Cole", "Galway"],
  ];
  const records = blockItems(rows, blocks);
  const fits = checkBlocks(records, blocks, (t, s, w) => measure(w)(t, s)).map((c) => c.fits);
  const settings = {
    textPage: 0,
    pages: [0, 1],
    printArtwork: true,
    imageSize: { width: 210, height: 297 },
    copies: 1,
    blocks,
    ...overrides.settings,
  };
  const bytes = await buildDesignPdf({ design, settings, records, fits, measure, fontBytes });
  return { doc: await PDFDocument.load(bytes), design, blocks, records, fits };
}

const xObjects = (page) => {
  const resources = page.node.Resources();
  const dict = resources?.lookup(PDFName.of("XObject"));
  return dict ? dict.keys().length : 0;
};
const embeddedFonts = (doc) =>
  doc.context
    .enumerateIndirectObjects()
    .filter(
      ([, o]) =>
        o instanceof PDFDict && o.get(PDFName.of("Type"))?.toString() === "/FontDescriptor",
    )
    .map(([, o]) => o.get(PDFName.of("FontName")).toString());

test("each record prints the chosen page set with the design embedded once", async () => {
  const { doc } = await build();
  assert.equal(doc.getPageCount(), 6);
  for (const page of doc.getPages()) assert.equal(xObjects(page), 1);
  const forms = doc.context
    .enumerateIndirectObjects()
    .filter(
      ([, o]) =>
        o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype"))?.toString() === "/Form",
    );
  assert.equal(forms.length, 2, "one form per design page, however many records");
  // Text only on the text page of each record.
  const ops = doc.getPages().map((p) => (textOps(p).match(/Tj/g) ?? []).length);
  assert.deepEqual(ops, [2, 0, 2, 0, 2, 0]);
});

test("address text lands in the window position", async () => {
  const { doc, records, fits, blocks } = await build();
  const fit = fits[0].get(records[0].blocks[0]);
  const [first] = placeLines(fit, blocks[0].box, blocks[0], measure());
  near(first.x, WINDOW_BOX.left, 0.001);
  const source = textOps(doc.getPage(0));
  const td = source.match(/([\d.]+) ([\d.]+) Td/) ?? source.match(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/);
  near(Number(td[1]), first.x * MM, 0.01);
  near(Number(td[2]), (297 - first.y) * MM, 0.01);
});

test("without the background only text is printed", async () => {
  const { doc } = await build({ settings: { printArtwork: false } });
  assert.equal(doc.getPageCount(), 6);
  assert.equal(xObjects(doc.getPage(0)), 0);
});

test("bold is only embedded when a box uses it", async () => {
  const regular = await build();
  assert.deepEqual(
    embeddedFonts(regular.doc).map((n) => n.includes("Bold")),
    [false],
  );
  const page = { width: 210, height: 297 };
  const bold = await build({
    blocks: [{ ...newBlock("name", page), fields: [[0]] }],
  });
  assert.equal(embeddedFonts(bold.doc).filter((n) => n.includes("Bold")).length, 1);
});

test("project files round-trip and reject anything else", async () => {
  const design = await readDesign(await pdf([{ width: 90, height: 55 }]), "badge.pdf");
  const blocks = [
    {
      ...newBlock("name", design.pages[0]),
      fields: [
        [
          { name: "First", nth: 0 },
          { name: "Last", nth: 0 },
        ],
      ],
    },
  ];
  const settings = {
    textPage: 0,
    pages: [0],
    printArtwork: false,
    imageSize: { width: 1, height: 1 },
    copies: 2,
    blocks,
  };
  const text = projectFile({
    design,
    settings,
    toBase64: (b) => Buffer.from(b).toString("base64"),
  });
  const project = readProject(text);
  assert.equal(project.design.name, "badge.pdf");
  assert.deepEqual(Buffer.from(project.design.data, "base64"), Buffer.from(design.bytes));
  assert.deepEqual(project.settings.blocks, blocks);
  assert.equal(project.settings.printArtwork, false);
  assert.equal(project.settings.copies, 2);
  assert.throws(() => readProject("{}"), /isn't a Mailroom project/);
  assert.throws(() => readProject("not json"), /isn't a Mailroom project/);
  const bad = JSON.parse(text);
  bad.settings.blocks[0].box.width = "wide";
  assert.throws(() => readProject(JSON.stringify(bad)), /damaged/);
  const old = JSON.parse(text);
  old.app = "LabelGen";
  assert.equal(
    readProject(JSON.stringify(old)).design.name,
    "badge.pdf",
    "opens LabelGen projects",
  );
  const newer = JSON.parse(text);
  newer.version = 99;
  assert.throws(() => readProject(JSON.stringify(newer)), /newer version/);
});

test("fitPages always prints the text page and drops pages the design lacks", () => {
  const design = { kind: "pdf", pages: [{}, {}, {}] };
  assert.deepEqual(fitPages(design, 1, [2, 7, -1]), { textPage: 1, pages: [1, 2] });
  assert.deepEqual(fitPages(design, 5, []), { textPage: 0, pages: [0] });
  assert.deepEqual(fitPages({ kind: "image" }, 0, [0, 1]), { textPage: 0, pages: [0] });
});

test("horizontal fit rejects wide glyphs at minimum and shrinks until every line fits", () => {
  const width = 1 / PT;
  assert.throws(() => fitLines(["W"], measure(), width, 100, 24, 6), /too long/);
  const exact = measure()("W", 12);
  assert.equal(fitLines(["W"], measure(), exact, 100, 12, 6).size, 12);
  const fit = fitLines(["WWWWWWWW"], measure(), exact, 1000, 24, 6);
  assert.equal(fit.size, 12);
  assert.equal(fitLines(["W"], measure(), exact, 100, 12.1, 12).size, 12);
  assert.ok(fit.lines.every((line) => measure()(line, fit.size) <= exact));
});

test("form-only pages are flattened into artwork and annotations are rejected", async () => {
  const original = await PDFDocument.create();
  const p = original.addPage();
  const form = original.getForm();
  const field = form.createTextField("recipient");
  field.setText("Visible form text");
  field.addToPage(p, { x: 20, y: 20, width: 200, height: 30 });
  const check = form.createCheckBox("checked");
  check.addToPage(p, { x: 20, y: 80, width: 20, height: 20 });
  check.check();
  const design = await readDesign(await original.save(), "form.pdf");
  assert.equal(design.pages[0].blank, false);
  const normalized = await PDFDocument.load(design.bytes);
  assert.equal(normalized.getForm().getFields().length, 0);
  assert.equal(normalized.getPage(0).node.Annots()?.size() ?? 0, 0);
  assert.ok(xObjects(normalized.getPage(0)) >= 2);
  p.node.addAnnot(
    original.context.register(
      original.context.obj({
        Type: "Annot",
        Subtype: "Text",
        Rect: [0, 0, 20, 20],
        Contents: "Visible note",
      }),
    ),
  );
  await assert.rejects(readDesign(await original.save(), "annotated.pdf"), /annotations.*Flatten/);
});

test("duplex inserts blank backs per recipient for odd page sets", async () => {
  for (const n of [1, 2, 3, 4]) {
    const design = await readDesign(
      await pdf(Array.from({ length: n }, () => ({ width: 210, height: 297 }))),
      "duplex.pdf",
    );
    for (const printArtwork of [true, false]) {
      const { doc } = await build({
        design,
        rows: [
          ["Ada", "Dublin"],
          ["Bob", "Cork"],
        ],
        settings: { duplex: true, printArtwork, pages: Array.from({ length: n }, (_, i) => i) },
      });
      assert.equal(doc.getPageCount(), 2 * (n + (n % 2)));
      if (n % 2)
        for (const i of [n, 2 * n + 1]) assert.equal(doc.getPage(i).node.Contents(), undefined);
    }
  }
});
