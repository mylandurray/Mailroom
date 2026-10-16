import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { template } from "./template.js";
import { createDesigner } from "./designer.js";
import { readProject } from "./design.js";

const dom = new JSDOM(`<div id="app">${template}</div>`);
globalThis.document = dom.window.document;
const $ = (id) => document.getElementById(id);
const state = { headers: [], rows: [] };
let status = "",
  saved = [];
const loads = {};
const designer = createDesigner({
  $,
  state,
  escape: String,
  message: (text) => {
    status = text;
  },
  flagIncomplete: () => {},
  count: (n, word) => `${n} ${word}`,
  update: async () => {},
  dropZone: (zone, fn) => {
    loads[zone.id] = fn;
  },
  saveFile: (bytes) => saved.push(new TextDecoder().decode(bytes)),
  toBase64: (bytes) => Buffer.from(bytes).toString("base64"),
  setFormat: (value) => {
    $("format").value = value;
  },
});
designer.bind();
after(() => dom.window.close());
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6YQAAAAASUVORK5CYII=",
    "base64",
  ),
);
const image = (name = "image.png") => ({
  name,
  size: png.length,
  arrayBuffer: async () => png.buffer,
});
const fire = (element, type) =>
  element.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
function openProject(file) {
  Object.defineProperty($("project-file"), "files", { value: [file], configurable: true });
  fire($("project-file"), "change");
}

test("custom image size remains selected and saves without a spreadsheet", async () => {
  await loads["design-drop"](image());
  $("image-size").value = "custom";
  fire($("image-size"), "change");
  assert.equal($("image-size").value, "custom");
  assert.equal($("image-custom").hidden, false);
  $("image-width").value = "180";
  fire($("image-width"), "input");
  assert.equal($("image-size").value, "custom");
  assert.match($("image-note").textContent, /stretched/);
  $("design-duplex").checked = true;
  fire($("design-duplex"), "change");
  $("save-project").click();
  const restored = readProject(saved.at(-1));
  assert.equal(restored.settings.imageSize.width, 180);
  assert.equal(restored.settings.duplex, true);
  const before = saved.length;
  const input = $("blocks").querySelector('[data-prop="size"]');
  input.value = "";
  fire(input, "input");
  $("save-project").click();
  assert.equal(saved.length, before);
  assert.match(status, /Could not save.*text size/);
  input.value = "11";
  fire(input, "input");
  $("image-size").value = "297x210";
  fire($("image-size"), "change");
  assert.equal($("image-custom").hidden, true);
  assert.equal($("image-width").value, "297");
});

test("design uploads and project opens share a latest-selection token", async () => {
  for (const olderFirst of [true, false]) {
    const old = deferred();
    const pending = loads["design-drop"]({
      name: "old.png",
      size: 1,
      arrayBuffer: () => old.promise,
    });
    const next = deferred();
    openProject({ size: 1, text: () => next.promise });
    if (olderFirst) {
      old.resolve(png.buffer);
      await pending;
    }
    next.resolve(saved[0]);
    await tick();
    if (!olderFirst) {
      old.resolve(png.buffer);
      await pending;
    }
    assert.equal($("design-name").textContent, "image.png");
  }
  const old = deferred();
  openProject({ size: 1, text: () => old.promise });
  await loads["design-drop"](image("latest.png"));
  old.reject(Error("stale project"));
  const before = status;
  await tick();
  assert.equal($("design-name").textContent, "latest.png");
  assert.equal(status, before);
});

test("invalid sizes and boxes are refused before a project download", async () => {
  await loads["design-drop"](image());
  for (const [selector, value] of [
    ['[data-prop="size"]', "201"],
    ['[data-prop="minSize"]', "3"],
    ['[data-box="width"]', "0"],
    ['[data-box="height"]', ""],
    ['[data-box="left"]', "2001"],
  ]) {
    const input = $("blocks").querySelector(selector);
    const original = input.value;
    input.value = value;
    fire(input, "input");
    const before = saved.length;
    $("save-project").click();
    assert.equal(saved.length, before);
    assert.match(status, /Could not save project/);
    input.value = original;
    fire(input, "input");
  }
  $("image-size").value = "custom";
  fire($("image-size"), "change");
  $("image-width").value = "";
  fire($("image-width"), "input");
  const before = saved.length;
  $("save-project").click();
  assert.equal(saved.length, before);
  assert.match(status, /page size between/);
});
