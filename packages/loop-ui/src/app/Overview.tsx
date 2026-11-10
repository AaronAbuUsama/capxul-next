/** A run in short: the one thing to know first, the back and forth between builder and checkers, and what came out. */
import { EvidenceStrip } from "./Evidence.tsx";
import { Badge } from "@/components/ui/badge";
import { KindIcon, StateIcon } from "./bits.tsx";
import { doingNow, healthText, roleLabel, workingAgent } from "./data.ts";
import { plural, tokens } from "./format.ts";
import { FindingCard, HandbackCard } from "./Results.tsx";
import { href } from "./router.ts";
import type { Handoff, Run, Step } from "./types.ts";

/** The sentence a person needs before anything else. */
const headline = (run: Run, steps: Step[], handoffs: Handoff[]): { title: string; text: string; warn: boolean } => {
  const builders = steps.filter((s) => s.kind === "builder"), working = workingAgent(run);
  if (run.status === "running") return { title: `${working ? (roleLabel[working.role] ?? working.role) : "The run"} is working, round ${run.round}${run.rounds ? ` of ${run.rounds}` : ""}`, text: working ? doingNow(working) : "", warn: false };
  if (run.status === "failed") return { title: "It failed before any agent started", text: run.error ?? "", warn: true };
  if (run.status === "blocked" && builders.length > 0 && builders.every((b) => b.error)) return { title: "The builder never ran", text: `Its model failed in ${builders.length === 1 ? "its round" : `all ${builders.length} rounds`}, so nothing was built and the reviewer read an unchanged lane each time. The findings below are about the task, not about work done.`, warn: true };
  if (run.status === "blocked") return { title: `Blocked after ${plural(run.round, "round")}`, text: `${plural(handoffs.at(-1)?.sent.length ?? run.reasons.length, "finding")} still open. The plan task is blocked for the coordinator.`, warn: true };
  return { title: `Ready to merge after ${plural(run.round, "round")}`, text: "Every check passed and every reviewer approved. The branch is pushed; merging is the coordinator's.", warn: false };
};

export const Overview = ({ run, steps, handoffs }: { run: Run; steps: Step[]; handoffs: Handoff[] }) => {
  const head = headline(run, steps, handoffs);
  const rounds = [...new Set(steps.map((s) => s.round).filter((r): r is number => r !== null))];
  const lastBuilder = [...steps].reverse().find((s) => s.kind === "builder" && s.handback);
  const open = run.status === "blocked" ? (handoffs.at(-1)?.sent ?? []) : [];
  const cell = (s: Step | undefined) => !s ? <span className="text-muted-foreground">—</span> : (
    <a href={href("runs", run.id, s.id)} className="inline-flex items-center gap-1.5 hover:underline"><StateIcon state={s.state} className="size-3.5" /> {s.summary}</a>
  );
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-6">
        <div className={head.warn ? "rounded-lg border border-amber-600/30 bg-amber-600/5 p-4" : "rounded-lg border bg-muted/40 p-4"}>
          <h2 className="text-lg font-semibold">{head.title}</h2>
          {head.text && <p className={run.status === "running" ? "mt-1 font-mono text-xs" : "mt-1 text-sm leading-relaxed"}>{head.text}</p>}
          {run.superseded && <p className="mt-1 text-sm text-muted-foreground">Superseded: {run.superseded}. Nothing here needs you.</p>}
        </div>
        {healthText(run) && <div className="rounded-lg border border-amber-600/30 bg-amber-600/5 p-3 text-sm">{healthText(run)}. Open an agent's conversation to see why.</div>}

        {rounds.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Back and forth</h3>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Round</th><th className="px-3 py-2 font-medium">Builder</th><th className="px-3 py-2 font-medium">Checks</th><th className="px-3 py-2 font-medium">Reviewer</th><th className="px-3 py-2 font-medium">Sent back</th></tr></thead>
                <tbody>
                  {rounds.map((n) => {
                    const of = (kind: Step["kind"]) => steps.find((s) => s.round === n && s.kind === kind), back = handoffs.find((h) => h.after === n);
                    return (
                      <tr key={n} className="border-t">
                        <td className="px-3 py-2 font-medium">{n}</td><td className="px-3 py-2">{cell(of("builder"))}</td><td className="px-3 py-2">{cell(of("checks"))}</td><td className="px-3 py-2">{cell(of("reviewer"))}</td>
                        <td className="px-3 py-2">{back ? (back.sent.length === 0 ? "nothing" : `${plural(back.sent.length, "finding")}${back.fixed ? `, ${back.fixed} fixed` : ""}`) : <span className="text-muted-foreground">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {open.length > 0 && <section className="space-y-2"><h3 className="text-sm font-semibold">Still open</h3>{open.map((f, i) => <FindingCard key={i} finding={f} />)}</section>}

        {lastBuilder?.handback && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">What the builder handed back {lastBuilder.commit && <Badge variant="outline" className="font-mono">{lastBuilder.commit}</Badge>}</h3>
            <HandbackCard handback={lastBuilder.handback} />
          </section>
        )}

        {(run.captures?.length ?? 0) > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Evidence · {plural(run.captures.length, "capture")}</h3>
            <EvidenceStrip run={run} />
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Agents in this run</h3>
          <div className="divide-y rounded-lg border">
            {steps.filter((s) => s.agent).map((s) => (
              <a key={s.id} href={href("runs", run.id, s.id)} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50">
                <KindIcon kind={s.kind} className="text-muted-foreground" />
                <span className="grid min-w-0 flex-1 leading-tight"><span className="font-medium">{s.title}{s.round ? ` · round ${s.round}` : ""}</span><span className="truncate text-xs text-muted-foreground">{s.agent!.model} · {plural(s.agent!.usage.turns, "turn")} · {tokens(s.agent!.usage.tokensIn + s.agent!.usage.tokensOut)} tokens</span></span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><StateIcon state={s.state} className="size-3.5" /> {s.summary}</span>
              </a>
            ))}
            {steps.every((s) => !s.agent) && <p className="px-3 py-2.5 text-sm text-muted-foreground">No agent started.</p>}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">The task</h3>
          <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">{run.task.goal || run.task.title}</pre>
        </section>
      </div>
    </div>
  );
};
