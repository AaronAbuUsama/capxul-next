// The platform, served by this process for a run in private worlds (packages/blueprint, src/things/world/values.ts):
// the blueprint's platform group from packages/world, over HTTP on this machine's loopback, where the Cloudflare and
// Neon keys are. The scenarios' client calls it as it would call any platform; what it kept of each call is read back
// through `PlatformKept`. It lives as long as the run, and every world it made is the run's to destroy.
import * as World from "@capxul/world";
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as HttpClient from "effect/http/HttpClient";
import { RunnerFailure } from "../failure.ts";
import type { Settings } from "../settings.ts";
import { EventRow, SpanRow } from "../world/database.ts";
import { PlatformKept } from "./kept.ts";

/**
 * Where the platform answers, every world it has made in this run, oldest first, and every world it tried to make,
 * refused and failed ones included, whose names the accounts are read for afterwards.
 */
export class Platform extends Context.Service<
  Platform,
  {
    readonly url: string;
    readonly made: Effect.Effect<ReadonlyArray<string>>;
    readonly tried: Effect.Effect<ReadonlyArray<string>>;
  }
>()("@capxul/runner/worlds/platform") {}

const Kept = Schema.Struct({ spans: Schema.Array(SpanRow), events: Schema.Array(EventRow) });

/** The label of where Core ran, when a host runs it off Cloudflare (src/local/host.ts); undefined on Cloudflare. */
export const coreLabel = Effect.map(World.CoreHost, (host) => Option.getOrUndefined(Option.map(host, (h) => h.label)));

/** Two operators, as the platform signs them in: these names, with the tokens the runner's settings hold. */
const operators = (settings: Settings, names: { readonly first: string; readonly second: string }) =>
  Layer.succeed(World.Operators, {
    first: { name: names.first, token: settings.platformToken },
    second: Option.map(settings.secondPlatformToken, (token) => ({ name: names.second, token })),
  });

/** A platform served on a free port of the loopback, signing in `named`, keeping what it makes in `lists`. */
const served = <E, R>(named: Layer.Layer<World.Operators>, lists: Layer.Layer<World.Made | World.Tried, E, R>) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const url = yield* World.platformUrl;
      const made = yield* World.Made;
      const tried = yield* World.Tried;
      const services = yield* Effect.context<World.SharedState | HttpClient.HttpClient>();
      const kept = (traceIds: ReadonlyArray<string>) =>
        World.keptByPlatform(traceIds).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Kept)),
          Effect.provide(services),
          Effect.mapError((error) =>
            RunnerFailure.make({
              step: "checks",
              message: `what the platform kept could not be read: ${error.message}`,
            }),
          ),
        );
      yield* Effect.logInfo(`the platform answers at ${url}`);
      return Context.make(Platform, { url, made: Ref.get(made), tried: Ref.get(tried) }).pipe(
        Context.add(PlatformKept, { kept }),
      );
    }),
  ).pipe(
    Layer.provideMerge(World.servePlatform),
    Layer.provideMerge(BunHttpServer.layer({ port: 0, hostname: "127.0.0.1" })),
    Layer.provideMerge(lists),
    Layer.provide(named),
  );

/** The platform, served for as long as the layer lives: the run's two operators, `WORLD_OWNER`'s and the second's. */
export const platformFor = (settings: Settings) =>
  served(
    operators(settings, { first: settings.owner, second: settings.secondOwner }),
    Layer.merge(World.Made.layer, World.Tried.layer),
  );

/**
 * A platform of its own for one journey with worlds of its own (side by side, RUNNER_SHAPE=shared): two operators
 * named for it (`ownersOf`), so its worlds count against quotas no other journey shares, while what it makes and
 * tries is kept in the run's own lists, where the run's sweep, summary and teardown read them. Built fresh, so no
 * part of it is shared with the run's platform or another journey's.
 */
export const journeyPlatform = (settings: Settings) =>
  Effect.map(Effect.all([World.Made, World.Tried]), ([made, tried]) =>
    served(
      operators(settings, { first: settings.owner, second: settings.secondOwner }),
      Layer.merge(Layer.succeed(World.Made, made), Layer.succeed(World.Tried, tried)),
    ),
  ).pipe(Layer.unwrap, Layer.fresh);

/** The run's own platform, passed on as it is: what a journey of the shared world calls. */
const theRun = () => Layer.effectContext(Effect.context<Platform | PlatformKept>());

type Own = ReturnType<typeof journeyPlatform>;

/**
 * The platform a journey calls side by side: one of its own when it has worlds of its own (`journeyPlatform`, with
 * `settings` naming its operators), else the run's.
 */
export const platformOfJourney = (
  own: boolean,
  settings: Settings,
): Layer.Layer<Platform | PlatformKept, Layer.Error<Own>, Layer.Services<Own> | Platform | PlatformKept> =>
  own ? journeyPlatform(settings) : theRun();
