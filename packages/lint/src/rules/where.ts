// Where a file is, as the capxul rules see it: its path from the repository root, and whether the config lists it
// as an entry file or an edge. The lists live in .oxlintrc.json under settings.capxul, each path with its reason.
import type { Context } from "@oxlint/plugins";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Rec from "effect/Record";
import * as Str from "effect/String";

const slashes = Str.replaceAll("\\", "/");

/** The file's path from the directory oxlint runs in (the repository root), with forward slashes. */
export const pathOf = (context: Context): string => {
  const cwd = pipe(slashes(context.cwd), Str.replace(/\/$/, ""));
  const file = slashes(context.filename);
  return Str.startsWith(`${cwd}/`)(file) ? Str.slice(cwd.length + 1)(file) : file;
};

/** Escapes every regular-expression character (the pattern is global). */
const escape = Str.replace(/[.+^${}()|[\]\\]/g, "\\$&");

/** One piece of a pattern between its `**`s: `*` matches anything but a slash, the rest itself. */
const piece = (part: string): string => Arr.join(Arr.map(Str.split(part, "*"), escape), "[^/]*");

// A path pattern: `**` and a slash match any run of folders, none included, as in the overrides' globs; any other
// `**` anything at all; `*` anything but a slash. Anything else matches itself.
export const matches = (pattern: string, path: string): boolean =>
  new RegExp(
    `^${Arr.join(
      Arr.map(Str.split(pattern, "**/"), (folders) => Arr.join(Arr.map(Str.split(folders, "**"), piece), ".*")),
      "(?:.*/)?",
    )}$`,
  ).test(path);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Arr.isArray(value);

const listed = (context: Context, key: string): ReadonlyArray<string> => {
  const capxul = context.settings["capxul"];
  const list = isRecord(capxul) ? capxul[key] : undefined;
  if (!isRecord(list)) return [];
  return pipe(
    Rec.toEntries(list),
    Arr.filter(([, reason]) => typeof reason === "string" && Str.trim(reason) !== ""),
    Arr.map(([pattern]) => pattern),
  );
};

/** True when settings.capxul[key] lists this file, by a path or pattern with a non-empty reason. */
export const isListed = (context: Context, key: string): boolean => {
  const path = pathOf(context);
  return Arr.some(listed(context, key), (pattern) => matches(pattern, path));
};

export const isTypeScript = (context: Context): boolean => /\.(ts|tsx|mts|cts)$/.test(context.filename);
