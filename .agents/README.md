# .agents

Amp reads this folder (https://ampcode.com/docs/orbs/customizing, https://ampcode.com/docs/customize/skills).

- `setup` runs once to build an orb's snapshot: `pnpm install`, then `packages/devnet/cloud/setup.sh` (Foundry, solc
  0.8.28 and 0.8.24, Docker Compose). `resume` runs each time an orb starts or wakes and starts Docker. Their logs are
  in `~/.cache/amp/logs/` in the orb.
- `skills/` holds the coordinator's skills: `coordinate` (the sweep), `dispatch` (one orb thread per task),
  `plan-tasks`, `ask-aaron` and `portal-ops`. `.claude/skills` links here, so Claude Code reads the same ones.

How to run the product stack and the evals in an orb: `docs/handoff-amp.md`.
