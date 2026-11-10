import { describe, expect, it } from "../../testing/expect.ts";
import { recoverAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { BASE_SEPOLIA_CHAIN_ID } from "../../shared/protocol/evm/safe-contracts.ts";

import {
  assertDevKeySignerIsTestnetOnly,
  deriveDevPrivateKey,
  devPrivateKeySigner,
} from "./dev-signer.ts";
import type { BrowserStorageShape } from "./dev-signer.ts";

const SEED = "test-seed-never-funded";
const DIGEST: Hex = `0x${"ab".repeat(32)}`;

function memoryStorage(entries: Record<string, string> = {}): BrowserStorageShape {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe("deriveDevPrivateKey", () => {
  it("is deterministic and normalizes the email", () => {
    expect(deriveDevPrivateKey(SEED, "User@Example.com ")).toBe(
      deriveDevPrivateKey(SEED, "user@example.com"),
    );
  });

  it("distinct emails derive distinct keys", () => {
    expect(deriveDevPrivateKey(SEED, "a@example.com")).not.toBe(
      deriveDevPrivateKey(SEED, "b@example.com"),
    );
  });
});

describe("devPrivateKeySigner", () => {
  it("rejects an empty seed", () => {
    expect(() => devPrivateKeySigner({ seed: "  " })).toThrow(/seed/);
  });

  it("same email reproduces the same address across instances", async () => {
    const a = await devPrivateKeySigner({ seed: SEED, email: "a@example.com" }).getAddress();
    const b = await devPrivateKeySigner({ seed: SEED, email: "a@example.com" }).getAddress();
    expect(a).toBe(b);
  });

  it("distinct emails produce distinct addresses", async () => {
    const a = await devPrivateKeySigner({ seed: SEED, email: "a@example.com" }).getAddress();
    const b = await devPrivateKeySigner({ seed: SEED, email: "b@example.com" }).getAddress();
    expect(a).not.toBe(b);
  });

  it("lazily reads the session email from storage at call time", async () => {
    const storage = memoryStorage();
    const signer = devPrivateKeySigner({ seed: SEED, storage });
    await expect(signer.getAddress()).rejects.toThrow(/no cached session/);
    storage.setItem("capxul.session", JSON.stringify({ email: "late@example.com" }));
    const address = await signer.getAddress();
    const expected = privateKeyToAccount(deriveDevPrivateKey(SEED, "late@example.com")).address;
    expect(address.toLowerCase()).toBe(expected.toLowerCase());
  });

  it("signs the raw digest without EIP-191 prefix (recovers the dev EOA)", async () => {
    const signer = devPrivateKeySigner({ seed: SEED, email: "a@example.com" });
    const signature = await signer.signUserOpHash(DIGEST);
    const recovered = await recoverAddress({ hash: DIGEST, signature });
    expect(recovered.toLowerCase()).toBe((await signer.getAddress()).toLowerCase());
  });

  it("throws a clear error when no storage and no email are available", async () => {
    const signer = devPrivateKeySigner({ seed: SEED });
    await expect(signer.getAddress()).rejects.toThrow(/localStorage|email/);
  });
});

describe("assertDevKeySignerIsTestnetOnly (#1149 testnet fence)", () => {
  it("allows a dev key on Base Sepolia", () => {
    expect(
      assertDevKeySignerIsTestnetOnly({ source: "local-private-key" }, BASE_SEPOLIA_CHAIN_ID).ok,
    ).toBe(true);
  });

  it("refuses a dev key on Base mainnet", () => {
    const result = assertDevKeySignerIsTestnetOnly({ source: "local-private-key" }, 8453);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.message).toMatch(/testnet-only/);
  });

  it("leaves human custody paths alone on any chain", () => {
    expect(assertDevKeySignerIsTestnetOnly({ source: "openfort-embedded" }, 8453).ok).toBe(true);
    expect(assertDevKeySignerIsTestnetOnly({ source: "injected-eip1193" }, 1).ok).toBe(true);
    expect(assertDevKeySignerIsTestnetOnly(undefined, 8453).ok).toBe(true);
  });
});
