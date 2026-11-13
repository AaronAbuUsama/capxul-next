// Budget claims (bud:*/p95, rpc:*/budget, flw:*/budget) judged from this run's warm samples (system.eval-warm-budgets).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Blueprint } from "@capxul/blueprint-engine";

export interface Budget { readonly p95Ms: number; readonly p50Ms?: number }
/** One timing taken in this run. `kind` is one measured path in one process, such as `note-payment-open@worker-1`. */
export interface Sample {
  readonly kind: string;
  readonly ms: number;
  /** Operational host time only: a database clock_timestamp() pair or a span duration, never world or chain time. */
  readonly clock: "host" | "span";
  /** Time inside the claim's excluded waits, subtracted from `ms`. */
  readonly waitMs?: number;
}
export interface Judgement {
  readonly pass: boolean;
  readonly budget: Budget;
  readonly n: number;
  readonly method: "nearest-rank" | "max-median" | "none";
  readonly p95: number | null;
  readonly p50: number | null;
  readonly warm: readonly (Sample & { readonly netMs: number })[];
  readonly cold: readonly (Sample & { readonly netMs: number })[];
  readonly detail: string;
}

/** The budget a budget eval checks, read from its subject record in the blueprint, never from the implementation. */
export const budgetOf = (b: Pick<Blueprint, "evals" | "records">, id: string): Budget => {
  if (!/^bud:.+\/p95$|^(rpc|flw):.+\/budget$/.test(id)) throw new Error(`${id} is not a budget eval`);
  const subject = b.evals.find((e) => e.id === id)?.subject;
  const budget = subject ? (b.records.get(subject) as { budget?: { p95Ms?: unknown; p50Ms?: unknown } } | undefined)?.budget : undefined;
  if (typeof budget?.p95Ms !== "number") throw new Error(`${id}: its subject declares no p95 budget`);
  // Only operations claim a p50 (bud:<operation>/p95); workflow, rpc and flow claims name p95 alone.
  return subject!.startsWith("operation:") && typeof budget.p50Ms === "number" ? { p95Ms: budget.p95Ms, p50Ms: budget.p50Ms } : { p95Ms: budget.p95Ms };
};

const nearestRank = (sorted: readonly number[], q: number): number => sorted[Math.ceil(q * sorted.length) - 1]!;
const median = (sorted: readonly number[]): number =>
  sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;

export const judgeBudget = (budget: Budget, samples: readonly Sample[]): Judgement => {
  const timed = samples.map((s) => ({ ...s, netMs: s.ms - (s.waitMs ?? 0) }));
  const fail = (why: string, warm = timed, cold: typeof timed = []): Judgement =>
    ({ pass: false, budget, n: warm.length, method: "none", p95: null, p50: null, warm, cold, detail: why });
  const bad = timed.filter((s) => (s.clock !== "host" && s.clock !== "span") || !Number.isFinite(s.ms) || s.ms < 0 ||
    (s.waitMs !== undefined && (!Number.isFinite(s.waitMs) || s.waitMs < 0 || s.waitMs > s.ms)));
  if (bad.length) return fail(`${bad.length} samples are not non-negative host-clock or span timings`);
  const seen = new Set<string>(), cold: typeof timed = [], warm: typeof timed = [];
  for (const s of timed) (seen.has(s.kind) ? warm : cold).push(s), seen.add(s.kind);
  const coldOnly = [...seen].filter((kind) => !warm.some((s) => s.kind === kind));
  if (coldOnly.length) return fail(`no warm sample for ${coldOnly.join(", ")}`, warm, cold);
  if (warm.length < 2) return fail(`N=${warm.length} warm samples; at least 2 are required`, warm, cold);
  const sorted = warm.map((s) => s.netMs).sort((a, z) => a - z);
  const large = sorted.length >= 20;
  const p95 = large ? nearestRank(sorted, 0.95) : sorted.at(-1)!;
  const p50 = large ? nearestRank(sorted, 0.5) : median(sorted);
  const pass = p95 <= budget.p95Ms && (budget.p50Ms === undefined || p50 <= budget.p50Ms);
  const method = large ? "nearest-rank" : "max-median";
  const [hi, lo] = large ? ["p95", "p50"] : ["max", "median"];
  const detail = `N=${warm.length} warm (${cold.length} cold excluded), ${method}: ${hi} ${p95} ms ${p95 <= budget.p95Ms ? "≤" : ">"} ${budget.p95Ms}` +
    (budget.p50Ms === undefined ? `, ${lo} ${p50} ms` : `, ${lo} ${p50} ms ${p50 <= budget.p50Ms ? "≤" : ">"} ${budget.p50Ms}`);
  return { pass, budget, n: warm.length, method, p95, p50, warm, cold, detail };
};

/** Keep the whole judgement, every sample included, as the check's evidence file under the module's run directory. */
export const saveJudgement = (file: string, id: string, judgement: Judgement): void => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ eval: id, ...judgement }, null, 2)}\n`);
};
