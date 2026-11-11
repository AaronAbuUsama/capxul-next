// node --experimental-strip-types --no-warnings packages/loop/src/main.ts <command>      (also: pnpm loop <command>)
//
// The loop: durable agents (pi-durable) driven by scripts a person can read (loops/*.ts). This file is the composition
// root: the only place that reads the process, prints, or exits. See packages/loop/README.md.

import { execFileSync } from "node:child_process";
import { launcherFrom } from "@capxul/sandbox/box";
import { join } from "node:path";
import { reconcile, type Alert } from "./modules/alerts/service.ts";
import { alertRuns, closedAt, questionsAt } from "./modules/alerts/inputs.ts";
import { clean, DEFAULTS, loadDefinitions, logs, merge, resume, serve, showFull, showJson, spendText, start, status, statusJson, stop, watch, watchAll, work, type Ctx, type Opts } from "./index.ts";

const USAGE = [
  "       loop alerts [--once] (preview once, or reconcile notifications every 30 seconds)",
  "       loop agents [--json] (definitions in packages/loop/agents/)",
  "usage: loop run <task id> [--script pair] [--model provider/id] [--checker-model provider/id] [--sandbox cloud(default when set up)|none|light|heavy]",
  "                          [--rounds 3] [--budget-usd 5] [--timeout-min 30] [--checkers reviewer,adversary]",
  "       loop resume <run id> | stop <run id> | merge <run id> | clean [<run id>]",
  "       loop work [--concurrency 2] [--task a,b] [--wait]   (the options of run apply to every run it starts)",
  "       loop serve [--port 4392] [--since-hours 24]   (the host: runs as they change, for a page or a terminal)",
  "       loop status [--json [--since-hours 24]] | show <run id> --json [--full] | logs <run id> [-f] | watch <run id> | watch [--until-idle]",
].join("\n");

const parse = (argv: readonly string[]): { words: string[]; f: Map<string, string> } => {
  const words: string[] = [], f = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-f" || a === "--wait" || a === "--json" || a === "--full" || a === "--once" || a === "--until-idle") f.set(a.replace(/^-+/, ""), "true");
    else if (a.startsWith("--")) f.set(a.slice(2), argv[++i] ?? "");
    else words.push(a);
  }
  return { words, f };
};

/** `cloud` once a sandbox is set up (var/sandbox/box.json, or SANDBOX), so runs never fail for one that is not yet deployed. */
const optsOf = (f: Map<string, string>, cloudReady = false): Opts => {
  const sandbox = f.get("sandbox") ?? (cloudReady ? "cloud" : DEFAULTS.sandbox);
  if (!["none", "light", "heavy", "cloud"].includes(sandbox)) throw new Error("--sandbox is one of cloud, none, light, heavy");
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
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(), defined = await loadDefinitions(root);
  const ctx: Ctx = { root, env: process.env, now: () => new Date(), say: (l) => console.log(l), agents: defined.agents };
  // A definition that is not sound stops whatever would start an agent, before a run is made; looking at runs goes on.
  if (defined.problems.length > 0 && ["run", "resume", "work", "agents"].includes(cmd ?? "")) { defined.problems.forEach((p) => console.error(p)); return 1; }
  const ended = (s: { id: string; status: string; round: number; spentUsd: number; tokens: number; reasons: string[]; error?: string }): number => {
    console.log(`run ${s.id}: ${s.status}, ${s.round} round(s), used ${spendText(s.spentUsd, s.tokens)}${s.error ? `, error: ${s.error}` : ""}`);
    s.reasons.forEach((r) => console.log(`  ${r.slice(0, 300)}`));
    return ["ready", "answered", "merged"].includes(s.status) ? 0 : 1;
  };
  const need = words[0];
  switch (cmd) {
    case "alerts": {
      const sender = async (alert: Alert): Promise<void> => {
        // argv, not interpolated AppleScript: question text cannot become a command.
        execFileSync("osascript", ["-e", 'on run argv\ndisplay notification ((item 2 of argv) & " " & (item 3 of argv)) with title (item 1 of argv)\nend run', alert.title, alert.body, alert.url]);
      };
      do {
        try {
          const alerts = await reconcile({ file: join(root, "var/alerts.json"), now: ctx.now, sender }, {
            questions: await questionsAt(root), runs: alertRuns(await statusJson(ctx, Infinity), closedAt(root)),
          }, f.has("once"));
          if (f.has("once")) {
            console.log(JSON.stringify({ wouldSend: alerts }, null, 2));
            return 0;
          }
        } catch (error) {
          if (f.has("once")) throw error;
          console.error(error instanceof Error ? error.message : String(error));
        }
        await new Promise((r) => setTimeout(r, 30_000));   // each poll loads the blueprint in a fresh process: every 30 s, not every 2
      } while (true);
    }
    case "run": return need ? ended(await start(ctx, need, optsOf(f, typeof launcherFrom(process.env, root) !== "string"))) : (console.error(USAGE), 2);
    case "resume": return need ? ended(await resume(ctx, need)) : (console.error(USAGE), 2);
    case "stop": console.log(stop(ctx, need ?? "")); return 0;
    case "merge": { const out = await merge(ctx, need ?? ""); out.forEach((l) => console.log(l)); return out[0]!.startsWith("merged") && !out[0]!.includes("push failed") ? 0 : 1; }
    case "clean": clean(ctx, need).forEach((l) => console.log(l)); return 0;
    case "status":
      if (!f.has("json")) { console.log(await status(ctx, Number(f.get("since-hours") || 24))); return 0; }
      console.log(JSON.stringify({ runs: await statusJson(ctx, Number(f.get("since-hours") || 24)) }));
      return 0;
    case "show": {
      if (!need || !f.has("json")) return (console.error(USAGE), 2);
      const view = f.has("full") ? await showFull(ctx, need) : await showJson(ctx, need);
      console.log(JSON.stringify(view));
      return view === null ? 1 : 0;
    }
    case "serve": {
      const served = await serve(ctx, { port: Number(f.get("port") ?? 4392), ...(f.get("since-hours") ? { sinceHours: Number(f.get("since-hours")) } : {}) });
      console.log(`the host is up, on this machine only. Open ${served.http} in a browser; a client attaches at ${served.url}. Ctrl-C ends it.`);
      await new Promise(() => undefined);
      return 0;
    }
    case "agents": console.log(f.has("json") ? JSON.stringify({ agents: ctx.agents }) : ctx.agents.map((a) => `${a.name.padEnd(12)}${a.model.padEnd(16)}${a.tools.join(" ")}`).join("\n")); return 0;
    case "logs": return need ? (await logs(ctx, need, f.has("f")), 0) : (console.error(USAGE), 2);
    case "watch":
      if (need && f.has("until-idle")) { console.error("--until-idle requires watch without a run id (idle means no running runs)"); return 2; }
      return need ? (await watch(ctx, need), 0) : (await watchAll(ctx, { untilIdle: f.has("until-idle") }), 0);
    case "work": await work(ctx, { concurrency: Number(f.get("concurrency") ?? 2), tasks: f.get("task")?.split(",") ?? [], opts: optsOf(f, typeof launcherFrom(process.env, root) !== "string"), wait: f.has("wait") }); return 0;
    default: console.error(USAGE); return 2;
  }
};

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
