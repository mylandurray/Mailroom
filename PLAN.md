# Mailroom: current fix plan

## Pre-use review follow-up — 2026-10-08

This is the active plan for the ten findings from the 2026-10-08 review of the
current working tree. The September plan below is historical; its decisions do
not override the current implementation or this plan. Implementation progress and remaining verification are recorded below. Unchecked
items are still open; implementation checks do not imply browser or print sign-off.

Baseline: on Node 22.23.3, the eight test files, formatting check and both builds
passed. A 10,000-row sample exported 477 label pages. Additional probes reproduced
the failures recorded below. These checks used Node/jsdom; real-browser preview,
offline single-file operation and physical printing still need verification.

### Implementation order

Fix items 1–5 first because they affect recipient identity, completeness, artwork
or recoverability of saved work. Then fix output fitting and image sizing, duplex
handling, runtime compatibility and dependency advisories. Preserve existing
working-tree changes. Add regression coverage alongside each fix, then run the
release checks at the end. This plan does not authorize deployment or publishing.

### High severity

#### 1. Prevent silent spreadsheet truncation

- [x] Fix `readWorkbook()` / `readSheet()` in `src/sheet.js` so the
  `sheetRows: MAX_ROWS + 2` parser cap cannot silently discard later populated
  rows. The reproduced case has headings at row 1, a recipient at row 2 and
  another at row 20,001; only the early recipient currently survives.
- [x] Determine whether the parser can reliably detect populated cells after
  the cap. If it cannot, add a bounded scan or parsing strategy that can detect
  truncation and reject the file explicitly. Do not treat a large declared
  `!ref` / `!fullref` alone as proof of excess data: formatting can inflate it.
- [x] Define the row-limit behavior explicitly, including physical row positions,
  blank rows and hidden rows. Retain the previous workbook when rejecting a file.
- [ ] Verify dense 10,000/10,001-row boundaries, sparse late recipients, blank
  stretches, hidden rows and formatting-only ranges. No populated recipient may
  be dropped without an explicit rejection or warning that prevents export.

#### 2. Make the latest file selection win

- [x] In `src/main.js`, check the spreadsheet import token after the file read
  and every decrypt await, immediately before committing workbook state, and
  before displaying errors or clearing inputs for that request.
- [x] In `src/designer.js`, use a shared generation token for design uploads and
  project opens so an older operation cannot replace a newer selection.
- [x] Ensure loading sample addresses or cancelling a pending import invalidates
  earlier work as appropriate. Stale completions must not overwrite status,
  password prompts, preview, mappings or download readiness.
- [ ] Use deferred promises to verify older/newer spreadsheet, design and project
  loads in both completion orders, including a stale failure and encrypted files.

#### 3. Preserve duplicate-column identity in spreadsheet presets

- [x] Update `src/addresspreset.js` to store heading plus occurrence number,
  rather than a heading string alone; reuse or align with design column refs.
  Saving the second `Address` column must never restore the first one silently.
- [x] Migrate existing presets with unique headings. Require the user to resolve
  ambiguous legacy references and report missing occurrences rather than guessing.
- [x] Update validation, matching and changed-state detection, plus any affected
  UI/help in `src/main.js` and `src/help.js`.
- [ ] Verify duplicate headings, case/spacing normalization, column reordering,
  removed occurrences and old stored presets for delivery and sender mappings.

#### 4. Preserve or reject visible PDF forms and annotations

- [x] Inspect forms and visible annotations in `src/design.js` before classifying
  pages as blank or embedding artwork. A filled form field currently disappears
  from the generated PDF while ordinary background text remains.
- [x] Flatten supported form appearances before embedding. If visible annotation
  content cannot be preserved safely, reject the design with instructions to
  flatten/export it first. Never accept it and silently omit visible content.
- [x] Make the preview and export use equivalent normalized artwork.
- [ ] Verify filled text fields, checkboxes, form-only pages, visible annotations
  and ordinary PDFs; retain existing rotation, trim-box and artwork-reuse checks.
  Compare rendered original/output pages as well as extracted text.

### Medium severity

#### 5. Save only projects that can reopen

- [x] Validate project settings before `saveProject()` in `src/designer.js`.
  Clearing a numeric input currently saves `null` and reports success, but
  `readProject()` refuses the resulting file.
- [x] Either block saving invalid edits with an actionable message or explicitly
  support incomplete drafts in the project schema. Saving must not require a
  loaded spreadsheet merely to preserve a valid design and its mappings.
- [ ] Verify blank/non-finite/out-of-range numbers, invalid boxes and sizes,
  projects saved before loading a sheet, and valid save/open round trips.
  Do not report success unless the saved settings satisfy the reader's contract.

#### 6. Enforce horizontal fit for every glyph and line

- [x] Fix `fitLines()` in `src/layout.js`: an oversized first glyph must make that
  font size fail, and every resulting line must fit the available width before
  accepting the result. A 24 pt Arimo `W` currently passes a 1 mm box despite
  measuring about 7.99 mm wide.
- [x] Continue shrinking to the permitted minimum, then fail if no size fits.
- [ ] Verify a single wide glyph, narrow boxes, minimum-size failure, exact-width
  boundaries, long unbroken strings and ordinary wrapping with real font metrics.
  Confirm both preview and PDF generation honor the failed fit.

#### 7. Keep image custom-size mode selected

- [x] Fix the image-size change handler and `renderDesignCard()` in
  `src/designer.js` so rebuilding the selector does not replace the requested
  `custom` selection with the previous standard dimensions.
- [x] Keep custom inputs visible until the user deliberately selects a preset;
  preserve entered dimensions and update the aspect-ratio warning.
- [ ] Verify preset → custom → edited dimensions → preset, both orientations,
  invalid dimensions and restored custom-sized projects. Check exported page size.

#### 8. Prevent duplex output crossing recipient boundaries

- [x] Immediately correct `src/help.js` so multi-page designs are not
  unconditionally described as safe to print double-sided.
- [x] Add an explicit duplex option. When enabled, append a blank back after
  each odd-length page set so the next recipient starts on a new physical sheet.
  Include inserted pages in output limits, counts and download messaging.
- [x] Save/restore the option in projects with a backward-compatible default;
  keep simplex output unchanged. Explain paper-size/orientation constraints.
- [ ] Verify two recipients with 1-, 2-, 3- and 4-page sets. In particular,
  2 × 3 pages in duplex mode must produce 8 pages with blank pages 4 and 8.
  Check print-artwork-off mode, page selection changes and limit boundaries.

#### 9. Align documented Node support with dependencies

- [x] Reconcile `package.json`, `.nvmrc`, `README.md` and locked dependencies.
  The current Node 20.19 / 22.12 claim conflicts with `jsdom@30.0.1`, whose
  declared support starts at Node 22.22.2 on the Node 22 line, and with pdf.js.
- [x] Prefer a supported Node 22 minimum compatible with the complete locked
  dependency tree, or deliberately select dependencies supporting the old range.
- [x] Verify clean installation, tests and both builds on the chosen minimum.
  Add a repeatable minimum-version check to prevent documentation drifting again.

### Low severity

#### 10. Resolve build-tool dependency advisories

- [x] Recheck online `npm audit`. At review time it reported four high-severity
  entries representing two underlying denial-of-service advisories: `braces`
  through `micromatch` / `vite-plugin-singlefile`, and `source-map-js`.
- [x] Update `source-map-js` to a patched compatible version (1.2.2 or later).
  Resolve the singlefile dependency chain through a supported update, narrowly
  scoped override or replacement, after checking compatibility.
- [x] Do not apply `npm audit fix --force` blindly: its reported singlefile fix
  was a major downgrade. Document any remaining advisory and actual exposure.
- [x] Verify the lockfile, online audit and both builds. These are build-tool
  findings; no upload-to-vulnerable-package route was established in the review.

### Release verification

- [x] Run `npm test`, `npm run format:check`, `npm run build` and
  `npm run build:single` after integrating the fixes.
- [ ] Exercise supplied samples and the new regression cases in current Edge,
  Chrome and Firefox; check actual layout, fonts, dragging and pdf.js workers.
- [ ] Open `dist-single/mailroom.html` from `file://` with networking disabled;
  verify spreadsheet unlocking, image/PDF previews, project saving and downloads.
- [ ] Serve `dist/` over HTTPS in a subfolder and verify asset/worker URLs.
- [ ] Test missing assets/network failure, malformed projects, unsupported
  characters and overlapping file selections without uncaught errors or stale data.
- [ ] Repeat the 10,000-row export and a substantial multi-page design export;
  record time, output size and responsiveness in a real browser.
- [ ] Print label/envelope alignment samples and odd/even duplex page sets on
  real equipment. Confirm window-envelope placement against the stock in use.
- [ ] Review decoded-resource limits for compressed spreadsheets, image pixel
  dimensions and PDF preview canvases; compressed byte limits alone are not a
  resource-exhaustion guarantee. Run bounded probes, not uncontrolled exhaustion.
- [ ] Replace README distribution placeholders and the Help contact placeholder
  before sharing. Update help for preset ambiguity, PDF restrictions and duplex.
- [ ] Record results and remaining limitations in a dated review follow-up;
  do not mark browser or physical-print checks complete based on jsdom tests.

### Implementation follow-up — 2026-10-08

The ten application/build fixes are implemented. The remaining unchecked verification
items above require broader cases, current browsers or physical equipment.

- Spreadsheet parsing now reads populated cells beyond the former physical-row cap.
  The limit is 10,000 nonempty visible recipient rows per selected worksheet, excluding
  the heading row; blank stretches, hidden rows/columns and formatting-only ranges
  do not count. Sparse recipients at row 20,001 survive. Rejection retains the old
  workbook. Full parsing is bounded by the existing upload byte limit, **not** by a
  decoded-resource limit; compressed workbook expansion still needs separate review.
- Import tokens guard file reads, default/password decrypts, commits, errors and input
  resets. Sample selection/cancel invalidates pending work. Design/project loads share
  one token. Pending layout updates and load messages also check their source.
- Spreadsheet presets save normalized heading occurrences for delivery and sender
  mappings. Unique legacy references still work; ambiguous legacy references require
  remapping. A failed automatic preset restore leaves mappings blank and reports why.
- PDF forms are flattened before blank-page detection, preview and export. Remaining
  annotations are conservatively rejected with flatten/export instructions (including
  links). Unsupported form appearances are rejected. Dangling widget references left
  by pdf-lib are removed only after successful flattening.
- Project save validates settings and the reader contract before downloading, without
  requiring a spreadsheet. Custom image-size mode persists through card redraws.
  Horizontal fitting checks every resulting line and tries the exact minimum size.
- Duplex defaults off for old/new projects. When enabled, odd page sets receive a blank
  back per recipient. Counts, export limits and messaging include the blanks; mixed
  paper sizes/orientations are refused. Tests cover 1–4-page sets for two recipients,
  with artwork on/off; the three-page case has blank pages 4 and 8.
- Node support is now 22.23.3+ on the 22 line, 24.15.0+ on the 24 line, or 26+.
  `npm run check:node` compares the runtime, .nvmrc, docs, package/lock engines and
  every locked dependency's minimum compatibility. Clean `npm ci` passed on 22.23.3.
- Replaced vite-plugin-singlefile with a small local build plugin that inlines all
  generated JS/CSS and rejects leftover external assets. This removes the unpatched
  braces/micromatch chain rather than downgrading the plugin. source-map-js is patched;
  online installation/audit reports zero vulnerabilities. Both builds pass; the
  single-file output contains only mailroom.html (4.17 MB).

Verification results:

- All nine Node test files pass, including existing designer tests and new deferred-load,
  sparse-row, preset, fit, form, duplex, project validation and image-size regressions.
  Formatting, Node compatibility check and both production builds pass.
- A filled-form probe's original, normalized preview source and artwork-only export
  render pixel-for-pixel identically using Poppler at an 800-pixel long edge. Extracted
  text from browser-generated duplex output includes the formerly missing field text.
  Text fields, checked checkboxes and form-only artwork have automated structural checks.
- Installed Chromium 130 and Firefox 131 completed local-server and offline file://
  sample-address downloads and duplex PDF exports. These are **not current-browser
  sign-off**. Their PDF preview lacks Promise.try; a pre-worker feature check now shows
  the existing preview-unavailable message instead of an uncaught worker error. Repeat
  actual PDF/image preview and dragging checks in current Edge/Chrome/Firefox.
- Chromium 130, offline file://: 10,000 CSV recipients exported 477 A4 label pages in
  about 1.48 seconds (import through download), 947,316 bytes, no page errors. A
  password-protected XLSX unlocked successfully offline. A 24-recipient duplex form
  export also retained the filled field text. Larger multi-page stress tests remain open.
- HTTPS/subfolder serving, current-browser PDF previews, full offline image/project
  workflows, network/missing-asset probes, decoded-resource limits and physical printing
  remain open. Distribution/contact placeholders remain because real destinations were
  not supplied. No deployment or publication was performed.

---

## Historical plan — 2026-09-24: fixes for REVIEW.md

Decisions (2026-09-24): fix **everything** in REVIEW.md; ship **both** a hosted `dist/` (HTTPS, `base: "./"`) and a **single-file HTML** build; switch the PDF and preview font to **Arimo** (Arial-metric, OFL 1.1; full TTF from `@expo-google-fonts/arimo/400Regular/Arimo_400Regular.ttf`, import the .ttf only, never the package index) embedded with `@pdf-lib/fontkit` (subset: true), so Ł/ş/Ș print; work on branch `fix/review`, one commit per workstream, no push.

## Wave 0: setup (orchestrator)
- Branch `fix/review` from `main`.
- Registry installs: `vite-plugin-singlefile` (dev), `@pdf-lib/fontkit`, `@expo-google-fonts/arimo`. Commit so all worktrees share one lockfile.

## Wave 1: three parallel workstreams (separate worktrees)

### A. Import pipeline: `src/sheet.js` (new), `main.js` import functions, `decrypt.js`, `template.js`
Move sheet reading out of `main.js` into `src/sheet.js` to keep merges clean.
- **C1/C2** CSV: UTF-8 (fatal) → windows-1252 fallback → `XLSX.read(text, {type:"string"})`. Strip BOM.
- **C3** `cellStyles: true`; skip hidden/filtered rows and hidden columns; report "N hidden rows skipped".
- **H3** recompute `!ref` from real cell keys; `sheetRows: MAX_ROWS + 2`; drop trailing empty columns.
- **H5** header-row heuristic; status always says "Row 1 used as headings: …".
- **M3** auto-map by header name, otherwise map nothing and prompt.
- **M1/M2** empty sheet message; magic-byte sniffing; friendly message for unknown errors (log the original).
- **M6** default to first visible sheet; mark "(hidden)".
- **M9** try `VelvetSweatshop` before prompting.
- **H2 (code)** check `crypto.subtle` before password box; plain message.
- **L1** `.xlsm .ods .tsv`; **L2** `dateNF: "dd/mm/yyyy"`; **L5** spin-count cap 1M.
- Tests: CSV encodings, hidden rows/cols, huge `!ref`, header detection, auto-map, empty/wrong-type, hidden sheet, VelvetSweatshop.

### B. Output: `layout.js`, `main.js` update/render/download, `style.css`
- **H6** Arimo embedded via fontkit (measure with the same font); preview uses Arimo; normalise tab/ZWSP/NBSP; unprintable chars name row + character; correct tooltip.
- **M4** warn when any address < 8 pt. **M5** warn on incomplete addresses.
- **M8** `PrintScaling: None`. **M10** disable Download + "Building PDF…". **L3** timestamp in filename.
- Code health: `gap` → `columnGap`/`rowGap` used in both slotOrigin and preview; remove unused `addresses()`.
- Tests: PDF geometry golden tests (labels, C5, C4, with offsets), Download disabled while building, warnings.

### C. Distribution, config, docs: `package.json`, `vite.config.js`, `README.md`, `.nvmrc`, `template.js` settings area, `main.js` readConfig
- **H1** `base: "./"`; `build` → `dist/`, `build:single` → single `mailroom.html`.
- **H2 (config)** drop `--host 0.0.0.0`.
- **H4** fix password test timeout. **M7** ±15 mm for envelopes, offsets saved per format.
- **L4** "Forget saved settings" link. `engines` + `.nvmrc`. Prettier clean.
- README from REVIEW.md draft (both distribution options, L6 browser minimum, Arimo instead of "Western European only").

## Wave 2: integrate and verify (orchestrator)
- Merge A, B, C into `fix/review`; resolve conflicts; `npm test`, `npm run format:check`, both builds.
- Create `samples/` files from the REVIEW table.
- Drive both builds in the browser: sample CSVs, filtered xlsx, Polish names, big file, envelopes; single file from `file://`.
- Tick the checklist in REVIEW.md.
