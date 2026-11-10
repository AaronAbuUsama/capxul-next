import { Errors } from "../../shared/protocol/errors/factories.ts";
import { toAddress, type Address } from "../../shared/protocol/evm/model.ts";
import type { Account as ViemAccount, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { signerFailure } from "./signer.ts";
import type { CapxulResult } from "../../shared/results.ts";

export type AccountProviderSource = "local-private-key" | "openfort-embedded" | "injected-eip1193";

export type AccountRequirement = "none" | "counterfactual" | "deployed";

export interface AccountProvider {
  readonly source: AccountProviderSource;
  /**
   * Resolve the signer's EVM address.
   *
   * @determinism MUST return the same `Address` across calls for the
   * lifetime of a single provider instance — the SDK-level deploy mutex
   * keys on `(authUserId, safeAddress)` where `safeAddress` is computed
   * from `getAddress()`'s result before the port's `prepare()` round-trip.
   * If two successive calls returned different addresses, concurrent
   * `deploySafe` invocations would compute different mutex keys and
   * bypass dedup, defeating the mutex.
   *
   * The two sanctioned providers both satisfy this invariant:
   *   - `localPrivateKeyAccountProvider` — derives once from the key
   *   - `eip1193AccountProvider` — reads `eth_accounts` (idempotent once
   *     the wallet is connected; consumer is responsible for connection)
   *
   * The Openfort embedded path no longer needs a provider: the
   * `embeddedSigner` `CapxulSigner` caches its own address and the
   * deploy is backend-orchestrated (backend-orchestrated-deploy.md).
   *
   * Custom providers MUST honor this contract.
   */
  getAddress(): Promise<CapxulResult<Address>>;
  getDeployAccount(): Promise<CapxulResult<ViemAccount>>;
}

export interface Eip1193Provider {
  request(args: {
    readonly method: string;
    readonly params?: readonly unknown[];
  }): Promise<unknown>;
}

export function localPrivateKeyAccountProvider(input: {
  readonly privateKey: Hex;
}): AccountProvider {
  const account = privateKeyToAccount(input.privateKey);
  const address = toAddress(account.address);
  return {
    source: "local-private-key",
    async getAddress() {
      return { ok: true, value: address };
    },
    async getDeployAccount() {
      return { ok: true, value: account };
    },
  };
}

export function eip1193AccountProvider(input: {
  readonly provider: Eip1193Provider;
}): AccountProvider {
  // Cache the first successful address to honor the determinism contract on
  // `AccountProvider.getAddress` (see JSDoc above). Without this cache, a user
  // switching accounts in their browser wallet mid-flow would produce a
  // different `Address` on successive calls, defeating the deploy mutex.
  // Errors are intentionally NOT cached — transient wallet-not-connected or
  // RPC failures must remain retryable.
  //
  // `inFlight` memoizes the in-progress request so that concurrent first
  // callers (e.g. two `await provider.getAddress()` issued in parallel before
  // either resolves) share the same `eth_accounts` round-trip and the same
  // resolved Address. Without it, both calls would race, both would hit the
  // wallet, and the second resolver could overwrite `cachedAddress` with a
  // stale-vs-fresh wallet read — defeating determinism even with the resolved
  // cache. Cleared in `finally` so the lane stays retryable after errors.
  let cachedAddress: Address | null = null;
  let inFlight: Promise<CapxulResult<Address>> | null = null;

  const getAddress = async (): Promise<CapxulResult<Address>> => {
    if (cachedAddress !== null) {
      return { ok: true, value: cachedAddress };
    }
    if (inFlight !== null) {
      return inFlight;
    }
    inFlight = (async () => {
      try {
        const accounts = await input.provider.request({ method: "eth_accounts" });
        const first = firstAccount(accounts);
        if (first === null) {
          return { ok: false, error: Errors.smartAccountMissing("eip1193-account") };
        }
        const address = toAddress(first);
        cachedAddress = address;
        return { ok: true, value: address };
      } catch (err) {
        return {
          ok: false,
          error: signerFailure("injected-eip1193", "eth_accounts", err),
        };
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
  return {
    source: "injected-eip1193",
    getAddress,
    async getDeployAccount() {
      return {
        ok: false,
        error: Errors.notImplemented("Eip1193AccountProvider", "getDeployAccount"),
      };
    },
  };
}

function firstAccount(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const first = value[0];
  return typeof first === "string" ? first : null;
}
