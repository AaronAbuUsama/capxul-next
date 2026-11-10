/**
 * An operation's page: the call as the CLI and as the SDK, what it returns as a table and as a skeleton, what
 * happens when it runs, every eval by kind, its refusals, and beside them where it stands.
 */
import { jsonFile, mdFile } from "#src/modules/site/service.ts";
import type { ArgRow, OperationPage, Variant } from "#src/modules/site/types.ts";

import { evalGroups } from "./evals.ts";
import { impactView } from "./impact.ts";
import { sessionView } from "./session.ts";
import { codeBlock } from "./highlight.ts";
import { chip, count, crumbs, esc, fileHref, hrefTo, link, plural, prose, section, table } from "./html.ts";
import { RUNGS, briefRows, findings, fold, linkGroups, rungsBehind } from "./parts.ts";
import { blocks, rich, type Cites } from "./prose.ts";
import { traceView } from "./trace.ts";
import { fieldsTable } from "./value.ts";

/** The call, twice: as the command line and as the SDK. A radio pair and CSS switch them; no script. */
const call = (p: OperationPage): string => {
  const sdk = p.sdkCall === ""
    ? '<p class="silent">The book names nothing that implements this operation, so there is no SDK call to show.</p>'
    : codeBlock(p.sdk === "" ? "SDK · the book names no method" : `SDK · ${p.sdk} · types generated from the book's schemas`, "ts", p.sdkCall);
  return `<div class="tabs" id="call"><input type="radio" name="call" id="call-cli" checked><label for="call-cli">CLI</label>` +
    `<input type="radio" name="call" id="call-sdk"><label for="call-sdk">SDK</label>` +
    `<div class="tab tab-cli">${codeBlock("Command line · synopsis", "bash", `# ${p.title}\n${p.synopsis}`)}</div>` +
    `<div class="tab tab-sdk">${sdk}</div></div>`;
};

/** One shape: its fields as a table, and the same shape as a JSON skeleton beside it. */
const shape = (v: Variant): string =>
  `<div class="shape">${v.label === "" ? "" : `<p class="variant-label">${prose(v.label)}</p>`}<div class="shape-pair">` +
  `<div class="shape-fields">${fieldsTable(v)}</div>` +
  `<div class="shape-json">${codeBlock("JSON · generated from the schema, not a recorded response", "json", v.skeleton)}</div></div></div>`;

const examples = (p: OperationPage): string =>
  p.examples.length === 0 ? "" : `<div class="examples" id="examples">${p.examples.map(sessionView).join("")}</div>`;

const returns = (p: OperationPage): string =>
  p.returns.length > 0
    ? section("returns", "What it returns", examples(p) + p.returns.map(shape).join(""),
      p.examples.length === 0
        ? "The shape of `--json`, as the book holds it. A `<type>` in the skeleton is a placeholder: the book records no example response, and what the command prints for a person is not designed yet."
        : "Recorded runs first, each checked against the shape at build time. Then the shape of `--json`, as the book holds it; a `<type>` in the skeleton is a placeholder, not a recorded response.")
    : `<div class="undesigned">${chip("Not designed yet", "chip chip-orange")}<span>What the command prints, and its <code>--json</code> shape, ` +
      `appear here once the book holds them. This is where the DX gets explored.</span></div>`;

const argRows = (rows: readonly ArgRow[]): readonly string[] =>
  rows.map((r) => `<tr><td class="mono name">${esc(r.name)}</td><td class="muted nowrap">${esc(r.kind)}</td><td>${prose(r.text)}</td></tr>`);

const oldCli = (p: OperationPage): string => {
  if (!p.oldCli) {
    return section("arguments", "Arguments and flags",
      `<p class="muted">${p.isNew ? "This operation is new: the old CLI never had it." : "The old system designed this command and never shipped it."} Its arguments and flags are the target book's to design.</p>`);
  }
  const rows = [...argRows(p.oldCli.arguments), ...argRows(p.oldCli.flags)];
  return section("arguments", "Arguments and flags",
    rows.length === 0 ? '<p class="muted">The old CLI took no arguments and no flags here.</p>' : table(["Name", "Kind", "What it does"], rows, "args"),
    "Reference, old CLI. The behaviour is kept; the spelling is the target book's to design.");
};

const refusals = (p: OperationPage, cites: Cites): string =>
  section("refusals", "Refusals", p.refusals.length === 0 ? "" :
    table(["Code", "When", "What the caller reads", "Exit"], p.refusals.map((r) =>
      `<tr><td class="nowrap">${link(p.id, r.error, "mono name")}<span class="cell-sub">${esc(r.class)}</span></td>` +
      `<td>${r.given === "" ? "" : `<span class="token">${esc(r.given)}</span> `}${rich(p.id, r.when, cites)}</td>` +
      `<td>${prose(r.message)}</td><td class="mono muted">${esc(r.exit)}</td></tr>`), "refusals"),
  "Each refusal starts from a named world (the first word of When) and leaves it unchanged.");

const stands = (p: OperationPage): string => {
  const behind = rungsBehind(p.stand);
  return `<div class="side-card"><p class="eyebrow eyebrow-muted">Where it stands</p><ul class="rungs">` +
    RUNGS.map((r, i) => `<li class="rung${i < behind ? " on" : ""}"><i class="rung-dot"></i>${r}</li>`).join("") +
    `</ul><p class="side-note">${prose(p.stand.why)}</p>` +
    `<p class="side-total"><a href="#evals">Evals passing</a><span class="mono">${count(p.passing.own.passing)} / ${count(p.evals.length)}</span></p>` +
    `<p class="side-total"><span>Under it</span><span class="mono">${count(p.passing.under.passing)} / ${count(p.passing.under.total)}</span></p></div>`;
};

const implemented = (p: OperationPage): string => {
  const rows = [
    p.implementedBy ? `<dt>${esc(p.implementedKind === "" ? "Record" : p.implementedKind)}</dt><dd>${link(p.id, p.implementedBy.ref, "mono")}</dd>` : "",
    p.sdk === "" ? "" : `<dt>SDK</dt><dd class="mono">${esc(p.sdk)}</dd>`,
    p.budget === "" ? "" : `<dt>Time budget</dt><dd class="mono">${esc(p.budget)}</dd>`,
  ].join("");
  return `<div class="side-card"><p class="eyebrow eyebrow-muted">Implemented by</p>` +
    (rows === "" ? '<p class="side-note">The book names nothing that implements it yet.</p>' : `<dl class="side-list">${rows}</dl>`) + `</div>`;
};

const open = (p: OperationPage): string => {
  const review = hrefTo(p.id, { label: "", page: "review", anchor: "" });
  const body = p.waiting.length > 0
    ? `<ul class="side-open">${p.waiting.map((b) => `<li>${link(p.id, b.ref, "mono")}<span>${prose(b.text)}</span></li>`).join("")}</ul>`
    : `<p class="side-note">No question waits for you here.${p.concept ? ` ${plural(p.settledInConcept, "decision")} in ${esc(p.concept.label)} ${p.settledInConcept === 1 ? "is" : "are"} already made.` : ""}</p>`;
  return `<div class="side-card"><p class="eyebrow eyebrow-muted">Open on this record</p>${body}<a class="side-link" href="${esc(review)}">See all the questions</a></div>`;
};

/** The same record as Markdown and as JSON: every record page ends its side column with this card. */
export const forAgents = (at: string): string =>
  `<div class="side-card side-quiet"><p class="eyebrow eyebrow-muted">For agents</p><p class="side-note">The same record, as text and as data.</p>` +
  `<p class="side-files"><a class="mono" href="${esc(fileHref(at, mdFile(at)))}">${esc(mdFile(at))}</a>` +
  `<a class="mono" href="${esc(fileHref(at, jsonFile(at)))}">${esc(jsonFile(at))}</a></p></div>`;

const duo = (p: OperationPage, cites: Cites): string => {
  const silent = '<p class="muted">The book does not say yet.</p>';
  return `<div class="duo"><div class="duo-card"><p class="eyebrow eyebrow-muted">Who can do it</p>${blocks(p.id, p.who, cites) || silent}</div>` +
    `<div class="duo-card"><p class="eyebrow eyebrow-muted">What it changes</p>${blocks(p.id, p.changes, cites) || silent}</div></div>`;
};

export const operation = (p: OperationPage, cites: Cites): string => {
  const at = p.id;
  const trail = [link(at, { label: "Concepts", page: "index", anchor: "concepts" }), ...(p.concept ? [link(at, p.concept)] : []), esc(p.command)];
  const notes = p.notes.length === 0 ? "" : `<ul class="notes">${p.notes.map((n) => `<li>${rich(at, n, cites)}</li>`).join("")}</ul>`;
  const mistakes = p.mistakes.length === 0 ? "" :
    `<div class="rows">${p.mistakes.map((m) => `<div class="row"><span class="row-id plain">${prose(m.what)}</span><span class="row-text">${prose(m.fix)}</span></div>`).join("")}</div>`;
  return `<main class="page with-side"><div class="main-col">${crumbs(trail)}` +
    `<div class="title-row"><h1 class="title">${esc(p.title)}</h1>${p.priority === "" ? "" : chip(p.priority, "chip chip-orange")}${p.isNew ? chip("new", "chip chip-quiet") : ""}</div>` +
    `${blocks(at, p.about, cites, "prose lead-prose")}${call(p)}${returns(p)}${duo(p, cites)}${oldCli(p)}` +
    section("run", "What happens when you run it", traceView(at, p.trace, cites),
      "The steps of the record that implements it, in order, and what the book lists under each. Nothing here has run: it is the design.") +
    section("evals", "Evals", evalGroups(p, cites),
      `${plural(p.evals.length, "eval")} in ${plural(p.evalKinds.length, "kind")}. Each is one claim a run can check; ${p.evals.some((e) => e.verdict !== "not_run") ? `${p.passing.own.passing} pass in the status document.` : "none has run, because no code exists yet."}`) +
    refusals(p, cites) + section("notes", "Notes", notes) + section("mistakes", "Common mistakes", mistakes) +
    section("gaps", "What the book still lacks here", findings(p.gaps)) +
    section("used-by", "Used by", linkGroups(at, p.usedBy)) + impactView(at, p.impact) +
    section("decisions", "Decisions that name it", p.decisions.length === 0 ? "" : fold(plural(p.decisions.length, "decision"), briefRows(at, p.decisions))) +
    `</div><aside class="side">${stands(p)}${implemented(p)}${open(p)}${forAgents(at)}</aside></main>`;
};
