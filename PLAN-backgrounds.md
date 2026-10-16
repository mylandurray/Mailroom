# Mailroom: variable data on a PDF background (mailers and name badges)

Branch `feature/pdf-background` from `main`. One commit per workstream, no push.

## Goal

The user uploads a finished design (PDF, or PNG/JPEG), places one or more text boxes on it, maps spreadsheet columns into each box, and downloads one PDF with a personalised copy of the design per row.

- **Mailer**: a letter, postcard or envelope design; typically an address box where a C5 or C4 window envelope shows it.
- **Name badge**: exactly the same thing: the badge design file, with a name (and maybe organisation) stamped on each copy. Mailroom does **not** impose badges onto sheets; that happens downstream.

So the output is always: **one record = one copy of the design** (one page, or the full page set for multi-page designs).

## Decisions (2026-09-26)

1. **Vector artwork in the PDF.** pdf-lib `doc.embedPdf(bytes, [pageIndex])` once per design page, then `page.drawPage(embedded, …)` on every output page. The background is stored once as a form XObject, so 5,000 mailers don't grow the file 5,000 times and print quality is unchanged. PNG/JPEG use the existing `embedPng`/`embedJpg` path, also embedded once.
2. **Preview with pdf.js** (`pdfjs-dist` 6.x, approved), **lazy-loaded** with `import()` only when a PDF design is chosen, so the labels flow and main bundle don't change. Render the chosen page once to a canvas at preview resolution, keep it as a blob URL, and show it as the paper background. The worker must work in the single-file build from `file://` (inline worker or `workerPort`); prove this first.
3. **Design uploaded each time; projects save to a file.** Nothing about the design goes in `localStorage` or IndexedDB. "Save project" downloads a `.mailroom` file (JSON): the design file (base64), page choices, text boxes with their column mappings (stored by **header name** so they survive a re-exported spreadsheet), fixed texts, settings. "Open project" restores it; the spreadsheet is loaded separately as today. Mappings whose header isn't in the loaded sheet are left blank with a message naming them.
4. **Text in Arimo**, plus **Arimo Bold** (`@expo-google-fonts/arimo/700Bold/…ttf`, already installed) per text box, since badge names are usually bold. Embed only weights actually used; same unsubset embedding as today (see the note on `embedFont` in `main.js`).
5. **"Print background" checkbox**, on by default. Off = the preview shows the design but the PDF carries text only, for pre-printed stock.
6. **Address presets for C5 and C4 window envelopes** (see below).

## Model (new `src/design.js`; pure helpers in `layout.js`)

```js
design = {
  file: { name, kind: "pdf" | "image", bytes },
  page: { width, height },     // mm, from the text page (TrimBox → CropBox → MediaBox, /Rotate applied)
  textPage: 0,                 // page index that gets the text
  pages: [0, 1],               // pages output per record, in order (text page included)
  printArtwork: true,
  blocks: [{
    id, name,                  // "Address", "Name", "Organisation", …
    source: "columns" | "fixed",
    fields: [[col, col?], …],  // same shape as state.fields
    text: "",                  // for fixed
    box: { left, top, width, height },  // mm from the page's top-left
    size, minSize, weight: "regular" | "bold",
    align: "left" | "center" | "right", valign: "top" | "middle" | "bottom",
    address: true,             // enables the address-only warnings (incomplete)
  }],
}
```

New pure helpers in `layout.js`, all unit-tested:
- `blockItems(rows, blocks)`: generalises `mailItems`; one item per row with `lines` per block; rows where every column block is empty are dropped and counted.
- `checkBlocks(items, blocks, measure)`: `checkFits` per block with that block's box, size, min size and font weight.
- `placeLines(fit, box, { align, valign }, measure)` → `[{ text, x, y }]` in mm from the top-left of the page. Used by both the preview and the PDF so they can't drift.
- `fitLines` gets a `minSize` argument (default 6, so labels/envelopes behave as now).

## Behaviour

- **Multi-page designs.** On upload, list the pages with small thumbnails. The user picks the page that gets the text and ticks which other pages print with every record (e.g. letter + reverse, postcard front + back) so each record produces its full page set in order, ready for duplex. Default: all pages, text on page 1.
- **Page size.** Taken from the text page: TrimBox if smaller than MediaBox (drop bleed automatically; say so), else CropBox, else MediaBox; `/Rotate` handled by rotating in `drawPage` and swapping width/height. The status names the size when it's a known one (A4, A5, A6, DL, C5, C4, US Letter, 85 × 55 business card…), otherwise shows mm. Every output page has the text page's size; other design pages keep their own size.
- **Images.** PNG/JPEG designs ask for the page size (preset list + custom mm), with the image placed to fill it; warn if the aspect ratio differs by > 2%.
- **Text boxes.** Numeric left/top/width/height in mm, plus drag to move and corner-drag to resize on the preview, snapping to 0.5 mm. Each box shows a dashed guide in the preview (not printed). "+ Add text box". New designs start with one "Address" box; "Name badge" quick-start sets "Name" (bold, centred, middle, 24 pt, min 12 pt) and "Organisation" (centred, 12 pt).
- **Fixed text** boxes (e.g. an event date) as an alternative to columns.
- **Fitting and warnings.** Shrink-to-fit per box down to its minimum size; reuse the existing messages: unprintable character, doesn't fit (naming the row and the box), < 8 pt for address boxes, incomplete address. Download is disabled until everything fits, as today.
- **Copies per row** as today. No "start at label" (no imposition).
- **Printer alignment offsets** move text only when "Print background" is off; with the background on they move artwork and text together.
- **Limits.** Design file ≤ 20 MB, ≤ 50 pages; output ≤ `MAX_LABELS` records. Encrypted PDFs, broken files and zero-page PDFs are refused with plain messages. Project files are validated (version field, known keys, sizes) before use and never evaluated.

### C5 / C4 window address presets

For an A4 letter in a window envelope (C4 flat, or folded once for C5), the address box preset follows DIN 5008 form B, the layout most European window envelopes are made for: **20 mm from the left, 45 mm from the top, 85 × 45 mm** (with the first ~5 mm for a return line if wanted). Offer:
- "Window envelope address (C4 flat / C5 folded A4)": the box above.
- "A5 letter in C5 window": same position (A5 top half matches).
Both labelled "check against your envelope", and the alignment test gets a design-mode variant that prints the box outline on plain paper to hold against the window. Confirm against the envelopes actually used before shipping.

## UI

- Format select gains **"Your own design (mailer, badge…)"**. Choosing it replaces the cards:
  - **01 Load spreadsheet**: unchanged.
  - **02 Design**: drop zone (PDF, PNG, JPEG), page picker and "print with every record" checkboxes, page size for images, "Print background" checkbox, **Open project** / **Save project**.
  - **03 Text boxes**: one collapsible panel per box: name, source (columns / fixed), column mapping (reuse `renderMapping`, with `mappings` keyed by box id), size, min size, bold, alignment, position, preset menu (address boxes). "+ Add text box", "Name badge" quick-start.
  - **04 Print settings**: copies, alignment offsets.
- Preview: the design image under the text layer; boxes absolutely positioned with the same `cqw` helper as the envelope extras; pagination per record ("Record 3 of 250", page set shown side by side when > 1 page).
- Help tab: "Mailers and name badges": export your design as a PDF at final size (bleed fine if the PDF has a trim box), pre-printed stock, duplex page sets, window envelope check, saving projects.

## Code changes

- `src/design.js` (new): load/validate design files with pdf-lib (page boxes, rotation, encryption), image sizes, known-size names, project save/load (serialise, validate, restore mappings by header name).
- `src/pdfpreview.js` (new): lazy `pdfjs-dist` import, render page N to a blob URL at a pixel width, cache per (file, page, width), revoke URLs on change.
- `src/layout.js`: `blockItems`, `checkBlocks`, `placeLines`, `minSize` in `fitLines`, page size names.
- `src/font.js`: `fontBytes(weight)`; `getMeasure` keyed by weight.
- `src/main.js`: `readConfig` returns the design config for the design format; `update()` branches to blocks; `renderPaper()` gets a design path; `download()` gets `drawDesignRecord` (per record: for each output page, `drawPage` the embedded design page if printing artwork, then on the text page draw each box via `placeLines`). Labels/envelopes code paths stay as they are.
- `src/template.js`, `src/style.css`: design cards, box guides, drag handles, artwork layer, thumbnails.
- `package.json`: `pdfjs-dist`.

## Work plan

**Wave 0 – spike.** Install `pdfjs-dist`; prove lazy import + worker in `npm run build` and in `build:single` opened from `file://`. Prove pdf-lib `embedPdf` + `drawPage` with a rotated page, a page with TrimBox/bleed, and a 5,000-record output (file size ≈ design + text). Fallback if the single-file worker won't work: run pdf.js on the main thread there (slower first render, acceptable).

**Wave 1 – pure logic, tested.** `layout.js` helpers and `design.js` (loading, page boxes, rotation, known sizes, project round-trip, mapping by header name, bad/encrypted/oversized files) with `node --test`.

**Wave 2 – PDF output.** `drawDesignRecord` in `download()`; `output.test.js` golden tests: text coordinates for left/centre/right and top/middle/bottom, bold only embedded when used, design page embedded once per file and drawn once per record page, page sets in order, "Print background" off → no XObject, offsets rules.

**Wave 3 – UI.** Cards, box editor, preview with artwork and drag/resize, project open/save. jsdom tests in `main.test.js`: switching formats, adding/removing boxes, save → open round-trip, missing-header message, Download disabled on overflow.

**Wave 4 – samples, docs, verify.** `samples/`: `mailer-a4.pdf` (2 pages, trim box and 3 mm bleed), `badge.pdf` (e.g. 90 × 55 mm), `badge.png`, `attendees.xlsx` (name, organisation, long and non-Latin names), a saved `.mailroom` project. Help section. Drive both builds in the browser: A4 mailer with the C4/C5 window preset, badges with long names, pre-printed mode, 2,000-row file, project save/open.

## Out of scope

Imposition (n-up on sheets), barcodes/QR codes, per-row images (photos), rich text inside a box, custom fonts, converting labels/envelopes to the design model.

## Still to confirm

- Real C5/C4 window positions of the envelopes in use (the DIN 5008 B preset is the starting guess).
