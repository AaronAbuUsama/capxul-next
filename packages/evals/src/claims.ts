// `pnpm evals claims`: give each recorded verdict that names no claim the claim it proved, read from the blueprint at
// the commit the verdict was recorded at. A verdict recorded before verdicts named their claim would otherwise read as
// stale forever. Each old commit is built with its own engine (blueprint-engine/scripts/at.ts), so
// the claim is the one that run saw; the current blueprint then decides whether it still holds. Writes status/status.json.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseStatus, staleEvals, type EvalStatus, type StatusDocument } from "@capxul/blueprint-engine";
import { blueprintAt, ROOT } from "../../blueprint-engine/scripts/at.ts";
import { loadTarget } from "../../blueprint-engine/scripts/target.ts";

const STATUS = join(ROOT, "status/status.json");

/** The claims the blueprint derived at one commit, by eval id; null when that commit cannot be built. */
const claimsAt = async (commit: string): Promise<ReadonlyMap<string, string> | null> => {
  const b = await blueprintAt(commit);
  return b ? new Map(b.evals.map((e) => [e.id, e.claim])) : null;
};

export const claims = async (): Promise<number> => {
  if (!existsSync(STATUS)) { console.log("No status document: nothing has run."); return 0; }
  const parsed = parseStatus(JSON.parse(readFileSync(STATUS, "utf8")) as unknown);
  if (!parsed.ok) { console.error(parsed.errors.join("\n")); return 1; }
  const doc = parsed.value;
  const missing = Object.entries(doc.evals).filter(([, s]) => s.claim === undefined && s.verdict !== "not_run");
  const commits = [...new Set(missing.map(([, s]) => s.commit))];
  const evals: Record<string, EvalStatus> = { ...doc.evals };
  for (const commit of commits) {
    const at = await claimsAt(commit);
    if (at === null) { console.log(`${commit}: cannot be built here, so its verdicts stay without a claim and read as stale`); continue; }
    for (const [id, s] of missing.filter(([, x]) => x.commit === commit)) {
      const claim = at.get(id);
      if (claim === undefined) console.log(`${id}: the blueprint at ${commit} derives no such eval; left without a claim`);
      else evals[id] = { ...s, claim };
    }
  }
  const next: StatusDocument = { version: 1, evals };
  writeFileSync(STATUS, `${JSON.stringify(next, null, 2)}\n`);
  const target = await loadTarget();
  const stale = target.ok ? staleEvals(target.blueprint, next) : [];
  console.log(`${missing.length} verdicts had no claim; ${Object.values(evals).filter((s) => s.claim !== undefined).length} now name one. Stale against the blueprint now: ${stale.length}${stale.length ? ` (${stale.join(", ")})` : ""}.`);
  return 0;
};
