// What a format is, as the delta check (delta.ts) reads it: a shape of declaration every operation must have once it
// exists (docs/roadmap.md, "Typed once, by check" and "New formats by a ratchet"). The registry is formats.ts.

/** A finding that belongs to no one operation's declaration: a domain's own, or a name that is no operation. */
export interface Stray {
  /** The operation it names, or the domain's folder when it is the domain's own. */
  readonly operation: string;
  readonly reason: string;
}

/** One format of declaration. */
export interface Format<Name extends string = string> {
  /** Why `operation` lacks the format: nothing when it complies. */
  missing(operation: string): ReadonlyArray<string>;
  /** The existing operations allowed to lack it today. The list may only shrink; a new operation is never added. */
  readonly unmigrated: ReadonlyArray<Name>;
  /** What the format finds wrong outside any one operation's declaration. */
  strays?(): ReadonlyArray<Stray>;
}
