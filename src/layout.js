// All lengths in mm. Each format is a page holding a grid of address areas.
export const formats = {
  labels: {
    name: "21-up A4 labels · 63.5 × 38.1 mm",
    kind: "labels",
    page: { width: 210, height: 297, name: "A4 portrait" },
    width: 63.5,
    height: 38.1,
    left: 7.25,
    top: 15.15,
    columnGap: 2.5,
    rowGap: 0,
    padding: 3,
    columns: 3,
    rows: 7,
  },
  c5: {
    name: "C5 envelope · 229 × 162 mm",
    kind: "envelopes",
    // Address sits in the lower right half, clear of the stamp and postmark area.
    page: { width: 229, height: 162, name: "C5 landscape" },
    // Ceadúnas image anchored to the top right corner; return address in the top left.
    licence: { right: 10, top: 10, width: 45, height: 30 },
    sender: { left: 10, top: 10, width: 80, height: 30 },
    width: 115,
    height: 80,
    left: 100,
    top: 60,
    columnGap: 0,
    rowGap: 0,
    padding: 0,
    columns: 1,
    rows: 1,
  },
  c4: {
    name: "C4 envelope · 324 × 229 mm",
    kind: "envelopes",
    page: { width: 324, height: 229, name: "C4 landscape" },
    licence: { right: 12, top: 12, width: 50, height: 35 },
    sender: { left: 12, top: 12, width: 100, height: 36 },
    width: 150,
    height: 100,
    left: 150,
    top: 90,
    columnGap: 0,
    rowGap: 0,
    padding: 0,
    columns: 1,
    rows: 1,
  },
};
// Paper a saved label sheet can be printed on, in mm.
export const sheetPapers = {
  a4: { width: 210, height: 297, name: "A4 portrait" },
  a4l: { width: 297, height: 210, name: "A4 landscape" },
  letter: { width: 215.9, height: 279.4, name: "Letter portrait" },
  a5: { width: 148, height: 210, name: "A5 portrait" },
};
const mm = (n) => Math.round(n * 100) / 100;
// Checks a label sheet the user described and turns it into a format; throws a message
// naming the first problem. Lengths in mm, as in formats.labels.
export function labelPreset(input) {
  const name = String(input.name ?? "").trim();
  if (!name) throw Error("Give the preset a name.");
  if (name.length > 60) throw Error("Use a name of at most 60 characters.");
  const page = sheetPapers[input.paper];
  if (!page) throw Error("Choose the paper size.");
  const number = (key, label, min, max, whole = false) => {
    const n = Number(input[key]);
    if (input[key] === "" || input[key] == null || !Number.isFinite(n) || n < min || n > max)
      throw Error(`Enter a value between ${min} and ${max} for ${label}.`);
    if (whole && !Number.isInteger(n))
      throw Error(`${label[0].toUpperCase()}${label.slice(1)} must be a whole number.`);
    return n;
  };
  const preset = {
    name,
    paper: input.paper,
    columns: number("columns", "columns", 1, 20, true),
    rows: number("rows", "rows", 1, 40, true),
    width: number("width", "label width", 10, page.width),
    height: number("height", "label height", 5, page.height),
    left: number("left", "the left margin", 0, page.width),
    top: number("top", "the top margin", 0, page.height),
    columnGap: number("columnGap", "the gap between columns", 0, 50),
    rowGap: number("rowGap", "the gap between rows", 0, 50),
    padding: number("padding", "the space inside each label", 0, 10),
  };
  const across =
    preset.left + preset.columns * preset.width + (preset.columns - 1) * preset.columnGap;
  const down = preset.top + preset.rows * preset.height + (preset.rows - 1) * preset.rowGap;
  if (across > page.width + 0.01)
    throw Error(
      `The labels run ${mm(across - page.width)} mm off the right of the page. Reduce the width, gap, margin or columns.`,
    );
  if (down > page.height + 0.01)
    throw Error(
      `The labels run ${mm(down - page.height)} mm off the bottom of the page. Reduce the height, gap, margin or rows.`,
    );
  if (2 * preset.padding >= Math.min(preset.width, preset.height) - 3)
    throw Error("The space inside each label leaves no room for text. Make it smaller.");
  return preset;
}
// The format a saved label sheet prints with.
export const presetFormat = (preset) => ({
  ...preset,
  name: `${preset.name} · ${preset.columns * preset.rows}-up · ${mm(preset.width)} × ${mm(preset.height)} mm`,
  kind: "labels",
  page: sheetPapers[preset.paper],
  custom: true,
});
// Margins that put the grid in the middle of the page.
export function centredMargins({ paper, columns, rows, width, height, columnGap, rowGap }) {
  const page = sheetPapers[paper];
  return {
    left: mm((page.width - columns * width - (columns - 1) * columnGap) / 2),
    top: mm((page.height - rows * height - (rows - 1) * rowGap) / 2),
  };
}
// Common label sheets to start a preset from, from the manufacturers' specs. Their grids sit in
// the middle of the page, so the margins are worked out by centredMargins.
const INCH = 25.4;
export const sheetTemplates = [
  ["Avery L7160 / J8160", "a4", 3, 7, 63.5, 38.1, 2.54],
  ["Avery L7159 / J8159", "a4", 3, 8, 63.5, 33.9, 2.54],
  ["Avery L7161 / J8161", "a4", 3, 6, 63.5, 46.6, 2.54],
  ["Avery L7162 / J8162", "a4", 2, 8, 99.1, 33.9, 2.54],
  ["Avery L7163 / J8163", "a4", 2, 7, 99.1, 38.1, 2.54],
  ["Avery L7165 / J8165", "a4", 2, 4, 99.1, 67.7, 2.54],
  ["Avery L7166 / J8166", "a4", 2, 3, 99.1, 93.1, 2.54],
  ["Avery L7169 / J8169", "a4", 2, 2, 99.1, 139, 2.54],
  ["Avery L7173 / J8173", "a4", 2, 5, 99.1, 57, 2.54],
  ["Avery L7168 / J8168", "a4", 1, 2, 199.6, 143.5, 0],
  ["Avery L7651 / J8651", "a4", 5, 13, 38.1, 21.2, 2.54],
  ["Avery 5160 / 8160", "letter", 3, 10, 2.625 * INCH, 1 * INCH, 0.125 * INCH],
  ["Avery 5161 / 8161", "letter", 2, 10, 4 * INCH, 1 * INCH, 0.1875 * INCH],
  ["Avery 5163 / 8163", "letter", 2, 5, 4 * INCH, 2 * INCH, 0.1875 * INCH],
  ["Avery 5164 / 8164", "letter", 2, 3, 4 * INCH, (10 / 3) * INCH, 0.1875 * INCH],
  ["Avery 5167 / 8167", "letter", 4, 20, 1.75 * INCH, 0.5 * INCH, 0.3125 * INCH],
].map(([name, paper, columns, rows, width, height, columnGap]) => {
  const grid = {
    paper,
    columns,
    rows,
    width: mm(width),
    height: mm(height),
    columnGap: mm(columnGap),
    rowGap: 0,
  };
  return { name, ...grid, ...centredMargins(grid), padding: 2 };
});
export const perSheet = (format) => format.columns * format.rows;
// Top-left corner of slot i, in mm from the top-left of the page.
export const slotOrigin = (format, i) => ({
  x: format.left + (i % format.columns) * (format.width + format.columnGap),
  y: format.top + Math.floor(i / format.columns) * (format.height + format.rowGap),
});
// Drops invisible characters and turns tabs, line breaks and non-breaking spaces into plain spaces.
export const clean = (text) =>
  String(text ?? "")
    .normalize("NFC")
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/[\t\n\v\f\r\u00a0\u2007\u202f]/g, " ")
    .trim();
const joinLine = (row, line) =>
  line
    .map((i) => clean(row[i]))
    .filter(Boolean)
    .join(" ");
// One item per non-empty address, with its index in rows; sender lines come from the same row
// when senderFields is given. An address is incomplete with one line or its last mapped line empty.
export function mailItems(rows, fields, senderFields = null) {
  const mapped = fields.filter((line) => line.length);
  return rows
    .map((row, index) => {
      const all = mapped.map((line) => joinLine(row, line));
      const lines = all.filter(Boolean);
      return {
        row: index,
        lines,
        sender: senderFields && senderFields.map((line) => joinLine(row, line)).filter(Boolean),
        incomplete: lines.length < 2 || !all.at(-1),
      };
    })
    .filter((item) => item.lines.length);
}
// The first character in lines the font has no glyph for, or null.
export function missingChar(lines, hasChar) {
  for (const line of lines)
    for (const char of line) if (char !== " " && !hasChar(char)) return char;
  return null;
}
export function paginate(items, format, skip = 0, copies = 1) {
  const size = perSheet(format);
  const slots = [...Array(skip).fill(null), ...items.flatMap((item) => Array(copies).fill(item))];
  return Array.from({ length: Math.ceil(slots.length / size) }, (_, i) =>
    Array.from({ length: size }, (_, j) => slots[i * size + j] ?? null),
  );
}
export function checkFits(items, measure, width, height, size, minSize) {
  let failed = 0;
  const fits = new Map();
  for (const lines of items) {
    try {
      fits.set(lines, fitLines(lines, measure, width, height, size, minSize));
    } catch {
      failed++;
    }
  }
  return { fits, failed };
}
export function fitLines(lines, measure, width, height, size, minSize = 6) {
  for (let font = size; font >= minSize; font = Math.max(minSize, font - 0.25)) {
    const result = [];
    for (const line of lines) {
      let current = "";
      for (const word of line.split(/\s+/)) {
        const next = current ? `${current} ${word}` : word;
        if (measure(next, font) <= width) current = next;
        else {
          if (current) result.push(current);
          current = "";
          for (const char of word) {
            if (measure(current + char, font) > width && current) {
              result.push(current);
              current = "";
            }
            current += char;
          }
        }
      }
      if (current) result.push(current);
    }
    if (
      result.length * font * 1.2 <= height &&
      result.every((line) => measure(line, font) <= width)
    )
      return { lines: result, size: font };
    if (font === minSize) break;
  }
  throw new Error("An address is too long to fit. Shorten its content or remove mapped columns.");
}

// Text boxes on a design. A block's lines come from spreadsheet columns or are the same on
// every record ("fixed"); fixed lines are one shared array, so they are fitted only once.
// One record per row, dropped when every column block is empty. Address blocks mark a record
// incomplete as mailItems does.
export function blockItems(rows, blocks) {
  const fixed = blocks.map((block) =>
    block.source === "fixed" ? block.text.split("\n").map(clean).filter(Boolean) : null,
  );
  const hasColumns = blocks.some((block) => block.source !== "fixed");
  return rows
    .map((row, index) => {
      let incomplete = false;
      let empty = true;
      const lines = blocks.map((block, b) => {
        if (fixed[b]) return fixed[b];
        const all = block.fields.filter((line) => line.length).map((line) => joinLine(row, line));
        const kept = all.filter(Boolean);
        if (kept.length) empty = false;
        if (block.role === "address" && kept.length && (kept.length < 2 || !all.at(-1)))
          incomplete = true;
        return kept;
      });
      return { row: index, blocks: lines, incomplete, empty: hasColumns && empty };
    })
    .filter((item) => !item.empty);
}

// Fits every block of every record in its own box; mm in, measure(text, size, weight) in pt.
// Returns one Map (lines → fit) per block and how many records fail in each.
export function checkBlocks(items, blocks, measure) {
  return blocks.map((block, b) => {
    const unique = [...new Set(items.map((item) => item.blocks[b]))].filter((l) => l.length);
    return checkFits(
      unique,
      (text, size) => measure(text, size, block.weight),
      block.box.width / PT,
      block.box.height / PT,
      block.size,
      Math.min(block.minSize, block.size),
    );
  });
}

export const PT = 25.4 / 72; // mm per PDF point
// Where Arimo's baseline sits in a line 1.2 × the font size tall, as the browser lays it out:
// half the leading (1.2 − ascent − descent) plus the ascent, from the font's hhea metrics.
export const BASELINE = (1.2 - (1854 + 434) / 2048) / 2 + 1854 / 2048;

// Positions fitted lines in a box: each line's left end and baseline, in mm from the page's
// top-left corner. The preview and the PDF both use this, so they place text identically.
export function placeLines(fit, box, { align = "left", valign = "top" }, measure) {
  const lineHeight = fit.size * 1.2 * PT;
  const spare = box.height - fit.lines.length * lineHeight;
  const top = box.top + (valign === "middle" ? spare / 2 : valign === "bottom" ? spare : 0);
  return fit.lines.map((text, i) => {
    const width = measure(text, fit.size) * PT;
    const free = box.width - width;
    return {
      text,
      width,
      x: box.left + (align === "center" ? free / 2 : align === "right" ? free : 0),
      y: top + i * lineHeight + BASELINE * fit.size * PT,
    };
  });
}

// Named page sizes in mm (portrait), for telling the user what size a design is.
export const pageSizes = [
  ["A3", 297, 420],
  ["A4", 210, 297],
  ["A5", 148, 210],
  ["A6", 105, 148],
  ["DL", 99, 210],
  ["DL envelope", 110, 220],
  ["C4 envelope", 229, 324],
  ["C5 envelope", 162, 229],
  ["C6 envelope", 114, 162],
  ["US Letter", 215.9, 279.4],
  ["Business card", 55, 85],
  ["Badge", 55, 90],
];
export function pageSizeName(width, height) {
  const [short, long] = width < height ? [width, height] : [height, width];
  const match = pageSizes.find(
    ([, w, h]) => Math.abs(w - short) <= 1.5 && Math.abs(h - long) <= 1.5,
  );
  const mm = (n) => Math.round(n * 10) / 10;
  const size = `${mm(width)} × ${mm(height)} mm`;
  if (!match) return size;
  return `${match[0]} ${width > height ? "landscape" : width < height ? "portrait" : ""}`.trim();
}
