/** The shell: the sidebar, a top bar, and the screen the address names. */
import { useMemo, useState } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentsPage } from "./AgentsPage.tsx";
import { AppSidebar } from "./AppSidebar.tsx";
import { runsOf } from "./data.ts";
import { Home } from "./Home.tsx";
import { useRoute } from "./router.ts";
import { RunPage } from "./RunPage.tsx";

export const App = () => {
  const route = useRoute();
  const [replay, setReplay] = useState(true);
  const runs = useMemo(() => runsOf(replay), [replay]);
  const run = route[0] === "runs" ? runs.find((r) => r.id === route[1]) : undefined;
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar runs={runs} route={route} replay={replay} setReplay={setReplay} />
        <SidebarInset className="h-svh min-w-0 overflow-hidden">
          {run ? <RunPage key={run.id} run={run} step={route[2]} tab={route[3]} /> : route[0] === "agents" ? <AgentsPage runs={runs} role={route[1]} /> : <Home runs={runs} />}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
};
