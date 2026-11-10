/**
 * The evals runner's process entry and composition root: the only file here that reads the arguments, the repository, the
 * clock, the environment and the child processes, prints, or exits.
 *
 *   pnpm evals -- <eval ids | all | --journey <id> | --milestone <id>> [--slug <company>] [--world main]
 *   pnpm evals -- check | gaps [--json] | list
 *
 * A run starts each bound script for the behaviours its checks sit in, reads the `@check` lines it prints, scores the evals
 * asked for, keeps the evidence under status/runs/<run>/ and merges the verdicts into status/status.json through
 * tools/record-status.ts, which is the only thing that writes that file.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseStatus, type Book } from "@capxul/book";

import { loadTarget } from "../../../tools/book-target.ts";
import { gapsOf, loadBindings, parseBindingFile, parseScriptList, selectEvals, type BindingFile, type Bindings, type Index, type ScriptChecks, type What } from "./modules/bindings/service.ts";
import { cap, evidenceText, fileNameOf, foldChecks, parseCheckLines, redact, resultsFile, scoreEvals, type CheckLine, type RunInfo } from "./modules/runs/service.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const EVIDENCE_CAP = 60_000;
const LOG_CAP = 400_000;
const JOURNEYS = ["create_company_site", "grant_hat_in_frappe", "pay_invoice_from_frappe", "stays_true_when_broken", "run_a_world"];

type Loaded = { readonly book: Book; readonly files: readonly BindingFile[]; readonly scripts: ReadonlyMap<string, ScriptChecks>; readonly bindings: Bindings };
type Raw = Record<string, unknown>;

const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const json = (path: string): unknown => JSON.parse(read(path)) as unknown;

/** The book, the binding files and the scripts' lists of checks, validated against each other. */
const loadAll = async (): Promise<{ ok: true; value: Loaded } | { ok: false; errors: readonly string[] }> => {
  const target = await loadTarget();
  if (!target.ok) return { ok: false, errors: [target.error] };
  const dir = join(ROOT, "evals/bindings");
  const files: BindingFile[] = [];
  const errors: string[] = [];
  for (const name of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : []) {
    const parsed = parseBindingFile(`evals/bindings/${name}`, json(`evals/bindings/${name}`));
    if (parsed.ok) files.push(parsed.value); else errors.push(...parsed.errors);
  }
  const scripts = new Map<string, ScriptChecks>();
  for (const f of files) {
    if (scripts.has(f.script)) continue;
    const listed = spawnSync("bash", [join(ROOT, f.script), "--list"], { encoding: "utf8" });
    if (listed.status !== 0) errors.push(`${f.script} --list failed: ${listed.stderr.slice(0, 200)}`);
    else scripts.set(f.script, parseScriptList(listed.stdout));
  }
  const loaded = loadBindings(files, { evals: new Set(target.book.evals.map((e) => e.id)), scripts });
  if (!loaded.ok) errors.push(...loaded.errors);
  return errors.length > 0 || !loaded.ok ? { ok: false, errors } : { ok: true, value: { book: target.book, files, scripts, bindings: loaded.value } };
};

/** The evals a journey stands for: its own, and what its steps' operations promise (acceptance, returns, refusals, events). */
const indexOf = (book: Book): Index => ({
  journey: (id) => {
    const journey = book.records.get(`journey:${id}`) as { steps?: readonly { operation: { id: string } }[] } | undefined;
    if (!journey) return null;
    const ops = new Set((journey.steps ?? []).map((s) => `operation:${s.operation.id}`));
    return book.evals.filter((e) => e.subject === `journey:${id}` || (ops.has(e.subject) && /^(acc|ret|ref|evt):/.test(e.id))).map((e) => e.id);
  },
  milestone: (id) => {
    const plan = json("plan/plan.json") as { milestones?: Raw[]; tasks?: Raw[] };
    const m = (plan.milestones ?? []).find((x) => x["id"] === id);
    if (!m) return null;
    const exits = (m["exit"] as Raw[] | undefined) ?? [];
    const tasks = (plan.tasks ?? []).filter((t) => t["milestone"] === id);
    return [...exits, ...tasks].flatMap((x) => (x["evals"] as string[] | undefined) ?? []);
  },
});

const commitOf = (): string => {
  const git = (...args: string[]) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const dirty = git("status", "--porcelain", "--untracked-files=no", "--", ".", ":(exclude)status") !== "";
  return `${git("rev-parse", "--short", "HEAD") || "unknown"}${dirty ? "+dirty" : ""}`;
};

/** The values of every key, secret, password and token field of a JSON or .env file: what the evidence must not hold. */
const secretsIn = (path: string): string[] => {
  if (!existsSync(join(ROOT, path))) return [];
  const sensitive = /key|secret|password|token/i;
  const text = read(path);
  if (path.endsWith(".json")) {
    const found: string[] = [];
    const walk = (v: unknown, key: string): void => {
      if (typeof v === "string" && sensitive.test(key)) found.push(v);
      else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
      else if (typeof v === "object" && v !== null) Object.entries(v).forEach(([k, x]) => walk(x, k));
    };
    walk(JSON.parse(text), "");
    return found;
  }
  return text.split("\n").flatMap((l) => { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l); return m && sensitive.test(m[1] ?? "") ? [m[2] ?? ""] : []; });
};

const runScript = (script: string, args: readonly string[]): Promise<{ output: string; code: number }> =>
  new Promise((done) => {
    const child = spawn("bash", [join(ROOT, script), ...args], { cwd: ROOT, env: process.env });
    let output = "";
    const take = (chunk: Buffer): void => { output += chunk.toString(); process.stdout.write(chunk.toString().split("\n").filter((l) => !l.startsWith("@check\t")).join("\n")); };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("close", (code) => done({ output, code: code ?? 1 }));
  });

const parseWhat = (args: readonly string[]): { what: What; slug: string; world: string } | string => {
  const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const now = new Date();
  const slug = flag("--slug") ?? `s${now.toISOString().slice(2, 16).replace(/\D/g, "")}`;
  const world = flag("--world") ?? "main";
  const journey = flag("--journey");
  const milestone = flag("--milestone");
  const positional = args.filter((a, i) => a !== "--" && !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  if (journey) return { what: { kind: "journey", id: journey }, slug, world };
  if (milestone) return { what: { kind: "milestone", id: milestone }, slug, world };
  if (positional.length === 1 && positional[0] === "all") return { what: { kind: "all" }, slug, world };
  return positional.length > 0 ? { what: { kind: "evals", ids: positional.flatMap((p) => p.split(",")) }, slug, world } : "say what to run: eval ids, all, --journey <id> or --milestone <id>";
};

const run = async (args: readonly string[]): Promise<number> => {
  const parsed = parseWhat(args);
  if (typeof parsed === "string") { console.error(parsed); return 2; }
  const loaded = await loadAll();
  if (!loaded.ok) { console.error(loaded.errors.join("\n")); return 1; }
  const { book, bindings } = loaded.value;
  const asked = selectEvals(parsed.what, indexOf(book), bindings);
  if (!asked.ok) { console.error(asked.errors.join("\n")); return 1; }
  const known = new Set(book.evals.map((e) => e.id));
  const unknown = asked.value.filter((id) => !known.has(id));
  if (unknown.length > 0) { console.error(`the book derives no eval ${unknown.join(", ")}`); return 1; }

  const at = new Date().toISOString();
  const info: RunInfo = { run: `run-${at.replace(/\D/g, "").slice(0, 14)}`, commit: commitOf(), at: at.replace(/\.\d+Z$/, "Z"), script: "", world: parsed.world, slug: parsed.slug };
  const out = `status/runs/${info.run}`;
  mkdirSync(join(ROOT, out, "evidence"), { recursive: true });

  const lines: CheckLine[] = [];
  const logs: string[] = [];
  const secrets: string[] = [];
  const scripts = [...new Set(loaded.value.files.map((f) => f.script))];
  for (const script of scripts) {
    const files = loaded.value.files.filter((f) => f.script === script);
    if (files.some((f) => !f.worlds.includes(parsed.world))) { console.error(`${script} runs against ${files[0]?.worlds.join(", ")}, not ${parsed.world}`); return 1; }
    const names = files.flatMap((f) => f.bindings).filter((b) => asked.value.includes(b.eval)).flatMap((b) => b.checks);
    if (names.length === 0) continue;
    const behaviours = [...new Set(names.map((n) => /^[A-Z]+[0-9]*/.exec(n)?.[0] ?? n))].sort();
    secrets.push(...files.flatMap((f) => f.secrets.flatMap(secretsIn)));
    console.log(`${script}: company ${parsed.slug}, behaviours ${behaviours.join(", ")} (${names.length} checks bound to the evals asked for)`);
    const result = await runScript(script, [parsed.slug, "--only", behaviours.join(",")]);
    logs.push(`$ ${script} ${parsed.slug} --only ${behaviours.join(",")}   (exit ${result.code})\n${result.output}`);
    const got = parseCheckLines(result.output);
    if (got.malformed.length > 0) console.error(`${got.malformed.length} malformed @check lines were ignored`);
    lines.push(...got.lines);
  }
  const folded = foldChecks(lines);
  const scored = scoreEvals(asked.value, bindings, folded);
  const claimOf = new Map(book.evals.map((e) => [e.id, e.claim]));
  const evidenceOf = (id: string): string => `${out}/evidence/${fileNameOf(id)}.txt`;
  for (const row of scored.rows) {
    const why = bindings.byEval.get(row.id)?.binding.why ?? "no check is bound to this eval";
    writeFileSync(join(ROOT, evidenceOf(row.id)), cap(redact(evidenceText({ ...info, script: bindings.byEval.get(row.id)?.file.script ?? "" }, row, claimOf.get(row.id) ?? "", why), secrets), EVIDENCE_CAP));
  }
  writeFileSync(join(ROOT, out, "checks.tsv"), redact([...lines].map((l) => `${l.name}\t${l.verdict}\t${l.ms}\t${l.detail}`).join("\n") + "\n", secrets));
  writeFileSync(join(ROOT, out, "run.log"), cap(redact(logs.join("\n"), secrets), LOG_CAP));
  const resultsPath = join(ROOT, out, "results.json");
  writeFileSync(resultsPath, `${JSON.stringify(resultsFile(info, scored.rows, evidenceOf), null, 2)}\n`);
  const recorded = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "tools/record-status.ts"), resultsPath], { cwd: ROOT, encoding: "utf8" });
  console.log(`\n${recorded.stdout.trim()}${recorded.stderr.trim()}`);
  const count = (v: string) => scored.rows.filter((r) => r.verdict === v).length;
  console.log(`run ${info.run} at ${info.commit}: ${count("pass")} evals pass, ${count("fail")} fail, ${count("not_run")} not run (no check); ${scored.unfinished.length} bound evals did not finish and stay as they were`);
  for (const r of scored.rows.filter((x) => x.verdict === "fail")) console.log(`  FAIL ${r.id}: ${r.checks.filter((c) => c.verdict === "fail").map((c) => c.name).join(", ")}`);
  for (const u of scored.unfinished) console.log(`  unfinished ${u.id}: did not run ${u.missing.join(", ")}`);
  return recorded.status === 0 && count("fail") === 0 ? 0 : 1;
};

const check = async (): Promise<number> => {
  const loaded = await loadAll();
  if (!loaded.ok) { console.error(loaded.errors.join("\n")); return 1; }
  const problems: string[] = [];
  const status = existsSync(join(ROOT, "status/status.json")) ? parseStatus(json("status/status.json")) : null;
  if (status && !status.ok) problems.push(...status.errors);
  if (status?.ok)
    for (const [id, s] of Object.entries(status.value.evals))
      if (s.verdict !== "not_run" && !loaded.value.bindings.byEval.has(id)) problems.push(`status/status.json: ${id} is ${s.verdict} but no check is bound to it (written by hand, or its binding was removed)`);
  console.log(problems.join("\n"));
  console.log(`evals check: ${loaded.value.bindings.byEval.size} bound evals, ${loaded.value.files.reduce((n, f) => n + f.near.length, 0)} near-misses, ${problems.length} problems`);
  return problems.length === 0 ? 0 : 1;
};

const gaps = async (asJson: boolean): Promise<number> => {
  const loaded = await loadAll();
  if (!loaded.ok) { console.error(loaded.errors.join("\n")); return 1; }
  const index = indexOf(loaded.value.book);
  const wanted = [...new Set(JOURNEYS.flatMap((j) => index.journey(j) ?? []))].sort();
  const g = gapsOf(loaded.value.bindings, loaded.value.scripts, wanted);
  if (asJson) { console.log(JSON.stringify(g, null, 2)); return 0; }
  console.log(`Checks no eval in the book is proved by (${g.checksWithNoEval.length}):\n${g.checksWithNoEval.map((c) => `  ${c}`).join("\n")}`);
  console.log(`\nChecks that prove part of an eval, recorded as near-misses (${g.checksInNearMisses.length}):\n${g.checksInNearMisses.map((c) => `  ${c}`).join("\n")}`);
  console.log(`\nEvals of the skeleton's ${JOURNEYS.length} journeys, with their steps' acceptance, returns, refusals and events, that have no check (${g.evalsWithNoCheck.length} of ${wanted.length}; * marks a near-miss):\n${g.evalsWithNoCheck.map((e) => `  ${e.near ? "*" : " "} ${e.id}`).join("\n")}`);
  return 0;
};

const list = async (): Promise<number> => {
  const loaded = await loadAll();
  if (!loaded.ok) { console.error(loaded.errors.join("\n")); return 1; }
  for (const f of loaded.value.files) for (const b of f.bindings) console.log(`${b.eval}  <-  ${b.checks.join(", ")}   (${f.area})`);
  return 0;
};

const [first, ...rest] = process.argv.slice(2).filter((a) => a !== "--");
process.exitCode = await (first === "check" ? check() : first === "gaps" ? gaps(rest.includes("--json")) : first === "list" ? list() : run(first === "run" ? rest : [first ?? "", ...rest].filter((a) => a !== "")));
