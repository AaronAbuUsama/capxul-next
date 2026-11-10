/** Small parts used on every screen: a run's status, a step's state, an icon per kind of step. */
import { Ban, CircleAlert, CircleCheck, CircleDashed, Eye, FileDiff, Flag, GitBranch, Hammer, LayoutList, ListChecks, LoaderCircle, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { statusText } from "./data.ts";
import type { Run, Step, StepKind, StepState } from "./types.ts";

export const Dot = ({ tone, pulse }: { tone: "live" | "warn" | "muted"; pulse?: boolean }) => (
  <span className={cn("inline-block size-2 shrink-0 rounded-full", tone === "live" ? "bg-blue-600" : tone === "warn" ? "bg-amber-600" : "bg-muted-foreground/40", pulse && "animate-pulse")} />
);

export const toneOf = (status: Run["status"]): "live" | "warn" | "muted" => status === "running" ? "live" : status === "blocked" || status === "failed" || status === "stopped" ? "warn" : "muted";

export const RunBadge = ({ run }: { run: Run }) => {
  const tone = toneOf(run.status);
  return (
    <Badge variant={tone === "warn" ? "destructive" : tone === "live" ? "default" : "secondary"} className={cn("gap-1.5", tone === "live" && "bg-blue-600 text-white", tone === "warn" && "bg-amber-600/10 text-amber-700")}>
      {tone === "live" && <span className="size-1.5 animate-pulse rounded-full bg-white" />}
      {statusText[run.status]}
    </Badge>
  );
};

export const StateIcon = ({ state, className }: { state: StepState; className?: string }) =>
  state === "running" ? <LoaderCircle className={cn("size-4 animate-spin text-blue-600", className)} />
  : state === "attention" ? <CircleAlert className={cn("size-4 text-amber-600", className)} />
  : state === "pending" ? <CircleDashed className={cn("size-4 text-muted-foreground/50", className)} />
  : <CircleCheck className={cn("size-4 text-muted-foreground", className)} />;

const KIND: Record<StepKind, typeof Hammer> = { overview: LayoutList, setup: GitBranch, builder: Hammer, changes: FileDiff, checks: ListChecks, reviewer: Eye, publish: Upload, end: Flag };
export const KindIcon = ({ kind, className }: { kind: StepKind; className?: string }) => { const I = KIND[kind]; return <I className={cn("size-4", className)} />; };
export const RefusedIcon = Ban;
export const stepLabel = (s: Step): string => (s.round !== null && (s.kind === "builder" || s.kind === "reviewer") ? `${s.title} · round ${s.round}` : s.title);
