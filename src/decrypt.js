// Opens password-protected Excel files in the browser, so the file and password never leave it.
// Supports every password protection Excel has used since Excel 97 ([MS-OFFCRYPTO]):
//   - agile encryption: .xlsx from Excel 2010 and later
//   - standard encryption: .xlsx from Excel 2007
//   - RC4 CryptoAPI: .xls from Excel 2002 and later
//   - RC4: .xls from Excel 97/2000, and from LibreOffice
// Web Crypto has no RC4 or MD5, so those are implemented here.
import { CFB } from "xlsx";

const SEGMENT = 4096;
const KEY_BLOCK = [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6];
const VERIFIER_INPUT_BLOCK = [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79];
const VERIFIER_VALUE_BLOCK = [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e];
const HASHES = { SHA1: "SHA-1", SHA256: "SHA-256", SHA384: "SHA-384", SHA512: "SHA-512" };
const AES_KEY_BITS = { 0x660e: 128, 0x660f: 192, 0x6610: 256 };
// Excel uses 100,000. Each round is a hash, so this bounds how long a crafted file can take.
const MAX_SPIN_COUNT = 1_000_000;
// Excel encrypts with this built-in password when a file only has a password to modify or a
// protected structure, and opens it without asking.
const DEFAULT_PASSWORD = "VelvetSweatshop";

const UNSUPPORTED =
  "This file uses a kind of password protection Mailroom can't open. Open it in Excel, save a copy as an Excel Workbook (.xlsx), and load that instead.";
const UNREADABLE = "The file's encryption details could not be read.";
const WRONG_PASSWORD = "The password is incorrect.";

const isCFB = (bytes) =>
  bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;

const stream = (cfb, name) => {
  const content = CFB.find(cfb, name)?.content;
  return content ? Uint8Array.from(content) : null;
};

// Returns what decryptWorkbook needs if `bytes` is a password-protected workbook, or null if it
// isn't. Throws if it is protected in a way that can't be opened, so that is reported before
// anyone types a password.
// Excel stores a protected .xlsx as an OLE container holding EncryptionInfo and EncryptedPackage
// (an unprotected one is a zip); a protected .xls is an ordinary .xls with a FilePass record.
export function encryptedPackage(bytes) {
  if (!isCFB(bytes)) return null;
  let cfb;
  try {
    cfb = CFB.read(bytes, { type: "array" });
  } catch {
    return null;
  }
  try {
    const info = stream(cfb, "/EncryptionInfo");
    const data = stream(cfb, "/EncryptedPackage");
    if (info && data) return { ...parseInfo(info), data };
    const workbook = stream(cfb, "/Workbook");
    const filePass = workbook && findFilePass(workbook);
    if (filePass) return { ...parseFilePass(filePass), bytes, workbook };
    // Excel 5/95 workbooks only ever used the weak XOR obfuscation.
    const book = stream(cfb, "/Book");
    if (book && findFilePass(book)) throw Error(UNSUPPORTED);
    return null;
  } catch (e) {
    throw e instanceof RangeError ? Error(UNREADABLE) : e;
  }
}

// Returns the decrypted workbook, ready for XLSX.read, or throws if the password is wrong.
export function decryptWorkbook(pkg, password) {
  switch (pkg.kind) {
    case "agile":
      return decryptAgile(pkg, password);
    case "standard":
      return decryptStandard(pkg, password);
    default:
      return decryptXLS(pkg, password);
  }
}

// Everything but RC4 needs Web Crypto, which browsers only provide to https:// and local pages.
export const canDecrypt = (pkg, webCrypto = globalThis.crypto) =>
  pkg.kind === "rc4" || Boolean(webCrypto?.subtle);

// Returns the workbook if it opens with Excel's default password, or null. Agile files are only
// tried when cheap, since a try costs as much as a real password.
export async function decryptDefault(pkg) {
  if (pkg.kind === "agile" && pkg.spinCount > 10_000) return null;
  try {
    return await decryptWorkbook(pkg, DEFAULT_PASSWORD);
  } catch {
    return null;
  }
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};
const uint32 = (n) => new Uint8Array(new Uint32Array([n]).buffer);
const base64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const utf16 = (s) => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++)
    new DataView(out.buffer).setUint16(i * 2, s.charCodeAt(i), true);
  return out;
};
const equal = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
// Truncates, or pads with `fill`, to exactly `length` bytes.
const fit = (bytes, length, fill = 0x36) => {
  const out = new Uint8Array(length).fill(fill);
  out.set(bytes.subarray(0, length));
  return out;
};
const view = (bytes, offset = 0) => new DataView(bytes.buffer, bytes.byteOffset + offset);

function parseInfo(info) {
  const major = view(info).getUint16(0, true);
  const minor = view(info).getUint16(2, true);
  if (major === 4 && minor === 4) return parseAgile(info);
  if ((major === 2 || major === 3 || major === 4) && minor === 2) return parseStandard(info);
  throw Error(UNSUPPORTED);
}

function parseAgile(info) {
  const xml = new TextDecoder().decode(info.subarray(8));
  const attributes = (tag) => {
    const element = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>`))?.[0];
    if (!element) throw Error(UNREADABLE);
    return Object.fromEntries([...element.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  };
  const parse = (a) => {
    const hash = HASHES[a.hashAlgorithm];
    if (!hash || a.cipherAlgorithm !== "AES" || a.cipherChaining !== "ChainingModeCBC")
      throw Error(UNSUPPORTED);
    return {
      ...a,
      hash,
      salt: base64(a.saltValue),
      keyBytes: Number(a.keyBits) / 8,
      blockSize: Number(a.blockSize),
      hashSize: Number(a.hashSize),
    };
  };
  const password = parse(attributes("encryptedKey"));
  const spinCount = Number(password.spinCount);
  if (!Number.isInteger(spinCount) || spinCount < 0 || spinCount > MAX_SPIN_COUNT)
    throw Error(UNREADABLE);
  return { kind: "agile", keyData: parse(attributes("keyData")), password, spinCount };
}

// The binary EncryptionHeader and EncryptionVerifier that standard and RC4 CryptoAPI encryption
// share. `offset` is where the header's flags start.
function parseCryptoAPI(bytes, offset, hashSize) {
  const v = view(bytes, offset);
  const header = 8;
  const verifier = header + v.getUint32(4, true);
  const saltSize = v.getUint32(verifier, true);
  if (saltSize !== 16) throw Error(UNREADABLE);
  const at = (start, length) => {
    if (offset + start + length > bytes.length) throw Error(UNREADABLE);
    return bytes.subarray(offset + start, offset + start + length);
  };
  return {
    flags: v.getUint32(0, true),
    algId: v.getUint32(header + 8, true),
    algIdHash: v.getUint32(header + 12, true),
    keyBits: v.getUint32(header + 16, true),
    salt: at(verifier + 4, 16),
    verifier: at(verifier + 20, 16),
    verifierHash: at(verifier + 40, hashSize),
  };
}

function parseStandard(info) {
  const p = parseCryptoAPI(info, 4, 32);
  const F_CRYPTOAPI = 0x04;
  const F_EXTERNAL = 0x10;
  const F_AES = 0x20;
  const keyBits = AES_KEY_BITS[p.algId] ?? (p.algId === 0 ? 128 : 0);
  if (
    (p.flags & (F_CRYPTOAPI | F_AES | F_EXTERNAL)) !== (F_CRYPTOAPI | F_AES) ||
    !keyBits ||
    p.keyBits !== keyBits ||
    (p.algIdHash !== 0 && p.algIdHash !== 0x8004)
  )
    throw Error(UNSUPPORTED);
  return { kind: "standard", ...p };
}

const digest = async (hash, ...parts) =>
  new Uint8Array(await crypto.subtle.digest(hash, concat(...parts)));

async function hashPassword(hash, salt, password, spinCount) {
  let h = await digest(hash, salt, utf16(password));
  for (let i = 0; i < spinCount; i++) h = await digest(hash, uint32(i), h);
  return h;
}

// Web Crypto's AES-CBC always strips PKCS#7 padding, but these streams have none. Appending one
// encrypted block of padding lets it decrypt the real data unchanged.
async function decryptCBC(keyBytes, iv, data) {
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, [
    "encrypt",
    "decrypt",
  ]);
  const last = data.subarray(data.length - 16);
  const pad = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-CBC", iv: last }, key, new Uint8Array(16).fill(16)),
  ).subarray(0, 16);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, concat(data, pad)),
  );
}

// Web Crypto has no AES-ECB. CBC with a zero IV decrypts each block and then XORs it with the
// previous ciphertext block, so undoing that XOR gives ECB.
async function decryptECB(keyBytes, data) {
  const out = await decryptCBC(keyBytes, new Uint8Array(16), data);
  for (let i = 16; i < out.length; i++) out[i] ^= data[i - 16];
  return out;
}

// The package is its uint64 size followed by the encrypted zip. Some writers leave stray bytes
// after the last whole cipher block; they carry no data.
function packageParts(data) {
  const size = Number(view(data).getBigUint64(0, true));
  if (size > data.length) throw Error("The file is damaged and could not be decrypted.");
  return { size, end: 8 + Math.floor((data.length - 8) / 16) * 16 };
}

async function decryptAgile({ keyData, password: p, spinCount, data }, password) {
  const h = await hashPassword(p.hash, p.salt, password, spinCount);
  const iv = fit(p.salt, p.blockSize);
  const unlock = async (block, value, length) =>
    (
      await decryptCBC(
        fit(await digest(p.hash, h, new Uint8Array(block)), p.keyBytes),
        iv,
        base64(value),
      )
    ).subarray(0, length);
  const input = await unlock(VERIFIER_INPUT_BLOCK, p.encryptedVerifierHashInput, p.salt.length);
  const expected = await unlock(VERIFIER_VALUE_BLOCK, p.encryptedVerifierHashValue, p.hashSize);
  const actual = (await digest(p.hash, input)).subarray(0, p.hashSize);
  if (!equal(actual, expected)) throw Error(WRONG_PASSWORD);
  const key = await unlock(KEY_BLOCK, p.encryptedKeyValue, p.keyBytes);

  const { size, end } = packageParts(data);
  const parts = [];
  for (let offset = 8, i = 0; offset < end; offset += SEGMENT, i++) {
    const segmentIV = fit(await digest(keyData.hash, keyData.salt, uint32(i)), keyData.blockSize);
    parts.push(
      await decryptCBC(key, segmentIV, data.subarray(offset, Math.min(offset + SEGMENT, end))),
    );
  }
  return concat(...parts).subarray(0, size);
}

async function decryptStandard(p, password) {
  const h = await hashPassword("SHA-1", p.salt, password, 50_000);
  const final = await digest("SHA-1", h, uint32(0));
  const derive = (fill) =>
    digest(
      "SHA-1",
      new Uint8Array(64).fill(fill).map((b, i) => (i < final.length ? b ^ final[i] : b)),
    );
  const key = concat(await derive(0x36), await derive(0x5c)).subarray(0, p.keyBits / 8);

  const verifier = await decryptECB(key, p.verifier);
  const expected = (await decryptECB(key, p.verifierHash)).subarray(0, 20);
  if (!equal(await digest("SHA-1", verifier), expected)) throw Error(WRONG_PASSWORD);

  const { size, end } = packageParts(p.data);
  return (await decryptECB(key, p.data.subarray(8, end))).subarray(0, size);
}

// --- .xls ---

const BOF = 0x0809;
const EOF = 0x000a;
const FILE_PASS = 0x002f;
const BOUND_SHEET = 0x0085;
const EXCEL9_FILE = 0x01c0;
// Records that are never encrypted: BOF, FilePass, UsrExcl, FileLock, InterfaceHdr, RRDInfo and
// RRDHead. BoundSheet8's first 4 bytes (the sheet's stream position) aren't either.
const PLAIN_RECORDS = new Set([BOF, FILE_PASS, 0x0194, 0x0195, 0x00e1, 0x0196, 0x0138]);
const RC4_BLOCK = 1024;

function* records(workbook) {
  const v = view(workbook);
  for (let pos = 0; pos + 4 <= workbook.length;) {
    const type = v.getUint16(pos, true);
    const size = v.getUint16(pos + 2, true);
    yield { type, pos, start: pos + 4, end: Math.min(pos + 4 + size, workbook.length) };
    pos += 4 + size;
  }
}

// FilePass sits in the workbook globals, which end at the first EOF record.
function findFilePass(workbook) {
  for (const r of records(workbook)) {
    if (r.type === FILE_PASS) return workbook.subarray(r.start, r.end);
    if (r.type === EOF) break;
  }
  return null;
}

function parseFilePass(record) {
  const v = view(record);
  // Type 0 is the XOR obfuscation Excel called "weak encryption"; it was rarely used.
  if (v.getUint16(0, true) !== 1) throw Error(UNSUPPORTED);
  const major = v.getUint16(2, true);
  const minor = v.getUint16(4, true);
  if (major === 1 && minor === 1) {
    if (record.length < 54) throw Error(UNREADABLE);
    return {
      kind: "rc4",
      salt: record.subarray(6, 22),
      verifier: record.subarray(22, 38),
      verifierHash: record.subarray(38, 54),
    };
  }
  if ((major === 2 || major === 3 || major === 4) && minor === 2) {
    const p = parseCryptoAPI(record, 6, 20);
    if (p.algId !== 0x6801 || (p.algIdHash !== 0 && p.algIdHash !== 0x8004))
      throw Error(UNSUPPORTED);
    const keyBits = p.keyBits || 40;
    if (keyBits < 40 || keyBits > 128 || keyBits % 8) throw Error(UNSUPPORTED);
    return { kind: "rc4-cryptoapi", ...p, keyBits };
  }
  throw Error(UNSUPPORTED);
}

function rc4(key, length) {
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
}

const MD5_SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));

// RFC 1321. Only used on short inputs.
export function md5(bytes) {
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const v = view(padded);
  v.setUint32(padded.length - 8, (bytes.length * 8) >>> 0, true);
  v.setUint32(padded.length - 4, Math.floor(bytes.length / 2 ** 29), true);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let o = 0; o < padded.length; o += 64) {
    let [a, b, c, d] = h;
    for (let i = 0; i < 64; i++) {
      const round = i >> 4;
      const f = [(b & c) | (~b & d), (d & b) | (~d & c), b ^ c ^ d, c ^ (b | ~d)][round];
      const g = [i, 5 * i + 1, 3 * i + 5, 7 * i][round] % 16;
      const x = (a + f + MD5_K[i] + v.getUint32(o + g * 4, true)) | 0;
      const s = MD5_SHIFTS[round * 4 + (i % 4)];
      [a, d, c, b] = [d, c, b, (b + ((x << s) | (x >>> (32 - s)))) | 0];
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
  }
  const out = new Uint8Array(16);
  h.forEach((word, i) => view(out).setUint32(i * 4, word, true));
  return out;
}

// Returns a function giving the RC4 key for each 1024-byte block of the stream.
async function xlsKeys(p, password) {
  if (p.kind === "rc4") {
    const truncated = md5(utf16(password)).subarray(0, 5);
    const h1 = md5(concat(...Array(16).fill(concat(truncated, p.salt)))).subarray(0, 5);
    return async (block) => md5(concat(h1, uint32(block)));
  }
  const h0 = await digest("SHA-1", p.salt, utf16(password));
  // 40-bit keys are padded with zeros to 128 bits.
  return async (block) =>
    fit((await digest("SHA-1", h0, uint32(block))).subarray(0, p.keyBits / 8), 16, 0);
}

async function decryptXLS(p, password) {
  const keyFor = await xlsKeys(p, password);
  const hash = p.kind === "rc4" ? md5 : null;
  const plain = concat(p.verifier, p.verifierHash);
  const keystream = rc4(await keyFor(0), plain.length);
  plain.forEach((b, i) => (plain[i] = b ^ keystream[i]));
  const verifier = plain.subarray(0, 16);
  const actual = hash ? hash(verifier) : await digest("SHA-1", verifier);
  if (!equal(actual, plain.subarray(16))) throw Error(WRONG_PASSWORD);

  // The stream is encrypted as a whole, rekeyed every 1024 bytes, but record headers and the
  // records above are left as they are.
  const workbook = Uint8Array.from(p.workbook);
  let block = -1;
  let key;
  for (const r of records(p.workbook)) {
    if (r.type === FILE_PASS) {
      // SheetJS refuses files with a FilePass record, so it becomes an empty record it ignores.
      view(workbook).setUint16(r.pos, EXCEL9_FILE, true);
      workbook.fill(0, r.start, r.end);
    }
    if (PLAIN_RECORDS.has(r.type)) continue;
    for (let i = r.type === BOUND_SHEET ? r.start + 4 : r.start; i < r.end; i++) {
      if (Math.floor(i / RC4_BLOCK) !== block) {
        block = Math.floor(i / RC4_BLOCK);
        key = rc4(await keyFor(block), RC4_BLOCK);
      }
      workbook[i] ^= key[i % RC4_BLOCK];
    }
  }

  const cfb = CFB.read(p.bytes, { type: "array" });
  CFB.utils.cfb_add(cfb, "/Workbook", workbook);
  return new Uint8Array(CFB.write(cfb, { type: "array" }));
}
