// Exports real runs as one JSON file for the Runs app's prototype: read-only, scrubbed, long output capped.
// A prototype's tool, not part of the app: the real app will get runs from the loop's host.
// node --experimental-strip-types --no-warnings packages/loop-ui/tools/export-fixtures.ts <runs dir> packages/loop-ui/src/fixtures/runs.json <run id>...
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { openHost, modelsFrom, POLICY, entriesOf } from "../../loop/src/index.ts";
import { secretsOf } from "../../loop/src/modules/inspect/internal/scrub.ts";

const [runsDir, outFile, ...ids] = process.argv.slice(2);
const secrets = secretsOf(process.env);
const SHAPES = [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, /\b(?:ghp|gho|ghu|ghs|github_pat|glpat|xox[abprs])[-_A-Za-z0-9]{16,}/g, /\bAKIA[0-9A-Z]{12,}/g, /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi];
const clean = (text: string, cap: number, lane: string): string => {
  let t = lane ? text.split(`${lane}/`).join("").split(lane).join(".") : text;
  t = t.replace(/\/Users\/[A-Za-z0-9_.-]+\/[^\s"']*?(var\/runs|runs)\/[^\s"'/]+\/lane\/?/g, "");
  for (const secret of secrets) t = t.split(secret).join("[hidden]");
  for (const shape of SHAPES) t = t.replace(shape, "[hidden]");            // the loop's own scrub also hides long paths; this one keeps them
  return t.length <= cap ? t : `${t.slice(0, cap)}\n… ${t.length - cap} more characters`;
};
const textOf = (content: unknown): string => typeof content === "string" ? content : Array.isArray(content) ? (content as { type: string; text?: string }[]).map((p) => p.text ?? "").join("") : "";
const roleOf = (key: string): string => /^make/.test(key) ? "builder" : /^research/.test(key) ? "researcher" : key.split(".")[0]!;
/** What a builder's commit changed: its subject, the files, and the start of the diff. Read from the repository the runs belong to. */
const changesOf = (commit: string): { commit: string; subject: string; stat: string; diff: string } | null => {
  const git = (...args: string[]): string => spawnSync("git", args, { cwd: `${runsDir}/../..`, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout ?? "";
  const subject = git("show", "-s", "--format=%s", commit).trim();
  if (!/^(lane\/|loop: )/.test(subject)) return null;                       // not this run's commit: the builder changed nothing
  const diff = git("show", "--format=", "--no-color", commit);
  return { commit: commit.slice(0, 7), subject, stat: git("show", "--format=", "--stat=110", "--no-color", commit).trimEnd(), diff: diff.length > 14_000 ? `${diff.slice(0, 14_000)}\n… ${diff.length - 14_000} more characters` : diff };
};
const runs: unknown[] = [];

for (const id of ids) {
  const dir = `${runsDir}/${id}`;
  if (!existsSync(`${dir}/status.json`)) { console.error("no run", id); continue; }
  const info = JSON.parse(readFileSync(`${dir}/status.json`, "utf8"));
  const lane = (info.extra?.lane?.dir as string | undefined) ?? "";
  const run: Record<string, unknown> = {
    id, task: { id: info.subject, title: info.extra?.task?.title ?? info.subject, goal: clean(String(info.extra?.task?.goal ?? ""), 2000, lane) },
    workflow: info.extra?.opts?.script ?? "pair", status: info.status, round: info.round, rounds: info.extra?.opts?.rounds ?? null,
    startedAt: info.startedAt, endedAt: info.endedAt ?? null, updatedAt: info.updatedAt, tokens: info.tokens, branch: info.extra?.lane?.branch ?? null, base: info.extra?.lane?.base ?? null,
    reasons: (info.reasons ?? []).map((r: string) => clean(r, 600, lane)), error: info.error ? clean(info.error, 600, lane) : null, step: info.step, steps: [], agents: [],
  };
  if (existsSync(`${dir}/run.sqlite`)) {
    const host = await openHost({ file: `${dir}/run.sqlite`, models: modelsFrom({ gateway: { baseUrl: "http://x", apiKeyEnv: "NOPE", models: [] } }), env: {}, policy: POLICY, readOnly: true });
    const ledger = await entriesOf(host);
    const started = new Set<string>(), steps: Record<string, unknown>[] = [];
    for (const e of ledger) {
      const d = e.data as { name: string; result?: unknown; reasons?: string[] };
      if (e.kind === "loop.start") { started.add(d.name); steps.push({ name: d.name, state: "running" }); }
      if (e.kind === "loop.done") {
        const s = steps.find((x) => x.name === d.name) ?? (steps.push({ name: d.name }), steps.at(-1)!);
        const r = d.result as Record<string, unknown> | unknown[] | boolean | string;
        s.state = "done";
        if (Array.isArray(r)) s.checks = r.map((g) => ({ name: (g as { name: string }).name, ok: (g as { ok: boolean }).ok, tail: clean(String((g as { tail: string }).tail), 1400, lane) }));
        else if (r && typeof r === "object" && "verdict" in r) s.review = { verdict: r.verdict, findings: r.findings, fixed: r.fixed };
        else if (r && typeof r === "object" && "ok" in r) {
          s.said = { ok: r.ok, error: r.error ?? null, head: String(r.head ?? "").slice(0, 7), tokens: r.tokens, json: r.json ?? null };
          if (/^make\./.test(d.name) && r.ok && typeof r.head === "string") s.changes = changesOf(r.head);
        }
        else s.result = typeof r === "object" ? r : String(r);
      }
      if (e.kind === "loop.end") steps.push({ name: `end.${d.name}`, state: "done", end: d.name, reasons: (d.reasons ?? []).map((x) => clean(x, 600, lane)) });
    }
    run.steps = steps;
    const agents: unknown[] = [];
    for (const c of ledger.filter((e) => e.kind === "loop.conversation").map((e) => e.data as { name: string; id: number })) {
      const conv = (await host.harness.conversation(c.id as never, host.context))!;
      const items = (await conv.entries({ order: "ascending" }, 1000, undefined, host.context)).items;
      const view = await conv.watch(host.context);
      const agentDoc = view.value.docs["pi.agent"] as { model?: { modelId?: string }; tools?: string[]; extensions?: string[]; instructions?: string } | undefined;
      const live = view.value.docs["pi.live"] as { run?: unknown; runFailure?: { reason?: string; detail?: string } } | undefined;
      await view.stop();
      const messages: Record<string, unknown>[] = [];
      const usage = { turns: 0, tools: {} as Record<string, number>, refused: 0, errors: 0, tokensIn: 0, tokensOut: 0 };
      let first = 0, last = 0, instructions = agentDoc?.instructions ?? "";
      for (const e of items) {
        const m = e.model?.[0] as { role?: string; content?: unknown; timestamp?: number; usage?: { input: number; output: number }; stopReason?: string; errorMessage?: string; toolCallId?: string; toolName?: string; isError?: boolean; durationMs?: number; sections?: { instructions?: string } } | undefined;
        if (!m) continue;
        if (m.timestamp) { first ||= m.timestamp; last = m.timestamp; }
        if (e.kind === "pi.user") messages.push({ id: Number(e.id), role: "user", at: m.timestamp ?? null, text: clean(textOf(m.content), 9000, lane) });
        else if (e.kind === "pi.system") instructions ||= m.sections?.instructions ?? "";
        else if (e.kind === "pi.assistant") {
          usage.turns++; usage.tokensIn += m.usage?.input ?? 0; usage.tokensOut += m.usage?.output ?? 0;
          const parts = Array.isArray(m.content) ? (m.content as { type: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: Record<string, unknown> }[]) : [];
          const calls = parts.filter((p) => p.type === "toolCall").map((p) => { usage.tools[p.name!] = (usage.tools[p.name!] ?? 0) + 1; return { id: p.id, name: p.name, args: Object.fromEntries(Object.entries(p.arguments ?? {}).map(([k, v]) => [k, typeof v === "string" ? clean(v, 1600, lane) : typeof v === "number" || typeof v === "boolean" ? v : clean(JSON.stringify(v), 1600, lane)])) }; });
          if (m.stopReason === "error") usage.errors++;
          messages.push({ id: Number(e.id), role: "assistant", at: m.timestamp ?? null, text: clean(parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join(""), 9000, lane), thinking: clean(parts.filter((p) => p.type === "thinking").map((p) => p.thinking ?? "").join(""), 3000, lane), calls, error: m.errorMessage ? clean(m.errorMessage, 500, lane) : null, tokensIn: m.usage?.input ?? 0, tokensOut: m.usage?.output ?? 0 });
        } else if (e.kind === "pi.tool-result") {
          const text = textOf(m.content), refused = /Refused by the loop's policy/.test(text);
          if (refused) usage.refused++;
          messages.push({ id: Number(e.id), role: "tool", at: m.timestamp ?? null, callId: m.toolCallId, name: m.toolName, isError: !!m.isError, refused, durationMs: m.durationMs ?? null, text: clean(refused ? text.replace(/<\/?harness>|\[error\] Tool call blocked: /g, "").trim() : text, 2200, lane) });
        }
      }
      agents.push({ key: c.name, role: roleOf(c.name), model: agentDoc?.model?.modelId ?? null, tools: agentDoc?.tools ?? [], extensions: agentDoc?.extensions ?? [], instructions: clean(instructions, 7000, lane),
        state: live?.run !== undefined ? "working" : live?.runFailure ? "failed" : "done", failure: live?.runFailure ? { reason: live.runFailure.reason, detail: clean(String(live.runFailure.detail ?? ""), 500, lane) } : null,
        startedAt: first || null, endedAt: last || null, usage, messages });
    }
    run.agents = agents;
    await host.close();
  }
  runs.push(run);
}
writeFileSync(outFile, `${JSON.stringify({ capturedAt: new Date().toISOString(), runs })}\n`);
console.log("wrote", outFile, `${Math.round(readFileSync(outFile).length / 1024)} KB`, runs.length, "runs");
