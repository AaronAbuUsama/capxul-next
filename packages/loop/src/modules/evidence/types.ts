/**
 * GENERIC. Evidence: what an agent shows for what it says. Two records, kept apart on purpose.
 *
 * A `Capture` is made by a tool the loop hands the agent: a recording of a command in a terminal, a screenshot of a page,
 * a recording of several steps in the browser. The tool writes the file and this record of how it was made (the command and its exit
 * code, or the page's address), into the run's evidence folder, which is outside the agent's directory. An agent cannot
 * write a capture by hand.
 *
 * An `Evidence` entry is the agent's claim, in its structured output: this capture shows that, for this eval. The loop
 * judges each claim against the captures (`judge`): a claim that names no capture is not evidence.
 *
 * Nothing here knows which agents get which tools: the caller decides (`EvidenceDeps`), and says what a recorded command
 * may be (`refuse`) and which hosts the browser may open (`hosts`).
 */

/** What was captured. `terminal`: a command, as a GIF and its cast. `screenshot`: a page, as a PNG. `screen-recording`: several steps in the browser, as a GIF with a frame a step. */
export type CaptureKind = "terminal" | "screenshot" | "screen-recording";

/** One file of a capture, by its name in the evidence folder. The hash lets a copy of the run be checked against the record. */
export interface CaptureFile { readonly name: string; readonly type: string; readonly bytes: number; readonly sha256: string }

/** How a capture was made: the command a terminal ran and how it ended, or the page the browser was on. */
export type CaptureSource =
  | { readonly command: string; readonly exit: number }
  | { readonly url: string; readonly title: string };

export interface Capture {
  /** `<the step that made it>.<the name the agent gave it>`, such as `make.1.pay-refuses-overdraft`. Unique in a run. */
  readonly id: string;
  readonly kind: CaptureKind;
  /** The step of the run whose agent made it, such as `make.1` or `reviewer.1.reviewer.agent`. */
  readonly by: string;
  readonly at: string;
  /** How long the capture took, in milliseconds. */
  readonly ms: number;
  readonly source: CaptureSource;
  /** The first file is the one to show (a GIF, a PNG, a video); the rest are its raw forms (a cast). */
  readonly files: readonly CaptureFile[];
}

/** An agent's claim about a capture, as it writes it in its structured output. */
export interface Evidence {
  /** A capture's id. */
  readonly capture: string;
  /** What the capture shows, in a sentence a person can check by looking. */
  readonly shows: string;
  /** The eval this is evidence for, when it is for one. */
  readonly eval?: string;
}

/** A claim after the loop looked: `ok` when it names a capture of this run and, if it names an eval, one of the task's. */
export interface Judged extends Evidence { readonly ok: boolean; readonly why?: string }

/** The programs the tools drive, by path, or null where one is not installed: a tool whose program is missing says so. */
export interface Tooling {
  /** asciinema: records a command in a terminal with no screen attached. */
  readonly asciinema: string | null;
  /** agg: turns a cast into a GIF. Without it a terminal capture is the cast alone. */
  readonly agg: string | null;
  /** agent-browser: drives a headless browser and takes screenshots. */
  readonly browser: string | null;
  /** ffmpeg: joins the frames of a browser recording into one GIF. Without it there are screenshots only. */
  readonly ffmpeg: string | null;
}

/** Runs one program and returns how it ended and what it printed. Injected, so tests need no recorder and no browser. */
export type Exec = (file: string, args: readonly string[], o: { readonly cwd: string; readonly env: Readonly<Record<string, string>>; readonly timeoutMs: number }) => Promise<{ readonly code: number; readonly out: string }>;

export interface EvidenceDeps {
  /** The run's evidence folder: the files and `captures.jsonl`. Outside every agent's directory. */
  readonly dir: string;
  /** The step these tools are for; it starts every capture's id. */
  readonly by: string;
  /** The agent's directory: recorded commands run here. */
  readonly cwd: string;
  /** What a recorded command sees, and nothing else. */
  readonly env: Readonly<Record<string, string>>;
  readonly now: () => Date;
  readonly exec: Exec;
  readonly tooling: Tooling;
  /** Why this agent may not record this command, or undefined when it may: the caller's shell policy. */
  readonly refuse: (command: string) => string | undefined;
  /** The hosts the browser may open, such as `127.0.0.1` and `*.localhost`. Empty: this agent has no browser. */
  readonly hosts: readonly string[];
}

/** The evidence folder's name inside a run's folder. */
export const FOLDER = "evidence";
/** The longest name an agent may give a capture, and how much of a recorded command's output goes back to the model. */
export const MAX_NAME = 48;
export const MAX_OUTPUT = 6000;
/** The tools' names, for a policy that lets them through and a prompt that names them. */
export const TOOL_NAMES = ["record_terminal", "browser", "screenshot", "record_screen"] as const;
