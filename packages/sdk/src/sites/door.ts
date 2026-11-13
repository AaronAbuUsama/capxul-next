import type { Address, Hex, LocalAccount } from "viem";
import type { TextFetch } from "../shared/long-fetch.ts";

export * from "./documents.ts";

export const PROVISION_PATH = "/org/site/provision";
export const provisioningMessage = (origin: string, raw: string): string =>
  `Capxul site provisioning\n${new URL(origin).origin}\nPOST ${PROVISION_PATH}\n${raw}`;

export type ProvisionedSite = { org: string; safe: Address; site: string; url: string; state: "provisioned" };

export class ProvisioningError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "ProvisioningError"; this.code = code; }
}

/** Public caller door. Only the caller's signer is needed; service credentials never enter the SDK. */
export function createSitesClient(options: { coreUrl: string; account: Pick<LocalAccount, "address" | "signMessage">;
  /** Provisioning waits for the whole site creation. In Node pass `longFetch` from `@capxul/sdk/node`: built-in fetch gives up after 300 s. */
  fetch?: TextFetch }) {
  const origin = new URL(options.coreUrl).origin, send = options.fetch ?? fetch;
  return {
    async provision(input: { org: string }): Promise<ProvisionedSite> {
      if (!/^[a-z][a-z0-9-]{1,30}$/.test(input.org)) throw new ProvisioningError("INVALID_INPUT", "Invalid company slug");
      const raw = JSON.stringify({ org: input.org, caller: options.account.address, expiresAt: Date.now() + 60_000 });
      const signature: Hex = await options.account.signMessage({ message: provisioningMessage(origin, raw) });
      let response: Response;
      try {
        response = await send(`${origin}${PROVISION_PATH}`, {
          method: "POST", body: raw, headers: { "content-type": "application/json", "x-capxul-signature": signature },
          signal: AbortSignal.timeout(30 * 60_000),
        });
      } catch (error) {
        // Name the transport cause (e.g. UND_ERR_HEADERS_TIMEOUT, ECONNREFUSED, TimeoutError) without echoing its message.
        const e = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
        const cause = [e?.cause?.code, e?.code, e?.name].find((value) => typeof value === "string") ?? "unknown";
        throw new ProvisioningError("PROVIDER_ERROR", `Core is unreachable (${cause}); retry the same company to resume provisioning`);
      }
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
