/**
 * Where a record lives on the site. Most kinds have a page at `<kind>/<id>`; a child kind is an anchor on its
 * parent's page; the system is the Overview. Eval anchors follow docs/design/portal.md ("Anchors").
 */
import type { AnyRecord, EvalDef } from "@capxul/book";

import type { EvalRow, Ref } from "../types.ts";
import { kindOf } from "./evalKinds.ts";
import { text } from "./values.ts";

/** A child kind and the field that names its parent, which is also the parent's kind. */
const PARENT: Readonly<Record<string, string>> = {
  transition: "machine", call: "integration", function: "contract", chainEvent: "contract",
};

export const isChild = (kind: string): boolean => kind in PARENT;
/** True for a kind whose records each get a page of their own. */
export const hasPage = (kind: string): boolean => !isChild(kind) && kind !== "system";

/** Text made safe for an anchor: anything but letters, digits, `_`, `.` and `-` becomes `-`. */
export const slug = (s: string): string => s.replace(/[^A-Za-z0-9_.-]+/g, "-");

const labelOf = (r: AnyRecord): string =>
  r._kind === "operation" ? text(r["command"]) || r.id : r._kind === "concept" ? text(r["title"]) || r.id : r.id;

/** The link to a record: its page, or its anchor on its parent's page. */
export const refOf = (r: AnyRecord): Ref => {
  const parent = PARENT[r._kind];
  if (parent !== undefined) {
    return { label: r.id, page: `${parent}/${text(r[parent])}`, anchor: `${r._kind}-${slug(text(r["name"]))}` };
  }
  if (r._kind === "system") return { label: text(r["title"]) || r.id, page: "index", anchor: "" };
  return { label: labelOf(r), page: `${r._kind}/${r.id}`, anchor: "" };
};

/**
 * An eval's anchor on the page of the record `pageId`: the eval kind, then what its id says beyond the page's
 * own id. `acc:payment.send/3` on payment.send is `acc-3`; `sys:imports/payments` on payments is `sys-imports`.
 */
export const evalAnchor = (evalId: string, pageId: string): string => {
  const cut = evalId.indexOf(":");
  const rest = evalId.slice(cut + 1);
  const own = rest === pageId || rest.startsWith(`${pageId}.`) || rest.startsWith(`${pageId}/`);
  const tail = own ? rest.slice(pageId.length) : rest.endsWith(`/${pageId}`) ? rest.slice(0, -pageId.length - 1) : rest;
  return [cut < 0 ? "eval" : evalId.slice(0, cut), ...tail.split(/[./]/).filter(Boolean)].map(slug).join("-");
};

/** The anchor itself, or the anchor with the next free number when the page already uses it. */
export const unique = (used: Set<string>, anchor: string): string => {
  let free = anchor;
  for (let n = 2; used.has(free); n++) free = `${anchor}-${n}`;
  used.add(free);
  return free;
};

/** Evals as a page shows them. `used` holds the page's anchors so far, and gains these. */
export const evalRows = (evals: readonly EvalDef[], pageId: string, used: Set<string>): readonly EvalRow[] =>
  evals.map((e) => ({
    id: e.id, kind: kindOf(e.id), anchor: unique(used, evalAnchor(e.id, pageId)), level: e.level, claim: text(e.claim), decider: e.decider,
  }));
