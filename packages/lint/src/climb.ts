// The gate's climb (roadmap 4.7): the commands `pnpm check` runs, in order, each in the span the blueprint's pipeline
// declares for its rung (`Pipeline.checkGate.spans`), under one span of the gate's own work (`check.gate`), stopping
// at the first that fails, as `pnpm check` always has. Each span carries its kind under the envelope's
// `capxul.step.kind` and its command as `script`; a rung that fails ends its span failed, with its exit
// code. Pure: it is handed how to run a command (`Run`), so a test climbs it with a stand-in.
import { Envelope, Pipeline } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";

/** A declared span: its name and kind, as the pipeline declares it. */
interface Declared {
  readonly name: string;
  readonly kind: string;
}

/** One command the gate runs: the root package's script, its arguments, and the span it runs in. */
export interface Rung {
  readonly script: string;
  readonly args: ReadonlyArray<string>;
  readonly span: Declared;
}

const gate = Pipeline.checkGate.spans;
/**
 * The ratchets' counts (`pnpm ratchets`, and R15's `pnpm words`) are the pipeline's `ratchet.count` work, not a rung
 * of `check.gate`: they run in its span.
 */
const ratchets = Pipeline.ratchetCount.spans.lists;

/** The commands of `pnpm check`, in order; `wordsBase` is the branch R15 compares with, on a pull request. */
export const rungsOf = (wordsBase: string | undefined): ReadonlyArray<Rung> => [
  { script: "shape", args: [], span: gate.shape },
  { script: "format:check", args: [], span: gate.format },
  { script: "generate:check", args: [], span: gate.generate },
  { script: "seed:check", args: [], span: gate.seed },
  { script: "lint", args: [], span: gate.lint },
  { script: "types", args: [], span: gate.types },
  { script: "test", args: [], span: gate.test },
  { script: "delta:check", args: [], span: gate.delta },
  { script: "ratchets", args: [], span: ratchets },
  { script: "words", args: wordsBase === undefined ? [] : ["--base", wordsBase], span: ratchets },
];

/** Runs one command of the gate and answers its exit code. */
export type Run = (rung: Rung) => Effect.Effect<number>;

/** The attributes of a rung's span: its kind, the command it runs, and its rung. */
const attributesOf = (rung: Rung): Record<string, unknown> => ({
  [Envelope.attributes.stepKind.name]: rung.span.kind,
  script: rung.script,
});

/** One rung in its span; a command that ends with a non-zero code fails it with that code, and its span ends failed. */
const climbOne = (run: Run) => (rung: Rung) =>
  Effect.flatMap(run(rung), (code) => (code === 0 ? Effect.void : Effect.fail(code))).pipe(
    Effect.withSpan(rung.span.name, { attributes: attributesOf(rung) }),
  );

/**
 * Climbs `rungs` in order, in the gate's span, and stops at the first that fails. Answers the exit code `pnpm check`
 * ends with: 0, or the failing command's.
 */
export const climb = (rungs: ReadonlyArray<Rung>, run: Run): Effect.Effect<number> =>
  Effect.forEach(rungs, climbOne(run), { discard: true }).pipe(
    Effect.withSpan(Pipeline.checkGate.name, { attributes: { rungs: Arr.length(rungs) } }),
    Effect.as(0),
    Effect.catch((code: number) => Effect.succeed(code)),
  );
