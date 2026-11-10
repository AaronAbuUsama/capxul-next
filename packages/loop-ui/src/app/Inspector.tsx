/** Everything about the agent you are looking at, and about its run: who it is, what it may do, what it has used. */
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";
import { agentTime, elapsed, roleLabel, statusText } from "./data.ts";
import { clock, duration, tokens } from "./format.ts";
import type { Agent, Run } from "./types.ts";

const MAY: Record<string, string> = {
  builder: "Reads and writes inside its lane. Runs the repository's pnpm scripts, node, and git add and commit. Cannot push, install or reach the network.",
  reviewer: "Reads only: files in the lane, git history, search. Cannot write, run node or pnpm, or push. Cannot be steered.",
  adversary: "Reads only, like a reviewer. Looks for what breaks.",
  researcher: "Reads only. Answers one question with sources.",
};
const Row = ({ k, children }: { k: string; children: React.ReactNode }) => <div className="flex items-baseline justify-between gap-4 py-1 text-sm"><dt className="shrink-0 text-muted-foreground">{k}</dt><dd className="min-w-0 truncate text-right">{children}</dd></div>;
const Block = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="border-b px-4 py-3 last:border-b-0"><h3 className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>{children}</section>;

export const AgentPanel = ({ agent, round }: { agent: Agent; round: number | null }) => {
  const calls = Object.entries(agent.usage.tools).sort((a, b) => b[1] - a[1]), total = calls.reduce((s, [, n]) => s + n, 0);
  return (
    <>
      <Block title="Agent">
        <p className="text-base font-semibold">{roleLabel[agent.role] ?? agent.role}</p>
        <p className="font-mono text-xs text-muted-foreground">{agent.key}</p>
        <dl className="mt-2">
          <Row k="State">{agent.state === "working" ? <span className="font-medium text-blue-700">Working</span> : agent.state === "failed" ? <span className="text-amber-700">Stopped: {agent.failure?.reason?.replace("_", " ")}</span> : "Finished"}</Row>
          <Row k="Model">{agent.model}</Row>
          {round !== null && <Row k="Round">{round}</Row>}
          <Row k="Started">{clock(agent.startedAt)}</Row>
          <Row k={agent.state === "working" ? "So far" : "Took"}>{duration(agentTime(agent))}</Row>
        </dl>
      </Block>
      <Block title="Used">
        <dl>
          <Row k="Tokens in">{tokens(agent.usage.tokensIn)}</Row>
          <Row k="Tokens out">{tokens(agent.usage.tokensOut)}</Row>
          <Row k="Turns">{agent.usage.turns}</Row>
          <Row k="Tool calls">{total}</Row>
        </dl>
        <div className="mt-1.5 space-y-1.5">
          {calls.map(([name, n]) => (
            <div key={name} className="flex items-center gap-2 text-xs"><span className="w-10 font-mono">{name}</span><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-foreground/60" style={{ width: `${Math.round((n / total) * 100)}%` }} /></span><span className="w-6 text-right tabular-nums">{n}</span></div>
          ))}
        </div>
        {(agent.usage.refused > 0 || agent.usage.errors > 0) && <p className="mt-2 text-xs text-amber-700">{agent.usage.refused > 0 && `${agent.usage.refused} refused by policy`}{agent.usage.refused > 0 && agent.usage.errors > 0 && " · "}{agent.usage.errors > 0 && `${agent.usage.errors} model errors`}</p>}
      </Block>
      <Block title="May do">
        <div className="mb-2 flex flex-wrap gap-1">{agent.tools.map((t) => <Badge key={t} variant="outline" className="font-mono">{t}</Badge>)}</div>
        <p className="text-sm leading-relaxed text-muted-foreground">{MAY[agent.role] ?? ""}</p>
      </Block>
      <Block title="Instructions">
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center gap-1 text-left text-sm"><ChevronRight className="size-4 transition-transform group-data-[panel-open]:rotate-90" /> The role's standing instructions</CollapsibleTrigger>
          <CollapsibleContent><pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-2 text-xs leading-relaxed whitespace-pre-wrap">{agent.instructions}</pre></CollapsibleContent>
        </Collapsible>
      </Block>
    </>
  );
};

export const RunPanel = ({ run, commit, others }: { run: Run; commit?: string; others: Run[] }) => (
  <>
    <Block title="Task">
      <a className="text-sm font-medium underline-offset-2 hover:underline" href={`/plan/task/${run.task.id}/`}>{run.task.title}</a>
      <p className="font-mono text-xs text-muted-foreground">{run.task.id} · in the Plan</p>
      {others.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-muted-foreground">Other runs of this task</p>
          {others.map((o) => <a key={o.id} href={`#/runs/${o.id}`} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted"><span className="truncate font-mono text-xs">{o.id.replace(`${o.task.id}-`, "")}</span><span className="shrink-0 text-xs text-muted-foreground">{statusText[o.status]} · {clock(o.startedAt)}</span></a>)}
        </div>
      )}
    </Block>
    <Block title="Run">
      <dl>
        <Row k="State">{statusText[run.status]}</Row>
        <Row k="Workflow">{run.workflow}</Row>
        <Row k="Round">{run.round}{run.rounds ? ` of ${run.rounds}` : ""}</Row>
        <Row k="Started">{clock(run.startedAt)}</Row>
        {run.endedAt && <Row k="Ended">{clock(run.endedAt)}</Row>}
        <Row k="Took">{duration(elapsed(run))}</Row>
        <Row k="Tokens">{tokens(run.tokens)}</Row>
      </dl>
      <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{run.id}</p>
    </Block>
    <Block title="Changes">
      <dl>
        <Row k="Branch"><span className="font-mono text-xs">{run.branch ?? "none"}</span></Row>
        <Row k="From"><span className="font-mono text-xs">{run.base ?? ""}</span></Row>
        {commit && <Row k="Commit"><span className="font-mono text-xs">{commit}</span></Row>}
      </dl>
    </Block>
  </>
);
