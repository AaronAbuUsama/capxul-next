// The pages, as HTML, from the model. Every page is generated; none is written by hand. Pure.

import { STANDS, type Stand } from "../../blueprint-engine/src/index.ts";
import type { ConceptView, JourneyView, Model } from "./model.ts";

const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (x: number) => x.toLocaleString("en-GB");
const STAND_WORDS: Record<Stand, string> = { specify: "Specify", decide: "Decide", build: "Build", observe: "Observe", done: "Done" };

const CSS = `
:root{--bg:#fbfbfa;--fg:#1d1d1b;--muted:#6b6b66;--line:#e4e3de;--card:#fff;--accent:#2f5fd0;
--specify:#b9b6ad;--decide:#d8a23a;--build:#4f86d9;--observe:#8a63c9;--done:#3f9a5b;--bad:#c4463a}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161614;--fg:#ecebe6;--muted:#9a9990;--line:#2f2e2a;--card:#1e1d1b;--accent:#7fa2f0;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#161614;--fg:#ecebe6;--muted:#9a9990;--line:#2f2e2a;--card:#1e1d1b;--accent:#7fa2f0;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums}
header{border-bottom:1px solid var(--line);padding-block:12px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;gap:20px;align-items:baseline;flex-wrap:wrap}
header b{font-size:16px}nav a{margin-right:16px}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
main{max-width:1080px;margin:0 auto;padding-block:24px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}h1{font-size:26px;margin:0 0 6px}h2{font-size:18px;margin:32px 0 10px}
p.lede{color:var(--muted);max-width:760px;margin:0 0 20px}.muted{color:var(--muted)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px}.tile .v{font-size:24px;font-weight:600}.tile .k{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top;font-size:14px}th{color:var(--muted);font-weight:500}
.wrap{overflow-x:auto}.bar{display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--line);min-width:120px}
.bar span{display:block;height:100%}.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;color:#fff}
.legend span{margin-right:12px;font-size:13px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
code{font-size:13px}ul.plain{padding-left:18px}`;

const bar = (s: Readonly<Record<Stand, number>>) => {
  const total = STANDS.reduce((t, k) => t + s[k], 0) || 1;
  return `<div class="bar" title="${STANDS.map((k) => `${STAND_WORDS[k]} ${s[k]}`).join(", ")}">${STANDS.map((k) => s[k] ? `<span style="width:${(100 * s[k]) / total}%;background:var(--${k})"></span>` : "").join("")}</div>`;
};
const pill = (s: Stand) => `<span class="pill" style="background:var(--${s})">${STAND_WORDS[s]}</span>`;
const legend = `<p class="legend">${STANDS.map((k) => `<span><i style="background:var(--${k})"></i>${STAND_WORDS[k]}</span>`).join("")}</p>`;
const tile = (v: string, k: string) => `<div class="tile"><div class="v">${v}</div><div class="k">${esc(k)}</div></div>`;

const page = (m: Model, depth: number, title: string, body: string) => {
  const up = "../".repeat(depth);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="claude:viewport-fit-sides" content="cover"><style>${CSS}</style></head><body>
<header><b>${esc(m.title)}</b><nav><a href="${up}index.html">Product</a><a href="${up}work.html">Work</a></nav><span class="muted">generated ${esc(m.built)}</span></header>
<main>${body}</main></body></html>`;
};

export const indexPage = (m: Model): string => {
  const c = m.counts;
  return page(m, 0, m.title, `
<h1>${esc(m.title)}</h1><p class="lede">${esc(m.about)}</p>
<div class="tiles">${[
    tile(`${n(c.pass)} / ${n(c.evals)}`, "evals passing now"), tile(n(c.fail), "failing"), tile(n(c.stale), "stale (claim changed)"),
    tile(n(c.problems), "problems (block a merge)"), tile(n(c.gaps), "gaps (open detail)"), tile(n(c.owed), "changes the code owes a decision"),
  ].join("")}</div>
<h2>Where the operations stand</h2>${legend}${bar(m.stands)}<p class="muted">${STANDS.map((k) => `${STAND_WORDS[k]} ${n(m.stands[k])}`).join(" · ")}</p>
<h2>Journeys</h2><div class="wrap"><table><tr><th>Journey</th><th>Steps</th><th>Stand of its steps</th></tr>
${m.journeys.map((j) => `<tr><td><a href="journeys/${esc(j.id)}.html">${esc(j.title)}</a></td><td>${j.steps.length}</td><td>${bar(standsOf(j))}</td></tr>`).join("")}</table></div>
<h2>Concepts</h2><div class="wrap"><table><tr><th>Concept</th><th>Operations</th><th>Stand</th><th>Gaps</th><th>Owed</th></tr>
${m.concepts.map((x) => `<tr><td><a href="concepts/${esc(x.id)}.html">${esc(x.title)}</a></td><td>${x.operations.length}</td><td>${bar(x.stands)}</td><td>${x.gaps.length}</td><td>${x.owed.length}</td></tr>`).join("")}</table></div>
${m.problems.length ? `<h2>Problems</h2><ul class="plain">${m.problems.map((p) => `<li><code>${esc(p.record)}</code> ${esc(p.rule)}: ${esc(p.detail)}</li>`).join("")}</ul>` : ""}
<h2>Who uses it</h2><ul class="plain">${m.actors.map((a) => `<li><b>${esc(a.id)}</b> (${esc(a.kind)}): ${esc(a.about)}</li>`).join("")}</ul>
<p class="muted">Surfaces: ${m.surfaces.map(esc).join(", ")}.</p>`);
};

const standsOf = (j: JourneyView): Record<Stand, number> => {
  const s = Object.fromEntries(STANDS.map((k) => [k, 0])) as Record<Stand, number>;
  for (const st of j.steps) s[st.stand]++;
  return s;
};

export const conceptPage = (m: Model, c: ConceptView): string => page(m, 1, c.title, `
<h1>${esc(c.title)}</h1><p class="lede">${esc(c.about)}</p>
${c.dependsOn.length ? `<p class="muted">Depends on ${c.dependsOn.map((d) => `<a href="${esc(d)}.html">${esc(d)}</a>`).join(", ")}.</p>` : ""}
<h2>Operations</h2>${legend}${bar(c.stands)}
${c.operations.length ? `<div class="wrap"><table><tr><th>Command</th><th>What</th><th>Stand</th><th>Why</th></tr>${c.operations.map((o) => `<tr><td><code>${esc(o.command)}</code></td><td>${esc(o.title)}</td><td>${pill(o.stand)}</td><td class="muted">${esc(o.why)}</td></tr>`).join("")}</table></div>` : `<p class="muted">No operation belongs to it.</p>`}
${c.owed.length ? `<h2>What the code owes a decision</h2><ul class="plain">${c.owed.map((g) => `<li><code>${esc(g.record)}</code>: ${esc(g.detail)}</li>`).join("")}</ul>` : ""}
${c.gaps.length ? `<h2>Gaps</h2><ul class="plain">${c.gaps.map((g) => `<li><code>${esc(g.record)}</code> ${esc(g.rule)}: ${esc(g.detail)}</li>`).join("")}</ul>` : ""}
<h2>What it holds</h2>${Object.entries(c.records).map(([k, rs]) => `<p><b>${esc(k)}</b> (${rs.length}): ${rs.map((r) => `<span title="${esc(r.title)}">${esc(r.id)}</span>`).join(", ")}</p>`).join("") || `<p class="muted">Nothing yet.</p>`}
<h2>Who worked on it</h2>${c.work.length ? `<div class="wrap"><table><tr><th>Who</th><th>Commits</th><th>Last</th></tr>${c.work.map((w) => `<tr><td>${esc(w.who)}</td><td>${w.commits}</td><td>${esc(w.last.slice(0, 16).replace("T", " "))}</td></tr>`).join("")}</table></div>
<h2>Recent changes</h2><ul class="plain">${c.recent.map((h) => `<li>${esc(h.at.slice(0, 10))} <b>${esc(h.who)}</b>${h.via ? ` (${esc(h.via)})` : ""}: ${esc(h.subject)} <code class="muted">${esc(h.sha.slice(0, 7))}</code></li>`).join("")}</ul>` : `<p class="muted">No commit has touched it yet.</p>`}`);

export const journeyPage = (m: Model, j: JourneyView): string => page(m, 1, j.title, `
<h1>${esc(j.title)}</h1>${j.finish ? `<p class="lede">Ends when: ${esc(j.finish)}</p>` : ""}${legend}${bar(standsOf(j))}
<div class="wrap"><table><tr><th>#</th><th>Step</th><th>Concept</th><th>Stand</th></tr>
${j.steps.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.title)} <code class="muted">${esc(s.operation)}</code></td><td>${s.concept ? `<a href="../concepts/${esc(s.concept)}.html">${esc(s.concept)}</a>` : ""}</td><td>${pill(s.stand)}</td></tr>`).join("")}</table></div>`);

export const workPage = (m: Model): string => {
  const areas = [...new Set(m.people.flatMap((p) => Object.keys(p.areas)))].sort((a, z) => Number(a === "tooling") - Number(z === "tooling") || total(m, z) - total(m, a));
  return page(m, 0, "Work", `
<h1>Work</h1><p class="lede">Who changed what, and when, from the repository's history: commits by concept, with everything that is not product (the plan, the factory, the docs, the portal) counted as tooling. Who is the git author, or Claude when the commit says an agent made it. Eval verdicts are counted by the day they were recorded.</p>
<h2>Who worked on what</h2><div class="wrap"><table><tr><th>Concept</th>${m.people.map((p) => `<th>${esc(p.who)}</th>`).join("")}</tr>
${areas.map((a) => `<tr><td>${a === "tooling" ? "tooling" : `<a href="concepts/${esc(a)}.html">${esc(a)}</a>`}</td>${m.people.map((p) => `<td>${p.areas[a] ?? ""}</td>`).join("")}</tr>`).join("")}</table></div>
<h2>Timeline</h2><div class="wrap"><table><tr><th>Day</th><th>Commits</th><th>By</th><th>Verdicts</th><th>Concepts touched</th></tr>
${m.days.map((d) => `<tr><td>${esc(d.date)}</td><td>${d.commits}</td><td>${Object.entries(d.who).map(([w, k]) => `${esc(w)} ${k}`).join(", ")}</td><td>${Object.entries(d.verdicts).map(([v, k]) => `${esc(v)} ${k}`).join(", ")}</td><td class="muted">${d.areas.map((a) => a === "tooling" ? "tooling" : `<a href="concepts/${esc(a)}.html">${esc(a)}</a>`).join(", ")}</td></tr>`).join("")}</table></div>`);
};
const total = (m: Model, area: string) => m.people.reduce((t, p) => t + (p.areas[area] ?? 0), 0);

/** Every page, by its path. */
export const renderSite = (m: Model): Map<string, string> => new Map([
  ["index.html", indexPage(m)], ["work.html", workPage(m)],
  ...m.concepts.map((c) => [`concepts/${c.id}.html`, conceptPage(m, c)] as [string, string]),
  ...m.journeys.map((j) => [`journeys/${j.id}.html`, journeyPage(m, j)] as [string, string]),
]);
