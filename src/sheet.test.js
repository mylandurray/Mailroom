import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  readWorkbook,
  readSheet,
  listSheets,
  defaultSheet,
  looksLikeHeader,
  autoMap,
  explain,
  NOT_SPREADSHEET,
  UNREADABLE,
} from "./sheet.js";

const bytes = (...parts) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...Buffer.from(p, "utf8")] : p)));
const load = (data, fileName, hasHeader) => {
  const workbook = readWorkbook(data, fileName);
  return readSheet(workbook, defaultSheet(workbook), hasHeader);
};
const xlsx = (workbook, bookType = "xlsx") =>
  new Uint8Array(XLSX.write(workbook, { type: "array", bookType, cellStyles: true }));
const book = (sheets) => {
  const workbook = XLSX.utils.book_new();
  for (const [name, sheet] of Object.entries(sheets))
    XLSX.utils.book_append_sheet(
      workbook,
      Array.isArray(sheet) ? XLSX.utils.aoa_to_sheet(sheet) : sheet,
      name,
    );
  return workbook;
};

test("UTF-8 CSV without a byte order mark keeps its accents", () => {
  const sheet = load(
    bytes("Name,Town\nSeán Ó Súilleabháin,Dún Laoghaire\nZoë,Café Row\n"),
    "a.csv",
  );
  assert.deepEqual(sheet.rows, [
    ["Seán Ó Súilleabháin", "Dún Laoghaire"],
    ["Zoë", "Café Row"],
  ]);
});

test("UTF-8 CSV with a byte order mark", () => {
  const sheet = load(bytes([0xef, 0xbb, 0xbf], "Name,Town\nSeán,Dún Laoghaire\n"), "a.csv");
  assert.deepEqual(sheet.headers, ["Name", "Town"]);
  assert.deepEqual(sheet.rows, [["Seán", "Dún Laoghaire"]]);
});

test("Windows-1252 CSV from Excel keeps curly quotes, dashes and the euro sign", () => {
  // O’Brien, Apt 1–3, €5, Seán in cp1252.
  const sheet = load(
    bytes("Name,Street\nO", [0x92], "Brien,Apt 1", [0x96], "3 ", [0x80], "5\nSe", [0xe1], "n,x\n"),
    "a.csv",
  );
  assert.deepEqual(sheet.rows, [
    ["O’Brien", "Apt 1–3 €5"],
    ["Seán", "x"],
  ]);
});

test("UTF-16 text, semicolon CSV and TSV split into columns", () => {
  const text = Buffer.from("Name\tTown\nSeán\tCork\n", "utf16le");
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), text]);
  assert.deepEqual(load(new Uint8Array(utf16), "a.tsv").rows, [["Seán", "Cork"]]);
  assert.deepEqual(load(bytes("Name;Town;Eircode\nSeán;Cork;T12 AB34\n"), "a.csv").rows, [
    ["Seán", "Cork", "T12 AB34"],
  ]);
  assert.deepEqual(load(bytes("Name\tTown\nSeán\tCork\n"), "a.tsv").rows, [["Seán", "Cork"]]);
});

test("CSV values are kept as typed", () => {
  const sheet = load(bytes("Name,Phone,Date\nAnn,0871234567,05/01/2024\n"), "a.csv");
  assert.deepEqual(sheet.rows, [["Ann", "0871234567", "05/01/2024"]]);
});

test("dates in Excel files print day first", () => {
  const sheet = load(
    xlsx(
      book({
        S: [
          ["Name", "Date"],
          ["Ann", new Date(2024, 0, 5)],
        ],
      }),
    ),
    "a.xlsx",
  );
  assert.deepEqual(sheet.rows, [["Ann", "05/01/2024"]]);
});

test("hidden and filtered rows and hidden columns are skipped", () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ["Name", "Notes", "Town"],
    ["Ann", "x", "Cork"],
    ["Bob", "y", "Sligo"],
    ["Cat", "z", "Galway"],
    ["Dan", "w", "Mayo"],
  ]);
  ws["!rows"] = [, { hidden: true }, , { hidden: true }];
  ws["!cols"] = [, { hidden: true }];
  const workbook = XLSX.read(xlsx(book({ S: ws })), { type: "array", cellStyles: true });
  assert.ok(workbook.Sheets.S["!rows"][1].hidden, "the fixture keeps its hidden rows");
  const sheet = load(xlsx(book({ S: ws })), "a.xlsx");
  assert.deepEqual(sheet.headers, ["Name", "Town"]);
  assert.deepEqual(sheet.rows, [
    ["Bob", "Sligo"],
    ["Dan", "Mayo"],
  ]);
  assert.deepEqual(sheet.rowNumbers, [3, 5]);
  assert.deepEqual(sheet.notes, [
    "Row 1 used as headings: Name, Town.",
    "2 hidden rows skipped.",
    "1 hidden column skipped.",
  ]);
});

test("a sheet formatted to the bottom loads quickly and lists only real columns", () => {
  // Writing a sheet with a huge range is slow, so the range is set in the saved file instead.
  const zip = XLSX.CFB.read(
    xlsx(
      book({
        S: [
          ["Name", "Town"],
          ["Ann", "Cork"],
          ["Bob", "Sligo"],
        ],
      }),
    ),
    {
      type: "array",
    },
  );
  const entry = XLSX.CFB.find(zip, "/xl/worksheets/sheet1.xml");
  const xml = Buffer.from(entry.content).toString();
  assert.match(xml, /<dimension ref="A1:B3"\/>/);
  entry.content = Buffer.from(xml.replace("A1:B3", "A1:Z1048576"));
  const data = new Uint8Array(XLSX.CFB.write(zip, { type: "array", fileType: "zip" }));
  const start = performance.now();
  const sheet = load(data, "a.xlsx");
  assert.ok(performance.now() - start < 1000);
  assert.deepEqual(sheet.headers, ["Name", "Town"]);
  assert.equal(sheet.rows.length, 2);

  const ws = XLSX.utils.aoa_to_sheet([
    ["Name", "Town", "", ""],
    ["Ann", "Cork", " ", ""],
  ]);
  ws["!ref"] = "A1:Z1048576";
  assert.deepEqual(readSheet(book({ S: ws }), "S").headers, ["Name", "Town"]);
});

test("sheets past the row limit are rejected even if the reader stopped early", () => {
  const csv = bytes(["Name", ...Array.from({ length: 10005 }, (_, i) => `Person ${i}`)].join("\n"));
  assert.throws(() => load(csv, "a.csv"), /at most 10,000 rows/);
  const ok = bytes(["Name", ...Array.from({ length: 10000 }, (_, i) => `Person ${i}`)].join("\n"));
  assert.equal(load(ok, "a.csv").rows.length, 10000);
});

test("a heading row is detected", () => {
  assert.ok(looksLikeHeader(["Name", "Address line 1", "Town / City", "Postcode", "Country"]));
  assert.ok(looksLikeHeader(["ID", "Email", "First Name", "Last Name", "Eircode"]));
  assert.ok(looksLikeHeader(["Ainm", "Seoladh 1", "Contae"]));
  assert.ok(!looksLikeHeader(["Alex Morgan", "12 Willow Road", "Apt 1", "Dublin", "D02 X285"]));
  assert.ok(!looksLikeHeader(["Mary Byrne", "Main Street", "Co. Cork", "Ireland"]));
  assert.ok(!looksLikeHeader(["Name", "Name"]));
  assert.ok(!looksLikeHeader(["Name", "42"]));
  assert.ok(!looksLikeHeader([]));
});

test("a CSV without a heading row keeps its first address", () => {
  const sheet = load(
    bytes("Alex Morgan,12 Willow Road,Dublin\nSam Taylor,Oak Avenue,Cork\n"),
    "a.csv",
  );
  assert.equal(sheet.hasHeader, false);
  assert.deepEqual(sheet.headers, ["Column A", "Column B", "Column C"]);
  assert.deepEqual(sheet.rows[0], ["Alex Morgan", "12 Willow Road", "Dublin"]);
  assert.deepEqual(sheet.notes, ["No heading row detected."]);
  assert.deepEqual(autoMap(sheet.headers), []);
  // The user's choice wins over the guess.
  const forced = load(bytes("Alex Morgan,Dublin\nSam Taylor,Cork\n"), "a.csv", true);
  assert.deepEqual(forced.headers, ["Alex Morgan", "Dublin"]);
  assert.deepEqual(forced.notes, ["Row 1 used as headings: Alex Morgan, Dublin."]);
});

test("the heading row is the first row with data", () => {
  const ws = XLSX.utils.aoa_to_sheet([[], [], [null, "Name", "Town"], [null, "Ann", "Cork"]]);
  const sheet = readSheet(book({ S: ws }), "S");
  assert.deepEqual(sheet.headers, ["Name", "Town"]);
  assert.deepEqual(sheet.notes, ["Row 3 used as headings: Name, Town."]);
  assert.deepEqual(sheet.rowNumbers, [4]);
});

test("columns are mapped by heading", () => {
  assert.deepEqual(
    autoMap([
      "ID",
      "Email",
      "Phone",
      "First Name",
      "Last Name",
      "Address 1",
      "Address 2",
      "Town",
      "Eircode",
    ]),
    [[3, 4], [5], [6], [7], [8]],
  );
  assert.deepEqual(
    autoMap(["Name", "Address line 1", "Address line 2", "Town / City", "Postcode", "Country"]),
    [[0], [1], [2], [3], [4], [5]],
  );
  assert.deepEqual(
    autoMap(["Eircode", "County", "Street", "Email Address", "Company Name", "Full name", "City"]),
    [[5], [2], [6], [1], [0]],
  );
  assert.deepEqual(autoMap(["Surname", "Forename", "Zip"]), [[1, 0], [2]]);
  assert.deepEqual(autoMap(["Amount", "Notes"]), []);
  assert.equal(autoMap(Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`)).length, 8);
});

test("empty and header-only sheets say so", () => {
  assert.throws(() => load(new Uint8Array(), "empty.xlsx"), /This file is empty/);
  assert.throws(() => load(bytes("Name,Street,Town\n"), "a.csv"), /This sheet has no rows/);
  assert.throws(() => load(bytes("\n\n"), "a.csv"), /This sheet has no rows/);
  assert.throws(() => load(xlsx(book({ S: [["Name", "Town"]] })), "a.xlsx"), /no rows/);
});

test("files that aren't spreadsheets are rejected in plain language", (t) => {
  t.mock.method(console, "error", () => {});
  const pdf = bytes("%PDF-1.7\n%âãÏÓ\n1 0 obj\n");
  assert.throws(() => load(pdf, "report.xlsx"), { message: NOT_SPREADSHEET });
  assert.throws(() => load(pdf, "report.csv"), { message: NOT_SPREADSHEET });
  const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  assert.throws(() => load(png, "photo.csv"), { message: NOT_SPREADSHEET });
  assert.throws(() => load(bytes("Name,Town\nAnn,Cork\n"), "a.xlsx"), { message: NOT_SPREADSHEET });
  const truncated = xlsx(book({ S: [["Name"], ["Ann"]] })).subarray(0, 200);
  assert.throws(() => load(truncated, "a.xlsx"), { message: UNREADABLE });
  assert.equal(console.error.mock.callCount(), 1, "the original error is logged");
});

test("text exported with an .xls name still loads", () => {
  assert.deepEqual(load(bytes("Name\tTown\nSeán\tCork\n"), "export.xls").rows, [["Seán", "Cork"]]);
});

test("unexpected errors get a general message", (t) => {
  t.mock.method(console, "error", () => {});
  assert.equal(explain(Error("This sheet has no rows.")), "This sheet has no rows.");
  assert.equal(explain(new TypeError("Cannot read properties of undefined")), UNREADABLE);
  assert.equal(console.error.mock.callCount(), 1);
});

test("the first visible sheet is chosen and hidden sheets are marked", () => {
  const workbook = book({ Lookup: [["Code"], ["1"]], Empty: [], Addresses: [["Name"], ["Ann"]] });
  workbook.Workbook = { Sheets: [{ Hidden: 1 }, { Hidden: 0 }, { Hidden: 0 }] };
  const read = XLSX.read(xlsx(workbook), { type: "array" });
  assert.deepEqual(listSheets(read), [
    { name: "Lookup", hidden: true },
    { name: "Empty", hidden: false },
    { name: "Addresses", hidden: false },
  ]);
  assert.equal(defaultSheet(read), "Addresses");
  const xls = XLSX.read(xlsx(workbook, "xls"), { type: "array" });
  assert.equal(defaultSheet(xls), "Addresses");
  assert.equal(defaultSheet(book({ A: [], B: [] })), "A");
});

test(".xlsm and .ods files load", () => {
  const workbook = book({
    S: [
      ["Name", "Town"],
      ["Seán", "Cork"],
    ],
  });
  for (const type of ["xlsm", "ods"])
    assert.deepEqual(load(xlsx(workbook, type), `a.${type}`).rows, [["Seán", "Cork"]]);
});

test("sparse recipients beyond the old parser cap survive and hidden rows do not count", () => {
  const ws = XLSX.utils.aoa_to_sheet([["Name"], ["Early"]]);
  ws.A20001 = { t: "s", v: "Late" };
  ws.A20002 = { t: "s", v: "Hidden" };
  ws["!ref"] = "A1:A20002";
  ws["!rows"] = [];
  ws["!rows"][20001] = { hidden: true };
  const data = XLSX.write(book({ S: ws }), { type: "array", bookType: "xlsx", cellStyles: true });
  const sheet = load(new Uint8Array(data), "sparse.xlsx");
  assert.deepEqual(sheet.rows, [["Early"], ["Late"]]);
  assert.deepEqual(sheet.rowNumbers, [2, 20001]);
  assert.match(sheet.notes.join(" "), /1 hidden row skipped/);
  const dense = bytes(
    ["Name", ...Array.from({ length: 10001 }, (_, i) => `Person ${i}`)].join("\n"),
  );
  assert.throws(() => load(dense, "dense.csv"), /at most 10,000/);
});
