/**
 * An operation's evals, all of them, grouped by kind: each kind with its plain name and what it claims, each eval
 * with its id, who decides it and its verdict. Nothing is folded away.
 */
import type { EvalRow, OperationPage, Ref } from "#src/modules/site/types.ts";

import { chip, esc, link, plural, table } from "./html.ts";

import { rich, type Cites } from "./prose.ts";

/** The acceptance claim an `acc` eval checks: its number is the last part of the eval's id. */
const observes = (p: OperationPage, e: EvalRow): string =>
  e.kind !== "acc" ? "" : p.acceptance.find((a) => String(a.n) === e.id.slice(e.id.lastIndexOf("/") + 1))?.observes ?? "";

const rows = (p: OperationPage, evals: readonly EvalRow[], cites: Cites): readonly string[] =>
  evals.map((e) => {
    const seen = observes(p, e);
    return `<tr id="${esc(e.anchor)}"><td class="mono eval-id">${esc(e.id)}</td><td>${rich(p.id, e.claim, cites)}` +
      (seen === "" ? "" : `<span class="observes"><b>Observes</b> ${rich(p.id, seen, cites)}</span>`) +
      `</td><td class="muted nowrap">${esc(e.decider)}</td><td>${verdictView(e)}</td></tr>`;
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

/** A recorded result is not silently promoted to proof at this build. Links use the result's commit. */
export const verdictView = (e: EvalRow): string => {
  const badge = e.verdict === "pass" ? chip("pass", "chip chip-blue") : e.verdict === "fail" ? chip("fail", "chip chip-orange") : chip("not run", "chip chip-quiet");
  if (!e.provenance) return badge + '<span class="cell-sub">No recorded verdict.</span>';
  const { result: r, builtCommit, repo } = e.provenance;
  const base = repo.replace(/\/$/, "");
  const path = (s: string): string => s.split("/").map(encodeURIComponent).join("/");
  const a = (url: string, label: string): string => '<a href="' + esc(url) + '">' + esc(label) + '</a>';
  const file = (p: string, label: string): string => a(base + "/blob/" + encodeURIComponent(r.commit) + "/" + path(p), label);
  const same = r.commit === builtCommit || (/^[0-9a-f]{7,40}$/i.test(r.commit) && /^[0-9a-f]{7,40}$/i.test(builtCommit) && (r.commit.startsWith(builtCommit) || builtCommit.startsWith(r.commit)));
  return badge + '<span class="cell-sub">Run: ' + (r.run ? file("status/runs/" + r.run + "/results.json", r.run) : "not recorded") +
    '<br>Date: <time datetime="' + esc(r.at) + '">' + esc(r.at) + '</time><br>Commit: ' + a(base + "/commit/" + encodeURIComponent(r.commit), r.commit) +
    '<br>' + (same ? "At built commit." : "Last seen at a different commit; not proof at built commit " + esc(builtCommit) + ".") +
    '<br>Evidence: ' + (r.evidence ? file(r.evidence, r.evidence) : "not recorded") + '</span>';
};
