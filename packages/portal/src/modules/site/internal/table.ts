/** The small makers of a table's cells, rows and sections, so every catalogue is built the same way. */
import type { Cell, Ref, StandOf, TableRow, TableSection } from "../types.ts";

export const words = (text: string): Cell => ({ t: "text", text });
export const code = (text: string): Cell => ({ t: "code", text });
/** A link, with one line under it ("" for none). */
export const to = (ref: Ref, sub = ""): Cell => ({ t: "ref", ref, sub });
export const many = (refs: readonly Ref[]): Cell => ({ t: "refs", refs });
export const standing = (stand: StandOf): Cell => ({ t: "stand", stand });
/** A link when there is one, the words when there is none. */
export const toOr = (ref: Ref | null, otherwise: string): Cell => (ref ? to(ref) : words(otherwise));

export const row = (cells: readonly Cell[], group = ""): TableRow => ({ group, cells });

export const tableOf = (
  anchor: string, title: string, heads: readonly string[], rows: readonly TableRow[],
  words: { readonly caption?: string; readonly empty?: string } = {},
): TableSection => ({
  anchor, title, heads, rows, caption: words.caption ?? "", empty: words.empty ?? "The blueprint holds none.",
});
