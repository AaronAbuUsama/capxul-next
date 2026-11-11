# Ops

`pnpm ops <start|stop|restart|status> [portal|host|alerts|chain|core|all]` owns detached Mac services. `pnpm ops reap --dry-run` previews abandoned checkout processes; `pnpm ops reap` stops them. Never use raw kill. Starts require the main checkout. Logs and identity records live in `var/ops/`.

## Recovery from the main checkout

Use `pnpm ops status all` to inspect service identity, uptime, checkout and port health. If the portal is down, use `pnpm ops restart portal`, then `pnpm ops status portal`; its output is in `var/ops/portal.log`. Do not start a second server with an individual launch command or send raw kill signals.

If start reports a foreign checkout holding a port, inspect `pnpm ops reap --dry-run`, then use `pnpm ops reap` to stop abandoned project processes before retrying. A lane cannot start services: run these commands from the main checkout. Use `pnpm ops stop <service>` for an intentional shutdown, not raw kill. The same supervisor owns host, alerts, chain and core.

`src/main.ts` is the composition root; service.ts returns errors as values, types.ts defines injected process discovery, spawn, signal, clock and persistence ports. internal/system.ts implements Mac ps/lsof discovery. Stops signal owned process groups and matching listeners, TERM then KILL after ten seconds. Chain runs anvil with persisted state; Core prepares contracts with the existing chain-up script before serving.
