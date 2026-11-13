import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac } from "node:crypto";
import { createPublicClient, http, isAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import { PROVISION_PATH, provisioningMessage } from "@capxul/sdk";
import { failure, json, readBody, requestTrace, ServiceError } from "./http.ts";
import { settleSite, type ProvisioningLifecycle } from "./lifecycle.ts";

export type ProvisioningOptions = {
  publicOrigin: string; rpcUrl: string; coreUrl: string; coreSecret: string; siteServiceUrl: string; siteServiceToken: string;
  lifecycle?: ProvisioningLifecycle;
};
const OWNERS = [{ type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] }] as const;

/** Mount before Core consumes the request stream. False means this is not our route. */
export function createProvisioningHandler(options: ProvisioningOptions): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  if (!options.coreSecret || !options.siteServiceToken) throw new Error("Private provisioning credentials are required");
  const client = createPublicClient({ transport: http(options.rpcUrl) });
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
    const trace = requestTrace(req);
    let creating: string | undefined;
    try {
      if (req.method !== "POST") throw new ServiceError(405, "INVALID_INPUT", "POST required");
      const raw = await readBody(req);
      const input = JSON.parse(raw);
      const signature = req.headers["x-capxul-signature"];
      if (!input || !isAddress(input.caller ?? "") || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now() || input.expiresAt > Date.now() + 60_000 || typeof signature !== "string") {
        throw new ServiceError(401, "NOT_AUTHENTICATED", "A signed request expiring within 60 seconds is required");
      }
      let caller: Address;
      try { caller = await recoverMessageAddress({ message: provisioningMessage(options.publicOrigin, raw), signature: signature as Hex }); }
      catch { throw new ServiceError(401, "NOT_AUTHENTICATED", "Invalid request signature"); }
      if (caller.toLowerCase() !== input.caller.toLowerCase()) throw new ServiceError(401, "NOT_AUTHENTICATED", "Request signature does not match caller");
      if (!/^[a-z][a-z0-9-]{1,30}$/.test(input.org)) throw new ServiceError(400, "INVALID_INPUT", "Invalid company slug");
      const info = await core("/admin/org-info", { slug: input.org }, trace);
      if (info.slug !== input.org || !isAddress(info.safe ?? "") || typeof info.name !== "string" || typeof info.site !== "string") {
        throw new ServiceError(400, "INVALID_INPUT", "Company must be registered after its chain birth");
      }
      const founder = info.people?.find((person: { email: string }) => person.email.toLowerCase() === info.adminEmail?.toLowerCase());
      if (founder?.address?.toLowerCase() !== caller.toLowerCase()) throw new ServiceError(403, "ROLE_PERMISSION_DENIED", "Only the registered founder can provision this company");
      // A directory row is not authority. The founder's personal Safe must still own the company,
      // and the caller must still own that personal Safe; a removed founder cannot provision it.
      const owners = await client.readContract({ address: info.safe, abi: OWNERS, functionName: "getOwners" });
      let authorised = false;
      for (const owner of owners) {
        const code = await client.getCode({ address: owner });
        if (!code || code === "0x") continue;
        const signers = await client.readContract({ address: owner, abi: OWNERS, functionName: "getOwners" });
        if (signers.some((signer) => signer.toLowerCase() === caller.toLowerCase())) { authorised = true; break; }
      }
      if (!authorised) throw new ServiceError(403, "ROLE_PERMISSION_DENIED", "Founder no longer owns the company's Safe");
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
