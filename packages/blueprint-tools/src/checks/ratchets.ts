// The ratchets counted (docs/design/blueprint.md, part 4; roadmap item 3.6): each ratchet of the blueprint's registry
// (packages/blueprint/src/ratchets.ts) tallied by its counter from the lists that hold it today, compared with the
// committed counts (packages/blueprint/generated/ratchets.json). Pure: ratchets.entry.ts reads the lists and the file,
// prints, and writes; the tests run it on made-up registries and lists.
import type { Counter, Ratchet } from "../language/ratchet.ts";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";

/** Where `pnpm generate` writes the counts and the scorecard, from packages/blueprint. */
export const OUTPUTS = { counts: "generated/ratchets.json", scorecard: "generated/scorecard.md" } as const;

/** The lists the counters read. */
export interface Lists {
  /** Each typed-once lint rule's unmigrated list (packages/lint/src/unmigrated.ts): a file, and its findings. */
  readonly lint: { readonly [rule: string]: { readonly [file: string]: number } };
  /** Each format's unmigrated list (formats.ts): the operations allowed to lack it today. */
  readonly formats: { readonly [format: string]: ReadonlyArray<string> };
  /** The glossary's old words as generated/old-words.json counts them (old-words.ts): a word, and its count. */
  readonly oldWords: { readonly [word: string]: number };
}

/** One ratchet, counted: its count and the items behind it, or null when it is not yet counted. */
export interface Tally {
  readonly ratchet: Ratchet;
  readonly count: number | null;
  readonly items: ReadonlyArray<string>;
}

/** The committed counts, by ratchet id: only ratchets that are counted. */
export type Counts = { readonly [id: string]: number };

const sum = (numbers: ReadonlyArray<number>): number => Arr.reduce(numbers, 0, (total, n) => total + n);

/** A lint rule's list: its findings in all, one item per file. */
const lintList = (lists: Lists, rule: string): Omit<Tally, "ratchet"> => {
  const list = lists.lint[rule] ?? {};
  return {
    count: sum(Rec.values(list)),
    items: Arr.map(Rec.toEntries(list), ([file, n]) => `${file}: ${String(n)}`),
  };
};

/** Every format's list: its operations in all, one item per operation and format. */
const formatLists = (lists: Lists): Omit<Tally, "ratchet"> => {
  const items = Arr.flatMap(Rec.toEntries(lists.formats), ([format, operations]) =>
    Arr.map(operations, (operation) => `${format}: ${operation}`),
  );
  return { count: items.length, items };
};

/** The lists of `formats` only: each operation on any of them once, one item each. */
const someFormats =
  (formats: ReadonlyArray<string>) =>
  (lists: Lists): Omit<Tally, "ratchet"> => {
    const items = Arr.dedupe(Arr.flatMap(formats, (format) => lists.formats[format] ?? []));
    return { count: items.length, items };
  };

/** The old words still written: their count in all, one item per word still written. */
const oldWordList = (lists: Lists): Omit<Tally, "ratchet"> => ({
  count: sum(Rec.values(lists.oldWords)),
  items: Arr.flatMap(Rec.toEntries(lists.oldWords), ([word, n]) => (n > 0 ? [`${word}: ${String(n)}`] : [])),
});

/** Each counter, by the name the registry gives it. */
/** A ratchet's own list: its names in all, one item each. */
const ownList = (_lists: Lists, ratchet: Ratchet): Omit<Tally, "ratchet"> => {
  const items = ratchet.unmigrated ?? [];
  return { count: items.length, items };
};

const counters: { readonly [C in Counter]: (lists: Lists, ratchet: Ratchet) => Omit<Tally, "ratchet"> } = {
  "lint:owned-values": (lists) => lintList(lists, "owned-values"),
  "lint:declared-names": (lists) => lintList(lists, "declared-names"),
  "lint:decoded-rows": (lists) => lintList(lists, "decoded-rows"),
  formats: formatLists,
  "formats:machine": someFormats(["machine"]),
  "formats:allowed": someFormats(["allowed"]),
  "formats:steps": someFormats(["spans", "logs"]),
  "formats:promises": someFormats(["promises"]),
  "words:old-words": oldWordList,
  "own-list": ownList,
};

/** Every ratchet of `registry`, counted from `lists`. */
export const tally = (registry: ReadonlyArray<Ratchet>, lists: Lists): ReadonlyArray<Tally> =>
  Arr.map(registry, (ratchet) =>
    ratchet.count === "not yet counted"
      ? { ratchet, count: null, items: [] }
      : { ratchet, ...counters[ratchet.count](lists, ratchet) },
  );

/**
 * The counts `pnpm ratchets` gates: of the ratchets that are counted, those with no gate of their own (`gate`), which
 * are reported only.
 */
export const countsOf = (tallies: ReadonlyArray<Tally>): Counts =>
  Rec.fromEntries(
    Arr.flatMap(tallies, ({ ratchet, count }) =>
      count === null || ratchet.gate !== undefined ? [] : [[ratchet.id, count] as const],
    ),
  );

/** How a ratchet's count reads in `pnpm ratchets` and the scorecard. */
export const countText = ({ ratchet, count }: Tally): string =>
  count === null
    ? `not yet counted (${ratchet.countedBy ?? "unassigned"})`
    : ratchet.gate === undefined
      ? String(count)
      : `${String(count)}, gated by \`${ratchet.gate}\``;

/** Why `pnpm ratchets` fails: each counted list that grew over its committed count. Nothing when none grew. */
export const grown = (committed: Counts, tallies: ReadonlyArray<Tally>): ReadonlyArray<string> =>
  Arr.flatMap(tallies, ({ ratchet, count }) => {
    const before = committed[ratchet.id];
    if (count === null || ratchet.gate !== undefined || before === undefined || count <= before) return [];
    return [
      `${ratchet.id} (${ratchet.name}) grew from ${String(before)} to ${String(count)}: a ratchet's list may only shrink`,
    ];
  });

/** What `pnpm ratchets` notes without failing: lists that shrank, and counts that are new or gone. */
export const notes = (committed: Counts, tallies: ReadonlyArray<Tally>): ReadonlyArray<string> => {
  const now = countsOf(tallies);
  return [
    ...Arr.flatMap(Rec.toEntries(now), ([id, count]) => {
      const before = committed[id];
      if (before === undefined)
        return [`${id} is counted for the first time (${String(count)}): run \`pnpm generate\``];
      return count < before
        ? [`${id} shrank from ${String(before)} to ${String(count)}: run \`pnpm generate\` and commit its count`]
        : [];
    }),
    ...Arr.flatMap(Rec.keys(committed), (id) =>
      id in now ? [] : [`${id} has a committed count but is no longer counted: run \`pnpm generate\``],
    ),
  ];
};

/**
 * The counts `pnpm generate` writes: each counted ratchet at its count now, but never above its committed count, so
 * that generating again never hides a list that grew; a ratchet counted for the first time takes its count now. To
 * raise a count is to edit the generated file by hand, which a reviewer sees.
 */
export const settled = (committed: Counts, tallies: ReadonlyArray<Tally>): Counts =>
  Rec.map(countsOf(tallies), (count, id) => {
    const before = committed[id];
    return before === undefined ? count : Math.min(before, count);
  });
