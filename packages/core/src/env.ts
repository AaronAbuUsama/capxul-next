// What a deploy of Core binds into its Worker's environment, by name, and how the running Worker reads it back. One
// list, so the deploy (src/stack/deployment.ts) and the Worker (src/worker.ts) cannot name a binding differently.
//
// Every fact is read per request from the environment: the Worker's init also runs at deploy, where it only names
// bindings, so nothing is read there.
import { Values } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

export const ENV = {
  /** The Hyperdrive configuration in front of the database: Core's own stage's, or its world's branch. */
  database: "DATABASE",
  /** The world's name; left out, the stage's (`ALCHEMY_STAGE`). */
  world: "CAPXUL_WORLD",
  owner: "WORLD_OWNER",
  doorToken: "CAPXUL_DOOR_TOKEN",
  platformToken: "CAPXUL_PLATFORM_TOKEN",
  secondOwner: "WORLD_SECOND_OWNER",
  secondPlatformToken: "CAPXUL_SECOND_PLATFORM_TOKEN",
  /** A service binding to the world's own door (packages/world), whose `/<token>/rpc` is the chain. */
  chain: "CHAIN",
  chainToken: "CAPXUL_CHAIN_TOKEN",
  /** The site door of the bench the world's sites are on, and the world's site token there. */
  siteDoor: "CAPXUL_SITE_DOOR",
  siteToken: "CAPXUL_SITE_TOKEN",
  /** The credential of the API user the site door made on each of the world's sites (never the bench's admin). */
  siteKey: "CAPXUL_SITE_KEY",
  siteSecret: "CAPXUL_SITE_SECRET",
  /** `empty` serves every operation's empty handler (src/empty-handlers.ts); left out, the built ones. */
  handlers: "CAPXUL_HANDLERS",
  /** A service binding to the collector, where Core exports its telemetry over OTLP; left out, nothing is exported. */
  collector: "CAPXUL_COLLECTOR",
  /** `on` writes every OTLP body Core exports into `telemetry.otlp` too: a test world's tap (src/telemetry/export.ts). */
  tap: "CAPXUL_TAP",
  /** The code's revision, bound at deploy: its exports' `service.version`. */
  revision: "CAPXUL_REVISION",
} as const;

/** A binding as the environment holds it: a secret may arrive wrapped or as plain text. */
export const textOf = (value: unknown): Option.Option<string> => {
  const inner = Redacted.isRedacted(value) ? Redacted.value(value) : value;
  return Predicate.isString(inner) && inner.length > 0 ? Option.some(inner) : Option.none();
};

export const secretOf = (env: Record<string, unknown>, name: string): Option.Option<Redacted.Redacted> =>
  Option.map(textOf(env[name]), (text) => Redacted.make(text));

const Named = Schema.Struct({ world: Values.WorldName, owner: Values.OperatorName });
const isOperator = Schema.is(Values.OperatorName);

/** Who this Core is, from its environment. A Core deployed without its facts dies on its first request. */
export const identityOf = (env: Record<string, unknown>) =>
  Effect.gen(function* () {
    const world = Option.orElse(textOf(env[ENV.world]), () => textOf(env["ALCHEMY_STAGE"]));
    const named = yield* Schema.decodeUnknownEffect(Named)({
      world: Option.getOrUndefined(world),
      owner: Option.getOrUndefined(textOf(env[ENV.owner])),
    }).pipe(Effect.orDie);
    const required = (name: string) =>
      Option.match(secretOf(env, name), {
        onNone: () => Effect.die(`Core was deployed without ${name}`),
        onSome: (secret) => Effect.succeed(secret),
      });
    const secondName = textOf(env[ENV.secondOwner]);
    const secondToken = secretOf(env, ENV.secondPlatformToken);
    const second =
      Option.isSome(secondName) && isOperator(secondName.value) && Option.isSome(secondToken)
        ? { second: { operator: secondName.value, token: secondToken.value } }
        : {};
    return {
      ...named,
      doorToken: yield* required(ENV.doorToken),
      platformToken: yield* required(ENV.platformToken),
      ...second,
    };
  });
