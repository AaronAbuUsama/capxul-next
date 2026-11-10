// CapxulSigner — the consumer-held key boundary (backend-orchestrated-deploy.md).
//
// The backend orchestrates the Safe deployment (build + gas + paymaster + submit)
// but never holds the user's key. The consumer supplies a `CapxulSigner` that
// signs exactly one thing: the EIP-712 `SafeOp` digest the backend returns for
// the prepared deployment UserOperation. `safe4337SafeOpDigest` (@capxul/config)
// computes that digest; this signer produces the owner signature; the backend
// packs + submits. Verified equivalent to permissionless's inline signing in
// `src/signing/tests/safe4337-split-sign.test.ts`.
//
// Security note: the browser signer uses `eth_sign`, which can sign arbitrary
// bytes. In the backend-orchestrated flow, `CapxulSigner` signs only the
// backend-provided SafeOp digest, so consumers must trust the backend that
// constructs the UserOperation and computes that digest. A malicious backend
// could ask the wallet to sign a harmful digest; prefer typed structured
// signing when that flow exists, and only enable raw-hash signing for trusted
// Capxul deployments.

import { CapxulError } from "../../shared/protocol/errors/model.ts";
import { Errors } from "../../shared/protocol/errors/factories.ts";
import type { FailureMode } from "../../shared/protocol/errors/failure-modes.ts";
import { isProviderUnavailableMode } from "../../shared/protocol/errors/provider-evidence.ts";
import { isEvmAddress, toAddress, type Address } from "../../shared/protocol/evm/model.ts";
import { isBytes32 } from "../../shared/protocol/evm/hex.ts";
import { isRecord, readField } from "../../shared/protocol/primitives/record.ts";
import { recoverAddress, type Hex } from "viem";

import type { AccountProviderSource } from "./account-providers.ts";
import { getFailureMode } from "../../shared/failure-mode.ts";

const ECDSA_SIGNATURE_HEX = /^0x[0-9a-fA-F]{130}$/;

/** A 65-byte ECDSA signature as 0x-hex: the shape every raw-digest signer must return. */
export function isEcdsaSignatureHex(value: string): value is Hex {
  return ECDSA_SIGNATURE_HEX.test(value);
}

export interface CapxulDigestSigner {
  /**
   * Sign the EIP-712 `SafeOp` digest the backend returns for the prepared
   * deployment UserOperation. Returns the raw 65-byte ECDSA signature; the
   * backend packs `validAfter|validUntil|signature`.
   */
  signUserOpHash(hash: Hex): Promise<Hex>;
}

export interface CapxulSigner extends CapxulDigestSigner {
  /**
   * Signer kind — surfaced on the `accountProviderReady` status so the
   * readiness ladder reports which signer the consumer wired.
   */
  readonly source: AccountProviderSource;
  /** Host-declared storage for a local key. The SDK never reads that store. */
  readonly store?: "file" | "env";
  /** Director EOA address — the Safe's single owner. */
  getAddress(): Promise<Address>;
  /**
   * Readiness this signer reports, when it runs a readiness cycle at all. Only
   * the Openfort browser signer does. `assembleCapxulClient` reads it onto
   * `client.signer`, and substitutes `UNOBSERVABLE_SIGNER_STATUS` when absent.
   */
  readonly statusStore?: SignerStatusStore;
  /**
   * Start this signer's readiness cycle, or join the one already running,
   * without signing anything. `assembleCapxulClient` calls it when the
   * identity is claimed, so the status converges on `ready` or `unavailable`
   * on its own (#1667). A signer that runs no cycle omits this, and keeps
   * reporting `unknown`.
   */
  readonly ensureWalletReady?: () => Promise<void>;
}

/**
 * Observable signer readiness (ACCESS #1520 · C12). `unknown` means the
 * wallet-ready cycle did not start. `recovering` means it is running; the
 * stale-cache heal runs inside that phase. `ready` means the signer can sign.
 * `unavailable` means the cycle failed. A failure is distinguishable from a
 * cycle that never started. That is why there are four states.
 */
export type SignerStatus = "unknown" | "recovering" | "ready" | "unavailable";

/** Subscribable readiness surface. Assembled onto `client.signer`. */
export interface SignerStatusStore {
  /** The current status. */
  status(): SignerStatus;
  /** Fires on every change. Returns its own unsubscribe. */
  subscribe(listener: (status: SignerStatus) => void): () => void;
}

/**
 * The readiness store a signer reports when it runs no readiness cycle. It
 * fails CLOSED: a node key signer or an injected wallet never claims `ready`,
 * so a gate that reads this never opens on a guess.
 */
export const UNOBSERVABLE_SIGNER_STATUS: SignerStatusStore = {
  status: () => "unknown",
  subscribe: () => () => undefined,
};

/**
 * Walk an error and its `cause` links once each. A self-referential chain
 * terminates. Both signer predicates read the chain, so they read it here.
 */
export function* causeChain(cause: unknown): Generator<Record<string, unknown>> {
  const seen = new Set<unknown>();
  let current: unknown = cause;
  while (isRecord(current) && !seen.has(current)) {
    seen.add(current);
    yield current;
    current = current.cause;
  }
}

const OPENFORT_SIGNER_NOT_READY_CODES = ["MISSING_SIGNER", "NOT_CONFIGURED"] as const;

export type OpenfortSignerNotReadyCode = (typeof OPENFORT_SIGNER_NOT_READY_CODES)[number];

const SIGNER_NOT_READY_CODES: ReadonlySet<string> = new Set(OPENFORT_SIGNER_NOT_READY_CODES);

export function isOpenfortSignerNotReadyCode(value: unknown): value is OpenfortSignerNotReadyCode {
  return typeof value === "string" && SIGNER_NOT_READY_CODES.has(value);
}

/** Return the exact Openfort code that requires an embedded-signer rebuild. */
export function openfortSignerNotReadyCode(cause: unknown): OpenfortSignerNotReadyCode | undefined {
  for (const link of causeChain(cause)) {
    for (const value of [link.error, link.code, readField(link.details, "provider_error_code")]) {
      if (isOpenfortSignerNotReadyCode(value)) return value;
    }
  }
  return undefined;
}

/** Openfort's typed signal that its embedded signer state must be rebuilt. */
export function isSignerNotReadySignal(cause: unknown): boolean {
  return openfortSignerNotReadyCode(cause) !== undefined;
}

/** The HTTP status one cause link names, wherever its kind of error keeps it. */
export function httpStatusOf(link: Record<string, unknown>): number | undefined {
  for (const status of [
    readField(link.response, "status"),
    link.statusCode,
    link.status,
    readField(link.details, "httpStatus"),
  ]) {
    if (typeof status === "number") return status;
  }
  return undefined;
}

/** The first HTTP status a cause chain names. */
function chainHttpStatus(cause: unknown): number | undefined {
  for (const link of causeChain(cause)) {
    const status = httpStatusOf(link);
    if (status !== undefined) return status;
  }
  return undefined;
}

/**
 * A provider failure on the signer path, with the mode its cause named and
 * the HTTP status its cause chain carries. A refusal keeps its mode when the
 * chain carries no status, because the provider's error class or code named
 * it (ADR-0023 R8). With no mode, nothing says what happened: `unknown`.
 */
export function signerPathFailure(input: {
  readonly provider: "openfort" | "signer";
  readonly operation: string;
  readonly mode: FailureMode | undefined;
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
}): CapxulError<"PROVIDER_ERROR"> {
  const { mode, ...evidence } = input;
  if (mode === undefined) return Errors.providerUnavailable({ ...evidence, mode: "unknown" });
  const httpStatus = chainHttpStatus(input.cause);
  if (isProviderUnavailableMode(mode))
    return Errors.providerUnavailable({ ...evidence, mode, httpStatus });
  return httpStatus === undefined
    ? Errors.providerRefused({ ...evidence, mode })
    : Errors.providerRefused({ ...evidence, httpStatus, mode });
}

/** Fold a signer throw into the public error contract. */
export function signerFailure(source: AccountProviderSource, operation: string, cause: unknown) {
  let failureMode: FailureMode | undefined;
  let typedProvider: CapxulError | undefined;
  const signerNotReadyCode =
    source === "openfort-embedded" ? openfortSignerNotReadyCode(cause) : undefined;
  for (const link of causeChain(cause)) {
    if (link instanceof CapxulError && link.code === "SIGNER_REJECTED") return link;
    // A typed provider failure keeps its own code. An unusable answer stays
    // PROVIDER_RESPONSE_INVALID: a PROVIDER_ERROR wrap would make it retryable.
    if (
      link instanceof CapxulError &&
      (link.code === "PROVIDER_ERROR" || link.code === "PROVIDER_RESPONSE_INVALID")
    )
      typedProvider ??= link;
    failureMode = getFailureMode(link) ?? failureMode;
    if (link.code === 4001 || link.error === "passkey_user_cancelled") {
      return Errors.signerRejected({ source, cause });
    }
    if (signerNotReadyCode !== undefined) failureMode = "signer-not-ready";
  }
  if (
    typedProvider !== undefined &&
    (typedProvider.details?.failure_mode === undefined || typedProvider.mode !== undefined) &&
    (signerNotReadyCode === undefined || typedProvider.mode === "signer-not-ready")
  )
    return typedProvider;
  return signerPathFailure({
    provider: "signer",
    operation,
    mode: failureMode,
    cause,
    ...(signerNotReadyCode === undefined
      ? {}
      : {
          details: { provider_error_source: "openfort", provider_error_code: signerNotReadyCode },
        }),
  });
}

/** Minimal EIP-1193 surface an injected browser wallet exposes. */
export interface Eip1193RequestProvider {
  request(args: {
    readonly method: string;
    readonly params?: readonly unknown[];
  }): Promise<unknown>;
}

/**
 * Browser `CapxulSigner` backed by an injected EIP-1193 wallet (MetaMask, etc.).
 * Signs the SafeOp digest via `eth_sign`, then verifies the returned signature
 * recovers the selected account against that raw digest. Wallets that prefix
 * `eth_sign` payloads are rejected before the backend submits an invalid SafeOp.
 * The node key signer lives in `@capxul/sdk/node` (`localPrivateKeySigner`).
 */
export function injectedWalletSigner(provider: Eip1193RequestProvider): CapxulSigner {
  const resolveAddress = async (): Promise<Address> => {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const first = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof first !== "string") {
      throw new Error("injectedWalletSigner: wallet returned no accounts");
    }
    if (!isEvmAddress(first)) {
      throw new Error("injectedWalletSigner: wallet returned invalid address format");
    }
    return toAddress(first);
  };
  return {
    source: "injected-eip1193",
    getAddress: resolveAddress,
    async signUserOpHash(hash: Hex): Promise<Hex> {
      if (!isBytes32(hash)) {
        throw new Error("injectedWalletSigner: SafeOp digest must be a 0x-prefixed 32-byte hex");
      }
      const address = await resolveAddress();
      let signature: unknown;
      try {
        signature = await provider.request({ method: "eth_sign", params: [address, hash] });
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `injectedWalletSigner: eth_sign failed; enable raw-hash signing for deployment (${detail})`,
          { cause },
        );
      }
      if (typeof signature !== "string") {
        throw new Error("injectedWalletSigner: wallet returned a non-string signature");
      }
      if (!isEcdsaSignatureHex(signature)) {
        throw new Error("injectedWalletSigner: wallet returned invalid signature format");
      }
      const recovered = await recoverRawDigestSigner("injectedWalletSigner", { hash, signature });
      if (recovered.toLowerCase() !== address.toLowerCase()) {
        throw new Error(
          "injectedWalletSigner: wallet signature did not recover the selected account for the raw SafeOp digest; use a raw-hash-capable wallet or @capxul/sdk/node localPrivateKeySigner for deployed flows",
        );
      }
      return signature;
    },
  };
}

/** The address that signed `hash`; `signerName` prefixes the error when it cannot be recovered. */
export async function recoverRawDigestSigner(
  signerName: string,
  input: { readonly hash: Hex; readonly signature: Hex },
): Promise<Address> {
  try {
    return toAddress(await recoverAddress(input));
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${signerName}: could not verify raw SafeOp digest signature (${detail})`, {
      cause,
    });
  }
}
