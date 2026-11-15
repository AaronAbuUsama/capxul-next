// The logs of a world's chain that the claims read. Each is named here once, with the contract whose compiled ABI
// declares it (`@capxul/contracts`' generated ABI module, from `forge build`); its fields, their names and their types
// are derived from that ABI, so the blueprint, Core and the indexer read one declaration (roadmap step 3.1). A chain
// read answers a log it does not declare as `Other`. The SDK decodes with `LOG_EVENTS`.
import { Abi } from "@capxul/contracts";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import { Address, Hash, SolidityValues } from "../values.ts";

/** Where every log was found: the contract that emitted it, its transaction, its block and its index in the block. */
const found = {
  address: Address,
  transaction: Hash,
  block: Schema.Int,
  index: Schema.Int,
};

type Values = typeof SolidityValues;
type Input = { readonly name: string; readonly type: string };
type AbiItem = { readonly type: string; readonly name?: string; readonly inputs?: ReadonlyArray<Input> };

/** The event `Name` of an ABI. */
export type EventOf<A extends ReadonlyArray<AbiItem>, Name extends string> = Extract<
  A[number],
  { readonly type: "event"; readonly name: Name }
>;

/** An event's fields, each the blueprint's value for its Solidity type. */
type FieldsOf<E> = E extends { readonly inputs: ReadonlyArray<Input> }
  ? { readonly [I in E["inputs"][number] as I["name"]]: Values[I["type"] & keyof Values] }
  : never;

/** The event `name` of `abi`. A declared log the ABI lacks is a defect of this file, found when it is loaded. */
export const eventOf = <const A extends ReadonlyArray<AbiItem>, const Name extends string>(
  abi: A,
  name: Name,
): EventOf<A, Name> =>
  Option.getOrThrowWith(
    Arr.findFirst(abi, (item): item is EventOf<A, Name> => item.type === "event" && item.name === name),
    () => new Error(`no event ${name} in its contract's ABI`),
  );

const isSolidityValue = (type: string): type is keyof Values => type in SolidityValues;

/** The blueprint's value for a Solidity type. A type without one is a defect of `SolidityValues`, found at load. */
const valueOf = (input: Input) =>
  isSolidityValue(input.type)
    ? SolidityValues[input.type]
    : Option.getOrThrowWith(Option.none(), () => new Error(`no blueprint value for ${input.type} (${input.name})`));

/** A log's schema: where it was found, then the event's fields, typed by the blueprint's Solidity values. */
const logOf = <const A extends ReadonlyArray<AbiItem>, const Name extends string>(abi: A, name: Name) =>
  Schema.TaggedStruct(name, {
    ...found,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fields are built from the event's own inputs, each by its type's value, which is what FieldsOf says; the compiler cannot follow a mapped tuple through Rec.fromEntries.
    ...(Rec.fromEntries(Arr.map(eventOf(abi, name).inputs ?? [], (input) => [input.name, valueOf(input)])) as FieldsOf<
      EventOf<A, Name>
    >),
  });

/** Companies House minted a company Safe for a founder's Safe. `company` is the Organization's id. */
export const CompanySafeMinted = logOf(Abi.CompanySafeMinter, "CompanySafeMinted");

/** The Payments contract paid `amount` (in the token's smallest units) of `token` to `recipient`. */
export const PaymentSent = logOf(Abi.Payments, "PaymentSent");

/** The entry point ran one UserOperation from `sender`, a Safe. */
export const UserOperationEvent = logOf(Abi.IEntryPoint, "UserOperationEvent");

/** An ERC-20 transfer: of the test USDC, among the claims' tokens. `value` is in the token's smallest units. */
export const Transfer = logOf(Abi.IERC20Metadata, "Transfer");

/** The Hats protocol moved a hat: minted to `to` when `from` is the zero address, burned when `to` is. */
export const TransferSingle = logOf(Abi.IHatsEvents, "TransferSingle");

/** The Hats protocol changed how many may wear a hat. */
export const HatMaxSupplyChanged = logOf(Abi.IHatsEvents, "HatMaxSupplyChanged");

/**
 * The Budgets contract made budget `id` for the company Safe `safe`, inside `parent` (0 for a top budget), of `amount`
 * per `period` (ICalendar: 0 a month, 1 a quarter, 2 a year) in the token's smallest units, spent by `hat`'s wearers.
 */
export const BudgetCreated = logOf(Abi.Budgets, "BudgetCreated");

/** Every declared log's event, by its name, as the compiled ABI declares it: what the SDK decodes logs with. */
export const LOG_EVENTS = {
  CompanySafeMinted: eventOf(Abi.CompanySafeMinter, "CompanySafeMinted"),
  PaymentSent: eventOf(Abi.Payments, "PaymentSent"),
  UserOperationEvent: eventOf(Abi.IEntryPoint, "UserOperationEvent"),
  Transfer: eventOf(Abi.IERC20Metadata, "Transfer"),
  TransferSingle: eventOf(Abi.IHatsEvents, "TransferSingle"),
  HatMaxSupplyChanged: eventOf(Abi.IHatsEvents, "HatMaxSupplyChanged"),
  BudgetCreated: eventOf(Abi.Budgets, "BudgetCreated"),
} as const;

export type LogName = keyof typeof LOG_EVENTS;
export const LogName = Schema.Literals(Rec.keys(LOG_EVENTS));

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
