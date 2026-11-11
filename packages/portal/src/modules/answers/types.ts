/**
 * The answers module: the owner's answers to what waits on him, saved as lines of `plan/answers.jsonl`. A request in, a
 * response out, both plain data; the files and the clock come in as `Deps`, so the whole endpoint is testable without a
 * socket. The answer's own types live with the plan (`packages/plan/types.ts`), which reads the same file.
 */
import type { Answer, AnswerLine, How, LogEntry, Target, Withdrawal } from "@capxul/plan";

export type { Answer, AnswerLine, How, LogEntry, Target, Withdrawal };

/** What waits on the owner right now: decisions with their options, and tasks blocked on a need of his. */
export interface Waiting {
  readonly decisions: ReadonlyMap<string, readonly string[]>;
  readonly tasks: ReadonlySet<string>;
}

/** A request as the server saw it. `tooLarge` is set when the body passed the limit and was not read. */
export interface Req {
  readonly method: string;
  readonly path: string;
  readonly host: string;
  readonly origin: string;
  readonly body: string;
  readonly tooLarge: boolean;
}

export interface Res {
  readonly status: number;
  readonly type: string;
  readonly body: string | Uint8Array;
}

/** Everything outside the module. Nothing here can write anywhere but `append`, which writes one line to answers.jsonl. */
export interface Deps {
  readonly now: () => string;
  readonly newId: () => string;
  /** Read afresh on each call: the coordinator changes the plan while the server runs. */
  readonly waiting: () => Waiting;
  readonly answerLines: () => string;
  /** The plan log, whose `answers.apply` entries say which answers were applied. */
  readonly log: () => readonly LogEntry[];
  /** Appends one line (already ending in a newline) to plan/answers.jsonl. The only write there is. */
  readonly append: (line: string) => void;
  /** A file of the generated site by its path under dist, or null. */
  readonly file: (path: string) => { readonly type: string; readonly body: Uint8Array } | null;
  /** The `host` values the server answers to, such as `127.0.0.1:4391`. */
  readonly hosts: readonly string[];
  /**
   * Set when this server must take no answers, with the reason in words: it is served from a copy of the repository
   * whose plan/answers.jsonl the coordinator never reads. `/api/answers` then refuses every request and writes nothing.
   */
  readonly closed?: string;
}

/** The longest text an answer may hold, in characters, and the largest request body, in bytes. */
export const MAX_TEXT = 2000;
export const MAX_BODY = 8192;
