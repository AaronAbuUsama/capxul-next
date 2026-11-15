// The logs of a world's chain that the claims read, each declared once: its Solidity signature, as the contracts
// emit it, and its decoded shape. A chain read answers a log it does not declare as `Other`. The signatures are the
// contracts' own (packages/contracts, the Hats protocol and the ERC-4337 entry point); the SDK decodes with them.
import * as Schema from "effect/Schema";
import { Address, Hash, Uint } from "../values.ts";

/** Where every log was found: the contract that emitted it, its transaction, its block and its index in the block. */
const found = {
  address: Address,
  transaction: Hash,
  block: Schema.Int,
  index: Schema.Int,
};

/** Every declared log, by the name the contract emits it under, with its Solidity signature. */
export const LOG_SIGNATURES = {
  CompanySafeMinted:
    "event CompanySafeMinted(address indexed safe, address indexed founderSafe, string company, bool deployed)",
  PaymentSent:
    "event PaymentSent(bytes32 indexed paymentId, address indexed sender, address indexed recipient, address token, uint256 amount, uint16 kind, bytes32 documentHash)",
  UserOperationEvent:
    "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
  Transfer: "event Transfer(address indexed from, address indexed to, uint256 value)",
  TransferSingle:
    "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 amount)",
  HatMaxSupplyChanged: "event HatMaxSupplyChanged(uint256 hatId, uint32 newMaxSupply)",
  BudgetCreated:
    "event BudgetCreated(address indexed safe, uint256 indexed id, uint256 indexed parent, address token, uint8 period, uint128 amount, uint256 hat)",
} as const;

export type LogName = keyof typeof LOG_SIGNATURES;
export const LogName = Schema.Literals([
  "CompanySafeMinted",
  "PaymentSent",
  "UserOperationEvent",
  "Transfer",
  "TransferSingle",
  "HatMaxSupplyChanged",
  "BudgetCreated",
]);

/** Companies House minted a company Safe for a founder's Safe. `company` is the Organization's id. */
export const CompanySafeMinted = Schema.TaggedStruct("CompanySafeMinted", {
  ...found,
  safe: Address,
  founderSafe: Address,
  company: Schema.String,
  deployed: Schema.Boolean,
});

/** The Payments contract paid `amount` (in the token's smallest units) of `token` to `recipient`. */
export const PaymentSent = Schema.TaggedStruct("PaymentSent", {
  ...found,
  paymentId: Hash,
  sender: Address,
  recipient: Address,
  token: Address,
  amount: Uint,
  kind: Schema.Int,
  documentHash: Hash,
});

/** The entry point ran one UserOperation from `sender`, a Safe. */
export const UserOperationEvent = Schema.TaggedStruct("UserOperationEvent", {
  ...found,
  userOpHash: Hash,
  sender: Address,
  paymaster: Address,
  nonce: Uint,
  success: Schema.Boolean,
  actualGasCost: Uint,
  actualGasUsed: Uint,
});

/** An ERC-20 transfer: of the test USDC, among the claims' tokens. `value` is in the token's smallest units. */
export const Transfer = Schema.TaggedStruct("Transfer", { ...found, from: Address, to: Address, value: Uint });

/** The Hats protocol moved a hat: minted to `to` when `from` is the zero address, burned when `to` is. */
export const TransferSingle = Schema.TaggedStruct("TransferSingle", {
  ...found,
  operator: Address,
  from: Address,
  to: Address,
  id: Uint,
  amount: Uint,
});

/** The Hats protocol changed how many may wear a hat. */
export const HatMaxSupplyChanged = Schema.TaggedStruct("HatMaxSupplyChanged", {
  ...found,
  hatId: Uint,
  newMaxSupply: Schema.Int,
});

/**
 * The Budgets contract made budget `id` for the company Safe `safe`, inside `parent` (0 for a top budget), of `amount`
 * per `period` (ICalendar: 0 a month, 1 a quarter, 2 a year) in the token's smallest units, spent by `hat`'s wearers.
 */
export const BudgetCreated = Schema.TaggedStruct("BudgetCreated", {
  ...found,
  safe: Address,
  id: Uint,
  parent: Uint,
  token: Address,
  period: Schema.Int,
  amount: Uint,
  hat: Uint,
});

/** A log of a kind not declared here, by its first topic (the event's selector), if it has one. */
export const OtherLog = Schema.TaggedStruct("Other", { ...found, topic: Schema.NullOr(Hash) });

/** Any log of a world's chain, decoded: one of the declared, or `Other`. */
export const Log = Schema.Union([
  CompanySafeMinted,
  PaymentSent,
  UserOperationEvent,
  Transfer,
  TransferSingle,
  HatMaxSupplyChanged,
  BudgetCreated,
  OtherLog,
]);
export type Log = typeof Log.Type;
