// What an acceptance claim is. A claim is a plain sentence a scenario proves black-box: through the door, from a
// declared starting world, with the runner's generic checks on every call. Claims live in each concept's
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
  readonly given: StartingWorld;
  /** What the scenario does and reads, through the door, to prove it. */
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
  given: StartingWorld,
  observes: string,
  options: {
    readonly refusals?: ReadonlyArray<EventClass>;
    readonly origin?: Origin;
    readonly thinLine?: boolean;
  } = {},
): Claim => ({
  says,
  given,
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
