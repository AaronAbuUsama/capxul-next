// One trace from the CLI command through the SDK to the server (spn:<operation>): the caller names its trace and its own
// span as a W3C traceparent, and every request it makes carries that header. Core joins it (signals.request).

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const hex = (bytes: number) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

/** A new trace and the caller's root span in it. */
export function newTraceparent(): string {
  return `00-${hex(16)}-${hex(8)}-01`;
}
/** Whether a value is a usable traceparent: version 00, and neither id all zeros. */
export function isTraceparent(value: string): boolean {
  const parts = TRACEPARENT.exec(value);
  return !!parts && !/^0+$/.test(parts[1]!) && !/^0+$/.test(parts[2]!);
}
/** The trace id a traceparent names. */
export function traceIdOf(traceparent: string): string {
  return TRACEPARENT.exec(traceparent)![1]!;
}
/** The header a client adds; none without a traceparent. A malformed one is refused when the client is made. */
export function traceHeaders(traceparent: string | undefined): Record<string, string> {
  return traceparent === undefined ? {} : { traceparent };
}
export function checkTraceparent(traceparent: string | undefined, refuse: () => Error): string | undefined {
  if (traceparent !== undefined && !isTraceparent(traceparent)) throw refuse();
  return traceparent;
}
