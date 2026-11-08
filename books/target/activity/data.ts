// Activity's one table: the change log behind `activity events`, in the target design.
//
// Activity is the read model of money for whoever you act as (concepts.activity). Its feed, its
// totals, a row in full, balances and `address` are live reads of payments', indexing's, books',
// parties', organizations' and access' tables in the one Postgres (feed.ts, holdings.ts). The only
// thing it must keep is what those tables cannot answer: the order in which one feed's rows changed,
// so a reader that follows `--after` sees every change exactly once (decision activity.change-log).
//
// Gone from old activity (books/as-is has no activity folder; the old code is the evidence):
// `activityAnnotations` is books' book-annotations (concepts.books); the overlays are dropped
// (responsibilities.overlays); the change and page cursors keep no row (activity.sealed-cursors).
//
// No state machine: a change log row is written once and never changes, so no status exists to
// transition and no `<machine>_transitioned` event is defined here (P7).

import { Schema } from "effect";
import { defineTable } from "../../../packages/book/src/index.ts";
import { concept_activity } from "../shared/foundation.ts";

const OLD = "packages/backend/src/activity";

const S = Schema.String;
const Int = Schema.Int;
/** Epoch milliseconds, by the backend's clock (as payments' rows). */
const At = Schema.Number;
const Null = Schema.NullOr;

/** Whose feed (P8 `owner`): a person's (an agent's too: its principal is a person-kind owner) or an Organization's. */
export const OwnerKind = Schema.Literals(["person", "organization"]);

/** The two kinds of activity row: a Payment, or a Movement of outside money. */
export const RowKind = Schema.Literals(["payment", "movement"]);

/** What a change is to a reader: a row they have not seen, or one they have that moved on. */
export const Change = Schema.Literals(["new", "updated"]);

// ── activity-changes ────────────────────────────────────────────────────────────────────────

export const table_activity_changes = defineTable({
  id: "activity-changes",
  title: "Activity changes: each feed's changes, in the order they committed",
  about:
    "One row per change a reader of one feed (a person's or an Organization's) is told about: a Payment or a Movement " +
    "the feed has not noted before (`new`), or a Payment it has, moved to another status (`updated`); the first row " +
    "for a row is `new` whichever transition's workflow runs first. The change-log workflows " +
    "append it from payments' transitions through the outbox, once for each side whose feed holds the row: a Payment's " +
    "owner and, when the payee is another Capxul party, the payee; a Payment to oneself once. `seq` numbers one feed's " +
    "changes from 1 with no gap: the appender takes the feed's transaction lock and the next number, so a later `seq` " +
    "never commits before an earlier one and a reader paging by `seq` skips nothing, which a time column read by a " +
    "second transaction cannot promise. `event_id` is the outbox event it came from, so a redelivery appends nothing. " +
    "It copies none of the row: `activity events` reads the Payment or Movement as it stands. `changed_at` is the " +
    "transition's commit time by the backend's clock, the `at` a reader sees. This is the position every change cursor " +
    "names, and the only store activity owns.",
  concept: concept_activity,
  tenancy: "owner",
  tenantField: "owner_id",
  fields: Schema.Struct({
    owner_id: S,
    owner_kind: OwnerKind,
    seq: Int,
    row_kind: RowKind,
    /** A Payment's `payment_` id, or a Movement's id (`<chain id>:<tx hash>:<log index>:<side>`, activity.row-ids). */
    row_id: S,
    change: Change,
    /** The transition that made the change: `open`, `settle`, `record`... */
    transition: S,
    from: Null(S),
    to: S,
    event_id: S,
    changed_at: At,
  }),
  key: ["owner_id", "owner_kind", "seq"],
  indexes: [
    {
      name: "by-owner-row",
      fields: ["owner_id", "owner_kind", "row_kind", "row_id", "seq"],
      for: "Whether a feed already noted a row, so its first change is `new` and every later one `updated`, in whatever order the appenders run.",
    },
    {
      name: "by-owner-event",
      fields: ["owner_id", "owner_kind", "event_id"],
      unique: true,
      for: "A redelivered transition appends nothing: the appender's idempotency, enforced by the constraint, not by a read.",
    },
  ],
  retention:
    "Kept for the life of the feed: a row is a few dozen bytes, and a reader's cursor stays good however long the reader " +
    "sleeps. Nothing deletes it; a Payment's rows are kept as long as the Payment.",
  was: [`${OLD}/items/rules/changes.ts:11`, `${OLD}/items/reads/changes.ts:20`, "apps/cli/src/commands/activity/subcommands/events/execute.ts:23"],
});
