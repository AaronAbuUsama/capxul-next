// Run I/O: save intent before children; distinguish completed assertions from incomplete script plans.
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { mergeResults, parseRunReceipt, type Blueprint, type RunEnvironment, type RunReceipt } from "@capxul/blueprint-engine";
import type { Bindings } from "./modules/bindings/service.ts";
import { cap, evidenceText, fileNameOf, foldChecks, parseCheckLines, redact, resultsFile, scoreEvals, type CheckLine, type Row, type RunInfo } from "./modules/runs/service.ts";

const atomicJson = (path: string, value: unknown): void => {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
};

const runProcess = (root: string, dir: string, argv: readonly string[], json: boolean): Promise<{ output: string; exitCode: number | null; signal: string | null }> =>
  new Promise((done) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd: root, env: { ...process.env, CAPXUL_EVAL_RUN_DIR: dir }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const take = (chunk: Buffer): void => { output += chunk.toString(); (json ? process.stderr : process.stdout).write(chunk); };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => { output += `\n${error.message}\n`; });
    child.on("close", (exitCode, signal) => done({ output, exitCode, signal }));
  });

export const executeRun = async (root: string, blueprint: Blueprint, bindings: Bindings, asked: readonly string[],
  options: { world: string; slug: string; environment?: string; screens?: string; prepare?: string; json?: boolean }, commit: string, secrets: readonly string[]): Promise<number> => {
  const log = (...args: string[]): void => { (options.json ? console.error : console.log)(...args); };
  const at = new Date().toISOString();
  const info: RunInfo = { run: `run-${at.replace(/\D/g, "")}-${randomUUID().slice(0, 8)}`, commit, at, script: "", world: options.world, slug: options.slug };
  const out = `status/runs/${info.run}`;
  const dir = join(root, out);
  const environment: RunEnvironment = options.environment
    ? JSON.parse(readFileSync(resolve(root, options.environment), "utf8")) as RunEnvironment
    : { world: options.world, storage: "json", indexer: "inline", stack: "skeleton-json", components: { core: commit } };
  if (environment.world !== options.world) throw new Error("environment world differs from --world");
  const plans = [...new Set(asked.flatMap((id) => bindings.byEval.get(id)?.file.script ?? []))].map((script) => {
    const files = bindings.files.filter((f) => f.script === script && f.bindings.some((b) => asked.includes(b.eval)));
    const skip = files.some((f) => !f.worlds.includes(options.world)) ? `does not support world ${options.world}`
      : script === "spikes/skeleton/run.sh" && (environment.storage !== "json" || environment.indexer !== "inline" || environment.stack !== "skeleton-json")
        ? "the JSON skeleton cannot supply selected-stack evidence" : undefined;
    const bound = files.flatMap((f) => f.bindings).filter((b) => asked.includes(b.eval));
    const names = bound.flatMap((b) => b.checks);
    return { script, evals: bound.map((b) => b.eval), behaviours: [...new Set(names.map((n) => /^[A-Z]+[0-9]*/.exec(n)?.[0] ?? n))].sort(), skip };
  });
  const contracts = blueprint.evals.filter((e) => asked.includes(e.id)).map(({ id, claim, observes }) => ({ id, claim, ...(observes === undefined ? {} : { observes }) }));
  const prepare: RunReceipt["prepare"] = options.prepare ? {
    argv: JSON.parse(readFileSync(resolve(root, options.prepare), "utf8")) as string[], exitCode: null, signal: null, log: "prepare.log",
  } : undefined;
  let receipt: RunReceipt = { version: 1, id: info.run, state: "running", commit, at, environment, requested: asked,
    evals: contracts, scripts: plans.map(({ script, evals }) => ({ script, evals, completed: false, exitCode: null, signal: null })), ...(prepare ? { prepare } : {}), screens: [] };
  const parsed = parseRunReceipt(receipt);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  mkdirSync(join(dir, "evidence"), { recursive: true });
  const evidenceOf = (id: string): string => `${out}/evidence/${fileNameOf(id)}.txt`;
  const save = (rows: readonly Row[]): boolean => {
    const results = resultsFile(info, rows, evidenceOf, receipt);
    const snapshot = mergeResults(blueprint, null, results);
    if (!snapshot.ok) throw new Error(snapshot.errors.join("\n"));
    atomicJson(join(dir, "status.json"), snapshot.value);
    atomicJson(join(dir, "results.json"), results);
    // Publish the complete receipt last: readers cannot see complete before its status snapshot exists.
    atomicJson(join(dir, "receipt.json"), receipt);
    const recorded = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(root, "packages/evals/src/record-status.ts"), join(dir, "results.json"), "--status", join(root, "status/status.json")], { cwd: root, encoding: "utf8" });
    log(recorded.stdout.trim(), recorded.stderr.trim());
    return recorded.status === 0;
  };
  const finish = (rows: readonly Row[], recorded: boolean): number => {
    const count = (v: string) => rows.filter((r) => r.verdict === v).length;
    const counts = { pass: count("pass"), fail: count("fail"), not_run: count("not_run") };
    const passed = recorded && receipt.state === "complete" && asked.length > 0 && counts.pass === asked.length;
    const exitCode = passed ? 0 : 1;
    if (options.json) console.log(JSON.stringify({ version: 1, run: info.run, runDir: out, state: receipt.state, passed, counts, exitCode }));
    else log(`run ${info.run}: ${receipt.state}; ${counts.pass} pass, ${counts.fail} fail, ${counts.not_run} not_run`);
    return exitCode;
  };
  const pending = asked.map((id) => ({ id, verdict: "not_run" as const, checks: [] }));
  if (!save(pending)) return finish(pending, false);
  const lines: CheckLine[] = [];
  const byScript = new Map<string, readonly CheckLine[]>();
  const logs: string[] = [];
  let aborted = false;
  try {
    if (prepare) {
      log(`prepare: ${JSON.stringify(prepare.argv)}`);
      const result = await runProcess(root, dir, prepare.argv, options.json ?? false);
      logs.push(`$ prepare (exit ${result.exitCode}, signal ${result.signal})\n${result.output}`);
      writeFileSync(join(dir, prepare.log), cap(redact(result.output, secrets), 400_000));
      receipt = { ...receipt, prepare: { ...prepare, exitCode: result.exitCode, signal: result.signal } };
      atomicJson(join(dir, "receipt.json"), receipt);
      if (result.exitCode !== 0 || result.signal !== null) throw new Error("preparation did not finish successfully; binding scripts were not started");
    }
    for (const plan of plans) {
      if (plan.skip) {
        const reason = `${plan.script} skipped: ${plan.skip}`;
        log(reason);
        logs.push(reason);
        continue;
      }
      log(`${plan.script}: company ${options.slug}, behaviours ${plan.behaviours.join(", ")}`);
      const result = await runProcess(root, dir, ["bash", join(root, plan.script), options.slug, "--only", plan.behaviours.join(",")], options.json ?? false);
      logs.push(`$ ${plan.script} (exit ${result.exitCode}, signal ${result.signal})\n${result.output}`);
      const got = parseCheckLines(result.output);
      lines.push(...got.lines);
      byScript.set(plan.script, got.lines);
      const scored = scoreEvals(plan.evals, bindings, foldChecks(got.lines));
      const completed = got.malformed.length === 0 && scored.unfinished.length === 0 && result.signal === null &&
        (result.exitCode === 0 || (result.exitCode === 1 && scored.rows.some((r) => r.verdict === "fail")));
      if (!completed) logs.push(`${plan.script}: incomplete; malformed ${got.malformed.length}; missing ${JSON.stringify(scored.unfinished)}`);
      receipt = { ...receipt, scripts: receipt.scripts.map((s) => s.script === plan.script ? { ...s, exitCode: result.exitCode, signal: result.signal, completed } : s) };
      atomicJson(join(dir, "receipt.json"), receipt);
    }
    // In-run manifests: <run>/screens.json and one <module>/screens.json per module directory, every path run-relative,
    // so modules never overwrite each other's captures. --screens imports one external manifest relative to its own file.
    const manifests = options.screens ? [{ file: resolve(root, options.screens), base: dirname(resolve(root, options.screens)) }]
      : [join(dir, "screens.json"), ...readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(dir, d.name, "screens.json")).sort()]
        .filter((file) => existsSync(file)).map((file) => ({ file, base: dir }));
    const screens: RunReceipt["screens"][number][] = [];
    for (const { file, base } of manifests) {
      const validated = parseRunReceipt({ ...receipt, screens: JSON.parse(readFileSync(file, "utf8")) as unknown });
      if (!validated.ok) throw new Error(`${file}: ${validated.errors.join("\n")}`);
      for (const screen of validated.value.screens) {
        if (screens.some((s) => s.path === screen.path)) throw new Error(`screen evidence listed twice: ${screen.path}`);
        const target = join(dir, screen.path);
        const source = resolve(base, screen.path);
        if (!existsSync(source)) throw new Error(`screen evidence missing: ${screen.path}`);
        if (source !== target) { mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target); }
        screens.push(screen);
      }
    }
    receipt = { ...receipt, screens };
  } catch (error) {
    aborted = true;
    receipt = { ...receipt, scripts: receipt.scripts.map((s) => ({ ...s, completed: false })) };
    logs.push(String(error));
    console.error(error);
  }
  // A script can only prove its own bindings, even if another script prints the same check name.
  const scored = asked.flatMap((id) => scoreEvals([id], bindings, foldChecks(byScript.get(bindings.byEval.get(id)?.file.script ?? "") ?? [])).rows);
  const complete = !aborted && scored.every((r) => r.verdict !== "not_run") && receipt.scripts.every((s) => s.completed) &&
    (!receipt.prepare || (receipt.prepare.exitCode === 0 && receipt.prepare.signal === null));
  receipt = { ...receipt, state: complete ? "complete" : "incomplete", finishedAt: new Date().toISOString() };
  const rows = scored.map((r) => r.verdict === "pass" && !receipt.scripts.some((s) => s.completed && s.evals?.includes(r.id))
    ? { ...r, verdict: "not_run" as const } : r);
  const claimOf = new Map(contracts.map((e) => [e.id, e.claim]));
  for (const row of rows) {
    const bound = bindings.byEval.get(row.id);
    const skip = plans.find((p) => p.script === bound?.file.script)?.skip;
    const script = receipt.scripts.find((s) => s.script === bound?.file.script);
    const why = `${bound?.binding.why ?? "no binding"}${skip ? `\nskipped: ${skip}` : script && !script.completed ? `\nincomplete plan: exit ${script.exitCode}, signal ${script.signal}; see run.log` : ""}`;
    writeFileSync(join(root, evidenceOf(row.id)), cap(redact(evidenceText({ ...info, script: bound?.file.script ?? "" }, row, claimOf.get(row.id) ?? "", why), secrets), 60_000));
  }
  writeFileSync(join(dir, "checks.tsv"), redact(lines.map((l) => `${l.name}\t${l.verdict}\t${l.ms}\t${l.detail}`).join("\n") + "\n", secrets));
  writeFileSync(join(dir, "run.log"), cap(redact(logs.join("\n"), secrets), 400_000));
  const recorded = save(rows);
  return finish(rows, recorded);
};
