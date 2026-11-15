// Who may call the platform: its two operators, each by the name the platform gives them and the token that signs
// them in (decisions.md, 16 and 37). The platform binds a world's owner's token into the world's Core, so the owner
// reaches the world's door with it (decisions.md, 36). Read from Config: `WORLD_OWNER` and `CAPXUL_PLATFORM_TOKEN`
// for the first, `WORLD_SECOND_OWNER` and `CAPXUL_SECOND_PLATFORM_TOKEN` for the second.
import { CoreIdentity } from "@capxul/core";
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Redacted from "effect/Redacted";
import { PLATFORM } from "../stack/names.ts";

export interface Operator {
  readonly name: string;
  readonly token: Redacted.Redacted;
}

export class Operators extends Context.Service<
  Operators,
  { readonly first: Operator; readonly second: Option.Option<Operator> }
>()("@capxul/world/account/operators") {
  static readonly fromConfig = Layer.effect(
    Operators,
    Effect.gen(function* () {
      const first = yield* Config.all({
        name: Config.String("WORLD_OWNER"),
        token: Config.Redacted("CAPXUL_PLATFORM_TOKEN"),
      });
      const second = yield* Config.option(
        Config.all({
          name: Config.String("WORLD_SECOND_OWNER"),
          token: Config.Redacted("CAPXUL_SECOND_PLATFORM_TOKEN"),
        }),
      );
      return { first, second };
    }),
  );
}

/** The token of the operator called `name`; none for a name the platform does not know. */
export const tokenOf = (name: string) =>
  Effect.map(Effect.service(Operators), (operators) =>
    Option.map(
      Arr.findFirst([operators.first, ...Option.toArray(operators.second)], (operator) => operator.name === name),
      (operator) => operator.token,
    ),
  );

/**
 * The platform's sign-in, as Core's: the first operator's token acts as the first operator, the second's as the
 * second. Core's identity also names a world and a door token, which the platform's sign-in never reads; the door
 * token is a fresh random value that nothing is given.
 */
export const PlatformIdentity = Layer.effect(
  CoreIdentity,
  Effect.gen(function* () {
    const { first, second } = yield* Operators;
    const unused = yield* Effect.map(Random.nextIntBetween(0, 2 ** 31 - 1), (n) => Redacted.make(`unused-${n}`));
    return {
      world: PLATFORM,
      owner: first.name,
      doorToken: unused,
      platformToken: first.token,
      ...Option.match(second, {
        onNone: () => ({}),
        onSome: (operator) => ({ second: { operator: operator.name, token: operator.token } }),
      }),
    };
  }),
);
