import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import * as XLSX from "xlsx";
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
// jsdom doesn't implement navigation; downloads only need to reach the click.
dom.window.HTMLAnchorElement.prototype.click = () => {};
// Saved by the app under its old name, LabelGen.
localStorage.setItem("labelgen-presets", "{}");
await import("./main.js");
const migrated = ["mailroom-presets", "labelgen-presets"].map((k) => localStorage.getItem(k));
after(() => dom.window.close());

const $ = (id) => document.getElementById(id);
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
// About 4 s by default; pass more ticks for slow work such as a password attempt.
async function waitFor(check, ticks = 200) {
  for (let i = 0; i < ticks && !check(); i++) await tick();
  assert.ok(check(), "timed out waiting for the page to update");
}
function fire(element, type, init = {}) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, init);
  element.dispatchEvent(event);
}
function dropFile(file) {
  const event = new dom.window.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
  $("drop").dispatchEvent(event);
}
function workbookFile(sheets) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets))
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  return new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "book.xlsx");
}
async function loadDemo() {
  localStorage.clear();
  $("count").textContent = "";
  $("demo").click();
  await waitFor(() => $("count").textContent === "24");
}

test("a rejected file keeps its error visible and the loaded data intact", async () => {
  await loadDemo();
  dropFile(new File(["hello"], "notes.txt"));
  await waitFor(() => $("status").textContent.includes("Could not load"));
  await tick();
  assert.match($("status").textContent, /Could not load spreadsheet/);
  assert.equal($("status").className, "error");
  assert.equal($("count").textContent, "24");
  assert.equal($("filename").textContent, "Sample addresses");
});

test("the column mapping still works after a rejected file", async () => {
  await loadDemo();
  dropFile(new File(["hello"], "notes.txt"));
  await waitFor(() => $("status").className === "error");
  const select = $("mapping").querySelector('select[data-line="0"][data-slot="0"]');
  select.value = "";
  fire(select, "change");
  await waitFor(() => $("paper").textContent.includes("Willow Road"));
  assert.ok(!$("paper").textContent.includes("Alex Morgan"));
  assert.deepEqual(errors, []);
});

test("an oversized sheet is rejected without replacing the current one", async () => {
  localStorage.clear();
  dropFile(
    workbookFile({
      Small: [["Name"], ["Ada"]],
      Big: [["Name"], ...Array.from({ length: 10001 }, () => ["Bob"])],
    }),
  );
  await waitFor(() => $("count").textContent === "1");
  $("sheet").value = "Big";
  fire($("sheet"), "change");
  await waitFor(() => $("status").textContent.includes("10,000"));
  assert.equal($("sheet").value, "Small");
  assert.equal($("count").textContent, "1");
});

test("removing and adding address lines is remembered", async () => {
  await loadDemo();
  $("mapping").querySelector('[data-remove="5"]').click();
  assert.equal(JSON.parse(localStorage.getItem("mailroom-mapping")).fields.length, 5);
  $("add-line").click();
  assert.equal(JSON.parse(localStorage.getItem("mailroom-mapping")).fields.length, 6);
});

test("addresses that can't be printed are reported by cause", async () => {
  localStorage.clear();
  dropFile(workbookFile({ Sheet: [["Name"], ["Łukasz 𝒳"], ["x".repeat(5000)], ["Ada"]] }));
  await waitFor(() => $("status").className === "error");
  assert.match($("status").textContent, /Row 2 \(Łukasz 𝒳\) contains '𝒳', which can't be printed/);
  assert.match($("status").textContent, /1 address is too long/);
  assert.ok($("download").disabled);
});

test("the PDF downloads from the previewed labels", async () => {
  await loadDemo();
  assert.ok(!$("download").disabled);
  $("download").click();
  await waitFor(() => $("status").textContent.startsWith("PDF ready"));
  assert.deepEqual(errors, []);
});

test("envelopes print one address per page and remember the choice", async () => {
  await loadDemo();
  $("format").value = "c5";
  fire($("format"), "change");
  await waitFor(
    () => $("labels").textContent === "24" && $("labels-unit").textContent === "envelopes",
  );
  assert.equal($("page-label").textContent, "Envelope 1 of 24");
  assert.ok($("skip-area").hidden);
  assert.equal($("paper").querySelectorAll(".label").length, 1);
  assert.equal($("paper").querySelector("img.licence"), null, "no ceadúnas until one is added");
  assert.ok($("licence-remove").hidden);
  assert.equal(localStorage.getItem("mailroom-format"), "c5");
  $("download").click();
  await waitFor(() => $("status").textContent.startsWith("PDF ready. Print on C5"));
  $("format").value = "labels";
  fire($("format"), "change");
  await waitFor(() => $("page-label").textContent === "Sheet 1 of 2");
  assert.deepEqual(errors, []);
});

// A 2 x 1 pixel PNG, so the ceadúnas has a known aspect ratio.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DAwPAfAAcAAf9+CLHQAAAAAElFTkSuQmCC",
  ),
  (c) => c.charCodeAt(0),
);

test("envelopes print a ceadúnas and a return address", async () => {
  await loadDemo();
  $("format").value = "c5";
  fire($("format"), "change");
  assert.ok(!$("envelope-card").hidden);

  Object.defineProperty($("licence-file"), "files", {
    value: [new File([PNG], "licence.png")],
    configurable: true,
  });
  fire($("licence-file"), "change");
  await waitFor(() => $("licence-name").textContent === "licence.png");
  assert.ok($("paper").querySelector("img.licence"));
  assert.equal(localStorage.getItem("labelgen-licence"), null, "an upload isn't saved");
  assert.ok(!$("licence-remove").hidden);

  $("sender-mode").value = "fixed";
  fire($("sender-mode"), "change");
  $("sender-text").value = "Parish Office\nMain Street\n";
  fire($("sender-text"), "input");
  await waitFor(() => $("paper").querySelector(".sender")?.textContent.includes("Main Street"));

  $("sender-mode").value = "sheet";
  fire($("sender-mode"), "change");
  const town = $("sender-mapping").querySelector('select[data-line="0"][data-slot="0"]');
  town.value = "3";
  fire(town, "change");
  await waitFor(() => $("paper").querySelector(".sender")?.textContent === "Dublin");
  $("next").click();
  assert.equal($("paper").querySelector(".sender").textContent, "Cork");
  assert.deepEqual(JSON.parse(localStorage.getItem("mailroom-mapping")).senderFields[0], [3]);

  $("download").click();
  await waitFor(() => $("status").textContent.startsWith("PDF ready"));

  $("licence-remove").click();
  assert.equal($("paper").querySelector("img.licence"), null);
  assert.ok($("licence-remove").hidden);
  $("sender-mode").value = "none";
  fire($("sender-mode"), "change");
  $("format").value = "labels";
  fire($("format"), "change");
  await waitFor(() => $("page-label").textContent === "Sheet 1 of 2");
  assert.ok($("envelope-card").hidden);
  assert.deepEqual(errors, []);
});

test("switching format while a setting is invalid doesn't show the old format's pages", async () => {
  await loadDemo();
  $("format").value = "c5";
  fire($("format"), "change");
  await waitFor(() => $("page-label").textContent === "Envelope 1 of 24");
  $("sender-mode").value = "fixed";
  fire($("sender-mode"), "change");
  $("sender-text").value = Array(9).fill("line").join("\n");
  fire($("sender-text"), "input");
  await waitFor(() => $("status").className === "error");
  $("format").value = "c4";
  fire($("format"), "change");
  await tick();
  assert.equal($("paper").querySelectorAll(".label").length, 1);
  assert.equal($("page-label").textContent, "Your envelopes will appear here");

  $("sender-mode").value = "none";
  fire($("sender-mode"), "change");
  await waitFor(() => $("page-label").textContent === "Envelope 1 of 24");
  $("format").value = "labels";
  fire($("format"), "change");
  await waitFor(() => $("page-label").textContent === "Sheet 1 of 2");
});

test("adding a ceadúnas keeps a return address problem reported", async () => {
  await loadDemo();
  $("format").value = "c5";
  fire($("format"), "change");
  $("sender-mode").value = "fixed";
  fire($("sender-mode"), "change");
  $("sender-text").value = Array(8).fill(Array(40).fill("word").join(" ")).join("\n");
  fire($("sender-text"), "input");
  await waitFor(() => $("status").textContent.includes("return address"));

  Object.defineProperty($("licence-file"), "files", {
    value: [new File([PNG], "licence.png")],
    configurable: true,
  });
  fire($("licence-file"), "change");
  await waitFor(() => $("paper").querySelector("img.licence"));
  await tick();
  assert.match($("status").textContent, /return address/);
  assert.ok($("download").disabled);

  $("licence-remove").click();
  $("sender-mode").value = "none";
  fire($("sender-mode"), "change");
  $("format").value = "labels";
  fire($("format"), "change");
  await waitFor(() => $("page-label").textContent === "Sheet 1 of 2");
  assert.deepEqual(errors, []);
});

test("a password-protected workbook opens after entering its password", async () => {
  await loadDemo();
  const encrypted = readFileSync(new URL("./fixtures/encrypted.xlsx", import.meta.url));
  dropFile(new File([encrypted], "clients.xlsx"));
  await waitFor(() => !$("password-area").hidden);
  assert.match($("status").textContent, /password-protected/);
  assert.equal($("count").textContent, "24");

  // Each agile password attempt runs 100k SHA-512 rounds, which takes seconds under jsdom.
  $("password").value = "wrong";
  fire($("password-area"), "submit");
  await waitFor(() => $("status").textContent.includes("incorrect"), 750);
  assert.equal($("status").className, "error");
  assert.ok(!$("password-area").hidden);
  assert.equal($("filename").textContent, "Sample addresses");

  $("password").value = "Secret pässword";
  fire($("password-area"), "submit");
  await waitFor(() => $("count").textContent === "2", 750);
  assert.ok($("password-area").hidden);
  assert.equal($("password").value, "");
  assert.equal($("filename").textContent, "clients.xlsx");
  assert.ok($("paper").textContent.includes("Áine Ní Bhriain"));
  assert.deepEqual(errors, []);
});

test("a password-protected .xls opens after entering its password", async () => {
  const encrypted = readFileSync(new URL("./fixtures/encrypted-97.xls", import.meta.url));
  dropFile(new File([encrypted], "clients.xls"));
  await waitFor(() => !$("password-area").hidden);
  $("password").value = "Secret pässword";
  fire($("password-area"), "submit");
  await waitFor(() => $("filename").textContent === "clients.xls");
  assert.equal($("count").textContent, "2");
  assert.ok($("paper").textContent.includes("Ciarán Walsh"));
  assert.deepEqual(errors, []);
});

test("cancelling the password prompt keeps the current spreadsheet", async () => {
  await loadDemo();
  const encrypted = readFileSync(new URL("./fixtures/encrypted.xlsx", import.meta.url));
  dropFile(new File([encrypted], "clients.xlsx"));
  await waitFor(() => !$("password-area").hidden);
  $("password-cancel").click();
  assert.ok($("password-area").hidden);
  assert.equal($("status").textContent, "");
  assert.equal($("count").textContent, "24");
});

test("settings saved under the old LabelGen name carry over", () => {
  assert.deepEqual(migrated, ["{}", null]);
});

test("forgetting saved settings clears only Mailroom's saved data", async () => {
  await loadDemo();
  $("sender-text").value = "Parish Office";
  fire($("sender-text"), "input");
  localStorage.setItem("other-app", "keep");
  assert.ok(localStorage.getItem("mailroom-sender"));
  let reloads = 0;
  Object.defineProperty(globalThis, "location", {
    value: { reload: () => reloads++ },
    configurable: true,
  });
  $("forget").click();
  Object.defineProperty(globalThis, "location", {
    value: dom.window.location,
    configurable: true,
  });
  assert.deepEqual(Object.keys(localStorage), ["other-app"]);
  assert.equal(reloads, 1);
  $("sender-text").value = "";
  fire($("sender-text"), "input");
  localStorage.clear();
});

async function dropAndWait(file) {
  $("filename").textContent = "";
  dropFile(file);
  await waitFor(() => $("filename").textContent === file.name || $("status").className === "error");
  await tick();
}

test("a UTF-8 CSV without a byte order mark shows its accents and headings", async () => {
  localStorage.clear();
  await dropAndWait(new File(["Name,Town\nSeán Ó Súilleabháin,Dún Laoghaire\n"], "list.csv"));
  assert.ok($("paper").textContent.includes("Seán Ó Súilleabháin"));
  assert.ok($("has-header").checked);
  assert.match($("sheet-notes").textContent, /Row 1 used as headings: Name, Town\./);
});

test("a CSV without a heading row keeps its first address and asks for columns", async () => {
  localStorage.clear();
  await dropAndWait(
    new File(["Alex Morgan,12 Willow Road,Dublin\nSam Taylor,Oak Avenue,Cork\n"], "plain.csv"),
  );
  assert.ok(!$("has-header").checked);
  assert.equal($("status").textContent, "Choose which columns to print.");
  assert.equal($("sheet-notes").textContent, "No heading row detected.");
  const select = $("mapping").querySelector('select[data-line="0"][data-slot="0"]');
  select.value = "0";
  fire(select, "change");
  await waitFor(() => $("count").textContent === "2");
  assert.ok($("paper").textContent.includes("Alex Morgan"));

  // Ticking the box by hand overrides the guess.
  $("has-header").checked = true;
  fire($("has-header"), "change");
  await waitFor(() => $("sheet-notes").textContent.includes("Row 1 used as headings: Alex Morgan"));
  assert.ok($("has-header").checked);
  assert.equal($("mapping").querySelector("select").options[1].textContent, "Alex Morgan");
});

test("columns are chosen from the headings and hidden rows are skipped", async () => {
  localStorage.clear();
  const ws = XLSX.utils.aoa_to_sheet([
    ["ID", "Email", "First Name", "Last Name", "Address 1", "Town", "Eircode"],
    [1, "a@b.ie", "Ann", "Byrne", "1 Main St", "Cork", "T12 AB34"],
    [2, "c@d.ie", "Bob", "Walsh", "2 Quay Rd", "Sligo", "F91 CD56"],
  ]);
  ws["!rows"] = [, , { hidden: true }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, ws, "Contacts");
  const data = XLSX.write(workbook, { type: "array", bookType: "xlsx", cellStyles: true });
  await dropAndWait(new File([data], "crm.xlsx"));
  assert.equal($("count").textContent, "1");
  assert.ok($("paper").textContent.includes("Ann Byrne"));
  assert.ok(!$("paper").textContent.includes("a@b.ie"));
  assert.ok(!$("paper").textContent.includes("Bob"));
  assert.match($("sheet-notes").textContent, /1 hidden row skipped\./);
});

test("the first visible sheet opens and hidden sheets are marked", async () => {
  localStorage.clear();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Code"], ["X1"]]), "Lookup");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Name"], ["Ann"]]), "People");
  workbook.Workbook = { Sheets: [{ Hidden: 1 }, { Hidden: 0 }] };
  await dropAndWait(
    new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "book.xlsx"),
  );
  assert.equal($("sheet").value, "People");
  assert.deepEqual(
    [...$("sheet").options].map((o) => o.textContent),
    ["Lookup (hidden)", "People"],
  );
  assert.ok($("paper").textContent.includes("Ann"));
});

test("empty, header-only and wrong-type files get a plain message", async () => {
  await loadDemo();
  for (const [file, expected] of [
    [new File([], "empty.xlsx"), /This file is empty\./],
    [new File(["Name,Street\n"], "header-only.csv"), /This sheet has no rows\./],
    [new File(["%PDF-1.7\n"], "report.xlsx"), /This doesn't look like a spreadsheet\./],
    [new File(["PK\x03\x04garbage"], "broken.xlsx"), /couldn't read this file/],
  ]) {
    const log = console.error;
    console.error = () => {};
    try {
      dropFile(file);
      await waitFor(() => expected.test($("status").textContent));
    } finally {
      console.error = log;
    }
    assert.equal($("status").className, "error");
    assert.equal($("count").textContent, "24");
  }
});

test("a protected file explains what to do when Web Crypto is missing", async () => {
  await loadDemo();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try {
    const encrypted = readFileSync(new URL("./fixtures/encrypted.xlsx", import.meta.url));
    dropFile(new File([encrypted], "clients.xlsx"));
    await waitFor(() => $("status").className === "error");
  } finally {
    Object.defineProperty(globalThis, "crypto", descriptor);
  }
  assert.match($("status").textContent, /https:\/\/ address or as the single-file version/);
  assert.ok($("password-area").hidden);
});

test("the Help tab swaps views and opens at the linked section", async () => {
  const hashchange = () => dom.window.dispatchEvent(new dom.window.HashChangeEvent("hashchange"));
  location.hash = "#help-alignment";
  hashchange();
  assert.equal($("print-view").hidden, true);
  assert.equal($("help-view").hidden, false);
  assert.equal($("tab-help").getAttribute("aria-current"), "page");
  assert.equal($("tab-print").hasAttribute("aria-current"), false);
  assert.ok($("help-alignment"));
  location.hash = "#print";
  hashchange();
  assert.equal($("print-view").hidden, false);
  assert.equal($("help-view").hidden, true);
  assert.equal($("tab-print").getAttribute("aria-current"), "page");
});

test("spreadsheet presets save the address lines and reapply them to the next file", async () => {
  await loadDemo();
  assert.ok($("map-preset-area").hidden, "no list until there is a preset");
  const pick = (line, column) => {
    const select = $("mapping").querySelector(`select[data-line="${line}"][data-slot="0"]`);
    select.value = column;
    fire(select, "change");
  };
  // Postcode above town, so the preset differs from what the headings would guess.
  pick(3, "4");
  pick(4, "3");
  $("size").value = "14";
  fire($("size"), "input");

  window.prompt = () => "Weekly mailing";
  $("map-preset-save").click();
  const [key] = Object.keys(JSON.parse(localStorage.getItem("mailroom-address-presets")));
  assert.match(key, /^map-/);
  assert.equal($("map-preset").value, key);
  assert.ok(!$("map-preset-area").hidden && !$("map-preset-delete").hidden);
  assert.ok($("map-preset-update").hidden, "unchanged");

  // Same headings, columns moved and a new one added at the front.
  const rows = [
    ["Ref", "Town / City", "Name", "Postcode", "Address line 1", "Address line 2", "Country"],
    ["1", "Cork", "Ada Byrne", "T12 A123", "5 Quay", "", "Ireland"],
  ];
  localStorage.setItem("mailroom-mapping", "{}");
  $("size").value = "10";
  dropFile(workbookFile({ Sheet: rows }));
  await waitFor(() => $("filename").textContent === "book.xlsx");
  assert.equal($("map-preset").value, "", "different columns, so not applied by itself");
  $("map-preset").value = key;
  fire($("map-preset"), "change");
  await waitFor(() => $("status").textContent.startsWith("Used the"));
  assert.equal($("size").value, "14");
  assert.match($("status").textContent, /Used the “Weekly mailing” spreadsheet preset/);
  assert.match($("paper").textContent, /Ada Byrne5 QuayT12 A123Cork/);
  assert.deepEqual(JSON.parse(localStorage.getItem("mailroom-mapping")).fields[0], [2]);

  // The same layout as when it was saved is picked up without asking.
  await loadDemo();
  assert.equal($("map-preset").value, key);
  assert.equal($("size").value, "14");
  assert.match($("paper").textContent, /Alex Morgan12 Willow RoadD02 X285Dublin/);

  // Editing shows the offer to update; updating keeps the edit.
  pick(5, "");
  assert.ok(!$("map-preset-update").hidden && !$("map-preset-note").hidden);
  $("map-preset-update").click();
  assert.ok($("map-preset-update").hidden);
  assert.equal(JSON.parse(localStorage.getItem("mailroom-address-presets"))[key].lines.length, 5);

  // A spreadsheet missing one of its columns says so and keeps the current lines.
  dropFile(workbookFile({ Sheet: [["Name"], ["Ada"]] }));
  await waitFor(() => $("filename").textContent === "book.xlsx" && $("count").textContent === "1");
  $("map-preset").value = key;
  fire($("map-preset"), "change");
  assert.match($("status").textContent, /no “Address line 1” column/);
  assert.equal($("map-preset").value, "");

  window.confirm = () => true;
  await loadDemo();
  $("map-preset-delete").click();
  assert.equal(localStorage.getItem("mailroom-address-presets"), "{}");
  assert.ok($("map-preset-area").hidden);
  assert.deepEqual(errors, []);
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const delayedSheet = (name, pending) => ({ name, size: 100, arrayBuffer: () => pending.promise });
const csvBuffer = (name) => new TextEncoder().encode(`Name,Address\n${name},Dublin`).buffer;

test("latest spreadsheet selection wins in both completion orders", async () => {
  for (const olderFirst of [true, false]) {
    await loadDemo();
    const old = deferred(),
      next = deferred();
    dropFile(delayedSheet("old.csv", old));
    dropFile(delayedSheet("new.csv", next));
    if (olderFirst) {
      old.resolve(csvBuffer("Old"));
      await tick();
    }
    next.resolve(csvBuffer("New"));
    await waitFor(() => $("filename").textContent === "new.csv");
    if (!olderFirst) old.resolve(csvBuffer("Old"));
    await tick();
    assert.equal($("filename").textContent, "new.csv");
    assert.ok($("paper").textContent.includes("New"));
  }
});

test("stale spreadsheet failures and demo selection cannot replace the latest status", async () => {
  await loadDemo();
  const old = deferred();
  dropFile(delayedSheet("old.csv", old));
  await loadDemo();
  const status = $("status").textContent;
  old.reject(Error("stale failure"));
  await tick();
  assert.equal($("status").textContent, status);
  assert.equal($("filename").textContent, "Sample addresses");
});

test("stale encrypted reads do not reopen password prompts", async () => {
  await loadDemo();
  const pending = deferred();
  dropFile(delayedSheet("old.xlsx", pending));
  await loadDemo();
  const encrypted = readFileSync(new URL("./fixtures/encrypted.xlsx", import.meta.url));
  pending.resolve(
    encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + encrypted.byteLength),
  );
  await tick();
  assert.ok($("password-area").hidden);
  assert.equal($("filename").textContent, "Sample addresses");
});

test("sample selection invalidates an ongoing password unlock", async () => {
  const encrypted = readFileSync(new URL("./fixtures/encrypted-97.xls", import.meta.url));
  dropFile(new File([encrypted], "pending.xls"));
  await waitFor(() => !$("password-area").hidden);
  $("password").value = "Secret pässword";
  fire($("password-area"), "submit");
  await loadDemo();
  await tick();
  assert.ok($("password-area").hidden);
  assert.equal($("filename").textContent, "Sample addresses");
  assert.equal($("count").textContent, "24");
});
