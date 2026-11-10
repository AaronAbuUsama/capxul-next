/** A table as a page model holds it, drawn: its cells, its groups, its caption, and its words when it is empty. */
import type { Cell, Ref, TableSection, Tile } from "#src/modules/site/types.ts";

import { esc, hrefTo, link, plural } from "./html.ts";
import { standBar } from "./parts.ts";
import { rich, type Cites } from "./prose.ts";

/** How many links a cell shows before it folds the rest away. */
const SHOWN = 8;
/** A cell of words longer than this keeps a readable width, however many columns sit beside it. */
const WIDE = 80;
const NONE = '<span class="muted">none</span>';

const refs = (at: string, held: readonly Ref[]): string => {
  if (held.length === 0) return NONE;
  const drawn = held.map((r) => link(at, r, "ref"));
  return held.length <= SHOWN
    ? `<span class="inline-list">${drawn.join(" ")}</span>`
    : `<span class="inline-list">${drawn.slice(0, SHOWN).join(" ")}</span>` +
      `<details class="more"><summary>all ${plural(held.length, "record")}</summary><span class="inline-list">${drawn.slice(SHOWN).join(" ")}</span></details>`;
};

export const cell = (at: string, c: Cell, cites: Cites): string => {
  switch (c.t) {
    case "text": return c.text === "" ? '<span class="muted">-</span>' : rich(at, c.text, cites);
    case "code": return c.text === "" ? NONE : `<span class="mono">${esc(c.text)}</span>`;
    case "ref": return link(at, c.ref, "cmd") + (c.sub === "" ? "" : `<span class="cell-sub">${rich(at, c.sub, cites)}</span>`);
    case "refs": return refs(at, c.refs);
    case "stand": return standBar(c.stand);
  }
};

/** A section's heading, caption and table. A table with no rows says what the book is silent on. */
export const tableSection = (at: string, s: TableSection, cites: Cites): string => {
  const head = `<h2 id="${esc(s.anchor)}">${esc(s.title)}</h2>${s.caption === "" ? "" : `<p class="caption">${rich(at, s.caption, cites)}</p>`}`;
  if (s.rows.length === 0) return `<section class="block">${head}<p class="silent">${rich(at, s.empty, cites)}</p></section>`;
  const rows = s.rows.map((r, i) => {
    const group = r.group !== "" && r.group !== s.rows[i - 1]?.group
      ? `<tr class="group"><th colspan="${s.heads.length}" scope="colgroup">${esc(r.group)}</th></tr>` : "";
    return `${group}<tr>${r.cells.map((c) => `<td${c.t === "text" && c.text.length > WIDE ? ' class="wide"' : ""}>${cell(at, c, cites)}</td>`).join("")}</tr>`;
  });
  return `<section class="block">${head}<div class="table-wrap"><table class="table catalogue"><thead><tr>` +
    `${s.heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div></section>`;
};

/** Counts as cells. A count that has a list behind it is a link to that list. */
export const tiles = (at: string, held: readonly Tile[], cls = "cells"): string =>
  held.length === 0 ? "" : `<div class="${cls}">${held.map((t) => {
    const inner = `<span class="cell-big">${esc(t.big)}</span><span class="cell-name">${esc(t.name)}</span>`;
    return t.to ? `<a class="cell cell-link" href="${esc(hrefTo(at, t.to))}">${inner}</a>` : `<div class="cell">${inner}</div>`;
  }).join("")}</div>`;
