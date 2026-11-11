// CapxulSigner constructors (backend-orchestrated-deploy.md · #289). The signer
// is the only consumer-held key boundary: it signs exactly one SafeOp digest.
// `localPrivateKeySigner` (Node) + `injectedWalletSigner` (browser EIP-1193).

import { describe, expect, it } from "../../testing/expect.ts";
import { privateKeyToAccount } from "viem/accounts";

import { CapxulError } from "../../shared/protocol/errors/model.ts";
import { Errors } from "../../shared/protocol/errors/factories.ts";
import { toAddress } from "../../shared/protocol/evm/model.ts";

import { injectedWalletSigner, signerFailure, type Eip1193RequestProvider } from "./signer.ts";
import { localPrivateKeySigner } from "./local-key-signer.ts";

const PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const EXPECTED_ADDRESS = privateKeyToAccount(PRIVATE_KEY).address;
const DIGEST = `0x${"ab".repeat(32)}` as const;

describe("signerFailure (ADR-0023 R5)", () => {
  it("keeps an already typed provider operation and safe status", () => {
    const typed = Errors.providerRefused({
      provider: "openfort",
      operation: "configure",
      httpStatus: 401,
      mode: "unauthorized",
      cause: new Error("private cause"),
      details: { walletStage: "walletReady" },
    });
    expect(signerFailure("openfort-embedded", "getAddress", typed)).toBe(typed);
  });

  it("keeps a provider answer Capxul cannot use as PROVIDER_RESPONSE_INVALID", () => {
    const unusable = Errors.providerResponseInvalid({
      provider: "openfort",
      operation: "token",
      field: "session",
      problem: "missing",
    });

    expect(signerFailure("openfort-embedded", "getAddress", unusable)).toBe(unusable);
  });

  it("maps a nested EIP-1193 user rejection to SIGNER_REJECTED", () => {
    const cause = new Error("wallet request failed", { cause: { code: 4001 } });

    const error = signerFailure("injected-eip1193", "signUserOpHash", cause);

    expect(error.code).toBe("SIGNER_REJECTED");
    expect(error.details).toEqual({ source: "injected-eip1193" });
    expect(error.cause).toBe(cause);
  });

  it("maps a nested Openfort user cancellation to SIGNER_REJECTED", () => {
    const cause = new Error("embedded signing failed", {
      // The Openfort SDK class is not a dependency here; signerFailure reads its `error` field.
      cause: Object.assign(new Error("passkey cancelled"), { error: "passkey_user_cancelled" }),
    });

    const error = signerFailure("openfort-embedded", "signUserOpHash", cause);

    expect(error.code).toBe("SIGNER_REJECTED");
    expect(error.details).toEqual({ source: "openfort-embedded" });
    expect(error.cause).toBe(cause);
  });

  it("preserves a nested canonical SIGNER_REJECTED error", () => {
    const rejected = Errors.signerRejected({
      source: "openfort-embedded",
      reason: "user_cancelled",
    });
    const cause = new Error("embedded signing failed", { cause: rejected });

    expect(signerFailure("openfort-embedded", "signUserOpHash", cause)).toBe(rejected);
  });

  it("preserves an already classified provider failure", () => {
    const cause = Errors.providerUnavailable({
      provider: "openfort",
      operation: "configure",
      mode: "no-secure-context",
      cause: new Error("unavailable"),
    });

    const error = signerFailure("injected-eip1193", "getAddress", cause);

    expect(error.code).toBe("PROVIDER_ERROR");
    expect(error).toBe(cause);
  });

  it.each(["MISSING_SIGNER", "NOT_CONFIGURED"])(
    "classifies Openfort %s as signer-not-ready",
    (vendorCode) => {
      const cause = new Error("embedded signing failed", {
        cause: Object.assign(new Error("private vendor text"), { error: vendorCode }),
      });

      const error = signerFailure("openfort-embedded", "signUserOpHash", cause);

      expect(error.code).toBe("PROVIDER_ERROR");
      expect(error.mode).toBe("signer-not-ready");
      expect(error.details).toEqual({
        provider: "signer",
        operation: "signUserOpHash",
        provider_error_source: "openfort",
        provider_error_code: vendorCode,
        failure_mode: "signer-not-ready",
      });
    },
  );

  it("does not apply Openfort signer codes to an injected wallet", () => {
    const cause = Object.assign(new Error("wallet unavailable"), { code: "NOT_CONFIGURED" });

    const error = signerFailure("injected-eip1193", "signUserOpHash", cause);

    expect(error.code).toBe("PROVIDER_ERROR");
    expect(error.mode).toBe("unknown");
    expect(error.details).not.toHaveProperty("provider_error_source");
    expect(error.details).not.toHaveProperty("provider_error_code");
  });

  it("keeps the Openfort code through a recovery error", () => {
    const recoveryError = Errors.providerUnavailable({
      provider: "openfort",
      operation: "signerRecovery",
      mode: "signer-not-ready",
      cause: new Error("failed"),
      details: {
        provider_error_source: "openfort",
        provider_error_code: "MISSING_SIGNER",
      },
    });

    const error = signerFailure("openfort-embedded", "signUserOpHash", recoveryError);

    expect(error).toBe(recoveryError);
    expect(error.mode).toBe("signer-not-ready");
    expect(error.details).toMatchObject({
      provider: "openfort",
      operation: "signerRecovery",
      provider_error_source: "openfort",
      provider_error_code: "MISSING_SIGNER",
    });
  });

  it("preserves an unusable provider answer", () => {
    const answer = Errors.providerResponseInvalid({
      provider: "openfort",
      operation: "encryptionSession",
      field: "sessionId",
      problem: "missing",
    });
    const cause = new Error("readiness failed", { cause: answer });

    expect(signerFailure("openfort-embedded", "getAddress", cause)).toBe(answer);
  });

  it("names a diagnosis with the status its cause carries", () => {
    const refused = new CapxulError("NOT_AUTHENTICATED", "origin refused", {
      details: { failure_mode: "app-env-allowlist", httpStatus: 401 },
    });

    const error = signerFailure("injected-eip1193", "getAddress", refused);

    expect(error).toMatchObject({
      code: "PROVIDER_ERROR",
      mode: "app-env-allowlist",
      details: { provider: "signer", operation: "getAddress", httpStatus: 401 },
    });
    expect(error.cause).toBe(refused);
  });

  it("keeps a diagnosis no status carries, because the mode is its evidence", () => {
    const refused = new CapxulError("NOT_AUTHENTICATED", "origin refused", {
      details: { failure_mode: "app-env-allowlist" },
    });

    const error = signerFailure("injected-eip1193", "getAddress", refused);

    expect(error.code).toBe("PROVIDER_ERROR");
    expect(error.mode).toBe("app-env-allowlist");
    expect(error.details).toEqual({
      provider: "signer",
      operation: "getAddress",
      failure_mode: "app-env-allowlist",
    });
    expect(error.cause).toBe(refused);
  });

  it("names a refusal mode with the status its cause carries", () => {
    const refused = new CapxulError("NOT_AUTHENTICATED", "origin refused", {
      details: { failure_mode: "forbidden", httpStatus: 403 },
    });

    const error = signerFailure("injected-eip1193", "getAddress", refused);

    expect(error).toMatchObject({
      code: "PROVIDER_ERROR",
      mode: "forbidden",
      details: { provider: "signer", operation: "getAddress", httpStatus: 403 },
    });
  });

  it("keeps the refusal mode its cause named when no status rides with it (ADR-0023 R8)", () => {
    const refused = new CapxulError("NOT_AUTHENTICATED", "origin refused", {
      details: { failure_mode: "forbidden" },
    });

    const error = signerFailure("injected-eip1193", "getAddress", refused);

    expect(error.code).toBe("PROVIDER_ERROR");
    expect(error.mode).toBe("forbidden");
    expect(error.details).not.toHaveProperty("httpStatus");
    expect(error.cause).toBe(refused);
  });

  it("drops an invalid provider failure mode", () => {
    const cause = new CapxulError("PROVIDER_ERROR", "provider failed", {
      details: {
        provider: "openfort",
        operation: "configure",
        failure_mode: "not-a-failure-mode",
      },
    });

    const error = signerFailure("openfort-embedded", "getAddress", cause);

    expect(error.code).toBe("PROVIDER_ERROR");
    expect(error.details).toEqual({
      provider: "signer",
      operation: "getAddress",
      failure_mode: "unknown",
    });
    expect(error.cause).toBe(cause);
  });
});

describe("localPrivateKeySigner (#289)", () => {
  it("reports source local-private-key and the key's address", async () => {
    const signer = localPrivateKeySigner({ privateKey: PRIVATE_KEY });
    expect(signer.source).toBe("local-private-key");
    expect((await signer.getAddress()).toLowerCase()).toBe(EXPECTED_ADDRESS.toLowerCase());
  });

  it("signs the digest as a 65-byte ECDSA signature", async () => {
    const signer = localPrivateKeySigner({ privateKey: PRIVATE_KEY });
    const sig = await signer.signUserOpHash(DIGEST);
    expect(sig).toMatch(/^0x[0-9a-fA-F]{130}$/);
  });

  it("signs the raw SafeOp digest without the EIP-191 message prefix", async () => {
    const signer = localPrivateKeySigner({ privateKey: PRIVATE_KEY });
    const account = privateKeyToAccount(PRIVATE_KEY);
    const sig = await signer.signUserOpHash(DIGEST);
    expect(sig).toBe(await account.sign({ hash: DIGEST }));
    expect(sig).not.toBe(await account.signMessage({ message: { raw: DIGEST } }));
  });
});

function mockProvider(handlers: Record<string, (params?: readonly unknown[]) => unknown>): {
  readonly provider: Eip1193RequestProvider;
  readonly calls: Array<{ readonly method: string; readonly params?: readonly unknown[] }>;
} {
  const calls: Array<{ readonly method: string; readonly params?: readonly unknown[] }> = [];
  const provider: Eip1193RequestProvider = {
    async request({ method, params }) {
      calls.push(params === undefined ? { method } : { method, params });
      const handler = handlers[method];
      if (handler === undefined) throw new Error(`unexpected method ${method}`);
      return handler(params);
    },
  };
  return { provider, calls };
}

describe("injectedWalletSigner (#289 · browser EIP-1193 path)", () => {
  it("reports source injected-eip1193 and resolves the wallet address", async () => {
    const { provider } = mockProvider({ eth_requestAccounts: () => [EXPECTED_ADDRESS] });
    const signer = injectedWalletSigner(provider);
    expect(signer.source).toBe("injected-eip1193");
    expect(await signer.getAddress()).toBe(toAddress(EXPECTED_ADDRESS));
  });

  it("signs the digest via eth_sign with [address, hash]", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const signature = await account.sign({ hash: DIGEST });
    const { provider, calls } = mockProvider({
      eth_requestAccounts: () => [EXPECTED_ADDRESS],
      eth_sign: () => signature,
    });
    const signer = injectedWalletSigner(provider);
    expect(await signer.signUserOpHash(DIGEST)).toBe(signature);
    const ethSign = calls.find((c) => c.method === "eth_sign");
    expect(ethSign?.params).toEqual([toAddress(EXPECTED_ADDRESS), DIGEST]);
  });

  it("rejects malformed SafeOp digests before calling the wallet", async () => {
    const { provider, calls } = mockProvider({
      eth_requestAccounts: () => [EXPECTED_ADDRESS],
      eth_sign: () => "unused",
    });
    const signer = injectedWalletSigner(provider);
    await expect(signer.signUserOpHash("0xdeadbeef")).rejects.toThrow(/32-byte hex/);
    expect(calls).toEqual([]);
  });

  it("rejects signatures that only recover against an EIP-191-prefixed message", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const prefixedSignature = await account.signMessage({ message: { raw: DIGEST } });
    const { provider } = mockProvider({
      eth_requestAccounts: () => [EXPECTED_ADDRESS],
      eth_sign: () => prefixedSignature,
    });

    await expect(injectedWalletSigner(provider).signUserOpHash(DIGEST)).rejects.toThrow(
      /raw SafeOp digest/,
    );
  });

  it("throws when the wallet returns no accounts", async () => {
    const { provider } = mockProvider({ eth_requestAccounts: () => [] });
    await expect(injectedWalletSigner(provider).getAddress()).rejects.toThrow(/no accounts/);
  });

  it("throws when the wallet returns a malformed account", async () => {
    const { provider } = mockProvider({ eth_requestAccounts: () => ["not-an-address"] });
    await expect(injectedWalletSigner(provider).getAddress()).rejects.toThrow(/invalid address/);
  });

  it("throws when the wallet returns a non-string signature", async () => {
    const { provider } = mockProvider({
      eth_requestAccounts: () => [EXPECTED_ADDRESS],
      eth_sign: () => 42,
    });
    await expect(injectedWalletSigner(provider).signUserOpHash(DIGEST)).rejects.toThrow(
      /non-string signature/,
    );
  });

  it("throws when the wallet returns a malformed signature", async () => {
    const { provider } = mockProvider({
      eth_requestAccounts: () => [EXPECTED_ADDRESS],
      eth_sign: () => "0xdeadbeef",
    });
    await expect(injectedWalletSigner(provider).signUserOpHash(DIGEST)).rejects.toThrow(
      /invalid signature/,
    );
  });

  it("surfaces an actionable error when eth_sign is unavailable", async () => {
    const { provider } = mockProvider({
      eth_requestAccounts: () => [EXPECTED_ADDRESS],
      eth_sign: () => {
        throw new Error("method not supported");
      },
    });
    await expect(injectedWalletSigner(provider).signUserOpHash(DIGEST)).rejects.toThrow(
      /eth_sign failed/,
    );
  });
});
