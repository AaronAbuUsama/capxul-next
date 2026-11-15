// The rename ratchet, R15 "old words" (docs/roadmap.md, item 3.8): how many times each old word of the glossary is
// still written as a name in code. `pnpm generate` commits the counts (packages/blueprint/generated/old-words.json),
// `pnpm words` fails when one grew, and a word whose count reaches zero is done. Pure: it is given the glossary and
// the files' text; which files are read is ./word-files.ts.
//
// What counts. Only names, never English. Comments are left out, and in Markdown everything but its code (fenced blocks
// and `inline code`) is left out (./code-text.ts). What is left is cut into tokens, runs of letters, digits and
// `_ $ @ . / : -`; a token is cut at `/ . : @ $` into segments, and a segment into words at `_`, `-`, a change of case
// and digits (`siteDoor`, `site-door` and `SITE_DOOR` are each the words "site door"):
// - An old word written as words counts once wherever its words run together inside one segment, any case, its last
//   word also as a plural (`hubs`, `claims`). So `core` counts in `@capxul/core`, `coreUrl`, `CAPXUL_CORE_URL` and
//   `cores`, and not in `score` or `corepack`.
// - In a string literal that holds a space, only tokens shaped as code count: those holding `/ . _ @ $ :`, a hyphen,
//   or a change of case. So `"core is down"` counts nothing and `"see packages/core"` counts `core` once. A string
//   with no space (`"@capxul/core"`, `"invite.accept"`, `"--at"`) is code. Markdown's code is code.
// - An occurrence inside an agreed word of several words is the agreed word, not the old one: `point` does not count
//   in `startingPoint`, nor `template` in `siteTemplate`. An old word's `except` names more such words.
// - An old word written as code in the table (`door.ts`, `--at`, `pnpm check`) counts as that exact text, anywhere
//   but in comments and prose, when no letter, digit, `_` or `-` touches it on either side.
// - Other people's names are not ours: a token starting `@` that is not `@capxul/`, or starting `effect/` or `node:`,
//   counts nothing, nor a segment that is a name of TypeScript or Effect (`Record`, `ReadonlyRecord`), nor an old word
//   inside `GitHub` or ERC-4337's `EntryPoint`.
// - An old word marked `uncounted` (spelled as a word the glossary keeps, `step`) is listed, never counted.
// - An old word with `within` (`lane`, a shard only in packages/runner) is counted only in files under those paths.
// - An old word spelled as an agreed word is not counted in that entry's `keptIn`, the exact code where the agreed
//   meaning is written (`claim` in `CompaniesHouseClaimer.claim` is claiming a Safe, not taking sites).
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import { type Entry, keyOf, type OldWord, oldWordOf } from "../language/glossary.ts";
import { type Piece, piecesOf } from "./code-text.ts";

/** Where the counts are committed, from the repository's root: `{ "generated": <from what>, "counts": Counts }`. */
export const OLD_WORDS = "packages/blueprint/generated/old-words.json";

/** How many times each counted old word is written, by its key (`keyOf`). */
export type Counts = { readonly [key: string]: number };

/** A file to count in: its path from the repository's root and its text. */
export interface File {
  readonly path: string;
  readonly text: string;
}

/** Segments that are names of TypeScript or of a library, never ours. */
const NOT_OURS = ["Record", "ReadonlyRecord"];

/** Other people's names of several words, which hide an old word inside them: GitHub, ERC-4337's EntryPoint. */
const OTHERS = [
  ["git", "hub"],
  ["entry", "point"],
];

/** Every match of a global pattern in a text. */
const every =
  (pattern: RegExp) =>
  (text: string): ReadonlyArray<string> =>
    Option.getOrElse(Str.match(pattern)(text), () => []);

/** The words of a name: `fleetHub`, `fleet-hub` and `FLEET_HUB` are `["fleet", "hub"]`. */
export const wordsOf = (name: string): ReadonlyArray<string> =>
  Arr.map(every(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[0-9]+/g)(name), (word) => Str.toLowerCase(word));

/** Every old word of the glossary that is counted, each once by its key. */
export const countedOf = (glossary: ReadonlyArray<Entry>): ReadonlyArray<Exclude<OldWord, { kind: "uncounted" }>> =>
  Arr.dedupeWith(
    Arr.flatMap(glossary, (entry) =>
      Arr.flatMap(entry.replaces, (old) => {
        const word = oldWordOf(old);
        return word.kind === "uncounted" ? [] : [word];
      }),
    ),
    (a, b) => keyOf(a) === keyOf(b),
  );

/** The agreed words of several words, which hide an old word inside them (`starting point` hides `point`). */
const agreedOf = (glossary: ReadonlyArray<Entry>): ReadonlyArray<ReadonlyArray<string>> =>
  Arr.filter(
    Arr.map(glossary, (entry) => wordsOf(entry.word)),
    (each) => each.length > 1,
  );

/** Whether `words` stands at `at` in `segment`, its last word also as a plural. */
const standsAt = (segment: ReadonlyArray<string>, words: ReadonlyArray<string>, at: number): boolean =>
  Arr.every(words, (word, i) => {
    const there = segment[at + i];
    return there === word || (i === words.length - 1 && (there === `${word}s` || there === `${word}es`));
  });

/** Where `words` stands in `segment`, by its first word. */
const placesOf = (segment: ReadonlyArray<string>, words: ReadonlyArray<string>): ReadonlyArray<number> =>
  Arr.filter(Arr.range(0, segment.length - words.length), (at) => words.length > 0 && standsAt(segment, words, at));

/** How many times `words` stands in `segment` outside every one of `hiding`. */
const countIn = (
  segment: ReadonlyArray<string>,
  words: ReadonlyArray<string>,
  hiding: ReadonlyArray<ReadonlyArray<string>>,
): number => {
  const hidden = (at: number): boolean =>
    Arr.some(hiding, (hider) =>
      Arr.some(placesOf(segment, hider), (from) => from <= at && at + words.length <= from + hider.length),
    );
  return Arr.filter(placesOf(segment, words), (at) => !hidden(at)).length;
};

/** Whether a token in a string that holds a space is shaped as code. */
const codeShaped = (token: string): boolean => /[/._@$:-]/.test(token) || /[a-z][A-Z]/.test(token);

/** The segments of a piece's names, each as its words, other people's names left out. */
const segmentsOf = (piece: Piece): ReadonlyArray<ReadonlyArray<string>> => {
  const tokens = Arr.map(every(/[A-Za-z0-9_$@./:-]+/g)(piece.text), (token) =>
    Str.replace(/^[.:]+|[.:-]+$/g, "")(token),
  );
  const prose = piece.kind === "string" && /\s/.test(piece.text);
  const ours = Arr.filter(
    tokens,
    (token) =>
      (!prose || codeShaped(token)) &&
      !(Str.startsWith("@")(token) && !Str.startsWith("@capxul/")(token)) &&
      !Str.startsWith("effect/")(token) &&
      !Str.startsWith("node:")(token),
  );
  return Arr.map(
    Arr.filter(
      Arr.flatMap(ours, (token) => Str.split(token, /[/.:@$]/)),
      (segment) => segment.length > 0 && !Arr.contains(NOT_OURS, segment),
    ),
    wordsOf,
  );
};

/** A pattern for `text` standing as exact code, nothing of a name touching it. */
const exactly = (text: string): RegExp =>
  new RegExp(`(?<![A-Za-z0-9_-])${Str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")(text)}(?![A-Za-z0-9_-])`, "g");

/** How many times `text` stands in `piece` as exact code, nothing of a name touching it. */
const codeCount = (piece: Piece, text: string): number => every(exactly(text))(piece.text).length;

/** The exact code where an agreed word spelled `text` keeps its own meaning (an entry's `keptIn`). */
const keptInOf = (glossary: ReadonlyArray<Entry>, text: string): ReadonlyArray<string> =>
  Arr.flatMap(glossary, (entry) => (entry.word === text ? (entry.keptIn ?? []) : []));

/** `piece` with every one of `kept` blanked out, so nothing in it is counted. */
const without = (piece: Piece, kept: ReadonlyArray<string>): Piece =>
  Arr.reduce(kept, piece, (each, text) => ({
    kind: each.kind,
    text: Str.replace(exactly(text), " ")(each.text),
  }));

/** Whether a file at `path` is under one of `within`, none meaning everywhere. */
const isWithin = (path: string, within: ReadonlyArray<string>): boolean =>
  within.length === 0 || Arr.some(within, (each) => Str.startsWith(each)(path));

/** Every counted old word's count in one file, by its key. */
export const countFile = (glossary: ReadonlyArray<Entry>, file: File): Counts => {
  const pieces = piecesOf(file.path, file.text);
  const segments = Arr.flatMap(pieces, segmentsOf);
  const agreed = agreedOf(glossary);
  return Rec.fromEntries(
    Arr.map(countedOf(glossary), (old) => {
      if (old.kind === "code")
        return [keyOf(old), Arr.reduce(pieces, 0, (sum, piece) => sum + codeCount(piece, old.text))] as const;
      if (!isWithin(file.path, old.within)) return [keyOf(old), 0] as const;
      const words = wordsOf(old.text);
      const hiding = [
        ...Arr.filter(agreed, (each) => each.length > words.length),
        ...Arr.map(old.except, wordsOf),
        ...OTHERS,
      ];
      const kept = keptInOf(glossary, old.text);
      const read = kept.length === 0 ? segments : Arr.flatMap(pieces, (piece) => segmentsOf(without(piece, kept)));
      return [keyOf(old), Arr.reduce(read, 0, (sum, segment) => sum + countIn(segment, words, hiding))] as const;
    }),
  );
};

/** Every counted old word's count across `files`, by its key, in the glossary's order. */
export const countOldWords = (glossary: ReadonlyArray<Entry>, files: ReadonlyArray<File>): Counts => {
  const each = Arr.map(files, (file) => countFile(glossary, file));
  return Rec.fromEntries(
    Arr.map(countedOf(glossary), (old) => {
      const key = keyOf(old);
      return [key, Arr.reduce(each, 0, (sum, counts) => sum + (counts[key] ?? 0))] as const;
    }),
  );
};

/** Each old word whose count in `now` is above its count in `before`, with both; a word new to `before` is free. */
export const grown = (
  before: Counts,
  now: Counts,
): ReadonlyArray<{ readonly word: string; readonly before: number; readonly now: number }> =>
  Arr.flatMap(Rec.toEntries(now), ([word, count]) => {
    const was = before[word];
    return was !== undefined && count > was ? [{ word, before: was, now: count }] : [];
  });
