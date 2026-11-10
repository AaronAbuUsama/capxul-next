/**
 * Everything the portal reads from the repository: the blueprint, the status document, the coordinator's plan and its
 * log, the stylesheet and the script. Read-only. `main.ts` hands the result to the modules.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildBlueprint, keyOf, parseStatus, type AnyRecord, type StatusDocument } from "@capxul/blueprint-engine";

import { planFilesOf } from "@capxul/plan";
import { appliedTargets, check as planCheck, parseAnswerLines, parsePlan, waitsOnOwner } from "@capxul/plan";
import type { Facts, LogEntry } from "@capxul/plan";
import { direction } from "#content/direction.ts";
import type { Assets } from "#src/modules/render/types.ts";
import type { FrozenArgument, FrozenCommand, FrozenFlag, PlanInput, SiteInput } from "#src/modules/site/types.ts";

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

type Fields = Readonly<Record<string, unknown>>;
type Fn = (...args: readonly unknown[]) => unknown;
const isFields = (u: unknown): u is Fields => typeof u === "object" && u !== null;
const isFn = (u: unknown): u is Fn => typeof u === "function";
const isRecord = (u: unknown): u is AnyRecord => isFields(u) && typeof u["_kind"] === "string" && typeof u["id"] === "string";
const str = (u: unknown): string => (typeof u === "string" ? u : "");
const orNull = (u: unknown): string | null => (u === null || u === undefined ? null : String(u));
const list = (u: unknown): readonly unknown[] => (Array.isArray(u) ? u : []);
const fields = (u: unknown): readonly Fields[] => list(u).filter(isFields);

/** The repository this package sits in. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PACKAGE = join(ROOT, "packages/portal");

const argumentOf = (a: Fields): FrozenArgument => ({
  name: str(a["name"]), type: str(a["type"]), required: a["required"] === true, variadic: a["variadic"] === true,
  description: str(a["description"]),
});
const flagOf = (f: Fields): FrozenFlag => ({
  flag: str(f["flag"]), alias: orNull(f["alias"]), takesValue: f["takesValue"] === true, type: str(f["type"]),
  metavar: orNull(f["metavar"]), required: f["required"] === true, repeatable: f["repeatable"] === true,
  description: str(f["description"]), default: orNull(f["default"]),
});
/** The old CLI's command blueprint, by operation id. A command the old CLI never shipped has no arguments and no flags. */
const frozenOf = (flagBaseline: unknown): ReadonlyMap<string, FrozenCommand> =>
  new Map(Object.entries(isFields(flagBaseline) && isFields(flagBaseline["commands"]) ? flagBaseline["commands"] : {}).flatMap(([id, c]) =>
    isFields(c)
      ? [[id, {
        command: str(c["command"]), inCli: c["inCli"] === true,
        arguments: fields(c["arguments"]).map(argumentOf), flags: fields(c["flags"]).map(flagOf),
      }] as const]
      : []));

/** The commit the blueprint is read at, or "unknown" outside a git checkout. */
const commitOf = (root: string): string => {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
};

/**
 * Everything the site is built from, read from the repository at `root`: the blueprint, which concept exports each
 * record, the one waiting predicate, and the frozen CLI for reference. The blueprint and its baseline are imported at run time, read-only.
 */
export const load = async (root: string, commit: string = commitOf(root)): Promise<Result<SiteInput>> => {
  const open = async (path: string): Promise<Fields> => {
    const loaded: unknown = await import(pathToFileURL(join(root, path)).href);
    return isFields(loaded) ? loaded : {};
  };
  try {
    const target = await open("blueprint/index.ts");
    const recordsOf = (await open("blueprint/shared/index.ts"))["recordsOf"];
    const forAaron = (await open("blueprint/shared/waiting.ts"))["forAaron"];
    const concepts = list((await open("blueprint/shared/foundation.ts"))["CONCEPTS"]).filter(isRecord).map((c) => c.id);
    const frozen = (await open("blueprint/baseline/operations.ts"))["frozen"];
    const flagBaseline = (await open("blueprint/baseline/flags.ts"))["frozenFlagBook"];
    if (!isFn(recordsOf) || !isFn(forAaron) || !isFields(frozen) || !Array.isArray(target["records"])) {
      return { ok: false, error: `the blueprint under ${root} does not export what the portal reads` };
    }
    const conceptOf = new Map<string, string>();
    for (const id of concepts) {
      const modules = (await open(`blueprint/${id}/index.ts`))["modules"];
      for (const r of list(recordsOf(list(modules)))) if (isRecord(r)) conceptOf.set(keyOf(r), id);
      // the pay agreements live in payments/agreements since the cut (cut.agreements-in-payments)
      if (id === "payments") {
        const agreements = (await open("blueprint/payments/agreements/index.ts"))["modules"];
        for (const r of list(recordsOf(list(agreements)))) if (isRecord(r)) conceptOf.set(keyOf(r), id);
      }
    }
    const blueprint = buildBlueprint({ name: str(target["name"]), stage: target["stage"] === "as-is" ? "as-is" : "target", records: target["records"] });
    const status = statusOf(root);
    if (!status.ok) return status;
    const plan = planOf(root, blueprint, concepts, (d) => forAaron(d) === true);
    if (!plan.ok) return plan;
    const worlds = await worldsOf(root, open);
    return {
      ok: true,
      value: {
        blueprint, commit, concepts, conceptOf, direction, status: status.value, plan: plan.value,
        waits: (decision) => forAaron(decision) === true,
        frozen: frozenOf(flagBaseline), frozenOperations: new Set(Object.keys(frozen)), worlds,
      },
    };
  } catch (cause) {
    return { ok: false, error: `the blueprint could not be loaded: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
};

/**
 * The worlds design: the readable document and the ids of the records that are the design, which the blueprint lists in
 * `blueprint/devnet/platform-index.ts`. Null when either is absent (the Worlds page and its nav entry then do not exist).
 */
const worldsOf = async (root: string, open: (path: string) => Promise<Fields>): Promise<SiteInput["worlds"]> => {
  const index = existsSync(join(root, "blueprint/devnet/platform-index.ts")) ? (await open("blueprint/devnet/platform-index.ts"))["WORLDS_PAGE"] : null;
  if (!isFields(index)) return null;
  const document = str(index["document"]);
  const file = join(root, document);
  if (document === "" || !existsSync(file)) return null;
  const ids = (u: unknown): readonly string[] => list(u).map(str);
  return { document, text: readFileSync(file, "utf8"), operations: ids(index["operations"]), journeys: ids(index["journeys"]), decisions: ids(index["decisions"]), tables: ids(index["tables"]) };
};

/** The status document at `status/status.json`: null when the file is absent, which means nothing has run; an error when it is not one. */
const statusOf = (root: string): Result<StatusDocument | null> => {
  const file = join(root, "status/status.json");
  if (!existsSync(file)) return { ok: true, value: null };
  try {
    const parsed = parseStatus(JSON.parse(readFileSync(file, "utf8")) as unknown);
    return parsed.ok ? { ok: true, value: parsed.value } : { ok: false, error: `status/status.json: ${parsed.errors.join("; ")}` };
  } catch (cause) {
    return { ok: false, error: `status/status.json: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
};

/**
 * The coordinator's plan at `plan/plan.json`, its files, its log, and what `plan check` says of it: null when the file is
 * absent; an error when it is not a plan. The log is read here, so the site module stays free of the file system.
 */
const planOf = (root: string, blueprint: ReturnType<typeof buildBlueprint>, concepts: readonly string[], waits: (d: AnyRecord) => boolean): Result<PlanInput | null> => {
  const file = join(root, "plan/plan.json");
  if (!existsSync(file)) return { ok: true, value: null };
  try {
    const parsed = parsePlan(JSON.parse(readFileSync(file, "utf8")) as unknown);
    if (!parsed.ok) return { ok: false, error: `plan/plan.json: ${parsed.error}` };
    const logFile = join(root, "plan/log.jsonl");
    const lines = existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").filter((l) => l.trim() !== "") : [];
    const everything = lines.map((l) => JSON.parse(l) as LogEntry);
    const files = planFilesOf(root);
    const facts: Facts = {
      decisions: new Set([...blueprint.records.values()].filter((r) => r._kind === "decision").map((r) => r.id)),
      records: new Set(blueprint.records.keys()), evals: new Set(blueprint.evals.map((e) => e.id)), concepts: new Set(concepts),
      waiting: new Set([...blueprint.records.values()].filter((r) => r._kind === "decision" && waits(r)).map((r) => r.id)), applied: appliedTargets(everything, parseAnswerLines(existsSync(join(root, "plan/answers.jsonl")) ? readFileSync(join(root, "plan/answers.jsonl"), "utf8") : "")),
    };
    return { ok: true, value: { plan: parsed.value, files, log: everything, problems: planCheck(parsed.value, facts, files) } };
  } catch (cause) {
    return { ok: false, error: `plan/plan.json: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
};

/** The stylesheet, its parts joined in name order, and the one script. */
export const assetsOf = (packageDir: string = PACKAGE): Assets => {
  const css = join(packageDir, "assets/css");
  return {
    css: readdirSync(css).filter((f) => f.endsWith(".css")).sort().map((f) => readFileSync(join(css, f), "utf8")).join("\n"),
    js: readFileSync(join(packageDir, "assets/site.js"), "utf8"),
  };
};


/** The ids of the tasks blocked on a need whose owner is the reviewer: what the Questions page holds beyond the waiting decisions. */
export const ownerNeedsOf = (input: SiteInput): readonly string[] =>
  (input.plan?.plan.tasks ?? []).filter((t) => waitsOnOwner(t, input.direction.settings.reviewer, () => false)).map((t) => t.id);

/** The page ids of the plan's tasks and milestones. */
export const planPagesOf = (input: SiteInput): readonly string[] => [
  ...(input.plan?.plan.milestones ?? []).map((m) => `plan/milestone/${m.id}`), ...(input.plan?.plan.tasks ?? []).map((t) => `plan/task/${t.id}`),
];
