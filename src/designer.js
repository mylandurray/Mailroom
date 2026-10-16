// The "Your own design" format: cards for the design and its text boxes, the preview with
// draggable boxes, and the PDF. main.js hands in what it shares through ctx.
import {
  BASELINE,
  PT,
  blockItems,
  checkBlocks,
  missingChar,
  pageSizeName,
  placeLines,
} from "./layout.js";
import {
  MAX_BLOCKS,
  MAX_BLOCK_LINES,
  MAX_DESIGN_BYTES,
  WINDOW_BOX,
  buildDesignPdf,
  columnIndex,
  columnRef,
  fitPages,
  imageSizes,
  newBlock,
  pageSize,
  projectFile,
  recordPageCount,
  readDesign,
  readProject,
} from "./design.js";
import { forget, renderPage } from "./pdfpreview.js";
import { autoMap } from "./sheet.js";

const MAX_RECORD_PAGES = 20000;
const MAX_PROJECT_BYTES = 30 * 1024 * 1024;
const MIN_SIZE = 8; // pt; below this addresses are hard to read and to sort by machine
const PREVIEW_PIXELS = 1400;
const roles = [
  ["address", "Address"],
  ["name", "Name"],
  ["organisation", "Organisation"],
  ["text", "Other text"],
];
// Pages this small are badges or cards, which start with a name rather than an address.
const small = (page) => page.width < 150 && page.height < 150;

export function createDesigner(ctx) {
  const { $, state, escape, message, flagIncomplete, count } = ctx;
  let design = null;
  let loading = 0;
  let customImageSize = false;
  const settings = {
    textPage: 0,
    pages: [0],
    printArtwork: true,
    duplex: false,
    imageSize: { width: 210, height: 297 },
    blocks: [],
  };
  const open = new Set(); // ids of the text box panels the user has expanded
  let artwork = null; // { design, page, url } once the preview image of the text page is ready
  let artworkFailed = false;

  const active = () => $("format").value === "design";
  const page = () => design && pageSize(design, settings, settings.textPage);
  const base = (name) => String(name ?? "").replace(/\.[^.]+$/, "");
  const cqw = (mm) => `${(mm / page().width) * 100}cqw`;

  // Turns saved column references into this sheet's column numbers, dropping unknown ones.
  const resolve = (block) => ({
    ...block,
    fields: block.fields.map((line) =>
      line.map((ref) => columnIndex(state.headers, ref)).filter((i) => i >= 0),
    ),
  });
  const missingColumns = () =>
    state.headers.length
      ? [
          ...new Set(
            settings.blocks
              .filter((b) => b.source === "columns")
              .flatMap((b) => b.fields.flat())
              .filter((ref) => ref && columnIndex(state.headers, ref) < 0)
              .map((ref) => ref.name),
          ),
        ]
      : [];
  const mapped = (block) => block.source === "fixed" || block.fields.some((l) => l.some(Boolean));

  // Chooses columns for an unmapped box from the sheet's headings, by what the box is for.
  function autoFill(block) {
    const { headers } = state;
    if (!headers.length || mapped(block)) return;
    let lines = [];
    if (block.role === "address") lines = autoMap(headers, MAX_BLOCK_LINES);
    else if (block.role === "name") lines = autoMap(headers, 1).slice(0, 1);
    else if (block.role === "organisation") {
      const i = headers.findIndex((h) =>
        /organi[sz]ation|company|employer|business|firm|\borg\b/i.test(h),
      );
      if (i >= 0) lines = [[i]];
    }
    if (lines.length) block.fields = lines.map((line) => line.map((i) => columnRef(headers, i)));
    if (!block.fields.length) block.fields = [[]];
  }

  function startBlocks() {
    const p = page();
    settings.blocks = small(p)
      ? [newBlock("name", p), newBlock("organisation", p)]
      : [newBlock("address", p)];
    for (const block of settings.blocks) autoFill(block);
    open.clear();
    open.add(settings.blocks[0].id);
  }

  // ---- The design card ----

  async function setDesign(next, restored) {
    const before = design && page();
    forget(design);
    if (artwork?.design === design && design?.kind === "image") URL.revokeObjectURL(artwork.url);
    design = next;
    artwork = null;
    artworkFailed = false;
    const all = design.kind === "pdf" ? design.pages.map((_, i) => i) : [0];
    Object.assign(settings, fitPages(design, restored?.textPage ?? 0, restored?.pages ?? all));
    if (restored) {
      settings.printArtwork = restored.printArtwork;
      settings.duplex = restored.duplex;
      settings.imageSize = restored.imageSize;
      settings.blocks = restored.blocks;
      open.clear();
    } else if (design.kind === "image")
      // Portrait or landscape A4 to match the picture, until the user says otherwise.
      settings.imageSize =
        design.pixels.width > design.pixels.height
          ? { width: 297, height: 210 }
          : { width: 210, height: 297 };
    customImageSize =
      design.kind === "image" &&
      !imageSizes.some(
        ([, w, h]) =>
          (settings.imageSize.width === w && settings.imageSize.height === h) ||
          (settings.imageSize.width === h && settings.imageSize.height === w),
      );
    // A revised version of the same design keeps its boxes; a different size starts afresh.
    const after = page();
    if (
      !restored &&
      before &&
      (Math.abs(before.width - after.width) > 1 || Math.abs(before.height - after.height) > 1)
    )
      settings.blocks = [];
    if (!settings.blocks.length) startBlocks();
    for (const block of settings.blocks) autoFill(block);
    renderDesignCard();
    renderBlocks();
    drawArtwork();
    await ctx.update();
  }

  async function loadDesign(file) {
    if (!file) return;
    const current = ++loading;
    try {
      if (file.size > MAX_DESIGN_BYTES) throw Error("Please use a design file smaller than 20 MB.");
      message("Reading design…");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (current !== loading) return;
      const next = await readDesign(bytes, file.name);
      if (current !== loading) return;
      await setDesign(next);
    } catch (e) {
      if (current === loading) message(`Could not load design: ${e.message}`, true);
    } finally {
      if (current === loading) $("design-file").value = "";
    }
  }

  // Draws the text page for the preview: at once for images, via pdf.js for PDFs.
  function drawArtwork() {
    const current = design;
    const textPage = settings.textPage;
    if (!current) return;
    if (current.kind === "image") {
      const type = current.type === "png" ? "image/png" : "image/jpeg";
      artwork = {
        design: current,
        page: 0,
        url: URL.createObjectURL(new Blob([current.bytes], { type })),
      };
      return;
    }
    artwork = null;
    renderPage(current, textPage, PREVIEW_PIXELS).then(
      (url) => {
        if (design !== current || settings.textPage !== textPage) return;
        artwork = { design: current, page: textPage, url };
        if (active()) renderPaper();
      },
      (e) => {
        console.warn("Design preview unavailable", e);
        if (design !== current) return;
        artworkFailed = true;
        if (active()) renderPaper();
      },
    );
    // Page thumbnails for choosing which pages print.
    if (current.pages.length > 1)
      current.pages.forEach((_, i) =>
        renderPage(current, i, 160).then(
          (url) => {
            const img = design === current && document.querySelector(`[data-thumb="${i}"]`);
            if (img) img.src = url;
          },
          () => {},
        ),
      );
  }

  function renderDesignCard() {
    $("design-name").textContent = design?.name ?? "Choose your design";
    $("save-project").disabled = !design;
    $("add-block").disabled = !design || settings.blocks.length >= MAX_BLOCKS;
    $("print-artwork").checked = settings.printArtwork;
    $("design-duplex").checked = settings.duplex;
    $("design-options").hidden = !design;
    if (!design) {
      $("design-info").textContent = "";
      return;
    }
    const p = page();
    const pages = design.kind === "pdf" ? design.pages : [];
    const bled = pages.some((pg) => pg.bled);
    $("design-info").textContent = [
      design.kind === "pdf" ? count(pages.length, "page") : "Image",
      design.kind === "pdf" ? pageSizeName(p.width, p.height) : null,
      bled ? "bleed trimmed" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    $("design-pages").hidden = pages.length < 2;
    $("design-pages").innerHTML =
      pages.length < 2
        ? ""
        : `<p class="hint">Choose the page that gets the text, and which pages print for every record.</p>` +
          pages
            .map((pg, i) => {
              const text = i === settings.textPage;
              return `<div class="design-page">
          <img data-thumb="${i}" alt="">
          <div class="design-page-name"><strong>Page ${i + 1}</strong><span>${escape(pageSizeName(pg.width, pg.height))}</span></div>
          <label class="check"><input type="radio" name="text-page" value="${i}" ${text ? "checked" : ""}> Text</label>
          <label class="check"><input type="checkbox" data-print="${i}" ${settings.pages.includes(i) ? "checked" : ""} ${text ? "disabled" : ""}> Print</label>
        </div>`;
            })
            .join("");
    $("image-size-area").hidden = design.kind !== "image";
    if (design.kind === "image") {
      const { width, height } = settings.imageSize;
      const options = imageSizes.flatMap(([name, w, h]) =>
        w === h
          ? [[`${w}x${h}`, name]]
          : [
              [`${w}x${h}`, `${name} portrait`],
              [`${h}x${w}`, `${name} landscape`],
            ],
      );
      const value = `${width}x${height}`;
      const known = !customImageSize && options.some(([v]) => v === value);
      $("image-size").innerHTML =
        options
          .map(
            ([v, name]) =>
              `<option value="${v}" ${known && v === value ? "selected" : ""}>${name}</option>`,
          )
          .join("") + `<option value="custom" ${known ? "" : "selected"}>Custom size</option>`;
      $("image-custom").hidden = known;
      $("image-width").value = width;
      $("image-height").value = height;
      const ratio = design.pixels.width / design.pixels.height / (width / height);
      $("image-note").textContent =
        Math.abs(ratio - 1) > 0.02
          ? "The image's shape doesn't match this page size, so it will be stretched."
          : "";
    }
  }

  // ---- The text boxes card ----

  const summaryOf = (block) => {
    if (block.source === "fixed") return block.text.split("\n")[0] || "no text yet";
    const names = block.fields
      .flat()
      .filter(Boolean)
      .map((ref) => ref.name);
    return names.length ? names.join(", ") : "no columns yet";
  };

  function blockPanel(block, i) {
    const headerOptions = (ref) => {
      const selected = columnIndex(state.headers, ref);
      const lost =
        ref && selected < 0
          ? `<option value="lost" selected>${escape(ref.name)} (not in this sheet)</option>`
          : "";
      return (
        lost +
        state.headers
          .map(
            (h, j) =>
              `<option value="${j}" ${selected === j ? "selected" : ""}>${escape(h)}</option>`,
          )
          .join("")
      );
    };
    const option = (value, label, current) =>
      `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;
    const lines = block.fields
      .map(
        (line, j) => `<div class="map-line">
        <span>${j + 1}</span>
        <select aria-label="${escape(block.name)} line ${j + 1} column" data-line="${j}" data-slot="0"><option value="">Choose column</option>${headerOptions(line[0])}</select>
        <select aria-label="${escape(block.name)} line ${j + 1} second column" data-line="${j}" data-slot="1"><option value="">+ optional</option>${headerOptions(line[1])}</select>
        <button data-action="remove-line" data-line="${j}" aria-label="Remove ${escape(block.name)} line ${j + 1}">×</button>
      </div>`,
      )
      .join("");
    const number = (prop, label, value, attrs) =>
      `<label>${label}<input type="number" data-${prop} value="${value}" ${attrs}></label>`;
    return `<details class="block-panel" data-block="${i}" ${open.has(block.id) ? "open" : ""}>
      <summary><strong data-summary-name>${escape(block.name)}</strong> <span class="muted" data-summary-text>${escape(summaryOf(block))}</span></summary>
      <div class="block-body">
        <label>Box name<input data-prop="name" value="${escape(block.name)}" maxlength="40"></label>
        <label>Text<select data-prop="source">
          ${option("columns", "From spreadsheet columns", block.source)}
          ${option("fixed", "Same on every copy", block.source)}
        </select></label>
        ${
          block.source === "fixed"
            ? `<label>Lines <span class="muted">(one per line)</span><textarea data-prop="text" rows="3">${escape(block.text)}</textarea></label>`
            : state.headers.length
              ? `<div class="block-map">${lines}</div><button class="text-button" data-action="add-line" ${block.fields.length >= MAX_BLOCK_LINES ? "disabled" : ""}>+ Add line</button>`
              : `<p class="empty-note">Load a spreadsheet to choose columns.</p>`
        }
        <div class="two">
          ${number('prop="size"', "Text size (pt)", block.size, 'min="4" max="200" step="0.5"')}
          ${number('prop="minSize"', "Shrink to (pt)", block.minSize, 'min="4" max="200" step="0.5" title="Long text shrinks down to this size to fit the box"')}
        </div>
        <div class="two">
          <label>Across<select data-prop="align">
            ${option("left", "Left", block.align)}${option("center", "Centre", block.align)}${option("right", "Right", block.align)}
          </select></label>
          <label>Down<select data-prop="valign">
            ${option("top", "Top", block.valign)}${option("middle", "Middle", block.valign)}${option("bottom", "Bottom", block.valign)}
          </select></label>
        </div>
        <label class="check"><input type="checkbox" data-prop="bold" ${block.weight === "bold" ? "checked" : ""}> Bold</label>
        <p class="field-title spaced">Position <span class="muted">(mm from the page's top-left corner)</span></p>
        <div class="four">
          ${number('box="left"', "Left", block.box.left, 'step="0.5"')}
          ${number('box="top"', "Top", block.box.top, 'step="0.5"')}
          ${number('box="width"', "Width", block.box.width, 'min="1" step="0.5"')}
          ${number('box="height"', "Height", block.box.height, 'min="1" step="0.5"')}
        </div>
        ${block.role === "address" ? `<button class="text-button" data-action="window" title="DIN 5008: ${WINDOW_BOX.left} mm from the left, ${WINDOW_BOX.top} mm from the top, ${WINDOW_BOX.width} × ${WINDOW_BOX.height} mm. Check against your envelopes.">Move to window envelope position (C4 / C5)</button>` : ""}
        <button class="text-button remove" data-action="remove">Remove this box</button>
      </div>
    </details>`;
  }

  function renderBlocks() {
    $("blocks").innerHTML = design
      ? settings.blocks.map(blockPanel).join("") ||
        `<p class="empty-note">Add a text box to print on your design.</p>`
      : `<p class="empty-note">Choose your design first.</p>`;
    $("add-block").disabled = !design || settings.blocks.length >= MAX_BLOCKS;
  }

  function syncBoxInputs(b) {
    const panel = $("blocks").querySelector(`[data-block="${b}"]`);
    if (!panel) return;
    for (const [key, value] of Object.entries(settings.blocks[b].box))
      panel.querySelector(`[data-box="${key}"]`).value = value;
  }

  function onBlockInput(e) {
    const panel = e.target.closest("[data-block]");
    if (!panel) return;
    const b = Number(panel.dataset.block);
    const block = settings.blocks[b];
    const { prop, box, line, slot } = e.target.dataset;
    if (box) block.box[box] = e.target.value === "" ? NaN : Number(e.target.value);
    else if (prop === "size" || prop === "minSize")
      block[prop] = e.target.value === "" ? NaN : Number(e.target.value);
    else if (prop === "name") {
      block.name = e.target.value;
      panel.querySelector("[data-summary-name]").textContent = block.name;
    } else if (prop === "text") block.text = e.target.value;
    else if (prop === "bold") block.weight = e.target.checked ? "bold" : "regular";
    else if (prop === "align" || prop === "valign") block[prop] = e.target.value;
    else if (prop === "source") {
      block.source = e.target.value;
      if (block.source === "columns" && !block.fields.length) block.fields = [[]];
      renderBlocks();
    } else if (line !== undefined) {
      if (e.target.value === "lost") return;
      const i = e.target.value === "" ? null : Number(e.target.value);
      block.fields[Number(line)][Number(slot)] = i === null ? null : columnRef(state.headers, i);
    } else return;
    const summary = panel.querySelector("[data-summary-text]");
    if (summary) summary.textContent = summaryOf(block);
    ctx.update();
  }

  function onBlockClick(e) {
    const button = e.target.closest("[data-action]");
    const panel = button?.closest("[data-block]");
    if (!panel) return;
    const b = Number(panel.dataset.block);
    const block = settings.blocks[b];
    const action = button.dataset.action;
    if (action === "add-line") block.fields.push([]);
    else if (action === "remove-line") block.fields.splice(Number(button.dataset.line), 1);
    else if (action === "window") block.box = { ...WINDOW_BOX };
    else if (action === "remove") settings.blocks.splice(b, 1);
    renderBlocks();
    ctx.update();
  }

  function addBlock(role) {
    if (!design || !role || settings.blocks.length >= MAX_BLOCKS) return;
    const block = newBlock(role, page());
    autoFill(block);
    settings.blocks.push(block);
    open.add(block.id);
    renderBlocks();
    ctx.update();
  }

  // ---- Checking and preview ----

  function checkSettings(forSave = false) {
    if (design.kind === "image") {
      const { width, height } = settings.imageSize;
      if (!(width >= 10 && width <= 2000 && height >= 10 && height <= 2000))
        throw Error("Enter a page size between 10 and 2000 mm.");
    }
    if (!forSave && !settings.blocks.length) throw Error("Add a text box to print on your design.");
    for (const block of settings.blocks) {
      const name = `the ${block.name || "unnamed"} box`;
      if (!(block.size >= 4 && block.size <= 200))
        throw Error(`Enter a text size between 4 and 200 pt for ${name}.`);
      if (!(block.minSize >= 4 && block.minSize <= 200))
        throw Error(`Enter a smallest size between 4 and 200 pt for ${name}.`);
      const { left, top, width, height } = block.box;
      if (![left, top, width, height].every(Number.isFinite) || width < 1 || height < 1)
        throw Error(`Enter a position and a size of at least 1 mm for ${name}.`);
    }
  }

  async function update(currentUpdate) {
    const generation = loading;
    const isCurrent = () => generation === loading && currentUpdate();
    state.ready = false;
    try {
      if (!design) {
        Object.assign(state, { config: null, pages: [], fits: [], page: 0 });
        stats(0, 0);
        flagIncomplete(0);
        message("Choose your design: a PDF, PNG or JPEG file.");
        renderPaper();
        return;
      }
      checkSettings();
      const blocks = settings.blocks.map(resolve);
      const records = blockItems(state.rows, blocks);
      const pages = records.length * recordPageCount(settings);
      if (settings.duplex) {
        const sizes = settings.pages.map((i) => pageSize(design, settings, i));
        if (
          sizes.some(
            (p) =>
              Math.abs(p.width - sizes[0].width) > 0.1 ||
              Math.abs(p.height - sizes[0].height) > 0.1,
          )
        )
          throw Error(
            "For duplex printing, choose pages with the same paper size and orientation.",
          );
      }
      if (pages > MAX_RECORD_PAGES)
        throw Error(`Limit each export to ${MAX_RECORD_PAGES.toLocaleString()} pages.`);
      const weights = [...new Set(blocks.map((b) => b.weight))];
      const loaded = await Promise.all(weights.map((w) => ctx.getMeasure(w)));
      if (!isCurrent()) return;
      const measures = Object.fromEntries(weights.map((w, i) => [w, loaded[i]]));
      const checks = checkBlocks(records, blocks, (text, size, w) =>
        measures[w].measure(text, size),
      );
      const missing = new Map();
      for (const record of records)
        record.blocks.forEach((lines, b) => {
          const char = lines.length ? missingChar(lines, measures[blocks[b].weight].hasChar) : null;
          if (char && !missing.has(lines)) missing.set(lines, { char, record });
        });

      const problems = [];
      if (missing.size) {
        const [{ char, record }] = missing.values();
        problems.push(`Row ${ctx.rowNumber(record)} ${ctx.cantPrint(char)}`);
      }
      blocks.forEach((block, b) => {
        const failing = records.filter(
          (r) =>
            r.blocks[b].length && !checks[b].fits.has(r.blocks[b]) && !missing.has(r.blocks[b]),
        );
        if (!failing.length) return;
        const more = failing.length > 1 ? ` (and ${count(failing.length - 1, "more row")})` : "";
        problems.push(
          `Row ${ctx.rowNumber(failing[0])}${more} doesn't fit the ${block.name} box. Make the box bigger, lower "Shrink to" or shorten the text.`,
        );
      });

      Object.assign(state, {
        config: { settings: { ...settings, blocks }, measures },
        fits: checks.map((c) => c.fits),
        missing,
        pages: records,
      });
      state.page = Math.min(state.page, Math.max(0, records.length - 1));
      stats(records.length, pages);
      flagIncomplete(
        records.filter((r) => r.incomplete).length,
        records.flatMap((r, i) => (r.incomplete ? [i] : [])),
        "record",
      );

      if (problems.length) message(problems.join(" "), true);
      else {
        const notes = [];
        if (!state.rows.length) notes.push("Load a spreadsheet to fill the text boxes.");
        else {
          if (!blocks.some((b) => b.source === "fixed" || b.fields.some((l) => l.length)))
            notes.push("Choose the columns for each text box.");
          const omitted = state.rows.length - records.length;
          if (omitted && records.length) notes.push(`${count(omitted, "empty row")} omitted.`);
        }
        const lost = missingColumns();
        if (lost.length)
          notes.push(`Not in this spreadsheet: ${lost.join(", ")}. Choose other columns for them.`);
        const tiny = records.filter((r) =>
          blocks.some(
            (b, i) => b.role === "address" && checks[i].fits.get(r.blocks[i])?.size < MIN_SIZE,
          ),
        ).length;
        if (tiny)
          notes.push(
            `${count(tiny, "address", "addresses")} shrunk below ${MIN_SIZE} pt — check the preview.`,
          );
        const p = page();
        const off = settings.blocks.filter(
          ({ box }) =>
            box.left < 0 ||
            box.top < 0 ||
            box.left + box.width > p.width ||
            box.top + box.height > p.height,
        );
        if (off.length)
          notes.push(`The ${off.map((b) => b.name).join(", ")} box runs off the page.`);
        message(notes.join(" "));
      }
      state.ready = records.length > 0 && !problems.length;
      $("download").disabled = ctx.isBuilding() || !state.ready;
      renderPaper();
    } catch (e) {
      if (!isCurrent()) return;
      message(e.message, true);
      flagIncomplete(0);
      renderPaper();
    }
  }

  function stats(records, pages) {
    $("count").textContent = records.toLocaleString();
    $("count-unit").textContent = records === 1 ? "record" : "records";
    $("labels").textContent = pages.toLocaleString();
    $("labels-unit").textContent = pages === 1 ? "page" : "pages";
  }

  function renderPaper() {
    const paper = $("paper").parentElement;
    const p = page() ?? { width: 210, height: 297 };
    paper.style.aspectRatio = `${p.width}/${p.height}`;
    paper.classList.toggle("landscape", p.width > p.height);
    $("prev").disabled = state.page === 0;
    $("next").disabled = state.page >= state.pages.length - 1;
    if (!design) {
      $("paper").innerHTML = `<div class="artwork-note">Your design will appear here</div>`;
      $("page-label").textContent = "";
      return;
    }
    const cfg = state.config?.settings;
    const shift = cfg ? `transform:translate(${cqw(cfg.x)},${cqw(cfg.y)})` : "";
    let html = "";
    if (artwork?.design === design && artwork.page === settings.textPage)
      html += `<img class="artwork${settings.printArtwork ? "" : " unprinted"}" alt="" src="${artwork.url}" style="${settings.printArtwork ? shift : ""}">`;
    else
      html += `<div class="artwork-note">${
        artworkFailed
          ? "The design can't be shown in this browser, but it will be in the PDF."
          : "Drawing your design…"
      }</div>`;
    const record = state.pages[state.page];
    if (cfg && record)
      cfg.blocks.forEach((block, b) => {
        const lines = record.blocks[b];
        if (!lines?.length) return;
        const fit = state.fits[b]?.get(lines);
        const weight = block.weight === "bold" ? 700 : 400;
        if (!fit) {
          const { left, top, width, height } = block.box;
          html += `<div class="design-overflow" data-block="${b}" style="left:${cqw(left)};top:${cqw(top)};width:${cqw(width)};height:${cqw(height)};font-size:${cqw(block.size * PT)};font-weight:${weight};${shift}">${lines.map(escape).join("<br>")}</div>`;
          return;
        }
        const measure = state.config.measures[block.weight].measure;
        for (const line of placeLines(fit, block.box, block, measure))
          html += `<div class="design-line" data-block="${b}" style="left:${cqw(line.x)};top:${cqw(line.y - BASELINE * fit.size * PT)};font-size:${cqw(fit.size * PT)};font-weight:${weight};${shift}">${escape(line.text)}</div>`;
      });
    settings.blocks.forEach((block, b) => {
      const { left, top, width, height } = block.box;
      if (![left, top, width, height].every(Number.isFinite)) return;
      html += `<div class="block-guide" data-guide="${b}" title="${escape(block.name)}: drag to move" style="left:${cqw(left)};top:${cqw(top)};width:${cqw(width)};height:${cqw(height)};${shift}"><span class="guide-name">${escape(block.name)}</span><span class="handle" data-handle title="Drag to resize"></span></div>`;
    });
    $("paper").innerHTML = html;
    const n = state.pages.length;
    $("page-label").textContent = n
      ? `Record ${state.page + 1} of ${n.toLocaleString()}${settings.pages.length > 1 ? ` · page ${settings.pages.indexOf(settings.textPage) + 1} of ${settings.pages.length}` : ""}`
      : "Your records will appear here";
  }

  // Dragging a box moves it; dragging its corner resizes it. Both snap to 0.5 mm.
  function onPointerDown(e) {
    const guide = e.target.closest?.("[data-guide]");
    if (!guide || !design || e.button !== 0) return;
    e.preventDefault();
    const b = Number(guide.dataset.guide);
    const block = settings.blocks[b];
    const resize = !!e.target.closest("[data-handle]");
    const mmPerPx = page().width / $("paper").getBoundingClientRect().width;
    const start = { x: e.clientX, y: e.clientY, box: { ...block.box } };
    const snap = (n) => Math.round(n * 2) / 2;
    const texts = [...$("paper").querySelectorAll(`[data-block="${b}"]`)];
    const baseTransform = texts.map((el) => el.style.transform);
    const panel = $("blocks").querySelector(`[data-block="${b}"]`);
    if (panel) {
      open.add(block.id);
      panel.open = true;
    }
    guide.classList.add("dragging");
    guide.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      const dx = (ev.clientX - start.x) * mmPerPx;
      const dy = (ev.clientY - start.y) * mmPerPx;
      const box = resize
        ? {
            ...start.box,
            width: Math.max(1, snap(start.box.width + dx)),
            height: Math.max(1, snap(start.box.height + dy)),
          }
        : { ...start.box, left: snap(start.box.left + dx), top: snap(start.box.top + dy) };
      block.box = box;
      Object.assign(guide.style, {
        left: cqw(box.left),
        top: cqw(box.top),
        width: cqw(box.width),
        height: cqw(box.height),
      });
      if (!resize)
        texts.forEach((el, i) => {
          el.style.transform = `${baseTransform[i] || ""} translate(${cqw(box.left - start.box.left)},${cqw(box.top - start.box.top)})`;
        });
      syncBoxInputs(b);
    };
    const up = () => {
      guide.removeEventListener("pointermove", move);
      guide.removeEventListener("pointerup", up);
      guide.removeEventListener("pointercancel", up);
      guide.classList.remove("dragging");
      ctx.update();
    };
    guide.addEventListener("pointermove", move);
    guide.addEventListener("pointerup", up);
    guide.addEventListener("pointercancel", up);
  }

  // ---- Output ----

  async function download() {
    const cfg = state.config?.settings;
    if (ctx.isBuilding() || !state.ready || !cfg) return;
    ctx.setBuilding(true);
    message("Building PDF…");
    await new Promise((resolve) => setTimeout(resolve));
    try {
      const records = state.pages;
      const bytes = await buildDesignPdf({
        design,
        settings: cfg,
        records,
        fits: state.fits,
        measure: (w) => state.config.measures[w].measure,
        fontBytes: ctx.fontBytes,
      });
      ctx.saveFile(
        bytes,
        `${base(design.name) || "design"}-${ctx.timestamp()}.pdf`,
        "application/pdf",
      );
      const size = pageSizeName(page().width, page().height);
      message(
        `PDF ready: ${count(records.length * recordPageCount(cfg), "page")} (${size}). Print at Actual size (100%)${cfg.pages.length > 1 ? `, ${recordPageCount(cfg)} pages per record` : ""}${cfg.duplex ? ", double-sided; blank backs included where needed" : ", single-sided"}.`,
      );
    } catch (e) {
      message(e.message, true);
    } finally {
      ctx.setBuilding(false);
    }
  }

  function saveProject() {
    if (!design) return;
    try {
      checkSettings(true);
      const text = projectFile({
        design,
        // Older versions read copies from project files, so keep writing one.
        settings: { ...settings, copies: 1 },
        toBase64: ctx.toBase64,
      });
      readProject(text);
      ctx.saveFile(
        new TextEncoder().encode(text),
        `${base(design.name) || "design"}.mailroom`,
        "application/json",
      );
      message("Project saved. Open it next time to carry on with the same design and boxes.");
    } catch (e) {
      message(`Could not save project: ${e.message} Check the box positions and sizes.`, true);
    }
  }

  async function openProject(file) {
    if (!file) return;
    const current = ++loading;
    try {
      if (file.size > MAX_PROJECT_BYTES) throw Error("This project file is too large.");
      message("Opening project…");
      const content = await file.text();
      if (current !== loading) return;
      const project = readProject(content);
      let bytes;
      try {
        bytes = Uint8Array.from(atob(project.design.data), (c) => c.charCodeAt(0));
      } catch {
        throw Error("This isn't a Mailroom project file, or it is damaged.");
      }
      const next = await readDesign(bytes, project.design.name);
      if (current !== loading) return;
      if (!active()) ctx.setFormat("design");
      await setDesign(next, project.settings);
    } catch (e) {
      if (current === loading) message(`Could not open project: ${e.message}`, true);
    } finally {
      if (current === loading) $("project-file").value = "";
    }
  }

  // ---- Wiring ----

  function bind() {
    $("design-file").addEventListener("change", (e) => loadDesign(e.target.files[0]));
    ctx.dropZone($("design-drop"), loadDesign);
    // Typing updates as it goes; selects and checkboxes (which also fire input) on change.
    const choice = (e) => e.target.matches("select, input[type=checkbox]");
    $("blocks").addEventListener("input", (e) => choice(e) || onBlockInput(e));
    $("blocks").addEventListener("change", (e) => choice(e) && onBlockInput(e));
    $("blocks").addEventListener("click", onBlockClick);
    // toggle doesn't bubble, so listen while it travels down.
    $("blocks").addEventListener(
      "toggle",
      (e) => {
        const block = settings.blocks[Number(e.target.dataset?.block)];
        if (!block) return;
        if (e.target.open) open.add(block.id);
        else open.delete(block.id);
      },
      true,
    );
    $("add-block").addEventListener("change", (e) => {
      addBlock(e.target.value);
      e.target.value = "";
    });
    $("design-pages").addEventListener("change", (e) => {
      if (e.target.name === "text-page") {
        settings.textPage = Number(e.target.value);
        if (!settings.pages.includes(settings.textPage))
          Object.assign(settings, fitPages(design, settings.textPage, settings.pages));
        drawArtwork();
      } else if (e.target.dataset.print !== undefined) {
        const i = Number(e.target.dataset.print);
        const chosen = settings.pages.filter((p) => p !== i);
        if (e.target.checked) chosen.push(i);
        Object.assign(settings, fitPages(design, settings.textPage, chosen));
      } else return;
      renderDesignCard();
      drawArtwork();
      ctx.update();
    });
    $("image-size").addEventListener("change", (e) => {
      customImageSize = e.target.value === "custom";
      if (e.target.value !== "custom") {
        const [width, height] = e.target.value.split("x").map(Number);
        settings.imageSize = { width, height };
      }
      renderDesignCard();

      ctx.update();
    });
    for (const id of ["image-width", "image-height"])
      $(id).addEventListener("input", () => {
        settings.imageSize = {
          width: Number($("image-width").value),
          height: Number($("image-height").value),
        };
        renderDesignCard();
        ctx.update();
      });
    $("design-duplex").addEventListener("change", (e) => {
      settings.duplex = e.target.checked;
      ctx.update();
    });
    $("print-artwork").addEventListener("change", (e) => {
      settings.printArtwork = e.target.checked;
      ctx.update();
    });
    $("save-project").addEventListener("click", saveProject);
    $("open-project").addEventListener("click", () => $("project-file").click());
    $("project-file").addEventListener("change", (e) => openProject(e.target.files[0]));
    $("paper").addEventListener("pointerdown", (e) => active() && onPointerDown(e));
  }

  // Wording and visibility for the design format; main.js does the same for the others.
  function renderFormat() {
    renderDesignCard();
    renderBlocks();
  }

  // After a spreadsheet loads: fill any boxes that have no columns yet and show the new headings.
  function onSheet() {
    for (const block of settings.blocks) autoFill(block);
    renderBlocks();
  }

  const unmapped = () => !settings.blocks.some(mapped);

  return { active, bind, update, renderPaper, renderFormat, download, onSheet, unmapped };
}
