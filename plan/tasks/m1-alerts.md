## What
Build the alert reconciler docs/mission/research-2026-11-11.md recommends ("Alerts when a run needs Aaron"), in packages/loop: `pnpm loop alerts` reads the runs' structured state and the owner's questions (the same predicate the portal's Questions page uses: blueprint/shared/waiting.ts forAaron and plan needs for aaron), keeps what it already said in var/alerts.json so a restart neither repeats nor misses an alert, and says each new one once: a new question for Aaron, and a run that turns failed or dead (not superseded runs, not model failures the coordinator handles). Delivery is an injected sender; the composition root wires a macOS notification (osascript display notification) with a link to the portal's Questions or Runs page over https://macbook.tail4b9a40.ts.net:8443. No external service. Tests through the module's interface with a fake sender and fake clock: restart catch-up, dedup, superseded runs ignored.
## Why
Aaron asked for alerts from the portal; today nothing tells him when something needs him unless he is watching the page.
## Done when
- pnpm loop:test passes with the reconciler's tests (restart catch-up, one alert per episode, superseded runs ignored)
- `pnpm loop alerts --once` prints what it would send and exits
- pnpm layout passes
