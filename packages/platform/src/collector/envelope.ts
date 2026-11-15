// The resource attributes the collector stamps on every resource it forwards, whatever the caller sent. Named once
// here until the blueprint's telemetry envelope (#301) reaches master; then these come from it and this file goes.
// The stage takes OpenTelemetry's own name for where a service is deployed.
import * as Rec from "effect/Record";

/** The keys the collector owns: a caller's value under any of them is dropped before the collector's is added. */
export const STAMPED = {
  /** The world the record came from: from the binding's claim, or from the operator's token when it names one. */
  world: "capxul.world",
  /** The world's grade: private, shared or real. */
  grade: "capxul.grade",
  /** The platform stage whose collector took the record: the collector's own. */
  stage: "deployment.environment.name",
  /** The operator whose token or whose world sent it. */
  operator: "capxul.operator",
} as const;

/** Every stamped key, for dropping what a caller sent under them. */
export const STAMPED_KEYS: ReadonlyArray<string> = Rec.values(STAMPED);
