/** The blueprint indexed once, as plain data, and the small questions every page builder asks of it. */
import { Schema } from "effect";
import {
  evalsUnder, impactIndex, keyOf, passing, standOf as stand, type AnyRecord, type EvalDef, type Finding, type ImpactIndex, type Link,
} from "@capxul/blueprint-engine";

import type { Brief, Count, FindingRow, LinkGroup, OperationRow, PageHead, Ref, SiteInput, StandOf, Value } from "../types.ts";
import { hasPage, refOf } from "./locate.ts";
import { hashOf, recordJson, variantsOf } from "./schema.ts";
import { entries, group, isObject, isRecord, list, text } from "./values.ts";

export interface Ctx {
  readonly input: SiteInput;
  readonly byKind: ReadonlyMap<string, readonly AnyRecord[]>;
  /** Evals by the key of their subject. */
  readonly evals: ReadonlyMap<string, readonly EvalDef[]>;
  readonly gaps: ReadonlyMap<string, readonly Finding[]>;
  readonly problems: ReadonlyMap<string, readonly Finding[]>;
  readonly linksFrom: ReadonlyMap<string, readonly Link[]>;
  /** The decisions that wait for an answer, in the blueprint's order. */
  readonly waiting: readonly AnyRecord[];
  /** Record key to the decisions whose `affects` name it. */
  readonly affecting: ReadonlyMap<string, readonly AnyRecord[]>;
  /** `<concept>/<kind>` to the concept's records of that kind; a shared record's concept is "". */
  readonly members: ReadonlyMap<string, readonly AnyRecord[]>;
  /** Each operation's stand and its eval counts, worked out once from the blueprint and the status document. */
  readonly stands: ReadonlyMap<string, { readonly stand: StandOf; readonly own: Count; readonly under: Count }>;
  /** The blueprint's dependency edges, built once for every "If this changes" block. */
  readonly impacts: ImpactIndex;
}

const countOf = (input: SiteInput, evals: readonly EvalDef[]): Count => {
  const ids = evals.map((e) => e.id);
  return { passing: passing(input.status, ids), total: ids.length };
};

export const contextOf = (input: SiteInput): Ctx => {
  const all = [...input.blueprint.records.values()];
  const affects = input.blueprint.links.filter((l) => l.field === "affects" && l.from.startsWith("decision:"));
  const stands = new Map(all.filter((r) => r._kind === "operation").map((op) => {
    const held = evalsUnder(input.blueprint, op);
    return [keyOf(op), {
      stand: stand(input.blueprint, op, { waits: input.waits, status: input.status }),
      own: countOf(input, held.own), under: countOf(input, held.under),
    }] as const;
  }));
  return {
    stands, impacts: impactIndex(input.blueprint),
    input,
    byKind: group(all, (r) => r._kind),
    evals: group(input.blueprint.evals, (e) => e.subject),
    gaps: group(input.blueprint.gaps, (g) => g.record),
    problems: group(input.blueprint.problems, (g) => g.record),
    linksFrom: group(input.blueprint.links, (l) => l.from),
    waiting: all.filter((r) => r._kind === "decision" && input.waits(r)),
    affecting: new Map([...group(affects, (l) => l.to)].map(([to, links]) => [to, recordsAt(input, links.map((l) => l.from))])),
    members: group(all.filter((r) => hasPage(r._kind)), (r) => `${input.conceptOf.get(keyOf(r)) ?? ""}/${r._kind}`),
  };
};

const recordsAt = (input: SiteInput, keys: readonly string[]): readonly AnyRecord[] =>
  [...new Set(keys)].flatMap((k) => { const r = input.blueprint.records.get(k); return r ? [r] : []; });

export const ofKind = (ctx: Ctx, kind: string): readonly AnyRecord[] => ctx.byKind.get(kind) ?? [];
export const membersOf = (ctx: Ctx, concept: string, kind: string): readonly AnyRecord[] =>
  ctx.members.get(`${concept}/${kind}`) ?? [];
/** The decisions whose `affects` name any of these records, each once. */
export const decisionsOn = (ctx: Ctx, keys: readonly string[]): readonly AnyRecord[] =>
  [...new Set(keys.flatMap((k) => ctx.affecting.get(k) ?? []))];
export const isWaiting = (ctx: Ctx, d: AnyRecord): boolean => ctx.waiting.includes(d);

/** The concept record whose folder exports this record, or null for a shared one. */
export const conceptOf = (ctx: Ctx, r: AnyRecord): AnyRecord | null =>
  ctx.input.blueprint.records.get(`concept:${ctx.input.conceptOf.get(keyOf(r)) ?? ""}`) ?? null;
export const conceptRef = (ctx: Ctx, r: AnyRecord): Ref | null => {
  const c = conceptOf(ctx, r);
  return c ? refOf(c) : null;
};
/** The folder of the blueprint a record is written in. */
export const sourceOf = (ctx: Ctx, r: AnyRecord): string =>
  `blueprint/${r._kind === "concept" ? r.id : (ctx.input.conceptOf.get(keyOf(r)) ?? "shared")}`;

export const titleOf = (r: AnyRecord): string => text(r["title"]) || r.id;
export const brief = (r: AnyRecord): Brief => ({ ref: refOf(r), text: text(r["title"]) || text(r["about"]) });
export const findingRows = (rows: readonly Finding[] | undefined): readonly FindingRow[] =>
  (rows ?? []).map((g) => ({ record: g.record, rule: g.rule, detail: text(g.detail) }));

/** What every page carries. A page that is one record's carries the record as JSON and its hash. */
export const head = (id: string, title: string, source: string, r: AnyRecord | null): PageHead => {
  const record = r ? recordJson(r) : null;
  return { id, title, source, recordKey: r ? keyOf(r) : "", recordHash: r ? hashOf(record) : "", record };
};

/** Links as groups of refs, one group per name, each ref once. */
export const linkGroups = (ctx: Ctx, links: readonly Link[], side: "from" | "to"): readonly LinkGroup[] => {
  const name = (l: Link): string => (side === "to" ? l.field : `${l.from.slice(0, l.from.indexOf(":"))} · ${l.field}`);
  return [...group(links, name)].map(([field, held]) => ({
    field, refs: recordsAt(ctx.input, held.map((l) => l[side])).map(refOf),
  }));
};

/** Any value a record holds, ready to draw: a link as a ref, a schema as its field rows. */
export const valueOf = (u: unknown): Value => {
  if (Schema.isSchema(u)) return { t: "schema", variants: variantsOf(u) };
  if (isRecord(u)) return { t: "ref", ref: refOf(u) };
  if (Array.isArray(u)) return { t: "list", items: list(u).map(valueOf) };
  if (isObject(u)) return { t: "map", entries: entries(u).filter(([, v]) => v !== undefined).map(([k, v]) => [k, valueOf(v)] as const) };
  return { t: "text", text: text(u) };
};

/** Where an operation stands: `standOf` in `@capxul/blueprint-engine`, worked out once for the context. */
export const standOf = (ctx: Ctx, op: AnyRecord): StandOf =>
  ctx.stands.get(keyOf(op))?.stand ?? { stand: "specify", why: "the blueprint has no such operation" };

export const operationRow = (ctx: Ctx, op: AnyRecord): OperationRow => ({
  ref: refOf(op), title: titleOf(op), priority: text(op["priority"]), isNew: !ctx.input.frozenOperations.has(op.id),
  evals: (ctx.evals.get(keyOf(op)) ?? []).length, stand: standOf(ctx, op),
  own: ctx.stands.get(keyOf(op))?.own ?? { passing: 0, total: 0 }, under: ctx.stands.get(keyOf(op))?.under ?? { passing: 0, total: 0 },
});
