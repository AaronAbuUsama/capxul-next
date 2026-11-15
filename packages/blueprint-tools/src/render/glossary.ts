// The glossary's page (packages/blueprint/generated/glossary.md), from the blueprint's glossary. Pure: `pnpm generate`
// (packages/generate) writes it, under the header every generated file starts with.
import * as Arr from "effect/Array";
import { type Entry, keyOf, oldWordOf } from "../language/glossary.ts";

const cell = (entry: Entry): string => {
  const olds = Arr.map(entry.replaces, (old) => {
    const word = oldWordOf(old);
    if (word.kind === "uncounted") return `${word.text} (not counted)`;
    if (word.kind === "words" && word.within.length > 0)
      return `${word.text} (counted only in ${Arr.join(
        Arr.map(word.within, (path) => `\`${path}\``),
        ", ",
      )})`;
    return keyOf(word);
  });
  return olds.length === 0 ? "(kept)" : Arr.join(olds, ", ");
};

/** An old word that is not counted, under the word that replaces it. */
interface Listed {
  readonly entry: string;
  readonly text: string;
  readonly why: string;
}

/** The glossary's page. */
export const renderGlossary = (glossary: ReadonlyArray<Entry>): string => {
  const uncounted = Arr.dedupeWith(
    Arr.flatMap(glossary, (entry) =>
      Arr.flatMap(entry.replaces, (old) => {
        const word = oldWordOf(old);
        return word.kind === "uncounted" ? [{ entry: entry.word, text: word.text, why: word.why }] : [];
      }),
    ),
    (a: Listed, b: Listed) => a.entry === b.entry && a.text === b.text,
  );
  return Arr.join(
    [
      "# The glossary",
      "",
      "One word, one meaning (docs/design/blueprint.md, part 12, decision 7, agreed 15 November 2026). Folders,",
      "commands, docs and lint take their words from the blueprint's glossary, `src/glossary.ts`, which this page is",
      "rendered from. An old word is renamed by a ratchet (roadmap item 3.8): `generated/old-words.json` counts how often",
      "each is still written as a name in code, `pnpm words` fails when a count grows, and a word is done at zero.",
      "",
      "Scope: **user-facing** words are seen by callers (operation names, the CLI, the SDK, events, refusals, fields);",
      "**internal** ones only by builders (packages, folders, environment variables, docs).",
      "",
      "| Word | What it means | Replaces | Scope |",
      "|---|---|---|---|",
      ...Arr.map(glossary, (entry) => {
        const word = entry.lands === undefined ? `**${entry.word}**` : `**${entry.word}** (\`${entry.lands}\`)`;
        return `| ${word} | ${entry.meaning} | ${cell(entry)} | ${entry.scope} |`;
      }),
      "",
      "## Old words not counted",
      "",
      "Each is spelled as a word the glossary keeps for another concept, so no count can tell its uses apart.",
      "",
      ...Arr.map(uncounted, (old) => `- \`${old.text}\`, becoming **${old.entry}**: ${old.why}.`),
      "",
      "## Where a kept word is not counted",
      "",
      "A word the glossary keeps, spelled as another entry's old word, is not counted where this exact code writes it.",
      "",
      ...Arr.flatMap(glossary, (entry) =>
        entry.keptIn === undefined || entry.keptIn.length === 0
          ? []
          : [
              `- **${entry.word}**: ${Arr.join(
                Arr.map(entry.keptIn, (text) => `\`${text}\``),
                ", ",
              )}.`,
            ],
      ),
      "",
      "## Deployed names not counted",
      "",
      "Resources already deployed keep their names until they are replaced, so an entry's old words are not counted " +
        "in a string of exactly one of these names. Nor is a package's name where it is written as a package " +
        "(`@capxul/core`, `packages/core`, `--core=local`): it changes only with its package.",
      "",
      ...Arr.flatMap(glossary, (entry) =>
        entry.deployed === undefined || entry.deployed.length === 0
          ? []
          : [
              `- **${entry.word}**: ${Arr.join(
                Arr.map(entry.deployed, (text) => `\`${text}\``),
                ", ",
              )}.`,
            ],
      ),
      "",
    ],
    "\n",
  );
};
