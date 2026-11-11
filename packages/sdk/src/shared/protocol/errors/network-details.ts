/** The bounded, leak-safe details a NETWORK_ERROR may carry. */
import { isFailureMode, type FailureMode } from "./failure-modes.ts";

export type NetworkErrorOptions = {
  readonly provider?: string;
  readonly target_host?: string;
  readonly failure_mode?: FailureMode;
  readonly reason?: "connection-lost-in-flight";
  readonly connection_id?: string;
  readonly connection_count?: number;
  readonly connection_retries?: number;
  readonly close_code?: number;
  readonly close_was_clean?: boolean;
  readonly close_reason_present?: boolean;
  readonly document_visibility?: string;
  readonly navigator_online?: boolean;
  readonly last_browser_event?: string;
  readonly ms_since_browser_event?: number;
  /** How long the call waited, as this client measured it. Evidence only. */
  readonly elapsed_ms?: number;
};

const NETWORK_DETAIL_LABEL_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;

const NETWORK_TARGET_HOST_RE = /^[A-Za-z0-9.[\]:-]{1,253}$/u;

const DOCUMENT_VISIBILITY = new Set(["hidden", "visible"]);

const BROWSER_LIFECYCLE_EVENTS = new Set([
  "visibility-visible",
  "visibility-hidden",
  "pagehide",
  "pageshow",
  "online",
  "offline",
]);

export function networkErrorDetails(operation: string, options: NetworkErrorOptions | undefined) {
  const details: Record<string, unknown> = { operation };
  if (options === undefined) return details;

  if (typeof options.provider === "string" && NETWORK_DETAIL_LABEL_RE.test(options.provider)) {
    details.provider = options.provider;
  }
  if (typeof options.target_host === "string" && NETWORK_TARGET_HOST_RE.test(options.target_host)) {
    details.target_host = options.target_host;
  }
  if (isFailureMode(options.failure_mode)) details.failure_mode = options.failure_mode;
  if (options.reason === "connection-lost-in-flight") details.reason = options.reason;
  if (
    typeof options.connection_id === "string" &&
    NETWORK_DETAIL_LABEL_RE.test(options.connection_id)
  ) {
    details.connection_id = options.connection_id;
  }
  for (const key of [
    "connection_count",
    "connection_retries",
    "close_code",
    "ms_since_browser_event",
    "elapsed_ms",
  ] as const) {
    const value = options[key];
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      (key !== "close_code" || value <= 4_999)
    ) {
      details[key] = value;
    }
  }
  for (const key of ["close_was_clean", "close_reason_present", "navigator_online"] as const) {
    const value = options[key];
    if (typeof value === "boolean") details[key] = value;
  }
  if (DOCUMENT_VISIBILITY.has(options.document_visibility ?? "")) {
    details.document_visibility = options.document_visibility;
  }
  if (BROWSER_LIFECYCLE_EVENTS.has(options.last_browser_event ?? "")) {
    details.last_browser_event = options.last_browser_event;
  }
  return details;
}
