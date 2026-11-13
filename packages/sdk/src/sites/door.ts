import type { Address } from "viem";

export * from "./documents.ts";

export const PROVISION_PATH = "/org/site/provision";
export type ProvisionedSite = { org: string; safe: Address; site: string; url: string; state: "provisioned" };

export class ProvisioningError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "ProvisioningError"; this.code = code; }
}

/** Public caller door. Every call obtains the person's current opaque Access session; no wallet key or service credential. */
export function createSitesClient(options: { coreUrl: string; bearer(): string | Promise<string> }) {
  const origin = new URL(options.coreUrl).origin;
  return {
    async provision(input: { org: string }): Promise<ProvisionedSite> {
      if (!/^[a-z][a-z0-9-]{1,30}$/.test(input.org)) throw new ProvisioningError("INVALID_INPUT", "Invalid company slug");
      const bearer = await options.bearer();
      if (!bearer || /\s/.test(bearer)) throw new ProvisioningError("NOT_AUTHENTICATED", "An Access Bearer session is required");
      const raw = JSON.stringify({ org: input.org });
      let response: Response;
      try {
        response = await fetch(`${origin}${PROVISION_PATH}`, {
          method: "POST", body: raw, headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
          signal: AbortSignal.timeout(30 * 60_000),
        });
      } catch { throw new ProvisioningError("PROVIDER_ERROR", "Core is unreachable; retry the same company to resume provisioning"); }
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new ProvisioningError(result?.error?.code ?? "PROVIDER_ERROR", result?.error?.message ?? "Provisioning failed");
      if (result?.org !== input.org || !/^0x[\da-fA-F]{40}$/.test(result?.safe) || typeof result?.site !== "string" ||
          typeof result?.url !== "string" || result?.state !== "provisioned") {
        throw new ProvisioningError("PROVIDER_RESPONSE_INVALID", "Core returned an invalid provisioning result");
      }
      return result;
    },
  };
}
