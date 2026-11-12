/**
 * An operation's evals, all of them, grouped by kind: each kind with its plain name and what it claims, each eval
 * with its id, who decides it and its verdict. Nothing is folded away.
 */
import type { EvalRow, OperationPage, Ref } from "#src/modules/site/types.ts";

import { chip, esc, link, plural, table } from "./html.ts";

import { rich, type Cites } from "./prose.ts";

/** Match the claim, not the opaque eval key; display numbering is independent of identity. */
const observes = (p: OperationPage, e: EvalRow): string =>
  e.kind !== "acc" ? "" : p.acceptance.find((a) => a.claim === e.claim)?.observes ?? "";

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

/** Artifacts live in the built snapshot; the tested revision predates the files recording its result. */
export const verdictView = (e: EvalRow): string => {
  const badge = e.verdict === "pass" ? chip("pass", "chip chip-blue") : e.verdict === "fail" ? chip("fail", "chip chip-orange") : chip("not run", "chip chip-quiet");
  if (!e.provenance) return badge + '<span class="cell-sub">No recorded verdict.</span>';
  const { result: r, builtCommit, repo } = e.provenance;
  const base = repo.replace(/\/$/, "");
  const path = (s: string): string => s.split("/").map(encodeURIComponent).join("/");
  const a = (url: string, label: string): string => '<a href="' + esc(url) + '">' + esc(label) + '</a>';
  const file = (p: string, label: string): string => a(base + "/blob/" + encodeURIComponent(builtCommit) + "/" + path(p), label);
  const dirty = r.commit.endsWith("+dirty");
  const sha = dirty ? r.commit.slice(0, -6) : r.commit;
  const commitLink = /^[0-9a-f]{7,40}$/i.test(sha) ? a(base + "/commit/" + sha, sha) : esc(sha);
  const commit = dirty ? commitLink + " +dirty (base commit; uncommitted changes)" : commitLink;
  const same = !dirty && (r.commit === builtCommit || (/^[0-9a-f]{7,40}$/i.test(r.commit) && /^[0-9a-f]{7,40}$/i.test(builtCommit) && (r.commit.startsWith(builtCommit) || builtCommit.startsWith(r.commit))));
  return badge + '<span class="cell-sub">Run: ' + (r.run ? file("status/runs/" + r.run + "/results.json", r.run) : "not recorded") +
    '<br>Date: <time datetime="' + esc(r.at) + '">' + esc(r.at) + '</time><br>Commit: ' + commit +
    '<br>' + (dirty ? "Dirty working tree result; not proof at built commit " + esc(builtCommit) + "." : same ? "At built commit." : "Last seen at a different commit; not proof at built commit " + esc(builtCommit) + ".") +
    '<br>Evidence: ' + (r.evidence ? file(r.evidence, r.evidence) : "not recorded") + '</span>';
};
