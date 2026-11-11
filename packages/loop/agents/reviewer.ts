// The reviewer, as the loop runs it. Its standing instructions are the role file Claude Code's own subagent of that name reads.
import { defineAgent } from "../src/modules/definitions/service.ts";

export default defineAgent({
  name: "reviewer",
  description: "Reads the builder's change against the task and the repository's rules. Approves or asks for changes.",
  model: "gpt-6.1-terra",
  side: "checker",                         // --checker-model replaces its model, never --model: a check stays on another model than the work
  instructions: "../../../.claude/agents/reviewer.md",
  tools: ["read", "bash", "record_terminal", "browser", "screenshot", "record_screen"],
  shell: "read",                            // its shell only reads; what it runs, it runs recorded, and that is undone after it
});
