/** The bar at the top of every screen: the sidebar's button, where you are, and the screen's own actions. */
import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export const TopBar = ({ crumbs, children }: { crumbs: ReactNode[]; children?: ReactNode }) => (
  <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
    <SidebarTrigger />
    <Separator orientation="vertical" className="mr-1 h-4" />
    <nav className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
      {crumbs.map((c, i) => (
        <span key={i} className={i === crumbs.length - 1 ? "min-w-0 truncate font-medium" : "shrink-0 text-muted-foreground"}>
          {c}{i < crumbs.length - 1 && <span className="ml-1.5 text-muted-foreground/50">/</span>}
        </span>
      ))}
    </nav>
    <div className="flex shrink-0 items-center gap-2">{children}</div>
  </header>
);
