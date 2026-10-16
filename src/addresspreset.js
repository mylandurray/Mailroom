import { columnRef, columnIndex, normalizeHeading } from "./design.js";
// Spreadsheet presets: the address lines chosen for one kind of spreadsheet, saved by column
// heading so next week's export of the same layout can be printed without choosing again.

const MAX_NAME = 60;
const MAX_LINES = 8;
const norm = normalizeHeading;

const isLines = (lines) =>
  Array.isArray(lines) &&
  lines.length <= MAX_LINES &&
  lines.every(
    (line) =>
      Array.isArray(line) &&
      line.length <= 2 &&
      line.every(
        (h) =>
          (typeof h === "string" && h) ||
          (typeof h?.name === "string" && h.name && Number.isInteger(h.nth) && h.nth >= 0),
      ),
  );

// Column numbers per line become the headings of those columns.
const toHeadings = (fields, headers) =>
  fields.map((line) => line.filter(Number.isInteger).map((n) => columnRef(headers, n)));

export const hasColumns = (fields) => fields.some((line) => line.some(Number.isInteger));

// A preset describing the current choices, or throws if the name is unusable.
export function makePreset(name, { headers, fields, senderFields, size }) {
  name = String(name ?? "").trim();
  if (!name) throw Error("Give the preset a name.");
  if (name.length > MAX_NAME) throw Error(`Use a name of ${MAX_NAME} characters or fewer.`);
  if (!hasColumns(fields)) throw Error("Choose at least one address column first.");
  return {
    name,
    headers: [...headers],
    lines: toHeadings(fields, headers).filter((line) => line.length),
    senderLines: toHeadings(senderFields, headers).filter((line) => line.length),
    size,
  };
}

// Whether a stored preset is well formed; saved data is untrusted after a version change.
export const validPreset = (p) =>
  Boolean(p) &&
  typeof p.name === "string" &&
  p.name.trim() !== "" &&
  p.name.length <= MAX_NAME &&
  Array.isArray(p.headers) &&
  p.headers.every((h) => typeof h === "string") &&
  isLines(p.lines) &&
  p.lines.length > 0 &&
  isLines(p.senderLines) &&
  Number.isFinite(p.size);

// True when the spreadsheet has exactly the columns the preset was made for.
export const matches = (preset, headers) =>
  preset.headers.length === headers.length &&
  preset.headers.every((h, i) => norm(h) === norm(headers[i]));

// The preset's lines as column numbers in this spreadsheet. Throws naming the first column
// the spreadsheet doesn't have.
export function resolve(preset, headers) {
  const columns = (lines) =>
    lines.map((line) =>
      line.map((ref) => {
        const name = typeof ref === "string" ? ref : ref.name;
        if (
          typeof ref === "string" &&
          (headers.filter((h) => norm(h) === norm(name)).length > 1 ||
            preset.headers.filter((h) => norm(h) === norm(name)).length > 1)
        )
          throw Error(
            `The saved “${name}” column is ambiguous. Choose its columns again and save the preset.`,
          );
        const i = columnIndex(headers, typeof ref === "string" ? { name, nth: 0 } : ref);
        if (i < 0)
          throw Error(
            `This spreadsheet has no “${name}” column${typeof ref === "string" ? "" : ` occurrence ${ref.nth + 1}`}.`,
          );
        return i;
      }),
    );
  const fields = columns(preset.lines);
  const senderFields = columns(preset.senderLines);
  return {
    fields,
    senderFields: senderFields.length ? senderFields : [[], [], []],
    size: preset.size,
  };
}

// The first preset (in name order) made for exactly this spreadsheet layout, as [key, preset].
export const findMatch = (presets, headers) =>
  Object.entries(presets)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .find(([, preset]) => matches(preset, headers));

// Whether the current choices differ from what the preset would set.
export function changed(preset, { headers, fields, senderFields, size }) {
  try {
    const restored = resolve(preset, headers);
    const compact = (lines) =>
      lines.map((line) => line.filter(Number.isInteger)).filter((line) => line.length);
    return (
      JSON.stringify([compact(fields), compact(senderFields), size]) !==
      JSON.stringify([compact(restored.fields), compact(restored.senderFields), restored.size])
    );
  } catch {
    return true;
  }
}
