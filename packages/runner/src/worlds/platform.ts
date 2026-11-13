// The platform, served by this process for a run in private worlds (packages/blueprint decisions.md, 48): the
// blueprint's platform group from packages/world, over HTTP on this machine's loopback, where the Cloudflare and Neon
// keys are. The scenarios' client calls it as it would call any platform; what it kept of each call is read back
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

/** Where the platform answers, and every world it has made in this run, oldest first. */
export class Platform extends Context.Service<
  Platform,
  { readonly url: string; readonly made: Effect.Effect<ReadonlyArray<string>> }
>()("@capxul/runner/worlds/platform") {}

const Kept = Schema.Struct({ spans: Schema.Array(SpanRow), events: Schema.Array(EventRow) });

/** The run's two operators, as the platform signs them in: the names and tokens the runner's settings hold. */
const operators = (settings: Settings) =>
  Layer.succeed(World.Operators, {
    first: { name: settings.owner, token: settings.platformToken },
    second: Option.map(settings.secondPlatformToken, (token) => ({ name: settings.secondOwner, token })),
  });

/** The platform, served on a free port of the loopback for as long as the layer lives. */
export const platformFor = (settings: Settings) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const url = yield* World.platformUrl;
      const made = yield* World.Made;
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
      return Context.make(Platform, { url, made: Ref.get(made) }).pipe(Context.add(PlatformKept, { kept }));
    }),
  ).pipe(
    Layer.provideMerge(World.servePlatform),
    Layer.provideMerge(BunHttpServer.layer({ port: 0, hostname: "127.0.0.1" })),
    Layer.provideMerge(World.Made.layer),
    Layer.provide(operators(settings)),
  );
