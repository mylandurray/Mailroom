import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { encryptedPackage, decryptWorkbook, decryptDefault, canDecrypt, md5 } from "./decrypt.js";

const fixture = (name) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const PASSWORD = "Secret pässword";

// Each was written independently of this implementation, and opens in Excel with PASSWORD:
const FIXTURES = {
  // msoffcrypto-tool: agile, AES-256/SHA-512, as Excel 2010 and later write.
  "encrypted.xlsx": "agile",
  // AES-128 standard encryption, as Excel 2007 writes (checked with msoffcrypto-tool).
  "encrypted-2007.xlsx": "standard",
  // Excel's own "Excel 97-2003 Workbook" save with a password: RC4 CryptoAPI.
  "encrypted.xls": "rc4-cryptoapi",
  // Office 97/2000 compatible RC4, as LibreOffice writes (checked with msoffcrypto-tool).
  "encrypted-97.xls": "rc4",
};

for (const [name, kind] of Object.entries(FIXTURES)) {
  test(`${name} (${kind}) decrypts with the right password and not a wrong one`, async () => {
    const pkg = encryptedPackage(fixture(name));
    assert.equal(pkg.kind, kind);
    await assert.rejects(decryptWorkbook(pkg, "secret pässword"), {
      message: "The password is incorrect.",
    });
    const workbook = XLSX.read(await decryptWorkbook(pkg, PASSWORD), { type: "array" });
    assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets.Clients, { header: 1 }), [
      ["Name", "Street", "Town"],
      ["Áine Ní Bhriain", "1 Main Street", "Sligo"],
      ["Ciarán Walsh", "2 Quay Road", "Wexford"],
    ]);
  });
}

test("unprotected files are not treated as encrypted", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["a"]]), "Sheet1");
  for (const bookType of ["xlsx", "xls", "biff5"])
    assert.equal(
      encryptedPackage(new Uint8Array(XLSX.write(workbook, { type: "array", bookType }))),
      null,
    );
});

test("XOR-obfuscated .xls files are reported as unsupported", () => {
  const cfb = XLSX.CFB.read(fixture("encrypted.xls"), { type: "array" });
  const entry = XLSX.CFB.find(cfb, "/Workbook");
  const workbook = Uint8Array.from(entry.content);
  const view = new DataView(workbook.buffer);
  let pos = 0;
  while (view.getUint16(pos, true) !== 0x2f) pos += 4 + view.getUint16(pos + 2, true);
  view.setUint16(pos + 4, 0, true); // wEncryptionType 0: XOR obfuscation
  XLSX.CFB.utils.cfb_add(cfb, "/Workbook", workbook);
  assert.throws(
    () => encryptedPackage(new Uint8Array(XLSX.CFB.write(cfb, { type: "array" }))),
    /can't open/,
  );
});

test("md5 matches Node's", () => {
  for (const length of [0, 3, 55, 56, 63, 64, 65, 336, 1000]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 31 + 7) & 255);
    assert.equal(
      Buffer.from(md5(bytes)).toString("hex"),
      createHash("md5").update(bytes).digest("hex"),
    );
  }
});

test("files asking for millions of password rounds are refused", () => {
  const cfb = XLSX.CFB.read(fixture("encrypted.xlsx"), { type: "array" });
  const info = Buffer.from(XLSX.CFB.find(cfb, "/EncryptionInfo").content).toString("latin1");
  assert.match(info, /spinCount="100000"/);
  const withSpinCount = (count) => {
    const patched = info.replace('spinCount="100000"', `spinCount="${count}"`);
    XLSX.CFB.utils.cfb_add(cfb, "/EncryptionInfo", Buffer.from(patched, "latin1"));
    return new Uint8Array(XLSX.CFB.write(cfb, { type: "array" }));
  };
  assert.equal(encryptedPackage(withSpinCount(1_000_000)).spinCount, 1_000_000);
  assert.throws(() => encryptedPackage(withSpinCount(1_000_001)), /could not be read/);
});

// Re-encrypts the RC4 .xls fixture with Excel's default password ([MS-XLS] 2.2.10).
function velvetSweatshopXLS() {
  const rc4 = (key, length) => {
    const s = Uint8Array.from({ length: 256 }, (_, i) => i);
    for (let i = 0, j = 0; i < 256; i++) {
      j = (j + s[i] + key[i % key.length]) & 255;
      [s[i], s[j]] = [s[j], s[i]];
    }
    const out = new Uint8Array(length);
    for (let k = 0, i = 0, j = 0; k < length; k++) {
      i = (i + 1) & 255;
      j = (j + s[i]) & 255;
      [s[i], s[j]] = [s[j], s[i]];
      out[k] = s[(s[i] + s[j]) & 255];
    }
    return out;
  };
  // The keystream for each 1024-byte block.
  const keystream = (password, salt) => {
    const truncated = md5(Buffer.from(password, "utf16le")).subarray(0, 5);
    const h1 = md5(Buffer.concat(Array(16).fill(Buffer.concat([truncated, salt])))).subarray(0, 5);
    const cache = new Map();
    return (block) => {
      if (!cache.has(block)) {
        const n = Buffer.alloc(4);
        n.writeUInt32LE(block);
        cache.set(block, rc4(md5(Buffer.concat([h1, n])), 1024));
      }
      return cache.get(block);
    };
  };
  const cfb = XLSX.CFB.read(fixture("encrypted-97.xls"), { type: "array" });
  const workbook = Buffer.from(XLSX.CFB.find(cfb, "/Workbook").content);
  const records = [];
  for (let pos = 0; pos + 4 <= workbook.length; pos += 4 + workbook.readUInt16LE(pos + 2))
    records.push({ type: workbook.readUInt16LE(pos), pos });
  const filePass = records.find((r) => r.type === 0x2f).pos + 4;
  const salt = workbook.subarray(filePass + 6, filePass + 22);
  const oldKey = keystream(PASSWORD, salt);
  const newKey = keystream("VelvetSweatshop", salt);
  const plain = new Set([0x0809, 0x002f, 0x0194, 0x0195, 0x00e1, 0x0196, 0x0138]);
  for (const { type, pos } of records) {
    if (plain.has(type)) continue;
    const end = Math.min(pos + 4 + workbook.readUInt16LE(pos + 2), workbook.length);
    for (let i = type === 0x85 ? pos + 8 : pos + 4; i < end; i++) {
      const block = Math.floor(i / 1024);
      workbook[i] ^= oldKey(block)[i % 1024] ^ newKey(block)[i % 1024];
    }
  }
  const verifier = Buffer.from("0123456789abcdef");
  const check = Buffer.concat([verifier, md5(verifier)]).map((b, i) => b ^ newKey(0)[i]);
  workbook.set(check, filePass + 22);
  XLSX.CFB.utils.cfb_add(cfb, "/Workbook", workbook);
  return new Uint8Array(XLSX.CFB.write(cfb, { type: "array" }));
}

test("files encrypted with Excel's default password open without one", async () => {
  const pkg = encryptedPackage(velvetSweatshopXLS());
  assert.equal(pkg.kind, "rc4");
  const workbook = XLSX.read(await decryptDefault(pkg), { type: "array" });
  assert.equal(
    XLSX.utils.sheet_to_json(workbook.Sheets.Clients, { header: 1 })[1][0],
    "Áine Ní Bhriain",
  );
  for (const name of ["encrypted-2007.xlsx", "encrypted.xls", "encrypted-97.xls"])
    assert.equal(await decryptDefault(encryptedPackage(fixture(name))), null);
});

test("only RC4 files can be decrypted without Web Crypto", () => {
  assert.ok(canDecrypt({ kind: "agile" }));
  // Browsers leave crypto.subtle undefined on plain http:// pages.
  assert.ok(canDecrypt({ kind: "rc4" }, {}));
  assert.ok(!canDecrypt({ kind: "rc4-cryptoapi" }, {}));
  assert.ok(!canDecrypt({ kind: "agile" }, {}));
});
