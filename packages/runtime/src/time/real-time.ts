// RealTime: the host's clock. Decision time.no-direct-reads allows it "only in an integration layer's envelope code",
// and measuring real elapsed time stays allowed everywhere; this file is the one place either is read. It is never a
// business instant: a world's own time is its authority clock, which a devnet can stop, warp and run fast. The one
// exception is a world with no authority clock (staging, production), whose own time is the host's (signals.world-rows).
import { performance } from "node:perf_hooks";

/** The host's wall clock in epoch milliseconds, for a vendor envelope's instant; never stored in a row or compared with a product time. */
export function realNowMs(): number {
  return Date.now();
}

/** The same instant as an ISO string, for an envelope that carries ISO time. */
export function realNowIso(): string {
  return new Date(realNowMs()).toISOString();
}

/** A monotonic stopwatch for elapsed time (durations, timeouts): read it to get the milliseconds since it started. */
export function stopwatch(): () => number {
  const started = performance.now();
  return () => performance.now() - started;
}
