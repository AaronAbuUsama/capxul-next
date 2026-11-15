// What a ratchet is (docs/design/blueprint.md, part 4; roadmap items 3.6 and 3.11): a gap between old work and the
// blueprint, declared once in the blueprint's registry, whose list may only shrink. The toolkit counts each by its
// `count` (../checks/ratchets.ts); the blueprint declares which ratchets exist. Nothing here reaches outside itself.

/**
 * How a ratchet is counted, by the toolkit's counter of that name: a typed-once lint rule's unmigrated list
 * (packages/lint/src/unmigrated.ts, its findings in all), the delta check's formats' unmigrated lists (the
 * blueprint's, their operations in all), the glossary's old words (generated/old-words.json, every old word's count,
 * in all), or the ratchet's own `unmigrated` list (its names in all).
 */
export type Counter =
  | "lint:owned-values"
  | "lint:declared-names"
  | "lint:decoded-rows"
  | "formats"
  | "words:old-words"
  | "own-list";

/** One ratchet. */
export interface Ratchet {
  readonly id: string;
  readonly name: string;
  /** What its list holds, in one sentence. */
  readonly holds: string;
  /** The roadmap item (or decision) that empties the list and closes it. */
  readonly closes: string;
  /** How it is counted, or "not yet counted". */
  readonly count: Counter | "not yet counted";
  /** For a ratchet not yet counted: the roadmap item that will count it. */
  readonly countedBy?: string;
  /**
   * For a ratchet gated by a command of its own, not by `pnpm ratchets`: that command. `pnpm ratchets` reports its
   * count and leaves it out of generated/ratchets.json, so only that command fails when its list grows.
   */
  readonly gate?: string;
  /** For a ratchet counted by its own list (`own-list`): what has not yet moved to its rule. It may only shrink. */
  readonly unmigrated?: ReadonlyArray<string>;
}
