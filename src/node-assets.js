// Module hooks so tests can import modules that use Vite `?url` asset imports.
// Importing this file registers it; the asset becomes a data: URL, which fetch() reads in Node.
import { register } from "node:module";
import { readFile } from "node:fs/promises";
import { isMainThread } from "node:worker_threads";

export async function resolve(specifier, context, next) {
  if (!specifier.endsWith("?url")) return next(specifier, context);
  const { url } = await next(specifier.slice(0, -4), context);
  return { url: `${url}?url`, shortCircuit: true };
}

export async function load(url, context, next) {
  if (!url.endsWith("?url")) return next(url, context);
  const data = await readFile(new URL(url.slice(0, -4)));
  const source = `export default "data:application/octet-stream;base64,${data.toString("base64")}";`;
  return { format: "module", source, shortCircuit: true };
}

if (isMainThread) register(import.meta.url);
