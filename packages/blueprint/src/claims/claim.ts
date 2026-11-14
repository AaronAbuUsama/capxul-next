// What an acceptance claim is. A claim is a plain sentence the journeys check black-box (packages/scenarios): through
// the door, in the state of a declared starting world, with the runner's generic checks on every call. Since scenarios
// became journeys (docs/roadmap.md, 14 November 2026) a claim has no scenario of its own: it is checked by its
// operation's checks, which run on every call of it in every journey, and by the journeys' steps that call it as the
// claim says; packages/scenarios' `coverage.ts` says which. Claims live in each concept's
// `claims.ts`; claims.md is rendered from them (`pnpm claims`) and a test fails when the two differ.
import type { EventClass, Operation } from "../operation.ts";
import type { StartingWorld } from "../starting-worlds.ts";

/** Where a claim came from in the old blueprint (`docs/thin-line/operations.json`, its `evalId`). */
export type Origin =
  | { readonly id: string; readonly kept: "word for word" }
  | { readonly id: string; readonly kept: "rewritten"; readonly was: string; readonly why: string }
  | null;

export interface Claim {
  readonly says: string;
  /**
   * The starting world whose state the claim speaks of. A journey checks the claim in that state: one that starts
   * from that world, or one that starts earlier and brings its world to the same state by its own steps.
   */
  readonly state: StartingWorld;
  /** What a journey does and reads, through the door, to check it, and what its operation's checks hold. */
  readonly observes: string;
  /** The refusals the claim exercises. Each must be one the operation declares. */
  readonly refusals: ReadonlyArray<EventClass>;
  readonly origin: Origin;
  /** The claim the thin line's journey proves for this step. */
  readonly thinLine: boolean;
}

/** An old claim this contract does not keep, and why. */
export interface Dropped {
  readonly id: string;
  readonly was: string;
  readonly why: string;
}

export interface ClaimsOf {
  readonly operation: Operation;
  /** Numbered from 1 in this order. */
  readonly claims: ReadonlyArray<Claim>;
  readonly dropped: ReadonlyArray<Dropped>;
}

export const claim = (
  says: string,
  state: StartingWorld,
  observes: string,
  options: {
    readonly refusals?: ReadonlyArray<EventClass>;
    readonly origin?: Origin;
    readonly thinLine?: boolean;
  } = {},
): Claim => ({
  says,
  state,
  observes,
  refusals: options.refusals ?? [],
  origin: options.origin ?? null,
  thinLine: options.thinLine ?? false,
});

/** An old claim kept exactly as it was written. */
export const kept = (id: string): Origin => ({ id: `acc:${id}`, kept: "word for word" });

/** An old claim kept in substance and rewritten. */
export const rewritten = (id: string, was: string, why: string): Origin => ({
  id: `acc:${id}`,
  kept: "rewritten",
  was,
  why,
});

export const dropped = (id: string, was: string, why: string): Dropped => ({ id: `acc:${id}`, was, why });
