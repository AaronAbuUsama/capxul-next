// A stage's first record entry. A world's record begins with the `world_created` that world.create kept (blueprint
// packages/blueprint, src/things/history/verbs/export.ts), and record.export reads the world's grade and lineage from
// it. A
// stage of `CapxulCore` is not made by world.create, so the runner keeps that entry for it once its migrations are
// applied: a private world, made from nothing, owned by the stage's owner, under a trace of its own (all zeros) that no
// call of a run ever has.
import { Pipeline } from "@capxul/blueprint";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import { query } from "./database.ts";
import { stepOptions } from "../telemetry/step.ts";

export const BORN_TRACE = Str.repeat(32)("0");

/** Keeps the stage's `world_created`, expiring when its declared steps would all have ended. */
export const bornAsWorld = Effect.fn(
  Pipeline.runPrepare.spans.stageBorn.name,
  stepOptions(Pipeline.runPrepare.spans.stageBorn),
)(function* (
  database: Redacted.Redacted,
  stage: { readonly name: string; readonly owner: string; readonly lifetime: Duration.Duration },
) {
  const now = yield* Clock.currentTimeMillis;
  const expiresAt = DateTime.formatIso(DateTime.makeUnsafe(now + Duration.toMillis(stage.lifetime)));
  yield* query(
    database,
    `insert into app.events (trace_id, operation, event, payload, at_ms) values ($1, 'world.create', 'world_created',
       jsonb_build_object('world', $2::text, 'owner', $3::text, 'grade', 'private', 'expiresAt', $4::text, 'parent', null),
       $5)`,
    [BORN_TRACE, stage.name, stage.owner, expiresAt, now],
  );
});
