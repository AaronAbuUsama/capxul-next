// The builder, as the loop runs it. Its standing instructions are the role file Claude Code's own subagent of that name reads.
import { defineAgent } from "../src/modules/definitions/service.ts";

export default defineAgent({
  name: "builder",
  description: "Makes the task's change in its lane, runs the checks itself, and hands back a note and a handover.",
  model: "gpt-6.1-sol",
  instructions: "../../../.claude/agents/builder.md",
  tools: ["read", "write", "edit", "bash", "record_terminal", "browser", "screenshot", "record_screen"],
  shell: "write",                           // what it leaves in its lane is committed as its work
});
