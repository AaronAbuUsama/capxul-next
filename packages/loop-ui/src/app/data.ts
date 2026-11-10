/**
 * The runs the page shows, and what is derived from them: a run's timeline of steps, its rounds and the handoffs
 * between them. In the prototype the runs come from a file exported from real runs; one of them can be replayed as if
 * it were live, so the live states can be seen.
 */
import fixture from "@/fixtures/runs.json";
import type { Agent, Finding, Handback, Handoff, RawStep, Review, Run, Shown, Step, StepState } from "./types.ts";

const REPLAY = { run: "m1-telemetry-11101341", step: "make.2", keep: 0.55 };

/** A finished run shown as it stood in the middle of one of its agent steps. */
const replayOf = (run: Run): Run => {
  const at = run.steps.findIndex((s) => s.name === REPLAY.step);
  const steps: RawStep[] = run.steps.slice(0, at).concat([{ name: REPLAY.step, state: "running" }]);
  const agents = run.agents.filter((a) => steps.some((s) => s.name === a.key || s.name === a.key.replace(/\.agent$/, ""))).map((a): Agent => {
    if (a.key !== REPLAY.step) return a;
    const cut = Math.max(4, Math.floor(a.messages.length * REPLAY.keep));
    const messages = a.messages.slice(0, cut);
    while (messages.at(-1)?.role === "tool") messages.pop();           // end on a call that has not answered yet
    return { ...a, state: "working", endedAt: null, messages };
  });
  return { ...run, status: "running", round: 2, endedAt: null, reasons: [], step: REPLAY.step, steps, agents, replay: true };
};

const all = (fixture as unknown as { runs: Run[] }).runs;
export const capturedAt = (fixture as unknown as { capturedAt: string }).capturedAt;
export const runsOf = (replay: boolean): Run[] =>
  all.map((r) => (replay && r.id === REPLAY.run ? replayOf(r) : r)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));

/** Plan tasks being done by something that is not a run (plan/plan.json, 10 November 2026). */
export const otherWork = [
  { task: "m1-tidy", title: "Tidy the repository so a person can find their way", thread: "repo-tidy", since: "10 Nov" },
  { task: "m1-run-observability", title: "See, inspect and steer loop runs from the portal", thread: "run-observability", since: "10 Nov" },
];

/** A run needs a person only while it is the newest run of an open task (the loop's `superseded`). */
export const group = (r: Run): "running" | "needs" | "done" => r.status === "running" ? "running" : !r.superseded && (r.status === "blocked" || r.status === "failed" || r.status === "stopped" || r.status === "dead") ? "needs" : "done";
/** What the post-mortem of 10 November could not see at a glance: calls the policy refused, and model requests that failed. */
export const healthOf = (r: Run): { calls: number; refused: number; failures: number } => ({
  calls: r.agents.reduce((n, a) => n + Object.values(a.usage.tools).reduce((m, k) => m + k, 0), 0),
  refused: r.agents.reduce((n, a) => n + a.usage.refused, 0), failures: r.agents.reduce((n, a) => n + a.usage.errors, 0),
});
/** One line of a run's health; empty when it is clean. */
export const healthText = (r: Run): string => {
  const h = healthOf(r), parts = [h.refused ? `${h.refused} of ${h.calls} calls refused` : "", h.failures ? `${h.failures} model failure${h.failures === 1 ? "" : "s"}` : ""].filter(Boolean);
  return parts.join(" · ");
};
export const statusText: Record<Run["status"], string> = { running: "Running", ready: "Ready to merge", answered: "Answered", blocked: "Blocked", failed: "Failed", stopped: "Stopped", merged: "Merged", dead: "Offline" };
export const agentOf = (run: Run, key: string): Agent | undefined => run.agents.find((a) => a.key === key || a.key === `${key}.agent`);
export const workingAgent = (run: Run): Agent | undefined => run.agents.find((a) => a.state === "working");
export const roleLabel: Record<string, string> = { builder: "Builder", reviewer: "Reviewer", adversary: "Adversary", researcher: "Researcher", diagnoser: "Diagnoser" };

const roundOf = (name: string): number | null => { const m = /\.(\d+)(\.agent)?$/.exec(name); return m ? Number(m[1]) : null; };
const stateOf = (raw: RawStep, bad: boolean): StepState => (raw.state === "running" ? "running" : bad ? "attention" : "done");

/** What the agent of step `by` showed: its captures, each with the claim made about it, then the claims that named no capture. */
export const shownOf = (run: Run, by: string): Shown[] => {
  const claims = run.steps.find((s) => s.name === by)?.evidence ?? [], captures = (run.captures ?? []).filter((c) => c.by === by);
  return [...captures.map((capture) => ({ capture, claim: claims.find((e) => e.capture === capture.id) ?? null })), ...claims.filter((e) => !captures.some((c) => c.id === e.capture)).map((claim) => ({ capture: null, claim }))];
};
const evidenceRow = (run: Run, by: string, round: number | null, who: string): Step[] => {
  const shown = shownOf(run, by), out = shown.filter((s) => s.claim && !s.claim.ok).length;
  return shown.length === 0 ? [] : [{ id: `evidence.${by}`, kind: "evidence", title: `${who}'s evidence`, round, state: out > 0 ? "attention" : "done", shown, by,
    summary: `${shown.filter((s) => s.capture).length} captured${out > 0 ? ` · ${out} thrown out` : ""}` }];
};

/** The timeline: one row per step a person cares about (a checker and its conversation are one row). */
export const stepsOf = (run: Run): Step[] => {
  const out: Step[] = [];
  for (const raw of run.steps) {
    const round = roundOf(raw.name), agent = agentOf(run, raw.name);
    if (raw.name.endsWith(".agent")) continue;
    if (raw.name === "plan.claim") out.push({ id: raw.name, kind: "setup", title: "Claim the task", round: null, state: stateOf(raw, false), summary: `${run.task.id} marked started` });
    else if (raw.name === "lane") out.push({ id: raw.name, kind: "setup", title: "Make the lane", round: null, state: raw.state === "running" && run.status === "failed" ? "attention" : stateOf(raw, false), summary: run.branch ?? (run.error ? "could not be made" : "a worktree"), error: run.status === "failed" ? run.error : null });
    else if (/^make\./.test(raw.name) || raw.name === "research") {
      const handback = (raw.said?.json ?? null) as Handback | null;
      out.push({ id: raw.name, kind: "builder", title: raw.name === "research" ? "Researcher" : "Builder", round, state: stateOf(raw, raw.said ? !raw.said.ok : false), agent, handback, error: raw.said?.error ?? null, commit: raw.said?.head,
        at: agent?.startedAt ?? null,
        summary: raw.state === "running" ? "working" : raw.said?.ok ? "handed back" : (raw.said?.error ?? "did not finish").replace("unanswered: ", "").replace("model_error", "model error") });
      if (raw.changes) out.push({ id: `changes.${round}`, kind: "changes", title: "Changes", round, state: "done", changes: raw.changes, commit: raw.changes.commit,
        summary: `${/(\d+) files? changed/.exec(raw.changes.stat)?.[1] ?? "?"} files · ${raw.changes.commit}` });
      out.push(...evidenceRow(run, raw.name, round, "Builder"));
    } else if (/^gates\./.test(raw.name)) {
      const failed = (raw.checks ?? []).filter((c) => !c.ok).length;
      out.push({ id: raw.name, kind: "checks", title: "Checks", round, state: stateOf(raw, failed > 0), checks: raw.checks, summary: raw.checks ? `${raw.checks.length - failed} of ${raw.checks.length} pass` : "running" });
    } else if (raw.review || /^(reviewer|adversary)\./.test(raw.name)) {
      const review = raw.review as Review | undefined, blocking = (review?.findings ?? []).filter((f) => f.severity === "blocking").length;
      out.push({ id: raw.name, kind: "reviewer", title: roleLabel[raw.name.split(".")[0]!] ?? "Checker", round, at: agent?.startedAt ?? null, state: stateOf(raw, review?.verdict !== "approve" && raw.state !== "running"), agent, review,
        summary: raw.state === "running" ? "reviewing" : review?.verdict === "approve" ? "approved" : `changes · ${blocking} blocking` });
      out.push(...evidenceRow(run, `${raw.name}.agent`, round, roleLabel[raw.name.split(".")[0]!] ?? "Checker"));
    } else if (raw.name === "push") out.push({ id: raw.name, kind: "publish", title: "Push the branch", round: null, state: stateOf(raw, false), summary: String(raw.result ?? run.branch ?? "") });
    else if (raw.name === "plan.block") out.push({ id: raw.name, kind: "end", title: "Block the task", round: null, state: "attention", summary: "handed to the coordinator" });
    else if (raw.end) out.push({ id: raw.name, kind: "end", title: raw.end === "ready" ? "Ready to merge" : raw.end === "blocked" ? "Blocked" : "Answered", round: null, state: raw.end === "blocked" ? "attention" : "done", summary: raw.end === "blocked" ? `${raw.reasons?.length ?? 0} findings open` : (raw.reasons?.[0] ?? ""), reasons: raw.reasons });
  }
  if (run.status === "running") {
    const last = out.at(-1), round = last?.round ?? 1;
    const todo = last?.kind === "builder" ? ["checks", "reviewer"] : last?.kind === "checks" ? ["reviewer"] : [];
    for (const kind of todo) out.push({ id: `pending.${kind}.${round}`, kind: kind as Step["kind"], title: kind === "checks" ? "Checks" : "Reviewer", round, state: "pending", summary: "after the builder" });
  }
  return out;
};

/** What went back to the builder after each round, as the workflow's `settle` works it out. */
export const handoffsOf = (steps: Step[]): Handoff[] => {
  const out: Handoff[] = [];
  let open: Finding[] = [];
  const rounds = [...new Set(steps.map((s) => s.round).filter((r): r is number => r !== null))].sort((a, b) => a - b);
  for (const n of rounds) {
    const mine = steps.filter((s) => s.round === n);
    const reviews = mine.filter((s) => s.kind === "reviewer" && s.review);
    if (reviews.length === 0) continue;
    const fixed = new Set(reviews.flatMap((s) => s.review!.fixed ?? []));
    const fresh: Finding[] = [
      ...mine.filter((s) => s.kind === "checks").flatMap((s) => (s.checks ?? []).filter((c) => !c.ok).map((c): Finding => ({ severity: "blocking", check: `check: ${c.name}`, text: "This check failed." }))),
      ...reviews.flatMap((s) => s.review!.findings.filter((f) => f.severity === "blocking")),
    ].map((f, i) => ({ ...f, id: `F-${n}.${i + 1}` }));
    const builder = mine.find((s) => s.kind === "builder");
    if (builder?.error) fresh.push({ id: `F-${n}.0`, severity: "blocking", text: `The builder did not finish: ${builder.error.replace("unanswered: ", "").replace("model_error", "model error")}.` });
    const kept = open.filter((f) => !fixed.has(f.id ?? "") && !f.check?.startsWith("check:"));
    open = [...kept, ...fresh];
    out.push({ after: n, sent: open, fixed: fixed.size });
  }
  return out;
};

export const elapsed = (run: Run): number => new Date(run.endedAt ?? (run.status === "running" && !run.replay ? Date.now() : run.updatedAt)).getTime() - new Date(run.startedAt).getTime();
export const agentTime = (a: Agent): number => (a.startedAt && (a.endedAt ?? a.messages.at(-1)?.at) ? (a.endedAt ?? a.messages.at(-1)!.at!) - a.startedAt : 0);
/** What an agent is doing right now, in a few words: its last tool call or its last line. */
export const doingNow = (a: Agent): string => {
  const last = [...a.messages].reverse().find((m) => m.role === "assistant");
  const call = last?.calls?.at(-1);
  if (!call) return last?.text.split("\n")[0]?.slice(0, 80) || (last?.error ? "waiting: the model failed, retrying" : "waiting for the model");
  const arg = String(call.args.command ?? call.args.path ?? "").split("\n")[0]!;
  return `${call.name} ${arg}`.slice(0, 90);
};
