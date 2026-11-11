// The rules and evals for screens. A value from a field its source does not have, or a state that allows an action the
// screen does not have, is a problem. Each screen derives evals that open it as a permitted role and as a refused one,
// press each button, and (for a screen in a part) find it closed when the part is off.

import { Schema } from "effect";
import type { AnyRecord, Blueprint, Finding } from "./build.ts";
import type { EvalDef } from "./evals.ts";

type Records = Pick<Blueprint, "records">;
const key = (r: { _kind: string; id: string }) => `${r._kind}:${r.id}`;
const of = (b: Records, kind: string) => [...b.records.values()].filter((r) => r._kind === kind);

/** The field names of a DocType or table record; null when they cannot be read. */
const fieldsOf = (b: Records, r: AnyRecord): Set<string> | null => {
  const full = b.records.get(key(r)) ?? r;
  if (full._kind === "doctype") return new Set((full.fields as { name: string }[]).map((f) => f.name));
  const fields = full._kind === "table" && Schema.isSchema(full.fields) ? (full.fields as { fields?: object }).fields : undefined;
  return fields ? new Set(Object.keys(fields)) : null;
};

export const screenProblems = (b: Records): Finding[] => {
  const out: Finding[] = [];
  const p = (r: AnyRecord, detail: string) => out.push({ record: key(r), rule: "screen-shape", detail });
  for (const s of of(b, "screen")) {
    for (const v of s.shows as { label: string; from: AnyRecord; field?: string }[]) {
      const has = v.field !== undefined ? fieldsOf(b, v.from) : null;
      if (has && v.field !== undefined && !has.has(v.field)) p(s, `"${v.label}" reads ${v.field}, which ${key(v.from)} does not have`);
    }
    const actions = new Set(((s.actions ?? []) as { name: string }[]).map((a) => a.name));
    for (const st of (s.states ?? []) as { state: string; allows: string[] }[])
      for (const a of st.allows) if (!actions.has(a)) p(s, `state ${st.state} allows ${a}, which is not one of its actions`);
  }
  return out;
};

export const screenEvals = (b: Records): EvalDef[] => {
  const out: EvalDef[] = [];
  const e = (id: string, r: AnyRecord, claim: string, decider: EvalDef["decider"] = "machine") =>
    out.push({ id, level: "L2", subject: key(r), claim, decider });
  for (const s of of(b, "screen")) {
    const who = (s.who as AnyRecord[]).map((r) => r.id).join(", ");
    e(`scr:${s.id}/shows`, s, `opened as ${who} on the thin-line world, every value equals its source, and a screenshot is kept`);
    e(`scr:${s.id}/refuses`, s, `a person in none of ${who} cannot open it`);
    for (const a of (s.actions ?? []) as { name: string; runs: AnyRecord | string }[])
      e(`scr:${s.id}/action/${a.name}`, s, `${a.name} runs ${typeof a.runs === "string" ? a.runs : key(a.runs)}, and the screen then shows the new state`);
    if (s.feature) e(`scr:${s.id}/off`, s, `with ${(s.feature as AnyRecord).id} switched off, it is closed`);
  }
  return out;
};
