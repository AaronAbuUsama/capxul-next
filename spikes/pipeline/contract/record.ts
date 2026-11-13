// The concept "record": a world's one append-only record. Two operations, declared and not implemented here.
// The acceptance claims these declarations stand for are in README.md.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { declare } from "./operation.ts";

/** One entry of the record, as `record.export` returns it. */
export class Entry extends Schema.Class<Entry>("Entry")({
  seq: Schema.Int,
  key: Schema.String,
  kind: Schema.String,
  body: Schema.Json,
}) {}

/** Refusal of `record.append`: the key was already appended. The record is unchanged. */
export class DuplicateEntry extends Schema.TaggedError<DuplicateEntry>()("DuplicateEntry", {
  key: Schema.String,
}) {}

/** Emitted once by every successful `record.append`. */
export class RecordAppended extends Schema.TaggedClass<RecordAppended>()("record_appended", {
  key: Schema.String,
  seq: Schema.Int,
}) {}

export const append = declare({
  rpc: Rpc.make("record.append", {
    payload: { key: Schema.String, kind: Schema.String, body: Schema.Json },
    success: Schema.Struct({ seq: Schema.Int }),
    error: DuplicateEntry,
  }),
  emits: [RecordAppended],
  budgetMs: 500,
});

export const exportAll = declare({
  rpc: Rpc.make("record.export", {
    success: Schema.Struct({ entries: Schema.Array(Entry) }),
  }),
  emits: [],
  budgetMs: 500,
});
