/** The left side: where you are, and every run one click away, grouped by what it needs from you. */
import { Bot, ChevronDown, ExternalLink, LayoutDashboard } from "lucide-react";
import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, useSidebar } from "@/components/ui/sidebar";
import { Dot, toneOf } from "./bits.tsx";
import { elapsed, group, roleLabel, statusText, workingAgent } from "./data.ts";
import { duration } from "./format.ts";
import { href } from "./router.ts";
import type { Link } from "./live.ts";
import type { Run } from "./types.ts";

const RunItem = ({ run, active, step }: { run: Run; active: boolean; step?: string }) => {
  const working = workingAgent(run);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton size="lg" isActive={active} render={<a href={href("runs", run.id)} />}>
        <Dot tone={run.superseded ? "muted" : toneOf(run.status)} pulse={run.status === "running"} />
        <span className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate text-sm font-medium">{run.task.title}</span>
          <span className="truncate text-xs text-muted-foreground">{run.superseded ? (/closed in the plan/.test(run.superseded) ? "Task closed" : "Replaced") : statusText[run.status]} · {run.round > 0 ? `round ${run.round} · ` : ""}{duration(elapsed(run))}</span>
        </span>
      </SidebarMenuButton>
      {working && (
        <SidebarMenuSub>
          <SidebarMenuSubItem>
            <SidebarMenuSubButton isActive={active && step === working.key} render={<a href={href("runs", run.id, working.key)} />}>
              <Bot /> <span className="truncate">{roleLabel[working.role] ?? working.role} is working</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
};

/** Which groups a person folded, kept in this browser. A convenience: the page works the same without it. */
const FOLDED = "runs.folded";
const readFolded = (): string[] => { try { return JSON.parse(window.localStorage.getItem(FOLDED) ?? "[]") as string[]; } catch { return []; } };

/** One group of runs that folds: its label is the switch, with how many it holds. */
const RunGroup = ({ label, list, route }: { label: string; list: Run[]; route: string[] }) => {
  const [open, setOpen] = useState(() => !readFolded().includes(label));
  const fold = (next: boolean): void => {
    setOpen(next);
    try { window.localStorage.setItem(FOLDED, JSON.stringify(next ? readFolded().filter((x) => x !== label) : [...new Set([...readFolded(), label])])); } catch { /* not kept: fine */ }
  };
  return (
    <Collapsible open={open} onOpenChange={fold}>
      <SidebarGroup>
        <SidebarGroupLabel render={<CollapsibleTrigger />} className="cursor-pointer hover:text-sidebar-foreground">
          {label} · {list.length}
          <ChevronDown className={open ? "ml-auto transition-transform" : "ml-auto -rotate-90 transition-transform"} />
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>{list.map((run) => <RunItem key={run.id} run={run} active={route[0] === "runs" && route[1] === run.id} step={route[2]} />)}</SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
};

export const AppSidebar = ({ runs, route, replay, setReplay, link, updates }: { runs: Run[]; route: string[]; replay: boolean; setReplay: (on: boolean) => void; link: Link; updates: number }) => {
  const { setOpenMobile } = useSidebar();
  useEffect(() => setOpenMobile(false), [route.join("/"), setOpenMobile]);
  const groups: [string, Run[]][] = [["Running", runs.filter((r) => group(r) === "running")], ["Needs you", runs.filter((r) => group(r) === "needs")], ["Finished", runs.filter((r) => group(r) === "done")]];
  return (
    <Sidebar>
      <SidebarHeader>
        <a href={href()} className="flex items-center gap-2 px-2 py-1.5">
          <span className="size-5 rounded-md bg-foreground" />
          <span className="font-semibold">Capxul</span>
          <span className="rounded-full border px-2 text-xs text-muted-foreground">runs</span>
        </a>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem><SidebarMenuButton isActive={route.length === 0} render={<a href={href()} />}><LayoutDashboard /> <span>Now</span></SidebarMenuButton></SidebarMenuItem>
              <SidebarMenuItem><SidebarMenuButton isActive={route[0] === "agents"} render={<a href={href("agents")} />}><Bot /> <span>Agents</span></SidebarMenuButton></SidebarMenuItem>
              <SidebarMenuItem><SidebarMenuButton render={<a href="/plan/" />}><ExternalLink /> <span>Plan, in the portal</span></SidebarMenuButton></SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {groups.filter(([, list]) => list.length > 0).map(([label, list]) => <RunGroup key={label} label={label} list={list} route={route} />)}
      </SidebarContent>
      <SidebarFooter>
        {link === "live" ? (
          <p className="flex items-center gap-2 px-2 pb-1 text-xs text-muted-foreground"><Dot tone="live" pulse /> Live from the host · {updates} updates</p>
        ) : (
          <>
            <p className="flex items-center gap-2 px-2 text-xs text-amber-700"><Dot tone="warn" /> {link === "connecting" ? "Looking for the host…" : "The host is not running: pnpm loop serve"}</p>
            <label className="flex items-center gap-2 px-2 text-xs text-muted-foreground"><input type="checkbox" checked={replay} onChange={(e) => setReplay(e.target.checked)} /> Show a recording of 10 November's runs</label>
            {replay && <p className="px-2 pb-1 text-xs text-muted-foreground">A recording, not live: one run replays as if it were working.</p>}
          </>
        )}
      </SidebarFooter>
    </Sidebar>
  );
};
