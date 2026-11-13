// The server half of the blueprint's three middlewares. `Telemetry` keeps the call's spans and gives the handler its
// `CurrentCall`. The two sign-ins establish who the call acts as; each also opens the call's span when it runs
// first (`measured`), so a call refused at sign-in is measured too.
//
// Sign-in is provisional until the world's door gives Core its token (roadmap step 1.3): a call through the door
// acts as the world's owner, or as the person its `capxul-person` header names. A header that is not a person's
// name is refused with `NotSignedIn`. Real sign-in is a phase 4 risk (decisions.md, entry 16).
import {
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
import * as Schema from "effect/Schema";
import { SpanSink } from "./sink.ts";
import { measured } from "./spans.ts";

/** Which world this Core serves and who owns it: facts of its deploy. */
export class CoreIdentity extends Context.Service<
  CoreIdentity,
  { readonly world: typeof Values.WorldName.Type; readonly owner: typeof Values.OperatorName.Type }
>()("@capxul/core/telemetry/middleware/CoreIdentity") {}

export const TelemetryLive = Layer.effect(
  Telemetry,
  Effect.gen(function* () {
    const sink = yield* SpanSink;
    return Telemetry.of((effect, options) => measured(sink, options, effect));
  }),
);

const isPerson = Schema.is(Values.PersonId);

export const WorldSignInLive = Layer.effect(
  WorldSignIn,
  Effect.gen(function* () {
    const sink = yield* SpanSink;
    const { world, owner } = yield* CoreIdentity;
    return WorldSignIn.of((effect, options) =>
      measured(
        sink,
        options,
        Effect.gen(function* () {
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

/** A platform call acts as the operator who owns this Core, until `packages/world` serves the platform group. */
export const PlatformSignInLive = Layer.effect(
  PlatformSignIn,
  Effect.gen(function* () {
    const sink = yield* SpanSink;
    const { owner } = yield* CoreIdentity;
    return PlatformSignIn.of((effect, options) =>
      measured(sink, options, Effect.provideService(effect, CurrentOperator, { operator: owner })),
    );
  }),
);
