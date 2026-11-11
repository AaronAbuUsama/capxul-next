// The adversary, as the loop runs it. Its standing instructions are the role file Claude Code's own subagent of that name reads.
import { defineAgent } from "../src/modules/definitions/service.ts";

export default defineAgent({
  name: "adversary",
  description: "A second checker on money tasks: tries to break the change and reports only what lands.",
  model: "gpt-6.1-terra",
  side: "checker",                         // --checker-model replaces its model, never --model: a check stays on another model than the work
  instructions: "../../../.claude/agents/adversary.md",
  tools: ["read", "bash", "record_terminal", "browser", "screenshot", "record_screen"],
  shell: "read",
});
