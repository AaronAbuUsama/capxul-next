// The rules for DocTypes and roles. A wrong shape is a problem; a DocType a decision retires is a gap until it goes.

import type { AnyRecord, Blueprint, Finding } from "./build.ts";

type Records = Pick<Blueprint, "records">;
type Field = { name: string; type: string; link?: { id: string }; options?: readonly string[] };
const key = (r: { _kind: string; id: string }) => `${r._kind}:${r.id}`;
const of = (b: Records, kind: string) => [...b.records.values()].filter((r) => r._kind === kind);
const fieldsOf = (d: AnyRecord) => d.fields as readonly Field[];

export const siteProblems = (b: Records): Finding[] => {
  const out: Finding[] = [];
  const p = (r: AnyRecord, rule: string, detail: string) => out.push({ record: key(r), rule, detail });
  const byName = new Map<string, AnyRecord>();
  for (const d of of(b, "doctype")) {
    const name = String(d.name);
    const twin = byName.get(name);
    if (twin) p(d, "doctype-name", `${twin.id} is already the DocType ${name}`);
    byName.set(name, d);
    if (d.single && d.child) p(d, "doctype-shape", "a DocType is single or a child table, never both");
    const seen = new Set<string>();
    for (const f of fieldsOf(d)) {
      if (seen.has(f.name)) p(d, "doctype-field", `${f.name} is listed twice`);
      seen.add(f.name);
      const linked = f.link ? b.records.get(key({ _kind: "doctype", id: f.link.id })) : undefined;
      if ((f.type === "Link" || f.type === "Table") && !f.link) p(d, "doctype-field", `${f.name} is a ${f.type} and names no DocType`);
      if (f.link && f.type !== "Link" && f.type !== "Table") p(d, "doctype-field", `${f.name} is ${f.type}, which links to no DocType`);
      if (f.type === "Table" && linked && !linked.child) p(d, "doctype-field", `${f.name} holds rows of ${linked.id}, which is not a child DocType`);
      if (f.type === "Link" && linked?.child) p(d, "doctype-field", `${f.name} links to ${linked.id}, a child DocType, which has no documents of its own`);
      if (f.type === "Select" && !f.options?.length) p(d, "doctype-field", `${f.name} is a Select with no options`);
    }
  }
  for (const r of of(b, "role")) {
    const roles = r.frappeRoles as readonly string[];
    for (const dup of roles.filter((x, i) => roles.indexOf(x) !== i)) p(r, "role-frappe-roles", `${dup} is listed twice`);
  }
  return out;
};

export const siteGaps = (b: Records): Finding[] => {
  const out: Finding[] = [];
  const children = new Set(of(b, "doctype").flatMap((d) => fieldsOf(d).filter((f) => f.type === "Table").map((f) => f.link?.id)));
  for (const d of of(b, "doctype")) {
    const retired = d.retiredBy as { id: string } | undefined;
    if (retired) out.push({ record: key(d), rule: "doctype-to-retire", detail: `decision ${retired.id} removes it; the code still has it` });
    if (d.child && !children.has(d.id)) out.push({ record: key(d), rule: "unused-child-doctype", detail: "no Table field holds its rows" });
  }
  return out;
};
