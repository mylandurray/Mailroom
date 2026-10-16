import { test } from "node:test";
import assert from "node:assert/strict";
import { makePreset, validPreset, matches, resolve, findMatch, changed } from "./addresspreset.js";

const headers = ["Name", "Street", "Town", "Postcode"];
const current = { headers, fields: [[0], [1], [], [2, 3]], senderFields: [[], [], []], size: 12 };

test("a preset stores headings, not column numbers, and drops empty lines", () => {
  const preset = makePreset("  Weekly  ", current);
  assert.deepEqual(preset, {
    name: "Weekly",
    headers,
    lines: [
      [{ name: "Name", nth: 0 }],
      [{ name: "Street", nth: 0 }],
      [
        { name: "Town", nth: 0 },
        { name: "Postcode", nth: 0 },
      ],
    ],
    senderLines: [],
    size: 12,
  });
  assert.ok(validPreset(JSON.parse(JSON.stringify(preset))));
});

test("a preset needs a name and at least one column", () => {
  assert.throws(() => makePreset(" ", current), /name/);
  assert.throws(() => makePreset("x".repeat(61), current), /60/);
  assert.throws(() => makePreset("A", { ...current, fields: [[], [null]] }), /at least one/);
});

test("a preset follows its columns when they move, and ignores case and spacing", () => {
  const preset = makePreset("Weekly", current);
  const moved = ["Notes", " town ", "POSTCODE", "street", "name"];
  assert.deepEqual(resolve(preset, moved).fields, [[4], [3], [1, 2]]);
  assert.ok(!matches(preset, moved), "extra columns are not the same layout");
  assert.ok(matches(preset, ["name", "Street ", "TOWN", "postcode"]));
});

test("a missing column is named", () => {
  const preset = makePreset("Weekly", current);
  assert.throws(() => resolve(preset, ["Name", "Street", "Town"]), /no “Postcode” column/);
});

test("the return address columns come back with the preset", () => {
  const preset = makePreset("Env", { ...current, senderFields: [[0], [1, 2]] });
  assert.deepEqual(resolve(preset, headers).senderFields, [[0], [1, 2]]);
  assert.deepEqual(resolve(makePreset("Plain", current), headers).senderFields, [[], [], []]);
});

test("the first preset by name made for the same layout is found", () => {
  const presets = {
    "map-b": makePreset("B job", current),
    "map-a": makePreset("A job", current),
    "map-c": makePreset("Other", { ...current, headers: ["X", ...headers] }),
  };
  assert.equal(findMatch(presets, headers)[0], "map-a");
  assert.equal(findMatch(presets, ["Nothing"]), undefined);
});

test("edits since saving are detected", () => {
  const preset = makePreset("Weekly", current);
  assert.ok(!changed(preset, current));
  assert.ok(
    !changed(preset, { ...current, fields: [[0], [], [1], [2, 3]] }),
    "blank lines don't count",
  );
  assert.ok(changed(preset, { ...current, size: 14 }));
  assert.ok(changed(preset, { ...current, fields: [[0], [1], [2]] }));
});

test("damaged saved presets are rejected", () => {
  const good = makePreset("Weekly", current);
  for (const bad of [
    null,
    {},
    { ...good, name: "" },
    { ...good, lines: [] },
    { ...good, lines: [[1]] },
    { ...good, lines: [["a", "b", "c"]] },
    { ...good, senderLines: "x" },
    { ...good, size: "big" },
  ])
    assert.ok(!validPreset(bad), JSON.stringify(bad));
});

test("duplicate occurrences survive reordering and cannot fall back to the first column", () => {
  const current = {
    headers: ["Name", "Address", " address "],
    fields: [[0], [2]],
    senderFields: [[2]],
    size: 12,
  };
  const preset = makePreset("Duplicates", current);
  assert.deepEqual(resolve(preset, ["ADDRESS", "Name", "Address"]).fields, [[1], [2]]);
  assert.deepEqual(resolve(preset, current.headers).senderFields, [[2]]);
  assert.throws(() => resolve(preset, ["Name", "Address"]), /occurrence 2/);
  assert.ok(!changed(preset, current));
  const legacy = { ...preset, lines: [["Address"]], senderLines: [] };
  assert.ok(validPreset(legacy));
  assert.throws(() => resolve(legacy, current.headers), /ambiguous/);
  assert.throws(() => resolve(legacy, ["Name", "Address"]), /ambiguous/);
});

test("unique legacy presets resolve and report unchanged", () => {
  const legacy = {
    name: "Old",
    headers,
    lines: [["Name"], ["Street"], ["Town", "Postcode"]],
    senderLines: [],
    size: 12,
  };
  assert.deepEqual(resolve(legacy, headers).fields, [[0], [1], [2, 3]]);
  assert.ok(!changed(legacy, current));
});
