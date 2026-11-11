// The as-is book of the old organizations concept: every record exported by the files beside it.
// Part one (data, procedures, setups, workspaces, treasuries, members, roles, reads, invitations,
// flows) and part two (equity, rounds, proposals, directors, votes, flows-governance) are written by
// two lanes; this module lists both.
// Build it: node --experimental-strip-types packages/book/src/main.ts books/as-is/organizations/index.ts <out>

import * as foundation from "../shared/foundation.ts";
import * as vocabulary from "../shared/vocabulary.ts";
import * as external from "../shared/external.ts";
import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as setups from "./setups.ts";
import * as workspaces from "./workspaces.ts";
import * as treasuries from "./treasuries.ts";
import * as members from "./members.ts";
import * as roles from "./roles.ts";
import * as reads from "./reads.ts";
import * as invitations from "./invitations.ts";
import * as equity from "./equity.ts";
import * as rounds from "./rounds.ts";
import * as proposals from "./proposals.ts";
import * as directors from "./directors.ts";
import * as votes from "./votes.ts";
import * as flows from "./flows.ts";
import * as flowsGovernance from "./flows-governance.ts";

export const name = "Old organizations concept";
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
  setups,
  workspaces,
  treasuries,
  members,
  roles,
  reads,
  invitations,
  equity,
  rounds,
  proposals,
  directors,
  votes,
  flows,
  flowsGovernance,
];

/** Each record once, even when a file re-exports one. Transitions, calls and contract parts come with their parents. */
export const records = [...new Set(modules.flatMap((m) => Object.values(m as Record<string, unknown>)).filter(isRecord))];
