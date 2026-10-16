import * as XLSX from "xlsx";
import { PDFDocument, PrintScaling } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  mailItems,
  paginate,
  checkFits,
  clean,
  missingChar,
  formats,
  perSheet,
  slotOrigin,
  labelPreset,
  presetFormat,
} from "./layout.js";
import { fontBytes } from "./font.js";
import { template, formatOptions } from "./template.js";
import { encryptedPackage, decryptWorkbook, decryptDefault, canDecrypt } from "./decrypt.js";
import { readWorkbook, readSheet, listSheets, defaultSheet, autoMap, explain } from "./sheet.js";
import { createDesigner } from "./designer.js";
import { createPresetEditor } from "./preseteditor.js";
import {
  makePreset,
  validPreset,
  findMatch,
  resolve as resolvePreset,
  changed as presetChanged,
} from "./addresspreset.js";

const MM = 72 / 25.4; // PDF points per millimetre
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_LABELS = 20000;
const MAX_LINES = 8;
const MAX_IMAGE_BYTES = 1024 * 1024;
const SENDER_SIZE = 9; // pt, before shrinking to fit the corner
const MAPPING_KEY = "mailroom-mapping";
const FORMAT_KEY = "mailroom-format";
const SENDER_KEY = "mailroom-sender";
const PRESETS_KEY = "mailroom-presets";
const MAP_PRESETS_KEY = "mailroom-address-presets";
const OLD_KEY_PREFIX = "labelgen-"; // Mailroom used to be called LabelGen.
const NO_WEB_CRYPTO =
  "This browser can only unlock password-protected files when Mailroom is opened from its https:// address or as the single-file version. Open it that way, or remove the password in Excel and try again.";

const $ = (id) => document.getElementById(id);
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
// Preview lengths in container-query units, where the paper is 100cqw wide.
const cqw = (mm, format) => `${(mm / format.page.width) * 100}cqw`;

const state = {
  workbook: null,
  sheet: "",
  hasHeader: true,
  fileName: "",
  headers: [],
  rows: [],
  rowNumbers: [], // The spreadsheet row number (1-based) of each entry in rows.
  notes: [], // What reading the sheet did, e.g. "3 hidden rows skipped.", shown under the file.
  fields: [],
  senderFields: [],
  licence: null,
  // Set together by update() so they always describe the same export.
  config: null,
  pages: [],
  fits: new Map(),
  // Addresses and return addresses (by their lines) holding a character the font can't print.
  missing: new Map(),
  ready: false,
  page: 0,
};
let tick = 0;
let pdfURL;
let building = false;
let locked = null; // A protected file waiting for its password: { pkg, fileName }.
let importing = null; // The latest importFile call, so a slower earlier one can't overwrite it.
let headerChosen = false; // Whether the heading checkbox was set by hand for this file.
let presets = {}; // The user's saved label sheets by format key, e.g. "custom-lx3k9a".
let shownFormat = "labels"; // The layout on screen, restored when "+ New label preset…" is picked.
let mapPresets = {}; // The user's saved spreadsheet presets by key, e.g. "map-lx3k9a".
let activeMapPreset = ""; // The key of the spreadsheet preset the address lines came from.

// A built-in format or a saved label sheet, or undefined for "design" and unknown keys.
const formatFor = (key) =>
  Object.hasOwn(formats, key)
    ? formats[key]
    : Object.hasOwn(presets, key)
      ? presetFormat(presets[key])
      : undefined;

// Widths as the PDF draws them: glyph advances without kerning, in the embedded font.
const measures = {};
function getMeasure(weight = "regular") {
  measures[weight] ??= fontBytes(weight)
    .then((bytes) => {
      const font = fontkit.create(new Uint8Array(bytes));
      const advances = new Map();
      const advance = (char) => {
        let width = advances.get(char);
        if (width === undefined)
          advances.set(char, (width = font.glyphForCodePoint(char.codePointAt(0)).advanceWidth));
        return width;
      };
      return {
        measure: (text, size) => {
          let width = 0;
          for (const char of text) width += advance(char);
          return (width * size) / font.unitsPerEm;
        },
        hasChar: (char) => font.hasGlyphForCodePoint(char.codePointAt(0)),
      };
    })
    .catch((e) => {
      measures[weight] = null;
      throw e;
    });
  return measures[weight];
}

async function embedFont(doc, weight = "regular") {
  doc.registerFontkit(fontkit);
  // Not subset: fontkit's subsetter writes odd-length glyphs with short loca offsets, which
  // corrupts Arimo's outlines ("font could not be extracted" in Acrobat, garbled text elsewhere).
  return doc.embedFont(new Uint8Array(await fontBytes(weight)), { subset: false });
}

function message(text, error = false) {
  $("status").textContent = text;
  $("status").className = error ? "error" : "";
}

// Warns about addresses that look incomplete, with a button that steps through the pages
// holding them. pages lists those page numbers in order; unit names a page ("sheet").
// Once acknowledged, it stays hidden until the page is reloaded.
let flagged = [];
let acknowledged = false;
function flagIncomplete(total, pages = [], unit = "sheet") {
  flagged = pages;
  $("warning").hidden = !total || acknowledged;
  if (!total) return;
  $("warning-title").textContent = `${count(total, "address looks", "addresses look")} incomplete.`;
  $("warning-text").textContent =
    `${total === 1 ? "It has" : "Each has"} only one line, or an empty last line, so a town or postcode may be missing. ${unit === "record" ? "On " : "They're highlighted in the preview, on "}${count(pages.length, unit)}.`;
  $("warning-jump").textContent = `Next ${unit} to check →`;
}

function readConfig() {
  const format = formatFor($("format").value);
  const mode = format.kind === "envelopes" ? $("sender-mode").value : "none";
  const lines =
    mode === "fixed"
      ? $("sender-text")
          .value.split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      : [];
  if (lines.length > MAX_LINES) throw Error(`Use at most ${MAX_LINES} return address lines.`);
  return {
    format,
    sender: { mode, lines },
    size: Number($("size").value),
    skip: perSheet(format) > 1 ? Number($("skip").value) : 0,
  };
}

const validFields = (fields, headers) =>
  Array.isArray(fields) &&
  fields.length <= MAX_LINES &&
  fields.every(
    (line) =>
      Array.isArray(line) &&
      line.every((n) => n === null || (Number.isInteger(n) && n >= 0 && n < headers.length)),
  );

function savedMapping(headers) {
  try {
    const saved = JSON.parse(localStorage.getItem(MAPPING_KEY));
    if (saved?.headers?.join("|") !== headers.join("|")) return {};
    return {
      fields: validFields(saved.fields, headers) ? saved.fields : null,
      senderFields: validFields(saved.senderFields, headers) ? saved.senderFields : null,
    };
  } catch {
    return {};
  }
}

function saveMapping() {
  try {
    localStorage.setItem(
      MAPPING_KEY,
      JSON.stringify({
        headers: state.headers,
        fields: state.fields,
        senderFields: state.senderFields,
      }),
    );
  } catch {}
}

// After a sheet loads, asks for columns if none are chosen and nothing more urgent is showing.
function reportLoad() {
  if ($("status").className === "error") return;
  const unmapped = designer.active()
    ? designer.unmapped()
    : !state.fields.some((line) => line.some(Number.isInteger));
  if (unmapped) message("Choose which columns to print.");
  else if (activeMapPreset)
    message(`Used the “${mapPresets[activeMapPreset].name}” spreadsheet preset.`);
}

async function applySheet({ headers, rows, rowNumbers, notes }) {
  const source = importing;
  let presetProblem = "";
  const saved = savedMapping(headers);
  Object.assign(state, { headers, rows, rowNumbers, notes });
  $("sheet-notes").textContent = notes.join(" ");
  const fields = saved.fields ?? autoMap(headers, MAX_LINES);
  state.fields = fields.length ? fields : [[]];
  state.senderFields = saved.senderFields ?? [[], [], []];
  // A spreadsheet preset made for exactly these columns wins over the last choices.
  activeMapPreset = "";
  const match = designer.active() ? null : findMatch(mapPresets, headers);
  if (match) {
    try {
      const { fields, senderFields, size } = resolvePreset(match[1], headers);
      Object.assign(state, { fields, senderFields });
      setSize(size);
      activeMapPreset = match[0];
    } catch (e) {
      state.fields = [[]];
      state.senderFields = [[], [], []];
      presetProblem = e.message;
    }
  }
  state.page = 0;
  renderMapping();
  designer.onSheet();
  await update();
  if (source !== importing || state.rows !== rows) return;
  if (presetProblem) message(presetProblem, true);
  else reportLoad();
}

// Reads the sheet before touching state, so a rejected file leaves the current one loaded.
function openWorkbook(workbook, fileName) {
  if (!workbook.SheetNames.length) throw Error("No worksheets found.");
  const name = defaultSheet(workbook);
  const sheet = readSheet(workbook, name);
  headerChosen = false;
  Object.assign(state, { workbook, fileName, sheet: name, hasHeader: sheet.hasHeader });
  $("has-header").checked = sheet.hasHeader;
  $("filename").textContent = fileName;
  $("sheet").innerHTML = listSheets(workbook)
    .map(
      ({ name: n, hidden }) =>
        `<option value="${escape(n)}">${escape(n)}${hidden ? " (hidden)" : ""}</option>`,
    )
    .join("");
  $("sheet").value = name;
  $("sheet-area").hidden = false;
  return applySheet(sheet);
}

const loadWorkbook = (bytes, fileName) => openWorkbook(readWorkbook(bytes, fileName), fileName);

function showPassword(pending) {
  locked = pending;
  $("password-area").hidden = !pending;
  $("password").value = "";
  $("unlock").disabled = false;
  if (pending) $("password").focus();
}

async function importFile(file) {
  if (!file) return;
  const current = (importing = {});
  showPassword(null);
  try {
    if (!/\.(xlsx|xlsm|xls|ods|csv|tsv)$/i.test(file.name))
      throw Error("Choose an Excel (.xlsx, .xlsm or .xls), OpenDocument (.ods) or CSV file.");
    if (file.size > MAX_FILE_BYTES) throw Error("Please use a spreadsheet smaller than 15 MB.");
    message("Reading spreadsheet…");
    let bytes = new Uint8Array(await file.arrayBuffer());
    if (importing !== current) return;
    const pkg = encryptedPackage(bytes);
    if (pkg) {
      if (!canDecrypt(pkg)) throw Error(NO_WEB_CRYPTO);
      bytes = await decryptDefault(pkg);
      if (importing !== current) return;
      if (!bytes) {
        showPassword({ pkg, fileName: file.name });
        message(`“${file.name}” is password-protected. Enter its password to open it.`);
        return;
      }
    }
    if (importing !== current) return;
    await loadWorkbook(bytes, file.name);
  } catch (e) {
    if (importing === current) message(`Could not load spreadsheet: ${explain(e)}`, true);
  } finally {
    if (importing === current) $("file").value = "";
  }
}

async function unlock() {
  const pending = locked;
  const current = importing;
  if (!pending) return;
  $("unlock").disabled = true;
  message("Unlocking spreadsheet…");
  let bytes;
  try {
    bytes = await decryptWorkbook(pending.pkg, $("password").value);
  } catch (e) {
    if (locked !== pending || importing !== current) return;
    message(`Could not unlock spreadsheet: ${explain(e)}`, true);
    $("password").select();
    return;
  } finally {
    if (importing === current) $("unlock").disabled = false;
  }
  // Another file may have been chosen while this one was unlocking.
  if (locked !== pending || importing !== current) return;
  showPassword(null);
  try {
    await loadWorkbook(bytes, pending.fileName);
  } catch (e) {
    if (importing === current) message(`Could not load spreadsheet: ${explain(e)}`, true);
  }
}

// Until the heading checkbox is set by hand, each sheet gets its own guess.
async function changeSheet(e) {
  const name = $("sheet").value;
  const chosen = headerChosen || e?.target === $("has-header");
  let sheet;
  try {
    sheet = readSheet(state.workbook, name, chosen ? $("has-header").checked : undefined);
  } catch (err) {
    $("sheet").value = state.sheet;
    $("has-header").checked = state.hasHeader;
    message(explain(err), true);
    return;
  }
  headerChosen = chosen;
  $("has-header").checked = sheet.hasHeader;
  Object.assign(state, { sheet: name, hasHeader: sheet.hasHeader });
  await applySheet(sheet);
}

function loadDemo() {
  importing = {};
  showPassword(null);
  const names = ["Alex Morgan", "Sam Taylor", "Jamie Quinn", "Robin Walsh"];
  const streets = ["Willow Road", "Oak Avenue", "Garden Lane", "Park Crescent"];
  const towns = ["Dublin", "Cork", "Galway", "Limerick"];
  const postcodes = ["D02 X285", "T12 A123", "H91 B456", "V94 C789"];
  const rows = Array.from({ length: 24 }, (_, i) => [
    names[i % 4],
    `${12 + i} ${streets[i % 4]}`,
    "",
    towns[i % 4],
    postcodes[i % 4],
    "Ireland",
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Name", "Address line 1", "Address line 2", "Town / City", "Postcode", "Country"],
      ...rows,
    ]),
    "Addresses",
  );
  return openWorkbook(workbook, "Sample addresses");
}

// Delivery address and return address columns share one mapping editor.
const mappings = {
  main: { id: "mapping", add: "add-line", name: "Line" },
  sender: { id: "sender-mapping", add: "add-sender-line", name: "Return address line" },
};
const fieldsFor = (key) => (key === "sender" ? state.senderFields : state.fields);

function renderMapping() {
  const options = (selected) =>
    state.headers
      .map(
        (h, j) => `<option value="${j}" ${selected === j ? "selected" : ""}>${escape(h)}</option>`,
      )
      .join("");
  for (const [key, { id, add, name }] of Object.entries(mappings)) {
    const fields = fieldsFor(key);
    $(id).innerHTML = fields
      .map(
        (line, i) => `<div class="map-line">
        <span>${i + 1}</span>
        <select aria-label="${name} ${i + 1} column" data-line="${i}" data-slot="0"><option value="">Choose column</option>${options(line[0])}</select>
        <select aria-label="${name} ${i + 1} second column" data-line="${i}" data-slot="1"><option value="">+ optional</option>${options(line[1])}</select>
        <button data-remove="${i}" aria-label="Remove ${name.toLowerCase()} ${i + 1}">×</button>
      </div>`,
      )
      .join("");
    $(add).disabled = !state.headers.length || fields.length >= MAX_LINES;
  }
  renderSample();
  renderMapPresets();
}

// Shows each column beside its first two rows, so it's clear what each one holds.
function renderSample() {
  const rows = state.rows.slice(0, 2);
  $("sample").hidden = !state.headers.length;
  const heads = rows.map((_, i) => `<th>Row ${rowNumber({ row: i })}</th>`).join("");
  $("sample-table").innerHTML =
    `<thead><tr><th>Column</th>${heads}</tr></thead><tbody>${state.headers
      .map(
        (h, j) =>
          `<tr><th>${escape(h)}</th>${rows.map((r) => `<td>${escape(r[j] ?? "")}</td>`).join("")}</tr>`,
      )
      .join("")}</tbody>`;
}

function setSize(size) {
  if ([...$("size").options].some((o) => Number(o.value) === size)) $("size").value = String(size);
}

function loadMapPresets() {
  try {
    const saved = JSON.parse(localStorage.getItem(MAP_PRESETS_KEY));
    for (const [key, preset] of Object.entries(saved ?? {}))
      if (/^map-[a-z0-9]+$/.test(key) && validPreset(preset)) mapPresets[key] = preset;
  } catch {}
}

function saveMapPresets() {
  try {
    localStorage.setItem(MAP_PRESETS_KEY, JSON.stringify(mapPresets));
  } catch {}
}

// Rebuilds the "Spreadsheet Preset" list and shows the buttons that make sense for the choice.
function renderMapPresets() {
  const preset = mapPresets[activeMapPreset];
  const byName = Object.entries(mapPresets).sort(([, a], [, b]) => a.name.localeCompare(b.name));
  $("map-preset").innerHTML = `<option value="">None</option>${byName
    .map(([key, p]) => `<option value="${key}">${escape(p.name)}</option>`)
    .join("")}`;
  $("map-preset").value = preset ? activeMapPreset : "";
  $("map-preset").disabled = !state.headers.length;
  $("map-preset-area").hidden = !byName.length;
  $("map-preset-save").disabled = !state.headers.length;
  const edited =
    Boolean(preset) && presetChanged(preset, { ...state, size: Number($("size").value) });
  $("map-preset-update").hidden = !edited;
  $("map-preset-delete").hidden = !preset;
  $("map-preset-note").hidden = !edited;
  $("map-preset-note").textContent = edited
    ? "The columns or text size no longer match this preset. Update it to keep the changes."
    : "";
}

async function chooseMapPreset() {
  const key = $("map-preset").value;
  if (!key) {
    activeMapPreset = "";
    return renderMapPresets();
  }
  let chosen;
  try {
    chosen = resolvePreset(mapPresets[key], state.headers);
  } catch (e) {
    message(e.message, true);
    return renderMapPresets();
  }
  Object.assign(state, { fields: chosen.fields, senderFields: chosen.senderFields });
  setSize(chosen.size);
  activeMapPreset = key;
  saveMapping();
  renderMapping();
  await update();
  if ($("status").className !== "error")
    message(`Used the “${mapPresets[key].name}” spreadsheet preset.`);
}

// Saves the current columns as a new preset, or over the chosen one when updating.
function saveMapPreset(updating) {
  let key = updating ? activeMapPreset : "";
  const name = updating
    ? mapPresets[key].name
    : window.prompt("Name this spreadsheet preset, e.g. Weekly Dublin mailing:", "");
  if (name === null) return;
  let preset;
  try {
    preset = makePreset(name, { ...state, size: Number($("size").value) });
  } catch (e) {
    message(e.message, true);
    return;
  }
  if (!key) {
    const same = Object.entries(mapPresets).find(
      ([, p]) => p.name.toLowerCase() === preset.name.toLowerCase(),
    );
    if (same && !window.confirm(`Replace the spreadsheet preset “${same[1].name}”?`)) return;
    key = same?.[0] ?? `map-${Date.now().toString(36)}`;
  }
  mapPresets[key] = preset;
  saveMapPresets();
  activeMapPreset = key;
  renderMapPresets();
  message(`Saved the “${preset.name}” spreadsheet preset.`);
}

function deleteMapPreset() {
  const preset = mapPresets[activeMapPreset];
  if (!preset || !window.confirm(`Delete the spreadsheet preset “${preset.name}”?`)) return;
  delete mapPresets[activeMapPreset];
  saveMapPresets();
  activeMapPreset = "";
  renderMapPresets();
}

const count = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
// The spreadsheet row an item came from, counting the heading row.
const rowNumber = (item) => state.rowNumbers?.[item.row] ?? item.row + (state.hasHeader ? 2 : 1);
const showChar = (char) =>
  /[\p{C}\p{Z}]/u.test(char)
    ? `an invisible character (U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")})`
    : `'${char}'`;
const cantPrint = (char) => `contains ${showChar(char)}, which can't be printed.`;
const MIN_SIZE = 8; // pt; smaller text is hard to read and to sort by machine

function describeFailures(items, { missing, check, senderCheck, config }) {
  const parts = [];
  const unprintable = items.filter((item) => missing.has(item.lines));
  if (unprintable.length) {
    const [item] = unprintable;
    const name = item.lines[0].length > 40 ? `${item.lines[0].slice(0, 39)}…` : item.lines[0];
    parts.push(`Row ${rowNumber(item)} (${name}) ${cantPrint(missing.get(item.lines))}`);
    if (unprintable.length > 1)
      parts.push(
        `${count(unprintable.length - 1, "other address", "other addresses")} also can't be printed.`,
      );
    parts.push("Correct the spreadsheet and load it again.");
  }
  if (check.failed)
    parts.push(
      `${count(check.failed, "address", "addresses")} ${check.failed === 1 ? "is" : "are"} too long to fit ${config.format.kind === "labels" ? "a label" : "the envelope"}. Shorten the text or unmap a column.`,
    );
  if (missing.has(config.sender.lines))
    parts.push(`The return address ${cantPrint(missing.get(config.sender.lines))}`);
  else if (config.sender.mode === "sheet") {
    const item = items.find((item) => missing.has(item.sender));
    if (item)
      parts.push(`Row ${rowNumber(item)}'s return address ${cantPrint(missing.get(item.sender))}`);
  }
  if (senderCheck.failed)
    parts.push(
      `${senderCheck.failed === 1 ? "A return address doesn't" : `${senderCheck.failed.toLocaleString()} return addresses don't`} fit the corner. Use fewer, shorter lines.`,
    );
  return parts;
}

async function update() {
  const source = importing;
  const seq = ++tick;
  state.ready = false;
  $("download").disabled = true;
  if (designer.active()) return designer.update(() => seq === tick && source === importing);
  try {
    const config = readConfig();
    const { format, sender } = config;
    sender.lines = sender.lines.map(clean).filter(Boolean);
    const columns = (fields) => fields.map((line) => line.filter(Number.isInteger));
    const items = mailItems(
      state.rows,
      columns(state.fields),
      sender.mode === "sheet" ? columns(state.senderFields) : null,
    );
    if (sender.mode === "fixed") for (const item of items) item.sender = sender.lines;
    const labels = items.length;
    if (labels > MAX_LABELS)
      throw Error(`Limit each export to ${MAX_LABELS.toLocaleString()} ${config.format.kind}.`);
    const { measure, hasChar } = await getMeasure();
    if (seq !== tick || source !== importing) return;
    const missing = new Map();
    for (const lines of [sender.lines, ...items.flatMap((item) => [item.lines, item.sender])]) {
      const char = lines?.length ? missingChar(lines, hasChar) : null;
      if (char) missing.set(lines, char);
    }
    const check = checkFits(
      items.map((item) => item.lines).filter((lines) => !missing.has(lines)),
      measure,
      (format.width - 2 * format.padding) * MM,
      (format.height - 2 * format.padding) * MM,
      config.size,
    );
    const senders = [...new Set([sender.lines, ...items.map((item) => item.sender)])].filter(
      (lines) => lines?.length && !missing.has(lines),
    );
    const senderCheck = format.sender
      ? checkFits(
          senders,
          measure,
          format.sender.width * MM,
          format.sender.height * MM,
          SENDER_SIZE,
        )
      : { fits: new Map(), failed: 0 };
    for (const [lines, fit] of senderCheck.fits) check.fits.set(lines, fit);
    state.config = config;
    state.fits = check.fits;
    state.missing = missing;
    state.pages = items.length ? paginate(items, format, config.skip) : [];
    state.page = Math.min(state.page, Math.max(0, state.pages.length - 1));

    $("count").textContent = items.length.toLocaleString();
    $("labels").textContent = labels.toLocaleString();
    $("labels-unit").textContent =
      `${format.kind === "labels" ? "label" : "envelope"}${labels === 1 ? "" : "s"}`;
    $("sheets").textContent = state.pages.length.toLocaleString();
    const problems = describeFailures(items, { missing, check, senderCheck, config });
    flagIncomplete(
      items.filter((item) => item.incomplete).length,
      state.pages.flatMap((cells, i) => (cells.some((item) => item?.incomplete) ? [i] : [])),
      format.kind === "labels" ? "sheet" : "envelope",
    );
    if (problems.length) message(problems.join(" "), true);
    else {
      const notes = [];
      const omitted = state.rows.length - items.length;
      if (state.rows.length && !items.length) notes.push("Choose at least one address column.");
      else if (omitted)
        notes.push(`${count(omitted, "empty address", "empty addresses")} omitted.`);
      const small = items.filter((item) => check.fits.get(item.lines).size < MIN_SIZE).length;
      if (small)
        notes.push(
          `${count(small, "address", "addresses")} shrunk below ${MIN_SIZE} pt — check the preview.`,
        );
      const noSender =
        sender.mode === "sheet" ? items.filter((item) => !item.sender.length).length : 0;
      if (noSender)
        notes.push(
          `${count(noSender, "envelope has", "envelopes have")} no return address because the chosen columns are empty.`,
        );
      message(notes.join(" "));
    }

    state.ready = state.pages.length > 0 && !problems.length;
    $("download").disabled = building || !state.ready;
    renderPaper();
  } catch (e) {
    if (seq !== tick || source !== importing) return;
    message(e.message, true);
    flagIncomplete(0);
  }
}

// Lays out the preview and wording for the chosen format; safe to call with an invalid form.
function renderFormat() {
  shownFormat = $("format").value;
  const design = designer.active();
  $("design-card").hidden = $("blocks-card").hidden = !design;
  $("mapping-card").hidden = $("size-area").hidden = design;
  $("paper").classList.toggle("design", design);
  if (design) {
    $("paper").parentElement.classList.remove("envelope");
    Object.assign($("paper").style, {
      gridTemplateColumns: "",
      gridTemplateRows: "",
      columnGap: "",
      rowGap: "",
      padding: "",
    });
    $("skip-area").hidden = $("envelope-card").hidden = $("sheets-stat").hidden = true;
    renderPresetActions();
    designer.renderFormat();
    return;
  }
  $("count-unit").textContent = "addresses";
  renderPresetActions();
  const format = formatFor($("format").value);
  const count = perSheet(format);
  const isLabels = format.kind === "labels";
  const paper = $("paper").parentElement;
  paper.style.aspectRatio = `${format.page.width}/${format.page.height}`;
  paper.classList.toggle("landscape", format.page.width > format.page.height);
  paper.classList.toggle("envelope", !isLabels);
  Object.assign($("paper").style, {
    gridTemplateColumns: `repeat(${format.columns}, ${cqw(format.width, format)})`,
    gridTemplateRows: `repeat(${format.rows}, ${cqw(format.height, format)})`,
    columnGap: cqw(format.columnGap, format),
    rowGap: cqw(format.rowGap, format),
    padding: `${cqw(format.top, format)} 0 0 ${cqw(format.left, format)}`,
  });
  const skip = Math.min(Number($("skip").value) || 0, count - 1);
  $("skip").innerHTML = Array.from(
    { length: count },
    (_, i) => `<option value="${i}">${i + 1}${i === 0 ? " — new sheet" : ""}</option>`,
  ).join("");
  $("skip").value = String(skip);
  $("skip-area").hidden = !isLabels;
  $("envelope-card").hidden = isLabels;
  $("sheets-stat").hidden = !isLabels;
}

const overflowTitle = (lines) =>
  state.missing.has(lines)
    ? `Contains ${showChar(state.missing.get(lines))}, which can't be printed — the PDF cannot be generated`
    : "Too much text to fit — the PDF cannot be generated";

// Renders only from state set by update(), so it never has to re-validate the form.
function renderPaper() {
  if (designer.active()) return designer.renderPaper();
  const { config, pages, page, fits } = state;
  const format = config?.format ?? formatFor($("format").value);
  const cells = pages[page] || Array(perSheet(format)).fill(null);
  const cell = `padding:${cqw(format.padding, format)}`;
  const fontSize = (pt) => `font-size:${cqw(pt / MM, format)}`;
  const numbered = format.kind === "labels" && page === 0;
  $("paper").innerHTML = cells
    .map((item, i) => {
      if (!item)
        return `<div class="label blank" style="${cell}"><span>${numbered ? i + 1 : ""}</span></div>`;
      const { lines } = item;
      const fit = fits.get(lines);
      if (!fit)
        return `<div class="label overflow" title="${escape(overflowTitle(lines))}" style="${fontSize(config.size)};${cell}">${lines.map(escape).join("<br>")}</div>`;
      return `<div class="label${item.incomplete ? " incomplete" : ""}" style="${fontSize(fit.size)};${cell}">${fit.lines.map(escape).join("<br>")}</div>`;
    })
    .join("")
    .concat(renderExtras(format, cells[0]));
  $("page-label").textContent = pages.length
    ? `${format.kind === "labels" ? "Sheet" : "Envelope"} ${page + 1} of ${pages.length}`
    : `Your ${format.kind} will appear here`;
  $("prev").disabled = page === 0;
  $("next").disabled = page >= pages.length - 1;
}

const licenceLeft = (format) => format.page.width - format.licence.right - format.licence.width;

// The ceadúnas and return address on an envelope preview, placed as in the PDF.
function renderExtras(format, item) {
  if (format.kind !== "envelopes") return "";
  const { config, fits, licence } = state;
  const box = ({ top, width, height }, left) =>
    `left:${cqw(left, format)};top:${cqw(top, format)};width:${cqw(width, format)};height:${cqw(height, format)}`;
  let html = "";
  if (licence)
    html += `<img class="licence" alt="Ceadúnas" src="${licence.url}" style="${box(format.licence, licenceLeft(format))}">`;
  const lines = item?.sender ?? (config?.sender.mode === "fixed" ? config.sender.lines : null);
  if (lines?.length) {
    const fit = fits.get(lines);
    const size = `font-size:${cqw((fit?.size ?? SENDER_SIZE) / MM, format)}`;
    const title = fit ? "" : ` title="${escape(overflowTitle(lines))}"`;
    html += `<div class="sender${fit ? "" : " overflow"}"${title} style="${box(format.sender, format.sender.left)};${size}">${(fit?.lines ?? lines).map(escape).join("<br>")}</div>`;
  }
  return html;
}

function drawExtras(pdfPage, format, item, { font, fits, licence }) {
  // Top-left corner of a box in PDF coordinates.
  const place = (box, left) => ({
    x: left * MM,
    top: (format.page.height - box.top) * MM,
    width: box.width * MM,
    height: box.height * MM,
  });
  const licenceBox = place(format.licence, licenceLeft(format));
  const senderBox = place(format.sender, format.sender.left);
  if (licence) {
    const scale = Math.min(licenceBox.width / licence.width, licenceBox.height / licence.height);
    const width = licence.width * scale;
    const height = licence.height * scale;
    pdfPage.drawImage(licence, {
      x: licenceBox.x + licenceBox.width - width,
      y: licenceBox.top - height,
      width,
      height,
    });
  }
  const lines = item?.sender;
  if (!lines?.length) return;
  const fit = fits.get(lines);
  if (!fit) throw Error("A return address does not fit. Shorten it and try again.");
  fit.lines.forEach((line, j) =>
    pdfPage.drawText(line, {
      x: senderBox.x,
      y: senderBox.top - fit.size - j * fit.size * 1.2,
      size: fit.size,
      font,
    }),
  );
}

// Hands the browser a file to save, replacing the previous one's URL.
function saveFile(bytes, name, type) {
  if (pdfURL) URL.revokeObjectURL(pdfURL);
  pdfURL = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = pdfURL;
  link.download = name;
  link.click();
}

function setBuilding(on) {
  building = on;
  $("download").disabled = on || !state.ready;
}

async function download() {
  if (designer.active()) return designer.download();
  try {
    // The export uses the config its pages and fits were built from.
    const { format } = state.config;
    const { fits, licence } = state;
    const sheets = state.pages;
    setBuilding(true);
    message("Building PDF…");
    // Let the status paint before the synchronous drawing below.
    await new Promise((resolve) => setTimeout(resolve));
    const pad = format.padding * MM;
    const doc = await PDFDocument.create();
    doc.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
    const font = await embedFont(doc);
    const envelope = format.kind === "envelopes";
    const licenceImage =
      envelope && licence
        ? await (licence.type === "png" ? doc.embedPng(licence.bytes) : doc.embedJpg(licence.bytes))
        : null;
    for (const cells of sheets) {
      const pdfPage = doc.addPage([format.page.width * MM, format.page.height * MM]);
      if (envelope) drawExtras(pdfPage, format, cells[0], { font, fits, licence: licenceImage });
      cells.forEach((item, i) => {
        if (!item) return;
        const origin = slotOrigin(format, i);
        const x = origin.x * MM;
        const top = (format.page.height - origin.y) * MM;
        const fit = fits.get(item.lines);
        if (!fit) throw Error(`Address ${i + 1} does not fit. Shorten its text and try again.`);
        fit.lines.forEach((line, j) =>
          pdfPage.drawText(line, {
            x: x + pad,
            y: top - pad - fit.size - j * fit.size * 1.2,
            size: fit.size,
            font,
          }),
        );
      });
    }
    const bytes = await doc.save();
    saveFile(
      bytes,
      `${state.fileName.replace(/\.[^.]+$/, "") || "addresses"}-${format.kind}-${timestamp()}.pdf`,
      "application/pdf",
    );
    const paperName = format.page.name.split(" ")[0];
    const printed = envelope
      ? count(sheets.length, "envelope")
      : `${count(sheets.length, "sheet")} of labels`;
    message(`PDF ready. Print on ${paperName} at Actual size (100%): ${printed}.`);
  } catch (e) {
    message(e.message, true);
  } finally {
    setBuilding(false);
  }
}

// Local date and time, e.g. 2026-09-24-1430, so repeated downloads don't get confused.
function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Embeds the image in a scratch PDF so anything the export can't use is rejected on upload.
async function setLicence(bytes, name) {
  const type =
    bytes[0] === 0x89 && bytes[1] === 0x50
      ? "png"
      : bytes[0] === 0xff && bytes[1] === 0xd8
        ? "jpg"
        : null;
  if (!type) throw Error("Choose a PNG or JPEG image.");
  let image;
  try {
    const doc = await PDFDocument.create();
    image = await (type === "png" ? doc.embedPng(bytes) : doc.embedJpg(bytes));
  } catch {
    throw Error("The image could not be read. Try saving it again as a PNG.");
  }
  state.licence = {
    bytes,
    type,
    width: image.width,
    height: image.height,
    url: `data:image/${type === "png" ? "png" : "jpeg"};base64,${toBase64(bytes)}`,
  };
  $("licence-name").textContent = name;
  $("licence-remove").hidden = false;
}

// Each licence change bumps this, so a slow load can't replace a newer choice.
let licenceSeq = 0;

// The ceadúnas is chosen afresh each visit and never saved, so one person's upload
// can't turn up on someone else's envelopes.
async function loadLicence(file) {
  if (!file) return;
  const seq = ++licenceSeq;
  try {
    if (file.size > MAX_IMAGE_BYTES) throw Error("Please use an image smaller than 1 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (seq !== licenceSeq) return;
    await setLicence(bytes, file.name);
    // Re-run update() rather than clearing the status, so any address problems stay reported.
    update();
  } catch (e) {
    message(`Could not load ceadúnas: ${e.message}`, true);
  } finally {
    $("licence-file").value = "";
  }
}

function removeLicence() {
  licenceSeq++;
  state.licence = null;
  $("licence-name").textContent = "Choose an image";
  $("licence-remove").hidden = true;
  renderPaper();
}

function saveSender() {
  try {
    localStorage.setItem(
      SENDER_KEY,
      JSON.stringify({ mode: $("sender-mode").value, text: $("sender-text").value }),
    );
  } catch {}
}

function renderSenderMode() {
  const mode = $("sender-mode").value;
  $("sender-fixed-area").hidden = mode !== "fixed";
  $("sender-sheet-area").hidden = mode !== "sheet";
}

function setFormat(key) {
  $("format").value = key;
  try {
    localStorage.setItem(FORMAT_KEY, key);
  } catch {}
  // Drop pages built for the old format so an invalid setting can't leave them in the new layout.
  Object.assign(state, { config: null, pages: [], fits: new Map(), page: 0 });
  presetEditor.close();
  renderFormat();
  renderPaper();
  return update();
}

// Saved label sheets are re-checked on load, so a damaged entry is dropped rather than printed.
function loadPresets() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRESETS_KEY));
    for (const [key, preset] of Object.entries(saved ?? {}))
      if (/^custom-[a-z0-9]+$/.test(key))
        try {
          presets[key] = labelPreset(preset);
        } catch {}
  } catch {}
}

function savePresets() {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch {}
}

// Rebuilds the "Layout Preset" list with the saved label sheets, keeping the current choice.
function renderFormatOptions() {
  const key = $("format").value;
  const byName = Object.entries(presets)
    .map(([k, preset]) => [k, presetFormat(preset)])
    .sort(([, a], [, b]) => a.name.localeCompare(b.name));
  $("format").innerHTML = formatOptions(byName);
  $("format").value = formatFor(key) || key === "design" ? key : "labels";
}

function renderPresetActions() {
  const key = $("format").value;
  $("preset-actions").hidden = key === "design";
  $("preset-edit").hidden = $("preset-delete").hidden = !Object.hasOwn(presets, key);
  if (key === "design") $("preset-form").hidden = true;
}

// Opens the preset editor on a saved preset, or on a copy of the chosen labels for a new one.
function openPresetForm(key) {
  const current = formatFor($("format").value);
  if (key) return presetEditor.open(presets[key], key);
  presetEditor.open({
    paper: "a4",
    ...(current?.kind === "labels" ? current : formats.labels),
    name: "",
  });
}

function savePreset() {
  let preset;
  try {
    preset = labelPreset(presetEditor.read());
  } catch (e) {
    $("preset-error").textContent = e.message;
    return;
  }
  const key = $("preset-form").dataset.key || `custom-${Date.now().toString(36)}`;
  presets[key] = preset;
  savePresets();
  renderFormatOptions();
  return setFormat(key);
}

function deletePreset() {
  const key = $("format").value;
  if (!Object.hasOwn(presets, key)) return;
  if (!window.confirm(`Delete the label preset “${presets[key].name}”?`)) return;
  delete presets[key];
  savePresets();
  renderFormatOptions();
  return setFormat("labels");
}

// For shared computers: removes everything Mailroom saved in this browser and starts afresh.
function forgetSettings() {
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith("mailroom-") || key.startsWith(OLD_KEY_PREFIX))
        localStorage.removeItem(key);
  } catch {}
  location.reload();
}

// Moves settings saved under Mailroom's old name, LabelGen, to their new keys.
try {
  for (const key of [MAPPING_KEY, FORMAT_KEY, SENDER_KEY, PRESETS_KEY]) {
    const oldKey = OLD_KEY_PREFIX + key.slice("mailroom-".length);
    const saved = localStorage.getItem(oldKey);
    if (saved !== null && localStorage.getItem(key) === null) localStorage.setItem(key, saved);
    localStorage.removeItem(oldKey);
  }
} catch {}

document.querySelector("#app").innerHTML = template;
const designer = createDesigner({
  $,
  state,
  escape,
  message,
  flagIncomplete,
  count,
  rowNumber,
  cantPrint,
  getMeasure,
  fontBytes,
  toBase64,
  timestamp,
  saveFile,
  setBuilding,
  isBuilding: () => building,
  update,
  setFormat,
  dropZone,
});
designer.bind();
const presetEditor = createPresetEditor({ $ });
presetEditor.bind();

$("file").addEventListener("change", (e) => importFile(e.target.files[0]));
$("licence-file").addEventListener("change", (e) => loadLicence(e.target.files[0]));
$("password-area").addEventListener("submit", (e) => {
  e.preventDefault();
  unlock();
});
$("password-cancel").addEventListener("click", () => {
  importing = {};
  showPassword(null);
  message("");
});

function dropZone(zone, onFile) {
  let dragDepth = 0;
  zone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth++;
    zone.classList.add("dragging");
  });
  zone.addEventListener("dragover", (e) => e.preventDefault());
  zone.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) zone.classList.remove("dragging");
  });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    zone.classList.remove("dragging");
    onFile(e.dataTransfer.files[0]);
  });
}
dropZone($("drop"), importFile);
dropZone($("licence-drop"), loadLicence);

$("licence-remove").addEventListener("click", removeLicence);
$("sender-mode").addEventListener("change", () => {
  saveSender();
  renderSenderMode();
  update();
});
$("sender-text").addEventListener("input", () => {
  saveSender();
  update();
});

$("sheet").addEventListener("change", changeSheet);
$("has-header").addEventListener("change", changeSheet);

for (const [key, { id, add }] of Object.entries(mappings)) {
  $(id).addEventListener("change", (e) => {
    const { line, slot } = e.target.dataset;
    if (line === undefined) return;
    fieldsFor(key)[Number(line)][Number(slot)] =
      e.target.value === "" ? null : Number(e.target.value);
    saveMapping();
    renderMapPresets();
    update();
  });
  $(id).addEventListener("click", (e) => {
    const button = e.target.closest("[data-remove]");
    if (!button) return;
    fieldsFor(key).splice(Number(button.dataset.remove), 1);
    saveMapping();
    renderMapping();
    update();
  });
  $(add).addEventListener("click", () => {
    fieldsFor(key).push([]);
    saveMapping();
    renderMapping();
    update();
  });
}

for (const id of ["size", "skip"]) $(id).addEventListener("input", update);
$("size").addEventListener("input", renderMapPresets);
$("map-preset").addEventListener("change", chooseMapPreset);
$("map-preset-save").addEventListener("click", () => saveMapPreset(false));
$("map-preset-update").addEventListener("click", () => saveMapPreset(true));
$("map-preset-delete").addEventListener("click", deleteMapPreset);
// "+ New label preset…" opens the editor and leaves the list on the layout already in use.
$("format").addEventListener("change", () => {
  if ($("format").value !== "new") return setFormat($("format").value);
  $("format").value = shownFormat;
  openPresetForm(null);
});
$("preset-edit").addEventListener("click", () => openPresetForm($("format").value));
$("preset-delete").addEventListener("click", deletePreset);
$("preset-form").addEventListener("submit", (e) => {
  e.preventDefault();
  savePreset();
});

$("prev").addEventListener("click", () => {
  state.page--;
  renderPaper();
});
$("next").addEventListener("click", () => {
  state.page++;
  renderPaper();
});
$("warning-jump").addEventListener("click", () => {
  state.page = flagged.find((p) => p > state.page) ?? flagged[0] ?? state.page;
  renderPaper();
});
$("warning-ack").addEventListener("click", () => {
  acknowledged = true;
  $("warning").hidden = true;
});
$("download").addEventListener("click", () => download());
$("demo").addEventListener("click", loadDemo);
$("forget").addEventListener("click", forgetSettings);

// The Help tab is any #help… address, so help links can point straight at a section and
// the browser's Back button returns to where the user was.
function showTab() {
  const hash = location.hash.slice(1);
  const help = hash.startsWith("help");
  $("print-view").hidden = $("print-bar").hidden = $("load-bar").hidden = help;
  if (help) presetEditor.close();
  $("help-view").hidden = !help;
  for (const [id, current] of [
    ["tab-print", !help],
    ["tab-help", help],
  ])
    if (current) $(id).setAttribute("aria-current", "page");
    else $(id).removeAttribute("aria-current");
  // The target was hidden when the browser tried to scroll to it.
  const target = help && hash !== "help" && document.getElementById(hash);
  if (target) target.scrollIntoView?.();
  else window.scrollTo?.(0, 0);
}
window.addEventListener("hashchange", showTab);

loadPresets();
loadMapPresets();
renderMapPresets();
renderFormatOptions();
try {
  const saved = localStorage.getItem(FORMAT_KEY);
  if (formatFor(saved) || saved === "design") $("format").value = saved;
} catch {}
try {
  const saved = JSON.parse(localStorage.getItem(SENDER_KEY));
  if (["none", "fixed", "sheet"].includes(saved?.mode)) $("sender-mode").value = saved.mode;
  if (typeof saved?.text === "string") $("sender-text").value = saved.text;
} catch {}
showTab();
renderSenderMode();
renderFormat();
update();
// Older versions saved an uploaded ceadúnas; drop it so it can't reappear.
try {
  localStorage.removeItem("labelgen-licence");
} catch {}
