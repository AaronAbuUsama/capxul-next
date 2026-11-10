/**
 * Long text from the book, made readable without changing a word: split into short paragraphs, `code` drawn as
 * code, and a bracketed citation such as "(old S3)" or "(payments.claim-escrow-routes)" drawn quieter, as a link
 * when it names a record. The splitter never cuts inside backticks or brackets, or after an abbreviation.
 */
import type { Ref } from "#src/modules/site/types.ts";

import { esc, hrefTo } from "./html.ts";

/** A record's id to the page it is on: what a citation is looked up in. */
export type Cites = ReadonlyMap<string, string>;
export const NO_CITES: Cites = new Map();

const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|approx|incl|no|nos|fig|st|[A-Za-z])$/i;
const OPEN = "([{";
const CLOSE = ")]}";

/** The sentences of a text, each with the stop that ends it. */
export const sentences = (text: string): readonly string[] => {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  let inCode = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? "";
    if (c === "`") inCode = !inCode;
    if (inCode) continue;
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && ".?!".includes(c) && /^\s+["'`(]?[A-Z0-9`]/.test(text.slice(i + 1, i + 5))) {
      if (c === "." && (ABBREVIATION.test(text.slice(start, i)) || /\d$/.test(text.slice(start, i)) && /^\s+\d/.test(text.slice(i + 1)))) continue;
      out.push(text.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  const rest = text.slice(start).trim();
  return rest === "" ? out : [...out, rest];
};

/** A text this short stays whole; a paragraph is full at two sentences of this length, or one of half as much again. */
const SHORT = 320;
const FULL = 260;
const LONG = 390;
const ORPHAN = 90;

/** A text as paragraphs of two or three sentences. A short text stays whole; a last short sentence joins the one before. */
export const paragraphs = (text: string): readonly string[] => {
  const parts = sentences(text);
  if (text.length <= SHORT || parts.length <= 2) return text.trim() === "" ? [] : [text.trim()];
  const out: string[][] = [];
  let current: string[] = [];
  for (const part of parts) {
    current.push(part);
    const length = current.join(" ").length;
    if (current.length >= 3 || (current.length >= 2 && length >= FULL) || length >= LONG) {
      out.push(current);
      current = [];
    }
  }
  const last = out[out.length - 1];
  if (current.length === 1 && last && (current[0] ?? "").length < ORPHAN) last.push(...current);
  else if (current.length > 0) out.push(current);
  return out.map((p) => p.join(" "));
};

const SERIAL = /^(?:old\s+)?(?:[A-Z]{1,3}\d+[a-z]?|ADR-\d+)$/;
const DOTTED = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;
const PARENS = /\(([^()`]{1,90})\)/g;

/** A citation's parts drawn: a part that names a record links to it. Null when the bracket is ordinary words. */
const cite = (at: string, inner: string, cites: Cites): string | null => {
  const parts = inner.split(/(,\s*|;\s*|\s+and\s+)/);
  const named = parts.filter((_, i) => i % 2 === 0).map((p) => p.trim());
  if (!named.every((p) => SERIAL.test(p) || DOTTED.test(p) || cites.has(p))) return null;
  return parts.map((p, i) => {
    const page = i % 2 === 0 ? cites.get(p.trim()) : undefined;
    const ref: Ref = { label: p.trim(), page: page ?? "", anchor: "" };
    return page === undefined || page === at ? esc(p) : `<a href="${esc(hrefTo(at, ref))}">${esc(p.trim())}</a>`;
  }).join("");
};

/** One line of the book's text as HTML: escaped, `code` as code, and citations quiet. */
export const rich = (at: string, text: string, cites: Cites): string =>
  text.split("`").map((piece, i) => {
    if (i % 2 === 1) return `<code>${esc(piece)}</code>`;
    let out = "";
    let from = 0;
    for (const found of piece.matchAll(PARENS)) {
      const drawn = cite(at, found[1] ?? "", cites);
      if (drawn === null) continue;
      out += `${esc(piece.slice(from, found.index))}<span class="cite">(${drawn})</span>`;
      from = found.index + found[0].length;
    }
    return out + esc(piece.slice(from));
  }).join("");

/** A long text as paragraphs. `cls` names the block; nothing is drawn for an empty text. */
export const blocks = (at: string, text: string, cites: Cites, cls = "prose"): string => {
  const parts = paragraphs(text);
  return parts.length === 0 ? "" : `<div class="${cls}">${parts.map((p) => `<p>${rich(at, p, cites)}</p>`).join("")}</div>`;
};

/** A long text with its first paragraph shown and the rest folded under one line. */
export const folded = (at: string, text: string, cites: Cites, more: string): string => {
  const [first, ...rest] = paragraphs(text);
  if (first === undefined) return "";
  return `<div class="prose"><p>${rich(at, first, cites)}</p></div>` + (rest.length === 0 ? "" :
    `<details class="more"><summary>${esc(more)}</summary><div class="prose">${rest.map((p) => `<p>${rich(at, p, cites)}</p>`).join("")}</div></details>`);
};
