// The typed client: one function per blueprint operation, keyed by the blueprint's name, built from the operation
// names the blueprint's groups declare. Each call opens a caller-side span named after its operation, sends that
// span's trace in the blueprint's trace header, and answers the operation's success or one of its refusals.
import { Errors, operations, PERSON_HEADER, servedBy, TRACE_HEADER, type OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import type * as Tracer from "effect/Tracer";
import { readerOf } from "./chain.ts";
import {
  names as allNames,
  platformNames,
  worldNames,
  type CallOptions,
  type Client,
  type Full,
  type PlatformName,
  type Refusal,
  type Success,
  type WorldName,
} from "./operations.ts";
import { PlatformDoor, ReachDoors, WorldDoor, type Door, type Reach } from "./transport.ts";

/** W3C trace context for the call's own span: the server records its spans under this trace. */
export const traceparent = (span: Tracer.Span): string => `00-${span.traceId}-${span.spanId}-01`;

/** The caller-side span's name for an operation: the operation's own name, as the server's span is named. */
export const spanName = (name: OperationName): string => name;

/** The door a call goes through: the one the client was made with, or the one its options name. */
const doorFor = (name: OperationName, own: Door, reach: Reach | null, options?: CallOptions): Door => {
  const operator = options?.operator ?? "first";
  const platform = servedBy(name) === "platform";
  if (platform ? operator === "first" : options?.at === undefined) return own;
  if (reach === null) return unreached;
  return platform ? reach.platform(operator) : reach.world(options?.at ?? "", operator);
};

/** The door of a call that asks for a door the client cannot reach: it has no credential for it. */
const unreached: Door = { send: () => Effect.fail(Errors.NotSignedIn.make({ reason: "no_credential" })) };

/**
 * The payload, checked against its operation's schema before anything is sent (packages/blueprint,
 * src/common/refusals.ts). The command line runs the same check on a call before it writes the call's arguments
 * (packages/cli,
 * `argsOf`).
 */
export const checkPayload = (name: OperationName, payload: unknown): Effect.Effect<void, Errors.PayloadRejected> =>
  Effect.mapError(Effect.asVoid(Schema.encodeUnknownEffect(operations[name].rpc.payloadSchema)(payload)), (error) =>
    Errors.PayloadRejected.make({ operation: name, issue: error.message }),
  );

const callOf = (name: OperationName, own: Door, reach: Reach | null) =>
  Effect.fn(spanName(name), {
    kind: "client",
    attributes: { "rpc.method": name, "capxul.served_by": servedBy(name) },
  })(function* (payload: unknown, options?: CallOptions) {
    yield* checkPayload(name, payload);
    const span = yield* Effect.orDie(Effect.currentSpan);
    const headers = {
      [TRACE_HEADER]: traceparent(span),
      ...(options?.as === undefined ? {} : { [PERSON_HEADER]: options.as }),
    };
    const door = doorFor(name, own, reach, options);
    // A refusal is the caller's to act on. No answer, or a server that died in the call, is a defect.
    return yield* Effect.catchTag(door.send(name, payload, headers), "RpcClientError", Effect.die);
  });

const clientOf = <Names extends OperationName>(
  names: ReadonlyArray<Names>,
  door: Door,
  reach: Reach | null = null,
): Client<Names> =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each function is the call of the operation it is keyed by, made from that operation's Rpc; a record built from a list of names cannot carry each key's own type.
  Rec.fromEntries(Arr.map(names, (name) => [name, callOf(name, door, reach)])) as unknown as Client<Names>;

/** The platform's operations, through its door. */
export const platformClient: Effect.Effect<Client<PlatformName>, never, PlatformDoor> = Effect.map(
  Effect.service(PlatformDoor),
  (door) => clientOf(platformNames, door),
);

/** A world's operations, through its door. */
export const worldClient: Effect.Effect<Client<WorldName>, never, WorldDoor> = Effect.map(
  Effect.service(WorldDoor),
  (door) => clientOf(worldNames, door),
);

/**
 * Every operation of the blueprint, the platform's and the world's, and the chain reads. A call may ask for another
 * operator or another world's door (`CallOptions`), and a read for a chain, which `ReachDoors` reaches when it is
 * provided (`reach`); without it such a call is refused `NotSignedIn` (`no_credential`) and a read dies.
 */
export const make: Effect.Effect<Full, never, PlatformDoor | WorldDoor> = Effect.gen(function* () {
  const reach = Option.getOrNull(yield* Effect.serviceOption(ReachDoors));
  const platform = clientOf(platformNames, yield* PlatformDoor, reach);
  const world = clientOf(worldNames, yield* WorldDoor, reach);
  const chain = readerOf((options) =>
    reach === null
      ? (method) => Effect.die(`no chain to read ${method} from: the client was made without ReachDoors`)
      : reach.chain(options?.at ?? null, options?.operator ?? "first"),
  );
  return { ...platform, ...world, chain };
});

/**
 * The client as the service `tag`, such as the scenarios' `Capxul`: any service whose shape is `Full`. The SDK
 * does not import the scenarios; the runner hands it their tag.
 */
export const layer = <Id>(tag: Context.Key<Id, Full>): Layer.Layer<Id, never, PlatformDoor | WorldDoor> =>
  Layer.effect(tag, make);

/** Every operation the client calls, in the order the blueprint's groups list them. */
export const names: ReadonlyArray<OperationName> = allNames;

/**
 * A call by its name, with a payload known only at run time (the command line decodes one from its flags). It is
 * the same call, through the same client, so it answers exactly what the typed call answers.
 */
export const callByName = <Names extends OperationName>(
  client: Client<Names>,
  name: Names,
  payload: unknown,
  options?: CallOptions,
): Effect.Effect<Success<OperationName>, Refusal<OperationName>> =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the payload is unknown here; the call encodes it with its operation's own payload schema, which rejects anything that is not that operation's payload.
  (client[name] as unknown as Untyped)(payload, options);

type Untyped = (
  payload: unknown,
  options?: CallOptions,
) => Effect.Effect<Success<OperationName>, Refusal<OperationName>>;
