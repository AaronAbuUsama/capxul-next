// The as-is book of the old accounts concept: every record exported by the files beside it.
// Build it: node --experimental-strip-types packages/book/src/main.ts books/as-is/accounts/index.ts <out>

import * as foundation from "../shared/foundation.ts";
import * as vocabulary from "../shared/vocabulary.ts";
import * as external from "../shared/external.ts";
import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as safes from "./safes.ts";
import * as claims from "./claims.ts";
import * as lanes from "./lanes.ts";
import * as balances from "./balances.ts";
import * as grants from "./grants.ts";
import * as summaries from "./summaries.ts";
import * as approvals from "./approvals.ts";
import * as agents from "./agents.ts";
import * as reads from "./reads.ts";
import * as flows from "./flows.ts";

export const name = "Old accounts concept";
export const stage = "as-is" as const;

const CHILDREN = new Set(["transition", "call", "function", "chainEvent"]);
const isRecord = (u: unknown): boolean =>
  typeof u === "object" && u !== null && "_kind" in u && "id" in u && typeof (u as { id: unknown }).id === "string" &&
  !CHILDREN.has((u as { _kind: string })._kind);

const modules = [
  foundation,
  vocabulary,
  external,
  data,
  procedures,
  safes,
  claims,
  lanes,
  balances,
  grants,
  summaries,
  approvals,
  agents,
  reads,
  flows,
];

/** Each record once, even when a file re-exports one. Transitions, calls and contract parts come with their parents. */
export const records = [...new Set(modules.flatMap((m) => Object.values(m as Record<string, unknown>)).filter(isRecord))];
