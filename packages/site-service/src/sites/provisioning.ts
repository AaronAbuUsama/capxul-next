import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { Effect } from "effect";
import { isAddress } from "viem";
import { PROVISION_PATH } from "@capxul/sdk";
import type { DocumentPrincipal } from "./documents.ts";
import { failure, json, readBody, ServiceError } from "./http.ts";
import { settleSite, type ProvisioningLifecycle } from "./lifecycle.ts";

export type ProvisioningOptions = {
  coreUrl: string; coreSecret: string; siteServiceUrl: string; siteServiceToken: string;
  /** Core authenticates the raw Bearer with Access and admits the setup's founder or a current Seat (sites.provision-principal). */
  authorize(input: { orgId: string; bearer: string; traceId: string }): Effect.Effect<DocumentPrincipal, { code: string; message: string }>;
  lifecycle?: ProvisioningLifecycle;
};
const refusals: Record<string, number> = { NOT_AUTHENTICATED: 401, ROLE_PERMISSION_DENIED: 403, INVALID_INPUT: 400 };

/** Mount before Core consumes the request stream. False means this is not our route. */
export function createProvisioningHandler(options: ProvisioningOptions): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  if (!options.coreSecret || !options.siteServiceToken) throw new Error("Private provisioning credentials are required");
  const core = async (path: string, body: unknown, trace: string): Promise<any> => {
    const raw = JSON.stringify(body);
    const response = await fetch(`${options.coreUrl}${path}`, { method: "POST", body: raw, signal: AbortSignal.timeout(15_000), headers: {
      "content-type": "application/json", "x-capxul-signature": createHmac("sha256", options.coreSecret).update(raw).digest("hex"), "x-capxul-trace": trace,
    } });
    if (!response.ok) throw new ServiceError(response.status === 404 ? 400 : 503, response.status === 404 ? "INVALID_INPUT" : "PROVIDER_ERROR", "Core registration or release was refused");
    return response.json();
  };
  return async (req, res) => {
    if (req.url !== PROVISION_PATH) return false;
    const trace = randomUUID();
    let creating: string | undefined;
    try {
      if (req.method !== "POST") throw new ServiceError(405, "INVALID_INPUT", "POST required");
      const authorization = req.headers.authorization;
      const bearer = typeof authorization === "string" ? /^Bearer ([^\s]+)$/i.exec(authorization)?.[1] : undefined;
      if (!bearer) throw new ServiceError(401, "NOT_AUTHENTICATED", "An Access Bearer session is required");
      const input = JSON.parse(await readBody(req));
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).join() !== "org" ||
          typeof input.org !== "string" || !/^[a-z][a-z0-9-]{1,30}$/.test(input.org)) throw new ServiceError(400, "INVALID_INPUT", "Invalid company slug");
      const admitted = await Effect.runPromise(Effect.result(options.authorize({ orgId: input.org, bearer, traceId: trace })));
      if (admitted._tag === "Failure") {
        const code = admitted.failure.code in refusals ? admitted.failure.code : "PROVIDER_ERROR";
        throw new ServiceError(refusals[code] ?? 503, code, code === "PROVIDER_ERROR" ? "Provisioning authority is unavailable; retry the same company" : admitted.failure.message);
      }
      const info = await core("/admin/org-info", { slug: input.org }, trace);
      if (info.slug !== input.org || !isAddress(info.safe ?? "") || typeof info.name !== "string" || typeof info.site !== "string") {
        throw new ServiceError(400, "INVALID_INPUT", "Company must be registered after its chain birth");
      }
      if (options.lifecycle) {
        await options.lifecycle.store.begin({ org: info.slug, world: options.lifecycle.world, host: info.site, bench: options.lifecycle.bench, trace });
        creating = info.slug;
      }
      const response = await fetch(`${options.siteServiceUrl}/sites/create`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${options.siteServiceToken}`, "x-capxul-trace": trace },
        body: JSON.stringify({ org: info.slug, name: info.name, safe: info.safe, adminEmail: info.adminEmail }), signal: AbortSignal.timeout(30 * 60_000),
      });
      const site = await response.json().catch(() => null);
      if (!response.ok) throw new ServiceError(response.status === 409 ? 409 : 503, response.status === 409 ? "INVALID_INPUT" : "PROVIDER_ERROR", "Site provisioning failed; retry the same company");
      if (site?.site !== info.site || site?.safe?.toLowerCase() !== info.safe.toLowerCase() || site?.org !== input.org ||
          typeof site?.url !== "string" || site?.state !== "provisioned") {
        throw new ServiceError(502, "PROVIDER_RESPONSE_INVALID", "Site service did not confirm the registered identity");
      }
      await core("/admin/release", { slug: input.org }, trace);
      if (options.lifecycle) await settleSite(options.lifecycle, info, trace);
      json(res, 200, site);
    } catch (error) {
      if (creating && options.lifecycle) {
        try {
          if ((await options.lifecycle.store.site(creating))?.state === "creating")
            await options.lifecycle.store.transition(creating, "fail", trace, { failure: error instanceof ServiceError ? error.code : "PROVIDER_ERROR" });
        } catch { /* If the database is down, its durable creating row remains available for a retry. */ }
      }
      failure(res, error instanceof SyntaxError ? new ServiceError(400, "INVALID_INPUT", "Invalid JSON") : error);
    }
    return true;
  };
}
