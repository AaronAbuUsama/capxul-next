// The as-is book of the old permissions concept: every record exported by the files beside it.
// Part one: data, procedures, authorities, grants, verifications, views, configurations, flows.
// Part two: allowances, replacements, commands, flows-allowances.
// Build it: node --experimental-strip-types packages/book/src/main.ts books/as-is/permissions/index.ts <out>

import * as foundation from "../shared/foundation.ts";
import * as vocabulary from "../shared/vocabulary.ts";
import * as external from "../shared/external.ts";
import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as authorities from "./authorities.ts";
import * as grants from "./grants.ts";
import * as verifications from "./verifications.ts";
import * as views from "./views.ts";
import * as configurations from "./configurations.ts";
import * as flows from "./flows.ts";
import * as allowances from "./allowances.ts";
import * as replacements from "./replacements.ts";
import * as commands from "./commands.ts";
import * as flowsAllowances from "./flows-allowances.ts";

export const name = "Old permissions concept";
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
  authorities,
  grants,
  verifications,
  views,
  configurations,
  flows,
  allowances,
  replacements,
  commands,
  flowsAllowances,
];

/** Each record once, even when a file re-exports one. Transitions, calls and contract parts come with their parents. */
export const records = [...new Set(modules.flatMap((m) => Object.values(m as Record<string, unknown>)).filter(isRecord))];
