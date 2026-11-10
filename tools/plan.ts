// node --experimental-strip-types tools/plan.ts <command>      (also: pnpm plan <command>)
//
// The coordinator's plan (plan/plan.json), changed one command at a time. Every change is validated, written, appended
// to plan/log.jsonl with who made it and the commit at the time, and printed. The critical path is written, never
// computed (decision portal.plan-page). `check` is also part of `pnpm portal:check`.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildBook } from "../packages/book/src/index.ts";
import { name, records, stage } from "../books/target/index.ts";
import { CONCEPTS } from "../books/target/shared/foundation.ts";
import { forAaron } from "../books/target/shared/waiting.ts";
import { apply, applyAnswer, appliedTargets, check, describe, logLine, parseAnswerLines, parseArgs, parsePlan, show, unapplied } from "./plan/service.ts";
import { EMPTY_PLAN, type Facts, type LogEntry, type Plan } from "./plan/types.ts";

export const PLAN_FILE = "plan/plan.json";
export const LOG_FILE = "plan/log.jsonl";
export const ANSWERS_FILE = "plan/answers.jsonl";

/** The book as the sets of names the plan is checked against. */
export const factsOf = (log: readonly LogEntry[] = []): Facts => {
  const book = buildBook({ name, stage, records });
  return {
    waiting: new Set([...book.records.values()].filter((r) => r._kind === "decision" && forAaron(r)).map((r) => r.id)),
    applied: appliedTargets(log),
    decisions: new Set([...book.records.values()].filter((r) => r._kind === "decision").map((r) => r.id)),
    records: new Set(book.records.keys()),
    evals: new Set(book.evals.map((e) => e.id)),
    concepts: new Set(CONCEPTS.map((c) => c.id)),
  };
};

const commit = (): string => {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return "unknown"; }
};

const lines = (file: string): string => (existsSync(file) ? readFileSync(file, "utf8") : "");
const logOf = (): readonly LogEntry[] => lines(LOG_FILE).split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as LogEntry);

const read = (): { ok: true; plan: Plan } | { ok: false; error: string } => {
  if (!existsSync(PLAN_FILE)) return { ok: true, plan: EMPTY_PLAN };
  try {
    const parsed = parsePlan(JSON.parse(readFileSync(PLAN_FILE, "utf8")) as unknown);
    return parsed.ok ? { ok: true, plan: parsed.value } : { ok: false, error: `${PLAN_FILE}: ${parsed.error}` };
  } catch (cause) {
    return { ok: false, error: `${PLAN_FILE}: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
};

const main = (argv: readonly string[]): number => {
  const req = parseArgs(argv);
  if (!req.ok) { console.error(req.error); return 2; }
  const loaded = read();
  if (!loaded.ok) { console.error(loaded.error); return 1; }
  const log = logOf();
  const facts = factsOf(log);
  const r = req.value;
  const answers = unapplied(parseAnswerLines(lines(ANSWERS_FILE)), log);
  if (r.kind === "show") {
    const problems = check(loaded.plan, facts);
    console.log(r.json ? JSON.stringify({ plan: loaded.plan, problems, answers }, null, 2) : show(loaded.plan, problems, answers));
    return 0;
  }
  if (r.kind === "answers") {
    console.log(answers.length === 0 ? "No answers to apply." : answers.map((a) => `${a.id}  ${a.at}  ${a.target.kind} ${a.target.id}: ${describe(a)}`).join("\n"));
    return 0;
  }
  if (r.kind === "answers.apply") {
    const now = new Date();
    const entry = applyAnswer(parseAnswerLines(lines(ANSWERS_FILE)), log, r.answer, r.evidence, r.by, now.toISOString(), commit());
    if (!entry.ok) { console.error(`refused: ${entry.error}`); return 1; }
    appendFileSync(LOG_FILE, logLine(entry.value));
    console.log(`answer ${r.answer} applied. The log holds it; plan/answers.jsonl is not changed.`);
    const problems = check(loaded.plan, factsOf(logOf()));
    for (const p of problems) console.log(`  check: ${p.at}: ${p.why}`);
    return 0;
  }
  if (r.kind === "check") {
    const problems = check(loaded.plan, facts);
    for (const p of problems) console.error(`${p.at}: ${p.why}`);
    console.log(problems.length === 0 ? "plan check: 0 problems" : `plan check: ${problems.length} problems`);
    return problems.length === 0 ? 0 : 1;
  }
  const now = new Date();
  const applied = apply(loaded.plan, r.command, { by: r.by, date: now.toISOString().slice(0, 10), at: now.toISOString(), commit: commit() }, facts);
  if (!applied.ok) { console.error(`refused: ${applied.error}`); return 1; }
  mkdirSync(dirname(PLAN_FILE), { recursive: true });
  writeFileSync(PLAN_FILE, `${JSON.stringify(applied.value.plan, null, 2)}\n`);
  appendFileSync(LOG_FILE, logLine(applied.value.entry));
  const problems = check(applied.value.plan, facts);
  console.log(applied.value.message);
  for (const p of problems) console.log(`  check: ${p.at}: ${p.why}`);
  if (problems.length) console.log(`The change is written; ${problems.length} problems remain for the coordinator to settle (nothing was reordered).`);
  return 0;
};

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  process.exitCode = main(process.argv.slice(2));
}
