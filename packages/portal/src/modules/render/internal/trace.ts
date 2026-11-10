/**
 * What happens when an operation runs, as a vertical trace: each step in order, and under an rpc step everything
 * the book lists for it. A row the book holds nothing for says so; it is never left out.
 */
import type { Ref, Trace, TraceStep } from "#src/modules/site/types.ts";

import { chip, esc, link } from "./html.ts";
import { rich, type Cites } from "./prose.ts";

const NONE = '<span class="muted">the book names none</span>';
const refs = (at: string, held: readonly Ref[]): string =>
  held.length === 0 ? NONE : `<span class="inline-list">${held.map((r) => link(at, r, "ref")).join(" ")}</span>`;
/** The same, inside a sentence. */
const inline = (at: string, held: readonly Ref[]): string => (held.length === 0 ? NONE : held.map((r) => link(at, r, "ref")).join(" "));
const names = (held: readonly string[]): string =>
  held.length === 0 ? NONE : `<span class="inline-list">${held.map((s) => `<span class="token">${esc(s)}</span>`).join(" ")}</span>`;

const facts = (at: string, s: TraceStep): string =>
  `<dl class="trace-facts"><dt>Contract calls</dt><dd>${refs(at, s.chain)}</dd><dt>Outside calls</dt><dd>${refs(at, s.calls)}</dd>` +
  `<dt>Procedures</dt><dd>${refs(at, s.invokes)}</dd><dt>Transitions</dt><dd>${refs(at, s.drives)}</dd>` +
  `<dt>Events it sends</dt><dd>${refs(at, s.events)}</dd><dt>Tables it writes</dt><dd>${refs(at, s.writes)}</dd>` +
  `<dt>Spans</dt><dd>${names(s.spans)}</dd></dl>`;

const step = (at: string, s: TraceStep, i: number, cites: Cites): string =>
  `<li class="trace-step${s.rpc ? "" : " trace-local"}"><span class="trace-n">${i + 1}</span><div class="trace-body">` +
  `<p class="trace-head"><span class="trace-name">${esc(s.name)}</span>${chip(s.rpc ? "rpc" : `the SDK: ${s.does}`, s.rpc ? "chip chip-blue" : "chip chip-quiet")}` +
  `${s.rpc ? link(at, s.rpc, "ref") : ""}</p>` +
  (s.about === "" ? "" : `<p class="trace-about">${rich(at, s.about, cites)}</p>`) +
  (s.rpc ? facts(at, s) : `<p class="trace-quiet">The SDK does this itself. The book lists nothing under it.</p>`) + `</div></li>`;

/** What the whole run sends and names: each event with the transition that sends it, each span with who names it. */
const telemetry = (at: string, t: Trace): string =>
  `<dl class="trace-facts trace-telemetry"><dt>Events it sends</dt><dd>${t.sends.length === 0 ? NONE :
    `<ul class="telemetry">${t.sends.map((e) =>
      `<li>${link(at, e.event, "ref")}<span class="muted"> through ${e.transition ? link(at, e.transition, "ref") : "the record itself"}, driven by ${link(at, e.by, "ref")}</span></li>`).join("")}</ul>`}</dd>` +
  `<dt>Spans it names</dt><dd>${t.named.length === 0 ? NONE :
    `<ul class="telemetry">${t.named.map((s) => `<li><code>${esc(s.span)}</code><span class="muted"> named by ${link(at, s.by, "ref")}</span></li>`).join("")}</ul>`}</dd></dl>`;

/** The trace of one operation. With nothing implementing it, it says so. */
export const traceView = (at: string, t: Trace, cites: Cites): string => {
  if (!t.by) return '<p class="silent">The book names nothing that implements this operation, so there is no run to trace.</p>';
  const top = `<p class="trace-top">Implemented by the ${esc(t.kind)} ${link(at, t.by, "ref")}. ` +
    (t.kind === "flow"
      ? `Outside calls the client makes itself: ${inline(at, t.calls)}. Spans the flow names: ${t.spans.length === 0 ? NONE : t.spans.map((s) => `<code>${esc(s)}</code>`).join(", ")}.`
      : "One server endpoint: the run is one step.") + `</p>`;
  return `${top}${telemetry(at, t)}<ol class="trace">${t.steps.map((s, i) => step(at, s, i, cites)).join("")}</ol>`;
};
