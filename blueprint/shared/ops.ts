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
  why: "Aaron's 11 November task m1-ops-supervisor requires a single project command. Only the main checkout starts services. Detached portal, host, alerts, chain and Core write logs and identity records under var/ops. Stop targets recorded identities or matching port listeners, waits ten seconds after TERM then KILL. Foreign checkout listeners refuse start with pnpm ops reap guidance. Reap prints before stopping only repository lane/worktree processes and project loop watchers older than twelve hours; dry-run sends no signals. loop watch --until-idle exits after sixty seconds without a running run. Chain and Core use the foreground commands of the spike scripts so the supervisor owns real service pids rather than short-lived launch scripts.",
  source: "Task m1-ops-supervisor; Aaron, 11 November: asking him to run commands is not acceptable.",
  affects: [system_capxul],
});
