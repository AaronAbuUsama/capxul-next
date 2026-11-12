# .agents

Amp reads this folder (https://ampcode.com/docs/orbs/customizing, https://ampcode.com/docs/customize/skills).

- `setup` prepares the snapshot through `packages/devnet/orb/setup.sh`: pinned native toolchains, frozen dependencies,
  contract artifacts and the six-app bench/backing images. It does not seed company databases or authenticate users.
- `resume` starts Docker without changing socket permissions. Their logs are in `~/.cache/amp/logs/` in the orb.
- `skills/` holds the coordinator's skills: `coordinate` (the sweep), `dispatch` (one orb thread per task),
  `plan-tasks`, `ask-aaron` and `portal-ops`. `.claude/skills` links here, so Claude Code reads the same ones.

The current runtime contract and verification limits are in `packages/devnet/orb/README.md`; `docs/handoff-amp.md`
describes the wider handover. Changing a local setup file does not publish it to future orbs.
