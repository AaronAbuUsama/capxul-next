## What
A new package, packages/ops, with `pnpm ops <start|stop|restart|status> [service|all]` and `pnpm ops reap`, the one owner of every long-running process this project starts on the Mac. Follow ~/AGENTS.md's module shape (src/main.ts as the composition root; src/modules/ops/ with README.md, types.ts, service.ts, internal/, ops.test.ts; errors as values; the process table, spawning and signals injected so the tests use fakes).
Services, each with the command it runs today (see .claude/skills/portal-ops/SKILL.md and .claude/launch.json): portal (generate, then serve on 4391 with PORTAL_ALLOW_HOSTS=macbook.tail4b9a40.ts.net:8443), host (`loop serve --port 4392` with LOOP_HOST_ORIGINS), alerts (`loop alerts`), chain and core (spikes/skeleton/core/bin/up.sh and down.sh: anvil 8545 and the Core stub 8787).
- Each service runs detached with its output in var/ops/<service>.log and its pid and start command in var/ops/<service>.json. `status` prints each service: running or not, pid, uptime, port answering, and the checkout it was started from.
- `stop` sends SIGTERM, waits up to 10 s, then SIGKILL, and only to a pid it recorded or a process listening on the service's port whose command matches the service.
- Start only from the main checkout (refuse inside a worktree: its .git is a file). Refuse to start when the port is held by a process from another checkout, naming it and saying `pnpm ops reap`.
- `reap` stops this project's processes started from other checkouts: any process whose command line or working directory is under this repository's .claude/worktrees/ or var/runs/*/lane, and any `loop watch` older than 12 hours. It prints each one before stopping it; `reap --dry-run` only prints.
Also: `pnpm loop watch` gets `--until-idle` (exit when no run is running for 60 s), and the coordinate and portal-ops skills say to use `pnpm ops` and never raw kill. Add `ops` to the root package.json scripts.
## Why
Aaron, 11 November: asking him to run commands is not acceptable. Three times a session could not stop a stray process (old servers, a leftover watcher, a stale test chain from an old worktree), because the session's permission check refuses raw kills. One project command that owns the processes removes the need.
## Done when
- pnpm --filter @capxul/ops test passes: start, stop by pidfile, refusing a foreign port holder, reap of worktree processes with dry-run, refusing to start in a worktree; all with a fake process table
- pnpm layout and pnpm loop:test pass
