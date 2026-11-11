import { Errors } from "../errors/factories.ts";
import type { Brand } from "../primitives/brand.ts";
import type { Address as ViemAddress, Hex } from "./hex.ts";
import {
  invalidValueReason,
  isSafeNonNegativeInteger,
  toSafeNonNegativeIntegerBrand,
} from "../primitives/validation.ts";

/** `0x`-prefixed text: structurally viem's `Hex`, so a branded value passes to viem unchanged. */
export type HexText = `0x${string}`;

export type TxHash = Brand<HexText, "TxHash">;

export type ChainId = Brand<number, "ChainId">;

export type BlockNumber = Brand<number, "BlockNumber">;

export type LogIndex = Brand<number, "LogIndex">;

export type WeiAmount = Brand<string, "WeiAmount">;

export type SafeAddress = Brand<HexText, "SafeAddress">;

export type ModuleAddress = Brand<HexText, "ModuleAddress">;

const TX_HASH_RE = /^0x[0-9a-f]{64}$/i;

export const WEI_RE = /^[0-9]+$/;

const isTxHash = (raw: unknown): raw is TxHash => typeof raw === "string" && TX_HASH_RE.test(raw);

export function toTxHash(raw: unknown): TxHash {
  const hash = typeof raw === "string" ? raw.toLowerCase() : raw;
  if (!isTxHash(hash)) {
    throw Errors.invalidInput("txHash", invalidValueReason("must be 0x + 64 hex chars", raw));
  }

  return hash;
}

const isChainId = (raw: unknown): raw is ChainId =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0;

export function toChainId(raw: unknown): ChainId {
  if (!isChainId(raw)) {
    throw Errors.invalidInput(
      "chainId",
      invalidValueReason("must be a positive safe integer", raw),
    );
  }

  return raw;
}

export function toBlockNumber(raw: unknown): BlockNumber {
  return toSafeNonNegativeIntegerBrand(raw, "blockNumber", (value): value is BlockNumber =>
    isSafeNonNegativeInteger(value),
  );
}

export function toLogIndex(raw: unknown): LogIndex {
  return toSafeNonNegativeIntegerBrand(raw, "logIndex", (value): value is LogIndex =>
    isSafeNonNegativeInteger(value),
  );
}

const isWeiAmount = (raw: unknown): raw is WeiAmount => typeof raw === "string" && WEI_RE.test(raw);

export function toWeiAmount(raw: unknown): WeiAmount {
  if (!isWeiAmount(raw)) {
    throw Errors.invalidInput(
      "weiAmount",
      invalidValueReason("must be a non-negative integer string", raw),
    );
  }

  return raw;
}

export const isSafeAddress = (raw: unknown): raw is SafeAddress => isEvmAddress(raw);

export function toSafeAddress(raw: unknown): SafeAddress {
  const address = typeof raw === "string" ? raw.toLowerCase() : raw;
  if (!isSafeAddress(address)) {
    throw Errors.invalidInput("safeAddress", invalidValueReason("invalid EVM address format", raw));
  }

  return address;
}

export const isModuleAddress = (raw: unknown): raw is ModuleAddress => isEvmAddress(raw);

export function toModuleAddress(raw: unknown): ModuleAddress {
  const address = typeof raw === "string" ? raw.toLowerCase() : raw;
  if (!isModuleAddress(address)) {
    throw Errors.invalidInput(
      "moduleAddress",
      invalidValueReason("invalid EVM address format", raw),
    );
  }

  return address;
}

export type Address = Brand<HexText, "Address">;

export const EVM_ADDRESS_RE = /^0x[0-9a-f]{40}$/i;

export const BYTES32_RE = /^0x[0-9a-f]{64}$/i;

export const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

const isAddressBrand = (raw: unknown): raw is Address => isEvmAddress(raw);

export function toAddress(raw: unknown): Address {
  const address = typeof raw === "string" ? raw.toLowerCase() : raw;
  if (!isAddressBrand(address)) {
    throw Errors.invalidInput("address", invalidValueReason("invalid EVM address format", raw));
  }

  return address;
}

export function isEvmAddress(raw: unknown): raw is HexText {
  return typeof raw === "string" && EVM_ADDRESS_RE.test(raw);
}

export type SignablePaymentItem =
  | ({
      readonly operation: "send";
      readonly recipientSafe: ViemAddress;
      readonly tokenAddress: ViemAddress;
      readonly rawAmount: string;
      readonly kind: number;
      readonly settlementId: Hex;
      readonly documentHash: Hex;
    } & (
      | { readonly jobNonce: Hex; readonly executor: ViemAddress }
      | { readonly jobNonce?: never; readonly executor?: never }
    ))
  | {
      readonly operation: "create_commitment";
      readonly recipientSafe: ViemAddress;
      readonly tokenAddress: ViemAddress;
      readonly totalAmount: string;
      readonly startTime: number;
      readonly cliffTime: number;
      readonly endTime: number;
      readonly kind: number;
      readonly settlementId: Hex;
      readonly documentHash: Hex;
    }
  | { readonly operation: "claim_commitment"; readonly commitmentId: string }
  | {
      readonly operation: "cancel_commitment";
      readonly commitmentId: string;
      readonly documentHash: Hex;
    }
  | {
      readonly operation: "redirect_commitment";
      readonly commitmentId: string;
      readonly recipientSafe: ViemAddress;
      readonly documentHash: Hex;
    }
  | { readonly operation: "void_schedule"; readonly voidsCommandId: string };

export interface SignablePaymentCommand {
  readonly commandId?: string;
  readonly chainId?: number;
  readonly contractAddress: ViemAddress;
  readonly senderSafe?: ViemAddress;
  readonly executionRoute:
    | { readonly kind: "direct" }
    | { readonly kind: "zodiac_role"; readonly rolesModule: ViemAddress; readonly roleKey: Hex }
    | {
        readonly kind: "budget";
        readonly budgets: ViemAddress;
        readonly budgetId: string;
        /** A reschedule's Budgets ids, each cancelled before the new date is scheduled. */
        readonly cancels?: readonly string[] | undefined;
      };
  /** A dated payment's send time in milliseconds. From a budget, it is a `Budgets.schedule` sent now. */
  readonly scheduledAt?: number | undefined;
  readonly items: readonly SignablePaymentItem[];
}
