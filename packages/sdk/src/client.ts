// The typed client: one function per blueprint operation, keyed by the blueprint's name, built from the operation
// names the blueprint's groups declare. Each call opens a caller-side span named after its operation, sends that
// span's trace in the blueprint's trace header, and answers the operation's success or one of its refusals.
import { PERSON_HEADER, servedBy, TRACE_HEADER, type OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Rec from "effect/Record";
import type * as Tracer from "effect/Tracer";
import {
  names as allNames,
  platformNames,
  worldNames,
  type CallOptions,
  type Client,
  type PlatformName,
  type Refusal,
  type Success,
  type WorldName,
} from "./operations.ts";
import { PlatformDoor, WorldDoor, type Door } from "./transport.ts";

/** W3C trace context for the call's own span: the server records its spans under this trace. */
export const traceparent = (span: Tracer.Span): string => `00-${span.traceId}-${span.spanId}-01`;

/** The caller-side span's name for an operation: the operation's own name, as the server's span is named. */
export const spanName = (name: OperationName): string => name;

const callOf = (name: OperationName, door: Door) =>
  Effect.fn(spanName(name), {
    kind: "client",
    attributes: { "rpc.method": name, "capxul.served_by": servedBy(name) },
  })(function* (payload: unknown, options?: CallOptions) {
    const span = yield* Effect.orDie(Effect.currentSpan);
    const headers = {
      [TRACE_HEADER]: traceparent(span),
      ...(options?.as === undefined ? {} : { [PERSON_HEADER]: options.as }),
    };
    // A refusal is the caller's to act on. No answer, or a server that died in the call, is a defect.
    return yield* Effect.catchTag(door.send(name, payload, headers), "RpcClientError", Effect.die);
  });

const clientOf = <Names extends OperationName>(names: ReadonlyArray<Names>, door: Door): Client<Names> =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each function is the call of the operation it is keyed by, made from that operation's Rpc; a record built from a list of names cannot carry each key's own type.
  Rec.fromEntries(Arr.map(names, (name) => [name, callOf(name, door)])) as unknown as Client<Names>;

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

/** Every operation of the blueprint: the platform's and the world's. */
export const make: Effect.Effect<Client, never, PlatformDoor | WorldDoor> = Effect.zipWith(
  platformClient,
  worldClient,
  (platform, world): Client => ({ ...platform, ...world }),
);

/**
 * The client as the service `tag`, such as the scenarios' `Capxul`: any service whose shape is `Client`. The SDK
 * does not import the scenarios; the runner hands it their tag.
 */
export const layer = <Id>(tag: Context.Key<Id, Client>): Layer.Layer<Id, never, PlatformDoor | WorldDoor> =>
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
