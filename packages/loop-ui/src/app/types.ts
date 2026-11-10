/**
 * What the page works with. A run's data has one definition, in the loop (`@capxul/loop/wire`): the page imports it and
 * adds only what it derives for display: a timeline's rows and the handoffs between rounds.
 */
import type { AgentSession, Call, Capture, Changes, Entry, Judged, RunDetail, StepRecord } from "@capxul/loop/wire";

export type { Capture, Changes, Judged };
/** One thing an agent showed: a capture with the claim made about it, a capture nobody claimed, or a claim that named no capture. */
export interface Shown { capture: Capture | null; claim: Judged | null }
export type ToolCall = Call;
export type Msg = Entry;
export type Agent = AgentSession;
export type RawStep = StepRecord;
/** A run as the host serves it. `replay` marks a finished run shown as it stood mid-way (the prototype's recording). */
export type Run = RunDetail & { readonly replay?: boolean };
export type RunStatus = Run["status"];

/** A reviewer's finding, as the workflow's check shape has it (the loop carries findings as it found them). */
export interface Finding { id?: string; check?: string; severity: string; where?: { path: string; line?: number }; text: string }
export interface Review { verdict: string; findings: Finding[]; fixed: string[] }
export interface Check { name: string; ok: boolean; tail: string }
export interface Handback { submit?: { note: string }; handover?: { done: string[]; left: string[]; decisions: string[]; where: string[] }; ask?: { text: string } }

export type StepKind = "overview" | "setup" | "builder" | "changes" | "evidence" | "checks" | "reviewer" | "publish" | "end";
export type StepState = "done" | "attention" | "running" | "pending";
/** One row of a run's timeline: a step of the workflow, with what it left behind. */
export interface Step {
  id: string; kind: StepKind; title: string; round: number | null; state: StepState; summary: string;
  agent?: Agent; checks?: Check[]; review?: Review; handback?: Handback | null; error?: string | null; commit?: string; reasons?: string[]; changes?: Changes; at?: number | null; shown?: Shown[]; by?: string;
}
export interface Handoff { after: number; sent: Finding[]; fixed: number }
