/** Reading the files a definition points at: its instructions and its skills. A file that is not there is a problem, as a value. */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { Skill } from "../types.ts";

const FRONT = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/** A markdown file as its front matter's lines and its body. No front matter: the whole text is the body. */
const parts = (text: string): { front: string; body: string } => {
  const m = FRONT.exec(text);
  return m ? { front: m[1]!, body: m[2]! } : { front: "", body: text };
};

const field = (front: string, key: string): string => new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(front)?.[1]?.trim().replace(/^(['"])(.*)\1$/, "$2") ?? "";

export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string };

/** The instructions at `path` (relative to the definition's file): the body, without its front matter. */
export const instructionsAt = (from: string, path: string): Read<string> => {
  const file = resolve(dirname(from), path);
  if (!existsSync(file)) return { ok: false, why: `its instructions are not at ${file}` };
  const body = parts(readFileSync(file, "utf8")).body.trim();
  return body === "" ? { ok: false, why: `its instructions at ${file} are empty` } : { ok: true, value: body };
};

/** The skill at `path`: its name (the front matter's, or its folder's) and its description, which it must have. */
export const skillAt = (from: string, path: string): Read<Skill> => {
  const file = resolve(dirname(from), path);
  if (!existsSync(file)) return { ok: false, why: `its skill is not at ${file}` };
  const front = parts(readFileSync(file, "utf8")).front, description = field(front, "description");
  if (description === "") return { ok: false, why: `the skill at ${file} has no description in its front matter: an agent is told a skill by its description` };
  return { ok: true, value: { name: field(front, "name") || basename(dirname(file)), description, file } };
};
