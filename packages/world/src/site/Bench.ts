// A world's company sites on a shared bench (roadmap step 1.4; the decision "Site creation on a shared bench").
//
//   grant    when the world is planned: its site token, minted under the platform's door key for this world, the
//            world's site quota (`WORLD_MAX_SITES`) and its expiry, and where the bench's site door answers. Core is
//            deployed with both (src/core/Core.ts), so it reaches the sites by itself.
//   make     the `site` step, once Core answers: each company's site, made by the door with the world's token and
//            the credential of the API user Core will call as; the step waits until every site is ready.
//   remove   the `unsite` step of every take-down (a destroy, a failed run, the sweeper): every site of the world,
//            with a token minted anew (quota 0, a quarter of an hour), since the world's own may have expired.
//
// The bench is the platform stage `WORLD_BENCH` names (packages/platform), read from the shared state with the
// world's own store; it is recorded in the world's outputs, so its take-down finds it whatever the setting is then.
import * as Platform from "@capxul/platform";
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Str from "effect/String";
import { SITE_KEY_ID, SITE_SECRET_ID } from "../core/Core.ts";
import { SiteFailed } from "../failures.ts";
import { describeFailure } from "../lifecycle/describe.ts";
import type { Company } from "../lifecycle/spec.ts";
import { secretOf, withState } from "../stack/engine.ts";
import { nameOf } from "../stack/names.ts";
import type { BenchGrant } from "../stack/settings.ts";

/** The platform stage whose bench a new world's sites go on; unset, worlds have no bench and no sites. */
export const BenchStage = Config.option(Config.String("WORLD_BENCH"));

export const TOKEN_HEADER = "x-capxul-site-token";

export const SiteState = Schema.Struct({
  site: Schema.String,
  world: Schema.String,
  company: Schema.NullOr(Schema.String),
  state: Schema.String,
  ms: Schema.NullOr(Schema.Finite),
  steps: Schema.Array(Schema.Struct({ step: Schema.String, ms: Schema.Finite })),
  error: Schema.NullOr(Schema.String),
});
export type SiteState = typeof SiteState.Type;

const WorldSites = Schema.Struct({ world: Schema.String, sites: Schema.Array(SiteState) });
const Removed = Schema.Struct({
  removed: Schema.Array(Schema.Struct({ site: Schema.String, ms: Schema.Finite })),
});

const unix = (iso: string) => Math.floor(DateTime.toEpochMillis(DateTime.makeUnsafe(iso)) / 1000);

/** A quarter of an hour from now, in Unix seconds: the life of a token minted to read or remove a world's sites. */
export const soon = Effect.map(DateTime.now, (now) => Math.floor(DateTime.toEpochMillis(now) / 1000) + 15 * 60);

/**
 * The bench a runner serves on its own machine for a rehearsal, named so in `WORLD_BENCH`: not a platform stage, so
 * neither its door nor its key is in the shared state. Its door's address and key are given beside it
 * (`WORLD_BENCH_DOOR`, `WORLD_BENCH_KEY`): packages/platform's `bin/pool-bench.sh` bench, whose key the runner's
 * run.sh reads from that bench's secrets file and never prints. Only this machine reaches it, as with a stand-in.
 */
export const LOCAL_BENCH = "local";

const LocalBench = Config.all({
  door: Config.String("WORLD_BENCH_DOOR"),
  key: Config.Redacted("WORLD_BENCH_KEY"),
});

/** Where `bench`'s door answers and its key: from the shared state for a platform stage, else the local bench's. */
export const doorOf = (bench: string) =>
  bench === LOCAL_BENCH
    ? Effect.map(LocalBench, (local) => ({ door: local.door, key: local.key }))
    : withState((state) =>
        Effect.gen(function* () {
          const outputs = yield* Platform.platformOutputsIn(state, bench);
          return { door: outputs.doorUrl, key: yield* Platform.doorKeyIn(state, bench) };
        }),
      );

/** A token for `world` on `bench`, minted under the bench's door key. */
export const tokenFor = (bench: string, world: string, quota: number, expires: number) =>
  Effect.gen(function* () {
    const { door, key } = yield* doorOf(bench);
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- WebCrypto's HMAC is the platform's own layer, used for this one signature
    const token = yield* Platform.mint(key, { world, quota, expires }).pipe(Effect.provide(Platform.cryptoLayer));
    return { door, token };
  });

/** What a world is given on its bench when it is created; none when `WORLD_BENCH` is unset. */
export const grant = Effect.fn("world.site.grant")(function* (stage: string, expiresAt: string, quota: number) {
  const bench = yield* BenchStage;
  if (Option.isNone(bench)) return Option.none<BenchGrant>();
  const made = yield* tokenFor(bench.value, nameOf(stage), quota, unix(expiresAt));
  return Option.some<BenchGrant>({ stage: bench.value, door: made.door, token: made.token });
});

/**
 * A refusal's body in words: the door's own answer as it is, or an HTML error page (Cloudflare's, before the door,
 * such as 524 when the door took over 100 s) by its title.
 */
const wordsOf = (body: string) => {
  const title = /<title>([^<]*)<\/title>/i.exec(body)?.[1];
  return title === undefined ? Str.slice(0, 300)(body) : `${Str.trim(title)} (an error page before the door)`;
};

/** One call to the site door with `token`, its answer decoded with `schema`. */
export const doorCall = <S extends Schema.Constraint>(
  door: string,
  token: Redacted.Redacted,
  request: HttpClientRequest.HttpClientRequest,
  schema: S,
) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(
      request.pipe(
        HttpClientRequest.prependUrl(door),
        HttpClientRequest.setHeader(TOKEN_HEADER, Redacted.value(token)),
      ),
    );
    if (response.status >= 400) {
      const refused = yield* response.text;
      return yield* SiteFailed.make({ step: "door", message: `HTTP ${response.status}: ${wordsOf(refused)}` });
    }
    return yield* HttpClientResponse.schemaBodyJson(schema)(response);
  }).pipe(
    Effect.scoped,
    Effect.mapError((error) =>
      Schema.is(SiteFailed)(error) ? error : SiteFailed.make({ step: "door", message: describeFailure(error) }),
    ),
  );

/** Makes each company's site with the world's token and waits until every one is ready. */
export const makeSites = Effect.fn("world.site.make")(function* (
  stage: string,
  bench: BenchGrant,
  companies: ReadonlyArray<Company>,
) {
  if (Arr.isReadonlyArrayEmpty(companies)) return [];
  const key = yield* secretOf(stage, SITE_KEY_ID, "text");
  const secret = yield* secretOf(stage, SITE_SECRET_ID, "text");
  const asked = yield* Effect.forEach(companies, (company) =>
    doorCall(
      bench.door,
      bench.token,
      HttpClientRequest.post("/sites").pipe(
        HttpClientRequest.bodyJsonUnsafe({
          label: company.label,
          company: company.name,
          api_key: Redacted.value(key),
          api_secret: Redacted.value(secret),
        }),
      ),
      SiteState,
    ),
  );
  // The door makes one site at a time, about 100 s each: the step's declared timeout bounds the wait.
  return yield* Effect.forEach(asked, (one) => readyOn(bench.door, bench.token, one.site));
});

/** Waits until the door says `site` is ready; a site that failed is a defect, with the door's reason. */
export const readyOn = (door: string, token: Redacted.Redacted, site: string) =>
  doorCall(door, token, HttpClientRequest.get(`/sites/${site}`), SiteState).pipe(
    Effect.flatMap((state) =>
      state.state === "ready"
        ? Effect.succeed(state)
        : state.state === "creating"
          ? Effect.fail(SiteFailed.make({ step: "waiting", message: `${site} is still being made` }))
          : Effect.die(SiteFailed.make({ step: "make", message: `${site}: ${state.state}: ${state.error ?? ""}` })),
    ),
    Effect.retry({
      while: (error) => error.step === "waiting",
      schedule: Schedule.spaced(Duration.seconds(3)),
    }),
  );

/** The world's sites on `bench`, as the door holds them, with a fresh token of quota 0. */
export const sitesOn = Effect.fn("world.site.list")(function* (stage: string, bench: string) {
  const expires = yield* soon;
  const { door, token } = yield* tokenFor(bench, nameOf(stage), 0, expires);
  const found = yield* doorCall(door, token, HttpClientRequest.get("/world"), WorldSites);
  return found.sites;
});

/**
 * Removes every site of the world from `bench`, with a fresh token of quota 0, and checks the door holds none of
 * them afterwards. Nothing to do for a world with no bench.
 */
export const removeSites = Effect.fn("world.site.remove")(function* (stage: string, bench: Option.Option<string>) {
  if (Option.isNone(bench)) return [];
  const expires = yield* soon;
  const { door, token } = yield* tokenFor(bench.value, nameOf(stage), 0, expires);
  const gone = yield* doorCall(door, token, HttpClientRequest.delete("/world"), Removed);
  const left = (yield* doorCall(door, token, HttpClientRequest.get("/world"), WorldSites)).sites;
  if (Arr.isReadonlyArrayNonEmpty(left))
    return yield* SiteFailed.make({
      step: "remove",
      message: `still on the bench: ${Arr.join(
        Arr.map(left, (site) => site.site),
        ", ",
      )}`,
    });
  return Arr.map(gone.removed, (site) => site.site);
});

/**
 * One read of one site through the door, as world `stage` with a fresh token of quota 0 and the world's site
 * credential: what the door and the site answered, a refusal included. Used by the proof that a second world's token
 * is refused for the first world's site.
 */
export const readSite = Effect.fn("world.site.read")(function* (
  stage: string,
  bench: string,
  credentialOf: string,
  site: string,
  path: string,
) {
  const expires = yield* soon;
  const { door, token } = yield* tokenFor(bench, nameOf(stage), 0, expires);
  const key = yield* secretOf(credentialOf, SITE_KEY_ID, "text");
  const secret = yield* secretOf(credentialOf, SITE_SECRET_ID, "text");
  return yield* Effect.gen(function* () {
    const response = yield* HttpClient.execute(
      HttpClientRequest.get(`${door}/sites/${site}${path}`).pipe(
        HttpClientRequest.setHeader(TOKEN_HEADER, Redacted.value(token)),
        HttpClientRequest.setHeader("authorization", `token ${Redacted.value(key)}:${Redacted.value(secret)}`),
      ),
    );
    return { status: response.status, body: yield* response.json };
  }).pipe(
    Effect.scoped,
    Effect.mapError((error) => SiteFailed.make({ step: "door", message: describeFailure(error) })),
  );
});
