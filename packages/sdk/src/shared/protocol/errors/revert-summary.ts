import { isRecord } from "../primitives/record.ts";
import { boundedEvidence } from "./chain-cause.ts";

/** A decoded revert. `name` is null when the selector is unknown or the data was empty. */
export type RevertSummary = {
  readonly name: string | null;
  readonly selector: string;
  readonly args: Readonly<Record<string, string>>;
};

const REVERT_NAME_MAX = 64;

const REVERT_ARG_KEY_MAX = 32;

const REVERT_ARG_VALUE_MAX = 128;

const REVERT_ARGS_MAX = 8;

const SELECTOR_RE = /^0x(?:[0-9a-fA-F]{8})?$/u;

export function decodeRevert(value: unknown): RevertSummary | null {
  if (!isRecord(value)) return null;
  if (value.name !== null && typeof value.name !== "string") return null;
  if (typeof value.selector !== "string" || !SELECTOR_RE.test(value.selector)) return null;
  if (!isRecord(value.args)) return null;
  const args: Record<string, string> = {};
  for (const [key, arg] of Object.entries(value.args).slice(0, REVERT_ARGS_MAX)) {
    if (typeof arg !== "string") return null;
    args[boundedEvidence(key, REVERT_ARG_KEY_MAX)] = boundedEvidence(arg, REVERT_ARG_VALUE_MAX);
  }
  return {
    name: value.name === null ? null : boundedEvidence(value.name, REVERT_NAME_MAX),
    selector: value.selector,
    args,
  };
}

/**
 * Safe (safe-contracts v1.4.1) revert codes. The contracts revert with these
 * short strings to save gas; the sentence lives in the Safe docs
 * (`docs/error_codes.md`). Every Safe on the Capxul rail is this version.
 */
export const SAFE_REVERT_REASONS: Readonly<Record<string, string>> = {
  GS000: "could not finish initialization",
  GS001: "threshold needs to be defined",
  GS010: "not enough gas to execute Safe transaction",
  GS011: "could not pay gas costs with ether",
  GS012: "could not pay gas costs with token",
  GS013: "Safe transaction failed when gasPrice and safeTxGas were 0",
  GS020: "signatures data too short",
  GS021: "invalid contract signature location: inside static part",
  GS022: "invalid contract signature location: length not present",
  GS023: "invalid contract signature location: data not complete",
  GS024: "invalid contract signature provided",
  GS025: "hash has not been approved",
  GS026: "invalid owner provided",
  GS030: "only owners can approve a hash",
  GS031: "method can only be called from this contract",
  GS100: "modules have already been initialized",
  GS101: "invalid module address provided",
  GS102: "module has already been added",
  GS103: "invalid prevModule, module pair provided",
  GS104: "method can only be called from an enabled module",
  GS105: "invalid starting point for fetching paginated modules",
  GS106: "invalid page size for fetching paginated modules",
  GS200: "owners have already been set up",
  GS201: "threshold cannot exceed owner count",
  GS202: "threshold needs to be greater than 0",
  GS203: "invalid owner address provided",
  GS204: "address is already an owner",
  GS205: "invalid prevOwner, owner pair provided",
  GS300: "guard does not implement IERC165",
  GS400: "fallback handler cannot be set to self",
};

/**
 * `Error(GS205: invalid prevOwner, owner pair provided)`, or the bare selector
 * when the name is unknown. Safe codes travel only as the `message` of an
 * `Error(string)` revert, so only that argument is expanded from
 * {@link SAFE_REVERT_REASONS}; every other argument reads `name=value`, even
 * when a custom error's field happens to hold a `GS` string.
 */
export function revertSummaryText(revert: RevertSummary): string {
  if (revert.name === null) {
    return revert.selector === "0x" ? "empty revert" : `unknown selector ${revert.selector}`;
  }
  const args = Object.entries(revert.args)
    .map(([name, value]) => {
      const reason =
        revert.name === "Error" && name === "message" ? SAFE_REVERT_REASONS[value] : undefined;
      return reason === undefined ? `${name}=${value}` : `${value}: ${reason}`;
    })
    .join(", ");
  return `${revert.name}(${args})`;
}
