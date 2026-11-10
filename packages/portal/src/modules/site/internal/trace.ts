/**
 * What happens when an operation runs: the steps of the record that implements it, and under each step what the
 * book says it does: the contract functions it calls, the outside calls, the procedures, the transitions it
 * drives, the events those send, the tables it writes and the spans it names.
 */
import { keyOf, type AnyRecord } from "@capxul/book";

import type { Ref, Trace, TraceStep } from "../types.ts";
import type { Ctx } from "./context.ts";
import { refOf } from "./locate.ts";
import { field, isRecord, list, objects, records, text } from "./values.ts";

/** The record a link points at, as the book holds it. */
const held = (ctx: Ctx, r: AnyRecord): AnyRecord => ctx.input.book.records.get(keyOf(r)) ?? r;
const refs = (u: unknown): readonly Ref[] => records(u).map(refOf);
const once = (found: readonly AnyRecord[]): readonly AnyRecord[] => [...new Map(found.map((r) => [keyOf(r), r] as const)).values()];

/** The events a transition sends: its machine's record holds them under the transition's name. */
const transitionEvents = (ctx: Ctx, t: AnyRecord): readonly AnyRecord[] => {
  const machine = ctx.input.book.records.get(`machine:${text(t["machine"])}`);
  return records(field(field(machine?.["transitions"], text(t["name"])), "emits"));
};

/** Every event an rpc or a procedure sends: its own, its transitions', and those of the procedures it invokes. */
const eventsOf = (ctx: Ctx, r: AnyRecord, seen = new Set<string>()): readonly AnyRecord[] => {
  if (seen.has(keyOf(r))) return [];
  seen.add(keyOf(r));
  return once([
    ...records(r["emits"]),
    ...records(r["drives"]).flatMap((t) => transitionEvents(ctx, t)),
    ...records(r["invokes"]).flatMap((p) => eventsOf(ctx, held(ctx, p), seen)),
  ]);
};

const NOTHING = { chain: [], calls: [], invokes: [], drives: [], events: [], writes: [], spans: [] } as const;

/** One rpc as a step: everything its record lists. */
const rpcStep = (ctx: Ctx, name: string, about: string, link: AnyRecord): TraceStep => {
  const rpc = held(ctx, link);
  return {
    name, about: about || text(rpc["title"]), does: "rpc", rpc: refOf(rpc),
    chain: refs(rpc["chain"]), calls: refs(rpc["calls"]), invokes: refs(rpc["invokes"]), drives: refs(rpc["drives"]),
    events: eventsOf(ctx, rpc).map(refOf), writes: refs(rpc["writes"]), spans: list(rpc["spans"]).map(text),
  };
};

/**
 * The trace of the record that implements an operation. A flow gives its steps in order, each rpc step opened up;
 * an rpc alone is one step; with nothing implementing it, the trace is empty.
 */
export const traceOf = (ctx: Ctx, link: AnyRecord | null): Trace => {
  if (!link) return { by: null, kind: "", spans: [], calls: [], steps: [] };
  const impl = held(ctx, link);
  if (impl._kind !== "flow") {
    return { by: refOf(impl), kind: impl._kind, spans: [], calls: [], steps: [rpcStep(ctx, impl.id, "", impl)] };
  }
  return {
    by: refOf(impl), kind: "flow", spans: list(impl["spans"]).map(text), calls: refs(impl["calls"]),
    steps: objects(impl["steps"]).map((s) => {
      const rpc = s["rpc"];
      return isRecord(rpc)
        ? rpcStep(ctx, text(s["name"]), text(s["about"]), rpc)
        : { ...NOTHING, name: text(s["name"]), about: text(s["about"]), does: text(s["local"]) || "local", rpc: null };
    }),
  };
};
