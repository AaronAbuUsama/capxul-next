// The as-is book of the old applications concept: every record exported by the files beside it.
// Build it: node --experimental-strip-types packages/book/src/main.ts books/as-is/applications/index.ts <out>

import * as foundation from "../shared/foundation.ts";
import * as vocabulary from "../shared/vocabulary.ts";
import * as external from "../shared/external.ts";
import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as registrations from "./registrations.ts";
import * as keys from "./keys.ts";
import * as bootstraps from "./bootstraps.ts";
import * as quickstarts from "./quickstarts.ts";
import * as repairs from "./repairs.ts";
import * as flows from "./flows.ts";

export const name = "Old applications concept";
export const stage = "as-is" as const;

const CHILDREN = new Set(["transition", "call", "function", "chainEvent"]);
const isRecord = (u: unknown): boolean =>
  typeof u === "object" && u !== null && "_kind" in u && "id" in u && typeof (u as { id: unknown }).id === "string" &&
  !CHILDREN.has((u as { _kind: string })._kind);

const modules = [foundation, vocabulary, external, data, procedures, registrations, keys, bootstraps, quickstarts, repairs, flows];

/** Each record once, even when a file re-exports one. Transitions, calls and contract parts come with their parents. */
export const records = [...new Set(modules.flatMap((m) => Object.values(m as Record<string, unknown>)).filter(isRecord))];
