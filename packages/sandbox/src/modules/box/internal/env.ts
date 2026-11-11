/**
 * pi-durable's `ExecutionEnv`, answered by the server in a box. Every method is one HTTP call; an opened reader is a
 * handle the server keeps; a command runs in the background there and its output is polled and replayed into
 * `onOutput`, so a long gate never holds a request open. A link that fails becomes the method's own error value.
 */
import type { Context } from "@earendil-works/chord";
import { ExecutionError, FileError, type BinaryReader, type DirReader, type ExecutionEnv, type FileChange, type FileInfo, type FileListing, type FileWatcher, type LineScan, type ListFilesOptions, type Result, type ShellExecOptions, type ShellExecResult, type TextLine, type TextLineReader, type WatchTarget } from "@earendil-works/pi-durable/env";
import type { Link } from "../types.ts";
import { decode, encode, type Chunk } from "./wire.ts";

type R<T> = Promise<Result<T, FileError>>;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const request = async (link: Link, method: string, path: string, payload?: unknown, signal?: AbortSignal): Promise<unknown> => {
  const res = await fetch(`${link.url}${path}`, {
    method, headers: { ...link.headers, ...(payload !== undefined ? { "content-type": "application/json" } : {}) },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}), ...(signal ? { signal } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`the box answered ${res.status} to ${method} ${path}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
};

const handleOf = (v: unknown): string => (v as { $h: string }).$h;

export class BoxEnv implements ExecutionEnv {
  readonly id: string;
  cwd: string;
  readonly #link: Link;
  /** What every command sees, besides its call's own variables: nothing of this machine's is inherited. */
  readonly #vars: Readonly<Record<string, string>>;
  constructor(link: Link, cwd: string, vars: Readonly<Record<string, string>> = {}) { this.#link = link; this.cwd = cwd; this.#vars = vars; this.id = `box:${link.url}`; }

  async #call<T>(method: string, args: unknown[], handle: string | undefined, context: Context): R<T> {
    if (context.abortSignal?.aborted) return { ok: false, error: new FileError("aborted", `${method} was aborted`) };
    try { return decode(await request(this.#link, "POST", "/call", { cwd: this.cwd, method, args: encode(args), ...(handle ? { handle } : {}) })) as Result<T, FileError>; }
    catch (e) { return { ok: false, error: new FileError("unknown", e instanceof Error ? e.message : String(e)) }; }
  }

  async #open<T>(method: string, args: unknown[], context: Context, wrap: (h: string) => T): R<T> {
    const r = await this.#call<unknown>(method, args, undefined, context);
    return r.ok ? { ok: true, value: wrap(handleOf(r.value)) } : r;
  }

  absolutePath(path: string, _c: Context): R<string> { return this.#call("absolutePath", [path], undefined, _c); }
  joinPath(parts: string[], _c: Context): R<string> { return this.#call("joinPath", [parts], undefined, _c); }
  readTextFile(path: string, _c: Context): R<string> { return this.#call("readTextFile", [path], undefined, _c); }
  readTextLines(path: string, options: { maxLines?: number } | undefined, _c: Context): R<string[]> { return this.#call("readTextLines", [path, options], undefined, _c); }
  readBinaryFile(path: string, _c: Context): R<Uint8Array> { return this.#call("readBinaryFile", [path], undefined, _c); }
  writeFile(path: string, content: string | Uint8Array, _c: Context): R<void> { return this.#call("writeFile", [path, content], undefined, _c); }
  appendFile(path: string, content: string | Uint8Array, _c: Context): R<void> { return this.#call("appendFile", [path, content], undefined, _c); }
  truncateFile(path: string, size: number, _c: Context): R<void> { return this.#call("truncateFile", [path, size], undefined, _c); }
  flushFile(path: string, _c: Context): R<void> { return this.#call("flushFile", [path], undefined, _c); }
  renameFile(from: string, to: string, _c: Context): R<void> { return this.#call("renameFile", [from, to], undefined, _c); }
  fileInfo(path: string, _c: Context): R<FileInfo> { return this.#call("fileInfo", [path], undefined, _c); }
  listDir(path: string, _c: Context): R<FileInfo[]> { return this.#call("listDir", [path], undefined, _c); }
  listFiles(path: string, options: ListFilesOptions | undefined, _c: Context): R<FileListing> { return this.#call("listFiles", [path, options], undefined, _c); }
  canonicalPath(path: string, _c: Context): R<string> { return this.#call("canonicalPath", [path], undefined, _c); }
  exists(path: string, _c: Context): R<boolean> { return this.#call("exists", [path], undefined, _c); }
  createDir(path: string, options: { recursive?: boolean } | undefined, _c: Context): R<void> { return this.#call("createDir", [path, options], undefined, _c); }
  remove(path: string, options: { recursive?: boolean; force?: boolean } | undefined, _c: Context): R<void> { return this.#call("remove", [path, options], undefined, _c); }
  createTempDir(prefix: string | undefined, _c: Context): R<string> { return this.#call("createTempDir", [prefix], undefined, _c); }
  createTempFile(options: { prefix?: string; suffix?: string } | undefined, _c: Context): R<string> { return this.#call("createTempFile", [options], undefined, _c); }
  async cleanup(_c: Context): Promise<void> { /* the box goes away with its run */ }

  /** Watching files over a link is not offered: hosts that need it fall back to reading again. */
  async watch(_t: readonly WatchTarget[], _on: (change: FileChange) => void, _c: Context): R<FileWatcher> {
    return { ok: false, error: new FileError("not_supported", "a box does not report file changes") };
  }

  openTextLineReader(path: string, _c: Context): R<TextLineReader> {
    return this.#open("openTextLineReader", [path], _c, (h) => ({
      readLine: (_x: Context) => this.#call<TextLine | undefined>("readLine", [], h, _x),
      close: async (_x: Context) => { await this.#call("close", [], h, _x); },
    }));
  }

  openBinaryReader(path: string, options: { noFollow?: boolean } | undefined, _c: Context): R<BinaryReader> {
    return this.#open("openBinaryReader", [path, options], _c, (h) => ({
      info: (_x: Context) => this.#call<FileInfo>("info", [], h, _x),
      read: (offset: number, length: number, _x: Context) => this.#call<Uint8Array>("read", [offset, length], h, _x),
      scanLines: (o: { startLine: number; endLine?: number }, _x: Context) => this.#call<LineScan>("scanLines", [o], h, _x),
      close: async (_x: Context) => { await this.#call("close", [], h, _x); },
    }));
  }

  openDirReader(path: string, _c: Context): R<DirReader> {
    return this.#open("openDirReader", [path], _c, (h) => ({
      next: (max: number, _x: Context) => this.#call<{ entries: FileInfo[]; done: boolean }>("next", [max], h, _x),
      close: async (_x: Context) => { await this.#call("close", [], h, _x); },
    }));
  }

  async exec(command: string | readonly string[], options: ShellExecOptions | undefined, context: Context): Promise<Result<ShellExecResult, ExecutionError>> {
    const { onOutput, ...rest } = options ?? {};
    let id: string;
    try { id = (await request(this.#link, "POST", "/exec", { cwd: this.cwd, command, options: encode({ ...rest, env: { ...this.#vars, ...rest.env } }) }) as { id: string }).id; }
    catch (e) { return { ok: false, error: new ExecutionError("spawn_error", e instanceof Error ? e.message : String(e)) }; }
    let from = 0, failures = 0, killed = false;
    for (let wait = 50; ; wait = Math.min(wait * 2, 1000)) {
      if (context.abortSignal?.aborted && !killed) { killed = true; await request(this.#link, "POST", `/exec/${id}/kill`).catch(() => undefined); }
      let got: { chunks: Chunk[]; end?: unknown };
      try { got = await request(this.#link, "GET", `/exec/${id}?from=${from}`) as typeof got; failures = 0; }
      catch (e) {
        // A link that drops for a moment is waited out; one that stays down ends the command as an error.
        if (++failures > 30) return { ok: false, error: new ExecutionError("unknown", `lost the box while it ran the command: ${e instanceof Error ? e.message : String(e)}`) };
        await sleep(1000); continue;
      }
      from += got.chunks.length;
      for (const c of got.chunks) onOutput?.(c.t, context, { stream: c.s, ...(c.k ? { skipped: c.k } : {}) });
      if (got.end !== undefined) return decode(got.end) as Result<ShellExecResult, ExecutionError>;
      if (got.chunks.length > 0) wait = 50;
      await sleep(wait);
    }
  }
}
