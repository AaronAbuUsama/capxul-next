# @capxul/runtime

The clock module of decision `time.no-direct-reads`: the one place in the codebase that reads a clock. Everything else
asks it, so a devnet's stopped, warped or fast world clock is never mixed with the host's.

- `src/time/real-time.ts`: **RealTime**, the host's clock. `realNowMs()` and `realNowIso()` are for envelope stamps only
  (when a row was written or acknowledged on this host, an observation's `observedAt`), never a business instant.
  `stopwatch()` measures real elapsed time (durations and timeouts), which the decision allows everywhere.
- The world's own time (its authority clock, read today from `app.world.clock`) will live beside it as
  `src/time/world-time.ts` (Runtime lane). The devnet supervisor that writes the clock stays in `packages/devnet`.

Import through `@capxul/runtime/time` (`src/time/door.ts`). Test: `pnpm --filter @capxul/runtime test`.
