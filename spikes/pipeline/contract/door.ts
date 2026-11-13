// The contract's one door: every operation with its declaration, and the Rpc group the server serves and every
// client is derived from. Nothing in contract/ imports infrastructure or an implementation.
import * as RpcGroup from "effect/rpc/RpcGroup";
import type { Operation } from "./operation.ts";
import * as Record from "./record.ts";
import { Telemetry } from "./telemetry.ts";

/** Every operation, by name. The generic runner looks a call's declaration up here. */
export const operations = {
  "record.append": Record.append,
  "record.export": Record.exportAll,
} as const satisfies { readonly [name: string]: Operation };

export type OperationName = keyof typeof operations;

/** The Rpc group. `CoreRpcs.toLayer` does not compile until every operation above has a handler. */
export class CoreRpcs extends RpcGroup.make(Record.append.rpc, Record.exportAll.rpc).middleware(Telemetry) {}

export { CurrentCall, Telemetry, TRACE_HEADER } from "./telemetry.ts";
export { declare, eventNamesOf, isRefusal, type EventClass, type EventOf, type Expected, type Operation } from "./operation.ts";
export * as Record from "./record.ts";
