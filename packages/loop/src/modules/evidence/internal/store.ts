/** The evidence folder: files by name, and `captures.jsonl`, one capture a line, only ever added to. */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MAX_NAME, type Capture, type CaptureFile, type EvidenceDeps } from "../types.ts";

const MANIFEST = "captures.jsonl";
const TYPES: Readonly<Record<string, string>> = { gif: "image/gif", png: "image/png", webm: "video/webm", cast: "application/x-asciicast" };

/** Why a name cannot be a capture's, or undefined: short, lower case, digits and dashes, so it is a file name and an id on every system. */
export const refuseName = (name: unknown): string | undefined =>
  typeof name === "string" && new RegExp(`^[a-z0-9][a-z0-9-]{0,${MAX_NAME - 1}}$`).test(name) ? undefined
    : `a capture's name is 1 to ${MAX_NAME} lower-case letters, digits and dashes, such as pay-refuses-overdraft`;

/** A step's name as part of a file name: `reviewer.1.reviewer.agent` stays readable, anything odd becomes a dash. */
export const idOf = (by: string, name: string): string => `${by.replace(/[^A-Za-z0-9.-]/g, "-")}.${name}`;

export const captureOf = (dir: string, id: string): Capture | undefined => capturesOf(dir).find((c) => c.id === id);

/** Every capture of the run, oldest first. A line that is not a capture is skipped: the folder is read by many. */
export const capturesOf = (dir: string): Capture[] => {
  const file = join(dir, MANIFEST);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap((line) => {
    try { const c = JSON.parse(line) as Capture; return typeof c.id === "string" && Array.isArray(c.files) ? [c] : []; } catch { return []; }
  });
};

/** A file of the folder as the record names it: its type by its ending, its size and its hash. */
export const fileOf = (dir: string, name: string): CaptureFile => {
  const body = readFileSync(join(dir, name));
  return { name, type: TYPES[name.split(".").at(-1) ?? ""] ?? "application/octet-stream", bytes: statSync(join(dir, name)).size, sha256: createHash("sha256").update(body).digest("hex") };
};

/** Writes the capture's record. The files are already in the folder; a name with no file is left out. */
export const keep = (deps: EvidenceDeps, c: Omit<Capture, "files" | "by" | "at"> & { readonly names: readonly string[] }): Capture => {
  mkdirSync(deps.dir, { recursive: true });
  const { names, ...rest } = c;
  const capture: Capture = { ...rest, by: deps.by, at: deps.now().toISOString(), files: names.filter((n) => existsSync(join(deps.dir, n))).map((n) => fileOf(deps.dir, n)) };
  appendFileSync(join(deps.dir, MANIFEST), `${JSON.stringify(capture)}\n`);
  return capture;
};

export const size = (bytes: number): string => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : bytes >= 1e3 ? `${Math.round(bytes / 1e3)} KB` : `${bytes} B`);
