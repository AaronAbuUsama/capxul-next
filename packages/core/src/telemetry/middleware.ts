// The server half of the blueprint's three middlewares. `Telemetry` keeps the call's spans and gives the handler its
// `CurrentCall`. The two sign-ins establish who the call acts as; each also opens the call's span when it runs
// first (`measured`), so a call refused at sign-in is measured too.
//
// Sign-in checks the credential header (`Bearer <token>`) against the door's token: the world's door token for the
// world group, the operator's token for the platform group. With no credential a call is refused with `NotSignedIn`
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
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type * as Headers from "effect/http/Headers";
import { SpanSink } from "./sink.ts";
import { measured } from "./spans.ts";

/** Which world this Core serves, who owns it, and the tokens its two doors accept: facts of its deploy. */
export class CoreIdentity extends Context.Service<
  CoreIdentity,
  {
    readonly world: typeof Values.WorldName.Type;
    readonly owner: typeof Values.OperatorName.Type;
    readonly doorToken: Redacted.Redacted;
    readonly platformToken: Redacted.Redacted;
  }
>()("@capxul/core/telemetry/middleware/CoreIdentity") {}

export const TelemetryLive = Layer.effect(
  Telemetry,
  Effect.gen(function* () {
    const sink = yield* SpanSink;
    return Telemetry.of((effect, options) => measured(sink, options, effect));
  }),
);

/** Refuses a call whose credential header is not `Bearer <token>`. */
const credentialed = (token: Redacted.Redacted, headers: Headers.Headers): Effect.Effect<void, Errors.NotSignedIn> =>
  Option.match(Option.fromNullishOr(headers[CREDENTIAL_HEADER]), {
    onNone: () => Effect.fail(Errors.NotSignedIn.make({ reason: "no_credential" })),
    onSome: (credential) =>
      credential === `Bearer ${Redacted.value(token)}`
        ? Effect.void
        : Effect.fail(Errors.NotSignedIn.make({ reason: "unknown_caller" })),
  });

const isPerson = Schema.is(Values.PersonId);

export const WorldSignInLive = Layer.effect(
  WorldSignIn,
  Effect.gen(function* () {
    const sink = yield* SpanSink;
    const { world, owner, doorToken } = yield* CoreIdentity;
    return WorldSignIn.of((effect, options) =>
      measured(
        sink,
        options,
        Effect.gen(function* () {
          yield* credentialed(doorToken, options.headers);
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
 * A platform call with the operator's token acts as the operator who owns this Core, until `packages/world` serves
 * the platform group.
 */
export const PlatformSignInLive = Layer.effect(
  PlatformSignIn,
  Effect.gen(function* () {
    const sink = yield* SpanSink;
    const { owner, platformToken } = yield* CoreIdentity;
    return PlatformSignIn.of((effect, options) =>
      measured(
        sink,
        options,
        Effect.andThen(
          credentialed(platformToken, options.headers),
          Effect.provideService(effect, CurrentOperator, { operator: owner }),
        ),
      ),
    );
  }),
);
