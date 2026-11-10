// The serialized command record, not the searchable command-records projection.
// Shared with the spike's append boundary so the book describes bytes actually written.
import { Schema } from "effect";
import { defineTable } from "../../packages/blueprint-engine/src/index.ts";
import { concept_devnet } from "../shared/foundation.ts";
const S = Schema.String;
const nullable = Schema.NullOr;
const json = Schema.Unknown;
export const CommandRecordEntry = Schema.Struct({
  v: Schema.Literal(1), id: S, seq: Schema.Int, prev: S,
  trace: S, command: S,
  args: Schema.Struct({ positional: Schema.Array(S), flags: Schema.Record(S, Schema.Union([S, Schema.Boolean])) }),
  actor: nullable(Schema.Struct({ email: S, address: nullable(S), hats: Schema.Array(S) })),
  world: S, org: nullable(S), site: nullable(S),
  world_time: S, world_time_end: S, real_time: S, duration_ms: Schema.Number,
  outcome: Schema.Literals(["ok", "refused", "failed"]),
  error: nullable(Schema.Struct({ code: S, reason: S, detail: Schema.optionalKey(json) })),
  result: json,
  changes: Schema.Struct({
    tx: Schema.Array(Schema.Struct({ hash: S, fn: S })),
    docs: Schema.Array(Schema.Struct({ site: S, doctype: S, name: S, action: S })),
  }),
});
export const table_record_entries = defineTable({
  id: "record-entries", title: "Serialized command record entry, version 1",
  about: "The append-only JSON Lines wire record the spike writes, after redaction and before hashing. One command has one entry, including refusal and failure. Changes may carry additional domain pointers; result and error detail are redacted JSON. Restore lineage is an additional field. command-records is the future searchable projection, not this wire format. Agent metadata, epoch and clock mode/rate remain designed in that projection, not claimed as spike evidence.",
  concept: concept_devnet, tenancy: "global", scope: "One world's own append-only record; world grants govern reads, never company tenancy.",
  fields: CommandRecordEntry, key: ["world", "seq"], indexes: [],
  retention: "Kept with the world; redact before writing, never store secrets or unconsented customer data.",
  was: ["spikes/skeleton/core/src/record.ts", "docs/mission/worlds.md section 6"],
});
