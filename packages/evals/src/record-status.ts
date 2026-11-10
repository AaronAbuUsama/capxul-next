// node --experimental-strip-types --no-warnings packages/evals/src/record-status.ts <results.json> [--status <file>]
// Merges one run's results into status/status.json (the repository root's; absent means nothing has run).
// A results file is { commit, at, run?, results: [{ id, verdict: "pass" | "fail" | "not_run", evidence? }] }.
// It refuses the whole run, and writes nothing, when it names an eval id the book does not derive.
// The format is described in docs/design-book.md ("The status document").

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mergeResults, parseResults, parseStatus, type StatusDocument } from "@capxul/book";
import { loadTarget } from "../../book/scripts/target.ts";

const STATUS = resolve(import.meta.dirname, "../../../status/status.json");

type Json = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string };
const readJson = (file: string): Json => {
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, "utf8")) as unknown };
  } catch (cause) {
    return { ok: false, error: `${file}: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
};

/** Runs the tool; returns the lines to print and the exit code. */
const run = async (args: readonly string[]): Promise<{ lines: readonly string[]; code: number }> => {
  const [resultsPath, flag, statusArg] = args;
  if (!resultsPath || resultsPath.startsWith("--") || (flag !== undefined && (flag !== "--status" || !statusArg)))
    return { lines: ["usage: packages/evals/src/record-status.ts <results.json> [--status <file>]"], code: 2 };
  const statusPath = statusArg ? resolve(statusArg) : STATUS;
  const results = readJson(resolve(resultsPath));
  if (!results.ok) return { lines: [results.error], code: 1 };
  const run = parseResults(results.value);
  if (!run.ok) return { lines: run.errors, code: 1 };
  let current: StatusDocument | null = null;
  if (existsSync(statusPath)) {
    const file = readJson(statusPath);
    if (!file.ok) return { lines: [file.error], code: 1 };
    const parsed = parseStatus(file.value);
    if (!parsed.ok) return { lines: parsed.errors, code: 1 };
    current = parsed.value;
  }
  const loaded = await loadTarget();
  if (!loaded.ok) return { lines: [loaded.error], code: 1 };
  const merged = mergeResults(loaded.book, current, run.value);
  if (!merged.ok) return { lines: [...merged.errors, `refused: nothing was written to ${statusPath}`], code: 1 };
  mkdirSync(dirname(statusPath), { recursive: true });
  writeFileSync(statusPath, `${JSON.stringify(merged.value, null, 2)}\n`);
  const count = (v: string) => run.value.results.filter((r) => r.verdict === v).length;
  return {
    lines: [`recorded ${run.value.results.length} results at ${run.value.commit} (${count("pass")} pass, ${count("fail")} fail, ${count("not_run")} not run); ${Object.keys(merged.value.evals).length} evals now have a verdict in ${statusPath}`],
    code: 0,
  };
};

const { lines, code } = await run(process.argv.slice(2));
console.log(lines.join("\n"));
process.exitCode = code;
