import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mailItems,
  paginate,
  fitLines,
  checkFits,
  clean,
  missingChar,
  formats,
  slotOrigin,
  perSheet,
  labelPreset,
  presetFormat,
  centredMargins,
  sheetPapers,
  sheetTemplates,
} from "./layout.js";
test("mapping omits empty lines and rows, preserves postal strings", () =>
  assert.deepEqual(
    mailItems(
      [
        ["Ada", "", "00123"],
        ["", "", ""],
      ],
      [[0], [1], [2]],
    ).map((item) => item.lines),
    [["Ada", "00123"]],
  ));
test("used labels and copies continue across pages", () => {
  const p = paginate([["A"], ["B"]], formats.labels, 20, 2);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0][20], ["A"]);
  assert.deepEqual(p[1].slice(0, 3), [["A"], ["B"], ["B"]]);
});
test("every format's address areas stay within its page", () => {
  for (const format of Object.values(formats)) {
    const last = slotOrigin(format, perSheet(format) - 1);
    assert.ok(last.x + format.width <= format.page.width);
    assert.ok(last.y + format.height <= format.page.height);
  }
});
test("envelopes print one address per page", () => {
  const p = paginate([["A"], ["B"]], formats.c5, 0, 2);
  assert.deepEqual(p, [[["A"]], [["A"]], [["B"]], [["B"]]]);
});
test("long unbroken text wraps without loss", () => {
  const f = fitLines(["abcdefghijklmnop"], (s, n) => s.length * n, 30, 100, 10);
  assert.equal(f.lines.join(""), "abcdefghijklmnop");
  assert.ok(f.lines.every((s) => s.length * f.size <= 30));
});
test("fit check flags addresses that cannot fit", () => {
  const r = checkFits([["short"], ["x".repeat(1e4)]], (s, n) => s.length * n, 30, 100, 10);
  assert.equal(r.failed, 1);
  assert.ok([...r.fits.keys()].some((lines) => lines[0] === "short"));
});
test("fit check succeeds when every address fits", () => {
  const short = [["Ada"], ["Bob"]];
  const r = checkFits(short, (s, n) => s.length * n, 100, 100, 10);
  assert.equal(r.failed, 0);
  assert.equal(r.fits.size, 2);
  assert.ok(short.every((lines) => r.fits.get(lines).size > 0));
});
test("return addresses come from the same row as the address", () =>
  assert.deepEqual(
    mailItems(
      [
        ["Ada", "Cork"],
        ["", "Galway"],
        ["Bob", ""],
      ],
      [[0]],
      [[1]],
    ),
    [
      { row: 0, lines: ["Ada"], sender: ["Cork"], incomplete: true },
      { row: 2, lines: ["Bob"], sender: [], incomplete: true },
    ],
  ));
test("envelope corners stay on the page and clear of the address", () => {
  for (const format of Object.values(formats).filter((f) => f.kind === "envelopes")) {
    const { licence, sender, page } = format;
    assert.ok(page.width - licence.right - licence.width >= sender.left + sender.width);
    assert.ok(sender.top + sender.height <= format.top);
    assert.ok(licence.top + licence.height <= format.top);
  }
});
test("invisible characters are dropped and odd spaces become plain ones", () => {
  const ch = (...codes) => String.fromCodePoint(...codes);
  assert.equal(clean(`Mary${ch(0x200b)}st${ch(0xad)}reet${ch(0xfeff)}`), "Marystreet");
  assert.equal(clean(`12\tMain${ch(0xa0)}St${ch(0x202f)}N${ch(0x2007)}1\n`), "12 Main St N 1");
  assert.equal(clean(`Sea${ch(0x301)}n`), `Se${ch(0xe1)}n`);
  assert.equal(clean(null), "");
});
test("the first unprintable character is found", () => {
  const hasChar = (c) => c.codePointAt(0) < 0x10000;
  assert.equal(missingChar(["Ada", "Łukasz"], hasChar), null);
  assert.equal(missingChar(["Ada", "x 𝒳 y"], hasChar), "𝒳");
});
test("addresses with one line or an empty last line are incomplete, keeping their row", () => {
  const items = mailItems(
    [
      ["Ada", "Cork", "T12"],
      ["Bob", "Cork", ""],
      ["", "", ""],
      ["Cy", "", ""],
    ],
    [[0], [1], [], [2]],
  );
  assert.deepEqual(
    items.map(({ row, incomplete }) => [row, incomplete]),
    [
      [0, false],
      [1, true],
      [3, true],
    ],
  );
});
test("row gaps move later rows down", () => {
  const format = { ...formats.labels, rowGap: 2 };
  assert.deepEqual(slotOrigin(format, 3), { x: 7.25, y: 15.15 + 38.1 + 2 });
  assert.equal(slotOrigin(formats.labels, 4).x, 7.25 + 63.5 + 2.5);
});

const L7163 = {
  name: "Avery L7163",
  paper: "a4",
  columns: "2",
  rows: "7",
  width: "99.1",
  height: "38.1",
  left: "4.65",
  top: "15.15",
  columnGap: "2.5",
  rowGap: "0",
  padding: "3",
};
test("a described label sheet becomes a labels format on its paper", () => {
  const format = presetFormat(labelPreset(L7163));
  assert.equal(format.kind, "labels");
  assert.equal(format.name, "Avery L7163 · 14-up · 99.1 × 38.1 mm");
  assert.deepEqual(format.page, sheetPapers.a4);
  assert.equal(perSheet(format), 14);
  assert.deepEqual(slotOrigin(format, 13), { x: 4.65 + 99.1 + 2.5, y: 15.15 + 6 * 38.1 });
  const letter = presetFormat(labelPreset({ ...L7163, paper: "letter", top: "5" }));
  assert.equal(letter.page.width, 215.9);
});
test("label sheets that don't fit or can't hold text are rejected with the reason", () => {
  const reject = (change, pattern) =>
    assert.throws(() => labelPreset({ ...L7163, ...change }), pattern);
  reject({ name: " " }, /Give the preset a name/);
  reject({ paper: "b5" }, /Choose the paper size/);
  reject({ columns: "2.5" }, /Columns must be a whole number/);
  reject({ rows: "" }, /between 1 and 40 for rows/);
  reject({ width: "abc" }, /label width/);
  reject({ columnGap: "10" }, /off the right of the page/);
  reject({ top: "40" }, /off the bottom of the page/);
  reject({ padding: "10", height: "20" }, /no room for text/);
});
test("every common sheet to start from is a valid preset", () => {
  for (const template of sheetTemplates) assert.deepEqual(labelPreset(template), template);
  const l7160 = sheetTemplates.find((t) => t.name.startsWith("Avery L7160"));
  assert.deepEqual([l7160.left, l7160.top], [7.21, 15.15]);
});
test("centred margins put the grid in the middle of the page", () => {
  const { left, top } = centredMargins({ ...labelPreset(L7163), columnGap: 2.5 });
  assert.equal(left, 4.65);
  assert.equal(top, 15.15);
});
