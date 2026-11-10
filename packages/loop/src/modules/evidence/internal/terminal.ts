/**
 * A command recorded in a terminal that has no screen: asciinema runs it and writes the cast (every byte it printed, with
 * its timing, and how it ended), and agg draws the cast as a GIF. The command is one the agent's own shell policy allows.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MAX_OUTPUT, type Capture, type EvidenceDeps } from "../types.ts";
import { captureOf, idOf, keep, refuseName, size } from "./store.ts";

export interface Made { readonly ok: boolean; readonly text: string; readonly capture?: Capture }
const no = (text: string): Made => ({ ok: false, text });

/** What a cast's output events say, without the terminal's control sequences: the text a person would read. */
export const textOfCast = (cast: string): string =>
  cast.split("\n").slice(1).flatMap((line) => {
    try { const e = JSON.parse(line) as [number, string, string]; return e[1] === "o" ? [e[2]] : []; } catch { return []; }
  }).join("").replace(/\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007|\r/g, "");

/** The terminal a command is recorded in: narrow enough to read on a phone, tall enough for a screen of output. */
const [COLS, ROWS] = [96, 30];
/** Prints `$ <command>` dimmed, as the first line of the recording. The command is quoted whole: nothing in it runs here. */
const typed = (command: string): string => `printf '\\033[2m$ %s\\033[0m\\n' '${command.replaceAll("'", "'\\''")}'`;

export const recordTerminal = async (deps: EvidenceDeps, a: { name?: unknown; command?: unknown }): Promise<Made> => {
  const bad = refuseName(a.name);
  if (bad) return no(bad);
  const name = a.name as string, command = typeof a.command === "string" ? a.command.trim() : "";
  if (!command) return no("give the command to record");
  const why = deps.refuse(command);
  if (why) return no(`Refused by the loop's policy: ${why}`);
  if (!deps.tooling.asciinema) return no("Terminal recording is not available on this machine: asciinema is not installed. Run the command with bash and say in your answer that it could not be recorded.");
  const id = idOf(deps.by, name);
  if (captureOf(deps.dir, id)) return no(`there is already a capture named ${id}: give this one another name`);
  mkdirSync(deps.dir, { recursive: true });
  const cast = `${id}.cast`, gif = `${id}.gif`, t0 = deps.now().getTime();
  // The recording opens with the command as a person would have typed it, so whoever watches knows what they are looking at.
  const ran = await deps.exec(deps.tooling.asciinema, ["rec", "--overwrite", "-q", "--headless", "--return", "--window-size", `${COLS}x${ROWS}`, "-f", "asciicast-v2", "-c", `${typed(command)}; ${command}`, join(deps.dir, cast)],
    { cwd: deps.cwd, env: { TERM: "xterm-256color", ...deps.env }, timeoutMs: 10 * 60_000 });
  if (deps.stopped?.()) { rmSync(join(deps.dir, cast), { force: true }); return no("the agent was stopped while the command ran: nothing was kept"); }
  if (!existsSync(join(deps.dir, cast))) return no(`the recorder wrote nothing (it ended with ${ran.code}): ${ran.out.slice(-300)}`);
  const all = textOfCast(readFileSync(join(deps.dir, cast), "utf8")), out = all.slice(all.indexOf("\n") + 1);
  // A short run is drawn only as tall as it is: thirty rows around two lines is a picture of nothing.
  const rows = String(Math.min(ROWS, Math.max(4, all.split("\n").length + 1)));
  if (deps.tooling.agg) await deps.exec(deps.tooling.agg, ["--rows", rows, "--font-size", "16", "--theme", "github-dark", "--idle-time-limit", "2", "--last-frame-duration", "3", join(deps.dir, cast), join(deps.dir, gif)], { cwd: deps.dir, env: deps.env, timeoutMs: 5 * 60_000 });
  const capture = keep(deps, { id, kind: "terminal", ms: deps.now().getTime() - t0, source: { command, exit: ran.code }, names: [gif, cast] });
  const shown = capture.files[0]!;
  return {
    ok: true, capture,
    text: [`Recorded as capture ${id}: ${shown.name} (${size(shown.bytes)}). The command ended with ${ran.code}.`, "", out.length > MAX_OUTPUT ? `[the first ${out.length - MAX_OUTPUT} characters are left out]\n${out.slice(-MAX_OUTPUT)}` : out].join("\n"),
  };
};
