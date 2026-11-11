/**
 * The agents as things in their own right: each definition, what it is and may do, and every session it has run. What a
 * definition is comes from the runs themselves: each session carries the definition it ran under (`agent.definition`).
 */
import { useEffect, useState } from "react";
import { agentsUrl } from "./live.ts";
import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dot } from "./bits.tsx";
import { agentTime, roleLabel } from "./data.ts";
import { clock, duration, plural, tokens } from "./format.ts";
import { href } from "./router.ts";
import { TopBar } from "./TopBar.tsx";
import type { Agent, Run } from "./types.ts";

interface Session { run: Run; agent: Agent }
/** Every definition that ran in the runs on the page, by name, the one that ran last first. */
const rolesOf = (runs: Run[]): string[] => [...new Set(runs.flatMap((run) => run.agents).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)).map((a) => a.role))];
const label = (role: string): string => roleLabel[role] ?? role.replace(/^./, (c) => c.toUpperCase());
const sessionsOf = (runs: Run[], role: string): Session[] => runs.flatMap((run) => run.agents.filter((a) => a.role === role).map((agent) => ({ run, agent }))).sort((a, b) => (b.agent.startedAt ?? 0) - (a.agent.startedAt ?? 0));
const used = (s: Session[]): number => s.reduce((n, x) => n + x.agent.usage.tokensIn + x.agent.usage.tokensOut, 0);

interface Definition { name: string; description: string; model: string; tools: readonly string[] }
const Roster = ({ runs, definitions }: { runs: Run[]; definitions: Definition[] }) => (
  <div className="grid gap-3 md:grid-cols-2">
    {definitions.length === 0 && rolesOf(runs).length === 0 && <p className="text-sm text-muted-foreground md:col-span-2">No agent has run yet. An agent is listed here once a run uses its definition (<span className="font-mono">packages/loop/agents/</span>; <span className="font-mono">pnpm loop agents</span> lists them all).</p>}
    {[...new Set([...definitions.map((d) => d.name), ...rolesOf(runs)])].map((role) => {
      const current = definitions.find((d) => d.name === role);
      const sessions = sessionsOf(runs, role), working = sessions.filter((s) => s.agent.state === "working"), models = [...new Set(sessions.map((s) => s.agent.model))], defined = sessions[0]?.agent.definition;
      return (
        <a key={role} href={href("agents", role)}>
          <Card size="sm" className="h-full hover:bg-muted/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bot className="size-4" /> {label(role)} {working.length > 0 && <Badge className="gap-1.5 bg-blue-600 text-white"><span className="size-1.5 animate-pulse rounded-full bg-white" /> working</Badge>}</CardTitle>
              <CardDescription>{current?.description ?? defined?.description ?? ""}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="flex flex-wrap gap-1">{(current?.tools ?? defined?.tools ?? sessions[0]?.agent.tools ?? []).map((t) => <Badge key={t} variant="outline" className="font-mono">{t}</Badge>)}</p>
              {current && <p className="font-mono text-sm">{current.model}</p>}
              <p className="text-muted-foreground">{sessions.length === 0 ? "No sessions today" : `${plural(sessions.length, "session")} today · ${tokens(used(sessions))} tokens · ${models.join(", ")}`}</p>
            </CardContent>
          </Card>
        </a>
      );
    })}
  </div>
);

const Detail = ({ runs, role }: { runs: Run[]; role: string }) => {
  const sessions = sessionsOf(runs, role), sample = sessions[0]?.agent, defined = sample?.definition;
  return (
    <div className="space-y-6">
      <div><h2 className="text-xl font-semibold">{label(role)}</h2><p className="text-sm text-muted-foreground">{defined?.description ?? ""}</p></div>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Sessions</h3>
        <div className="divide-y rounded-lg border">
          {sessions.length === 0 && <p className="px-3 py-2.5 text-sm text-muted-foreground">No sessions today.</p>}
          {sessions.map(({ run, agent }) => (
            <a key={`${run.id}/${agent.key}`} href={href("runs", run.id, agent.key)} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50">
              <Dot tone={agent.state === "working" ? "live" : agent.state === "failed" ? "warn" : "muted"} pulse={agent.state === "working"} />
              <span className="grid min-w-0 flex-1 leading-tight"><span className="truncate font-medium">{run.task.title}</span><span className="truncate font-mono text-xs text-muted-foreground">{run.id} / {agent.key}</span></span>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{agent.model} · {plural(agent.usage.turns, "turn")} · {tokens(agent.usage.tokensIn + agent.usage.tokensOut)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{clock(agent.startedAt)} · {duration(agentTime(agent))}</span>
            </a>
          ))}
        </div>
      </section>
      {sample && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Definition</h3>
          <div className="rounded-lg border p-3 text-sm">
            <p className="flex flex-wrap items-center gap-1.5"><span className="text-muted-foreground">Model</span> <Badge variant="secondary">{sample.model}</Badge> <span className="ml-2 text-muted-foreground">Tools</span> {(defined?.tools ?? sample.tools).map((t) => <Badge key={t} variant="outline" className={sample.tools.includes(t) ? "font-mono" : "font-mono text-muted-foreground line-through"} title={sample.tools.includes(t) ? undefined : "Not handed over in its last session: this machine could not make it"}>{t}</Badge>)}</p>
            {defined && <p className="mt-2 flex flex-wrap items-center gap-1.5"><span className="text-muted-foreground">Shell</span> <Badge variant="secondary">{defined.shell === "write" ? "runs and commits in its lane" : defined.shell === "read" ? "only reads" : defined.shell}</Badge>{defined.sandbox && <><span className="ml-2 text-muted-foreground">Needs</span> <Badge variant="secondary">a {defined.sandbox} sandbox</Badge></>}</p>}
            <p className="mt-2 flex flex-wrap items-center gap-1.5"><span className="text-muted-foreground">Skills</span> {sample.skills && sample.skills.length > 0 ? sample.skills.map((s) => <Badge key={s} variant="secondary">{s}</Badge>) : <span className="text-muted-foreground">none</span>}</p>
            <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-muted p-2 text-xs leading-relaxed whitespace-pre-wrap">{sample.instructions}</pre>
          </div>
        </section>
      )}
    </div>
  );
};

export const AgentsPage = ({ runs, role }: { runs: Run[]; role?: string }) => {
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  useEffect(() => { let active = true; void fetch(agentsUrl()).then((r) => r.json()).then((v) => { if (active) setDefinitions(v.agents ?? []); }).catch(() => undefined); return () => { active = false; }; }, []);
  return (
  <>
    <TopBar crumbs={role ? [<a href={href("agents")}>Agents</a>, label(role)] : ["Agents"]} />
    <div className="flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-4xl p-4 md:p-6">{role ? <Detail runs={runs} role={role} /> : <Roster runs={runs} definitions={definitions} />}</div></div>
  </>
);
};
