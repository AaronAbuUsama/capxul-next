// A world's company sites across an in-place reset (roadmap 1.16 to 1.18): saved to a point of the bench with the
// world's snapshot, and put back in place to it when the world is reset. The bench's site door does the work
// (packages/platform, door/points.py: `POST /world/save` and `POST /world/reset`; door/pool.py and door/claim.py:
// `POST /templates` and `POST /world/claim`); this is the world's half, as Saved.ts is for a restore into a new world.
//
// A reset puts the world's sites where the snapshot had them:
//
//   none     a snapshot of a world with no company: every site the world holds now is removed, so a company founded
//            again makes its own (a site left there would be refused as `site-exists`)
//   in place the point's sites are put back by the door, and a site made after the save is removed
//   claimed  the point holds none of its sites any more (a site removed by an earlier reset is dropped from every
//            point by the door): the world's sites are removed and claimed, ready, from the bench template the world
//            kept of the snapshot (`keepTemplate`, named by src/things/site-template/sweep.ts), which the caller names, then saved
//            again as the point, so the next reset is in place
//
// The door's reset puts the world's clock entry back as it was saved (a running clock at its saved offset), while a
// reset world's clock reads the snapshot's time at the reset (src/things/world/reset.ts), so the entry is set to the
// world's clock right after (`POST /clock`): Core, the chain and the bench then read one clock.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { SITE_KEY_ID, SITE_SECRET_ID } from "../../parts/api/Api.ts";
import { SiteFailed } from "../../common/failures.ts";
import { Limits } from "../world/values.ts";
import { secretOf } from "../../stack/engine.ts";
import { nameOf } from "../../stack/names.ts";
import { sitesOn, soon, tokenFor } from "./bench.ts";
import { doorCall, doorJob } from "./client.ts";
import type { BenchClock } from "./snapshot.ts";

const Point = Schema.Struct({ world: Schema.String, point: Schema.String });
const Reset = Schema.Struct({
  world: Schema.String,
  point: Schema.String,
  sites: Schema.Array(Schema.Struct({ site: Schema.String, ms: Schema.Finite })),
  sites_not_in_point: Schema.Array(Schema.String),
});
/** The door's refusals of a reset whose point no longer matches the world's sites (door/points.py). */
const LOST = ["point-site-missing", "point-site-changed", "point-not-found"];
const Templates = Schema.Struct({ templates: Schema.Array(Schema.Struct({ template: Schema.String })) });
const Claimed = Schema.Struct({ sites: Schema.Array(Schema.Struct({ site: Schema.String })), ms: Schema.Finite });
const Made = Schema.Struct({
  template: Schema.String,
  ms: Schema.Finite,
  /** False when the template already existed: the door never changes one (door/templates.py). */
  made: Schema.optional(Schema.Boolean),
  sites: Schema.Array(Schema.Struct({ made_by: Schema.optional(Schema.String) })),
});

/** How a reset put the world's sites back, and which it removed or claimed. */
export interface SitesReset {
  readonly how: "none" | "in place" | "claimed";
  readonly removed: ReadonlyArray<string>;
  readonly claimed: ReadonlyArray<string>;
}

/** Saves every site of world `stage` on `bench` to a point named after the snapshot. */
export const savePoint = Effect.fn("world.site.savePoint")(function* (stage: string, bench: string, snapshot: string) {
  const { door, token } = yield* tokenFor(bench, nameOf(stage), 0, yield* soon);
  return yield* doorJob(
    door,
    token,
    HttpClientRequest.post("/world/save").pipe(HttpClientRequest.bodyJsonUnsafe({ point: snapshot })),
    Point,
  );
});

/** Removes `sites` of world `stage` from `bench`, one by one; the door drops them from the world's points too. */
const removeEach = (stage: string, bench: string, sites: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { door, token } = yield* tokenFor(bench, nameOf(stage), 0, yield* soon);
    yield* Effect.forEach(sites, (site) =>
      doorJob(door, token, HttpClientRequest.delete(`/sites/${site}`), Schema.Unknown),
    );
    return sites;
  });

/** The world's sites claimed from the bench's template `template`, ready, on the world's credential and clock. */
const claimFrom = (stage: string, bench: string, template: string, clock: BenchClock) =>
  Effect.gen(function* () {
    const { maxSites } = yield* Limits;
    const { door, token } = yield* tokenFor(bench, nameOf(stage), maxSites, yield* soon);
    const listed = yield* doorCall(door, token, HttpClientRequest.get("/templates"), Templates);
    if (!Arr.some(listed.templates, (each) => each.template === template))
      return yield* SiteFailed.make({
        step: "claim",
        message: `the point holds none of the world's sites, and the bench keeps no template ${template} to claim them from`,
      });
    const key = yield* secretOf(stage, SITE_KEY_ID, "text");
    const secret = yield* secretOf(stage, SITE_SECRET_ID, "text");
    const claimed = yield* doorJob(
      door,
      token,
      HttpClientRequest.post("/world/claim").pipe(
        HttpClientRequest.bodyJsonUnsafe({
          template,
          api_key: Redacted.value(key),
          api_secret: Redacted.value(secret),
          clock,
        }),
      ),
      Claimed,
    );
    return Arr.map(claimed.sites, (each) => each.site);
  });

/** Sets the bench's clock entry of world `stage` to `clock`. */
const setClock = (stage: string, bench: string, clock: BenchClock) =>
  Effect.gen(function* () {
    const { door, token } = yield* tokenFor(bench, nameOf(stage), 0, yield* soon);
    yield* doorJob(
      door,
      token,
      HttpClientRequest.post("/clock").pipe(HttpClientRequest.bodyJsonUnsafe(clock)),
      Schema.Unknown,
    );
  });

/**
 * Puts world `stage`'s sites on `bench` where its snapshot `snapshot` had them (`companies` of them), in place where
 * the point still holds them and by claim from the bench template `template` (the one the world kept of the
 * snapshot) where it does not; then its clock entry to `clock`.
 */
export const resetSites = Effect.fn("world.site.reset")(function* (
  stage: string,
  bench: string,
  snapshot: string,
  companies: number,
  clock: BenchClock,
  template: Option.Option<string>,
) {
  const now = Arr.map(yield* sitesOn(stage, bench), (each) => each.site);
  if (companies === 0)
    return { how: "none", removed: yield* removeEach(stage, bench, now), claimed: [] } satisfies SitesReset;
  const { door, token } = yield* tokenFor(bench, nameOf(stage), 0, yield* soon);
  const reset = yield* doorJob(
    door,
    token,
    HttpClientRequest.post("/world/reset").pipe(HttpClientRequest.bodyJsonUnsafe({ point: snapshot })),
    Reset,
  ).pipe(
    // The point lost its sites, or one was made again since: the sites are claimed instead. Anything else fails.
    Effect.asSome,
    Effect.catchIf(
      (error) => Arr.some(LOST, (code) => Str.includes(code)(error.message)),
      () => Effect.succeed(Option.none<typeof Reset.Type>()),
    ),
  );
  if (Option.isSome(reset) && reset.value.sites.length === companies) {
    const removed = yield* removeEach(stage, bench, reset.value.sites_not_in_point);
    yield* setClock(stage, bench, clock);
    return { how: "in place", removed, claimed: [] } satisfies SitesReset;
  }
  if (Option.isNone(template))
    return yield* SiteFailed.make({
      step: "claim",
      message: `the point ${snapshot} holds none of the world's sites, and no bench template was named to claim them from`,
    });
  const removed = yield* removeEach(stage, bench, now);
  const claimed = yield* claimFrom(stage, bench, template.value, clock);
  yield* savePoint(stage, bench, snapshot);
  yield* setClock(stage, bench, clock);
  return { how: "claimed", removed, claimed } satisfies SitesReset;
});

/**
 * Keeps world `stage`'s sites on `bench` as the bench template `template` (src/things/site-template/sweep.ts names it), with a
 * pool of ready copies the bench refills: what a reset claims from when its point lost its sites. A world with one site
 * hands it over as it is; one with more, from the backup `world.snapshot.save` made under `snapshot`. The door never
 * changes a template that exists; one that exists already must be this world's, since its sites hold this world's
 * company facts and no other's.
 */
export const keepTemplate = Effect.fn("world.site.keepTemplate")(function* (
  stage: string,
  bench: string,
  template: string,
  snapshot: string,
) {
  const sites = Arr.map(yield* sitesOn(stage, bench), (each) => each.site);
  const world = nameOf(stage);
  const { door, token } = yield* tokenFor(bench, world, 0, yield* soon);
  const source = sites.length === 1 ? { site: sites[0] } : { snapshot };
  const kept = yield* doorJob(
    door,
    token,
    HttpClientRequest.post("/templates").pipe(HttpClientRequest.bodyJsonUnsafe({ template, ...source })),
    Made,
  );
  const others = Arr.filter(kept.sites, (site) => site.made_by !== undefined && site.made_by !== world);
  if (Arr.isReadonlyArrayNonEmpty(others))
    return yield* SiteFailed.make({
      step: "template",
      message: `the bench template ${template} was made by world ${others[0].made_by ?? "?"}, not ${world}`,
    });
  return { template: kept.template, ms: kept.ms, made: kept.made ?? true };
});
