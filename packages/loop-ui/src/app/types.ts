/** A run as the host hands it to the page. In the prototype it is read from a file exported from real runs. */
export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
export interface Msg {
  id: number; role: "user" | "assistant" | "tool"; at: number | null; text: string;
  thinking?: string; calls?: ToolCall[]; error?: string | null; tokensIn?: number; tokensOut?: number;
  callId?: string; name?: string; isError?: boolean; refused?: boolean; durationMs?: number | null;
}
export interface Usage { turns: number; tools: Record<string, number>; refused: number; errors: number; tokensIn: number; tokensOut: number }
export interface Agent {
  key: string; role: string; model: string | null; tools: string[]; extensions: string[]; instructions: string;
  state: "working" | "failed" | "done"; failure: { reason?: string; detail: string } | null;
  startedAt: number | null; endedAt: number | null; usage: Usage; messages: Msg[];
}
export interface Finding { id?: string; check?: string; severity: string; where?: { path: string; line?: number }; text: string }
export interface Check { name: string; ok: boolean; tail: string }
export interface Handback { submit?: { note: string }; handover?: { done: string[]; left: string[]; decisions: string[]; where: string[] }; ask?: { text: string } }
export interface Changes { commit: string; subject: string; stat: string; diff: string }
export interface RawStep {
  name: string; state: string; checks?: Check[]; review?: { verdict: string; findings: Finding[]; fixed: string[] };
  said?: { ok: boolean; error: string | null; head: string; tokens: number; json: unknown }; result?: unknown; end?: string; reasons?: string[];
  changes?: Changes | null;
}
export type RunStatus = "running" | "ready" | "answered" | "blocked" | "failed" | "stopped" | "merged";
export interface Run {
  id: string; task: { id: string; title: string; goal: string }; workflow: string; status: RunStatus; round: number; rounds: number | null;
  startedAt: string; endedAt: string | null; updatedAt: string; tokens: number; branch: string | null; base: string | null;
  reasons: string[]; error: string | null; step: string | null; steps: RawStep[]; agents: Agent[]; replay?: boolean;
}

export type StepKind = "overview" | "setup" | "builder" | "changes" | "checks" | "reviewer" | "publish" | "end";
export type StepState = "done" | "attention" | "running" | "pending";
/** One row of a run's timeline: a step of the workflow, with what it left behind. */
export interface Step {
  id: string; kind: StepKind; title: string; round: number | null; state: StepState; summary: string;
  agent?: Agent; checks?: Check[]; review?: RawStep["review"]; handback?: Handback | null; error?: string | null; commit?: string; reasons?: string[]; changes?: Changes; at?: number | null;
}
export interface Handoff { after: number; sent: Finding[]; fixed: number }
