/** Any value a record holds, drawn: text, a link, a list, a map, or a schema as its field tables. */
import type { Value, Variant } from "#src/modules/site/types.ts";

import { codeBlock } from "./highlight.ts";
import { esc, link, prose, table } from "./html.ts";
import { blocks, rich, type Cites } from "./prose.ts";

/** Text longer than this is drawn as paragraphs; shorter text sits on its line. */
const LONG = 320;

/** The fields of one shape, as a table. */
export const fieldsTable = (v: Variant): string =>
  v.rows.length === 0 ? '<p class="muted">No fields.</p>' :
    table(["Field", "Type", "Required", "Note"], v.rows.map((r) =>
      `<tr><td class="mono name">${esc(r.path)}</td><td class="mono muted">${esc(r.type)}</td>` +
      `<td class="muted">${r.required ? "yes" : "no"}</td><td>${prose(r.note)}</td></tr>`), "fields");

/** A schema: per shape it admits, the table of its fields, and under a fold the same shape as a JSON skeleton. */
export const variants = (shapes: readonly Variant[]): string =>
  shapes.map((v) =>
    `<div class="variant">${v.label === "" ? "" : `<p class="variant-label">${prose(v.label)}</p>`}${fieldsTable(v)}` +
    `<details class="more"><summary>The same shape as JSON</summary>${codeBlock("JSON · generated from the schema, not a recorded value", "json", v.skeleton)}</details>` +
    `</div>`).join("");

/** True for a value short enough to sit on one line beside its neighbours. */
const short = (v: Value): boolean => v.t === "ref" || (v.t === "text" && v.text.length <= 40);

export const value = (at: string, v: Value, cites: Cites): string => {
  switch (v.t) {
    case "text":
      return v.text === "" ? '<span class="muted">none</span>' : v.text.length > LONG ? blocks(at, v.text, cites) : rich(at, v.text, cites);
    case "ref": return link(at, v.ref, "ref");
    case "schema": return variants(v.variants);
    case "list":
      if (v.items.length === 0) return '<span class="muted">none</span>';
      return v.items.every(short)
        ? `<span class="inline-list">${v.items.map((i) => (i.t === "text" ? `<span class="token">${prose(i.text)}</span>` : value(at, i, cites))).join(" ")}</span>`
        : `<ol class="vlist">${v.items.map((i) => `<li>${value(at, i, cites)}</li>`).join("")}</ol>`;
    case "map":
      return v.entries.length === 0 ? '<span class="muted">none</span>' : keyValues(at, v.entries, cites);
  }
};

/** Named values as a definition list: a record's fields, or a map inside one. */
export const keyValues = (at: string, entries: readonly (readonly [string, Value])[], cites: Cites): string =>
  `<dl class="kv">${entries.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${value(at, v, cites)}</dd>`).join("")}</dl>`;
