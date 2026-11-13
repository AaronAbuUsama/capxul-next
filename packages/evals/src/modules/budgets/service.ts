// Budget claims (bud:*/p95, rpc:*/budget, flw:*/budget) judged from this run's warm samples (system.eval-warm-budgets).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Blueprint } from "@capxul/blueprint-engine";

/** A claim's budget and the wait names its subject record lets a sample subtract. */
export interface Budget { readonly p95Ms: number; readonly p50Ms?: number; readonly excludes: readonly string[] }
/** One timing taken in this run. `kind` is one measured path in one process, such as `note-payment-open@worker-1`. */
export interface Sample {
  readonly kind: string;
  readonly ms: number;
  /** Operational host time only: a database clock_timestamp() pair or a span duration, never world or chain time. */
  readonly clock: "host" | "span";
  /** When the timing began on the host clock (epoch ms); it orders a kind's samples, so the earliest is the cold one. */
  readonly startedAt: number;
  /** Time inside named waits the claim excludes (Budget.excludes), subtracted from `ms`. */
  readonly waits?: readonly { readonly name: string; readonly ms: number }[];
}
export type Timed = Sample & { readonly netMs: number };
export interface Judgement {
  readonly pass: boolean;
  readonly budget: Budget;
  /** Warm samples only. */
  readonly n: number;
  readonly method: "nearest-rank" | "max-median" | "none";
  readonly p95: number | null;
  readonly p50: number | null;
  readonly samples: readonly Sample[];
  readonly warm: readonly Timed[];
  readonly cold: readonly Timed[];
  readonly detail: string;
}

type Waits = { budget?: { p95Ms?: unknown; p50Ms?: unknown; excludes?: readonly string[] }; waits?: readonly { name: string }[]; steps?: readonly { name: string; local?: string }[] };

/** The budget a budget eval checks, read from its subject record in the blueprint, never from the implementation. */
export const budgetOf = (b: Pick<Blueprint, "evals" | "records">, id: string): Budget => {
  if (!/^bud:.+\/p95$|^(rpc|flw):.+\/budget$/.test(id)) throw new Error(`${id} is not a budget eval`);
  const subject = b.evals.find((e) => e.id === id)?.subject;
  const record = subject ? b.records.get(subject) as Waits | undefined : undefined;
  const budget = record?.budget;
  if (typeof budget?.p95Ms !== "number") throw new Error(`${id}: its subject declares no p95 budget`);
  // Exclusions as the record declares them: a workflow's waits and chain confirmation (its claim names them), a flow's
  // local wait steps, and every budget's own excludes; an operation or rpc without excludes subtracts nothing.
  const excludes = [...new Set([
    ...(subject!.startsWith("workflow:") ? [...(record!.waits ?? []).map((w) => `wait.${w.name}`), ...(budget.excludes ?? []), "chain.confirm"] : []),
    ...(subject!.startsWith("flow:") ? (record!.steps ?? []).filter((s) => s.local === "wait").map((s) => `wait.${s.name}`) : []),
    ...(budget.excludes ?? []),
  ])];
  // Only operations claim a p50 (bud:<operation>/p95); workflow, rpc and flow claims name p95 alone.
  return subject!.startsWith("operation:") && typeof budget.p50Ms === "number"
    ? { p95Ms: budget.p95Ms, p50Ms: budget.p50Ms, excludes } : { p95Ms: budget.p95Ms, excludes };
};

const nearestRank = (sorted: readonly number[], q: number): number => sorted[Math.ceil(q * sorted.length) - 1]!;
const median = (sorted: readonly number[]): number =>
  sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

export const judgeBudget = (budget: Budget, samples: readonly Sample[]): Judgement => {
  const fail = (why: string, warm: Timed[] = [], cold: Timed[] = []): Judgement =>
    ({ pass: false, budget, n: warm.length, method: "none", p95: null, p50: null, samples, warm, cold, detail: why });
  const waited = (s: Sample): number => (s.waits ?? []).reduce((sum, w) => sum + w.ms, 0);
  const bad = samples.filter((s) => (s.clock !== "host" && s.clock !== "span") || !finite(s.ms) || !finite(s.startedAt) ||
    (s.waits ?? []).some((w) => !budget.excludes.includes(w.name) || !finite(w.ms)) || waited(s) > s.ms);
  if (bad.length) return fail(`${bad.length} samples are not host-clock or span timings with a start and only the claim's waits (${budget.excludes.join(", ") || "none"})`);
  // Each kind in host-clock order; its earliest sample is cold, whatever order the caller passed.
  const timed = [...samples].sort((a, z) => a.startedAt - z.startedAt).map((s) => ({ ...s, netMs: s.ms - waited(s) }));
  const tied = timed.filter((s, i) => timed.some((o, j) => j !== i && o.kind === s.kind && o.startedAt === s.startedAt));
  if (tied.length) return fail(`${tied.length} samples share a start with another of their kind, so the cold one is unknown`);
  const seen = new Set<string>(), cold: Timed[] = [], warm: Timed[] = [];
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
  return { pass, budget, n: warm.length, method, p95, p50, samples, warm, cold, detail };
};

/** Keep the whole judgement, every sample included, as the check's evidence file under the module's run directory. */
export const saveJudgement = (file: string, id: string, judgement: Judgement): void => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ eval: id, ...judgement }, null, 2)}\n`);
};
