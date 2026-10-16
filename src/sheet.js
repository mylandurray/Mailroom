// Reads spreadsheet bytes into rows of text. No DOM, so it can be tested in Node.
import * as XLSX from "xlsx";

export const MAX_COLUMNS = 100;
export const MAX_ROWS = 10000;

export const NOT_SPREADSHEET = "This doesn't look like a spreadsheet.";
export const UNREADABLE =
  "Mailroom couldn't read this file. It may be damaged or not a real Excel/CSV file. Open it in Excel and use Save As → Excel Workbook (.xlsx), then try again.";
const PROTECTED =
  "This file is password-protected in a way Mailroom can't open. Open it in Excel, save a copy as an Excel Workbook (.xlsx), and load that instead.";
const TOO_MANY_ROWS = `Please split your spreadsheet into files of at most ${MAX_ROWS.toLocaleString()} rows.`;

// Errors Mailroom throws itself are plain Errors with a message meant for the user; anything else
// (TypeError, DOMException, …) is a bug or a damaged file, so the user gets a general message.
export function explain(e) {
  if (e?.constructor === Error) return e.message;
  console.error(e);
  return UNREADABLE;
}

const starts = (bytes, ...magic) => magic.every((b, i) => bytes[i] === b);

function decodeText(bytes) {
  if (starts(bytes, 0xff, 0xfe)) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (starts(bytes, 0xfe, 0xff)) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const body = starts(bytes, 0xef, 0xbb, 0xbf) ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    // Excel's "CSV (Comma delimited)" and most older Windows exports.
    return new TextDecoder("windows-1252").decode(body);
  }
}

const looksBinary = (text) => {
  const start = text.slice(0, 8192);
  const controls = start.match(/[\0-\x08\x0e-\x1f\x7f]/g)?.length ?? 0;
  return start.startsWith("%PDF") || start.includes("\0") || controls > start.length / 100;
};

// Returns the workbook in `bytes`. Text files are decoded here rather than by SheetJS, which reads
// CSV without a byte order mark as Latin-1.
export function readWorkbook(bytes, fileName = "") {
  if (!bytes.length) throw Error("This file is empty.");
  const ext = /\.(\w+)$/.exec(fileName)?.[1].toLowerCase();
  const zip = starts(bytes, 0x50, 0x4b, 0x03, 0x04);
  const cfb = starts(bytes, 0xd0, 0xcf, 0x11, 0xe0);
  // Excel 2-4 workbooks are a bare BIFF stream starting with a BOF record.
  const biff = ext === "xls" && bytes[0] === 0x09 && [0, 2, 4, 8].includes(bytes[1]);
  let text = null;
  if (!zip && !cfb && !biff) {
    // Only .xls has text variants: the HTML and XML "Excel" files many systems export.
    if (["xlsx", "xlsm", "ods"].includes(ext)) throw Error(NOT_SPREADSHEET);
    text = decodeText(bytes);
    if (looksBinary(text)) throw Error(NOT_SPREADSHEET);
  }
  const options = { cellStyles: true, dateNF: "dd/mm/yyyy" };
  try {
    return text === null
      ? XLSX.read(bytes, { ...options, type: "array" })
      : // raw keeps text as typed, so 087… phone numbers and 01/02 dates aren't reinterpreted.
        XLSX.read(text, { ...options, type: "string", raw: true });
  } catch (e) {
    // Protected files are unlocked before this, so this is protection decrypt.js doesn't know.
    // Office never encrypts at the zip level; that flag is set in damaged zips.
    if (/password|encrypt/i.test(e.message) && !/zip/i.test(e.message)) throw Error(PROTECTED);
    console.error(e);
    throw Error(UNREADABLE);
  }
}

const cellText = (cell) =>
  cell.w ?? (cell.v == null || cell.t === "z" ? "" : XLSX.utils.format_cell(cell));
const hasContent = (ws) =>
  Object.keys(ws).some((key) => key[0] !== "!" && cellText(ws[key]).trim());

export function listSheets(workbook) {
  const info = workbook.Workbook?.Sheets ?? [];
  return workbook.SheetNames.map((name, i) => ({
    name,
    hidden: Boolean((info.find((s) => s.name === name) ?? info[i])?.Hidden),
  }));
}

// The first visible sheet with something in it.
export function defaultSheet(workbook) {
  const visible = listSheets(workbook).filter((s) => !s.hidden);
  return (
    visible.find((s) => hasContent(workbook.Sheets[s.name]))?.name ??
    visible[0]?.name ??
    workbook.SheetNames[0]
  );
}

const words = (s) =>
  String(s)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9]+|(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/)
    .filter(Boolean);

// Words that identify a column heading on their own…
const HEADING = new Set(
  "name names fullname firstname lastname surname forename forenames address addresses addr street town city locality county eircode postcode postal zip zipcode country email phone mobile telephone ainm seoladh baile contae".split(
    " ",
  ),
);
// …and words that appear alongside them.
const HEADING_EXTRA = new Set(
  "first last full given family middle title contact recipient addressee company organisation organization line road house number no apt apartment building post code state province region district area village e mail tel id ref reference of or and".split(
    " ",
  ),
);
const isHeading = (text) => {
  const w = words(text);
  return (
    w.some((x) => HEADING.has(x)) &&
    w.every((x) => HEADING.has(x) || HEADING_EXTRA.has(x) || /^\d$/.test(x))
  );
};
const isNumber = (text) => /\d/.test(text) && /^[\d\s.,:/+\-()%€$£]+$/.test(text);

// A first row is headings if its values are distinct, not numbers, and include a usual heading
// such as Name, Address or Eircode.
export function looksLikeHeader(values) {
  const texts = values.map((v) => String(v).trim()).filter(Boolean);
  return (
    texts.length > 0 &&
    new Set(texts.map((t) => t.toLowerCase())).size === texts.length &&
    !texts.some(isNumber) &&
    texts.some(isHeading)
  );
}

// Parses a worksheet into rows of text, skipping empty and hidden rows and hidden columns.
// `hasHeader` undefined means guess. `notes` describes what was done, for the status line.
export function readSheet(workbook, name, hasHeader) {
  const ws = workbook.Sheets[name];
  const byRow = [];
  const hiddenColumns = new Set();
  // Walks the cells that exist rather than !ref, which can reach row 1,048,576 when whole columns
  // are formatted.
  for (const key of Object.keys(ws)) {
    if (key[0] === "!") continue;
    const text = String(cellText(ws[key]));
    if (!text.trim()) continue;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (ws["!cols"]?.[c]?.hidden) hiddenColumns.add(c);
    else (byRow[r] ??= []).push([c, text]);
  }
  // The limit counts populated visible records, not physical positions or blank/hidden rows.
  const rows = [];
  let hiddenRows = 0;
  byRow.forEach((cells, r) => {
    if (ws["!rows"]?.[r]?.hidden) hiddenRows++;
    else rows.push({ r, cells });
  });

  const guessed = hasHeader === undefined;
  const first = rows[0];
  if (guessed) hasHeader = Boolean(first) && looksLikeHeader(first.cells.map(([, text]) => text));
  const columns = [...new Set(rows.flatMap((row) => row.cells.map(([c]) => c)))].sort(
    (a, b) => a - b,
  );
  if (columns.length > MAX_COLUMNS)
    throw Error(`Please use a sheet with no more than ${MAX_COLUMNS} columns.`);
  const index = new Map(columns.map((c, i) => [c, i]));
  const dense = ({ cells }) => {
    const out = Array(columns.length).fill("");
    for (const [c, text] of cells) out[index.get(c)] = text;
    return out;
  };
  const headerRow = hasHeader && first ? dense(rows.shift()) : [];
  if (!rows.length) throw Error("This sheet has no rows.");
  if (rows.length > MAX_ROWS) throw Error(TOO_MANY_ROWS);
  const headers = columns.map(
    (c, i) => headerRow[i]?.trim() || `Column ${XLSX.utils.encode_col(c)}`,
  );

  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
  const notes = [
    hasHeader
      ? `Row ${first.r + 1} used as headings: ${headers.slice(0, 6).join(", ")}${headers.length > 6 ? ", …" : "."}`
      : guessed
        ? "No heading row detected."
        : "No heading row.",
  ];
  if (hiddenRows) notes.push(`${plural(hiddenRows, "hidden row")} skipped.`);
  if (hiddenColumns.size) notes.push(`${plural(hiddenColumns.size, "hidden column")} skipped.`);
  // rowNumbers are the spreadsheet's own 1-based row numbers, so messages can point at a row.
  return {
    headers,
    rows: rows.map(dense),
    rowNumbers: rows.map((row) => row.r + 1),
    hasHeader,
    notes,
  };
}

const ROLES = [
  // Checked in order, so "Street name" is an address line and "Email address" is nothing.
  ["skip", /\b(e ?mail|web|url|ip|phone|mobile|tel|telephone|fax|company|organi[sz]ation)\b/],
  ["address", /\b(address(es)?|addr|street|line|seoladh)\b/],
  ["town", /\b(town|city|locality|village|baile)\b/],
  ["county", /\b(county|contae|state|province|region)\b/],
  ["postcode", /\b(eircode|postcode|postal|zip|zipcode|post code)\b/],
  ["country", /\bcountry\b/],
  ["first", /\b(first|forenames?|given|firstname)\b/],
  ["last", /\b(last|surname|family|lastname)\b/],
  ["name", /\b(name|fullname|ainm|recipient|addressee)\b/],
];
const role = (header) => ROLES.find(([, pattern]) => pattern.test(words(header).join(" ")))?.[0];

// Address lines chosen from the column headings: name (or first + last name), address lines,
// town, county, eircode, country. Empty if no heading is recognised.
export function autoMap(headers, maxLines = 8) {
  const roles = headers.map(role);
  const find = (r) => roles.indexOf(r);
  const all = (r) => roles.flatMap((x, i) => (x === r ? [i] : []));
  const name =
    find("name") >= 0 ? [find("name")] : [find("first"), find("last")].filter((i) => i >= 0);
  const lines = [
    name,
    ...all("address").map((i) => [i]),
    ...["town", "county", "postcode", "country"].map((r) => [find(r)]),
  ].filter((line) => line.length && line.every((i) => i >= 0));
  return lines.slice(0, maxLines);
}
