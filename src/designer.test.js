import { after, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";
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
// Keep each download instead of navigating.
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
// The preview's pdf.js can't run here; the page says so and carries on.
const warn = console.warn;
console.warn = () => {};
after(() => (console.warn = warn));
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
function drop(zone, file) {
  const event = new dom.window.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
  $(zone).dispatchEvent(event);
}
function chooseFile(input, file) {
  Object.defineProperty($(input), "files", { value: [file], configurable: true });
  fire($(input), "change");
}
// Each design gets its own name, so a test can wait for its design to replace the last one.
let designs = 0;
async function pdf(sizes) {
  const doc = await PDFDocument.create();
  for (const [w, h] of sizes) doc.addPage([w * MM, h * MM]);
  return new File([await doc.save()], `design${++designs}.pdf`);
}
function sheet(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "people.xlsx");
}
const people = [
  ["First name", "Last name", "Company", "Street", "Town"],
  ["Ada", "Lovelace", "Analytical Engines", "1 Road", "Dublin"],
  ["Bob", "Byrne", "", "2 Lane", "Cork"],
  ["", "", "", "", ""],
];
const panel = (b) => $("blocks").querySelector(`[data-block="${b}"]`);
function setBlock(b, selector, value) {
  const input = panel(b).querySelector(selector);
  if (input.type === "checkbox") input.checked = value;
  else input.value = value;
  fire(input, input.matches("select, input[type=checkbox]") ? "change" : "input");
}
async function start(sizes = [[210, 297]], rows = people) {
  $("format").value = "design";
  fire($("format"), "change");
  drop("drop", sheet(rows));
  await waitFor(() => $("filename").textContent === "people.xlsx");
  const file = await pdf(sizes);
  drop("design-drop", file);
  await waitFor(() => $("design-name").textContent === file.name && $("count").textContent !== "0");
  return file.name;
}

test("choosing your own design swaps the address cards for design cards", () => {
  $("format").value = "design";
  fire($("format"), "change");
  assert.equal($("design-card").hidden, false);
  assert.equal($("blocks-card").hidden, false);
  assert.equal($("mapping-card").hidden, true);
  assert.equal($("envelope-card").hidden, true);
  assert.match($("status").textContent, /Choose your design/);
  $("format").value = "labels";
  fire($("format"), "change");
  assert.equal($("design-card").hidden, true);
  assert.equal($("mapping-card").hidden, false);
  assert.equal($("count-unit").textContent, "addresses");
});

test("a letter-sized design starts with an address box filled from the sheet", async () => {
  await start();
  assert.equal($("count").textContent, "2");
  assert.equal($("count-unit").textContent, "records");
  assert.match($("design-info").textContent, /A4 portrait/);
  const names = [...$("blocks").querySelectorAll("[data-summary-name]")].map((e) => e.textContent);
  assert.deepEqual(names, ["Address"]);
  assert.equal(panel(0).querySelector('[data-box="left"]').value, "20");
  assert.equal(panel(0).querySelector('[data-box="top"]').value, "45");
  assert.match($("paper").textContent, /Ada Lovelace/);
  assert.equal($("download").disabled, false);
});

test("a badge-sized design starts with a bold centred name and an organisation", async () => {
  await start([[90, 55]]);
  const names = [...$("blocks").querySelectorAll("[data-summary-name]")].map((e) => e.textContent);
  assert.deepEqual(names, ["Name", "Organisation"]);
  assert.equal(panel(0).querySelector('[data-prop="bold"]').checked, true);
  assert.match(panel(1).querySelector("[data-summary-text]").textContent, /Company/);
  const lines = [...$("paper").querySelectorAll(".design-line")].map((e) => e.textContent);
  assert.deepEqual(lines, ["Ada Lovelace", "Analytical Engines"]);
});

test("a box that is too small blocks the download and names the box and row", async () => {
  await start([[90, 55]]);
  setBlock(0, '[data-box="width"]', "5");
  await waitFor(() => $("status").className === "error");
  assert.match($("status").textContent, /Row 2 .*doesn't fit the Name box/);
  assert.equal($("download").disabled, true);
  setBlock(0, '[data-box="width"]', "70");
  await waitFor(() => $("status").className !== "error");
  assert.equal($("download").disabled, false);
});

test("text boxes can be added, switched to fixed text and removed", async () => {
  await start();
  $("add-block").value = "text";
  fire($("add-block"), "change");
  await waitFor(() => panel(1));
  setBlock(1, '[data-prop="source"]', "fixed");
  setBlock(1, '[data-prop="text"]', "Open day\nSaturday 14 March");
  await waitFor(() => $("paper").textContent.includes("Saturday 14 March"));
  panel(0).querySelector('[data-action="remove"]').click();
  await waitFor(() => !$("paper").textContent.includes("Ada"));
  // With only fixed text, every row is still one record.
  assert.equal($("blocks").querySelectorAll(".block-panel").length, 1);
  assert.equal($("count").textContent, "2");
});

test("the PDF has the chosen page set for every record", async () => {
  await start([
    [210, 297],
    [210, 297],
    [210, 297],
  ]);
  const print = $("design-pages").querySelector('[data-print="2"]');
  print.checked = false;
  fire(print, "change");
  await waitFor(() => $("labels").textContent === "4");
  downloads.length = 0;
  $("download").click();
  await waitFor(() => downloads.length === 1);
  assert.match(downloads[0].name, /^design\d+-\d{4}-\d\d-\d\d-\d{4}\.pdf$/);
  const doc = await PDFDocument.load(await downloads[0].blob.arrayBuffer());
  assert.equal(doc.getPageCount(), 4);
  assert.match($("status").textContent, /PDF ready: 4 pages.*2 pages per record/);
});

test("a saved project opens with its design and boxes", async () => {
  const name = await start([[90, 55]]);
  setBlock(0, '[data-prop="name"]', "Attendee");
  setBlock(0, '[data-box="top"]', "12.5");
  downloads.length = 0;
  $("save-project").click();
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].name, name.replace(".pdf", ".mailroom"));
  const saved = await downloads[0].blob.text();

  // Start again on labels with another design, then open the project.
  drop("design-drop", await pdf([[210, 297]]));
  await waitFor(() => $("blocks").textContent.includes("Address"));
  $("format").value = "labels";
  fire($("format"), "change");
  chooseFile("project-file", new File([saved], "design.mailroom"));
  await waitFor(
    () => $("format").value === "design" && $("blocks").textContent.includes("Attendee"),
  );
  assert.equal(panel(0).querySelector('[data-box="top"]').value, "12.5");
  assert.match($("design-info").textContent, /Badge landscape/);
  await waitFor(() => $("labels").textContent === "2");
});

test("a bad design or project file is refused with a message", async () => {
  const name = await start();
  drop("design-drop", new File(["hello"], "notes.txt"));
  await waitFor(() => /Could not load design/.test($("status").textContent));
  assert.equal($("design-name").textContent, name);
  chooseFile("project-file", new File(["{}"], "x.mailroom"));
  await waitFor(() => /Could not open project/.test($("status").textContent));
  assert.equal($("count").textContent, "2");
});

test("no uncaught errors", () => {
  assert.deepEqual(errors, []);
});
