/** Now: what is working this minute, what needs you, what finished, and the work that is not a run. */
import { ArrowRight, Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Dot, RunBadge, toneOf } from "./bits.tsx";
import { agentTime, doingNow, elapsed, group, healthText, otherWork, roleLabel, workingAgent } from "./data.ts";
import { clock, duration, tokens } from "./format.ts";
import { href } from "./router.ts";
import { TopBar } from "./TopBar.tsx";
import type { Run } from "./types.ts";

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section className="space-y-3">
    <div className="flex items-baseline justify-between gap-3"><h2 className="text-base font-semibold">{title}</h2>{hint && <span className="text-xs text-muted-foreground">{hint}</span>}</div>
    {children}
  </section>
);

const whyOf = (run: Run): string => run.status === "failed" ? (run.error ?? "failed") : run.status === "blocked" ? (run.reasons[0] ?? "blocked").replace(/^F-\d+\.\d+ [^:]*: (Seen: )?/, "") : `${run.round} round${run.round === 1 ? "" : "s"} · ${tokens(run.tokens)} tokens`;

const RunRow = ({ run }: { run: Run }) => (
  <Item variant="outline" size="sm" render={<a href={href("runs", run.id)} />}>
    <ItemMedia><Dot tone={toneOf(run.status)} /></ItemMedia>
    <ItemContent className="min-w-0">
      <ItemTitle className="line-clamp-2 w-full">{run.task.title}</ItemTitle>
      <ItemDescription className="line-clamp-2">{run.superseded ? `Superseded: ${run.superseded}` : whyOf(run)}</ItemDescription>
      {healthText(run) && <span className="text-xs text-amber-700 dark:text-amber-500">{healthText(run)}</span>}
      <span className="font-mono text-xs text-muted-foreground">{run.id} · {clock(run.startedAt)} · {duration(elapsed(run))}</span>
    </ItemContent>
    <ItemActions><RunBadge run={run} /></ItemActions>
  </Item>
);

export const Home = ({ runs }: { runs: Run[] }) => {
  const live = runs.filter((r) => group(r) === "running"), needs = runs.filter((r) => group(r) === "needs"), done = runs.filter((r) => group(r) === "done");
  return (
    <>
      <TopBar crumbs={["Now"]} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl space-y-8 p-4 md:p-6">
          <Section title="Working now" hint={live.length ? `${live.length} run${live.length === 1 ? "" : "s"}` : undefined}>
            {live.length === 0 && <Empty className="border"><EmptyHeader><EmptyTitle>Nothing is running</EmptyTitle><EmptyDescription>Start one from a terminal: pnpm loop run &lt;task&gt;</EmptyDescription></EmptyHeader></Empty>}
            <div className="grid gap-3 md:grid-cols-2">
              {live.map((run) => {
                const agent = workingAgent(run);
                return (
                  <Card key={run.id} size="sm">
                    <CardHeader>
                      <CardDescription className="flex items-center gap-2"><Dot tone="live" pulse /> {agent ? `${roleLabel[agent.role] ?? agent.role} is working` : "Running"} · round {run.round}{run.rounds ? ` of ${run.rounds}` : ""}{run.replay && <Badge variant="outline">replay</Badge>}</CardDescription>
                      <CardTitle className="leading-snug">{run.task.title}</CardTitle>
                    </CardHeader>
                    {agent && (
                      <CardContent className="space-y-2">
                        <p className="flex items-center gap-2 text-sm"><Bot className="size-4 text-muted-foreground" /> <span className="font-mono">{agent.key}</span> <span className="text-muted-foreground">{agent.model}</span></p>
                        <p className="truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs">{doingNow(agent)}</p>
                        <p className="text-xs text-muted-foreground">{agent.usage.turns} turns · {tokens(agent.usage.tokensIn + agent.usage.tokensOut)} tokens · {duration(agentTime(agent))} in this turn</p>
                      </CardContent>
                    )}
                    <CardFooter className="gap-2">
                      {agent && <Button size="sm" nativeButton={false} render={<a href={href("runs", run.id, agent.key)} />}>Open the conversation <ArrowRight /></Button>}
                      <Button size="sm" variant="outline" nativeButton={false} render={<a href={href("runs", run.id, "overview")} />}>The run</Button>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          </Section>
          {needs.length > 0 && <Section title="Needs you" hint="blocked, failed or stopped"><ItemGroup>{needs.map((r) => <RunRow key={r.id} run={r} />)}</ItemGroup></Section>}
          {done.length > 0 && <Section title="Finished" hint="today"><ItemGroup>{done.map((r) => <RunRow key={r.id} run={r} />)}</ItemGroup></Section>}
          <Section title="Other work in progress" hint="plan tasks being done outside a run">
            <ItemGroup>{otherWork.map((w) => (
              <Item key={w.task} variant="muted" size="sm">
                <ItemContent><ItemTitle>{w.title}</ItemTitle><ItemDescription><span className="font-mono">{w.task}</span> · thread {w.thread} · since {w.since}</ItemDescription></ItemContent>
              </Item>
            ))}</ItemGroup>
          </Section>
        </div>
      </div>
    </>
  );
};
