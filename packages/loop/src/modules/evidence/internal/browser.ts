/**
 * A headless browser the agent drives through agent-browser's command line, held to the hosts the caller allows (the
 * sandbox and this machine, never the internet). `browse` is the driving; `screenshot` and `recordScreen` are the two
 * captures (a recording is the frames after each action, joined by ffmpeg). One browser session per step, closed when the step ends.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceDeps } from "../types.ts";
import { captureOf, idOf, keep, refuseName, size } from "./store.ts";
import type { Made } from "./terminal.ts";

const no = (text: string): Made => ({ ok: false, text });
const NONE = "This agent has no browser: nothing it could open is running, or agent-browser is not installed.";

/** What an agent may tell the browser to do. Not `eval`, `connect`, `upload`, `download`, `cookies`, `auth` or `network`: those reach past the page. */
const ACTIONS = new Set(["open", "snapshot", "click", "dblclick", "type", "fill", "press", "hover", "focus", "check", "uncheck", "select", "scroll", "scrollintoview", "wait", "get", "is", "find", "back", "forward", "reload", "console", "errors", "tab"]);

const hostOk = (host: string, hosts: readonly string[]): boolean => hosts.some((h) => (h.startsWith("*.") ? host.endsWith(h.slice(1)) : host === h));

/** Why the browser may not open this address, or undefined: http or https, on one of the allowed hosts. */
export const refuseUrl = (url: string, hosts: readonly string[]): string | undefined => {
  let u: URL;
  try { u = new URL(url); } catch { return `${url} is not an address`; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return `only http and https addresses may be opened, not ${u.protocol}`;
  return hostOk(u.hostname, hosts) ? undefined : `${u.hostname} is not a host this agent may open: it may open ${hosts.join(", ")}`;
};

/** Why these words may not be given to the browser, or undefined. Pure: the tests call it. */
export const refuseBrowser = (args: readonly string[], hosts: readonly string[]): string | undefined => {
  const [action, ...rest] = args;
  if (!action || !ACTIONS.has(action)) return `\`${action ?? ""}\` is not something this agent may tell the browser: it may ${[...ACTIONS].join(", ")}`;
  if (rest.some((a) => a.startsWith("--"))) return "no long options: give the action and its arguments only";
  if (action === "get" && rest[0] === "cdp-url") return "the browser's debugging address is not given out";
  for (const a of rest) if (/^[a-z][a-z0-9+.-]*:/i.test(a) && (action === "open" || action === "tab")) { const why = refuseUrl(a, hosts); if (why) return why; }
  if (action === "open" && rest.length === 0) return "open needs an address";
  return undefined;
};

/** The session's name: one browser per step of a run, and no other run's. */
const sessionOf = (deps: EvidenceDeps): string => `loop-${createHash("sha256").update(`${deps.dir}\n${deps.by}`).digest("hex").slice(0, 12)}`;
const run = (deps: EvidenceDeps, args: readonly string[], timeoutMs = 120_000) =>
  deps.exec(deps.tooling.browser!, ["--session", sessionOf(deps), "--allowed-domains", deps.hosts.join(","), ...args], { cwd: deps.dir, env: deps.env, timeoutMs });
const has = (deps: EvidenceDeps): boolean => deps.tooling.browser !== null && deps.hosts.length > 0;

/** What one step's browser is doing, kept by the tools between calls: whether it was opened, and the recording under way. */
export interface Browsing { opened: boolean; recording: { readonly name: string; readonly since: number; frames: number } | null }

/**
 * A recording of the browser is a frame after each action, joined into one animated GIF: each step is on screen long
 * enough to read, and it plays everywhere a picture does. agent-browser's own recorder (0.31.1) is not used: after a
 * navigation its encoder hung until it was killed and kept no file, in two runs of three on 10 November 2026.
 */
const FRAMES = (deps: EvidenceDeps, id: string): string => join(deps.dir, `.frames-${id}`);
const SECONDS_A_FRAME = 1.5;
const frame = async (deps: EvidenceDeps, at: Browsing): Promise<void> => {
  if (!at.recording) return;
  await run(deps, ["wait", "400"]);                                       // let the page draw what the action changed
  const file = join(FRAMES(deps, idOf(deps.by, at.recording.name)), `${String(at.recording.frames).padStart(3, "0")}.png`);
  if ((await run(deps, ["screenshot", file])).code === 0 && existsSync(file)) at.recording.frames++;
};

export const browse = async (deps: EvidenceDeps, at: Browsing, a: { args?: unknown }): Promise<Made> => {
  if (!has(deps)) return no(NONE);
  const args = Array.isArray(a.args) ? a.args.map(String) : [];
  const why = refuseBrowser(args, deps.hosts);
  if (why) return no(`Refused by the loop's policy: ${why}`);
  mkdirSync(deps.dir, { recursive: true });
  at.opened = true;
  const r = await run(deps, args);
  await frame(deps, at);
  return { ok: r.code === 0, text: r.out.trim().slice(-8000) || (r.code === 0 ? "done" : `the browser ended with ${r.code}`) };
};

const page = async (deps: EvidenceDeps): Promise<{ url: string; title: string }> => {
  const [url, title] = [await run(deps, ["get", "url"]), await run(deps, ["get", "title"])];
  return { url: url.out.trim().split("\n").at(-1) ?? "", title: title.out.trim().split("\n").at(-1) ?? "" };
};

const fresh = (deps: EvidenceDeps, name: unknown): { id: string } | { no: Made } => {
  if (!has(deps)) return { no: no(NONE) };
  const bad = refuseName(name);
  if (bad) return { no: no(bad) };
  const id = idOf(deps.by, name as string);
  return captureOf(deps.dir, id) ? { no: no(`there is already a capture named ${id}: give this one another name`) } : { id };
};

export const screenshot = async (deps: EvidenceDeps, at: Browsing, a: { name?: unknown; full?: unknown }): Promise<Made> => {
  const f = fresh(deps, a.name);
  if ("no" in f) return f.no;
  at.opened = true;
  mkdirSync(deps.dir, { recursive: true });
  const file = `${f.id}.png`, t0 = deps.now().getTime();
  const r = await run(deps, ["screenshot", join(deps.dir, file), ...(a.full === true ? ["--full"] : [])]);
  if (r.code !== 0 || !existsSync(join(deps.dir, file))) return no(`no screenshot was taken (open a page first): ${r.out.trim().slice(-300)}`);
  const capture = keep(deps, { id: f.id, kind: "screenshot", ms: deps.now().getTime() - t0, source: await page(deps), names: [file] });
  return { ok: true, capture, text: `Taken as capture ${f.id}: ${file} (${size(capture.files[0]!.bytes)}) of ${"url" in capture.source ? `${capture.source.title} at ${capture.source.url}` : ""}.` };
};

/** `start` begins a recording and `stop` ends it and keeps the capture: one frame for where it started, one after each `browser` action. */
export const recordScreen = async (deps: EvidenceDeps, at: Browsing, a: { name?: unknown; action?: unknown }): Promise<Made> => {
  if (a.action !== "start" && a.action !== "stop") return no("action is start or stop");
  if (!has(deps)) return no(NONE);
  if (!deps.tooling.ffmpeg) return no("Recording the browser is not available on this machine: ffmpeg is not installed. Take a screenshot of each step instead.");
  const bad = refuseName(a.name);
  if (bad) return no(bad);
  const name = a.name as string, id = idOf(deps.by, name), file = `${id}.gif`, frames = FRAMES(deps, id);
  if (captureOf(deps.dir, id)) return no(`there is already a capture named ${id}: give this one another name`);
  at.opened = true;
  if (a.action === "start") {
    if (at.recording) return no(`the recording ${at.recording.name} is still running: stop it first`);
    rmSync(frames, { recursive: true, force: true });
    mkdirSync(frames, { recursive: true });
    at.recording = { name, since: deps.now().getTime(), frames: 0 };
    await frame(deps, at);
    if (at.recording.frames === 0) { at.recording = null; return no("the recording did not start: open a page first"); }
    return { ok: true, text: `Recording the browser: a frame is kept after each browser action. Do what is to be shown, then call record_screen with action stop and the name ${name}.` };
  }
  if (at.recording?.name !== name) return no(at.recording ? `the recording under way is ${at.recording.name}, not ${name}` : `no recording named ${name} is running: start it first`);
  const { since, frames: count } = at.recording, on = await page(deps);
  at.recording = null;
  const made = await deps.exec(deps.tooling.ffmpeg, ["-y", "-nostdin", "-loglevel", "error", "-framerate", String(1 / SECONDS_A_FRAME), "-i", join(frames, "%03d.png"),
    "-vf", "scale=1280:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=160[p];[b][p]paletteuse", "-loop", "0", join(deps.dir, file)], { cwd: deps.dir, env: deps.env, timeoutMs: 120_000 });
  rmSync(frames, { recursive: true, force: true });
  if (made.code !== 0 || !existsSync(join(deps.dir, file))) return no(`the frames could not be joined: ${made.out.trim().slice(-300)}`);
  const capture = keep(deps, { id, kind: "screen-recording", ms: deps.now().getTime() - since, source: on, names: [file] });
  return { ok: true, capture, text: `Kept as capture ${id}: ${file} (${count} frames, ${size(capture.files[0]!.bytes)}).` };
};

/** Closes this step's browser, if it opened one. Never throws. */
export const closeBrowser = async (deps: EvidenceDeps, at: Browsing): Promise<void> => { if (has(deps) && at.opened) await run(deps, ["close"], 20_000).catch(() => undefined); };
