/** The left side: where you are, and every run one click away, grouped by what it needs from you. */
import { Bot, ExternalLink, LayoutDashboard } from "lucide-react";
import { useEffect } from "react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, useSidebar } from "@/components/ui/sidebar";
import { Dot, toneOf } from "./bits.tsx";
import { elapsed, group, roleLabel, statusText, workingAgent } from "./data.ts";
import { duration } from "./format.ts";
import { href } from "./router.ts";
import type { Run } from "./types.ts";

const RunItem = ({ run, active, step }: { run: Run; active: boolean; step?: string }) => {
  const working = workingAgent(run);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton size="lg" isActive={active} render={<a href={href("runs", run.id)} />}>
        <Dot tone={toneOf(run.status)} pulse={run.status === "running"} />
        <span className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate text-sm font-medium">{run.task.title}</span>
          <span className="truncate text-xs text-muted-foreground">{statusText[run.status]} · {run.round > 0 ? `round ${run.round} · ` : ""}{duration(elapsed(run))}</span>
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

export const AppSidebar = ({ runs, route, replay, setReplay }: { runs: Run[]; route: string[]; replay: boolean; setReplay: (on: boolean) => void }) => {
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
        {groups.filter(([, list]) => list.length > 0).map(([label, list]) => (
          <SidebarGroup key={label}>
            <SidebarGroupLabel>{label} · {list.length}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{list.map((run) => <RunItem key={run.id} run={run} active={route[0] === "runs" && route[1] === run.id} step={route[2]} />)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <label className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={replay} onChange={(e) => setReplay(e.target.checked)} />
          Replay one real run as if it were live
        </label>
        <p className="px-2 pb-1 text-xs text-muted-foreground">Prototype: real runs of 10 November, read from a file. Nothing is sent.</p>
      </SidebarFooter>
    </Sidebar>
  );
};
