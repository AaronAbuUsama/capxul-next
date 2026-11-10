/**
 * The Architecture page. The hand-drawn picture is first and is labelled as hand-written; every section after it
 * is drawn from the book: what runs where, what depends on what, one request traced end to end, what crosses the
 * Frappe boundary, and what the book is silent on.
 */
import type { ArchitecturePage, Diagram, DiagramEdge, DiagramNode } from "#src/modules/site/types.ts";

import { esc, link, prose, section } from "./html.ts";
import { rich, type Cites } from "./prose.ts";
import { tableSection } from "./tables.ts";
import { traceView } from "./trace.ts";

const HEAD = 4;

/** The two ends of an arrow, as the design draws it: 8 px in from the edge it starts on, short by the head. */
const ends = (e: DiagramEdge): readonly [number, number, number, number] =>
  e.direction === "down" ? [e.x + 8, e.y, e.x + 8, e.y + e.length - HEAD]
    : e.direction === "right" ? [e.x, e.y + 8, e.x + e.length - HEAD, e.y + 8]
      : [e.x + e.length, e.y + 8, e.x + HEAD, e.y + 8];

const edge = (e: DiagramEdge): string => {
  const [x1, y1, x2, y2] = ends(e);
  const line = `<line class="edge edge-${e.tone}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#arrow-${e.tone})"/>`;
  return e.label === "" ? line :
    `${line}<foreignObject x="${e.labelX}" y="${e.labelY}" width="112" height="36"><div class="edge-label edge-label-${e.tone}">${esc(e.label)}</div></foreignObject>`;
};

const node = (n: DiagramNode): string =>
  `<foreignObject x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}"><div class="node node-${n.tone}">` +
  `<p class="node-top"><span class="node-title">${esc(n.title)}</span>${n.note === "" ? "" : `<span class="node-note">${esc(n.note)}</span>`}</p>` +
  `<p class="node-text">${prose(n.text)}</p>` +
  (n.chips.length === 0 ? "" : `<p class="node-chips">${n.chips.map((c) => `<span class="node-chip">${esc(c)}</span>`).join("")}</p>`) +
  `</div></foreignObject>`;

const marker = (tone: string): string =>
  `<marker id="arrow-${tone}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path class="head-${tone}" d="M0,0 L8,4 L0,8 Z"/></marker>`;

const diagram = (d: Diagram, title: string): string =>
  `<figure class="diagram"><figcaption class="diagram-label"><span class="chip chip-orange">Direction, hand-written</span>` +
  `<span>This one picture is drawn by hand in <code>content/direction.ts</code>. It is where the design is heading, not what the book records; everything below it is generated from the book.</span></figcaption>` +
  `<div class="diagram-scroll"><svg class="diagram-svg" width="${d.width}" height="${d.height}" viewBox="0 0 ${d.width} ${d.height}" role="img" aria-label="${esc(title)}">` +
  `<defs>${marker("grey")}${marker("blue")}</defs>${d.edges.map(edge).join("")}${d.nodes.map(node).join("")}</svg></div></figure>`;

/** The components in bands: a band depends only on bands above it. */
const layers = (p: ArchitecturePage): string =>
  p.layers.length === 0 ? "" :
    `<ol class="layers">${p.layers.map((layer, i) =>
      `<li class="layer"><span class="layer-n">${i === 0 ? "Depends on nothing" : `Layer ${i + 1}`}</span>` +
      `<span class="inline-list">${layer.map((r) => link(p.id, r, "ref")).join(" ")}</span></li>`).join("")}</ol>`;

const traced = (p: ArchitecturePage, cites: Cites): string =>
  p.traced
    ? section("request", "One request, end to end",
      `<p class="trace-top">The operation ${link(p.id, p.traced.operation, "ref")}: ${prose(p.traced.title)}.</p>${traceView(p.id, p.traced.trace, cites)}`,
      "The same trace as on the operation's own page: the steps of the record that implements it, and what the book lists under each.")
    : "";

const silent = (p: ArchitecturePage, cites: Cites): string =>
  section("silent", "What the book is silent on", p.silent.length === 0 ? "" :
    `<ul class="silent-list">${p.silent.map((s) => `<li>${rich(p.id, s, cites)}</li>`).join("")}</ul>`,
  "Found by counting the records above. Each line is a gap in the design, not in this page.");

const portal = (p: ArchitecturePage): string =>
  section("portal", "How this portal is deployed", p.portal.length === 0 ? "" :
    `<div class="rows">${p.portal.map((b) => `<div class="row">${link(p.id, b.ref, "row-id")}<span class="row-text">${prose(b.text)}</span></div>`).join("")}</div>`,
  "The decisions that say where the portal runs and who may see it.");

const steps = (p: ArchitecturePage): string =>
  `<ol class="flow">${p.steps.map((s, i) =>
    `<li><span class="flow-n">${i + 1}</span><span class="flow-title">${esc(s.title)}</span><span class="flow-text">${prose(s.text)}</span></li>`).join("")}</ol>`;

export const architecture = (p: ArchitecturePage, cites: Cites): string =>
  `<main class="page"><p class="eyebrow eyebrow-muted">Architecture</p><h1 class="title">${esc(p.title)}</h1>` +
  `<p class="lead lead-wide">${prose(p.lead)}</p>${diagram(p.diagram, p.title)}` +
  tableSection(p.id, p.runs, cites) +
  `<section class="block"><h2 id="layers">What must be up before what</h2><p class="caption">From each component's <code>dependsOn</code>: a component sits one band below the deepest thing it depends on.</p>${layers(p)}</section>` +
  tableSection(p.id, p.depends, cites) + traced(p, cites) +
  p.boundary.map((s) => tableSection(p.id, s, cites)).join("") + silent(p, cites) + portal(p) +
  section("change", "How a change reaches this page", steps(p)) + `</main>`;
