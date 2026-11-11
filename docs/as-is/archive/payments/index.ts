// The as-is book of the old payments concept: every record exported by the files beside it.
// Build it: node --experimental-strip-types packages/book/src/main.ts books/as-is/payments/index.ts <out>

import * as foundation from "../shared/foundation.ts";
import * as vocabulary from "../shared/vocabulary.ts";
import * as data from "./data.ts";
import * as neighbors from "./neighbors.ts";
import * as external from "../shared/external.ts";
import * as procedures from "./procedures.ts";
import * as commands from "./commands.ts";
import * as executions from "./executions.ts";
import * as verifications from "./verifications.ts";
import * as schedules from "./schedules.ts";
import * as movements from "./movements.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";

export const name = "Old payments concept";
export const stage = "as-is" as const;

const CHILDREN = new Set(["transition", "call", "function", "chainEvent"]);
const isRecord = (u: unknown): boolean =>
  typeof u === "object" && u !== null && "_kind" in u && "id" in u && typeof (u as { id: unknown }).id === "string" &&
  !CHILDREN.has((u as { _kind: string })._kind);

const modules = [foundation, vocabulary, data, neighbors, external, procedures, commands, executions, verifications, schedules, movements, flows, operations];

/** Each record once, even when a file re-exports one. Transitions, calls and contract parts come with their parents. */
export const records = [...new Set(modules.flatMap((m) => Object.values(m as Record<string, unknown>)).filter(isRecord))];
