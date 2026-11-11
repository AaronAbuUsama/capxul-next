import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { system_capxul } from "./foundation.ts";

export const decision_ops_owner = defineDecision({
  id: "tooling.ops-owner",
  title: "One Mac supervisor owns project services and reaps abandoned lanes",
  question: "How can sessions recover strays without asking Aaron to run raw signals?",
  options: [
    { label: "supervisor", text: "pnpm ops start, stop, restart, status and reap; inject process discovery, spawning and signals for fake-table tests." },
    { label: "manual", text: "Keep separate shell launch and kill instructions." },
  ],
  chosen: "supervisor",
  why: "Aaron's 11 November task m1-ops-supervisor requires a single project command. Only the main checkout starts services. Detached portal, host, alerts, chain and Core write logs and identity records under var/ops. Stop targets recorded identities or matching port listeners, waits ten seconds after TERM then KILL, including surviving members of an owned detached process group after its leader exits. Foreign checkout listeners refuse start with pnpm ops reap guidance. Reap prints before stopping only repository lane/worktree processes and project loop watchers older than twelve hours; dry-run sends no signals. loop watch --until-idle exits after sixty seconds without a running run; combining a run id with --until-idle is refused explicitly. Chain and Core use the foreground commands of the spike scripts so the supervisor owns real service pids rather than short-lived launch scripts.",
  source: "Task m1-ops-supervisor; Aaron, 11 November: asking him to run commands is not acceptable.",
  affects: [system_capxul],
});

export const decision_ops_group_shutdown = defineDecision({
  id: "tooling.ops-group-shutdown",
  title: "Wait for owned group survivors and reject unsupported run idle watch",
  question: "What survives a pnpm leader exiting during stop, and where does idle watch apply?",
  options: [
    { label: "group", text: "Discover process group ids; wait for the owned group, not just its leader. Refuse run-specific --until-idle." },
    { label: "leader", text: "Treat leader exit as service exit and silently ignore run-specific idle flags." },
  ],
  chosen: "group",
  why: "Task m1-ops-supervisor review F-1.1 and F-1.3: pnpm children can survive TERM after their parent exits. A detached group's id is the recorded leader pid; poll its members through the ten-second deadline and escalate surviving members. Idle means no running run globally, so --until-idle is only supported without a run id, with a clear CLI refusal otherwise.",
  source: "Task m1-ops-supervisor round 2 findings F-1.1 and F-1.3.",
  affects: [system_capxul],
});
