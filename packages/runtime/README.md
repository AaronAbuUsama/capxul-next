# @capxul/runtime

The clock module of decision `time.no-direct-reads`: the one place in the codebase that reads a clock. Everything else
asks it, so a devnet's stopped, warped or fast world clock is never mixed with the host's.

- `src/time/real-time.ts`: **RealTime**, the host's clock. `realNowMs()` and `realNowIso()` are for a vendor envelope's
  instant only, read by integration layers (a webhook signature's freshness, a timestamp signed into a vendor's request);
  per `time.real-elapsed` the value is never compared with a product time. It is stored only in the outbox's envelope
  columns (`transition_outbox.host_enqueued_at`, `transition_acks.host_acked_at`, `runtime.outbox-host-stamps`), a
  measurement no product rule reads, and as the time on a signal row in a world with no authority clock of its own
  (staging, production; `signals.world-rows`).
  `stopwatch()` measures real elapsed time (durations and timeouts), which the decision allows everywhere.
- The world's own time (its authority clock, read today from `app.world.clock`) will live beside it as
  `src/time/world-time.ts` (Runtime lane). The devnet supervisor that writes the clock stays in `packages/devnet`.

Import through `@capxul/runtime/time` (`src/time/door.ts`). Test: `pnpm --filter @capxul/runtime test`.
