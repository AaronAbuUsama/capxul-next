import { checkTraceparent, traceHeaders } from "../shared/trace.ts";

export type AccessSignIn = { token: string; personId: string; safe: string; expiresAt: string };
export type PersonSignIn = AccessSignIn & { email: string };
export type AgentSignIn = AccessSignIn & { signer: string; owner: string };
export type AccessSession = { personId: string; kind: "person" | "agent"; email: string | null; safe: string;
  expiresAt: string; setupState: "ready" | "setup-required" };
export class AccessClientError extends Error {
  readonly code: string;
  readonly retryAfterMs: number | undefined;
  readonly triesLeft: number | undefined;
  constructor(code: string, retryAfterMs?: number, triesLeft?: number) {
    super(code); this.name = "AccessClientError"; this.code = code;
    this.retryAfterMs = retryAfterMs; this.triesLeft = triesLeft;
  }
}
const invalid = () => new AccessClientError("PROVIDER_RESPONSE_INVALID");
const address = (v: unknown): v is string => typeof v === "string" && /^0x[\da-fA-F]{40}$/.test(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const time = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function signedIn(value: Record<string, unknown>): AccessSignIn {
  if (typeof value.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.token) ||
    !text(value.personId) || !address(value.safe) || !time(value.expiresAt)) throw invalid();
  return { token: value.token, personId: value.personId, safe: value.safe, expiresAt: value.expiresAt };
}
const codes = new Set(["INVALID_INPUT", "OTP_EXPIRED", "NOT_AUTHENTICATED", "RATE_LIMITED", "PROVIDER_ERROR", "PROVIDER_RESPONSE_INVALID", "INTERNAL_ERROR"]);

/** Public Access transport, not a bearer factory or an actor/Seat/hat authority.
 * The host owns private token persistence. Call sign-in again after restore; never
 * turn a surviving cookie or a cached actor label into a session.
 */
export function createAccessClient(options: { coreUrl: string; traceparent?: string | undefined }) {
  let url: URL;
  try { url = new URL(options.coreUrl); } catch { throw new AccessClientError("INVALID_INPUT"); }
  const traceparent = checkTraceparent(options.traceparent, () => new AccessClientError("INVALID_INPUT"));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new AccessClientError("INVALID_INPUT");
  const request = async (path: string, input: object, bearer?: string) => {
    let response: Response;
    try {
      response = await fetch(`${url.origin}/access/${path}`, { method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
        headers: { "content-type": "application/json", ...traceHeaders(traceparent), ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }) },
        body: JSON.stringify(input), signal: AbortSignal.timeout(30_000) });
    } catch { throw new AccessClientError("PROVIDER_ERROR"); }
    let result: Record<string, unknown>;
    try { result = object(await response.json()); } catch { throw invalid(); }
    if (!response.ok) {
      const code = typeof result.error === "string" && codes.has(result.error) ? result.error : "PROVIDER_ERROR";
      const retry = code === "RATE_LIMITED" && typeof result.retryAfterMs === "number" && Number.isFinite(result.retryAfterMs) && result.retryAfterMs >= 0 ? result.retryAfterMs : undefined;
      const tries = code === "INVALID_INPUT" && typeof result.triesLeft === "number" && Number.isInteger(result.triesLeft) && result.triesLeft >= 0 && result.triesLeft <= 3 ? result.triesLeft : undefined;
      throw new AccessClientError(code, retry, tries);
    }
    return result;
  };
  return {
    async sendCode(input: { email: string }): Promise<{ email: string; expiresAt: string; resendAfter: string }> {
      const row = await request("sign-in/send-code", input);
      if (row.email !== input.email.trim().toLowerCase() || !text(row.email) || !time(row.expiresAt) || !time(row.resendAfter)) throw invalid();
      return { email: row.email, expiresAt: row.expiresAt, resendAfter: row.resendAfter };
    },
    async verifyCode(input: { email: string; code: string; client: string }): Promise<PersonSignIn> {
      const row = await request("sign-in/verify-code", input), session = signedIn(row);
      if (row.email !== input.email.trim().toLowerCase() || !text(row.email)) throw invalid();
      return { ...session, email: row.email };
    },
    async challenge(input: { safe: string }): Promise<{ challenge: string; expiresAt: string }> {
      const row = await request("sign-in/challenge", input);
      if (!text(row.challenge) || !time(row.expiresAt)) throw invalid();
      return { challenge: row.challenge, expiresAt: row.expiresAt };
    },
    async withKey(input: { safe: string; challenge: string; signature: string; client: string }): Promise<AgentSignIn> {
      const row = await request("sign-in/with-key", input), session = signedIn(row);
      if (!address(row.signer) || !address(row.owner) || session.safe.toLowerCase() !== input.safe.toLowerCase()) throw invalid();
      return { ...session, signer: row.signer, owner: row.owner };
    },
    async current(bearer: string): Promise<AccessSession> {
      const row = await request("sessions/current", {}, bearer);
      if (!text(row.personId) || row.kind !== "person" && row.kind !== "agent" || !address(row.safe) || !time(row.expiresAt) ||
        row.setupState !== "ready" && row.setupState !== "setup-required" || (row.kind === "person" ? !text(row.email) : row.email !== null)) throw invalid();
      return { personId: row.personId, kind: row.kind, email: row.email as string | null,
        safe: row.safe, expiresAt: row.expiresAt, setupState: row.setupState };
    },
    async revoke(bearer: string): Promise<{ sessionId: string; endedAt: string }> {
      const row = await request("sessions/revoke", {}, bearer);
      if (!text(row.sessionId) || !time(row.endedAt)) throw invalid();
      return { sessionId: row.sessionId, endedAt: row.endedAt };
    },
  };
}
