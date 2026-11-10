/** The shell: the sidebar, a top bar, and the screen the address names. */
import { useMemo, useState } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentsPage } from "./AgentsPage.tsx";
import { AppSidebar } from "./AppSidebar.tsx";
import { hasLive, runsOf } from "./data.ts";
import { Home } from "./Home.tsx";
import { useLive } from "./live.ts";
import { useRoute } from "./router.ts";
import { RunPage } from "./RunPage.tsx";

export const App = () => {
  const route = useRoute();
  const [replay, setReplay] = useState(!hasLive);
  const live = useLive();
  const recorded = useMemo(() => runsOf(replay), [replay]);
  const runs = live.runs ?? recorded;
  const run = route[0] === "runs" ? runs.find((r) => r.id === route[1]) : undefined;
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar runs={runs} route={route} replay={replay} setReplay={setReplay} link={live.link} updates={live.updates} />
        <SidebarInset className="h-svh min-w-0 overflow-hidden">
          {run ? <RunPage key={run.id} run={run} runs={runs} step={route[2]} tab={route[3]} stop={live.runs ? live.stop : undefined} /> : route[0] === "agents" ? <AgentsPage runs={runs} role={route[1]} /> : <Home runs={runs} />}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
};
