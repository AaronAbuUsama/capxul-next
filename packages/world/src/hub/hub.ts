// The fleet hub from outside: bringing a hub up and down (`./run.sh hub up|down|show`), and what a world's life asks of
// it: registering the world (its owner, its expiry and its token's secret), forgetting it, and the hub's ledger.
//
// How a stage gets its hub: `./run.sh hub up [--hub <stage>] --owner <op> --lifetime "7 days"`, once; every world
// made after that with `WORLD_HUB=<stage>` (default `fleet`) lives on it. A world's door token is `<stage>.<secret>`
// with `secret` an HMAC of the world's stage, owner and expiry under the hub's admin token, so the token is never
// stored anywhere but the hub's registration and the world's Core: whoever holds the hub's admin token (read from the
// hub's state) works it out again (`worldSecret`).
import * as Alchemist from "alchemy/Alchemist";
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Mac from "effect/crypto/Mac";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { HubMissing, LifetimeTooLong, WorldsStillExist } from "../failures.ts";
import { describeFailure } from "../lifecycle/describe.ts";
import { expiryOf, lifetimeAllowed } from "../lifecycle/expiry.ts";
import { checkOwner } from "../lifecycle/validate.ts";
import { forgetStage, recordedOutput, recordedStages, recordOutput, secretOf, SharedState } from "../stack/engine.ts";
import { openedState } from "../stack/stack.ts";
import { isWorldStage } from "../stack/names.ts";
import { ADMIN_TOKEN_ID, DEFAULT_HUB, HUB_STACK, LEGACY_HUB_CAPACITY } from "./names.ts";
import { type Registration, tokenOf } from "./registration.ts";
import { HubSettings, hubStack } from "./stack.ts";

/** What a hub's stage records as its outputs. No secret is among them. */
export const HubOutput = Schema.Struct({
  hub: Schema.String,
  owner: Schema.String,
  expiresAt: Schema.String,
  doorUrl: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  /** How many worlds the hub admits at once; a hub deployed before it was recorded admits LEGACY_HUB_CAPACITY. */
  capacity: Schema.optional(Schema.Finite),
});
export type HubOutput = typeof HubOutput.Type;

/** The hub a world is made on: `WORLD_HUB`, or `fleet`. */
export const HubStage = Config.String("WORLD_HUB").pipe(Config.withDefault(DEFAULT_HUB));

/** The longest a hub may live; `hub up` again on a live hub moves its expiry. */
export const HubMaxLifetime = Config.Duration("HUB_MAX_LIFETIME").pipe(Config.withDefault(Duration.days(30)));

/** A hub that answers: where its door is, until when it lives, and its admin token. */
export interface Hub {
  readonly stage: string;
  readonly owner: string;
  readonly expiresAt: string;
  readonly doorUrl: string;
  readonly admin: Redacted.Redacted;
  /** How many worlds it admits at once (src/lifecycle/claim.ts, `admit`). */
  readonly capacity: number;
}

const cryptoLayer = Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto));
const bytes = (text: string) => new TextEncoder().encode(text);

/** The world's door secret on the hub: HMAC-SHA256 of its stage, owner and expiry under the admin token, 32 hex. */
export const worldSecret = Effect.fn("world.hub.secret")(function* (
  hub: Pick<Hub, "admin">,
  world: { readonly stage: string; readonly owner: string; readonly expiresAt: string },
) {
  const mac = yield* Mac.Mac;
  const key = yield* Mac.key(Mac.hmacSha256, hub.admin.pipe(Redacted.value, bytes));
  const tag = yield* mac.sign(key, bytes(`${world.stage}\n${world.owner}\n${world.expiresAt}`));
  return Str.slice(0, 32)(Hex.encode(tag));
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- WebCrypto's HMAC, used for this one signature
}, Effect.provide(cryptoLayer));

/** The world's door token on the hub, as a secret. */
export const worldToken = (hub: Pick<Hub, "admin">, world: Parameters<typeof worldSecret>[1]) =>
  Effect.map(worldSecret(hub, world), (secret) => Redacted.make(tokenOf(world.stage, secret)));

/** A hub by its stage, from the shared state: refused unless it was deployed and has not expired. */
export const openHub = Effect.fn("world.hub.open")(function* (stage: string) {
  const missing = (message: string) => HubMissing.make({ hub: stage, message });
  const output = yield* Schema.decodeUnknownEffect(HubOutput)(yield* recordedOutput(stage, HUB_STACK)).pipe(
    Effect.mapError(() => missing(`no hub ${stage}: bring it up with \`hub up --hub ${stage}\``)),
  );
  if (output.doorUrl === undefined) return yield* missing(`hub ${stage} was never deployed`);
  const admin = yield* secretOf(stage, ADMIN_TOKEN_ID, "text", HUB_STACK);
  return {
    stage,
    owner: output.owner,
    expiresAt: output.expiresAt,
    doorUrl: output.doorUrl,
    admin,
    capacity: output.capacity ?? LEGACY_HUB_CAPACITY,
  } satisfies Hub;
});

/** One call to the hub's admin routes; its answer decoded with `schema`. A connection reset is tried again. */
const adminCall = <S extends Schema.Constraint>(hub: Hub, request: HttpClientRequest.HttpClientRequest, schema: S) =>
  HttpClient.execute(
    request.pipe(HttpClientRequest.prependUrl(`${hub.doorUrl}/admin/${Redacted.value(hub.admin)}`)),
  ).pipe(
    Effect.retry({ times: 2, schedule: Schedule.spaced("500 millis") }),
    Effect.flatMap((response): Effect.Effect<S["Type"], unknown, S["DecodingServices"]> =>
      response.status === 200
        ? HttpClientResponse.schemaBodyJson(schema)(response)
        : Effect.flatMap(response.text, (body) => Effect.fail(`HTTP ${response.status}: ${Str.slice(0, 200)(body)}`)),
    ),
    Effect.scoped,
    Effect.mapError((error) => HubMissing.make({ hub: hub.stage, message: describeFailure(error) })),
  );

/** Registers a world on the hub before anything of it starts. */
export const register = (hub: Hub, registration: Registration) =>
  adminCall(
    hub,
    HttpClientRequest.post(`/worlds/${registration.stage}`).pipe(HttpClientRequest.bodyJsonUnsafe(registration)),
    Schema.Struct({ registered: Schema.String, again: Schema.Boolean }),
  );

/** Removes everything of a world from the hub: its containers, its objects' state and its saved chain states. */
export const forget = (hub: Hub, stage: string) =>
  adminCall(
    hub,
    HttpClientRequest.post(`/worlds/${stage}/forget`),
    Schema.Struct({ forgot: Schema.String, objects: Schema.Finite }),
  );

/** The worlds the hub holds, from its ledger. */
export const ledger = (hub: Hub) =>
  Effect.map(
    adminCall(hub, HttpClientRequest.get("/worlds"), Schema.Struct({ worlds: Schema.Array(Schema.String) })),
    (answer) => answer.worlds,
  );

/** The worlds in the shared state that name this hub. */
export const worldsOn = (stage: string) =>
  Effect.map(recordedStages, (stages) =>
    Arr.flatMap(stages, ({ stage: world, output }) =>
      isWorldStage(world) && Schema.is(Schema.Struct({ hub: Schema.String }))(output) && output.hub === stage
        ? [world]
        : [],
    ),
  );

/**
 * Brings a hub up, or moves a live one's expiry: owner and expiry are recorded before the deploy, so a hub that dies
 * half-way is still found, and deleted, by the sweeper. Deploying once more changes nothing else.
 */
export const hubUp = Effect.fn("world.hub.up")(function* (spec: {
  readonly stage: string;
  readonly owner: string;
  readonly lifetime: Duration.Duration;
}) {
  const owner = yield* checkOwner(spec.owner);
  const most = yield* HubMaxLifetime;
  if (!lifetimeAllowed(spec.lifetime, most))
    return yield* LifetimeTooLong.make({
      world: spec.stage,
      askedMs: Duration.toMillis(spec.lifetime),
      mostMs: Duration.toMillis(most),
      message: `a hub may live at most ${Duration.format(most)}`,
    });
  const expiresAt = expiryOf(yield* DateTime.now, spec.lifetime);
  const before = { hub: spec.stage, owner, expiresAt, status: "deploying" };
  yield* recordOutput(spec.stage, before, HUB_STACK);
  const { store } = yield* SharedState;
  const stack = hubStack(openedState(store));
  const output = yield* Alchemist.plan({ stack, operation: "deploy", stage: spec.stage }).pipe(
    Effect.flatMap(Alchemist.apply),
    Effect.provideService(HubSettings, Option.some({ owner, expiresAt })),
    Effect.scoped,
  );
  return yield* Schema.decodeEffect(HubOutput)(output);
});

/** Destroys a hub and everything of it. Refused while a world names it or its ledger holds one. */
export const hubDown = Effect.fn("world.hub.down")(function* (stage: string) {
  const worlds = yield* worldsOn(stage);
  const held = yield* openHub(stage).pipe(
    Effect.flatMap(ledger),
    Effect.orElseSucceed((): ReadonlyArray<string> => []),
  );
  const all = Arr.dedupe([...worlds, ...held]);
  if (Arr.isReadonlyArrayNonEmpty(all))
    return yield* WorldsStillExist.make({ worlds: all, message: `destroy these worlds first: ${Arr.join(all, ", ")}` });
  const { store } = yield* SharedState;
  const plan = yield* Alchemist.plan({ stack: hubStack(openedState(store)), operation: "destroy", stage });
  yield* Alchemist.apply(plan);
  yield* forgetStage(stage, HUB_STACK);
  return { hub: stage, resourcesDestroyed: plan.summary.delete };
}, Effect.scoped);
