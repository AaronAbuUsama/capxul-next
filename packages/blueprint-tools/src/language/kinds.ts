// One constructor per kind of declaration, each marking what it makes (docs/design/blueprint.md, part 13, "Amended",
// point 2): `refusal(...)`, a tagged error carrying its exit code on its own declaration; `event(...)`, a tagged class;
// and `verb(...)` (./operation.ts), an operation. `kindOf` reads the mark, so the layout's tests and lint know a
// command, a refusal and an event by their shape, not by the file they sit in. Nothing here reaches outside itself.
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

/** Where each constructor marks what it makes. One symbol for every copy of the toolkit. */
export const KIND: unique symbol = Symbol.for("@capxul/blueprint-tools/kind");

/** The kinds of declaration the toolkit knows by their shape. */
export type Kind = "verb" | "refusal" | "event";

/**
 * A command line's exit code for a refusal: 2 the request cannot be done as asked, 3 not signed in, 4 not allowed,
 * 5 something outside failed, 6 a limit or a switch (`NotImplemented` is one: the operation is not switched on yet).
 */
export type ExitCode = 2 | 3 | 4 | 5 | 6;

// Effect's own class form (`Schema.TaggedError<Self, Brand>()(tag, fields)`): `Self` and `Brand` are given by the class
// that extends what each constructor makes, never inferred, and the tag and fields are kept exact for that class.
/* oxlint-disable typescript/no-unnecessary-type-parameters */

/**
 * Declares a refusal: a tagged error, its exit code declared beside its fields, so the CLI never invents one.
 * `class NotADraft extends refusal<NotADraft, Brand>()("NotADraft", { ... }, 2) {}`.
 */
export const refusal =
  <Self = never, Brand = {}>() =>
  <const Tag extends string, const Fields extends Schema.Struct.Fields, const Code extends ExitCode>(
    tag: Tag,
    fields: Fields,
    exitCode: Code,
  ) =>
    Object.assign(Schema.TaggedError<Self, Brand>()(tag, fields), {
      exitCode,
      [KIND]: "refusal" as const,
    });

/** Declares an event: a tagged class, its tag the event's name wherever it is recorded. */
export const event =
  <Self = never, Brand = {}>() =>
  <const Tag extends string, const Fields extends Schema.Struct.Fields>(tag: Tag, fields: Fields) =>
    Object.assign(Schema.TaggedClass<Self, Brand>()(tag, fields), { [KIND]: "event" as const });

/* oxlint-enable typescript/no-unnecessary-type-parameters */

/** What kind of declaration `value` is, by the mark its constructor gave it, or null when it has none. */
export const kindOf = (value: unknown): Kind | null => {
  if (!Predicate.isFunction(value) && !Predicate.isObject(value)) return null;
  const kind: unknown = Reflect.get(value, KIND);
  return kind === "verb" || kind === "refusal" || kind === "event" ? kind : null;
};
