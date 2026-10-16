import { formats, sheetPapers, sheetTemplates } from "./layout.js";
import { helpTemplate } from "./help.js";

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
// The "Layout Preset" choices: built-in formats, then the user's saved label presets by key.
export const formatOptions = (presets = []) =>
  Object.entries(formats)
    .map(([key, format]) => `<option value="${key}">${format.name}</option>`)
    .join("")
    .concat(
      presets.length
        ? `<optgroup label="Your label presets">${presets
            .map(([key, format]) => `<option value="${key}">${escape(format.name)}</option>`)
            .join("")}</optgroup>`
        : "",
    )
    .concat(`<option value="design">Your own design (mailer, badge…)</option>`)
    .concat(`<option value="new">+ New label preset…</option>`);

const paperOptions = Object.entries(sheetPapers)
  .map(([key, paper]) => `<option value="${key}">${paper.name}</option>`)
  .join("");
// Common sheets by paper, valued by their index in sheetTemplates.
const templateOptions = Object.entries(sheetPapers)
  .map(([paper, { name }]) => {
    const options = sheetTemplates
      .map((t, i) => [t, i])
      .filter(([t]) => t.paper === paper)
      .map(([t, i]) => `<option value="${i}">${t.name} · ${t.columns * t.rows} per sheet</option>`)
      .join("");
    return options ? `<optgroup label="${name.split(" ")[0]}">${options}</optgroup>` : "";
  })
  .join("");
// A measurement drawn on the sheet diagram, keyed by the same letter as its marker there.
const mmInput = (id, key, label, max = 300) =>
  `<label class="dim-field" data-dim="${id}"><span class="dim-key" aria-hidden="true">${key}</span><span class="dim-name">${label}</span>
    <span class="unit-input"><input id="preset-${id}" type="number" min="0" max="${max}" step="0.05" required><span aria-hidden="true">mm</span></span></label>`;
const step = (n, title, body) =>
  `<fieldset class="preset-step"><legend><b>${n}</b> ${title}</legend>${body}</fieldset>`;

export const template = `
<header class="topbar">
  <div class="topbar-inner">
    <div class="app-lockup">
      <span class="app-mark" aria-hidden="true"></span>
      <span class="app-name">Mailroom<small>Labels &amp; envelopes</small></span>
    </div>
    <nav class="tabs" aria-label="Sections">
      <a href="#print" id="tab-print" aria-current="page">Print</a>
      <a href="#help" id="tab-help">Help</a>
    </nav>
    <section class="print-bar" id="print-bar" aria-label="Print settings">
      <button class="text-button" id="forget" title="Clear the column choices, return address, format, label sheets and spreadsheet presets saved in this browser">Forget saved settings</button>
      <button id="download" class="primary" disabled>Download PDF</button>
    </section>
  </div>
</header>
<form id="preset-form" class="preset-overlay" hidden novalidate role="dialog" aria-modal="true" aria-labelledby="preset-title">
  <div class="preset-dialog">
    <div class="preset-head">
      <div>
        <h2 id="preset-title">New Label Preset</h2>
        <p class="hint">Describe your label sheet and check it against the drawing. Lengths are in mm.</p>
      </div>
      <button type="button" class="preset-close" id="preset-close" aria-label="Close">×</button>
    </div>
    <div class="preset-body">
      <figure class="preset-diagram">
        <svg id="preset-svg" class="preset-svg" role="img" aria-label="Drawing of the label sheet"></svg>
        <figcaption>
          <p class="preset-fit" id="preset-fit" aria-live="polite"></p>
          <p class="preset-error" id="preset-error" role="alert"></p>
        </figcaption>
      </figure>
      <div class="preset-fields">
        <label class="preset-start">Start from a common sheet <span class="muted">(fills in everything below)</span>
          <select id="preset-template"><option value="">Choose a sheet…</option>${templateOptions}</select></label>
        ${step(
          1,
          "Name and paper",
          `<div class="preset-pair">
            <label>Name<input id="preset-name" type="text" maxlength="60" required placeholder="e.g. Avery L7163"></label>
            <label>Paper<select id="preset-paper">${paperOptions}</select></label>
          </div>`,
        )}
        ${step(
          2,
          "Labels on the sheet",
          `<div class="preset-pair">
            <label>Across <span class="muted">(columns)</span><input id="preset-columns" type="number" min="1" max="20" step="1" required></label>
            <label>Down <span class="muted">(rows)</span><input id="preset-rows" type="number" min="1" max="40" step="1" required></label>
          </div>
          <p class="preset-total" id="preset-total"></p>`,
        )}
        ${step(
          3,
          "Size of one label",
          `<div class="preset-pair">${mmInput("width", "A", "Width")}${mmInput("height", "B", "Height")}</div>`,
        )}
        ${step(
          4,
          "Gaps between labels",
          `<div class="preset-pair">${mmInput("columnGap", "C", "Across", 50)}${mmInput("rowGap", "D", "Down", 50)}</div>
          <p class="hint">Labels that touch have a gap of 0. If the packet gives a <em>pitch</em>, the gap is the pitch minus the label size.</p>`,
        )}
        ${step(
          5,
          "Position on the page",
          `<label class="check"><input type="checkbox" id="preset-centre"> Centre the labels on the page <span class="muted">(most sheets)</span></label>
          <div class="preset-pair">${mmInput("left", "E", "Left margin")}${mmInput("top", "F", "Top margin")}</div>
          <p class="hint">Measured from the edge of the paper to the edge of the first label.</p>`,
        )}
        ${step(
          6,
          "Text",
          `<div class="preset-pair">${mmInput("padding", "G", "Space inside label", 10)}</div>
          <p class="hint">Keeps the address clear of the label's edges. 2–3 mm suits most labels.</p>`,
        )}
      </div>
    </div>
    <div class="preset-foot">
      <button type="button" class="text-button" id="preset-cancel">Cancel</button>
      <button type="submit" class="primary" id="preset-save">Save label preset</button>
    </div>
  </div>
</form>
<main>
  <section class="load-bar" id="load-bar" aria-label="Spreadsheet">
    <h2><b>01</b> Spreadsheet</h2>
    <label class="drop" id="drop" for="file" title="Excel (.xlsx, .xls), OpenDocument (.ods) or CSV">
      <span class="upload-icon" aria-hidden="true">↥</span>
      <strong id="filename">Choose a spreadsheet</strong>
      <span>or drop it here</span>
      <input id="file" type="file" accept=".xlsx,.xlsm,.xls,.ods,.csv,.tsv">
    </label>
    <button class="text-button" id="demo">Load sample addresses</button>
    <div id="sheet-area" class="load-group" hidden>
      <label class="inline-field">Worksheet<select id="sheet"></select></label>
      <label class="check"><input type="checkbox" id="has-header" checked> First row contains column headings</label>
    </div>
    <label id="skip-area" class="inline-field" title="For partly used sheets: the first empty label">Start at label<select id="skip"></select></label>
    <p class="sheet-notes" id="sheet-notes"></p>
    <form id="password-area" class="password" hidden>
      <p class="hint">This spreadsheet is password-protected. It is unlocked on this computer and the password is not saved.</p>
      <label>Password<input id="password" type="password" autocomplete="off" required></label>
      <div class="password-actions">
        <button type="submit" class="primary" id="unlock">Unlock</button>
        <button type="button" class="text-button" id="password-cancel">Cancel</button>
      </div>
    </form>
  </section>
  <div class="workspace" id="print-view">
    <aside class="setup-side">
      <section class="card" id="design-card" hidden>
        <h2><b>02</b> Design</h2>
        <label class="drop" id="design-drop" for="design-file">
          <span class="upload-icon">↥</span>
          <strong id="design-name">Choose your design</strong>
          <span>or drop it here · .pdf, .png, .jpg</span>
          <input id="design-file" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg">
        </label>
        <p class="hint design-info" id="design-info"></p>
        <div id="design-options" hidden>
          <div id="design-pages" hidden></div>
          <div id="image-size-area" hidden>
            <label>Page size<select id="image-size"></select></label>
            <div class="two" id="image-custom" hidden>
              <label>Width (mm)<input id="image-width" type="number" min="10" max="2000" step="0.5"></label>
              <label>Height (mm)<input id="image-height" type="number" min="10" max="2000" step="0.5"></label>
            </div>
            <p class="hint" id="image-note"></p>
          </div>
          <label class="check"><input type="checkbox" id="design-duplex"> Double-sided printing (add blank backs between records)</label>
          <p class="hint">Duplex pages must use the same paper size and orientation. Enable double-sided printing in your PDF viewer too.</p>
          <label class="check"><input type="checkbox" id="print-artwork" checked> Print the design <span class="muted">(untick for pre-printed paper)</span></label>
        </div>
        <div class="project-actions">
          <button class="text-button" id="open-project">Open project…</button>
          <button class="text-button" id="save-project" disabled title="Save the design and its text boxes to a file, to print them again later">Save project</button>
          <input id="project-file" type="file" accept=".mailroom,.labelgen,application/json" hidden>
        </div>
      </section>
      <section class="card" id="mapping-card">
        <h2><b>02</b> Address lines</h2>
        <label id="size-area" class="inline-field">Text size<select id="size">
          <option value="10">10 pt</option>
          <option value="11" selected>11 pt</option>
          <option value="12">12 pt</option>
          <option value="14">14 pt</option>
          <option value="16">16 pt</option>
        </select></label>
        <label id="map-preset-area">Spreadsheet Preset
          <select id="map-preset"><option value="">None</option></select></label>
        <p class="hint" id="map-preset-note" hidden></p>
        <div class="preset-actions" id="map-preset-actions">
          <button class="text-button" id="map-preset-save" disabled>Save as preset…</button>
          <button class="text-button" id="map-preset-update" hidden>Update preset</button>
          <button class="text-button" id="map-preset-delete" hidden>Delete</button>
        </div>
        <p class="hint">Select a column for each line. Select two columns to combine them (e.g. first and last name).</p>
        <div id="mapping"><p class="empty-note">Your spreadsheet columns will appear here.</p></div>
        <button id="add-line" class="text-button" disabled>+ Add address line</button>
        <details id="sample" class="sample" open hidden>
          <summary>What's in each column</summary>
          <div class="sample-scroll"><table id="sample-table"></table></div>
        </details>
      </section>
    </aside>

    <section class="preview-panel">
      <div class="preview-heading">
        <div class="preview-title">
          <h2>Print Preview</h2>
          <div class="stats">
            <span><strong id="count">0</strong> <span id="count-unit">addresses</span></span>
            <span><strong id="labels">0</strong> <span id="labels-unit">labels</span></span>
            <span id="sheets-stat"><strong id="sheets">0</strong> sheets</span>
          </div>
        </div>
        <div class="format-group">
          <div class="preset-actions" id="preset-actions">
            <button class="text-button" id="preset-edit" hidden>Edit</button>
            <button class="text-button" id="preset-delete" hidden>Delete</button>
          </div>
          <label class="format-pick">Layout Preset<select id="format">${formatOptions()}</select></label>
        </div>
      </div>
      <div id="warning" class="warning" role="alert" hidden>
        <span class="warning-icon" aria-hidden="true">!</span>
        <p><strong id="warning-title"></strong> <span id="warning-text"></span></p>
        <div class="warning-actions">
          <button class="warning-jump" id="warning-jump"></button>
          <button class="warning-ack" id="warning-ack">Acknowledge</button>
        </div>
      </div>
      <nav class="page-bar" aria-label="Pages">
        <button id="prev" aria-label="Previous page" disabled>←</button>
        <span id="page-label"></span>
        <button id="next" aria-label="Next page" disabled>→</button>
      </nav>
      <div id="status" role="status" aria-live="polite"></div>
      <div class="paper-wrap"><div class="paper"><div id="paper" class="sheet"></div></div></div>
    </section>

    <aside class="detail-side">
      <section class="card" id="blocks-card" hidden>
        <h2><b>03</b> Text boxes</h2>
        <p class="hint">Drag a box on the preview to move it, or its corner to resize it.</p>
        <div id="blocks"></div>
        <select id="add-block" class="add-block" aria-label="Add a text box" disabled>
          <option value="">+ Add text box…</option>
          <option value="address">Address</option>
          <option value="name">Name</option>
          <option value="organisation">Organisation</option>
          <option value="text">Other text</option>
        </select>
      </section>

      <section class="card" id="envelope-card" hidden>
        <h2><b>03</b> Envelope extras</h2>
        <p class="field-title">Ceadúnas <span class="muted">(PNG or JPEG, printed top right)</span></p>
        <label class="drop" id="licence-drop" for="licence-file">
          <span class="upload-icon">↥</span>
          <strong id="licence-name">Choose an image</strong>
          <span>or drop it here · .png, .jpg</span>
          <input id="licence-file" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg">
        </label>
        <div class="licence-actions">
          <button class="text-button" id="licence-remove" hidden>Remove ceadúnas</button>
        </div>
        <label class="spaced">Return address <span class="muted">(printed top left)</span><select id="sender-mode">
          <option value="none">None</option>
          <option value="fixed">Same on every envelope</option>
          <option value="sheet">From spreadsheet columns</option>
        </select></label>
        <label id="sender-fixed-area" hidden>Return address lines <span class="muted">(one per line)</span><textarea id="sender-text" rows="4"></textarea></label>
        <div id="sender-sheet-area" hidden>
          <p class="hint">Select a column for each return address line.</p>
          <div id="sender-mapping"><p class="empty-note">Load a spreadsheet to choose columns.</p></div>
          <button id="add-sender-line" class="text-button" disabled>+ Add return address line</button>
        </div>
      </section>
    </aside>
  </div>
  <div id="help-view" hidden>${helpTemplate}</div>
</main>`;
