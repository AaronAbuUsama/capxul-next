import type { Sql } from "../platform/db.ts";
import { authenticate, type GateCatalogue } from "../access/door.ts";
import { personalSafe } from "./door.ts";
import { startSetup } from "./setup.ts";

export type AccountsServices = {
  companiesHouse: string; catalogue: GateCatalogue; setupUrl: string;
  requireProfile: (sql: Sql, personId: string) => Promise<void>;
};
export const accountsPaths = ["/accounts/setup/start", "/accounts/setup/lifecycle", "/accounts/setup/check"] as const;
const messages = { WRONG_STATE: "The Safe is already claimed by another signer.", INVALID_INPUT: "The claim input is invalid.",
  TRANSACTION_FAILED: "The claim transaction failed.", PROVIDER_ERROR: "The claim provider is unavailable." } as const;

/** Runtime-owned worker transaction and clock; no caller actor fields or chain write here.
 * Runtime composition must resume durable setup after every committed start.
 */
export async function routeAccounts(sql: Sql, path: string, input: Record<string, unknown>, bearer: string,
  services: AccountsServices, now: number): Promise<{ status: number; body: unknown } | null> {
  if (!(accountsPaths as readonly string[]).includes(path)) return null;
  const principal = await authenticate(sql, bearer, now);
  if (principal.kind !== "person" || !principal.email) throw new Error("NOT_AUTHENTICATED: person required");
  if (path === "/accounts/setup/start") {
    if (typeof input.signer !== "string") throw new Error("INVALID_INPUT: signer");
    const row = await startSetup(sql, principal, input.signer, services, principal.personId, now);
    return { status: 200, body: { safe: row.safe_address, status: row.status, attempt: row.attempt } };
  }
  if (path === "/accounts/setup/lifecycle" && input.personId !== undefined && input.personId !== principal.personId)
    throw new Error("NOT_AUTHENTICATED: another person's setup");
  let profile = true;
  try { await services.requireProfile(sql, principal.personId); }
  catch (error) {
    if (path !== "/accounts/setup/check" || !(error instanceof Error) || error.message.split(":", 1)[0] !== "PROFILE_NOT_FOUND") throw error;
    profile = false;
  }
  const row = profile ? await personalSafe(sql, principal.personId) : null;
  if (path === "/accounts/setup/lifecycle") {
    if (!row) throw new Error("SMART_ACCOUNT_MISSING: no setup");
    const lifecycle = row.status === "failed" ? { status: "failed", at: "claiming",
      error: { code: row.failure_code!, message: messages[row.failure_code!] } }
      : row.status === "claiming" ? { status: "settingUp", step: "claiming" }
        : { status: "ready", safe: row.safe_address, canTransact: true, collecting: row.status === "collecting" };
    return { status: 200, body: { lifecycle } };
  }
  if (row?.status === "failed" && (row.failure_code === "WRONG_STATE" || row.failure_code === "INVALID_INPUT"))
    throw new Error(`${row.failure_code}: ${messages[row.failure_code]}`);
  const claimed = row?.status === "collecting" || row?.status === "ready";
  return { status: 200, body: { setupState: claimed ? "ready" : "setup-required", setupUrl: claimed ? null : services.setupUrl,
    next: claimed ? null : { argv: ["capxul", "account", "retry"] }, safe: principal.safeAddress, claimed, collected: row?.collected ?? 0 } };
}
