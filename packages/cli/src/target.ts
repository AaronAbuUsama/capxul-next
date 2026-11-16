// Where a command's call goes, and what signs it (roadmap item 3.9). The environment's variables stand over the
// profile, so the runner's `--via=cli` (`callVia`), which sets them all, behaves as it always has and never reads a
// profile.
//
// - An account's command goes to the account: `CAPXUL_PLATFORM_URL` and `CAPXUL_PLATFORM_TOKEN`, or else the
//   profile's account and token (`capxul login`).
// - A world's command goes to the world named by `--world`, or else to `CAPXUL_DOOR_URL` with `CAPXUL_DOOR_TOKEN`,
//   or else to the world `capxul use` set. A named world is found by asking the account (`world.show`); the call goes
//   to the endpoint it answers, signed with the operator's token. With none of these, the command is a usage error.
// - `--at` (`CallOptions.at`) reaches another world's endpoint through the SDK's Reach, signed by the operator.
import { operations, Values, WORLD_PATH, CHAIN_PATH, type CallOptions } from "@capxul/blueprint";
import * as Sdk from "@capxul/sdk";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as CliError from "effect/cli/CliError";
import { readProfile } from "./profile.ts";

const WORLD_SHOW = operations["world.show"].rpc._tag;

const usage = (userMessage: string) => (cause: unknown) => CliError.UserError.make({ cause, userMessage });

const refuse = (userMessage: string) => Effect.fail(CliError.UserError.make({ cause: null, userMessage }));

/** The account a call is signed in to: its address and each operator's token, when there is one. */
export interface Account {
  readonly url: string;
  readonly first: Redacted.Redacted | null;
  readonly second: Redacted.Redacted | null;
}

const secondToken = Effect.mapError(
  Config.option(Config.Redacted("CAPXUL_SECOND_PLATFORM_TOKEN")),
  usage("CAPXUL_SECOND_PLATFORM_TOKEN is not a token"),
);

/** The account from the environment's variables alone, when they name one. */
const accountFromEnv = Effect.gen(function* () {
  const given = yield* Effect.mapError(
    Config.option(Sdk.platformTarget),
    usage("CAPXUL_PLATFORM_URL and CAPXUL_PLATFORM_TOKEN do not name an account"),
  );
  if (Option.isNone(given)) return Option.none<Account>();
  const second = yield* secondToken;
  return Option.some<Account>({ url: given.value.url, first: given.value.token, second: Option.getOrNull(second) });
});

/** The account: the environment's, or else the profile's. With neither, the caller is told to sign in. */
export const account = Effect.gen(function* () {
  const fromEnv = yield* accountFromEnv;
  if (Option.isSome(fromEnv)) return fromEnv.value;
  const profile = yield* readProfile;
  if (profile.account === undefined || profile.token === undefined)
    return yield* refuse(
      "not signed in: run capxul login --account <url> (the token is read from standard input), or set CAPXUL_PLATFORM_URL and CAPXUL_PLATFORM_TOKEN",
    );
  const second = yield* secondToken;
  return {
    url: profile.account,
    first: Redacted.make(profile.token),
    second: Option.getOrNull(second),
  } satisfies Account;
});

/** Where a world's operations answer, and the token that signs them. */
export type Own = Sdk.Target;

/** The operator's token on the account, or a usage error when it has none. */
const tokenOf = (signed: Account, operator: CallOptions["operator"]) => {
  const token = operator === "second" ? signed.second : signed.first;
  return token === null
    ? refuse(`no token for the ${operator ?? "first"} operator: set CAPXUL_SECOND_PLATFORM_TOKEN`)
    : Effect.succeed(token);
};

/** The world named `name`, found by asking the account where it answers, signed with the operator's token. */
const named = (name: string, operator: CallOptions["operator"]) =>
  Effect.gen(function* () {
    const world = yield* Effect.mapError(
      Schema.decodeEffect(Values.WorldName)(name),
      usage(`--world ${name} is not a world's name`),
    );
    const signed = yield* account;
    const token = yield* tokenOf(signed, operator);
    const view = yield* Effect.flatMap(Sdk.platformClient, (client) => client[WORLD_SHOW]({ world })).pipe(
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the account is known only once the environment and the profile are read; the lookup is its one call.
      Effect.provide(Sdk.platformDoor({ url: signed.url, token })),
      Effect.mapError((refusal) =>
        CliError.UserError.make({ cause: refusal, userMessage: `cannot find the world ${name}: ${refusal._tag}` }),
      ),
    );
    return { url: `${Str.replace(/\/+$/, "")(view.door)}${WORLD_PATH}`, token } satisfies Own;
  });

const noWorld =
  "no world to call: name one with --world <name>, or set the current world with capxul use <name> (or set CAPXUL_DOOR_URL and CAPXUL_DOOR_TOKEN)";

/**
 * The world a world's command calls: `--world`'s, else the environment's, else the profile's. A call `--at` another
 * world's endpoint calls that one, through Reach; its own world is the environment's, if any.
 */
export const ownWorld = (world: Option.Option<string>, options: CallOptions) =>
  Effect.gen(function* () {
    const fromEnv = yield* Effect.mapError(
      Config.option(Sdk.worldTarget),
      usage("CAPXUL_DOOR_URL and CAPXUL_DOOR_TOKEN do not name a world"),
    );
    if (options.at !== undefined) return Option.getOrNull(fromEnv);
    if (Option.isSome(world)) return yield* named(world.value, options.operator);
    if (Option.isSome(fromEnv)) return fromEnv.value;
    const profile = yield* readProfile;
    if (profile.world === undefined) return yield* refuse(noWorld);
    return yield* named(profile.world, options.operator);
  });

/** A group that is not reached by this call: the command line gives the SDK a client of it all the same. */
const unreached = (group: string): Sdk.Door => ({
  send: (name) => Effect.die(`${name}: this call reaches no ${group}`),
});

/**
 * The SDK's services for one call: the account's group signed by the first operator, the world's group at `own`,
 * and Reach for a call as the second operator or `--at` another world.
 */
export const reachingLayer = (signed: Account | null, own: Own | null) =>
  Layer.mergeAll(
    signed === null || signed.first === null
      ? Layer.succeed(Sdk.PlatformDoor, unreached("account"))
      : Sdk.platformDoor({ url: signed.url, token: signed.first }),
    own === null ? Layer.succeed(Sdk.WorldDoor, unreached("world")) : Sdk.worldDoor(own),
    signed === null || signed.first === null
      ? Layer.empty
      : Sdk.reach({
          platform: signed.url,
          chain:
            own === null
              ? { url: signed.url, token: signed.first }
              : { url: Str.replace(new RegExp(`${WORLD_PATH}/?$`), CHAIN_PATH)(own.url), token: own.token },
          operators: { first: signed.first, second: signed.second },
        }),
  );

/** The account for a world's call: needed only `--at` another world; otherwise the environment's, if it names one. */
export const accountForWorld = (options: CallOptions) =>
  options.at === undefined ? Effect.map(accountFromEnv, Option.getOrNull) : account;
