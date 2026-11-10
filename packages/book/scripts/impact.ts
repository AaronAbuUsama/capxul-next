// node --experimental-strip-types --no-warnings packages/book/scripts/impact.ts <record key> [--json] [--depth n]
// Everything that depends on a record, directly and transitively, grouped by kind, with the field that links each
// and its distance; the decisions that name any of them, listed apart; the evals that belong to any of them.
// "Depends on" is defined in packages/book/src/impact.ts and docs/design-book.md.

import { impactOf, type Dependent, type Impact } from "../src/index.ts";
import { loadTarget } from "./target.ts";

const SHOWN = 12;

const line = (d: Dependent): string => `  ${String(d.distance).padStart(2)}  ${d.key}  ${d.field} → ${d.via}`;

/** The impact as text for a person: counts by kind first, then each kind's records, nearest first. */
export const describe = (i: Impact): string => {
  const kinds = Object.entries(i.byKind).sort(([, a], [, b]) => b - a);
  const out = [
    `${i.subject}: ${i.dependents.length} records depend on it${i.depth === null ? "" : ` within ${i.depth} steps`}, ` +
      `${i.decisions.direct.length} decisions name it, ${i.decisions.onDependents.length} name something that depends on it, ${i.evals.length} evals belong to it or to them.`,
    "", kinds.map(([k, n]) => `${k} ${n}`).join(", "),
  ];
  for (const [kind, n] of kinds) {
    const rows = i.dependents.filter((d) => d.kind === kind);
    out.push("", `${kind} (${n})`, ...rows.slice(0, SHOWN).map(line), ...(rows.length > SHOWN ? [`  ... ${rows.length - SHOWN} more; --json lists all`] : []));
  }
  if (i.decisions.direct.length > 0) out.push("", "decisions that name it", ...i.decisions.direct.map(line));
  return out.join("\n");
};

/** Parses the arguments; a bad line is a message, not a throw. */
export const parse = (args: readonly string[]): { key: string; json: boolean; depth: number | undefined } | string => {
  const positional: string[] = [];
  let json = false;
  let depth: number | undefined;
  for (let k = 0; k < args.length; k++) {
    const a = args[k] ?? "";
    if (a === "--json") json = true;
    else if (a === "--depth") {
      depth = Number(args[++k]);
      if (!Number.isInteger(depth) || depth < 1) return "--depth takes a whole number of 1 or more";
    } else if (a.startsWith("--")) return `unknown option ${a}`;
    else positional.push(a);
  }
  const [key, ...extra] = positional;
  return key === undefined || extra.length > 0 || !key.includes(":") ? "usage: packages/book/scripts/impact.ts <kind:id, e.g. event:payment_transitioned> [--json] [--depth n]" : { key, json, depth };
};

const args = parse(process.argv.slice(2));
if (typeof args === "string") {
  console.error(args);
  process.exitCode = 2;
} else {
  const loaded = await loadTarget();
  if (!loaded.ok) {
    console.error(loaded.error);
    process.exitCode = 1;
  } else {
    const impact = impactOf(loaded.book, args.key, args.depth === undefined ? {} : { depth: args.depth });
    if (!impact) {
      console.error(`${args.key} is not in the book`);
      process.exitCode = 1;
    } else console.log(args.json ? JSON.stringify(impact, null, 2) : describe(impact));
  }
}
