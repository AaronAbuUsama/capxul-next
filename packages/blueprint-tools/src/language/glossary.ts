// The glossary's format (docs/design/blueprint.md, part 12, decision 7): one word, one meaning. Each entry is one
// concept: the agreed word, what it means in one sentence, the old words it replaces and whether callers see it. The
// glossary itself is a fact about Capxul and lives in the blueprint (packages/blueprint/src/glossary.ts); its page and
// the count of its old words (src/checks/old-words.ts) are generated from it.

/** Who sees the word: callers (operation names, the CLI, the SDK, events, refusals, fields) or only the builders. */
export type Scope = "user-facing" | "internal";

/** An old word written as words (`fleet hub`): counted wherever its words run together in a name of code. */
export interface Words {
  readonly kind: "words";
  readonly text: string;
  /** Longer names that keep these words, each written as words (`invoice ledger` keeps `ledger`). */
  readonly except: ReadonlyArray<string>;
  /** Where it is counted, as paths from the repository's root (a folder ends in `/`); none means everywhere. */
  readonly within: ReadonlyArray<string>;
}

/** An old word written as code in the decision's table (`door.ts`, `--at`): counted as that exact text. */
export interface Code {
  readonly kind: "code";
  readonly text: string;
}

/** An old word spelled as a word the glossary keeps for another concept, so no count can tell them apart. */
export interface Uncounted {
  readonly kind: "uncounted";
  readonly text: string;
  readonly why: string;
}

export type OldWord = Words | Code | Uncounted;

/** One concept of the glossary. */
export interface Entry {
  /** The agreed word, exactly as the decision gives it. */
  readonly word: string;
  /** What it means, in one sentence. */
  readonly meaning: string;
  /** The words it replaces, a plain string being words; none when today's word is kept as it is. */
  readonly replaces: ReadonlyArray<string | OldWord>;
  readonly scope: Scope;
  /** Where the word lands in the repository or the command line, when the decision names it (`packages/api`). */
  readonly lands?: string;
  /**
   * Exact code in which this word keeps its own meaning while another entry renames the same spelling
   * (`CompaniesHouseClaimer.claim` is claiming a Safe, not taking sites): that old word is not counted there.
   */
  readonly keptIn?: ReadonlyArray<string>;
  /**
   * Names of resources already deployed that hold this entry's old words (`core-db`), each exactly as written in a
   * string: renaming one replaces the resource, so its old words are not counted in a string of exactly that text.
   */
  readonly deployed?: ReadonlyArray<string>;
}

/** An old word written as words; `except` lists longer names that keep it, `within` the only paths it is counted in. */
export const words = (text: string, except: ReadonlyArray<string> = [], within: ReadonlyArray<string> = []): Words => ({
  kind: "words",
  text,
  except,
  within,
});

/** An old word written as code. */
export const code = (text: string): Code => ({ kind: "code", text });

/** An old word no count can tell from a kept word, with why. */
export const uncounted = (text: string, why: string): Uncounted => ({ kind: "uncounted", text, why });

/** An old word as the glossary writes it, a plain string being words. */
export const oldWordOf = (old: string | OldWord): OldWord => (typeof old === "string" ? words(old) : old);

/** The key an old word is counted under: its text, with code in backticks so `door.ts` and `door` stay apart. */
export const keyOf = (old: OldWord): string => (old.kind === "code" ? `\`${old.text}\`` : old.text);
