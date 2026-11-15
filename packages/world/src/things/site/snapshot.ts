// A world's company sites in its snapshots (packages/blueprint/docs/decisions.md, entry 17): saving them with the
// snapshot, and making them again in a world restored from it. The bench's site door does the work (packages/platform,
// door/snapshots.py); this is the world's half, as Bench.ts is for making and removing sites.
//
//   save     every site of the world, backed up under the snapshot's name, on the world's own token
//   restore  each site the source world saved as the snapshot, made again in the new world under its own label, from
//            the backup: on the new world's token, with the source's shown too (the door lets a world restore only
//            what that world saved), the new world's site credential and its clock; then waited for until ready
//   drop     what a deleted snapshot saved: its backup, and the point an in-place reset puts the sites back to
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { SITE_KEY_ID, SITE_SECRET_ID } from "../../parts/api/Api.ts";
import { SiteFailed } from "../../common/failures.ts";
import { Limits } from "../world/values.ts";
import { secretOf } from "../../stack/engine.ts";
import { nameOf } from "../../stack/names.ts";
import { readyOn, soon, tokenFor } from "./bench.ts";
import { doorCall } from "./client.ts";

const SavedSites = Schema.Array(Schema.Struct({ site: Schema.String, label: Schema.String, ms: Schema.Finite }));
/** A door from before the background backup answers the saved sites at once. */
const Saved = Schema.Struct({ world: Schema.String, snapshot: Schema.String, sites: SavedSites });
/** The door now starts the backup and answers 202: a backup can outlast the 100 s Cloudflare allows a request. */
const Started = Schema.Struct({ state: Schema.Literal("saving") });
const BackupState = Schema.Struct({
  state: Schema.Literals(["saving", "saved", "failed"]),
  sites: Schema.optional(SavedSites),
  error: Schema.optional(Schema.String),
});

const Restoring = Schema.Struct({
  sites: Schema.Array(Schema.Struct({ site: Schema.String, from: Schema.String })),
});

/** The world's clock as the bench sets it: frozen at an instant, or running at an offset from the host's. */
export type BenchClock = { readonly frozen_at_ms: number } | { readonly offset_ms: number };

/** Saves every site of world `stage` on `bench` under `snapshot`; answers what was saved. */
export const saveSites = Effect.fn("world.site.save")(function* (stage: string, bench: string, snapshot: string) {
  const { door, token } = yield* tokenFor(bench, nameOf(stage), 0, yield* soon);
  const answer = yield* doorCall(
    door,
    token,
    HttpClientRequest.post("/world/backup").pipe(HttpClientRequest.bodyJsonUnsafe({ snapshot })),
    Schema.Union([Saved, Started]),
  );
  if ("sites" in answer) return answer.sites;
  // Asked again every 3 s until the backup is saved or failed, as a site being made is (Bench.ts, readyOn).
  return yield* doorCall(door, token, HttpClientRequest.get(`/world/backup/${snapshot}`), BackupState).pipe(
    Effect.flatMap((backup) =>
      backup.state === "saved"
        ? Effect.succeed(backup.sites ?? [])
        : Effect.fail(
            SiteFailed.make(
              backup.state === "saving"
                ? { step: "waiting", message: `${snapshot} is still being saved` }
                : { step: "door", message: `backup ${snapshot}: ${backup.error ?? "failed"}` },
            ),
          ),
    ),
    Effect.retry({ while: (error) => error.step === "waiting", schedule: Schedule.spaced(Duration.seconds(3)) }),
  );
});

/**
 * Makes again, in world `stage`, every site that world `from` saved as `snapshot` on `bench`, and waits until each is
 * ready. Answers each new site with the site it was saved from.
 */
export const restoreSites = Effect.fn("world.site.restore")(function* (
  from: string,
  stage: string,
  bench: string,
  snapshot: string,
  clock: BenchClock,
) {
  const expires = yield* soon;
  const { maxSites } = yield* Limits;
  const source = yield* tokenFor(bench, nameOf(from), 0, expires);
  const target = yield* tokenFor(bench, nameOf(stage), maxSites, expires);
  const key = yield* secretOf(stage, SITE_KEY_ID, "text");
  const secret = yield* secretOf(stage, SITE_SECRET_ID, "text");
  const asked = yield* doorCall(
    target.door,
    target.token,
    HttpClientRequest.post("/world/restore").pipe(
      HttpClientRequest.setHeader("x-capxul-source-token", Redacted.value(source.token)),
      HttpClientRequest.bodyJsonUnsafe({
        snapshot,
        api_key: Redacted.value(key),
        api_secret: Redacted.value(secret),
        clock,
      }),
    ),
    Restoring,
  );
  yield* Effect.forEach(asked.sites, (one) => readyOn(target.door, target.token, one.site));
  return asked.sites;
});

/**
 * Forgets what a snapshot saved of world `stage`'s sites on `bench`: their backup, and the point an in-place reset puts
 * them back to. What is already gone is no failure, nor is a door from before a backup could be forgotten (404): what
 * it keeps goes with the world's sites.
 */
export const dropSaved = Effect.fn("world.site.dropSaved")(function* (stage: string, bench: string, snapshot: string) {
  const { door, token } = yield* tokenFor(bench, nameOf(stage), 0, yield* soon);
  const forget = (request: HttpClientRequest.HttpClientRequest) =>
    doorCall(door, token, request, Schema.Unknown).pipe(
      Effect.asVoid,
      Effect.catchIf(
        (error) => Str.startsWith("HTTP 404")(error.message),
        (error) => Effect.logWarning(`${stage}'s ${snapshot} on ${bench}: ${error.message}`),
      ),
    );
  yield* forget(HttpClientRequest.delete(`/world/backup/${snapshot}`));
  yield* forget(HttpClientRequest.delete(`/world/points/${snapshot}`));
});
