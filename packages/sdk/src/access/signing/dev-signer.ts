// devPrivateKeySigner — browser-safe dev-mode `CapxulSigner` (dogfood only).
//
// Derives a deterministic throwaway EOA per email: privateKey =
// keccak256(utf8(seed + normalizedEmail)). Re-login with the same email
// reproduces the same signer, so binding resolution (signerAddress-hint
// path) and the account lane stay coherent without Openfort. The seed is a
// dev-only secret for unfunded keys; never fund these accounts.
//
// The signer is constructed before login, so the email is resolved lazily:
// at first use it reads the cached `AuthSession` the SDK wrote to browser
// localStorage (`capxul.session`, BrowserAuthCacheAdapter) — or uses the
// explicit `email` override (tests / non-browser harnesses).

import { readField } from "../../shared/protocol/primitives/record.ts";
import { toAddress, type Address } from "../../shared/protocol/evm/model.ts";
import { keccak256, stringToHex, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { BASE_SEPOLIA_CHAIN_ID } from "../../shared/protocol/evm/safe-contracts.ts";
import { Errors } from "../../shared/protocol/errors/factories.ts";
import { normalizeBindingEmail } from "../../shared/protocol/accounts/binding.ts";

import { globalLocalStorage } from "../../shared/window-like.ts";
import type { CapxulResult } from "../../shared/results.ts";
import type { CapxulSigner } from "./signer.ts";

/** The three methods of the browser storage the cached session lives in (the old `#access` exported this shape). */
export interface BrowserStorageShape {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SESSION_KEY = "capxul.session";

/**
 * Chains a `local-private-key` signer may sign on. Base Sepolia only, and this
 * list does not grow without an ADR: the keys are deterministic throwaways
 * derived from a shared seed (see `deriveDevPrivateKey`), so anyone holding
 * the seed holds every account. A dev key on a value-bearing chain is a
 * custody incident, not a config mistake.
 */
const DEV_KEY_ALLOWED_CHAIN_IDS: readonly number[] = [BASE_SEPOLIA_CHAIN_ID];

/**
 * Testnet fence for the dev-key signing lane (#1149, folds #1065; ADR-0018 P9
 * human/Openfort vs agent/dev-key split). Call it wherever a signer first
 * meets a resolved chain; it refuses before the signer can be used.
 *
 * Only `local-private-key` signers are fenced — Openfort-embedded and injected
 * wallets carry their own custody and are the sanctioned human paths.
 */
export function assertDevKeySignerIsTestnetOnly(
  signer: { readonly source?: string } | undefined,
  chainId: number,
): CapxulResult<void> {
  if (signer?.source !== "local-private-key") return { ok: true, value: undefined };
  if (DEV_KEY_ALLOWED_CHAIN_IDS.includes(chainId)) return { ok: true, value: undefined };
  return {
    ok: false,
    error: Errors.invalidInput(
      "signer",
      `dev-key signer is testnet-only: chain ${chainId} is not allowed (expected ${DEV_KEY_ALLOWED_CHAIN_IDS.join(", ")})`,
    ),
  };
}

export interface DevPrivateKeySignerInput {
  /** Dev-only derivation seed (e.g. `VITE_CAPXUL_DEV_SIGNER_SEED`). Throwaway keys only. */
  readonly seed: string;
  /** Explicit email — skips the auth-cache lookup (tests, node harnesses). */
  readonly email?: string;
  /** Storage holding the cached session. Defaults to browser `localStorage`. */
  readonly storage?: BrowserStorageShape;
}

/** Deterministic dev private key for an email under a seed. Exported for probes. */
export function deriveDevPrivateKey(seed: string, email: string): Hex {
  return keccak256(stringToHex(seed + normalizeBindingEmail(email)));
}

function readSessionEmail(storage: BrowserStorageShape | undefined): string {
  const resolved = storage ?? globalLocalStorage();
  if (resolved === undefined) {
    throw new Error(
      "devPrivateKeySigner: no browser localStorage available and no explicit email supplied",
    );
  }
  const raw = resolved.getItem(SESSION_KEY);
  if (raw === null) {
    throw new Error(
      "devPrivateKeySigner: no cached session yet — sign in before the account lane uses the signer",
    );
  }
  let session: unknown;
  try {
    session = JSON.parse(raw);
  } catch (cause) {
    throw new Error("devPrivateKeySigner: cached session is not valid JSON", { cause });
  }
  // `null` parses but has no fields to read, so it counts as invalid JSON too.
  if (session === null) throw new Error("devPrivateKeySigner: cached session is not valid JSON");
  const email = readField(session, "email");
  if (typeof email !== "string" || email.length === 0) {
    throw new Error("devPrivateKeySigner: cached session has no email");
  }
  return email;
}

/**
 * Browser-safe dev signer. Lazy: the email (and so the key) is resolved at
 * each `getAddress()` / `signUserOpHash()` from the cached session, so the
 * same signer instance follows whichever user is signed in.
 */
export function devPrivateKeySigner(input: DevPrivateKeySignerInput): CapxulSigner {
  if (input.seed.trim().length === 0) {
    throw new Error("devPrivateKeySigner: seed must be non-empty");
  }
  const accounts = new Map<string, PrivateKeyAccount>();
  const resolveAccount = (): PrivateKeyAccount => {
    const email = normalizeBindingEmail(input.email ?? readSessionEmail(input.storage));
    const cached = accounts.get(email);
    if (cached !== undefined) return cached;
    const account = privateKeyToAccount(deriveDevPrivateKey(input.seed, email));
    accounts.set(email, account);
    return account;
  };
  return {
    source: "local-private-key",
    async getAddress(): Promise<Address> {
      return toAddress(resolveAccount().address);
    },
    async signUserOpHash(hash: Hex): Promise<Hex> {
      // Raw digest signing — same semantics as `localPrivateKeySigner` in
      // `@capxul/sdk/node`: no EIP-191 prefix on the SafeOp digest.
      return resolveAccount().sign({ hash });
    },
  };
}
