// Renewing a world that is meant to last, such as a shared world (roadmap step 2.3): the SAME world, its name,
// branch, data, chain, sites and snapshots kept, given a later expiry and deployed again with the code that runs now.
// Its expiry is in four places, and each is moved:
//
//   registry  the name's row, so the owner's count of live worlds reads the new expiry (src/things/registry/reserve.ts)
//   branch    Neon's own expiry on the world's branch is lifted: Neon would delete the branch at the old one, and the
//             sweeper deletes the world at its recorded expiry anyway (as for a world another is made from)
//   hub       the world registered again with its new expiry; its door token is an HMAC over the expiry, so the
//             token changes and the old one reaches nothing (src/things/cluster/client.ts)
//   stack     Core deployed again with the new door token, a site token minted anew until the new expiry, the
//             world's own operator token, and the running code; the stage's outputs then hold the new expiry
//
// then Core's pending migrations, and Core waited for until it answers steadily. A renewed world's Core accepts its
// own operator token (`operator-token`, which `open` hands whoever holds the Cloudflare key), not the token of the
// process that made it: a world that outlives that process is reached the way its hub is, through the shared state.
// Between the hub's registration and Core's deploy the world's Core reaches no chain, for some seconds; a renewal
// that fails half-way is run again.
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { CORE_MIGRATIONS } from "../../parts/api/Api.ts";
import { connectionOf, projectId } from "../../parts/database/neon.ts";
import { migrate } from "../../parts/database/sql.ts";
import { RenewRefused } from "../../common/failures.ts";
import { openHub, register, worldSecret } from "../cluster/client.ts";
import { tokenOf } from "../cluster/registration.ts";
import { steady } from "../../parts/api/steady.ts";
import { grantOn } from "../site/bench.ts";
import { deployStage, recordedOutput } from "../../stack/engine.ts";
import { nameOf } from "../../stack/names.ts";
import { liftBranchExpiry } from "../../stack/cloud.ts";
import { extendClaim, registry } from "../registry/reserve.ts";
import { renewalOf } from "./expiry.ts";
import { handle, WorldOutput } from "./handle.ts";
import { forgetWorld } from "./kept.ts";
import { Limits } from "./values.ts";
import { mustExist } from "./take-down.ts";

/** The most a renewal may take: Core's deploy (about 10 s), its migrations and its steady answers, with room. */
export const RenewTimeout = Config.Duration("WORLD_TIMEOUT_RENEW").pipe(Config.withDefault(Duration.minutes(6)));

const Status = Schema.Struct({ status: Schema.optional(Schema.String) });

/** Gives world `name` an expiry `lifetime` from now and deploys it again; says what changed and how long each part took. */
export const renew = Effect.fn("world.renew")(function* (name: string, lifetime: Duration.Duration) {
  const stage = yield* mustExist(name);
  const recorded = yield* recordedOutput(stage);
  const refused = (message: string) => RenewRefused.make({ world: nameOf(stage), message });
  const status = Option.getOrUndefined(Schema.decodeUnknownOption(Status)(recorded))?.status;
  if (status === "parked" || status === "creating")
    return yield* refused(`it is ${status}: only a world that is up is renewed`);
  const output = yield* Schema.decodeUnknownEffect(WorldOutput)(recorded);
  const { maxLifetime, maxSites } = yield* Limits;
  const hub = yield* openHub(output.hub);
  const decided = renewalOf({
    now: yield* DateTime.now,
    lifetime,
    most: maxLifetime,
    current: output.expiresAt,
    hub: hub.expiresAt,
  });
  if ("refused" in decided) return yield* refused(decided.refused);
  const { expiresAt } = decided;
  const taken = yield* Ref.make<Record<string, number>>({});
  const timed = <A, E, R>(part: string, effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const began = yield* Clock.currentTimeMillis;
      const result = yield* effect;
      const ms = (yield* Clock.currentTimeMillis) - began;
      yield* Ref.update(taken, (was) => ({ ...was, [part]: ms }));
      return result;
    });
  const began = yield* Clock.currentTimeMillis;
  const timeout = yield* RenewTimeout;
  const world = yield* Effect.gen(function* () {
    const bench =
      output.bench === undefined || output.bench === "none" ? Option.none<string>() : Option.some(output.bench);
    const granted = yield* Effect.transposeOption(
      Option.map(bench, (stageOfBench) =>
        grantOn(stageOfBench, stage, expiresAt, maxSites, { owner: output.owner, grade: "private" }),
      ),
    );
    yield* timed(
      "registry",
      Effect.flatMap(registry, (names) => extendClaim(names, stage, expiresAt)),
    );
    const project = yield* projectId;
    const connectionUri = yield* timed(
      "branch",
      Effect.andThen(liftBranchExpiry(project, output.branch), connectionOf(project, output.branch)),
    );
    const secret = yield* worldSecret(hub, { stage, owner: output.owner, expiresAt });
    const doorToken = Redacted.make(tokenOf(stage, secret));
    yield* timed("hub", register(hub, { stage, secret, owner: output.owner, expiresAt }));
    const settings = {
      owner: output.owner,
      // Only test grades are offered (src/account/worlds.ts refuses `real`), so a renewed world is one.
      grade: "private" as const,
      expiresAt,
      forkedFrom: output.forkedFrom === "nothing" ? Option.none<string>() : Option.some(output.forkedFrom),
      bench: granted,
      operatorToken: Option.none<Redacted.Redacted>(),
      hub: { stage: hub.stage, doorUrl: hub.doorUrl },
      doorToken,
      branch: { id: output.branch, connectionUri },
    };
    const deployed = yield* timed(
      "deploy",
      deployStage(stage, Option.some(settings)).pipe(Effect.flatMap(Schema.decodeUnknownEffect(WorldOutput))),
    );
    yield* timed("migrate", migrate(connectionUri, CORE_MIGRATIONS));
    // What was kept of the world was worked out for its old expiry; the handle keeps what the renewal made.
    yield* forgetWorld(stage);
    const renewed = yield* handle(deployed, { token: doorToken, database: connectionUri });
    yield* timed("core", steady(renewed.coreUrl));
    return renewed;
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () => refused(`the renewal did not finish within its declared ${Duration.format(timeout)}`),
    }),
  );
  yield* Effect.logInfo(`world ${stage}: renewed until ${expiresAt} (was ${output.expiresAt})`);
  return {
    world: world.name,
    owner: world.owner,
    was: output.expiresAt,
    expiresAt: world.expiresAt,
    hub: hub.stage,
    door: world.coreUrl,
    ms: { ...(yield* Ref.get(taken)), renew: (yield* Clock.currentTimeMillis) - began },
  };
});
