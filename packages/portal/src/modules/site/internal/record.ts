/** The page of any other record: its fields, its children as anchored sections, and everything that names it. */
import { keyOf, type AnyRecord, type Link } from "@capxul/blueprint-engine";

import type { ChildSection, RecordPage } from "../types.ts";
import { impactBlock } from "./impact.ts";
import {
  brief, conceptRef, decisionsOn, findingRows, head, isWaiting, linkGroups, sourceOf, titleOf, valueOf, type Ctx,
} from "./context.ts";
import { evalRows, slug, unique } from "./locate.ts";
import { questionOf } from "./questions.ts";
import { entries, field, isRecord, text } from "./values.ts";

/** Per parent kind: the field that describes its children, the map that holds their records, and their kind. */
const CHILDREN: Readonly<Record<string, readonly (readonly [string, string, string])[]>> = {
  machine: [["transitions", "t", "transition"]],
  integration: [["calls", "c", "call"]],
  contract: [["functions", "f", "function"], ["events", "e", "chainEvent"]],
};
const HEAD_FIELDS = new Set(["_kind", "id", "title", "about", "t", "c", "f", "e"]);

const named = (ctx: Ctx, key: string): readonly Link[] =>
  (ctx.input.blueprint.linkedBy.get(key) ?? []).filter((l) => l.field !== "affects");

const childrenOf = (ctx: Ctx, r: AnyRecord, used: Set<string>): readonly ChildSection[] =>
  (CHILDREN[r._kind] ?? []).flatMap(([details, held, kind]) =>
    entries(r[details]).map(([name, detail]) => {
      const child = field(r[held], name);
      const key = isRecord(child) ? keyOf(child) : `${kind}:${r.id}.${name}`;
      return {
        kind, name, anchor: unique(used, `${kind}-${slug(name)}`), value: valueOf(detail),
        evals: evalRows(ctx.evals.get(key) ?? [], r.id, used, ctx.input.status), gaps: findingRows(ctx.gaps.get(key)),
        linkedBy: linkGroups(ctx, named(ctx, key), "from"),
      };
    }));

export const record = (ctx: Ctx, r: AnyRecord): RecordPage => {
  const key = keyOf(r);
  const used = new Set<string>();
  const children = childrenOf(ctx, r, used);
  const skipped = new Set([...HEAD_FIELDS, ...(CHILDREN[r._kind] ?? []).map(([details]) => details)]);
  return {
    ...head(`${r._kind}/${r.id}`, titleOf(r), sourceOf(ctx, r), r), type: "record", kind: r._kind, impact: impactBlock(ctx, key),
    concept: conceptRef(ctx, r), about: text(r["about"]),
    waits: r._kind === "decision" && isWaiting(ctx, r) ? questionOf(ctx, r).ref : null,
    fields: entries(r).filter(([k, v]) => !skipped.has(k) && v !== undefined).map(([k, v]) => [k, valueOf(v)] as const),
    children, linksOut: linkGroups(ctx, ctx.linksFrom.get(key) ?? [], "to"), linkedBy: linkGroups(ctx, named(ctx, key), "from"),
    evals: evalRows(ctx.evals.get(key) ?? [], r.id, used, ctx.input.status), gaps: findingRows(ctx.gaps.get(key)),
    decisions: decisionsOn(ctx, [key]).map(brief),
  };
};
