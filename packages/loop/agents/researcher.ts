// The researcher, as the loop runs it. Its standing instructions are the role file Claude Code's own subagent of that name reads.
import { defineAgent } from "../src/modules/definitions/service.ts";

export default defineAgent({
  name: "researcher",
  description: "Answers one question from the repository, with sources and a recommendation. Changes nothing.",
  model: "gpt-6.1-sol",
  instructions: "../../../.claude/agents/researcher.md",
  tools: ["read", "bash", "record_terminal", "browser", "screenshot", "record_screen"],
  shell: "read",
});
