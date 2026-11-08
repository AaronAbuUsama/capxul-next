// The as-is book of the old requests concept: every record exported by the files beside it.
// Build it: node --experimental-strip-types packages/book/src/main.ts books/as-is/requests/index.ts <out>

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as offers from "./offers.ts";
import * as receivables from "./receivables.ts";
import * as inboxes from "./inboxes.ts";
import * as checkouts from "./checkouts.ts";
import * as flows from "./flows.ts";

export const name = "Old requests concept";
export const stage = "as-is" as const;

const CHILDREN = new Set(["transition", "call", "function", "chainEvent"]);
const isRecord = (u: unknown): boolean =>
  typeof u === "object" && u !== null && "_kind" in u && "id" in u && typeof (u as { id: unknown }).id === "string" &&
  !CHILDREN.has((u as { _kind: string })._kind);

const modules = [data, procedures, offers, receivables, inboxes, checkouts, flows];

/** Each record once, even when a file re-exports one. Transitions, calls and contract parts come with their parents. */
export const records = [...new Set(modules.flatMap((m) => Object.values(m as Record<string, unknown>)).filter(isRecord))];
