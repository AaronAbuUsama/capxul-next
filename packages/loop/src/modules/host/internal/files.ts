/** A file of the built app by its path under a folder, or null: never one outside the folder. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".ico": "image/x-icon", ".map": "application/json; charset=utf-8",
};

export const fileUnder = (dir: string, path: string): { readonly type: string; readonly body: Uint8Array } | null => {
  const root = resolve(dir), full = resolve(root, path);
  if (!full.startsWith(root + sep) || !existsSync(full) || !statSync(full).isFile()) return null;
  return { type: TYPES[extname(full)] ?? "application/octet-stream", body: readFileSync(full) };
};
