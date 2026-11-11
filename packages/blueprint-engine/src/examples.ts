// An operation's examples are checked against the operation itself: a success prints its `returns` shape, a refusal
// is one the operation declares, with that error's exit code. A wrong example is worse than none, so it is a problem.

import { Schema } from "effect";
import type { AnyRecord, Blueprint, Finding } from "./build.ts";

type Records = Pick<Blueprint, "records">;
const key = (r: { _kind: string; id: string }) => `${r._kind}:${r.id}`;

export interface ExampleRow {
  readonly title: string;
  readonly input: string;
  readonly output: unknown;
  readonly exit: number;
}

/** The examples an operation carries, as written. */
export const examplesOf = (op: AnyRecord): readonly ExampleRow[] => (Array.isArray(op.examples) ? (op.examples as ExampleRow[]) : []);

/** The refusal shape a failing command prints with `--json`: `{ error: { code, message, details } }`. */
const codeOf = (output: unknown): string | null => {
  const error = typeof output === "object" && output !== null ? (output as { error?: unknown }).error : undefined;
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : null;
};

const check = (b: Records, op: AnyRecord, ex: ExampleRow): string | null => {
  const command = String(op.command ?? "");
  if (command !== "" && !ex.input.includes(command)) return `its input does not name the command "${command}"`;
  if (ex.exit === 0) {
    if (!Schema.isSchema(op.returns)) return null;
    const result = Schema.decodeUnknownResult(op.returns as never)(ex.output) as { _tag: "Success" } | { _tag: "Failure"; failure: { message: string } };
    return result._tag === "Success" ? null : `its output does not conform to returns: ${result.failure.message.replace(/\s+/g, " ")}`;
  }
  const code = codeOf(ex.output);
  if (code === null) return `it exits ${ex.exit} but prints no { error: { code } }`;
  const message = (ex.output as { error?: { message?: unknown } }).error?.message;
  if (typeof message !== "string" || message === "") return `it exits ${ex.exit} but its { error } has no message`;
  const declared = [
    ...((op.refusals as { error: AnyRecord }[] | undefined) ?? []).map((r) => r.error),
    ...((op.errors as AnyRecord[] | undefined) ?? []),
  ].find((e) => e.id === code);
  if (!declared) return `it prints ${code}, which the operation does not declare as a refusal or an error`;
  const error = b.records.get(key(declared));
  return error && error.exit !== ex.exit ? `it prints ${code}, whose exit code is ${String(error.exit)}, not ${ex.exit}` : null;
};

/** Problems: every example that does not match its operation. */
export const exampleProblems = (b: Records, operations: readonly AnyRecord[]): Finding[] =>
  operations.flatMap((op) =>
    examplesOf(op).flatMap((ex, i) => {
      const why = check(b, op, ex);
      return why === null ? [] : [{ record: key(op), rule: "example-mismatch", detail: `example ${i + 1} (${ex.title}): ${why}` }];
    }),
  );

/** Gaps: an operation with no example shows nobody what it prints. */
export const exampleGaps = (operations: readonly AnyRecord[]): Finding[] =>
  operations.filter((op) => examplesOf(op).length === 0).map((op) => ({
    record: key(op), rule: "no-example", detail: "it has no example: no one has seen what it prints",
  }));
