// The server half of the blueprint's three middlewares. `Telemetry` keeps the call's spans and gives the handler its
// `CurrentCall`. The two sign-ins establish who the call acts as; each also opens the call's span when it runs
// first (`measured`), so a call refused at sign-in is measured too.
//
// Sign-in checks the credential header (`Bearer <token>`) against the door's tokens. At the world group, the world's
// door token and the token of the operator who owns the world both act as the owner (decisions.md, 36). At the
// platform group, the owner's token acts as the owner and the second operator's token, when the deploy has one, as
// the second operator (decisions.md, 37). With no credential a call is refused with `NotSignedIn`
// (`no_credential`), with another token likewise (`unknown_caller`). Through the world's door a call then acts as
// the world's owner, or as the person its `capxul-person` header names; a header that is not a person's name is
// refused. Whether that person is of the world's cast is not checked: there is no cast until step 1.12. Real sign-in
// is a phase 4 risk (blueprint decisions.md, entry 16).
import {
  CREDENTIAL_HEADER,
  CurrentCaller,
  CurrentOperator,
  Errors,
  PERSON_HEADER,
  PlatformSignIn,
  Telemetry,
  Values,
  WorldSignIn,
} from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type * as Headers from "effect/http/Headers";
import { Placement } from "./attributes.ts";
import { SpanSink } from "./sink.ts";
import { measured } from "./spans.ts";

/** Which world this Core serves, who owns it, and the tokens its two doors accept: facts of its deploy. */
export class CoreIdentity extends Context.Service<
  CoreIdentity,
  {
    readonly world: typeof Values.WorldName.Type;
    readonly owner: typeof Values.OperatorName.Type;
    readonly doorToken: Redacted.Redacted;
    /** The owner operator's token: it signs platform calls, and acts as the owner at this world's door too. */
    readonly platformToken: Redacted.Redacted;
    /** The second operator, when the deploy names one: its name and its platform token. */
    readonly second?: { readonly operator: typeof Values.OperatorName.Type; readonly token: Redacted.Redacted };
  }
>()("@capxul/core/telemetry/middleware/CoreIdentity") {}

export const TelemetryLive = Layer.effect(
  Telemetry,
  Effect.gen(function* () {
    const sink = yield* SpanSink;
    const placement = yield* Placement;
    return Telemetry.of((effect, options) => measured(sink, placement, options, effect));
  }),
);

/**
 * Which of `accepted` the credential header (`Bearer <token>`) names, or a refusal: `no_credential` without one,
 * `unknown_caller` with any other.
 */
const credentialed = <A>(
  accepted: ReadonlyArray<readonly [Redacted.Redacted, A]>,
  headers: Headers.Headers,
): Effect.Effect<A, Errors.NotSignedIn> =>
  Option.match(Option.fromNullishOr(headers[CREDENTIAL_HEADER]), {
    onNone: () => Effect.fail(Errors.NotSignedIn.make({ reason: "no_credential" })),
    onSome: (credential) =>
      Option.match(
        Arr.findFirst(accepted, ([token]) => credential === `Bearer ${Redacted.value(token)}`),
        {
          onNone: () => Effect.fail(Errors.NotSignedIn.make({ reason: "unknown_caller" })),
          onSome: ([, who]) => Effect.succeed(who),
        },
      ),
  });

const isPerson = Schema.is(Values.PersonId);

export const WorldSignInLive = Layer.effect(
  WorldSignIn,
  Effect.gen(function* () {
    const sink = yield* SpanSink;
    const placement = yield* Placement;
    const { world, owner, doorToken, platformToken } = yield* CoreIdentity;
    const accepted = [
      [doorToken, "door"],
      [platformToken, "owner"],
    ] as const;
    return WorldSignIn.of((effect, options) =>
      measured(
        sink,
        placement,
        options,
        Effect.gen(function* () {
          yield* credentialed(accepted, options.headers);
          const named = Option.fromNullishOr(options.headers[PERSON_HEADER]);
          if (Option.isNone(named))
            return yield* Effect.provideService(effect, CurrentCaller, { _tag: "owner", owner, world });
          if (!isPerson(named.value)) return yield* Errors.NotSignedIn.make({ reason: "unknown_caller" });
          return yield* Effect.provideService(effect, CurrentCaller, { _tag: "person", person: named.value, world });
        }),
      ),
    );
  }),
);

/**
 * A platform call with the owner's token acts as the operator who owns this Core, and one with the second operator's
 * token as the second operator, until `packages/world` serves the platform group.
 */
export const PlatformSignInLive = Layer.effect(
  PlatformSignIn,
  Effect.gen(function* () {
    const sink = yield* SpanSink;
    const placement = yield* Placement;
    const { owner, platformToken, second } = yield* CoreIdentity;
    const accepted: ReadonlyArray<readonly [Redacted.Redacted, typeof Values.OperatorName.Type]> =
      second === undefined
        ? [[platformToken, owner]]
        : [
            [platformToken, owner],
            [second.token, second.operator],
          ];
    return PlatformSignIn.of((effect, options) =>
      measured(
        sink,
        placement,
        options,
        Effect.flatMap(credentialed(accepted, options.headers), (operator) =>
          Effect.provideService(effect, CurrentOperator, { operator }),
        ),
      ),
    );
  }),
);
