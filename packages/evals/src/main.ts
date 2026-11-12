/**
 * The evals runner's process entry and composition root: the only file here that reads the arguments, the repository, the
 * clock, the environment and the child processes, prints, or exits.
 *
 *   pnpm evals -- <eval ids | all | --journey <id> | --milestone <id>> [--slug <company>] [--world main]
 *   pnpm evals -- check | gaps [--json] | list
 *
 * A run starts each bound script for the behaviours its checks sit in, reads the `@check` lines it prints, scores the evals
 * asked for, keeps the evidence under status/runs/<run>/ and merges the verdicts into status/status.json through
 * packages/evals/src/record-status.ts, which is the only thing that writes that file.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseStatus, type Blueprint } from "@capxul/blueprint-engine";

import { loadTarget } from "../../blueprint-engine/scripts/target.ts";
import { claims } from "./claims.ts";
import { executeRun } from "./execute.ts";
import { migrateIds } from "./migrate-ids.ts";
import { gapsOf, loadBindings, parseBindingFile, parseScriptList, selectEvals, type BindingFile, type Bindings, type Index, type ScriptChecks, type What } from "./modules/bindings/service.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const JOURNEYS = ["create_company_site", "grant_hat_in_frappe", "pay_invoice_from_frappe", "stays_true_when_broken", "run_a_world"];

type Loaded = { readonly blueprint: Blueprint; readonly files: readonly BindingFile[]; readonly scripts: ReadonlyMap<string, ScriptChecks>; readonly bindings: Bindings };
type Raw = Record<string, unknown>;

const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const json = (path: string): unknown => JSON.parse(read(path)) as unknown;

/** The blueprint, the binding files and the scripts' lists of checks, validated against each other. */
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
  const loaded = loadBindings(files, { evals: new Set(target.blueprint.evals.map((e) => e.id)), scripts });
  if (!loaded.ok) errors.push(...loaded.errors);
  return errors.length > 0 || !loaded.ok ? { ok: false, errors } : { ok: true, value: { blueprint: target.blueprint, files, scripts, bindings: loaded.value } };
};

/** The journey's claims, its operations' promises, and every screen where a step's result is seen. */
const indexOf = (blueprint: Blueprint): Index => ({
  journey: (id) => {
    const journey = blueprint.records.get(`journey:${id}`) as { steps?: readonly { operation: { id: string }; seen?: { id: string } }[] } | undefined;
    if (!journey) return null;
    const ops = new Set((journey.steps ?? []).map((s) => `operation:${s.operation.id}`));
    const screens = new Set((journey.steps ?? []).flatMap((s) => s.seen ? [`screen:${s.seen.id}`] : []));
    return blueprint.evals.filter((e) => e.subject === `journey:${id}` || screens.has(e.subject) || (ops.has(e.subject) && /^(acc|ret|ref|evt):/.test(e.id))).map((e) => e.id);
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
  const dirty = git("status", "--porcelain", "--untracked-files=normal", "--", ".", ":(exclude)status") !== "";
  return `${git("rev-parse", "HEAD") || "unknown"}${dirty ? "+dirty" : ""}`;
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

const parseWhat = (args: readonly string[]): { what: What; slug: string; world: string } | string => {
  const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const now = new Date();
  const slug = flag("--slug") ?? `s${now.toISOString().slice(2, 16).replace(/\D/g, "")}`;
  const world = flag("--world") ?? "main";
  const journey = flag("--journey");
  const milestone = flag("--milestone");
  const valued = new Set(["--slug", "--world", "--journey", "--milestone", "--environment", "--screens"]);
  const positional = args.filter((a, i) => a !== "--" && !a.startsWith("--") && !valued.has(args[i - 1] ?? ""));
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
  const { blueprint, bindings } = loaded.value;
  const asked = selectEvals(parsed.what, indexOf(blueprint), bindings);
  if (!asked.ok) { console.error(asked.errors.join("\n")); return 1; }
  const known = new Set(blueprint.evals.map((e) => e.id));
  const unknown = asked.value.filter((id) => !known.has(id));
  if (unknown.length > 0) { console.error(`the blueprint derives no eval ${unknown.join(", ")}`); return 1; }

  const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const environment = flag("--environment"), screens = flag("--screens");
  const secrets = loaded.value.files.flatMap((f) => f.secrets.flatMap(secretsIn));
  return executeRun(ROOT, blueprint, bindings, asked.value, { world: parsed.world, slug: parsed.slug,
    ...(environment ? { environment } : {}), ...(screens ? { screens } : {}), json: args.includes("--json") }, commitOf(), secrets);
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
  const index = indexOf(loaded.value.blueprint);
  const wanted = [...new Set(JOURNEYS.flatMap((j) => index.journey(j) ?? []))].sort();
  const g = gapsOf(loaded.value.bindings, loaded.value.scripts, wanted);
  if (asJson) { console.log(JSON.stringify(g, null, 2)); return 0; }
  console.log(`Checks no eval in the blueprint is proved by (${g.checksWithNoEval.length}):\n${g.checksWithNoEval.map((c) => `  ${c}`).join("\n")}`);
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
process.exitCode = await (first === "migrate-ids" ? migrateIds(rest[0] ?? "") : first === "claims" ? claims() : first === "check" ? check() : first === "gaps" ? gaps(rest.includes("--json")) : first === "list" ? list() : run(first === "run" ? rest : [first ?? "", ...rest].filter((a) => a !== "")));
