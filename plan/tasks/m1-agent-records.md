## What
Bring in archive/stranded/agents-rollup-91c899.patch (loops/agents/, modules/definitions, capxul/internal/agents.ts), rebased by hand onto the loop as it is now (the command policy of be9a917, the push retry of 3b7a2ff). The five profiles behave as before. Touch packages/loop and packages/loop-ui only; nothing under blueprint/ or packages/plan (other runs have them). When it is in, delete archive/stranded/agents-rollup-91c899.patch.
## Why
Aaron, 10 Nov: create agents in the UI, code mode, PostHog MCP, enrichment agents; all need an agent as a record. The agents-rollup session's first slice
## Done when
- pnpm loop:test passes with the five definitions
- The Runs app's Agents page lists the definitions by name, model and tools
- pnpm layout passes
