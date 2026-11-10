/**
 * The plan module's types: the plan as the coordinator writes it, the facts about the blueprint it is checked against, the
 * commands that change it, and what comes back. Nothing here reads a file or the clock.
 *
 * The plan is authored, never computed: the critical path is the coordinator's own ordered list and its own words
 * (portal.plan-page). Nothing in this module sorts it, infers it or repairs it.
 */

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export type ExitState = "open" | "met";
/** One line of what must be true: a goal's or a milestone's. `evals` names eval ids of the blueprint that count towards it. */
export interface ExitLine {
  readonly id: string;
  readonly claim: string;
  readonly state: ExitState;
  readonly evidence?: string;
  readonly evals?: readonly string[];
}

export interface Goal {
  readonly title: string;
  readonly why: string;
  readonly exit: readonly ExitLine[];
}

export type MilestoneState = "todo" | "current" | "done";
export interface Milestone {
  readonly id: string;
  readonly title: string;
  readonly goal: string;
  readonly exit: readonly ExitLine[];
  readonly state: MilestoneState;
  /** Position in the plan, from 1. A milestone is "before" another when its order is lower. */
  readonly order: number;
  /** Blueprint concepts whose derived evals count towards this milestone. */
  readonly concepts?: readonly string[];
}

export type TaskState = "todo" | "doing" | "blocked" | "done" | "dropped";
export type Blocker =
  | { readonly decision: string }
  | { readonly need: string; readonly who: string };
export interface Task {
  readonly id: string;
  readonly title: string;
  readonly why: string;
  readonly milestone: string;
  readonly state: TaskState;
  /** The session or agent working on it. */
  readonly thread?: string;
  readonly needs: readonly string[];
  readonly blockedBy?: Blocker;
  /** Blueprint record keys it concerns, as `kind:id`. */
  readonly records: readonly string[];
  /** Eval ids of the blueprint that say it is done: it is done when they pass in a run (`pnpm evals`), not when an agent says so. */
  readonly evals?: readonly string[];
  /** Commits or paths. */
  readonly evidence: readonly string[];
  readonly droppedWhy?: string;
  readonly created: string;
  readonly updated: string;
}

/** The critical path of the current milestone: ordered task ids, and why, in the coordinator's words. */
export interface CriticalPath {
  readonly tasks: readonly string[];
  readonly why: string;
  readonly written: string;
}

export interface Note {
  readonly date: string;
  readonly by: string;
  readonly text: string;
}

export interface Plan {
  readonly goal: Goal;
  readonly milestones: readonly Milestone[];
  readonly tasks: readonly Task[];
  readonly path: CriticalPath;
  /** Oldest first; the last is the page's opening. */
  readonly notes: readonly Note[];
}

// ── the owner's answers (plan/answers.jsonl, append only) ───────────────────────────────────

/** What an answer is about: a decision that waits in the blueprint, or a task of the plan blocked on a need. */
export interface Target { readonly kind: "decision" | "task"; readonly id: string }
/** The owner's answer: accept the recommendation, choose another option, change it in words; or for a task, done or words. */
export type How =
  | { readonly how: "accept" }
  | { readonly how: "choose"; readonly option: string }
  | { readonly how: "change"; readonly text: string }
  | { readonly how: "done" }
  | { readonly how: "text"; readonly text: string };
/** One line of `plan/answers.jsonl`. */
export interface Answer { readonly type: "answer"; readonly id: string; readonly at: string; readonly target: Target; readonly answer: How }
/** An undo: a second line that withdraws an answer; the file is never rewritten. */
export interface Withdrawal { readonly type: "withdraw"; readonly id: string; readonly at: string; readonly answer: string }
export type AnswerLine = Answer | Withdrawal;

/** What the plan is checked against: the blueprint, as sets of names. */
export interface Facts {
  readonly decisions: ReadonlySet<string>;
  /** Record keys, `kind:id`. */
  readonly records: ReadonlySet<string>;
  readonly evals: ReadonlySet<string>;
  readonly concepts: ReadonlySet<string>;
  /** Decisions that still wait for the owner in the blueprint (shared/waiting.ts): none yet when absent. */
  readonly waiting?: ReadonlySet<string>;
  /** The targets of answers the log says were applied. */
  readonly applied?: readonly Target[];
}

/** One thing wrong with the plan. `at` is the task, milestone or exit line it concerns. */
export interface Problem { readonly at: string; readonly why: string }

export interface TaskFields {
  readonly title?: string;
  readonly why?: string;
  readonly milestone?: string;
  readonly needs?: readonly string[];
  readonly records?: readonly string[];
  readonly evals?: readonly string[];
  readonly thread?: string;
}

/** Every change the CLI can make. */
export type Command =
  | { readonly kind: "note"; readonly text: string }
  | { readonly kind: "goal.set"; readonly title?: string; readonly why?: string }
  | { readonly kind: "exit.add"; readonly owner: string; readonly id: string; readonly claim: string; readonly evals?: readonly string[] }
  | { readonly kind: "exit.met"; readonly owner: string; readonly id: string; readonly evidence: string }
  | { readonly kind: "milestone.add"; readonly id: string; readonly title: string; readonly goal: string; readonly order?: number; readonly concepts?: readonly string[] }
  | { readonly kind: "milestone.current"; readonly id: string }
  | {
    readonly kind: "task.add"; readonly id: string; readonly title: string; readonly why: string; readonly milestone: string;
    readonly needs?: readonly string[]; readonly records?: readonly string[];
    /** What the task is, and when it is done: both are needed unless `detailFile` gives the whole file. */
    readonly what?: string; readonly doneWhen?: readonly string[];
    /** The path of a Markdown file to use as the task's file; `detail` is its content, read by the caller. */
    readonly detailFile?: string; readonly detail?: string;
  }
  | { readonly kind: "task.start"; readonly id: string; readonly thread: string }
  | { readonly kind: "task.block"; readonly id: string; readonly blocker: Blocker }
  | { readonly kind: "task.unblock"; readonly id: string }
  | { readonly kind: "task.done"; readonly id: string; readonly evidence?: string }
  | { readonly kind: "task.drop"; readonly id: string; readonly why: string }
  | { readonly kind: "task.edit"; readonly id: string; readonly fields: TaskFields }
  | { readonly kind: "path.set"; readonly tasks: readonly string[]; readonly why: string };

/** Who, when and at which commit: the caller's, so the module stays free of the clock and of git. */
export interface Ctx {
  readonly by: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** ISO time of the change. */
  readonly at: string;
  readonly commit: string;
}

/** One line of `plan/log.jsonl`. */
export interface LogEntry {
  readonly at: string;
  readonly by: string;
  readonly action: string;
  readonly args: unknown;
  readonly commit: string;
}

/** A file a command creates: the task's or milestone's explanation, from a stub. Written by the caller, never overwritten. */
export interface Write { readonly path: string; readonly content: string }

export interface Applied {
  readonly writes?: readonly Write[];
  readonly plan: Plan;
  readonly entry: LogEntry;
  readonly message: string;
}

/** The explanation of the plan, as Markdown files beside plan.json: plan/outline.md, plan/milestones/<id>.md, plan/tasks/<id>.md. */
export interface PlanFiles {
  readonly outline: string | null;
  readonly milestones: Readonly<Record<string, string>>;
  readonly tasks: Readonly<Record<string, string>>;
}

/** What the Plan page is drawn from: the plan and its files, the whole log, and what `check` says about it. */
export interface PlanInput {
  readonly plan: Plan;
  readonly files: PlanFiles;
  /** Every line of plan/log.jsonl, oldest first. */
  readonly log: readonly LogEntry[];
  readonly problems: readonly Problem[];
}

export const EMPTY_PLAN: Plan = {
  goal: { title: "", why: "", exit: [] }, milestones: [], tasks: [], path: { tasks: [], why: "", written: "" }, notes: [],
};
