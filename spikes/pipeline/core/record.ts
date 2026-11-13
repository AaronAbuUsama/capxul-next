// The concept "record" in Core: the world's one append-only record, kept in `app.record_entries` and numbered
// from `app.record_head` (migrations/0002_record.sql). The handlers reach it only through `RecordStore`.
//
// How a seq is guaranteed when two appends race. An append is one transaction, and its first statement updates
// the one row of `app.record_head`. Postgres gives that row's lock to one transaction at a time, so a second
// append waits there until the first has committed or rolled back, and only then reads the head it adds one to:
// two appends never read the same head. The head moves, the entry is inserted and the event is written in that
// one transaction, so a refused or failed append rolls its head back and leaves no gap. Under all of it, `seq` is
// the table's primary key and `key` is unique, so no two entries can share either, whatever the code does.
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import type { SqlError } from "effect/sql/SqlError";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import { Record, type CurrentCall } from "../contract/door.ts";
import { Events } from "./telemetry.ts";

/** What a caller appends: the payload of `record.append`. */
const Draft = Record.append.rpc.payloadSchema;
type Draft = typeof Draft.Type;

/** A seq as the database holds it (`bigint`, which the driver reads as a JavaScript bigint) and as the contract carries it. */
const Seq = Schema.BigInt.pipe(
  Schema.decodeTo(Schema.Int, {
    decode: SchemaGetter.transform((stored: bigint) => Number(stored)),
    encode: SchemaGetter.transform((seq: number) => BigInt(seq)),
  }),
);

/** A draft as it is written: the body as the JSON text the `json` column stores. */
const DraftRow = Schema.Struct({ key: Schema.String, kind: Schema.String, body: Schema.fromJsonString(Schema.Json) });

/** What the append statement answers: the seq the entry was given, or null when its key is already in the record. */
const Appended = Schema.Struct({ seq: Schema.NullOr(Seq) });

/** A row of `app.record_entries`. The driver has already parsed the stored body. */
const EntryRow = Schema.Struct({ seq: Seq, key: Schema.String, kind: Schema.String, body: Schema.Json });

/** The record's head row is missing: the world's migrations did not run. A defect, never a refusal. */
export class RecordHeadMissing extends Schema.TaggedError<RecordHeadMissing>()("RecordHeadMissing", {
  message: Schema.String,
}) {}

/** The world's record. */
export class RecordStore extends Context.Service<
  RecordStore,
  {
    /**
     * Appends `draft` and emits `record_appended`, as one transaction. Fails with `DuplicateEntry` when the key
     * is already in the record; the record, its head and the events are then as they were.
     */
    readonly append: (draft: Draft) => Effect.Effect<{ readonly seq: number }, Record.DuplicateEntry | SqlError | Schema.SchemaError, CurrentCall>;
    /** Every entry of the record, lowest seq first. */
    readonly entries: Effect.Effect<ReadonlyArray<Record.Entry>, SqlError | Schema.SchemaError>;
  }
>()("capxul/core/RecordStore") {}

export const RecordStoreLive = Layer.effect(
  RecordStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const events = yield* Events;

    // One statement, so one round trip. `head` takes the head row's lock and moves the head. `entry` inserts at
    // the new head unless the key is already there: `on conflict do nothing` also sees a key that another append
    // committed while this one waited for the lock. The answer is always one row; its seq is null when nothing
    // was inserted.
    const insert = SqlSchema.findAll({
      Request: DraftRow,
      Result: Appended,
      execute: (draft) => sql`
        with head as (
          update app.record_head set last_seq = last_seq + 1 returning last_seq
        ), entry as (
          insert into app.record_entries (seq, key, kind, body)
          select last_seq, ${draft.key}::text, ${draft.kind}::text, ${draft.body}::json from head
          on conflict (key) do nothing
          returning seq
        )
        select (select seq from entry) as seq from head`,
    });

    const append = Effect.fn("RecordStore.append")(function* (draft: Draft) {
      const answer = Arr.head(yield* insert(draft));
      if (Option.isNone(answer)) {
        return yield* Effect.die(new RecordHeadMissing({ message: "app.record_head has no row: the world's migrations did not run" }));
      }
      const { seq } = answer.value;
      // Failing here rolls the transaction back: the head returns to where it was, so a refusal takes no seq.
      if (seq === null) return yield* new Record.DuplicateEntry({ key: draft.key });
      yield* events.emit(Record.append, new Record.RecordAppended({ key: draft.key, seq }));
      return { seq };
    }, (attempt) => sql.withTransaction(attempt));

    const select = SqlSchema.findAll({
      Request: Schema.Void,
      Result: EntryRow,
      execute: () => sql`select seq, key, kind, body from app.record_entries order by seq`,
    });

    // Read inside a transaction, though it is one statement. The world reaches its database through Hyperdrive,
    // which answers a bare `select` from its own cache for up to a minute: an export just after an append came
    // back without the new entry. A statement inside a transaction always reaches the database.
    const entries = sql.withTransaction(select()).pipe(
      Effect.map(Arr.map((row) => new Record.Entry(row))),
      Effect.withSpan("RecordStore.entries"),
    );

    return RecordStore.of({ append, entries });
  }),
);
