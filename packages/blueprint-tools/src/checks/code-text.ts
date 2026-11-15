// What of a file is code, for the count of old words (old-words.ts): a file's text split into pieces of code, string
// literals and Markdown code, with every comment and every line of Markdown prose left out. A small scanner, not a
// parser: a string or a line comment ends at the end of its line (a template literal or a Python triple-quoted string
// may run on), and a regular expression is read as code. Pure: it is given a file's path and text.
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Str from "effect/String";

/** One piece of a file: `code` outside strings and comments, a `string` literal's text, or Markdown's `markdown` code. */
export interface Piece {
  readonly kind: "code" | "string" | "markdown";
  readonly text: string;
}

/** How a kind of file writes comments and strings, as one pattern: each match is a comment, a string or code. */
interface Syntax {
  readonly pattern: RegExp;
  /** What opens a comment. */
  readonly comments: ReadonlyArray<string>;
  /** What opens a string, and closes it. */
  readonly quotes: ReadonlyArray<string>;
}

const escape = (text: string): string => Str.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&")(text);

/** A string opened by `quote`: running on over lines when `runsOn`, else ending at the line's end. */
const stringOf = (quote: string, runsOn: boolean): string => {
  const q = escape(quote);
  return quote.length === 3
    ? `${q}[\\s\\S]*?(?:${q}|$)`
    : `${q}(?:\\\\[\\s\\S]|[^${q}\\\\${runsOn ? "" : "\\n"}])*(?:${q}|$)`;
};

/** The syntax of comments opened by `comments` (`/*` a block) and strings opened by `quotes`. */
const syntaxFor = (comments: ReadonlyArray<string>, quotes: ReadonlyArray<string>): Syntax => {
  const commentPatterns = Arr.map(comments, (open) =>
    open === "/*"
      ? "\\/\\*[\\s\\S]*?(?:\\*\\/|$)"
      : open === "#"
        ? // A `#` opens a comment only at a line's start or after a space, so `$#` and `a#b` stay code.
          "(?<!\\S)#[^\\n]*"
        : `${escape(open)}[^\\n]*`,
  );
  const quotePatterns = Arr.map(quotes, (quote) => stringOf(quote, quote === "`"));
  const firsts = Arr.dedupe(Arr.map([...comments, ...quotes], (open) => escape(Str.slice(0, 1)(open))));
  const code = `[^${Arr.join(firsts, "")}]+|[\\s\\S]`;
  return {
    pattern: new RegExp(Arr.join([...commentPatterns, ...quotePatterns, code], "|"), "g"),
    comments,
    quotes,
  };
};

const C_LIKE = syntaxFor(["//", "/*"], ["`", '"', "'"]);
const HASH = syntaxFor(["#"], ['"', "'"]);
const PYTHON = syntaxFor(["#"], ['"""', "'''", '"', "'"]);
const SQL = syntaxFor(["--", "/*"], ["'"]);

/** The syntax of a file by its name, or `markdown`, or null for a file whose words are not counted. */
export const syntaxOf = (path: string): Syntax | "markdown" | null => {
  const name = Arr.last(Str.split(path, "/")).pipe(Option.getOrElse(() => path));
  const extension = Str.match(/\.([a-z]+)$/)(name).pipe(
    Option.flatMap((found) => Option.fromNullishOr(found[1])),
    Option.getOrElse(() => ""),
  );
  if (Arr.contains(["ts", "tsx", "mts", "js", "mjs", "json", "jsonc"], extension)) return C_LIKE;
  if (extension === "py") return PYTHON;
  if (Arr.contains(["sh", "yml", "yaml", "toml"], extension)) return HASH;
  if (Arr.contains(["Dockerfile", "Containerfile", ".gitignore", ".dockerignore"], name)) return HASH;
  if (extension === "sql") return SQL;
  if (extension === "md") return "markdown";
  return null;
};

/** One match of a syntax's pattern as a piece, or none for a comment. */
const pieceOf = (found: string, syntax: Syntax): Option.Option<Piece> => {
  if (Arr.some(syntax.comments, (open) => Str.startsWith(open)(found))) return Option.none();
  return Arr.findFirst(syntax.quotes, (quote) => Str.startsWith(quote)(found)).pipe(
    Option.map((quote): Piece => {
      const closed = found.length >= 2 * quote.length && Str.endsWith(quote)(found);
      return { kind: "string", text: Str.slice(quote.length, closed ? -quote.length : undefined)(found) };
    }),
    Option.orElse(() => Option.some<Piece>({ kind: "code", text: found })),
  );
};

/** The pieces of C-like, hash-commented or SQL text, each run of code as one piece (built in place: a file has many). */
const scan = (text: string, syntax: Syntax): ReadonlyArray<Piece> =>
  Arr.reduce(
    Arr.getSomes(Arr.map(Arr.fromIterable(Str.matchAll(syntax.pattern)(text)), (found) => pieceOf(found[0], syntax))),
    [] as Array<Piece>,
    (pieces, piece) => {
      const last = pieces.length - 1;
      const before = pieces[last];
      if (piece.kind === "code" && before?.kind === "code")
        pieces[last] = { kind: "code", text: before.text + piece.text };
      else pieces.push(piece);
      return pieces;
    },
  );

/** Markdown's code: each fenced block and each inline code span. Its prose is left out. */
const markdown = (text: string): ReadonlyArray<Piece> =>
  Arr.reduce(
    Str.split(text, "\n"),
    { fenced: false, pieces: [] as ReadonlyArray<Piece> },
    ({ fenced, pieces }, line) => {
      if (/^\s*(```|~~~)/.test(line)) return { fenced: !fenced, pieces };
      const found: ReadonlyArray<Piece> = fenced
        ? [{ kind: "markdown", text: line }]
        : Arr.map(Arr.fromIterable(Str.matchAll(/`([^`]+)`/g)(line)), (span) => ({
            kind: "markdown",
            text: span[1] ?? "",
          }));
      return { fenced, pieces: Arr.appendAll(pieces, found) };
    },
  ).pieces;

/** The pieces of a file's text whose words are counted, by its path; none for a kind of file not counted. */
export const piecesOf = (path: string, text: string): ReadonlyArray<Piece> => {
  const syntax = syntaxOf(path);
  if (syntax === null) return [];
  return syntax === "markdown" ? markdown(text) : scan(text, syntax);
};
