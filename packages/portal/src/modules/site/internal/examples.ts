/** An operation's examples as a terminal shows them: the command line, the JSON it printed, the exit code. */
import { examplesOf, type AnyRecord } from "@capxul/blueprint-engine";

import type { ExampleView } from "../types.ts";
import { refOf } from "./locate.ts";
import { isRecord, objects } from "./values.ts";

const codeOf = (output: unknown): string => {
  const error = typeof output === "object" && output !== null ? (output as { error?: unknown }).error : undefined;
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : "";
};

export const exampleViews = (op: AnyRecord): readonly ExampleView[] => {
  const errors = [...objects(op["refusals"]).map((r) => r["error"]), ...(Array.isArray(op["errors"]) ? op["errors"] : [])].filter(isRecord);
  return examplesOf(op).map((e) => {
    const declared = e.exit === 0 ? undefined : errors.find((x) => x.id === codeOf(e.output));
    return {
      title: e.title, input: e.input, output: JSON.stringify(e.output, null, 2) ?? "null", exit: e.exit,
      refusal: declared ? refOf(declared) : null,
    };
  });
};
