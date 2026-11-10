/**
 * Docs: the blueprint as catalogues. `docs` is the index; every catalogue is a page of its own at `docs/<name>`, and
 * each is a table of records linked to their pages. The four with a shape of their own are here; the rest are one
 * index per kind (kinds.ts).
 */
import { keyOf, type AnyRecord } from "@capxul/blueprint-engine";

import type { CataloguePage, Ref, TableSection, Tile } from "../types.ts";
import { conceptRef, head, ofKind, standOf, titleOf, type Ctx } from "./context.ts";
import { KIND_CATALOGUES, kindSection } from "./kinds.ts";
import { refOf, slug } from "./locate.ts";
import { variantsOf } from "./schema.ts";
import { code, many, row, standing, tableOf, to, toOr, words } from "./table.ts";
import { count, entries, field, list, plural, records, text } from "./values.ts";

export const DOCS: Ref = { label: "Docs", page: "docs", anchor: "" };
const SOURCE = "blueprint";
const byId = (a: AnyRecord, b: AnyRecord): number => a.id.localeCompare(b.id, "en");
const from = (ctx: Ctx, key: string, kind: string): readonly AnyRecord[] =>
  [...new Set((ctx.input.blueprint.linkedBy.get(key) ?? []).filter((l) => l.from.startsWith(`${kind}:`)).map((l) => l.from))]
    .flatMap((k) => { const r = ctx.input.blueprint.records.get(k); return r ? [r] : []; });

const commands = (ctx: Ctx): TableSection => {
  const ops = ofKind(ctx, "operation").map((op) => ({ op, command: text(op["command"]) || op.id }))
    .toSorted((a, b) => a.command.localeCompare(b.command, "en"));
  return tableOf("commands", "Commands", ["Command", "What it does", "Concept", "Where it stands"], ops.map(({ op, command }) =>
    row([
      to(refOf(op)), words(titleOf(op) + (ctx.input.frozenOperations.has(op.id) ? "" : " (new)")),
      toOr(conceptRef(ctx, op), "shared"), standing(standOf(ctx, op)),
    ], command.split(" ")[0] ?? "")),
  { caption: `${plural(ops.length, "command")}, grouped by first word. Each links to its page: what it returns, its evals and its refusals.` });
};

/** Event id to the transitions that send it: a machine's record holds each transition's events. */
const senders = (ctx: Ctx): ReadonlyMap<string, readonly Ref[]> => {
  const out = new Map<string, Ref[]>();
  for (const machine of ofKind(ctx, "machine")) {
    for (const [name, transition] of entries(machine["transitions"])) {
      for (const event of records(field(transition, "emits"))) {
        const ref = { label: `${machine.id}.${name}`, page: `machine/${machine.id}`, anchor: `transition-${slug(name)}` };
        out.set(event.id, [...(out.get(event.id) ?? []), ref]);
      }
    }
  }
  return out;
};

const events = (ctx: Ctx): TableSection => {
  const sentBy = senders(ctx);
  const all = ofKind(ctx, "event").toSorted(byId);
  return tableOf("events", "Events", ["Event", "Concept", "What it means", "Fields", "Sent by", "Journeys that read it"], all.map((e) => {
    const fields = (variantsOf(e["props"])[0]?.rows ?? []).filter((r) => !/[.[(]/.test(r.path)).length;
    const direct = ["rpc", "procedure", "workflow"].flatMap((kind) => from(ctx, keyOf(e), kind)).map(refOf);
    return row([
      to(refOf(e)), toOr(conceptRef(ctx, e), "shared"), words(text(e["about"])), words(count(fields)),
      many([...(sentBy.get(e.id) ?? []), ...direct]), many(from(ctx, keyOf(e), "journey").map(refOf)),
    ]);
  }), {
    caption: `${plural(all.length, "product event")}. Each carries its own fields beyond the envelope (\`trace_id\`, actor, organization, environment); its page holds the schema. "Sent by" lists the state-machine transitions that send it.`,
  });
};

const errors = (ctx: Ctx): TableSection => {
  const all = ofKind(ctx, "error").toSorted(byId);
  return tableOf("errors", "Errors", ["Code", "Class", "Who acts next", "Exit", "Retry", "What the caller reads", "Operations"], all.map((e) =>
    row([
      to(refOf(e), titleOf(e)), words(text(e["class"])), words(text(e["actor"])), code(text(e["exit"])),
      words(e["retryable"] === true ? "yes" : "no"), words(text(e["message"])), words(count(from(ctx, keyOf(e), "operation").length)),
    ])),
  { caption: `${plural(all.length, "error code")}. "Operations" counts the commands that can answer with the code; a refusal on a command's page links here.` });
};

const spans = (ctx: Ctx): TableSection => {
  const owners = [...ofKind(ctx, "rpc"), ...ofKind(ctx, "flow")];
  const named = owners.filter((r) => list(r["spans"]).length > 0);
  return tableOf("spans", "Spans", ["Span", "Named by", "Kind"],
    named.flatMap((r) => list(r["spans"]).map((name) => row([code(text(name)), to(refOf(r), titleOf(r)), words(r._kind)]))), {
      caption: `The blueprint holds span names only, as a list on an rpc or a flow: no attributes, no parent and no schema. ` +
        `${count(named.length)} of ${plural(owners.length, "rpc and flow", "rpcs and flows")} name any.`,
      empty: "No rpc and no flow names a span.",
    });
};

interface Catalogue { readonly name: string; readonly title: string; readonly lists: string; readonly section: (ctx: Ctx) => TableSection }

const CATALOGUES: readonly Catalogue[] = [
  { name: "commands", title: "Commands", lists: "Every command, grouped by its first word, with its concept and where it stands.", section: commands },
  { name: "events", title: "Events", lists: "Every product event: what it means, what sends it and which journeys read it.", section: events },
  { name: "errors", title: "Errors", lists: "Every error code: its class, who acts next, its exit code and what the caller reads.", section: errors },
  { name: "spans", title: "Spans", lists: "The span names the blueprint holds, and what it does not hold about them.", section: spans },
  ...KIND_CATALOGUES.map((k) => ({ name: k.name, title: k.title, lists: k.lists, section: (ctx: Ctx) => kindSection(ctx, k) })),
];

/** The catalogue that lists a kind's records, as a link: what a count of that kind points at. */
export const catalogueOf = (kind: string): Ref | null => {
  const name = kind === "operation" ? "commands" : kind === "event" ? "events" : kind === "error" ? "errors"
    : KIND_CATALOGUES.find((k) => k.kind === kind)?.name;
  return name === undefined ? null : { label: name, page: `docs/${name}`, anchor: "" };
};

/** Docs and its catalogues: the index first, then one page per catalogue. */
export const docs = (ctx: Ctx): readonly CataloguePage[] => {
  const built = CATALOGUES.map((c) => ({ ...c, table: c.section(ctx), ref: { label: c.title, page: `docs/${c.name}`, anchor: "" } }));
  const evals: Ref = { label: "Evals", page: "eval", anchor: "" };
  const tiles: readonly Tile[] = [
    ...built.map((c) => ({ big: count(c.table.rows.length), name: c.title.toLowerCase(), to: c.ref })),
    { big: count(ctx.input.blueprint.evals.length), name: "evals", to: evals },
  ];
  const index = tableOf("catalogues", "The catalogues", ["Catalogue", "What it lists", "Rows"], [
    ...built.map((c) => row([to(c.ref), words(c.lists), words(count(c.table.rows.length))])),
    row([to(evals), words("Every eval the blueprint derives, by level and by kind."), words(count(ctx.input.blueprint.evals.length))]),
  ]);
  return [
    {
      ...head("docs", "Docs", SOURCE, null), type: "catalogue", nav: "Docs", eyebrow: "Docs",
      lead: "The blueprint as catalogues: every command, event, error and record, each in a table and each linked to its page. Every number is the length of the list it links to.",
      crumbs: [], tiles, sections: [index],
    },
    ...built.map((c): CataloguePage => ({
      ...head(`docs/${c.name}`, c.title, SOURCE, null), type: "catalogue", nav: "Docs", eyebrow: "Docs",
      lead: c.lists, crumbs: [DOCS], tiles: [], sections: [c.table],
    })),
  ];
};
