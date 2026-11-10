/**
 * The Architecture page. The hand-drawn picture comes first and says it is hand-written; everything after it is
 * read from the book: what runs where, what depends on what, one request traced end to end, what crosses the Frappe
 * boundary (boundary.ts), and what the book does not say.
 */
import { keyOf, type AnyRecord } from "@capxul/book";

import type { ArchitecturePage, Ref, TableSection } from "../types.ts";
import { boundary } from "./boundary.ts";
import { brief, head, ofKind, titleOf, type Ctx } from "./context.ts";
import { refOf } from "./locate.ts";
import { HAND_WRITTEN } from "./questions.ts";
import { many, row, tableOf, to, words } from "./table.ts";
import { traceOf } from "./trace.ts";
import { count, entries, isRecord, list, objects, plural, records, text } from "./values.ts";

const once = (found: readonly AnyRecord[]): readonly AnyRecord[] => [...new Map(found.map((r) => [keyOf(r), r] as const)).values()];
const idOf = (u: unknown): string => (isRecord(u) ? u.id : "");

/** One row per component, one column per environment: the line the environment writes about running it. */
const runs = (ctx: Ctx): TableSection => {
  const environments = ofKind(ctx, "environment");
  const on = (e: AnyRecord, c: AnyRecord): string =>
    objects(e["runs"]).filter((run) => idOf(run["component"]) === c.id).map((run) => text(run["on"])).join(" ");
  return tableOf("runs", "What runs where", ["Component", "Runs on", ...environments.map((e) => e.id)],
    ofKind(ctx, "component").map((c) => row([to(refOf(c), titleOf(c)), words(text(c["runtime"])), ...environments.map((e) => words(on(e, c)))])), {
      caption: `${plural(ofKind(ctx, "component").length, "component")} across ${plural(environments.length, "environment")}. A cell holds what the environment's record says about running the component; an empty cell means the record does not run it.`,
      empty: "The book holds no component.",
    });
};

/** Components by how far they sit from the bottom: a layer depends only on layers before it. */
const layers = (ctx: Ctx): readonly (readonly Ref[])[] => {
  const components = ofKind(ctx, "component");
  const byId = new Map(components.map((c) => [c.id, c] as const));
  const depth = (c: AnyRecord, seen: ReadonlySet<string>): number =>
    seen.has(c.id) ? 0 : records(c["dependsOn"]).reduce((d, dep) => {
      const below = byId.get(dep.id);
      return below ? Math.max(d, 1 + depth(below, new Set([...seen, c.id]))) : d;
    }, 0);
  const out: Ref[][] = [];
  for (const c of components) (out[depth(c, new Set())] ??= []).push(refOf(c));
  return Array.from(out, (layer) => layer ?? []);
};

/** What each component leans on and what it hosts, counted from the records that name it. */
const depends = (ctx: Ctx): TableSection => {
  const componentOf = (r: AnyRecord): string =>
    idOf(r["component"]) || idOf(ctx.input.book.records.get(`concept:${idOf(r["concept"])}`)?.["component"]);
  const hosted = (c: AnyRecord, kind: string): readonly AnyRecord[] => ofKind(ctx, kind).filter((r) => componentOf(r) === c.id);
  const contracts = (c: AnyRecord): readonly Ref[] =>
    once([...hosted(c, "rpc"), ...hosted(c, "workflow")].flatMap((r) => records(r["chain"]))
      .flatMap((f) => { const contract = ctx.input.book.records.get(`contract:${text(f["contract"])}`); return contract ? [contract] : []; })).map(refOf);
  const hosts = (c: AnyRecord): string =>
    ([["concept", "concept"], ["rpc", "rpc"], ["flow", "flow"], ["workflow", "workflow"]] as const)
      .flatMap(([kind, one]) => { const n = hosted(c, kind).length; return n > 0 ? [plural(n, one)] : []; }).join(", ");
  return tableOf("depends", "What depends on what", ["Component", "Depends on", "Hosts", "Reaches outside through", "Contracts it calls"],
    ofKind(ctx, "component").map((c) => row([
      to(refOf(c), titleOf(c)), many(records(c["dependsOn"]).map(refOf)), words(hosts(c)),
      many(hosted(c, "integration").map(refOf)), many(contracts(c)),
    ])), {
      caption: "From each component's `dependsOn`, each concept's, flow's and integration's `component`, and the contract functions that the rpcs and workflows of its concepts call. The book links components to each other in no other way.",
      empty: "The book holds no component.",
    });
};

/** What the book does not say, found by counting. Each line names what is missing and how many times. */
const silent = (ctx: Ctx, traced: ArchitecturePage["traced"], crossing: ReturnType<typeof boundary>): readonly string[] => {
  const { architecture: words } = ctx.input.direction;
  const components = ofKind(ctx, "component");
  const running = new Set(ofKind(ctx, "environment").flatMap((e) => objects(e["runs"]).map((run) => idOf(run["component"]))));
  const needed = new Set(components.flatMap((c) => records(c["dependsOn"]).map((d) => d.id)));
  const nowhere = components.filter((c) => !running.has(c.id)).map((c) => `\`${c.id}\``);
  const alone = components.filter((c) => !needed.has(c.id) && list(c["dependsOn"]).length === 0).map((c) => `\`${c.id}\``);
  const spanned = [...ofKind(ctx, "rpc"), ...ofKind(ctx, "flow")];
  const contracts = ofKind(ctx, "contract");
  const unplaced = contracts.filter((c) => entries(c["addresses"]).length === 0).length;
  const steps = traced?.trace.steps ?? [];
  const { mentions } = crossing;
  return [
    ...(nowhere.length > 0 ? [`${nowhere.join(", ")}: no environment record runs ${nowhere.length === 1 ? "it" : "them"}.`] : []),
    ...(alone.length > 0 ? [`${alone.join(", ")}: no component depends on ${alone.length === 1 ? "it, and it depends on none" : "them, and they depend on none"}. The book does not say, as a link between components, how ${alone.length === 1 ? "it reaches" : "they reach"} the rest.`] : []),
    ...(traced ? [] : [`The book holds no operation \`${words.traceOperation}\` to trace end to end.`]),
    `Spans: ${count(spanned.filter((r) => list(r["spans"]).length > 0).length)} of ${plural(spanned.length, "rpc and flow", "rpcs and flows")} name a span` +
      (steps.length > 0 ? `; ${count(steps.filter((s) => s.spans.length > 0).length)} of the ${plural(steps.length, "step")} traced above do` : "") +
      ". The book holds no span attributes and no wide-event record at all.",
    ...(contracts.length > 0 ? [`Addresses: ${count(unplaced)} of ${plural(contracts.length, "contract")} name no deployed address.`] : []),
    ...(crossing.sections[0]?.rows.length === 0 ? [`No record links to a component \`${words.boundary.component}\` or to an integration with the outside system \`${words.boundary.system}\`.`] : []),
    ...(mentions > 0 ? [`Direction: ${plural(mentions, "record")} name a ${words.boundary.word} in words only. For those the book states no direction, so a two-way sync cannot be read off them.`] : []),
  ];
};

export const architecture = (ctx: Ctx): ArchitecturePage => {
  const words = ctx.input.direction.architecture;
  const op = ctx.input.book.records.get(`operation:${words.traceOperation}`);
  const impl = op?.["implementedBy"];
  const traced = op ? { operation: refOf(op), title: titleOf(op), trace: traceOf(ctx, isRecord(impl) ? impl : null, op) } : null;
  const crossing = boundary(ctx);
  return {
    ...head("design", words.title, HAND_WRITTEN, null), type: "architecture", lead: words.lead, diagram: words.diagram,
    runs: runs(ctx), layers: layers(ctx), depends: depends(ctx), traced, boundary: crossing.sections,
    silent: silent(ctx, traced, crossing),
    portal: words.portalDecisions.flatMap((id) => {
      const d = ctx.input.book.records.get(`decision:${id}`);
      return d ? [brief(d)] : [];
    }),
    steps: words.changeSteps,
  };
};
