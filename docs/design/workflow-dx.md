# Workflow DX

A workflow should make it obvious which agents run, what they can use, and how to talk to them. Call the package and CLI **workflow**. Keep the workflow itself as readable TypeScript.

**All APIs below are proposals.** This is the desired authoring experience, not documentation of an implemented API.

## 1. Prepare a workflow

Keep everything you edit together:

```text
workflows/
  build.ts
  agents/
    builder.ts
    builder.md
  skills/
    implement/
      SKILL.md
      references/
      scripts/
```

The workflow describes the sequence. The agent definition configures the model, instructions, tools, MCP servers and skills.

## 2. Define an agent

```ts
// workflows/agents/builder.ts
import { defineAgent } from "@capxul/workflow";

export default defineAgent({
  name: "builder",
  model: "gpt-6.1-sol",
  instructions: "./builder.md",

  tools: ["read", "write", "edit", "bash"],

  mcp: {
    codebase: {
      transport: "stdio",
      command: "codebase-memory-mcp", // illustrative server executable
      tools: ["search_graph", "get_code_snippet", "trace_path"]
    }
  },

  skills: ["../skills/implement/SKILL.md"]
});
```

This is the authoritative definition. Model and tool settings must work where they are declared. File paths resolve relative to this definition file.

**MCPs provide callable tools.** The runtime connects the configured server, exposes the selected tools to this agent and closes the connection when its owner shuts down. Connection settings can reference environment-variable names for credentials; credentials do not belong in the definition or conversation.

**Skills provide reusable instructions and supporting files.** For example:

```md
---
name: implement
description: Implement a bounded change and verify it against its acceptance criteria.
---

Read the task and surrounding code before editing.
Make the smallest complete change.
Run the relevant checks and report their actual results.
```

The agent sees available skill names and descriptions, then loads a skill's full instructions and referenced files when it uses that skill. Scripts are available to run through permitted tools; registering a skill does not automatically execute them or grant more permissions.

## 3. Write the workflow

```ts
// workflows/build.ts
import { defineWorkflow } from "@capxul/workflow";
import builder from "./agents/builder.ts";

export default defineWorkflow({
  name: "build",
  agents: { builder },

  async run(ctx) {
    const workspace = await ctx.worktree();

    // Open the durable builder session for this run.
    const agent = await ctx.agents.builder.open({ workspace });

    // Send input; receive a handle to that particular turn.
    const turn = await agent.send({
      id: "build.1",
      text: ctx.input,
      whenBusy: "queue"
    });

    const result = await turn.wait();
    if (!result.ok) return ctx.fail(result.error);

    return ctx.output(result.text);
  }
});
```

`open()` creates or retrieves the session; it does not send a prompt. `send()` submits input. `wait()` waits for that input's result.

Within this run, opening `builder` again retrieves the same durable conversation. A different run has its own builder. Multiple builders within one run need explicit session IDs.

A build-and-review workflow can add a reviewer definition and sequence the work explicitly: builder → commit → checks → reviewer → repair or publish. Commit and push should be visible operations in the script.

Research uses the same interface with a read-only researcher definition and an answer as its output.

## 4. Start it and find its agents

```bash
pnpm workflow run build --input "Implement the task described in …"
# run: run_123
# agent: builder

pnpm workflow agents run_123
# builder   running   model: gpt-6.1-sol   workspace: …

pnpm workflow watch run_123 builder
pnpm workflow messages run_123 builder
pnpm workflow result run_123
```

The durable address is **run ID + session ID**: `run_123 / builder`. A role name such as builder is a definition; this address identifies the actual conversation.

## 5. Connect to that specific durable agent

From another process:

```ts
import { connect } from "@capxul/workflow";

const run = await connect({ runId: "run_123" });
const builder = await run.agent("builder");

console.log(await builder.status());
console.log(await builder.messages());

const turn = await builder.send({
  id: "follow-up-1",
  text: "Focus on permissions. Leave the UI for later.",
  whenBusy: "steer"
});

const result = await turn.wait();
```

Or from the CLI:

```bash
pnpm workflow send run_123 builder --steer "Focus on permissions."
pnpm workflow send run_123 builder --queue "Then check the error cases."
pnpm workflow stop run_123 builder
```

`steer` supplies input to ongoing work. `queue` schedules another turn after the active turn. When idle, either submits a new turn. Input IDs make a retry of the same submission identifiable; repeated delivery must not create duplicate turns.

The same session handle should expose lifecycle hooks:

```ts
for await (const event of builder.events()) {
  // Messages, tool activity and session status changes.
  console.log(event);
}
```

`connect()` routes input through the process that owns the run. It must not create a competing SQLite writer. If that process is gone, report the run as offline and require explicit recovery.

## 6. After completion

History and results remain readable. Further work is explicit:

```bash
pnpm workflow continue run_123 builder --input "Now check the edge cases."
```

Continuation reopens the chosen conversation and records a new execution linked to the previous one. The earlier result remains intact. Workspace availability is checked before work starts; a removed worktree requires an explicit replacement.

Stopping one agent must give its waiting workflow a clear stopped result. It must never count as approval to commit, publish or merge.

## What needs building

The current runner already has [durable conversations and input submission](../../packages/loop/src/modules/agents/service.ts#L38), plus a [stdio MCP tool adapter](../../packages/loop/src/modules/agents/internal/mcp.ts#L1). Its public agent helper waits for completion and hides the conversation handle. It does not expose the skill configuration, session connection, messaging or continuation interface shown here.

The DX work is to expose those capabilities through one consistent interface: **define an agent, open its durable session, send input, observe it, and retrieve the result.**
