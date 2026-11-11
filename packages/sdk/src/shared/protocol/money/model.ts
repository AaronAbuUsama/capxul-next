import { Errors } from "../errors/factories.ts";
import type { Brand } from "../primitives/brand.ts";
import { toChainId, toAddress } from "../evm/model.ts";
import { invalidValueReason } from "../primitives/validation.ts";

/** Canonical ERC-20 CAIP-19 identity. Currency is not asset identity. */
export type AssetId = Brand<string, "AssetId">;

/** One asset quantity in major units. Registry metadata supplies precision. */
export type AssetAmount = {
  readonly asset: AssetId;
  readonly value: string;
};

// Fiat value in major units. Legacy token readers retain this shape during
// migration. New token quantities use AssetAmount and registry precision.
export type Money = {
  readonly currency: CurrencyCode;
  readonly value: string;
  readonly decimals: number;
};

export type CurrencyCode = Brand<SupportedCurrencyCode, "CurrencyCode">;

export const ASSET_ID_RE = /^eip155:([1-9][0-9]*)\/erc20:(0x[0-9a-f]{40})$/;

export const CURRENCY_SYMBOLS = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  NGN: "NGN",
  GHS: "GHS",
  KES: "KSh",
  UGX: "USh",
} as const;

type SupportedCurrencyCode = keyof typeof CURRENCY_SYMBOLS;

export const SUPPORTED_CURRENCIES = [
  { code: "USD", symbol: CURRENCY_SYMBOLS.USD, name: "US Dollar" },
  { code: "EUR", symbol: CURRENCY_SYMBOLS.EUR, name: "Euro" },
  { code: "GBP", symbol: CURRENCY_SYMBOLS.GBP, name: "British Pound" },
  { code: "NGN", symbol: CURRENCY_SYMBOLS.NGN, name: "Nigerian Naira" },
  { code: "GHS", symbol: CURRENCY_SYMBOLS.GHS, name: "Ghanaian Cedi" },
  { code: "KES", symbol: CURRENCY_SYMBOLS.KES, name: "Kenyan Shilling" },
  { code: "UGX", symbol: CURRENCY_SYMBOLS.UGX, name: "Ugandan Shilling" },
] as const satisfies readonly {
  readonly code: SupportedCurrencyCode;
  readonly symbol: string;
  readonly name: string;
}[];

export const SUPPORTED_CURRENCY_CODES = SUPPORTED_CURRENCIES.map((currency) => currency.code);

/** Reads the table the type is built from, so the guard and the type cannot disagree. */
export function isSupportedCurrencyCode(raw: string): raw is SupportedCurrencyCode {
  return Object.hasOwn(CURRENCY_SYMBOLS, raw);
}

/** The token address of a canonical identity, or null when raw is not one. */
function canonicalAssetToken(raw: unknown): string | null {
  const match = typeof raw === "string" ? ASSET_ID_RE.exec(raw) : null;
  if (match === null || match[0] !== raw || !Number.isSafeInteger(Number(match[1]))) return null;
  return match[2] ?? null;
}

function isAssetId(raw: unknown): raw is AssetId {
  const token = canonicalAssetToken(raw);
  return token !== null && token !== "0x0000000000000000000000000000000000000000";
}

/** Validate an already canonical identity without changing signed input. */
export function toAssetId(raw: unknown): AssetId {
  if (isAssetId(raw)) return raw;
  throw Errors.invalidInput(
    "assetId",
    canonicalAssetToken(raw) === null
      ? "must be a canonical ERC-20 CAIP-19 identifier"
      : "must identify a nonzero token contract",
  );
}

/** Build an identity from verified chain facts. Normalize the token address. */
export function assetIdFor(chainId: number, tokenAddress: string): AssetId {
  return toAssetId(`eip155:${toChainId(chainId)}/erc20:${toAddress(tokenAddress)}`);
}

const isCurrencyCode = (raw: unknown): raw is CurrencyCode =>
  typeof raw === "string" && isSupportedCurrencyCode(raw);

export function toCurrencyCode(raw: unknown): CurrencyCode {
  if (!isCurrencyCode(raw)) {
    throw Errors.invalidInput("currencyCode", invalidValueReason("unsupported currency", raw));
  }

  return raw;
}

export function currencySymbolFor(code: CurrencyCode): string {
  // A brand indexes no literal-keyed table, so read it through its plain code.
  const supported: SupportedCurrencyCode = code;
  return CURRENCY_SYMBOLS[supported];
}

/** A registry row's precision: current, or retired but still named by a stored document. */
export interface AssetPrecision {
  readonly assetId: string;
  readonly decimals: number;
}

/** An exact on-chain quantity: integer minor units at the asset's registered precision. */
export interface ExactAssetAmount {
  readonly asset: AssetId;
  readonly minorUnits: string;
  readonly decimals: number;
}

const MAJOR_UNITS_RE = /^[0-9]+(?:\.[0-9]+)?$/;

const MAX_UINT256 = 2n ** 256n;

/**
 * A major-unit quantity as the exact minor units it signs and pays, at the
 * asset's registered precision. It never rounds: an unregistered asset, more
 * fraction digits than the asset carries, or a value past uint256 is refused
 * as `INVALID_INPUT` on `amount`.
 */
export function toExactAssetAmount(
  amount: { readonly asset: string; readonly value: string },
  assets: readonly AssetPrecision[],
): ExactAssetAmount {
  const asset = toAssetId(amount.asset);
  const decimals = assets.find((candidate) => candidate.assetId === asset)?.decimals;
  if (decimals === undefined || !Number.isInteger(decimals) || decimals < 0 || decimals > 255)
    throw Errors.invalidInput("amount", "asset is not registered with a precision");
  if (amount.value.length > 512 || !MAJOR_UNITS_RE.test(amount.value))
    throw Errors.invalidInput("amount", "must be a non-negative decimal string");
  const [whole = "0", fraction = ""] = amount.value.split(".");
  if (fraction.length > decimals)
    throw Errors.invalidInput("amount", "exceeds the asset's precision");
  const units = BigInt(whole + fraction.padEnd(decimals, "0"));
  if (units >= MAX_UINT256) throw Errors.invalidInput("amount", "exceeds uint256");
  return { asset, minorUnits: units.toString(), decimals };
}

const normalizedDecimal = (value: string) => {
  const [whole = "0", fraction = ""] = value.split(".");
  return `${BigInt(whole)}.${fraction.replace(/0+$/u, "")}`;
};

/**
 * Whether two non-negative decimal strings name the same quantity, however
 * each writes its zeros: `0500.10` and `500.1` do.
 */
export function sameDecimal(left: string, right: string): boolean {
  return normalizedDecimal(left) === normalizedDecimal(right);
}
