// node --experimental-strip-types --no-warnings packages/loop/src/main.ts <command>      (also: pnpm loop <command>)
//
// The loop: durable agents (pi-durable) driven by scripts a person can read (loops/*.ts). This file is the composition
// root: the only place that reads the process, prints, or exits. See packages/loop/README.md.

import { execFileSync } from "node:child_process";
import { clean, DEFAULTS, logs, merge, resume, showJson, start, status, statusJson, stop, watch, work, type Ctx, type Opts } from "./index.ts";

const USAGE = [
  "usage: loop run <task id> [--script pair] [--model provider/id] [--checker-model provider/id] [--sandbox none|light|heavy]",
  "                          [--rounds 3] [--budget-usd 5] [--timeout-min 30] [--checkers reviewer,adversary]",
  "       loop resume <run id> | stop <run id> | merge <run id> | clean [<run id>]",
  "       loop work [--concurrency 2] [--task a,b] [--wait]   (the options of run apply to every run it starts)",
  "       loop status [--json [--since-hours 24]] | show <run id> --json | logs <run id> [-f] | watch <run id>",
].join("\n");

const parse = (argv: readonly string[]): { words: string[]; f: Map<string, string> } => {
  const words: string[] = [], f = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-f" || a === "--wait" || a === "--json") f.set(a.replace(/^-+/, ""), "true");
    else if (a.startsWith("--")) f.set(a.slice(2), argv[++i] ?? "");
    else words.push(a);
  }
  return { words, f };
};

const optsOf = (f: Map<string, string>): Opts => {
  const sandbox = f.get("sandbox") ?? DEFAULTS.sandbox;
  if (!["none", "light", "heavy"].includes(sandbox)) throw new Error("--sandbox is one of none, light, heavy");
  return {
    script: f.get("script") ?? DEFAULTS.script, sandbox: sandbox as Opts["sandbox"], rounds: Number(f.get("rounds") ?? DEFAULTS.rounds),
    budgetUsd: Number(f.get("budget-usd") ?? DEFAULTS.budgetUsd), timeoutMin: Number(f.get("timeout-min") ?? DEFAULTS.timeoutMin),
    ...(f.get("model") ? { model: f.get("model")! } : {}), ...(f.get("checker-model") ? { checkerModel: f.get("checker-model")! } : {}),
    ...(f.get("checkers") ? { checkers: f.get("checkers")!.split(",") } : {}),
  };
};

const main = async (argv: readonly string[]): Promise<number> => {
  const [cmd, ...rest] = argv;
  const { words, f } = parse(rest);
  const ctx: Ctx = { root: execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(), env: process.env, now: () => new Date(), say: (l) => console.log(l) };
  const ended = (s: { id: string; status: string; round: number; spentUsd: number; tokens: number; reasons: string[]; error?: string }): number => {
    console.log(`run ${s.id}: ${s.status}, ${s.round} round(s), spend $${s.spentUsd.toFixed(2)} (${s.tokens} tokens)${s.error ? `, error: ${s.error}` : ""}`);
    s.reasons.forEach((r) => console.log(`  ${r.slice(0, 300)}`));
    return ["ready", "answered", "merged"].includes(s.status) ? 0 : 1;
  };
  const need = words[0];
  switch (cmd) {
    case "run": return need ? ended(await start(ctx, need, optsOf(f))) : (console.error(USAGE), 2);
    case "resume": return need ? ended(await resume(ctx, need)) : (console.error(USAGE), 2);
    case "stop": console.log(stop(ctx, need ?? "")); return 0;
    case "merge": { const out = await merge(ctx, need ?? ""); out.forEach((l) => console.log(l)); return out[0]!.startsWith("merged") && !out[0]!.includes("push failed") ? 0 : 1; }
    case "clean": clean(ctx, need).forEach((l) => console.log(l)); return 0;
    case "status":
      if (!f.has("json")) { console.log(status(ctx)); return 0; }
      console.log(JSON.stringify({ runs: await statusJson(ctx, Number(f.get("since-hours") || 24)) }));
      return 0;
    case "show": {
      if (!need || !f.has("json")) return (console.error(USAGE), 2);
      const view = await showJson(ctx, need);
      console.log(JSON.stringify(view));
      return view === null ? 1 : 0;
    }
    case "logs": return need ? (await logs(ctx, need, f.has("f")), 0) : (console.error(USAGE), 2);
    case "watch": return need ? (await watch(ctx, need), 0) : (console.error(USAGE), 2);
    case "work": await work(ctx, { concurrency: Number(f.get("concurrency") ?? 2), tasks: f.get("task")?.split(",") ?? [], opts: optsOf(f), wait: f.has("wait") }); return 0;
    default: console.error(USAGE); return 2;
  }
};

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
