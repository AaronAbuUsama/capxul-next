import { authenticate } from "../access/door.ts";
import type { Sql } from "../platform/db.ts";
import { begin, get, resume, type BeginInput, type SetupServices } from "./setups.ts";

// Organizations' bearer routes for Core's shared dispatch: organizations.setups.begin, get and resume. The person comes
// from Access's authenticate on the request's own transaction; the routes run as the worker, which alone writes the
// Organizations tables, and each door checks the person itself. Composition binds the services per request instant.
export const organizationsPaths = ["/organizations/setups/begin", "/organizations/setups/get", "/organizations/setups/resume"] as const;

const STATUS: Record<string, number> = { INVALID_INPUT: 400, NOT_AUTHENTICATED: 401, FEATURE_NOT_AVAILABLE: 403,
  ROLE_PERMISSION_DENIED: 403, WRONG_STATE: 409, PROVIDER_ERROR: 502, PROVIDER_RESPONSE_INVALID: 502 };
/** Rendered after the transaction rolled back: the code only, never a message, provider body or stack. */
export function organizationsError(error: unknown): { status: number; body: { error: string } } {
  const code = error instanceof Error ? error.message.split(":", 1)[0]! : "INTERNAL_ERROR";
  const status = STATUS[code];
  return { status: status ?? 500, body: { error: status ? code : "INTERNAL_ERROR" } };
}

export function organizationsRoutes(services: (now: number) => SetupServices) {
  const route = async (sql: Sql, path: string, input: Record<string, unknown>, bearer: string, now: number, trace: string) => {
    if (!(organizationsPaths as readonly string[]).includes(path)) return null;
    await authenticate(sql, bearer, now);
    const s = services(now), orgId = { orgId: typeof input.orgId === "string" ? input.orgId : "" };
    if (path.endsWith("/begin")) return { status: 200, body: await begin(sql, input as unknown as BeginInput, s, now, trace) };
    if (path.endsWith("/get")) return { status: 200, body: await get(sql, orgId, s) };
    return { status: 200, body: await resume(sql, orgId, s, now, trace) };
  };
  return [{ paths: organizationsPaths, system: true, route, render: organizationsError }];
}
