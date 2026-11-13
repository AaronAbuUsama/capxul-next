import type { Address, Hex } from "viem";
import type { Sql } from "../platform/db.ts";
import type { Mail } from "../shared/door.ts";
import { challenge, currentSession, revoke, sendCode, verifyCode, withKey, type AccessConfig } from "./sign-in.ts";

export type AccessServices = {
  mail: Mail;
  personalSafe: AccessConfig;
  agent: { secret: string; domain: string; rpc: string; agentOwner: Address };
};
export const accessPaths = ["/access/sign-in/send-code", "/access/sign-in/verify-code", "/access/sign-in/challenge",
  "/access/sign-in/with-key", "/access/sessions/current", "/access/sessions/revoke"] as const;
function text(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value) throw new Error(`INVALID_INPUT: ${key}`);
  return value;
}

/** Integrator mounts POST routes before diagnostic HMAC ingress, inside one drained worker transaction.
 * bearer is Authorization's raw token; now is runtime world time; neither comes from input.
 * A returned 4xx still commits (a wrong OTP has spent a try). Never throw that result inside the transaction.
 */
export async function routeAccess(sql: Sql, path: string, input: Record<string, unknown>, bearer: string,
  services: AccessServices, now: number): Promise<{ status: number; body: unknown } | null> {
  switch (path) {
    case "/access/sign-in/send-code":
      return { status: 200, body: await sendCode(sql, { email: text(input, "email") }, services.mail, now) };
    case "/access/sign-in/verify-code": {
      const result = await verifyCode(sql, { email: text(input, "email"), code: text(input, "code"), client: text(input, "client") }, services.personalSafe, now);
      return result.ok ? { status: 200, body: result.value } : { status: result.error === "RATE_LIMITED" ? 429 : 400, body: { error: result.error, ...(result.triesLeft === undefined ? {} : { triesLeft: result.triesLeft }) } };
    }
    case "/access/sign-in/challenge":
      return { status: 200, body: challenge(services.agent.secret, services.agent.domain, text(input, "safe") as Address, now) };
    case "/access/sign-in/with-key":
      return { status: 200, body: await withKey(sql, { safe: text(input, "safe"), challenge: text(input, "challenge"), signature: text(input, "signature") as Hex, client: text(input, "client") }, services.agent, now) };
    case "/access/sessions/current":
      return { status: 200, body: await currentSession(sql, bearer, { rpc: services.agent.rpc, companiesHouse: services.personalSafe.companiesHouse }, now) };
    case "/access/sessions/revoke": return { status: 200, body: await revoke(sql, bearer, now) };
    default: return null;
  }
}

/** Render only after the transaction has rolled back; never return provider bodies or stacks. */
export function accessError(error: unknown): { status: number; body: { error: string; retryAfterMs?: number } } {
  const code = error instanceof Error ? error.message.split(":", 1)[0]! : "INTERNAL_ERROR";
  const status = ({ INVALID_INPUT: 400, OTP_EXPIRED: 400, NOT_AUTHENTICATED: 401, RATE_LIMITED: 429,
    PROVIDER_ERROR: 502, PROVIDER_RESPONSE_INVALID: 502 } as Record<string, number>)[code];
  const retry = error && typeof error === "object" && "retryAfterMs" in error ? error.retryAfterMs : undefined;
  return { status: status ?? 500, body: { error: status ? code : "INTERNAL_ERROR",
    ...(code === "RATE_LIMITED" && typeof retry === "number" ? { retryAfterMs: retry } : {}) } };
}
