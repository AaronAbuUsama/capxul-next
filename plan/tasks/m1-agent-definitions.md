## What
Bring in var/stranded/agents-rollup-91c899.patch (loops/agents/, modules/definitions, capxul/internal/agents.ts) rebased onto the new command policy (be9a917); the five profiles behave as before. packages/loop and packages/loop-ui
## Why
Aaron, 10 Nov: create agents in the UI, code mode, PostHog MCP, enrichment agents; all need an agent as a record. The agents-rollup session's first slice
## Done when
- pnpm loop:test passes with the five definitions
- The Runs app's Agents page lists the definitions by name, model and tools
