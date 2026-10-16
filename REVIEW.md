# Mailroom: pre-distribution review

Reviewed 2026-09-24 at commit `9eaf5cd` (clean tree). No code was changed.

## Verdict: **Not ready, but close**

The core output math is correct. Label and envelope geometry, mm→pt conversion, pagination, "start at label", copies and the last partial sheet all check out, and the preview matches the PDF. The problems are elsewhere:

1. **Common CSV exports print garbled names without any warning.** A UTF-8 CSV with no byte-order mark (Google Sheets, Outlook/CRM exports, Mac) turns `Seán` into `SeÃ¡n`, and the Download button stays enabled. I confirmed this in the running app.
2. **Coworkers have no way to run it.** There is no README and no hosting plan. The built `dist/` shows a blank page if someone double-clicks `index.html`.
3. **Rows hidden or filtered out in Excel still get printed**, and ordinary office spreadsheets can freeze the tab for about 20 seconds.

Each of these is a small, local fix. Once the Critical and High items below are done, it would be ready to hand out.

---

## Phase 1: What it is and what I ran

**What it does.** It is a browser-only app (Vite + vanilla JS). You load a `.xlsx` / `.xls` / `.csv` file, choose which columns make up each address line, and download a PDF in one of three formats:
- 21-up A4 labels (L7160 / J8160, 63.5 × 38.1 mm)
- C5 envelopes, one address per page (229 × 162 mm)
- C4 envelopes, one address per page (324 × 229 mm)

Envelopes can also carry a ceadúnas image in the top-right corner and a return address in the top-left, either fixed or taken from spreadsheet columns. Password-protected Excel files are decrypted in the browser, and no data leaves the machine.

**Data flow.**
`File` → `encryptedPackage()` (password prompt if needed) → `XLSX.read` → `readSheet()` (rows as formatted strings) → column mapping (`state.fields`) → `mailItems()` → `checkFits()` / `fitLines()` (wraps text and shrinks it from the chosen size down to 6 pt, using Helvetica metrics) → `paginate()` → HTML preview (`renderPaper`) and PDF (`download()`, pdf-lib, standard Helvetica). Settings, the column mapping, the return address and the ceadúnas image are saved in `localStorage`.

**What it assumes about its environment:**
- It is served over http(s) from localhost or HTTPS, because `crypto.subtle` and ES modules need that.
- The browser is a recent Chromium or Firefox (it uses container-query units).
- Paper is A4. The printer can do "Actual size" and has a C5/C4 envelope paper size.
- Text is limited to Windows-1252 (WinAnsi) characters.
- Node ≥ 20.19 for building (Vite 8). Nothing pins this.

**What I ran:**

| Command / action | Result |
|---|---|
| `npm test` (Node 24.19) | **29 pass, 1 fail.** `main.test.js:253` "a password-protected workbook opens…" times out: `waitFor` gives up after about 4 s, but one AES/SHA-512 password attempt takes about 3 s under jsdom. It fails the same way on every run. |
| `npm run build` | OK. The bundle is 815 kB (310 kB gzipped). Vite warns about the chunk size, which doesn't matter here. |
| `npx prettier --check index.html src` | `src/layout.js` and `src/layout.test.js` are not formatted. |
| Served `dist/` with `vite preview` and drove it in a browser | Sample data, labels, C5 and the PDF all worked. Results of the edge-case runs are below. |
| UTF-8 CSV without BOM: `Seán Murphy, Dún Laoghaire` / `Zoë Byrne, Café Row` | **Preview and PDF show `SeÃ¡n`, `DÃºn`, `ZoÃ«`, `CafÃ©`. No warning, and Download is enabled.** |
| UTF-8 CSV without BOM containing `Áine Ní Bhriain` | Blocked with "contains characters the PDF font can't print. Use Latin-script text." That message is misleading, because the text is Latin script. |
| Windows-1252 CSV (Excel "CSV (Comma delimited)") with `O’Brien` | Blocked with the same misleading message. The curly apostrophe becomes U+0092. |
| 0-byte `empty.xlsx` | Accepted, with 0 addresses and **no message at all**. |
| 10,000 rows × 2 copies (20,000 labels, 953 sheets) | Load took 0.5 s. PDF took 4.4 s (1.8 MB) with no progress indicator. |
| Sheet with data in 2 rows but used range `A1:Z1048576` (formatting applied to whole columns) | **Parse took 19 s** in Node, with the UI frozen, and showed 26 columns. |
| xlsx with a hidden row | The hidden row is printed. SheetJS only reports hidden rows when you pass `cellStyles: true`. |
| 100k × SHA-512 in the browser (one agile password try) | About 2 s. Acceptable. |

**Geometry check (by hand):**
- **Labels:** 7.25 + 3 × 63.5 + 2 × 2.5 = 202.75, which leaves a 7.25 mm right margin. 15.15 + 7 × 38.1 = 281.85, which leaves a 15.15 mm bottom margin. Both are symmetric and within 0.05 mm of Avery's published L7160 spec.
- **C5:** the address box spans x 100–215 and y 60–140 mm. The return-address box (10–90 mm across, 10–40 mm down) and the ceadúnas box (174–219 mm across) don't overlap it.
- **C4:** similar clearances.
- **pt/mm conversion:** `MM = 72/25.4` is used consistently. `fitLines` works in pt against box sizes converted to pt. Preview font sizes are converted pt → mm → cqw correctly. The alignment offset has the same sign in the preview and the PDF (positive means right/down).
- **Line height:** the fit check uses 1.2 × size per line, and the drawn baseline starts one size below the box top. Descenders stay inside the box.

(Your checklist mentions input PDFs, bleed, rotated pages and cutters. Mailroom doesn't read PDFs or drive a cutter, so those items don't apply. I reviewed the equivalent risks for spreadsheets and printers instead.)

---

## Phase 2: Findings by severity

### Critical: wrong output, data loss, or crashes on common input

**C1. UTF-8 CSVs without a BOM print mojibake without warning.** `src/main.js:172`
- **What's wrong:** `XLSX.read(bytes, { type: "array" })` decodes CSV bytes as Latin-1 unless a UTF-8 BOM is present.
- **Scenario:** A coworker exports the parish list from Google Sheets and loads it. Every `á é í ó ú ë` becomes `Ã¡ Ã© …`. 500 labels print with names misspelt. Addresses containing `Í`, `Ó`, `Ú` or `Á` happen to hit unprintable bytes and block the export instead, with a message that doesn't explain why.
- **Fix:** For `.csv` files, decode the bytes yourself before parsing:
  1. Try `new TextDecoder("utf-8", { fatal: true })`.
  2. If that throws, fall back to `new TextDecoder("windows-1252")`.
  3. Pass the resulting string to `XLSX.read(text, { type: "string" })`.

  This also fixes C2.

**C2. Windows-1252 CSVs (Excel's default "CSV (Comma delimited)") fail on `’ “ ” – € …`.** `src/main.js:172`
- **What's wrong:** Bytes 0x80–0x9F are mapped to C1 control characters instead of their cp1252 meanings.
- **Scenario:** `O’Brien`, `St. Mary’s` or `Apt 1–3` in the file. The export is blocked and the only guidance is "Use Latin-script text."
- **Fix:** Same as C1.

**C3. Rows that are hidden or filtered out in Excel are printed.** `src/main.js:94`, `src/main.js:172`
- **What's wrong:** The workbook is read without `cellStyles: true`, so `ws["!rows"][i].hidden` is never available. Even if it were, `sheet_to_json` doesn't skip hidden rows.
- **Scenario:** A coworker filters the master list to "Region = Cork" (200 of 3,000 rows), sees 200 rows, and prints. They get 3,000 labels and envelopes, which wastes stock and could mean mail going to people who opted out.
- **Fix:**
  1. Read with `cellStyles: true`.
  2. Drop rows where `!rows[r]?.hidden` is set.
  3. Report "N hidden/filtered rows skipped." Consider adding an "Include hidden rows" checkbox.
  4. Do the same for hidden columns (`!cols[c].hidden`) in the mapping list.

### High: likely to break for coworkers

**H1. There is no supported way for a coworker to run it.** `package.json` (scripts), no README
- **What's wrong:**
  - `dist/index.html` references `/assets/...` absolutely and loads an external `type="module"` script. Opened by double-click (`file://`), Chrome and Edge will show a blank page. I didn't manage to confirm this in the preview pane (it only renders `file://` as a static snapshot), but it is standard browser behaviour for module scripts.
  - The only other option is `npm install && npm run dev`, which non-developers can't do.
- **Fix, choosing one:**
  - (a) Host `dist/` on an internal **HTTPS** site. HTTPS is required; see H2.
  - (b) Build a single self-contained HTML file with `vite-plugin-singlefile`, which inlines the JS, CSS and fonts. Coworkers could then open it from a shared drive or email. You'd need to verify password unlocking and `localStorage` from `file://` in Edge.

  Also add `base: "./"` in a `vite.config.js` so relative hosting works.

**H2. Password unlocking breaks if the app is served over plain http from another machine.** `src/decrypt.js:171-178`, `package.json` (`--host 0.0.0.0`)
- **What's wrong:** `crypto.subtle` doesn't exist in insecure contexts. The `--host 0.0.0.0` flags suggest you intend people to use `http://<your-ip>:5173`.
- **Scenario:** A coworker opens it at `http://192.168.1.20:5173` and loads a protected file. They see "Could not unlock spreadsheet: Cannot read properties of undefined (reading 'digest')".
- **Fix:**
  - Serve it over HTTPS or use the single-file option in H1.
  - In `importFile`, check `crypto.subtle` before showing the password box and give a plain message if it's missing.
  - Remove `--host 0.0.0.0` unless you really want to expose the dev server to the LAN.

**H3. Spreadsheets whose formatting extends to the bottom of the sheet freeze the tab for about 20 s.** `src/main.js:93-110`
- **What's wrong:** `sheet_to_json` walks the whole `!ref` range. A sheet with 2 real rows but formatting down to row 1,048,576 took 19 s in my test, with no feedback. Chrome may show "Page unresponsive". It also produced 26 "Column N" headers for trailing empty columns.
- **Scenario:** Very common in office spreadsheets: someone once formatted whole columns, and now every load hangs.
- **Fix:**
  1. Before calling `sheet_to_json`, recompute the real range from the cell keys that actually exist (ignore keys starting with `!`) and set `ws["!ref"]` to it.
  2. Pass `sheetRows: MAX_ROWS + 2` to `XLSX.read` so oversize sheets fail fast.
  3. Drop trailing all-empty columns.

**H4. A failing test is committed.** `src/main.test.js:22-25`, `:263`
- **What's wrong:** `waitFor` gives up after about 4 s, but agile decryption takes about 3 s per attempt under Node/jsdom. `npm test` is red on every run, so anyone checking the project can't tell whether it works.
- **Fix:** Let that wait take up to 15 s, for example `waitFor(check, 750)`.

**H5. When the header box is ticked for a file with no header row, the first address is silently dropped.** `src/template.js:30`, `src/main.js:103`
- **What's wrong:** "First row contains column headings" is on by default.
- **Scenario:** A CSV with no header row loses its first recipient. The only clue is that the column dropdowns now say "Alex Morgan" instead of "Name".
- **Fix:**
  - Guess header presence heuristically: first-row values that are unique, non-numeric and look like known words such as name, address, town, eircode or postcode.
  - Always show "Row 1 used as headings: Name, Street, …" in the status line.

**H6. Characters outside Windows-1252 block the whole export and don't say which address is at fault.** `src/main.js:312-325`, `:453`
- **What's wrong:** Polish, Lithuanian, Romanian, Turkish and similar names are common in Ireland (`Łukasz`, `Ş`), and zero-width spaces and tabs pasted from the web also trigger this. Standard Helvetica can't encode them.
- **Details:**
  - The status line only gives a count.
  - The preview cell tooltip says "Too much text to fit", which is the wrong cause.
  - The advice "Use Latin-script text" is confusing for `Ł`, which is Latin script.
- **Fix:**
  - Short term:
    - Name the address and character in the message, e.g. "Row 14 (Łukasz Nowak) contains 'Ł', which can't be printed".
    - Give the correct tooltip.
    - Silently strip or normalise harmless characters (tab, U+200B, NBSP variants).
    - Offer to transliterate (`Ł→L`, `ş→s`) using NFD plus a small table.
  - Better: embed a Unicode TTF (e.g. Noto Sans or Inter, which you already ship) with `@pdf-lib/fontkit`, and measure with the same font.

### Medium

**M1. The empty-file and wrong-type cases say nothing or produce garbage.** `src/main.js:147-156`, `:195`
- A 0-byte or header-only file loads silently with 0 addresses.
- A PDF or text file renamed `.csv` or `.xlsx` is "parsed" as text and produces nonsense labels.
- **Fix:**
  - If the chosen sheet has no data rows, say "This sheet has no rows."
  - Sniff the content: a zip or CFB signature for `.xlsx`/`.xls`, text for `.csv`. Reject mismatches with "This doesn't look like a spreadsheet."

**M2. Raw library errors reach users.** `src/main.js:179`, `:208`, `:236`
- **What's wrong:** SheetJS messages like "Unsupported ZIP file" or "Unsupported file 0", and `TypeError`s, are shown verbatim.
- **Fix:** Map anything unrecognised to "Mailroom couldn't read this file. It may be damaged or not a real Excel/CSV file. Open it in Excel and use Save As → Excel Workbook (.xlsx), then try again." Log the original message to the console.

**M3. The default column mapping blindly uses the first 6 columns.** `src/main.js:151`
- **Scenario:** A typical CRM export (`ID, Email, Phone, First, Last, Street…`) prints IDs, emails and phone numbers. The preview shows this, but a hurried user may not look.
- **Fix:**
  - Auto-map by header name: name/first/last, address/street/line, town/city, county, eircode/postcode, country.
  - Otherwise, map nothing and prompt the user to choose.

**M4. Text shrinks to 6 pt with no warning, and font sizes vary between labels.** `src/layout.js:96`
- **What's wrong:** A long address is silently set in 6 pt, which is hard to read and bad for postal OCR. Labels on the same sheet end up in different sizes.
- **Fix:** Warn when any address is below about 8 pt, e.g. "12 addresses shrunk below 8 pt." Optionally add "use the same size on every label."

**M5. Incomplete addresses print without a warning.** `src/main.js:383-391`
- **What's wrong:** A row with only a name, or a name with no town or postcode, still produces a label.
- **Fix:** Count and report rows where fewer than 2 lines are non-empty, or the last mapped line is empty.

**M6. A hidden first worksheet is loaded by default, and hidden sheets are listed.** `src/main.js:161-164`
- **Fix:**
  - Default to the first visible sheet, using `workbook.Workbook.Sheets[i].Hidden`.
  - Mark hidden sheets "(hidden)" in the dropdown.

**M7. The printer-alignment range of ±5 mm is too small for envelopes.** `src/template.js:60-61`, `src/main.js:87-88`
- **What's wrong:** Manual-feed envelope trays often misregister by 5–10 mm.
- **Fix:**
  - Allow ±15 mm for envelopes.
  - Remember offsets per format in `localStorage`. Today they reset on every load, so people have to recalibrate each session.

**M8. The PDF doesn't ask viewers to print at actual size.** `src/main.js:588`
- **What's wrong:** The on-screen note is the only protection against "Fit to page". That shrinks labels by about 3–6% and misaligns them progressively down the sheet, so the output looks almost right.
- **Fix:** Set `ViewerPreferences` → `PrintScaling: None` (pdf-lib `doc.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None)`). Acrobat honours it. Keep the note for Edge and Chrome.

**M9. Password-protected `.xls` files that Excel opens without asking may show a password prompt here.** `src/main.js:200-205`
- **What's wrong:** Excel encrypts some `.xls` files with the built-in default password `VelvetSweatshop`, for example when "password to modify" or workbook structure protection is set. Excel opens these without prompting. Mailroom will ask the coworker for a password they don't have.
- **Confidence:** Likely. Please confirm with a sample file.
- **Fix:** Try `VelvetSweatshop` automatically before showing the password box.

**M10. The Download button stays enabled while generating, and there's no progress indicator.** `src/main.js:535-608`
- **What's wrong:** Large jobs take several seconds (4.4 s for 953 sheets).
- **Scenario:** A second click builds and downloads a second copy. The coworker may then print both files.
- **Fix:**
  - Disable the button and show "Building PDF…" until it finishes.
  - Show a "Printing N sheets" confirmation in the status line.

### Low

- **L1.** `.xlsm`, `.ods` and `.tsv` are rejected by the extension check (`src/main.js:195`, `src/template.js:17`), even though SheetJS reads all three. Macro-enabled workbooks are common in offices. Add them to the check and the `accept` list.
- **L2.** Real date cells print in US format (`1/5/24`), because SheetJS's default number format is `m/d/yy`. This is rare on labels, but matters if someone maps a date column. Pass `dateNF: "dd/mm/yyyy"`.
- **L3.** Repeated downloads land in Downloads as `…-labels (1).pdf`, `(2)`, and so on. It's easy to print an older file. Add the time to the filename, e.g. `…-labels-2026-09-24-1430.pdf`.
- **L4.** On a shared PC, `localStorage` keeps the previous user's return address, ceadúnas image and column mapping (`src/main.js:15-18`). The addresses themselves are never stored. Mention this in the README, or add a "Forget saved settings" link.
- **L5.** A crafted `.xlsx` can request up to 10 million password-hash rounds (`src/decrypt.js:127`), which is about 3 minutes of CPU per password attempt. That's self-inflicted only, so low risk. Lower the cap to 1M, since Excel uses 100k.
- **L6.** The preview uses container-query units, which need Chrome/Edge 105+ (2022) and Firefox 110+. Older managed browsers would render the preview incorrectly. Document the minimum browser.

### Security basics

No `eval`, no shell calls, and no network use. Everything the user supplies is HTML-escaped before it goes into `innerHTML` (headers, sheet names, address lines). The ceadúnas image is checked by magic bytes and validated by pdf-lib. `xlsx` 0.20.3 is vendored from the official SheetJS CDN and includes the prototype-pollution and ReDoS fixes. The only real concerns are the `--host 0.0.0.0` flags (H2), which expose the dev server, including `src/fixtures`, to the LAN.

### Code health (by risk)

- `src/main.test.js:253` fails on every run (H4).
- There is no `engines` field, and Vite 8 needs Node ≥ 20.19. Add `"engines": { "node": ">=20.19" }` and an `.nvmrc`.
- `format.gap` is only applied horizontally (`src/layout.js:51-54`). That's correct for L7160, but a future format with a vertical gap would be misplaced without any error. Rename it to `columnGap`, or add a `rowGap` and use it in both `slotOrigin` and the preview grid.
- `addresses()` in `src/layout.js` is only used by tests.
- `src/layout.js` and `src/layout.test.js` fail `prettier --check`.
- The label format constants (L7160) are the right place for new label stock, but coworkers can't add a format without editing code. That's fine for now; just document it.

---

## Must-fix-before-distribution checklist

All items fixed on branch `fix/review` (2026-09-24), along with every other finding above. See PLAN.md.

- [x] **C1/C2:** Decode CSVs as UTF-8, falling back to Windows-1252.
- [x] **C3:** Skip hidden and filtered rows, and report how many were skipped.
- [x] **H1:** Pick and implement a distribution method: a single-file HTML, or HTTPS hosting with `base: "./"`.
- [x] **H2:** Make password unlocking work where it's deployed, and fail with a plain message where it can't.
- [x] **H3:** Trim the sheet range before parsing so formatted-to-the-bottom sheets load instantly.
- [x] **H4:** Fix the failing test so `npm test` is green.
- [x] **H6:** Name the offending address and character, and fix the misleading tooltip and advice.
- [x] **M1/M2:** Give plain-language messages for empty, wrong-type and damaged files.
- [x] **M10:** Disable Download while building.
- [x] Add a README for coworkers (draft below).

Strongly recommended as well: H5 (header detection), M3 (auto-mapping), M4 (shrink warning) and M8 (PrintScaling=None).

---

## Suggested tests and sample files to create

**Sample files (keep them in `samples/` so coworkers can try Mailroom safely):**

| File | How to make it | Expect |
|---|---|---|
| `utf8-no-bom.csv` | Google Sheets → Download → CSV, with `Seán Ó Súilleabháin`, `Dún Laoghaire`, `Zoë` | Accents correct in the preview and PDF |
| `utf8-bom.csv` | Excel → Save As "CSV UTF-8" | Same as above |
| `excel-ansi.csv` | Excel → Save As "CSV (Comma delimited)", with `O’Brien`, `St. Mary’s`, `Apt 1–3`, `€` | Prints correctly |
| `semicolon.csv` | Same data, `;`-separated | Columns split correctly (already works) |
| `filtered.xlsx` | 20 rows, AutoFilter showing 5, plus one manually hidden row and one hidden column | 5 printed, "15 hidden rows skipped" |
| `formatted-to-bottom.xlsx` | 3 addresses, then select columns A:Z and apply a fill or border | Loads in under 1 s, only real columns listed |
| `no-header.csv` | Addresses starting on row 1 | First address not lost |
| `crm-export.xlsx` | Columns `ID, Email, Phone, First Name, Last Name, Address 1, Address 2, Town, Eircode` | Sensible auto-mapping |
| `polish-names.xlsx` | `Łukasz Wiśniewski`, `Małgorzata`, a cell with a pasted zero-width space and a tab | Clear message naming the row, or correct printing if a Unicode font is embedded |
| `long-addresses.xlsx` | One 7-line address with a 60-character street name | Shrink warning, text inside the label |
| `hidden-first-sheet.xlsx` | Sheet 1 hidden ("Lookup"), sheet 2 has addresses | Opens sheet 2 |
| `modify-password.xls` | Excel → Save As .xls → Tools → General Options → only "Password to modify" | Opens without a prompt (M9) |
| `empty.xlsx`, `header-only.csv`, `report.pdf` renamed to `report.xlsx`, a truncated `.xlsx` | — | A plain-language message for each |
| `big.xlsx` | 10,000 rows | Loads, PDF builds with a busy indicator, one download per click |
| `22-addresses.xlsx` | Exactly 22 rows | 2 sheets, with 1 label in slot 1 of sheet 2. With "Start at label 21": sheet 1 has only slot 21 filled, and sheet 2 is completely full (addresses 2–22) |

**Automated tests to add (highest value first):**
1. CSV decoding: UTF-8 without BOM, UTF-8 with BOM, and cp1252 bytes (`0x92`, `0x96`, `0x80`) produce the right strings (`main.test.js`, via `dropFile`).
2. Hidden rows and columns are skipped. Build the fixture with `ws["!rows"] = [..., { hidden: true }]` and write it with `cellStyles: true`.
3. A sheet with `!ref = "A1:Z1048576"` and 2 real rows loads in under 1 s and lists 2 columns.
4. **PDF geometry golden test:** generate the labels PDF, parse it with pdf-lib, and check that the page is 595.28 × 841.89 pt. Check that the first text baseline of slot 0 is at x = (7.25 + 3) × MM and slot 20 at y ≈ page − (15.15 + 6 × 38.1 + 3) × MM − size, with and without offsets. This is the test that protects the output from future edits.
5. Check that the same geometry holds for C5 and C4 (address, return address and ceadúnas positions).
6. Empty and wrong-type files each produce a plain-language status.
7. The Download button is disabled while a PDF is being built.
8. Header detection on a CSV with no header row.

---

## Draft coworker README

> Paste into `README.md` once the must-fix items are done. Adjust the "How to open it" section to the distribution method you choose (H1).

```markdown
# Mailroom

Turn a spreadsheet of addresses into a PDF you can print on A4 address labels
(21 per sheet, Avery L7160 / J8160 size) or directly onto C5 or C4 envelopes.

Everything happens in your web browser. Your spreadsheet, addresses and passwords
never leave your computer.

## How to open it

Open **<link or path to Mailroom>** in Microsoft Edge or Google Chrome.
(Nothing to install. Use a recent browser; Internet Explorer will not work.)

## Printing labels

1. **Load your spreadsheet.** Click "Choose a spreadsheet" or drag the file onto it.
   Excel (.xlsx, .xls) and CSV files work. If the file has a password, you'll be asked for it.
   - If your spreadsheet's first row is *not* column titles, untick
     "First row contains column headings".
   - If the file has several tabs, pick the right one under "Worksheet".
2. **Choose the address lines.** For each line, pick the column to print.
   Pick two columns on one line to join them (e.g. First name + Last name).
   Check the preview on the right before going further.
3. **Print settings.** Choose "21-up A4 labels", a text size, and how many copies of each.
   If you're reusing a sheet that already has some labels peeled off, set
   "Start at label" to the first unused one.
4. Click **Download PDF**.
5. Open the PDF and print it with **Scale: Actual size / 100%**.
   Do *not* use "Fit to page". It makes the labels slightly smaller and they
   won't line up.

### First time on a new printer: alignment test

Click "Download alignment test sheet", print it on plain A4 at 100%, and hold it
against a label sheet up to the light. If the boxes are off, open
"Printer alignment" and move them (positive numbers move right/down), then test again.

## Printing envelopes

Choose C5 or C4 under "Print on". Each address gets its own page.
- **Ceadúnas:** add the postage licence image (PNG or JPEG under 1 MB). It prints top right.
- **Return address:** type one to use on every envelope, or take it from spreadsheet columns.
- In the print dialog, choose the envelope paper size (C5 = 229 × 162 mm,
  C4 = 324 × 229 mm), print at 100%, and feed envelopes the way your printer's
  manual shows. Print one test envelope first.

## Known limitations

- Only A4 L7160-style labels, C5 and C4 envelopes. Other label sizes need a code change.
- Up to 10,000 rows per sheet and 20,000 labels per PDF. Split bigger lists.
- Only Western European characters can be printed (accents such as á é í ó ú are fine).
  Names in other alphabets or with letters like Ł or ş will be flagged. Edit them
  in the spreadsheet (e.g. Ł → L) and reload.
- Rows you've hidden or filtered out in Excel are skipped. <!-- after C3 is fixed -->
- Long addresses shrink automatically to fit (down to 6 pt). Check the preview.
- Your column choices, return address and ceadúnas are remembered **on this computer,
  in this browser**. On a shared computer, the next person will see them too.

## Troubleshooting

| Problem | What to do |
|---|---|
| Labels drift further out of line towards the bottom | You printed with "Fit to page". Print at Actual size / 100%. |
| Everything is shifted the same amount | Use "Printer alignment" (see above). |
| "Password-protected in a way Mailroom can't open" | Open the file in Excel, Save As → Excel Workbook (.xlsx), load that. |
| "Characters the PDF font can't print" | The message names the row. Replace the unusual letter in the spreadsheet. |
| Accents look wrong (e.g. `SeÃ¡n`) | Please report it (see below) and include the file type. |
| Nothing happens / blank page | Use a current Edge or Chrome, and open the link given above. |

## Help

Ask whoever set Mailroom up for you, or [report it on GitHub](https://github.com/mylandurray/Mailroom/issues). Please include the spreadsheet
type (.xlsx/.xls/.csv), which format you were printing, and a screenshot of the message.

---

## For developers

    Node.js 20.19 or newer
    npm install
    npm run dev          # local dev server
    npm test             # unit + jsdom tests
    npm run build        # production build in dist/

The SheetJS `xlsx` package is vendored in `vendor/` (it's not published to npm).
Label and envelope dimensions live in `src/layout.js`.
```
