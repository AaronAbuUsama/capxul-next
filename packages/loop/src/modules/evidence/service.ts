/**
 * GENERIC. The evidence module's door: the tools an agent makes captures with, the captures of a run, and the judgment
 * of an agent's claims against them. See types.ts for the two records and why they are apart.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
import { browse, closeBrowser, recordScreen, screenshot, type Browsing } from "./internal/browser.ts";
import { capturesOf, idOf } from "./internal/store.ts";
import { recordTerminal, type Made } from "./internal/terminal.ts";
import type { Capture, EvidenceDeps, Exec, Judged, Tooling } from "./types.ts";

export type * from "./types.ts";
export { FOLDER, MAX_NAME, MAX_OUTPUT, TOOL_NAMES } from "./types.ts";
export { capturesOf, fileOf } from "./internal/store.ts";
export { refuseBrowser, refuseUrl } from "./internal/browser.ts";
export { textOfCast } from "./internal/terminal.ts";

/** Where each program is on this `PATH`, or null. */
export const toolingOf = (path: string | undefined): Tooling => {
  const find = (name: string): string | null => (path ?? "").split(delimiter).filter(Boolean).map((d) => join(d, name)).find((f) => existsSync(f)) ?? null;
  return { asciinema: find("asciinema"), agg: find("agg"), browser: find("agent-browser"), ffmpeg: find("ffmpeg") };
};

/** Runs a program with exactly the environment it is given, no shell and no input, and collects what it printed. */
export const nodeExec: Exec = (file, args, o) => new Promise((done) => {
  // Its own process group, so that stopping it stops what it started too (a recorder's shell, the command under it).
  const child = spawn(file, [...args], { cwd: o.cwd, env: { ...o.env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const kill = (how: NodeJS.Signals): void => { try { process.kill(-child.pid!, how); } catch { /* gone */ } };
  const stop = (): void => { kill("SIGTERM"); setTimeout(() => kill("SIGKILL"), 2000).unref(); };
  if (o.signal?.aborted) stop(); else o.signal?.addEventListener("abort", stop, { once: true });
  let out = "";
  const add = (b: Buffer): void => { out = (out + b.toString("utf8")).slice(-200_000); };
  child.stdout.on("data", add);
  child.stderr.on("data", add);
  const timer = setTimeout(() => kill("SIGKILL"), o.timeoutMs);
  child.on("error", (e) => { clearTimeout(timer); done({ code: 127, out: `${out}${e.message}` }); });
  child.on("close", (code) => { clearTimeout(timer); o.signal?.removeEventListener("abort", stop); done({ code: code ?? 137, out }); });
});

const text = (s: string) => ({ type: "string", description: s });
const tool = (name: string, description: string, properties: Record<string, object>, required: string[], run: (args: Record<string, unknown>, signal: AbortSignal | undefined) => Promise<Made>): ToolRegistration =>
  defineTool({
    name, description, parameters: { type: "object", properties, required },
    execute: async (args: Record<string, unknown>, _api: unknown, context: { readonly abortSignal?: AbortSignal | undefined }) => { const made = await run(args, context?.abortSignal); return { output: [{ type: "text" as const, text: made.text }], ...(made.ok ? {} : { isError: true }) }; },
  }) as unknown as ToolRegistration;

/**
 * The tools for one step's agent, and `close` for when the step ends (it shuts the browser the step opened). Every agent
 * gets `record_terminal`; the three browser tools are made only when there is a browser and a host it may open.
 */
export const evidenceTools = (deps: EvidenceDeps): { readonly tools: ToolRegistration[]; readonly close: () => Promise<void> } => {
  const at: Browsing = { opened: false, recording: null };
  /** The same deps for one call: its programs die when the agent is stopped, and what it was making is not kept. */
  const during = (signal: AbortSignal | undefined): EvidenceDeps => (signal ? { ...deps, exec: (file, args, o) => deps.exec(file, args, { ...o, signal }), stopped: () => signal.aborted } : deps);
  const withBrowser = <A>(run: (deps: EvidenceDeps, at: Browsing, a: A) => Promise<Made>) => (a: Record<string, unknown>, signal: AbortSignal | undefined): Promise<Made> => run(during(signal), at, a as A);
  const name = text("A short name for this capture: lower-case letters, digits and dashes, such as pay-refuses-overdraft. It becomes the capture's id.");
  const tools = [
    tool("record_terminal",
      "Run one command in a terminal and record it, as evidence. Returns the command's output and exit code, and the id of the capture (a GIF a person can watch). Use it instead of bash for a command whose run is itself the proof: a check passing, a command refusing what it must refuse. Then name the capture in the `evidence` list of your final json.",
      { name, command: text("The command to run and record, as you would give it to bash.") }, ["name", "command"], (a, signal) => recordTerminal(during(signal), a)),
    ...(deps.tooling.browser && deps.hosts.length > 0 ? [
      tool("browser",
        `Drive a headless browser: one action per call, as words. It may open only ${deps.hosts.join(", ")}. Actions: open <url>; snapshot -i (the page's interactive elements with refs such as @e2); click <ref|selector>; fill <ref|selector> <text>; type, press <key>, hover, check, uncheck, select, scroll <dir> [px], wait <selector|ms>; get text|html|value|title|url [selector]; is visible|enabled|checked <selector>; back, forward, reload; console, errors.`,
        { args: { type: "array", items: { type: "string" }, description: 'The action and its arguments, one word each, such as ["open", "http://127.0.0.1:4000/"] or ["click", "@e2"].' } }, ["args"], withBrowser(browse)),
      tool("screenshot",
        "Take a screenshot of the page the browser is on, as evidence. Returns the capture's id. Then name the capture in the `evidence` list of your final json.",
        { name, full: { type: "boolean", description: "The whole page, not only what fits the window." } }, ["name"], withBrowser(screenshot)),
      tool("record_screen",
        "Record several steps in the browser as one animated picture, as evidence of something that takes more than one step: a frame is kept after each browser action. Call it with action start, do the steps with browser, then call it with action stop and the same name. Returns the capture's id on stop.",
        { name, action: { type: "string", enum: ["start", "stop"] } }, ["name", "action"], withBrowser(recordScreen)),
    ] : []),
  ];
  return { tools, close: () => closeBrowser(deps, at) };
};

/**
 * An agent's claims, judged. `claims` is whatever the agent wrote under `evidence`. A claim stands when it names a
 * capture of this run (by its id, or by the name the agent gave it in step `by`), says what it shows, and, if it names
 * an eval and the task has evals, names one of them. The capture's id comes back whole either way.
 */
export const judge = (claims: unknown, captures: readonly Capture[], o: { readonly by: string; readonly evals: readonly string[] }): Judged[] => {
  if (!Array.isArray(claims)) return [];
  return claims.map((raw): Judged => {
    const c = (raw && typeof raw === "object" ? raw : {}) as { capture?: unknown; shows?: unknown; eval?: unknown };
    const named = typeof c.capture === "string" ? c.capture : "", shows = typeof c.shows === "string" ? c.shows.trim() : "";
    const found = captures.find((x) => x.id === named) ?? captures.find((x) => x.id === idOf(o.by, named));
    const base = { capture: found?.id ?? named, shows, ...(typeof c.eval === "string" && c.eval ? { eval: c.eval } : {}) };
    const why = !named ? "the claim names no capture" : !found ? `no capture named ${named} was made in this run` : !shows ? "the claim does not say what the capture shows"
      : base.eval && o.evals.length > 0 && !o.evals.includes(base.eval) ? `${base.eval} is not an eval of this task` : undefined;
    return why ? { ...base, ok: false, why } : { ...base, ok: true };
  });
};

/** The captures a step made, for telling a later agent what there is to look at. */
export const capturesBy = (dir: string, by: string): Capture[] => capturesOf(dir).filter((c) => c.by === by);
