// The examples of books' operations, kept here so operations.ts stays readable. The story: Northwind's books record
// the payment of 1,800 USDC to Brightside Cleaning, booked to account 6100 Cleaning; Hannah holds the Books hat
// (Manage books), Priya does not. Ids use uuid(200..249), the range reserved to books.

import {
  error_CLI_USAGE,
  error_INVALID_INPUT,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { CHAIN_ID, ID, NORTHWIND, PEOPLE, ADDRESS, hash, ok, refused, uuid } from "../shared/examples.ts";

const at = (iso: string) => Date.parse(iso);

const USDC = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const DAI = "0x5fc8d32690cc91d4c39d9d3abcbd16989f875707";
/** The Account on Northwind's site, as ERPNext names it (books.chart-owner). */
const CLEANING = { account: "6100 - Cleaning - NW", number: "6100", name: "Cleaning" };

const annotation = {
  reference: { kind: "payment", id: ID.paymentToBrightside },
  actor: { kind: "organization", id: NORTHWIND.orgId },
  account: CLEANING,
  party: { type: "Supplier", id: ID.brightside },
  costCenter: null,
  project: null,
  references: [],
  suggestion: null,
  memo: "February cleaning",
  lastEditor: { kind: "person", id: ID.hannah },
  updatedAt: at("2026-02-10T09:40:00Z"),
};

export const annotate = [
  ok(
    "Book the payment to Brightside to Cleaning, with a memo",
    `capxul activity annotate --kind payment --id ${ID.paymentToBrightside} --account 6100 --memo "February cleaning" --confirm --json`,
    { annotation },
  ),
  refused(
    "A script that does not pass --confirm",
    `capxul activity annotate --kind payment --id ${ID.paymentToBrightside} --account 6100 --json`,
    error_CLI_USAGE,
    { missing: "--confirm" },
  ),
  refused(
    "An account number that is not in the site's chart",
    `capxul activity annotate --kind payment --id ${ID.paymentToBrightside} --account 9999 --confirm --json`,
    error_INVALID_INPUT,
    { account: "9999" },
  ),
  refused(
    "A memo alone, from a member without Manage books",
    `capxul activity annotate --kind payment --id ${ID.paymentToBrightside} --memo "February cleaning" --confirm --email ${PEOPLE.priya.email} --json`,
    error_ROLE_PERMISSION_DENIED,
  ),
];

const usdcAsset = { assetId: `asset_${uuid(201)}`, chainId: CHAIN_ID, address: USDC, symbol: "USDC", decimals: 6, tier: "settlement", priced: true, addedBy: null, addedAt: null };
const daiAsset = { assetId: `asset_${uuid(202)}`, chainId: CHAIN_ID, address: DAI, symbol: "DAI", decimals: 18, tier: "added", priced: false, addedBy: ID.hannah, addedAt: at("2026-02-06T14:00:00Z") };

export const assetsList = [
  ok("Capxul's own USDC first, then the token Hannah added", "capxul org books assets list --json", { assets: [usdcAsset, daiAsset] }),
  refused("Someone with no Seat at Northwind", "capxul org books assets list --email accounts@brightside.test --json", error_ROLE_PERMISSION_DENIED),
];

export const assetsAdd = [
  ok(
    "Add a token the company Safe receives",
    `capxul org books assets add ${DAI} --json`,
    { assetId: daiAsset.assetId, address: DAI, symbol: "DAI", decimals: 18, tier: "added", priced: false },
  ),
  refused("An address that holds no token contract", `capxul org books assets add ${ADDRESS.brightside.toLowerCase()} --json`, error_INVALID_INPUT, { reason: "not_an_erc20", address: ADDRESS.brightside.toLowerCase() }),
  refused("The books already record it", `capxul org books assets add ${USDC} --json`, error_WRONG_STATE, { reason: "asset_already_admitted", address: USDC }),
  refused("A member without Manage books", `capxul org books assets add ${DAI} --email ${PEOPLE.priya.email} --json`, error_ROLE_PERMISSION_DENIED),
  refused("The node fails to answer the token's metadata", `capxul org books assets add ${DAI} --json`, error_PROVIDER_ERROR, { reading: "symbol" }),
];

export const assetsRemove = [
  ok("Stop recording the added token", `capxul org books assets remove ${DAI} --json`, { assetId: daiAsset.assetId, address: DAI }),
  refused("USDC is Capxul's own, not one Northwind added", `capxul org books assets remove ${USDC} --json`, error_WRONG_STATE, { reason: "asset_not_added", address: USDC }),
];

const settled = {
  factId: `fact_${uuid(203)}`,
  seq: 14,
  kind: "payment_settled",
  occurredAt: at("2026-02-10T09:31:00Z"),
  blockTime: at("2026-02-10T09:31:00Z"),
  amount: { value: "1800.00", asset: "USDC" },
  fee: null,
  usd: { value: "1800.00", rate: "1", source: "peg" },
  account: CLEANING,
  fromAccount: null,
  party: ADDRESS.brightside,
  partyId: ID.brightside,
  safe: ADDRESS.northwind,
  reference: { kind: "payment", id: ID.paymentToBrightside },
  rows: [{ kind: "payment", id: ID.paymentToBrightside }],
  source: { kind: "payment", id: ID.paymentToBrightside },
  reverses: null,
  chain: { chainId: CHAIN_ID, block: 1204, txHash: hash("c3"), logIndex: 2 },
  txHash: hash("c3"),
  actor: { kind: "system" },
  recordedAt: at("2026-02-10T09:31:05Z"),
};

export const factsList = [
  ok("The payments that settled since the start of February", "capxul org books facts list --kind payment_settled --since 2026-02-01 --json", { facts: [settled], next: null }),
  refused("A --since that is not a date", "capxul org books facts list --since last-week --json", error_CLI_USAGE, { flag: "--since", value: "last-week" }),
  refused("Not a member of the Organization", "capxul org books facts list --email accounts@brightside.test --json", error_ROLE_PERMISSION_DENIED),
];
