# Mailroom

Turn a spreadsheet of addresses into a PDF you can print on A4 address labels
(21 per sheet, Avery L7160 / J8160 size, or any label sheet you describe) or directly onto C5 or C4 envelopes, or
print names and addresses onto your own PDF or image design (mailers, name badges).

Mailroom used to be called LabelGen. It still opens `.labelgen` project files and keeps
the settings LabelGen saved in your browser.

Everything happens in your web browser. Your spreadsheet, addresses and passwords
never leave your computer.

## How to open it

Use a current **Microsoft Edge** or **Google Chrome** (Firefox also works). There is
nothing to install. Choose whichever of these you've been given:

- **The web link:** open **<https://mylandurray.github.io/Mailroom/>**.
- **The single file:** download **[`mailroom.html`](https://mylandurray.github.io/Mailroom/mailroom.html)**
  (or take it from the shared drive) and open it by double-clicking it. You can also copy it to your own computer and open it from there.
  It works without an internet connection.

Internet Explorer and browsers older than Chrome/Edge 105 or Firefox 110 (2022) won't
show the preview correctly. PDF artwork previews need a current browser; older browsers
may show an outline while still allowing PDF export.

## Using it

All instructions for users (printing labels and envelopes, print alignment, limits,
saved settings and troubleshooting) are on the **Help** tab at the top of the app.

---

## For developers

Requires Node.js 22.23.3+ on the 22 line, 24.15.0+ on the 24 line, or 26+ (see `.nvmrc`).
Run `npm run check:node` to verify the runtime, documented minimum and locked dependency engines.

    npm install
    npm run dev            # local dev server on http://localhost:5173
    npm test               # unit + jsdom tests
    npm run format:check   # prettier
    npm run build          # dist/ for hosting
    npm run build:single   # dist-single/mailroom.html, one self-contained file

**Hosting `dist/`:** copy the folder to any web server. It uses relative paths, so any
sub-folder works. Serve it over **HTTPS**: unlocking password-protected spreadsheets
needs the browser's Web Crypto API, which browsers only provide on HTTPS, `localhost`
and local files. Don't share the dev server over plain `http://` on the network.

**The single file:** `npm run build:single` inlines all scripts, styles and fonts into
`dist-single/mailroom.html` (about 4.5 MB, including pdf.js for the design preview). Copy that one file to the shared drive.
Opened from disk it runs as a local file, which Chrome and Edge treat as secure, so
password unlocking and saved settings work there too. Rebuild and replace it after
each change.

**User help:** the Help tab is `src/help.js`. Update it when behaviour changes, and replace
the `<TEAMS-CHANNEL-OR-CONTACT>` placeholder in `CONTACT` before sharing a build.

The SheetJS `xlsx` package is vendored in `vendor/` (it's not published to npm).
Label and envelope dimensions live in `formats` in `src/layout.js`; add a new label
stock there.

**Your own design** (mailers, badges): `src/design.js` reads the PDF or image (page boxes,
rotation, bleed), draws the PDF (each design page is embedded once and reused on every
record) and reads and writes `.mailroom` project files. `src/designer.js` is its part of the
page: cards, text box editor, preview and dragging. `src/pdfpreview.js` draws design pages
for the preview with pdf.js, which is only loaded when a PDF design is chosen; the
single-file build inlines its worker. The window envelope preset is `WINDOW_BOX` in
`src/design.js`. `node samples/make-design-samples.mjs` makes sample designs.
