// Reading the platform's own records from the shared state store: a stage's recorded outputs, and one attribute of
// one of its resources as a secret. The door key is reached this way (src/run-mint.ts), never as a stack output,
// because alchemy prints and stores outputs in plain text.
import * as Alchemist from "alchemy/Alchemist";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

/** The platform's outputs that other code reads back (alchemy.run.ts returns them). */
export const PlatformOutputs = Schema.Struct({
  stage: Schema.String,
  host: Schema.String,
  context: Schema.String,
  domain: Schema.String,
  edge: Schema.String,
  doorHost: Schema.String,
  /** Where a world reaches the site door: through the tunnel, the relay, or (no edge) on the host only. */
  doorUrl: Schema.String,
  doorKeyId: Schema.String,
  containers: Schema.Array(Schema.String),
});
export type PlatformOutputs = typeof PlatformOutputs.Type;

/** Opens the state store the given stack file is configured with, for the length of `use`. */
export const withState = <A, E, R>(
  entrypoint: string,
  use: (state: Effect.Success<ReturnType<typeof Alchemist.State.store>>) => Effect.Effect<A, E, R>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const state = yield* Alchemist.State.store({ type: "configured", entrypoint });
      return yield* use(state);
    }),
  );

/** The state store, as another package that opened the same account's store hands it in. */
export type StateStore = Effect.Success<ReturnType<typeof Alchemist.State.store>>;

/** What a stage recorded as its outputs, decoded, read from an open store; fails when the stage was never deployed. */
export const outputsIn = (state: StateStore, stack: string, stage: string) =>
  state.getOutput({ stack, stage }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(PlatformOutputs)));

/** What a stage recorded as its outputs, decoded; fails when the stage was never deployed. */
export const recordedOutputs = (entrypoint: string, stack: string, stage: string) =>
  withState(entrypoint, (state) => outputsIn(state, stack, stage));

const asSecret = (value: unknown): Option.Option<Redacted.Redacted> => {
  const inner = Redacted.isRedacted(value) ? Redacted.value(value) : value;
  return typeof inner === "string" && inner.length > 0 ? Option.some(Redacted.make(inner)) : Option.none();
};

/** One attribute of one resource of a stage, as a secret; dies with what was missing, never with the value. */
export const secretOf = (entrypoint: string, stack: string, stage: string, logicalId: string, attribute: string) =>
  withState(entrypoint, (state) => secretIn(state, stack, stage, logicalId, attribute));

/** The same, from an open store. */
export const secretIn = (state: StateStore, stack: string, stage: string, logicalId: string, attribute: string) =>
  Effect.gen(function* () {
    const fqns = yield* state.list({ stack, stage });
    const fqn = Arr.findFirst(fqns, (c) => c === logicalId || Str.endsWith(`/${logicalId}`)(c));
    if (Option.isNone(fqn)) return yield* Effect.die(`${stack}/${stage} holds no resource called ${logicalId}`);
    const found = yield* state.get({ stack, stage, fqn: fqn.value });
    const attributes: Record<string, unknown> =
      found !== undefined && "attr" in found && found.attr !== undefined ? found.attr : {};
    const secret = asSecret(attributes[attribute]);
    if (Option.isNone(secret)) return yield* Effect.die(`${stack}/${stage} ${logicalId} has no ${attribute} yet`);
    return secret.value;
  });
