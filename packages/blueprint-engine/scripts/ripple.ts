// node --experimental-strip-types --no-warnings packages/blueprint-engine/scripts/ripple.ts [--base <ref>] [--json | --markdown]
// What this branch's change to the blueprint reaches: the records it adds, removes and changes, every record that
// depends on them, the decisions that name any of them, and the evals it adds, removes or re-words (whose old verdicts
// go stale). The base defaults to where this branch left origin/integration/build. src/ripple.ts holds the rules.

import { rippleOf, type Ripple } from "../src/index.ts";
import { blueprintAt, git } from "./at.ts";
import { loadTarget } from "./target.ts";

const SHOWN = 15;
const list = (xs: readonly string[], f = (x: string) => `- ${x}`) => [...xs.slice(0, SHOWN).map(f), ...(xs.length > SHOWN ? [`- … ${xs.length - SHOWN} more (--json lists all)`] : [])];

export const markdown = (r: Ripple, base: string): string => {
  const kinds = Object.entries(r.byKind).sort(([, a], [, b]) => b - a).map(([k, n]) => `${k} ${n}`).join(", ");
  if (r.added.length + r.removed.length + r.changed.length === 0) return `### Blueprint ripple against ${base}\n\nThe blueprint does not change.`;
  return [
    `### Blueprint ripple against ${base}`, "",
    `${r.changed.length} records changed, ${r.added.length} added, ${r.removed.length} removed. ` +
      `${r.reached.length} more depend on them${kinds ? ` (${kinds})` : ""}; ${r.decisions.length} decisions name one of them. ` +
      `Evals: ${r.evals.added.length} added, ${r.evals.removed.length} removed, ${r.evals.reworded.length} re-worded (their verdicts go stale).`,
    ...(r.changed.length ? ["", "**Changed**", ...list(r.changed.map((c) => `\`${c.key}\` (${c.fields.join(", ")})`))] : []),
    ...(r.added.length ? ["", "**Added**", ...list(r.added, (x) => `- \`${x}\``)] : []),
    ...(r.removed.length ? ["", "**Removed**", ...list(r.removed, (x) => `- \`${x}\``)] : []),
    ...(r.reached.length ? ["", "**Reached** (nearest first)", ...list(r.reached.map((d) => `\`${d.key}\` ${d.distance} step${d.distance === 1 ? "" : "s"} away, by ${d.field}`))] : []),
    ...(r.decisions.length ? ["", "**Decisions to read again**", ...list(r.decisions, (x) => `- \`${x}\``)] : []),
    ...(r.evals.reworded.length ? ["", "**Evals re-worded** (run them again)", ...list(r.evals.reworded, (x) => `- \`${x}\``)] : []),
  ].join("\n");
};

const main = async (args: readonly string[]): Promise<number> => {
  const at = args.indexOf("--base");
  const ref = at >= 0 ? args[at + 1] ?? "" : git("merge-base", "HEAD", "origin/integration/build").stdout.trim();
  if (!ref) { console.error("ripple: no base: pass --base <ref>, or fetch origin/integration/build"); return 2; }
  const [before, now] = [await blueprintAt(ref), await loadTarget()];
  if (!before) { console.error(`ripple: the blueprint at ${ref} cannot be built`); return 2; }
  if (!now.ok) { console.error(`ripple: ${now.error}`); return 2; }
  const r = rippleOf(before, now.blueprint);
  const base = ref.length === 40 ? ref.slice(0, 12) : ref;
  if (args.includes("--json")) console.log(JSON.stringify({ base, ...r }, null, 2));
  else console.log(markdown(r, base));
  return 0;
};

process.exitCode = await main(process.argv.slice(2));
