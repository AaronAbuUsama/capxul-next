// Helpers that turn the frozen text of an old operation into the fields of an operation record.
// The text is copied, never edited. What the old book never wrote is marked, not invented.

import { Schema } from "effect";
import { frozen, type FrozenId } from "./operations.ts";

export { frozen, type FrozenId };

/** Marks text the old book never wrote. The target design writes it; the as-is book keeps the mark. */
export const NOT_IN_OLD_BOOK = "Not written in the old book.";

/** The frozen text fields of an operation record, for spreading into defineOperation. */
export const frozenText = (id: FrozenId) => {
  const f = frozen[id] as (typeof frozen)[FrozenId] & {
    about: string | null; who: string | null; changes: string | null;
    notes: readonly string[]; mistakes: readonly { what: string; fix: string }[];
  };
  return {
    id,
    title: f.title,
    about: f.about ?? NOT_IN_OLD_BOOK,
    area: f.area,
    command: f.command,
    who: f.who ?? NOT_IN_OLD_BOOK,
    ...(f.changes ? { changes: f.changes } : {}),
    ...(f.notes.length ? { notes: [...f.notes] } : {}),
    ...(f.mistakes.length ? { mistakes: f.mistakes.map((m) => ({ what: String(m.what), fix: String(m.fix) })) } : {}),
  };
};

/** Acceptance lines as the old book wrote them (an as-is book), claim text only. */
export const frozenClaims = (id: FrozenId) => frozen[id].acceptance.map((a) => a.claim as string);

/** The returns fields as a Struct of Unknown values: the shape a writer refines from the protocol row. */
export const frozenReturns = (id: FrozenId) =>
  Schema.Struct(
    Object.fromEntries(
      (frozen[id].returns as readonly { field: string }[]).map((r) => [String(r.field), Schema.Unknown]),
    ),
  );

/** The refusal codes and texts, for a writer to map onto error records and worlds. */
export const frozenRefusals = (id: FrozenId) =>
  (frozen[id].refusals as readonly { code: string; when: string }[]).map((r) => ({ code: String(r.code), when: String(r.when) }));
