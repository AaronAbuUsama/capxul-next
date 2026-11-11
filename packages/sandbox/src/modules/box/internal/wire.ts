/**
 * How values of pi-durable's `ExecutionEnv` cross HTTP as JSON: bytes as base64, its two error classes by code, an
 * opened reader as a handle the server keeps. Both ends use this file.
 */
import { ExecutionError, FileError } from "@earendil-works/pi-durable/env";

type Wired = null | boolean | number | string | Wired[] | { [k: string]: Wired };

export const encode = (v: unknown): Wired => {
  if (v === undefined || v === null) return null;
  if (v instanceof Uint8Array) return { $b: Buffer.from(v).toString("base64") };
  if (v instanceof FileError) return { $fe: { code: v.code, message: v.message, ...(v.path !== undefined ? { path: v.path } : {}) } };
  if (v instanceof ExecutionError) return { $ee: { code: v.code, message: v.message, ...(v.spillPath !== undefined ? { spillPath: v.spillPath } : {}) } };
  if (Array.isArray(v)) return v.map(encode);
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined && typeof x !== "function").map(([k, x]) => [k, encode(x)]));
  return v as Wired;
};

export const decode = (v: unknown): unknown => {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) return v.map(decode);
  if (typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  if (typeof o.$b === "string") return new Uint8Array(Buffer.from(o.$b, "base64"));
  if (o.$fe && typeof o.$fe === "object") { const e = o.$fe as { code: FileError["code"]; message: string; path?: string }; return new FileError(e.code, e.message, e.path); }
  if (o.$ee && typeof o.$ee === "object") { const e = o.$ee as { code: ExecutionError["code"]; message: string; spillPath?: string }; const x = new ExecutionError(e.code, e.message); if (e.spillPath) x.spillPath = e.spillPath; return x; }
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]));
};

/** A chunk of a command's output, as the server buffers it and the client replays it into `onOutput`. */
export interface Chunk { readonly t: string; readonly s: "stdout" | "stderr"; readonly k?: { bytes: number; newlines: number; endsWithNewline: boolean } }

/** The env methods that open something the server keeps; their value comes back as `{ $h: id }`. */
export const OPENERS = new Set(["openTextLineReader", "openBinaryReader", "openDirReader"]);
/** Variables that describe the machine, not the run: the box's own always win over the caller's. */
export const MACHINE = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR"] as const;
