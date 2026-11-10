// Activity's changes: what changed in a feed since a reader's cursor (`activity events`). The read
// pages activity's own change log (data.ts) by `seq` and answers each changed row as it stands
// now, from the same tables the feed reads. The log is appended by the change-log workflows
// (processes.ts) from payments' transitions, so a change to an old Payment is read however many
// rows are newer, and a Movement indexed late is read once, when it is recorded (decision
// activity.change-log). The old CLI composed two SDK calls, a fifteen-minute replay window and a
// list of row versions in its cursor to get close to that; none of it is needed here.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_activity } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED } from "../shared/vocabulary.ts";
import { table_movements, table_payments } from "../payments/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_org_members } from "../organizations/data.ts";
import { Change, RowKind, table_activity_changes } from "./data.ts";
import { Item, Scope } from "./feed.ts";

const OLD = "packages/backend/src/activity/items";
const CLI = "apps/cli/src/commands/activity/subcommands/events/execute.ts";

const S = Schema.String;
const N = Schema.Number;

/** The most changes one read answers; more waiting is `truncated`, and the cursor carries on from the last one read. */
export const CHANGES_PER_READ = 5_000;

/** One change as a reader sees it: the row as it stands now, and what moved it. */
export const ChangeEvent = Schema.Struct({
  kind: RowKind,
  id: S,
  change: Change,
  /** The transition that made this change: `open`, `settle`, `record`... */
  transition: S,
  /** When the change committed, by the backend's clock. */
  at: N,
  item: Item,
});

export const ChangePage = Schema.Struct({
  /** Oldest first. */
  events: Schema.Array(ChangeEvent),
  /** Sealed: the feed and the last change read. Pass it back as `after`. */
  cursor: S,
  truncated: Schema.Boolean,
  observedAt: N,
});

export const rpc_activity_changes_read = defineRpc({
  id: "activity.changes.read",
  title: "What changed in a feed since a cursor",
  about:
    "The scope comes first, as for the feed: the caller's own, or an Organization whose active Seat the caller holds; " +
    "any other is INVALID_INPUT. With no `after` it starts from now: no events, and the cursor of the feed's latest " +
    "change (its checkpoint). With `after`, the cursor must be one this read sealed for this feed (an HMAC under the " +
    "backend's cursor key over the feed and a `seq`): one sealed for another feed or another read, or a forged one, is " +
    "INVALID_INPUT. It then reads the feed's changes after that `seq` from `activity-changes`, oldest first, up to 5,000; " +
    "more waiting is `truncated`, and the cursor names the last change read, so the next read carries on there and no " +
    "change is answered twice or skipped. A row changed more than once in one read is answered once, at its latest " +
    "change; a row that changes after a read is answered again by the next. Each change comes with its row as it reads " +
    "now (the feed's Payment and Movement shapes, from payments' rows and parties' names); a Movement a reorg removed " +
    "since is passed over. `at` is the change's commit time by the backend's clock, never the caller's.",
  was: [
    `${OLD}/operations/changes.ts:13`,
    `${OLD}/reads/changes.ts:20`,
    `${OLD}/rules/changes.ts:11`,
    `${CLI}:23`,
    `${CLI}:131`,
    "packages/protocol/src/activity/operations.ts:57",
  ],
  concept: concept_activity,
  kind: "query",
  who:
    "A signed-in person or agent, for their own feed; or a current member of an Organization (an active Seat), for its " +
    "feed.",
  input: Schema.Struct({ scope: Scope, after: Schema.optionalKey(S) }),
  output: ChangePage,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [table_org_members, table_activity_changes, table_payments, table_movements, table_parties],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.activity.changes.read"],
  budget: budget("read"),
});
