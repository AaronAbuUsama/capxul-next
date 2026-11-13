// A world's company sites in its snapshots (blueprint decisions.md, 17): saving them with the snapshot, and making
// them again in a world restored from it. The bench's site door does the work (packages/platform, door/snapshots.py);
// this is the world's half, as Bench.ts is for making and removing sites.
//
//   save     every site of the world, backed up under the snapshot's name, on the world's own token
//   restore  each site the source world saved as the snapshot, made again in the new world under its own label, from
//            the backup: on the new world's token, with the source's shown too (the door lets a world restore only
//            what that world saved), the new world's site credential and its clock; then waited for until ready
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { SITE_KEY_ID, SITE_SECRET_ID } from "../core/Core.ts";
import { Limits } from "../lifecycle/spec.ts";
import { secretOf } from "../stack/engine.ts";
import { nameOf } from "../stack/names.ts";
import { doorCall, readyOn, soon, tokenFor } from "./Bench.ts";

const Saved = Schema.Struct({
  world: Schema.String,
  snapshot: Schema.String,
  sites: Schema.Array(Schema.Struct({ site: Schema.String, label: Schema.String, ms: Schema.Finite })),
});

const Restoring = Schema.Struct({
  sites: Schema.Array(Schema.Struct({ site: Schema.String, from: Schema.String })),
});

/** The world's clock as the bench sets it: frozen at an instant, or running at an offset from the host's. */
export type BenchClock = { readonly frozen_at_ms: number } | { readonly offset_ms: number };

/** Saves every site of world `stage` on `bench` under `snapshot`; answers what was saved. */
export const saveSites = Effect.fn("world.site.save")(function* (stage: string, bench: string, snapshot: string) {
  const { door, token } = yield* tokenFor(bench, nameOf(stage), 0, yield* soon);
  const saved = yield* doorCall(
    door,
    token,
    HttpClientRequest.post("/world/backup").pipe(HttpClientRequest.bodyJsonUnsafe({ snapshot })),
    Saved,
  );
  return saved.sites;
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
