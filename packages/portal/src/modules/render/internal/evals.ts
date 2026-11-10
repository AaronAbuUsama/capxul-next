/**
 * An operation's evals, all of them, grouped by kind: each kind with its plain name and what it claims, each eval
 * with its id, who decides it and its verdict. Nothing is folded away.
 */
import type { EvalRow, OperationPage, Ref } from "#src/modules/site/types.ts";

import { esc, link, plural, table } from "./html.ts";
import { verdictChip } from "./parts.ts";
import { rich, type Cites } from "./prose.ts";

/** The acceptance claim an `acc` eval checks: its number is the last part of the eval's id. */
const observes = (p: OperationPage, e: EvalRow): string =>
  e.kind !== "acc" ? "" : p.acceptance.find((a) => String(a.n) === e.id.slice(e.id.lastIndexOf("/") + 1))?.observes ?? "";

const rows = (p: OperationPage, evals: readonly EvalRow[], cites: Cites): readonly string[] =>
  evals.map((e) => {
    const seen = observes(p, e);
    return `<tr id="${esc(e.anchor)}"><td class="mono eval-id">${esc(e.id)}</td><td>${rich(p.id, e.claim, cites)}` +
      (seen === "" ? "" : `<span class="observes"><b>Observes</b> ${rich(p.id, seen, cites)}</span>`) +
      `</td><td class="muted nowrap">${esc(e.decider)}</td><td>${verdictChip(e.verdict)}</td></tr>`;
  });

export const evalGroups = (p: OperationPage, cites: Cites): string =>
  p.evalKinds.map((k) => {
    const evals = p.evals.filter((e) => e.kind === k.kind);
    const all: Ref = { label: `every ${k.kind} eval`, page: `eval/${k.kind}`, anchor: "" };
    return `<div class="eval-group"><div class="eval-head"><h3 id="evals-${esc(k.kind)}">${esc(k.name)} <span class="mono eval-kind">${esc(k.kind)}</span></h3>` +
      `<span class="eval-count">${plural(evals.length, "eval")} here · ${link(p.id, all)}</span></div>` +
      (k.claims === "" ? "" : `<p class="eval-claims">${rich(p.id, k.claims, cites)}</p>`) +
      table(["Eval", "Claim", "Decided by", "Verdict"], rows(p, evals, cites), "evals") + `</div>`;
  }).join("");
