// A journey's reads of a chain's logs, kept (roadmap 4.11's speed lane, "the scenario chain checks scan from
// genesis"). A check that asks for every CompanySafeMinted, PaymentSent or BudgetCreated so far reads from genesis
// once per journey; each later ask reads only the blocks since, up to the head it read, and adds them to what it kept.
// What a check judges never changes: it gets every log of its kind up to the chain's head now, as a scan from genesis
// would give it. A run that keeps nothing (no `ChainScans`, as a unit test) reads from genesis every time.
import type { Chain } from "@capxul/blueprint";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { Capxul } from "../client.ts";
import { steady } from "./steady.ts";
import { whereOf, type Who } from "./world.ts";

/** What a journey kept of one kind of log on one chain: every such log up to block `next` - 1. */
interface Kept {
  readonly next: number;
  readonly logs: ReadonlyArray<Chain.Log>;
}

/** The journey's kept log reads, by chain, kind and address: provided by `journey` (journey.ts) to its steps. */
export class ChainScans extends Context.Service<ChainScans, Ref.Ref<ReadonlyMap<string, Kept>>>()(
  "@capxul/scenarios/support/scans/ChainScans",
) {}

/** A journey's empty kept reads. */
export const noScans = Ref.make<ReadonlyMap<string, Kept>>(new Map());

/**
 * Every log of kind `log` (from `address`, or any when null) on the chain `who` reaches, up to its head now: read from
 * genesis the journey's first time, and from where it left off after.
 */
export const logsSoFar = (log: Chain.LogName, address: string | null, who: Who = {}) =>
  Effect.gen(function* () {
    const chain = steady((yield* Capxul).chain);
    const where = whereOf(who);
    const kept = yield* Effect.serviceOption(ChainScans);
    if (Option.isNone(kept)) return yield* chain.logs({ log, address, fromBlock: null, toBlock: null }, where);
    const key = `${where.at ?? ""}|${where.operator ?? "first"}|${log}|${address ?? "*"}`;
    const head = (yield* chain.head({}, where)).number;
    const was = (yield* Ref.get(kept.value)).get(key);
    if (was !== undefined && was.next > head) return was.logs;
    const since = yield* chain.logs({ log, address, fromBlock: was?.next ?? null, toBlock: head }, where);
    const now: Kept = { next: head + 1, logs: [...(was?.logs ?? []), ...since] };
    // A read that raced another keeps whichever went further: both read the same chain.
    yield* Ref.update(kept.value, (all) => ((all.get(key)?.next ?? 0) >= now.next ? all : new Map(all).set(key, now)));
    return now.logs;
  });
