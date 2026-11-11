## What
In packages/loop/src/modules/agents/internal/policy.ts, confine checks only that a tool is one the agent's definition gives it; remove the command and path checks, the allow-lists in capxul/internal/config.ts and their tests; the Runs page stops showing refused calls
## Why
Aaron's decision, 11 Nov: no allow-list, no home-made sandbox. This session's Auto mode refused the edit as 'Security Weaken'; it waits for a session in Bypass mode
## Done when
- pnpm loop:test passes and no agent call is refused for its command or path
