# Ops

`pnpm ops <start|stop|restart|status> [portal|host|alerts|chain|core|all]` owns detached Mac services. `pnpm ops reap --dry-run` previews abandoned checkout processes; `pnpm ops reap` stops them. Never use raw kill. Starts require the main checkout. Logs and identity records live in `var/ops/`.

`src/main.ts` is the composition root; service.ts returns errors as values, types.ts defines injected process discovery, spawn, signal, clock and persistence ports. internal/system.ts implements Mac ps/lsof discovery. Stops signal owned process groups and matching listeners, TERM then KILL after ten seconds. Chain runs anvil with persisted state; Core prepares contracts with the existing chain-up script before serving.
