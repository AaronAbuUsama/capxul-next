/** A script's output as checks, and the checks as one verdict per eval. */
import type { Bindings } from "../../bindings/service.ts";
import type { CheckLine, Folded, Row, Scored } from "../types.ts";

/** The `@check<TAB>name<TAB>pass|fail<TAB>ms<TAB>detail` lines of a script's output; anything else is the script's talk. */
export const parseLines = (output: string): { readonly lines: readonly CheckLine[]; readonly malformed: readonly string[] } => {
  const lines: CheckLine[] = [];
  const malformed: string[] = [];
  for (const raw of output.split("\n")) {
    if (!raw.startsWith("@check\t")) continue;
    const [, name, verdict, ms, ...rest] = raw.split("\t");
    const time = Number(ms);
    if (!name || (verdict !== "pass" && verdict !== "fail") || !Number.isFinite(time)) malformed.push(raw.slice(0, 120));
    else lines.push({ name, verdict, ms: time, detail: rest.join("\t").trim() });
  }
  return { lines, malformed };
};

export const fold = (lines: readonly CheckLine[]): ReadonlyMap<string, Folded> => {
  const out = new Map<string, Folded>();
  for (const l of lines) {
    const had = out.get(l.name);
    const failed = l.verdict === "fail" || had?.verdict === "fail";
    out.set(l.name, {
      name: l.name, verdict: failed ? "fail" : "pass", times: (had?.times ?? 0) + 1, ms: (had?.ms ?? 0) + l.ms,
      detail: had?.verdict === "fail" ? had.detail : l.detail,
    });
  }
  return out;
};

export const score = (asked: readonly string[], bindings: Bindings, folded: ReadonlyMap<string, Folded>): Scored => {
  const rows: Row[] = [];
  const unfinished: { id: string; missing: readonly string[] }[] = [];
  for (const id of asked) {
    const bound = bindings.byEval.get(id);
    if (!bound) { rows.push({ id, verdict: "not_run", checks: [] }); continue; }
    const seen = bound.binding.checks.flatMap((c) => { const f = folded.get(c); return f ? [f] : []; });
    const missing = bound.binding.checks.filter((c) => !folded.has(c));
    if (missing.length > 0) unfinished.push({ id, missing });
    if (seen.some((c) => c.verdict === "fail")) rows.push({ id, verdict: "fail", checks: seen });
    else if (missing.length === 0) rows.push({ id, verdict: "pass", checks: seen });
    else rows.push({ id, verdict: "not_run", checks: seen });
  }
  return { rows, unfinished };
};
