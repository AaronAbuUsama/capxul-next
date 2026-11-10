/**
 * One run. Its steps down the left, the step you picked in the middle, everything about it on the right. On a phone
 * the three are tabs. An agent's step opens as its conversation; a check step as its results.
 */
import { PanelRight, Square } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { KindIcon, RunBadge, StateIcon, stepLabel } from "./bits.tsx";
import { Conversation } from "./Conversation.tsx";
import { EvidenceView } from "./Evidence.tsx";
import { elapsed, handoffsOf, stepsOf } from "./data.ts";
import { duration, tokens } from "./format.ts";
import { AgentPanel, RunPanel } from "./Inspector.tsx";
import { Overview } from "./Overview.tsx";
import { ChecksList, FindingCard, VerdictCard } from "./Results.tsx";
import { clock } from "./format.ts";
import type { Live } from "./live.ts";
import { go, href } from "./router.ts";
import { TopBar } from "./TopBar.tsx";
import type { Handoff, Run, Step } from "./types.ts";

const Rail = ({ run, steps, handoffs, selected }: { run: Run; steps: Step[]; handoffs: Handoff[]; selected: string }) => {
  const row = (id: string, kind: Step["kind"], title: string, summary: string, state?: Step["state"], at?: number | null) => (
    <a key={id} href={href("runs", run.id, id)} className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-muted", selected === id && "bg-muted font-medium")}>
      <KindIcon kind={kind} className="shrink-0 text-muted-foreground" />
      <span className="grid min-w-0 flex-1 leading-tight"><span className="truncate">{title}</span><span className="truncate text-xs font-normal text-muted-foreground">{summary}</span></span>
      {at ? <span className="text-xs font-normal text-muted-foreground tabular-nums">{clock(at)}</span> : null}
      {state && <StateIcon state={state} />}
    </a>
  );
  const rounds = [...new Set(steps.map((s) => s.round).filter((r): r is number => r !== null))];
  const label = (text: string) => <p className="px-2.5 pt-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{text}</p>;
  return (
    <nav className="space-y-0.5 p-2">
      {row("overview", "overview", "Overview", "what happened, in short")}
      {label("Setup")}
      {steps.filter((s) => s.kind === "setup").map((s) => row(s.id, s.kind, s.title, s.summary, s.state))}
      {rounds.map((n) => {
        const back = handoffs.find((h) => h.after === n), last = n === rounds.at(-1);
        return (
          <div key={n}>
            {label(`Round ${n}`)}
            {steps.filter((s) => s.round === n).map((s) => row(s.id, s.kind, s.title, s.summary, s.state, s.at))}
            {back && back.sent.length > 0 && <a href={href("runs", run.id, `handoff.${n}`)} className={cn("mx-2.5 my-1.5 block rounded-md border border-amber-600/30 bg-amber-600/5 px-2 py-1.5 text-xs text-amber-800 hover:bg-amber-600/10", selected === `handoff.${n}` && "ring-1 ring-amber-600/50")}>↩ {back.sent.length} finding{back.sent.length === 1 ? "" : "s"} {last ? "still open" : "back to the builder"}{back.fixed ? ` · ${back.fixed} fixed` : ""}</a>}
          </div>
        );
      })}
      {steps.some((s) => s.kind === "publish" || s.kind === "end") && label("End")}
      {steps.filter((s) => s.kind === "publish" || s.kind === "end").map((s) => row(s.id, s.kind, s.title, s.summary, s.state))}
    </nav>
  );
};

/** A step that is not a conversation: what it did and what it left. */
const Plain = ({ run, step }: { run: Run; step: Step }) => (
  <div className="flex-1 overflow-y-auto">
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
      <div><h2 className="text-lg font-semibold">{stepLabel(step)}</h2><p className="text-sm text-muted-foreground">{step.summary}</p></div>
      {step.checks && <ChecksList checks={step.checks} />}
      {step.changes && (
        <>
          <p className="text-sm">{step.changes.subject}</p>
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">{step.changes.stat}</pre>
          <pre className="max-h-[60vh] overflow-auto rounded-lg bg-neutral-950 p-3 font-mono text-xs leading-relaxed text-neutral-300">{step.changes.diff.split("\n").map((l, i) => <span key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "block text-emerald-400" : l.startsWith("-") && !l.startsWith("---") ? "block text-red-400" : l.startsWith("@@") || l.startsWith("diff ") ? "block text-sky-400" : "block"}>{l || " "}</span>)}</pre>
        </>
      )}
      {step.error && <pre className="rounded-lg border border-amber-600/30 bg-amber-600/5 p-3 text-sm whitespace-pre-wrap text-amber-900">{step.error}</pre>}
      {step.kind === "setup" && step.id === "lane" && !step.error && <p className="text-sm">A git worktree on <span className="font-mono">{run.branch}</span>, cut from <span className="font-mono">{run.base}</span>. The agents of this run work inside it and nowhere else.</p>}
      {step.reasons && step.reasons.length > 0 && <ul className="list-disc space-y-2 pl-5 text-sm">{step.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      {step.state === "pending" && <p className="text-sm text-muted-foreground">Not started yet. It runs after the builder hands back.</p>}
    </div>
  </div>
);

/** What went back to the builder after a round: the findings, each with where and what. */
const Back = ({ handoff, last }: { handoff: Handoff; last: boolean }) => (
  <div className="flex-1 overflow-y-auto">
    <div className="mx-auto w-full max-w-3xl space-y-3 p-4 md:p-6">
      <div><h2 className="text-lg font-semibold">After round {handoff.after}: {handoff.sent.length} finding{handoff.sent.length === 1 ? "" : "s"} {last ? "still open" : "went back to the builder"}</h2><p className="text-sm text-muted-foreground">Failed checks and blocking findings, less what a checker marked fixed{handoff.fixed ? ` (${handoff.fixed} fixed this round)` : ""}. The next builder gets these and the last builder's handover.</p></div>
      {handoff.sent.map((f, i) => <FindingCard key={i} finding={f} />)}
    </div>
  </div>
);

export const RunPage = ({ run, runs, step: wanted, tab = "activity", stop, note }: { run: Run; runs: Run[]; step?: string; tab?: string; stop?: ((run: string) => Promise<string>) | undefined; note?: Live["note"] | undefined }) => {
  /** Stopping is asked for, then confirmed in a bar under the top strip: no browser dialog, so it works the same on a phone. */
  const [stopping, setStopping] = useState<"no" | "asking" | "sent">("no"), [stopSaid, setStopSaid] = useState("");
  const askStop = (): void => setStopping("asking");
  const doStop = (): void => { if (!stop) return; setStopping("sent"); setStopSaid("asking the run to stop…"); void stop(run.id).then(setStopSaid, (e: unknown) => setStopSaid(`the host did not take it: ${e instanceof Error ? e.message : String(e)}`)); };
  const steps = stepsOf(run), handoffs = handoffsOf(steps), isMobile = useIsMobile();
  const fallback = steps.find((s) => s.state === "running")?.id ?? "overview";
  const step = steps.find((s) => s.id === wanted || s.agent?.key === wanted) ?? (wanted === "overview" ? undefined : steps.find((s) => s.id === fallback));
  const handoff = wanted?.startsWith("handoff.") ? handoffs.find((h) => `handoff.${h.after}` === wanted) : undefined;
  const selected = handoff ? wanted! : (step?.id ?? "overview");
  const setTab = (t: string): void => go("runs", run.id, selected, ...(t === "activity" ? [] : [t]));
  const commit = [...steps].reverse().find((s) => s.commit)?.commit;

  const center = handoff ? <Back handoff={handoff} last={handoff.after === handoffs.at(-1)?.after && run.status !== "running"} />
    : !step ? <Overview run={run} steps={steps} handoffs={handoffs} />
    : step.shown ? <EvidenceView run={run} title={`${stepLabel(step)}${step.round ? ` · round ${step.round}` : ""}`} by={step.by!} shown={step.shown} />
    : step.agent ? (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-sm">
          <KindIcon kind={step.kind} className="text-muted-foreground" /><span className="font-medium">{stepLabel(step)}</span><span className="font-mono text-xs text-muted-foreground">{step.agent.key}</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground"><StateIcon state={step.state} className="size-3.5" /> {step.summary}</span>
        </div>
        {step.review && step.state !== "running" && step.agent.messages.length === 0 && <div className="p-4"><VerdictCard review={step.review} /></div>}
        <Conversation key={step.agent.key} run={run} agent={step.agent} send={note ? (text, mode) => note(run.id, step.agent!.key, text, mode) : undefined} stop={stop ? askStop : undefined} />
      </div>
    ) : <Plain run={run} step={step} />;
  const side = <>{step?.agent && <AgentPanel agent={step.agent} round={step.round} />}<RunPanel run={run} commit={commit} others={runs.filter((x) => x.task.id === run.task.id && x.id !== run.id)} /></>;

  return (
    <>
      <TopBar crumbs={[<a href={href()}>Runs</a>, run.task.title]}>
        <RunBadge run={run} />
        {run.status === "running" && <Button size="sm" variant="outline" disabled={!stop} onClick={askStop}><Square /> <span className="hidden sm:inline">Stop run</span></Button>}
        {!isMobile && (
          <Sheet>
            <SheetTrigger render={<Button size="icon-sm" variant="ghost" className="xl:hidden" aria-label="Details" />}><PanelRight /></SheetTrigger>
            <SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>Details</SheetTitle></SheetHeader>{side}</SheetContent>
          </Sheet>
        )}
      </TopBar>
      <p className="flex shrink-0 flex-wrap gap-x-3 border-b px-4 py-1.5 text-xs text-muted-foreground">
        <span>workflow <b className="font-medium text-foreground">{run.workflow}</b></span><span>round {run.round}{run.rounds ? ` of ${run.rounds}` : ""}</span><span>{duration(elapsed(run))}</span><span>{tokens(run.tokens)} tokens</span>{run.replay && <span className="text-blue-700">replay of a real run</span>}
      </p>
      {stopping !== "no" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-600/30 bg-amber-600/5 px-4 py-2 text-sm">
          {stopping === "asking" ? (
            <>
              <span className="min-w-0 flex-1">Stop <span className="font-mono text-xs">{run.id}</span>? Its agent is aborted within a second or two. The run can be resumed later.</span>
              <Button size="sm" variant="destructive" onClick={doStop}><Square /> Stop the run</Button>
              <Button size="sm" variant="ghost" onClick={() => setStopping("no")}>Keep going</Button>
            </>
          ) : (
            <><span className="min-w-0 flex-1">{stopSaid}</span><Button size="sm" variant="ghost" onClick={() => setStopping("no")}>Close</Button></>
          )}
        </div>
      )}
      {isMobile ? (
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="flex min-h-0 flex-1 flex-col gap-0">
          <TabsList className="mx-3 my-2 w-auto self-stretch"><TabsTrigger value="activity">{step?.agent ? "Conversation" : step ? "Step" : "Overview"}</TabsTrigger><TabsTrigger value="steps">Steps</TabsTrigger><TabsTrigger value="details">Details</TabsTrigger></TabsList>
          <TabsContent value="activity" className="flex min-h-0 flex-1 flex-col">{center}</TabsContent>
          <TabsContent value="steps" className="min-h-0 flex-1 overflow-y-auto"><Rail run={run} steps={steps} handoffs={handoffs} selected={selected} /></TabsContent>
          <TabsContent value="details" className="min-h-0 flex-1 overflow-y-auto">{side}</TabsContent>
        </Tabs>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="w-64 shrink-0 overflow-y-auto border-r"><Rail run={run} steps={steps} handoffs={handoffs} selected={selected} /></aside>
          <main className="flex min-w-0 flex-1 flex-col">{center}</main>
          <aside className="hidden w-80 shrink-0 overflow-y-auto border-l xl:block">{side}</aside>
        </div>
      )}
    </>
  );
};
