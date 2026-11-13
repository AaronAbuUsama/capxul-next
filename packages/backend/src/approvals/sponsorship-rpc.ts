import { decodeErrorResult, parseAbi, type Hex } from "viem";

export type SponsorTransport = { request(method: string, params: readonly unknown[]): Promise<unknown> };
export class SponsorError extends Error {
  readonly code: string;
  constructor(code: string, reason: string) { super(reason); this.code = code; }
}
const object = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const reverts = parseAbi([
  "error ERC20InsufficientBalance(address sender,uint256 balance,uint256 needed)",
  "error OverBudget(uint256 id,uint128 left,uint128 requested)",
  "error ChildrenExceedParent(uint256 parent,uint128 left,uint128 requested)",
  "error AmountBelowUse(uint256 id,uint128 used,uint128 requested)", "error BudgetIsClosed(uint256 id)",
  "error NotAuthorised(uint256 id,address who)", "error NoMembership()", "error ConditionViolation(uint8 status,bytes32 info)",
  "error ThresholdTooLow()", "error InsufficientValidSignatures()", "error StillWearsSignerHat()", "error CannotChangeModules()", "error CannotCallSafe()", "error NoReentryAllowed()",
  "error FailedOpWithRevert(uint256 opIndex,string reason,bytes inner)",
]);
const denied = "ROLE_PERMISSION_DENIED";
// Only these named reverts carry their code. Error(string), Panic (which decodeErrorResult always adds) and anything
// unlisted stay TRANSACTION_FAILED (integrations.sponsor-refusals).
const codes: Record<string, string> = {
  ERC20InsufficientBalance: "INSUFFICIENT_BALANCE", OverBudget: "PAYROLL_BUDGET_EXCEEDED", ChildrenExceedParent: "CHILDREN_EXCEED_PARENT",
  AmountBelowUse: "AMOUNT_BELOW_USE", BudgetIsClosed: "WRONG_STATE",
  NotAuthorised: denied, NoMembership: denied, ThresholdTooLow: denied, InsufficientValidSignatures: denied, StillWearsSignerHat: denied,
  CannotChangeModules: denied, CannotCallSafe: denied, NoReentryAllowed: denied,
};
// viem's revert errors, matched by name because a caller's client may come from another viem copy than this module's.
const revertNames = new Set(["ContractFunctionRevertedError", "ContractFunctionZeroDataError", "ExecutionRevertedError", "RawContractError"]);
function reverted(error: unknown): boolean {
  for (let e = error, depth = 0; object(e) && depth < 10; e = e.cause, depth++) if (typeof e.name === "string" && revertNames.has(e.name)) return true;
  return false;
}
const refused = (code: string) => ({ code, reason: "The chain refused sponsorship of this operation" });

/** Decode structured revert bytes only. Provider text is neither authority nor safe user-facing output. */
export function sponsorRefusal(error: unknown, remaining = 5): { code: string; reason: string } | null {
  const seen = new Set<unknown>();
  function visit(value: unknown, depth: number): Hex | null {
    if (depth > 10 || seen.has(value)) return null;
    if (typeof value === "string" && /^0x(?:[0-9a-fA-F]{2}){4,}$/.test(value)) return value as Hex;
    if (!object(value)) return null;
    seen.add(value);
    for (const key of ["data", "raw", "revertData", "cause", "error", "originalError"]) {
      const found = visit(value[key], depth + 1);
      if (found) return found;
    }
    return null;
  }
  const data = visit(error, 0);
  // A revert without data (such as a sender that is not a Safe) is final: retrying cannot change it.
  if (!data) return reverted(error) ? refused("TRANSACTION_FAILED") : null;
  let code = "TRANSACTION_FAILED";
  try {
    const decoded = decodeErrorResult({ abi: reverts, data });
    if (decoded.errorName === "FailedOpWithRevert") return (remaining > 0 ? sponsorRefusal({ data: decoded.args[2] }, remaining - 1) : null) ?? refused(code);
    // Zodiac Roles v2.1 verified deployed source PermissionChecker.Status: AllowanceExceeded = 17.
    code = decoded.errorName === "ConditionViolation" ? (decoded.args[0] === 17 ? "PAYROLL_BUDGET_EXCEEDED" : denied) : codes[decoded.errorName] ?? code;
  } catch { /* Unrecognised or malformed custom revert stays a generic transaction refusal. */ }
  return refused(code);
}

/** Sponsor-only HTTP: preserves structured simulation errors, never broadcasts or logs credentials/payloads. */
export function sponsorHttpTransport(url: string): SponsorTransport {
  return { async request(method, params) {
    if (!["pm_getPaymasterStubData", "eth_estimateUserOperationGas", "pm_getPaymasterData"].includes(method)) throw new SponsorError("INVALID_INPUT", "Unsupported sponsorship method");
    let response: Response;
    try { response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(4_000), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); }
    catch { throw new SponsorError("PROVIDER_ERROR", "Sponsorship gateway did not answer"); }
    if (!response.ok) throw new SponsorError("PROVIDER_ERROR", "Sponsorship gateway did not answer");
    let body: unknown;
    // A truncated or proxied body is an outage the carrier retries, not a refusal to store.
    try { body = await response.json(); } catch { throw new SponsorError("PROVIDER_ERROR", "Sponsorship gateway returned invalid JSON"); }
    if (!object(body) || body.jsonrpc !== "2.0" || body.id !== 1) throw new SponsorError("PROVIDER_RESPONSE_INVALID", "Sponsorship gateway returned an invalid response");
    if (body.error !== undefined) {
      if (!object(body.error) || !Number.isInteger(body.error.code)) throw new SponsorError("PROVIDER_RESPONSE_INVALID", "Sponsorship gateway returned an invalid error");
      const code = body.error.code as number;
      // ERC-7769 -32504: a throttled or banned entity is transient, so the carrier retries.
      if (code === -32504) throw new SponsorError("PROVIDER_ERROR", "Sponsorship gateway is throttling this request");
      const refusal = sponsorRefusal(body.error);
      if (refusal) throw new SponsorError(refusal.code, refusal.reason);
      // ERC-7769 validation codes, and 3 (execution reverted) without revert data.
      if (code === 3 || (code <= -32500 && code >= -32599)) throw new SponsorError("TRANSACTION_FAILED", "The gateway refused sponsorship validation");
      throw new SponsorError("PROVIDER_ERROR", "Sponsorship gateway could not serve the request");
    }
    if (!("result" in body)) throw new SponsorError("PROVIDER_RESPONSE_INVALID", "Sponsorship gateway omitted its result");
    return body.result;
  } };
}
