import { sheetPapers, sheetTemplates, labelPreset, centredMargins } from "./layout.js";

// The label preset editor: a form beside a drawing of the sheet that redraws as the user types.
// Each measurement has a lettered marker on the drawing and the same letter by its field;
// focusing a field highlights its marker, and clicking a marker focuses its field.

export const presetFields = [
  ...["name", "paper", "columns", "rows", "width", "height"],
  ...["left", "top", "columnGap", "rowGap", "padding"],
];
const mm = (n) => Math.round(n * 100) / 100;
const isCentred = (preset) => {
  const { left, top } = centredMargins(preset);
  return Math.abs(left - preset.left) < 0.01 && Math.abs(top - preset.top) < 0.01;
};

// The measurement lines on the drawing, in mm from the page's top-left corner. Widths chain
// along one line through the first row, heights down one line through the first column.
function dimensions({ columns, rows, width: w, height: h, left, top, columnGap, rowGap, padding }) {
  const across = top + h * 0.3;
  const down = left + w * 0.25;
  const dims = [
    ["left", "E", [0, across, left, across], [left / 2, across]],
    ["width", "A", [left, across, left + w, across], [left + w * 0.62, across]],
    ["top", "F", [down, 0, down, top], [down, top / 2]],
    ["height", "B", [down, top, down, top + h], [down, top + h * 0.65]],
    ["padding", "G", [left + w - padding, top + h / 2, left + w, top + h / 2], null],
  ];
  if (columns > 1)
    dims.push([
      "columnGap",
      "C",
      [left + w, across, left + w + columnGap, across],
      [left + w + columnGap / 2, across],
    ]);
  if (rows > 1)
    dims.push([
      "rowGap",
      "D",
      [down, top + h, down, top + h + rowGap],
      [down, top + h + rowGap / 2],
    ]);
  return dims;
}

export function createPresetEditor({ $ }) {
  let opener = null;
  let templateName = "";
  const input = (field) => $(`preset-${field}`);

  const numbers = () =>
    Object.fromEntries(
      presetFields.slice(2).map((field) => [field, Number(input(field).value.trim() || NaN)]),
    );

  // While "Centre" is ticked, the margins follow the rest of the sheet.
  function centre() {
    const centred = $("preset-centre").checked;
    for (const field of ["left", "top"]) input(field).readOnly = centred;
    if (!centred) return;
    const n = numbers();
    const needed = ["columns", "rows", "width", "height", "columnGap", "rowGap"];
    if (needed.some((field) => !Number.isFinite(n[field]))) return;
    const { left, top } = centredMargins({ ...n, paper: input("paper").value });
    input("left").value = Math.max(0, left);
    input("top").value = Math.max(0, top);
  }

  // The form as labelPreset takes it, with centred margins brought up to date.
  function read() {
    centre();
    return Object.fromEntries(presetFields.map((field) => [field, input(field).value.trim()]));
  }

  function draw(page, n, active) {
    const sheet = {
      columns: Math.min(Math.max(1, Math.floor(n.columns) || 1), 20),
      rows: Math.min(Math.max(1, Math.floor(n.rows) || 1), 40),
    };
    for (const field of ["width", "height", "left", "top", "columnGap", "rowGap", "padding"])
      sheet[field] = Math.max(0, Number.isFinite(n[field]) ? n[field] : 0);
    const { columns, rows, width: w, height: h, columnGap, rowGap, padding } = sheet;
    // The whole page, or while a measurement is highlighted, a close-up of the first labels
    // in the page's proportions, so the drawing doesn't change size.
    // The whole-page view grows to show labels that run off the page, up to twice its size.
    const extent = (start, count, size, gap) => start + count * size + (count - 1) * gap + 4;
    let view = {
      width: Math.min(
        2 * page.width,
        Math.max(page.width, extent(sheet.left, columns, w, columnGap)),
      ),
      height: Math.min(2 * page.height, Math.max(page.height, extent(sheet.top, rows, h, rowGap))),
    };
    if (active) {
      const across = sheet.left + Math.min(columns, 2) * w + columnGap + 8;
      const down = sheet.top + Math.min(rows, 2) * h + rowGap + 8;
      const scale = Math.min(1, Math.max(across / page.width, down / page.height, 0.3));
      view = { width: page.width * scale, height: page.height * scale };
    }
    const r = Math.min(view.width, view.height) * 0.026; // marker radius
    const edge = r * 1.4;
    let labels = "";
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const x = sheet.left + column * (w + columnGap);
        const y = sheet.top + row * (h + rowGap);
        const off = x + w > page.width + 0.01 || y + h > page.height + 0.01;
        labels += `<rect class="sheet-label${off ? " off" : ""}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(1.5, w / 8, h / 8)}"/>`;
      }
    const inset =
      w > 2 * padding && h > 2 * padding
        ? `<rect class="inset" x="${sheet.left + padding}" y="${sheet.top + padding}" width="${w - 2 * padding}" height="${h - 2 * padding}"/>`
        : "";
    const tick = r * 0.55;
    const dims = dimensions(sheet)
      .map(([field, key, [x1, y1, x2, y2], badge]) => {
        const flat = y1 === y2;
        const ticks = [
          [x1, y1],
          [x2, y2],
        ]
          .map(([x, y]) =>
            flat
              ? `<line x1="${x}" y1="${y - tick}" x2="${x}" y2="${y + tick}"/>`
              : `<line x1="${x - tick}" y1="${y}" x2="${x + tick}" y2="${y}"/>`,
          )
          .join("");
        const [bx, by] = badge ?? [x1 - r * 1.3, y1];
        // The highlighted measurement also shows its value beside its marker.
        const [vx, vy, anchor] = flat ? [bx, by - r * 1.9, "middle"] : [bx + r * 1.4, by, "start"];
        const value =
          field === active
            ? `<text class="value" x="${vx}" y="${vy}" style="text-anchor:${anchor}" font-size="${r * 1.3}">${mm(sheet[field])} mm</text>`
            : "";
        return `<g class="dim${field === active ? " on" : ""}" data-dim="${field}">
          <line class="measure" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>${ticks}
          <circle cx="${bx}" cy="${by}" r="${r}"/><text x="${bx}" y="${by}" font-size="${r * 1.2}">${key}</text>${value}</g>`;
      })
      .join("");
    const svg = $("preset-svg");
    svg.setAttribute(
      "viewBox",
      `${-edge} ${-edge} ${view.width + 2 * edge} ${view.height + 2 * edge}`,
    );
    svg.classList.toggle("focusing", Boolean(active));
    svg.innerHTML = `<rect class="page" width="${page.width}" height="${page.height}"/>${labels}${inset}${dims}`;
  }

  let active = null;
  function highlight(field) {
    if (field === active) return;
    active = field;
    draw(sheetPapers[input("paper").value], numbers(), active);
    for (const label of $("preset-form").querySelectorAll(".dim-field"))
      label.classList.toggle("on", label.dataset.dim === field);
  }

  // Redraws the sheet and says whether it fits, as the user types.
  function render() {
    const values = read();
    const page = sheetPapers[values.paper];
    const n = numbers();
    const count = n.columns * n.rows;
    $("preset-total").textContent =
      Number.isInteger(count) && count > 0
        ? `${count} label${count === 1 ? "" : "s"} per sheet`
        : "";
    draw(page, n, active);
    let error = "";
    try {
      labelPreset({ ...values, name: values.name || "-" });
    } catch (e) {
      error = e.message;
    }
    $("preset-error").textContent = error;
    if (error) {
      $("preset-fit").textContent = "";
      return;
    }
    const right = page.width - n.left - n.columns * n.width - (n.columns - 1) * n.columnGap;
    const bottom = page.height - n.top - n.rows * n.height - (n.rows - 1) * n.rowGap;
    $("preset-fit").textContent =
      `Fits on ${page.name}. Paper left over: ${mm(right)} mm at the right, ${mm(bottom)} mm at the bottom.`;
  }

  function fill(source) {
    for (const field of presetFields) input(field).value = source[field];
    $("preset-centre").checked = isCentred(source);
  }

  function useTemplate() {
    const template = sheetTemplates[Number($("preset-template").value)];
    if (!$("preset-template").value || !template) return;
    const name = input("name").value.trim();
    const keepName = name && name !== templateName;
    fill({ ...template, name: keepName ? name : template.name });
    templateName = template.name;
    render();
  }

  // Opens on a saved preset (editing is its key) or on a starting point for a new one.
  function open(source, editing = "") {
    opener = document.activeElement;
    templateName = "";
    fill(source);
    $("preset-template").value = "";
    $("preset-form").dataset.key = editing;
    $("preset-title").textContent = editing ? "Edit label preset" : "New Label Preset";
    $("preset-save").textContent = editing ? "Save changes" : "Save label preset";
    $("preset-form").hidden = false;
    highlight(null);
    render();
    input("name").focus();
  }

  function close() {
    if ($("preset-form").hidden) return;
    $("preset-form").hidden = true;
    opener?.focus?.();
    opener = null;
  }

  function bind() {
    const form = $("preset-form");
    form.addEventListener("input", (e) => e.target !== $("preset-template") && render());
    $("preset-paper").addEventListener("change", render);
    $("preset-centre").addEventListener("change", render);
    $("preset-template").addEventListener("change", useTemplate);
    $("preset-cancel").addEventListener("click", close);
    $("preset-close").addEventListener("click", close);
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
    // Focus moving to a measurement zooms in on it; anywhere else shows the whole sheet.
    form.addEventListener("focusin", (e) =>
      highlight(e.target.closest(".dim-field")?.dataset.dim ?? null),
    );
    form.addEventListener("focusout", (e) => {
      if (!form.contains(e.relatedTarget)) highlight(null);
    });
    // Hovering a marker only lights it and its field; redrawing would move it under the mouse.
    const svg = $("preset-svg");
    const hover = (field) => {
      for (const g of svg.querySelectorAll(".dim"))
        g.classList.toggle("on", g.dataset.dim === (field ?? active));
      svg.classList.toggle("focusing", Boolean(field ?? active));
      for (const label of form.querySelectorAll(".dim-field"))
        label.classList.toggle("on", label.dataset.dim === (field ?? active));
    };
    svg.addEventListener("mouseover", (e) => hover(e.target.closest?.(".dim")?.dataset.dim));
    svg.addEventListener("mouseleave", () => hover(null));
    // Keeps focus (and so the drawing) still until the click lands on a marker.
    svg.addEventListener("mousedown", (e) => e.preventDefault());
    svg.addEventListener("click", (e) => {
      const dim = e.target.closest?.(".dim");
      if (dim) input(dim.dataset.dim).focus();
    });
  }

  return { bind, open, close, read };
}
