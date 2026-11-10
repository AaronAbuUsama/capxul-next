/** A file of the built app by its path under a folder, or null: never one outside the folder. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".gif": "image/gif", ".webm": "video/webm", ".cast": "application/x-asciicast", ".jsonl": "application/x-ndjson", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".ico": "image/x-icon", ".map": "application/json; charset=utf-8",
};

export const fileUnder = (dir: string, path: string): { readonly type: string; readonly body: Uint8Array } | null => {
  const root = resolve(dir), full = resolve(root, path);
  if (!full.startsWith(root + sep) || !existsSync(full) || !statSync(full).isFile()) return null;
  return { type: TYPES[extname(full)] ?? "application/octet-stream", body: readFileSync(full) };
};

/**
 * The part of a file a `Range: bytes=a-b` header asks for, or all of it. A phone's video player asks for a file in
 * parts and plays nothing when it is refused.
 */
export const ranged = (body: Uint8Array, range: string | undefined): { readonly status: 200 | 206 | 416; readonly body: Uint8Array; readonly headers: Readonly<Record<string, string>> } => {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return { status: 200, body, headers: { "accept-ranges": "bytes" } };
  const from = m[1] === "" ? Math.max(0, body.length - Number(m[2])) : Number(m[1]), to = m[1] === "" || m[2] === "" ? body.length - 1 : Math.min(Number(m[2]), body.length - 1);
  if (from > to || from >= body.length) return { status: 416, body: new Uint8Array(), headers: { "content-range": `bytes */${body.length}` } };
  return { status: 206, body: body.subarray(from, to + 1), headers: { "accept-ranges": "bytes", "content-range": `bytes ${from}-${to}/${body.length}` } };
};
