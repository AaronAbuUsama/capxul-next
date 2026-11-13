// The clock module's door. Code outside packages/runtime/src/time/ reads time only through it (time.no-direct-reads).
export { realNowIso, realNowMs, stopwatch } from "./real-time.ts";
