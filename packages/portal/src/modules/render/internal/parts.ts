/** The pieces more than one page draws: the stand bar, the operations table, evals, findings, groups of links. */
import type { Brief, EvalRow, EvalVerdict, FindingRow, LinkGroup, OperationRow, Stand, StandOf } from "#src/modules/site/types.ts";

import { chip, esc, link, plural, prose, table } from "./html.ts";

/** The four rungs an operation climbs, and how many each stand has behind it. */
export const RUNGS: readonly string[] = ["Specified", "Decided", "Proven", "Seen live"];
const BEHIND: Readonly<Record<Stand, number>> = { specify: 0, decide: 1, build: 2, observe: 3, done: 4 };
const LABEL: Readonly<Record<Stand, string>> = {
  specify: "Not specified", decide: "Specified", build: "Decided", observe: "Proven, not seen live", done: "Done",
};

export const rungsBehind = (s: StandOf): number => BEHIND[s.stand];

export const standBar = (s: StandOf): string =>
  `<span class="stand" title="${esc(s.why)}"><span class="segs">` +
  RUNGS.map((_, i) => `<i class="seg${i < BEHIND[s.stand] ? " on" : ""}"></i>`).join("") +
  `</span>${LABEL[s.stand]}</span>`;

/** Command, priority, evals and stand: the table on a concept's page and on Build. `why` adds the rule that placed the stand. */
export const operationsTable = (at: string, rows: readonly OperationRow[], why = false): string =>
  table(["Command", "Priority", '<span class="num">Evals passing</span>', ...(why ? ['<span class="num">Under it</span>'] : []), "Stand", ...(why ? ["Why it stands there"] : [])], rows.map((r) =>
    `<tr><td>${link(at, r.ref, "cmd")}${r.isNew ? chip("new", "chip chip-new") : ""}<span class="cell-sub">${prose(r.title)}</span></td>` +
    `<td class="muted">${esc(r.priority)}</td><td class="num mono">${r.own.passing} / ${r.evals}</td>${why ? `<td class="num mono">${r.under.passing} / ${r.under.total}</td>` : ""}<td>${standBar(r.stand)}</td>` +
    `${why ? `<td class="muted">${prose(r.stand.why)}</td>` : ""}</tr>`), "ops");

/** A list of links, each with one line about its target. */
export const briefRows = (at: string, items: readonly Brief[]): string =>
  items.length === 0 ? "" :
    `<div class="rows">${items.map((b) => `<div class="row">${link(at, b.ref, "row-id")}<span class="row-text">${prose(b.text)}</span></div>`).join("")}</div>`;

/** A long list folded away under one line. */
export const fold = (summary: string, body: string): string =>
  body === "" ? "" : `<details class="fold"><summary>${esc(summary)}</summary>${body}</details>`;

/** An eval's verdict as a chip: pass in blue, fail in orange, and one that has not run quiet. */
export const verdictChip = (v: EvalVerdict): string =>
  v === "pass" ? chip("pass", "chip chip-blue") : v === "fail" ? chip("fail", "chip chip-orange") : chip("not run", "chip chip-quiet");

/** Every eval of a record. Each row carries the eval's anchor and its verdict from the status document. */
export const evalsTable = (evals: readonly EvalRow[]): string =>
  evals.length === 0 ? "" :
    table(["Eval", "Level", "Claim", "Decided by", "Verdict"], evals.map((e) =>
      `<tr id="${esc(e.anchor)}"><td class="mono">${esc(e.id)}</td><td class="muted">${esc(e.level)}</td><td>${prose(e.claim)}</td>` +
      `<td class="muted">${esc(e.decider)}</td><td>${verdictChip(e.verdict)}</td></tr>`), "evals");

export const evalsFold = (evals: readonly EvalRow[]): string =>
  fold(`All ${plural(evals.length, "eval")}, with their ids`, evalsTable(evals));

/** Gaps or problems the book found on a record. */
export const findings = (rows: readonly FindingRow[]): string =>
  rows.length === 0 ? "" :
    `<ul class="findings">${rows.map((f) => `<li>${chip(f.rule, "chip chip-orange")}<span>${prose(f.detail)}</span></li>`).join("")}</ul>`;

/** Links grouped by the field that holds them. */
export const linkGroups = (at: string, groups: readonly LinkGroup[]): string =>
  groups.length === 0 ? "" :
    `<dl class="groups">${groups.map((g) =>
      `<dt>${esc(g.field)} <span class="muted">${g.refs.length}</span></dt><dd>${g.refs.map((r) => link(at, r, "ref")).join(" ")}</dd>`).join("")}</dl>`;
