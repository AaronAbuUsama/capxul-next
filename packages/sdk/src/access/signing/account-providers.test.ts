import { describe, expect, it } from "../../testing/expect.ts";

import { toAddress } from "../../shared/protocol/evm/model.ts";

import { eip1193AccountProvider, localPrivateKeyAccountProvider } from "./account-providers.ts";

const PRIVATE_KEY = `0x${"1".repeat(64)}` as const;
const SELECTED_ADDRESS = "0x000000000000000000000000000000000000dEaD";

describe("account providers", () => {
  it("wraps a local private key as the same account-provider lane", async () => {
    const provider = localPrivateKeyAccountProvider({ privateKey: PRIVATE_KEY });

    const address = await provider.getAddress();
    const account = await provider.getDeployAccount();

    expect(provider.source).toBe("local-private-key");
    expect(address.ok).toBe(true);
    expect(account.ok).toBe(true);
    if (account.ok && address.ok) {
      expect(toAddress(account.value.address)).toBe(address.value);
    }
  });

  it("reads EIP-1193 selected accounts without requesting account permission", async () => {
    const calls: string[] = [];
    const provider = eip1193AccountProvider({
      provider: {
        request: async ({ method }) => {
          calls.push(method);
          return [SELECTED_ADDRESS];
        },
      },
    });

    const address = await provider.getAddress();

    expect(address).toEqual({ ok: true, value: toAddress(SELECTED_ADDRESS) });
    expect(calls).toEqual(["eth_accounts"]);
  });

  it("returns account-missing when an EIP-1193 provider has no selected account", async () => {
    const provider = eip1193AccountProvider({
      provider: {
        request: async () => ({}),
      },
    });

    const address = await provider.getAddress();
    const signer = await provider.getDeployAccount();

    expect(address.ok).toBe(false);
    expect(signer.ok).toBe(false);
    if (!address.ok) expect(address.error.code).toBe("SMART_ACCOUNT_MISSING");
    if (!signer.ok) expect(signer.error.code).toBe("NOT_IMPLEMENTED");
  });

  it("returns account-missing when EIP-1193 accounts are malformed", async () => {
    const provider = eip1193AccountProvider({
      provider: {
        request: async () => [42],
      },
    });

    const address = await provider.getAddress();

    expect(address.ok).toBe(false);
    if (!address.ok) expect(address.error.code).toBe("SMART_ACCOUNT_MISSING");
  });

  it("maps EIP-1193 account lookup provider failures", async () => {
    const provider = eip1193AccountProvider({
      provider: {
        request: async () => {
          throw new Error("wallet unavailable");
        },
      },
    });

    const address = await provider.getAddress();

    expect(address.ok).toBe(false);
    if (!address.ok) expect(address.error.code).toBe("PROVIDER_ERROR");
  });

  it("keeps EIP-1193 deployment support explicit until the real adapter lands", async () => {
    const calls: Array<{ readonly method: string; readonly params?: readonly unknown[] }> = [];
    const provider = eip1193AccountProvider({
      provider: {
        request: async ({ method, params }) => {
          calls.push(params === undefined ? { method } : { method, params });
          return method === "eth_accounts" ? [SELECTED_ADDRESS] : null;
        },
      },
    });

    const account = await provider.getDeployAccount();
    expect(account.ok).toBe(false);
    if (!account.ok) expect(account.error.code).toBe("NOT_IMPLEMENTED");
    expect(calls).toEqual([]);
  });

  it("returns the same EIP-1193 Address across multiple getAddress calls (determinism contract)", async () => {
    let callCount = 0;
    const provider = eip1193AccountProvider({
      provider: {
        request: async () => {
          callCount++;
          return [SELECTED_ADDRESS];
        },
      },
    });

    const first = await provider.getAddress();
    const second = await provider.getAddress();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.value).toBe(second.value);
    // Cache MUST eliminate the second wire call — keys the deploy mutex.
    expect(callCount).toBe(1);
  });

  it("dedupes concurrent first getAddress calls into a single wire round-trip", async () => {
    // Race scenario: two callers `await provider.getAddress()` in parallel
    // BEFORE either resolves. Without in-flight memoization, both would call
    // `eth_accounts` and the later resolver could overwrite `cachedAddress`,
    // defeating determinism even with the resolved-cache guard.
    //
    // Resolvers are captured into an array (not a single mutable slot) so a
    // dedupe regression — which would issue a SECOND `request()` call — gets
    // detected by the `callCount === 1` assertion BEFORE we await. With a
    // single-slot capture, a regression would orphan the first request's
    // resolver and hang `Promise.all` indefinitely.
    let callCount = 0;
    const resolvers: Array<(value: readonly string[]) => void> = [];
    const provider = eip1193AccountProvider({
      provider: {
        request: async () => {
          callCount++;
          return new Promise<readonly string[]>((resolve) => {
            resolvers.push(resolve);
          });
        },
      },
    });

    const first = provider.getAddress();
    const second = provider.getAddress();
    if (resolvers.length === 0) {
      throw new Error("expected request to have been invoked before resolution");
    }
    // Fail fast on dedupe regression: catch a second wire call here rather
    // than letting Promise.all stall waiting on an orphaned resolver.
    expect(callCount).toBe(1);
    for (const resolve of resolvers) {
      resolve([SELECTED_ADDRESS]);
    }

    const [a, b] = await Promise.all([first, second]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value).toBe(b.value);
    expect(callCount).toBe(1);
  });

  it("re-attempts the EIP-1193 lookup after a transient failure (errors are not cached)", async () => {
    let callCount = 0;
    const provider = eip1193AccountProvider({
      provider: {
        request: async () => {
          callCount++;
          if (callCount === 1) throw new Error("wallet unavailable");
          return [SELECTED_ADDRESS];
        },
      },
    });

    const first = await provider.getAddress();
    const second = await provider.getAddress();

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    if (!first.ok) expect(first.error.code).toBe("PROVIDER_ERROR");
    if (second.ok) expect(second.value).toBe(toAddress(SELECTED_ADDRESS));
    expect(callCount).toBe(2);
  });
});
