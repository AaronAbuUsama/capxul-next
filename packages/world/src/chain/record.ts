// What the chain's Durable Object remembers about its own starts and stops, kept in its storage and given out by
// `GET /chain/status`.
import type { StartReport } from "../containers/patience.ts";
import { remembered } from "../containers/record.ts";

/** How long a chain may sit unused before it is saved and stopped, unless the door is told otherwise. */
export const IDLE_SECONDS = 600;
/** How many starts that never got ready the chain remembers. */
const REMEMBERED_GAVE_UP = 5;

/** One start of the chain: where its state came from, and every try Cloudflare was asked for (src/containers). */
export interface ChainStart extends StartReport {
  readonly at: string;
  readonly from: "seed" | "saved state";
  readonly afterUnsavedStop: boolean;
  /** The whole wake, the restore of a saved state included; `StartReport.ms` is the tries alone. */
  readonly wakeMs: number;
}

/** What the chain remembers about its own starts and stops. */
export interface ChainRecord {
  readonly idleSeconds: number;
  /** True from a start until the stop that saved it. Still true at the next start: the container went unsaved. */
  readonly up: boolean;
  /** Whether the chain's first state came from another world. */
  readonly adopted: boolean;
  readonly starts: ReadonlyArray<ChainStart>;
  /** Starts that were never ready within the chain's patience, with every try. */
  readonly gaveUp?: ReadonlyArray<StartReport & { readonly at: string }>;
  readonly stops: ReadonlyArray<{
    readonly at: string;
    readonly why: "asked" | "idle";
    readonly head: string;
    readonly savedBytes: number;
    readonly ms: number;
  }>;
  /** The last save made while the chain kept running. */
  readonly lastSave: { readonly at: string; readonly head: string; readonly ms: number } | null;
}

export const fresh: ChainRecord = {
  idleSeconds: IDLE_SECONDS,
  up: false,
  adopted: false,
  starts: [],
  gaveUp: [],
  stops: [],
  lastSave: null,
};

/** The record with one more start that never got ready. */
export const withGaveUp = (old: ChainRecord, at: string, report: StartReport): ChainRecord => ({
  ...old,
  gaveUp: remembered(old.gaveUp ?? [], { at, ...report }, REMEMBERED_GAVE_UP),
});
