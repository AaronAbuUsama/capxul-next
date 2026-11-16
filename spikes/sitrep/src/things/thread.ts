// The thing "thread": one agent conversation, in any agent. The types are the threads skill's.
import * as Schema from "effect/Schema";
import { ThreadId, Title, Url, stamp, type Allowed, machine } from "../language.ts";
import { LaneId } from "./step.ts";

export const ThreadType = Schema.Literals(["conductor", "lead", "author", "builder", "reviewer", "designer", "triage", "keeper", "local"]);
export const Agent = Schema.Literals(["claude-code", "amp", "codex"]);

export const ThreadText = {
  type: ThreadType,
  title: Title,
  agent: Agent,
  link: Url,
  lane: Schema.optional(LaneId),
  parent: Schema.optional(ThreadId),
};

export class ThreadStarted extends Schema.TaggedClass<ThreadStarted>()("thread_started", { thread: ThreadId, ...stamp, ...ThreadText }) {}
export class ThreadWaiting extends Schema.TaggedClass<ThreadWaiting>()("thread_waiting", { thread: ThreadId, ...stamp }) {}
export class ThreadResumed extends Schema.TaggedClass<ThreadResumed>()("thread_resumed", { thread: ThreadId, ...stamp }) {}
export class ThreadArchived extends Schema.TaggedClass<ThreadArchived>()("thread_archived", { thread: ThreadId, ...stamp }) {}

const gone = { refusal: "ThreadArchived" } as const;

export const Thread = machine({
  name: "thread",
  key: "thread",
  states: ["active", "waiting", "archived"],
  start: { state: "active", by: "thread.start", event: ThreadStarted },
  moves: {
    wait: { from: ["active"], to: "waiting", by: "thread.wait", event: ThreadWaiting, otherwise: { waiting: "unchanged", archived: gone } },
    resume: { from: ["waiting"], to: "active", by: "thread.resume", event: ThreadResumed, otherwise: { active: "unchanged", archived: gone } },
    archive: { from: ["active", "waiting"], to: "archived", by: "thread.archive", event: ThreadArchived, otherwise: { archived: "unchanged" } },
  },
});

export const threadAllowed: Allowed = {
  thread_started: ["agent"],
  thread_waiting: ["agent"],
  thread_resumed: ["agent", "person"],
  thread_archived: ["agent", "person"],
};
