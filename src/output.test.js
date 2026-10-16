import { after, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as XLSX from "xlsx";
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PrintScaling,
  decodePDFRawStream,
} from "pdf-lib";
import "./node-assets.js";

const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: "http://localhost/" });
const errors = [];
dom.window.addEventListener("error", (e) => errors.push(e.error));
Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
Object.defineProperty(globalThis, "location", { value: dom.window.location, configurable: true });
Object.defineProperty(globalThis, "localStorage", {
  value: dom.window.localStorage,
  configurable: true,
});
// Keep each downloaded PDF and its file name instead of navigating.
const downloads = [];
const blobs = new Map();
const createObjectURL = URL.createObjectURL;
URL.createObjectURL = (blob) => {
  const url = createObjectURL(blob);
  blobs.set(url, blob);
  return url;
};
dom.window.HTMLAnchorElement.prototype.click = function () {
  downloads.push({ name: this.download, blob: blobs.get(this.href) });
};
await import("./main.js");
after(() => dom.window.close());

const MM = 72 / 25.4;
const $ = (id) => document.getElementById(id);
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
async function waitFor(check) {
  for (let i = 0; i < 200 && !check(); i++) await tick();
  assert.ok(check(), "timed out waiting for the page to update");
}
function fire(element, type) {
  element.dispatchEvent(new dom.window.Event(type, { bubbles: true, cancelable: true }));
}
function setValue(id, value) {
  $(id).value = value;
  fire($(id), $(id).tagName === "SELECT" ? "change" : "input");
}
function dropFile(file) {
  const event = new dom.window.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
  $("drop").dispatchEvent(event);
}
// Back to 21-up labels with no return address, so one failing test can't break the next.
function reset() {
  localStorage.clear();
  for (const [id, value] of [
    ["format", "labels"],
    ["sender-mode", "none"],
  ])
    if ($(id).value !== value) setValue(id, value);
}
// Loads rows with the given headers, each column on its own address line.
async function loadRows(headers, rows) {
  reset();
  localStorage.setItem(
    "mailroom-mapping",
    JSON.stringify({ headers, fields: headers.map((_, i) => [i]), senderFields: [[], [], []] }),
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), "Sheet");
  const name = `book-${Math.random()}.xlsx`;
  dropFile(new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], name));
  await waitFor(() => $("filename").textContent === name && $("count").textContent !== "");
  await tick();
}
async function loadDemo() {
  reset();
  $("count").textContent = "";
  $("demo").click();
  await waitFor(() => $("count").textContent === "24");
}
async function download(button = "download") {
  const before = downloads.length;
  $(button).click();
  await waitFor(() => downloads.length > before && !$(button).disabled);
  const { name, blob } = downloads.at(-1);
  return { name, pdf: await PDFDocument.load(await blob.arrayBuffer()) };
}

// Text runs and images drawn on each page, in drawing order, with text decoded through ToUnicode.
function contents(pdf) {
  const unicode = new Map();
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const text = new TextDecoder().decode(decodePDFRawStream(object).decode());
    for (const [, glyph, code] of text.matchAll(/<([0-9a-f]{4})> <([0-9a-f]+)>/gi))
      unicode.set(
        glyph.toLowerCase(),
        String.fromCharCode(...code.match(/.{4}/g).map((h) => parseInt(h, 16))),
      );
  }
  return pdf.getPages().map((page) => {
    const refs = page.node.Contents();
    const streams =
      refs instanceof PDFArray ? refs.asArray().map((r) => pdf.context.lookup(r)) : [refs];
    const ops = streams
      .map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode()))
      .join("\n");
    const texts = [];
    const images = [];
    let size;
    let matrix;
    for (const line of ops.split("\n")) {
      if (line === "q") matrix = { x: 0, y: 0, width: 1, height: 1 };
      const cm = line.match(/^(\S+) 0 0 (\S+) (\S+) (\S+) cm$/);
      if (cm) {
        const [a, d, e, f] = cm.slice(1).map(Number);
        matrix.x += e * matrix.width;
        matrix.y += f * matrix.height;
        matrix.width *= a;
        matrix.height *= d;
      }
      if (line.endsWith(" Do")) images.push({ ...matrix });
      const tf = line.match(/ ([\d.]+) Tf$/);
      if (tf) size = Number(tf[1]);
      const tm = line.match(/^1 0 0 1 (\S+) (\S+) Tm$/);
      if (tm) texts.push({ x: Number(tm[1]), y: Number(tm[2]), size });
      const tj = line.match(/^<([0-9a-f]*)> Tj$/i);
      if (tj) {
        const glyphs = tj[1].toLowerCase().match(/.{4}/g) ?? [];
        Object.assign(texts.at(-1), {
          glyphs,
          text: glyphs.map((g) => unicode.get(g) ?? "?").join(""),
        });
      }
    }
    return { size: page.getSize(), texts, images };
  });
}
const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 0.01, `${message}: ${actual} ≠ ${expected}`);

test("label geometry matches L7160", async () => {
  await loadDemo();
  await waitFor(() => !$("download").disabled);
  const { pdf } = await download();
  const [first] = contents(pdf);
  assert.equal(pdf.getPageCount(), 2);
  near(first.size.width, 595.28, "page width");
  near(first.size.height, 841.89, "page height");
  const height = first.size.height;
  const [slot0] = first.texts;
  assert.equal(slot0.text, "Alex Morgan");
  near(slot0.x, (7.25 + 3) * MM, "slot 0 x");
  near(slot0.y, height - (15.15 + 3) * MM - slot0.size, "slot 0 y");
  // Slot 20 is the bottom right label: column 3, row 7. Addresses cycle through four names.
  const slot20 = first.texts
    .filter((t) => t.x > (7.25 + 2 * 66) * MM && t.text === "Alex Morgan")
    .at(-1);
  near(slot20.x, (7.25 + 2 * (63.5 + 2.5) + 3) * MM, "slot 20 x");
  near(slot20.y, height - (15.15 + 6 * 38.1 + 3) * MM - slot20.size, "slot 20 y");
  near(first.texts[1].y, slot0.y - 1.2 * slot0.size, "line spacing");
  assert.deepEqual(errors, []);
});

// A 2 x 1 pixel PNG, so the ceadúnas fills its box's width.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DAwPAfAAcAAf9+CLHQAAAAAElFTkSuQmCC",
  ),
  (c) => c.charCodeAt(0),
);

test("envelope geometry: address, return address and ceadúnas", async () => {
  await loadDemo();
  Object.defineProperty($("licence-file"), "files", {
    value: [new File([PNG], "licence.png")],
    configurable: true,
  });
  fire($("licence-file"), "change");
  await waitFor(() => $("licence-name").textContent === "licence.png");
  const envelopes = {
    c5: { page: [229, 162], address: [100, 60], sender: [10, 10], licence: [174, 10, 45, 22.5] },
    c4: { page: [324, 229], address: [150, 90], sender: [12, 12], licence: [262, 12, 50, 25] },
  };
  for (const [format, spec] of Object.entries(envelopes)) {
    setValue("format", format);
    setValue("sender-mode", "fixed");
    setValue("sender-text", "Parish Office\nMain Street");
    await waitFor(
      () => !$("download").disabled && $("page-label").textContent.startsWith("Envelope"),
    );
    const { pdf } = await download();
    const pages = contents(pdf);
    assert.equal(pages.length, 24);
    const [{ size, texts, images }] = pages;
    near(size.width, spec.page[0] * MM, `${format} width`);
    near(size.height, spec.page[1] * MM, `${format} height`);
    const sender = texts.find((t) => t.text === "Parish Office");
    near(sender.x, spec.sender[0] * MM, `${format} return address x`);
    near(sender.y, size.height - spec.sender[1] * MM - sender.size, `${format} return address y`);
    const address = texts.find((t) => t.text === "Alex Morgan");
    near(address.x, spec.address[0] * MM, `${format} address x`);
    near(address.y, size.height - spec.address[1] * MM - address.size, `${format} address y`);
    const [left, top, width, height] = spec.licence;
    assert.equal(images.length, 1);
    near(images[0].x, left * MM, `${format} ceadúnas x`);
    near(images[0].y, size.height - top * MM - height * MM, `${format} ceadúnas y`);
    near(images[0].width, width * MM, `${format} ceadúnas width`);
    near(images[0].height, height * MM, `${format} ceadúnas height`);
  }
  $("licence-remove").click();
  setValue("sender-mode", "none");
  setValue("format", "labels");
  await waitFor(() => $("page-label").textContent === "Sheet 1 of 2");
  assert.deepEqual(errors, []);
});

test("Download is disabled while the PDF builds, then says what was built", async () => {
  await loadDemo();
  $("download").click();
  assert.ok($("download").disabled);
  assert.equal($("status").textContent, "Building PDF…");
  await waitFor(() => $("status").textContent.startsWith("PDF ready"));
  assert.ok(!$("download").disabled);
  assert.match($("status").textContent, /2 sheets of labels/);
  assert.match(downloads.at(-1).name, /^Sample addresses-labels-\d{4}-\d\d-\d\d-\d{4}\.pdf$/);
});

test("the PDF asks viewers not to scale it", async () => {
  await loadDemo();
  const { pdf } = await download();
  assert.equal(pdf.catalog.getViewerPreferences().getPrintScaling(), PrintScaling.None);
});

test("Polish, Romanian, Hungarian and Irish names print", async () => {
  const names = ["Łukasz Wiśniewski", "Ștefan Şahin", "Zoltán Kővári", "Seán Ó Súilleabháin"];
  await loadRows(
    ["Name", "Town"],
    names.map((name) => [name, "Dún Laoghaire"]),
  );
  assert.equal($("status").className, "");
  assert.ok(!$("download").disabled);
  const { pdf } = await download();
  const printed = contents(pdf)[0].texts;
  assert.deepEqual(
    printed.map((t) => t.text),
    names.flatMap((name) => [name, "Dún Laoghaire"]),
  );
  assert.ok(printed.every((t) => !t.glyphs.includes("0000")));

  // Every glyph drawn has Arimo's outline in the embedded font, so viewers can render it.
  const [descriptor] = [...pdf.context.enumerateIndirectObjects()]
    .map(([, object]) => object)
    .filter((object) => object instanceof PDFDict && object.has(PDFName.of("FontFile2")));
  const stream = pdf.context.lookup(descriptor.get(PDFName.of("FontFile2")));
  const embedded = fontkit.create(Buffer.from(decodePDFRawStream(stream).decode()));
  const arimo = fontkit.create(
    await readFile(
      new URL(import.meta.resolve("@expo-google-fonts/arimo/400Regular/Arimo_400Regular.ttf")),
    ),
  );
  for (const { glyphs, text } of printed)
    [...text].forEach((char, i) =>
      assert.equal(
        embedded.getGlyph(parseInt(glyphs[i], 16)).path.toSVG(),
        arimo.glyphForCodePoint(char.codePointAt(0)).path.toSVG(),
        `outline of ${char}`,
      ),
    );
});

test("invisible characters are removed and tabs become spaces", async () => {
  const zwsp = String.fromCharCode(0x200b);
  const nbsp = String.fromCharCode(0xa0);
  await loadRows(["Name", "Street"], [[`Mary${zwsp}Murphy`, `12\tMain${nbsp}Street`]]);
  assert.equal($("status").className, "");
  const label = $("paper").querySelector(".label:not(.blank)");
  assert.equal(label.innerHTML, "MaryMurphy<br>12 Main Street");
  const { pdf } = await download();
  assert.deepEqual(
    contents(pdf)[0].texts.map((t) => t.text),
    ["MaryMurphy", "12 Main Street"],
  );
});

test("an unprintable character names its row and shows in the preview tooltip", async () => {
  await loadRows(
    ["Name", "Street"],
    [
      ["Ada", "Main St"],
      ["Bea 𝒳", "Oak Rd"],
      ["Cy", `O${String.fromCharCode(0x92)}Brien St`],
    ],
  );
  assert.equal($("status").className, "error");
  assert.match($("status").textContent, /^Row 3 \(Bea 𝒳\) contains '𝒳', which can't be printed\./);
  assert.match($("status").textContent, /1 other address also can't be printed/);
  assert.ok($("download").disabled);
  const [bad, control] = $("paper").querySelectorAll(".label.overflow");
  assert.match(bad.title, /contains '𝒳', which can't be printed/i);
  assert.match(control.title, /invisible character \(U\+0092\)/);
  assert.doesNotMatch(bad.title, /too much text/i);
});

test("shrunk and incomplete addresses are reported", async () => {
  await loadRows(
    ["Name", "Street", "Town"],
    [
      ["Ada", "word ".repeat(80), "Cork"],
      ["Bob", "", ""],
      ["Cy", "Main St", ""],
      ["Di", "Oak Rd", "Galway"],
    ],
  );
  assert.equal($("status").className, "");
  assert.match($("status").textContent, /1 address shrunk below 8 pt — check the preview\./);
  assert.doesNotMatch($("status").textContent, /incomplete/);
  assert.ok(!$("warning").hidden);
  assert.match($("warning-title").textContent, /^2 addresses look incomplete\./);
  assert.equal($("paper").querySelectorAll(".label.incomplete").length, 2);
  assert.ok(!$("download").disabled);
  $("warning-ack").click();
  assert.ok($("warning").hidden);
  $("size").value = "12";
  fire($("size"), "input");
  await waitFor(() => $("paper").querySelector(".label").style.fontSize !== "");
  assert.ok($("warning").hidden, "stays hidden once acknowledged");
});

test("a saved label preset prints on its own paper and grid, and can be edited and deleted", async () => {
  await loadDemo();
  $("format").value = "new";
  fire($("format"), "change");
  assert.ok(!$("preset-form").hidden);
  assert.equal($("format").value, "labels", "the list stays on the layout in use");
  assert.equal($("preset-columns").value, "3", "starts as a copy of the chosen sheet");
  assert.ok($("preset-centre").checked, "the built-in sheet is centred");
  assert.equal($("preset-svg").querySelectorAll(".sheet-label").length, 21);
  assert.match($("preset-fit").textContent, /^Fits on A4 portrait/);
  const fill = (values) => {
    for (const [field, value] of Object.entries(values)) $(`preset-${field}`).value = value;
  };
  const save = () => fire($("preset-form"), "submit");
  $("preset-centre").click();
  assert.ok(!$("preset-left").readOnly, "unticking centre lets the margins be typed");
  fill({ name: "Letter 10-up", paper: "letter", columns: "2", rows: "5" });
  fill({ width: "101.6", height: "50.8", columnGap: "4.8", rowGap: "0", padding: "2" });
  fill({ left: "50", top: "12.7" });
  fire($("preset-left"), "input");
  assert.match($("preset-error").textContent, /off the right of the page/, "checked as you type");
  assert.equal($("preset-svg").querySelectorAll(".sheet-label.off").length, 5);
  assert.equal($("preset-total").textContent, "10 labels per sheet");
  save();
  assert.ok(!$("preset-form").hidden, "a sheet that doesn't fit isn't saved");
  $("preset-centre").click();
  assert.equal($("preset-left").value, "3.95");
  assert.equal($("preset-error").textContent, "");
  save();
  await waitFor(() => $("labels").textContent === "24" && $("sheets").textContent === "3");
  assert.ok($("preset-form").hidden);
  const key = $("format").value;
  assert.match(key, /^custom-/);
  assert.equal(
    $("format").selectedOptions[0].textContent,
    "Letter 10-up · 10-up · 101.6 × 50.8 mm",
  );
  assert.equal($("format").selectedOptions[0].parentElement.label, "Your label presets");
  assert.equal(localStorage.getItem("mailroom-format"), key);
  assert.equal(JSON.parse(localStorage.getItem("mailroom-presets"))[key].columns, 2);
  assert.ok(!$("preset-edit").hidden && !$("preset-delete").hidden);

  const { pdf } = await download();
  const [first] = contents(pdf);
  assert.equal(pdf.getPageCount(), 3);
  near(first.size.width, 215.9 * MM, "page width");
  near(first.size.height, 279.4 * MM, "page height");
  const [slot0] = first.texts;
  near(slot0.x, (3.95 + 2) * MM, "slot 0 x");
  near(slot0.y, first.size.height - (12.7 + 2) * MM - slot0.size, "slot 0 y");
  const slot1 = first.texts.find((t) => t.x > 100 * MM);
  near(slot1.x, (3.95 + 101.6 + 4.8 + 2) * MM, "slot 1 x");

  $("preset-edit").click();
  assert.equal($("preset-name").value, "Letter 10-up");
  assert.equal($("preset-save").textContent, "Save changes");
  assert.equal($("preset-title").textContent, "Edit label preset");
  $("preset-template").value = [...$("preset-template").options].find((o) =>
    o.text.startsWith("Avery 5163"),
  ).value;
  fire($("preset-template"), "change");
  assert.equal($("preset-name").value, "Letter 10-up", "a typed name is kept");
  assert.equal($("preset-columnGap").value, "4.76");
  assert.match($("preset-fit").textContent, /^Fits on Letter portrait/);
  fill({ rows: "4" });
  save();
  await waitFor(() => $("sheets").textContent === "3" && $("skip").options.length === 8);
  assert.equal($("format").value, key, "editing keeps the same sheet");
  assert.equal(Object.keys(JSON.parse(localStorage.getItem("mailroom-presets"))).length, 1);

  window.confirm = () => true;
  $("preset-delete").click();
  await waitFor(() => $("format").value === "labels" && $("sheets").textContent === "2");
  assert.equal($("format").querySelector("optgroup"), null);
  assert.deepEqual(JSON.parse(localStorage.getItem("mailroom-presets")), {});
  assert.ok($("preset-edit").hidden);
  assert.deepEqual(errors, []);
});
