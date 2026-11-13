# time

The clock module (`time.no-direct-reads`). `real-time.ts` is RealTime: the host clock for an envelope's instant (a vendor's, or the outbox's host stamps, `runtime.outbox-host-stamps`) and a monotonic
stopwatch for elapsed time. `door.ts` is the only import path. World time joins it as `world-time.ts`.
