---
name: portal-ops
description: Keep the capxul-next portal and the loop host running on Aaron's Mac and reachable over Tailscale, check them, and recover them. Use at session start, from the hourly check, when a page is stale, or when Aaron cannot reach the portal.
---

# Portal ops

The portal runs only on the Mac, from the main checkout. A portal started from a worktree refuses answers.

**Use `pnpm ops`, never a raw kill.** `pnpm ops status` shows every service (portal, host, alerts, chain, core) with its pid, port and the checkout it runs from; `pnpm ops start|stop|restart <service|all>` runs them from the main checkout, with logs in `var/ops/`; `pnpm ops reap --dry-run`, then `pnpm ops reap`, stops this project's processes left by old worktrees and runs. The commands below are what `pnpm ops` runs.

| What | Command (from `.claude/launch.json`) | Port |
|---|---|---|
| Portal | `pnpm portal && PORTAL_ALLOW_HOSTS=macbook.tail4b9a40.ts.net:8443 pnpm portal:serve --port 4391` | 4391 |
| Loop host (Runs) | `LOOP_HOST_ORIGINS=https://macbook.tail4b9a40.ts.net:8443 pnpm loop serve --port 4392` | 4392 |
| Runs app (development only) | `pnpm --filter @capxul/loop-ui dev` | 4393 |

Tailscale serves `https://macbook.tail4b9a40.ts.net:8443` to `127.0.0.1:4391`. `/runs/` passes through to the host.

## Check

```bash
curl -sf -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4391/review/     # 200
curl -sf http://127.0.0.1:4392/runs/summary.json | head -c 200             # the runs
pnpm portal:check                                                          # every page and link
```

## The hourly check

It runs from a schedule outside the coordinator's session, so it still runs when that session is down.

- Both answer: do nothing and say nothing.
- One is down, and nobody stopped it on purpose: start it again with the command above, then check again. If it comes back, say nothing.
- It does not come back, or Tailscale does not answer: read the server's output, fix what you can, and tell Aaron in one message what was wrong and what you did. Changing Tailscale is his step, so give him the exact command.
- Someone stopped it on purpose: leave it stopped.

## Keep it current

- Run `pnpm portal` after every plan change, merge or eval run. The pages are generated, so a page is only as new as its last build.
- If an old process holds a port, `pnpm ops reap` (or `pnpm ops restart <service>`). Never start a second portal on another port, and never stop a process with kill or pkill.
