/**
 * What crosses the Frappe boundary, read from the blueprint in two ways. First the records that link to it: the Frappe
 * component, the integrations whose outside system is Frappe, their calls, and everything that makes those calls.
 * Then the records that only name a DocType in words. A direction is given only where a record calls another.
 */
import { Schema } from "effect";
import { keyOf, type AnyRecord } from "@capxul/blueprint-engine";

import type { TableRow, TableSection } from "../types.ts";
import { ofKind, titleOf, type Ctx } from "./context.ts";
import { hasPage, refOf } from "./locate.ts";
import { many, row, tableOf, to, words } from "./table.ts";
import { count, entries, group, isObject, isRecord, objects, text } from "./values.ts";

const NO_DIRECTION = "the blueprint states none";
const idOf = (u: unknown): string => (isRecord(u) ? u.id : "");

/** True when a record's own text names the word. Links and schemas are not read: they are other records' text. */
const names = (u: unknown, word: string, depth = 0): boolean => {
  if (typeof u === "string") return u.toLowerCase().includes(word);
  if (depth > 8 || Schema.isSchema(u) || (depth > 0 && isRecord(u))) return false;
  if (Array.isArray(u)) return u.some((x: unknown) => names(x, word, depth + 1));
  return isObject(u) && Object.values(u).some((x) => names(x, word, depth + 1));
};

/** The rows of the records that link to Frappe: the component, who runs it, the integrations, their calls, their callers. */
const linked = (ctx: Ctx): readonly TableRow[] => {
  const { blueprint, direction } = ctx.input;
  const { component, system } = direction.architecture.boundary;
  const linkers = (key: string): readonly AnyRecord[] =>
    [...new Set((blueprint.linkedBy.get(key) ?? []).map((l) => l.from))].flatMap((k) => { const r = blueprint.records.get(k); return r ? [r] : []; });
  const host = (r: AnyRecord): string =>
    idOf(r["component"]) || idOf(blueprint.records.get(`concept:${idOf(r["concept"])}`)?.["component"]) || r._kind;
  const frappe = blueprint.records.get(`component:${component}`);
  const own = frappe ? [
    row([to(refOf(frappe), titleOf(frappe)), words("component"), words("It is the Frappe side."), words(NO_DIRECTION)]),
    ...linkers(keyOf(frappe)).map((r) => {
      const on = objects(r["runs"]).filter((run) => idOf(run["component"]) === component).map((run) => text(run["on"])).join(" ");
      return row([to(refOf(r), titleOf(r)), words(r._kind), words(on !== "" ? `Runs it: ${on}` : r._kind === "decision" ? "A decision about it." : "Names it in its links."), words(NO_DIRECTION)]);
    }),
  ] : [];
  const reaching = ofKind(ctx, "integration").filter((i) => text(i["system"]).toLowerCase().includes(system.toLowerCase()));
  return [...own, ...reaching.flatMap((i) => [
    row([to(refOf(i), titleOf(i)), words("integration"), words(`The service \`${text(i["service"])}\`, hosted by \`${host(i)}\`.`), words(`${host(i)} calls Frappe`)]),
    ...entries(i["calls"]).flatMap(([name, call]) => {
      const key = `call:${i.id}.${name}`;
      const record = blueprint.records.get(key);
      return [
        row([record ? to(refOf(record)) : words(`${i.id}.${name}`), words("call"), words(text(isObject(call) ? call["about"] : "")), words(`${host(i)} calls Frappe`)]),
        ...linkers(key).map((r) => row([to(refOf(r), titleOf(r)), words(r._kind), words(`Makes the call \`${i.id}.${name}\`.`), words(`${host(r)} calls Frappe`)])),
      ];
    }),
  ])];
};

/** The two tables of the boundary, and how many records name a DocType in words only. */
export const boundary = (ctx: Ctx): { readonly sections: readonly TableSection[]; readonly mentions: number } => {
  const { word, component, system } = ctx.input.direction.architecture.boundary;
  const naming = [...ctx.input.blueprint.records.values()].filter((r) => hasPage(r._kind) && names(r, word.toLowerCase()));
  const byKind = [...group(naming, (r) => r._kind)].toSorted(([a], [b]) => a.localeCompare(b, "en"));
  return {
    mentions: naming.length,
    sections: [
      tableOf("boundary", "What crosses the Frappe boundary", ["Record", "Kind", "How it touches Frappe", "Direction"], linked(ctx), {
        caption: `Every record that links to the component \`${component}\`, or to an integration whose outside system is \`${system}\`, and every record that makes one of that integration's calls. A direction is given only where one record calls another.`,
        empty: `No record links to a component \`${component}\` or to an integration with the outside system \`${system}\`.`,
      }),
      tableOf("mentions", `Records that name a ${word} in words`, ["Kind", "Records", "Which"],
        byKind.map(([kind, held]) => row([words(kind), words(count(held.length)), many(held.map(refOf))])), {
          caption: `Found by reading each record's own text for the word \`${word}\`. A mention is not a link: it states no direction and nothing checks it.`,
          empty: `No record names a ${word}.`,
        }),
    ],
  };
};
