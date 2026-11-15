// The seed's eight transactions, in order, each in its own block: (1) the Safe proxy factory creates Companies House,
// (2) the ModuleProxyFactory makes its Roles module, (3-6) Companies House creates the manifest's contracts through
// CreateCall, four to a Safe transaction, (7) it wires Budgets to Agreements, (8) it enables Roles and scopes each
// tier's claim and company roles. Also each block's time and each transaction's fees, fixed so a rebuild is the same
// bytes every run. Pure.
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import {
  encodeAbiParameters,
  encodeFunctionData,
  padHex,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  toFunctionSelector,
  type Hex,
} from "viem";
import { createHouseData, houseRoles, type HouseConfig, type Planned } from "./plan.ts";
import { DELEGATECALL, multiSendData, type SafeCall } from "./safe.ts";
import { THIRD_PARTY } from "./third-party.ts";

/** A transaction the deployer sends: a plain call, or a Safe transaction Companies House's owners sign. */
export type Step =
  | { readonly _tag: "Call"; readonly name: string; readonly to: Hex; readonly data: Hex }
  | {
      readonly _tag: "Safe";
      readonly name: string;
      readonly safe: Hex;
      readonly nonce: bigint;
      readonly call: SafeCall;
    };

/** Manifest entries per Safe transaction: each carries its whole init code, so all fifteen in one would be very large. */
export const BATCH = 4;

/**
 * Each block's time, in seconds after the pin's head block. The committed seed was first made with these gaps (the
 * wall clock of that run); they are fixed here so a rebuild is the same bytes. The first block shares the pin's time.
 */
export const BLOCK_TIMES: ReadonlyArray<number> = [0, 4, 8, 13, 17, 21, 25, 29];

/** Every transaction's tip: one gwei, what anvil suggests. */
export const PRIORITY_FEE = 1_000_000_000n;

/** A transaction's fee cap from its block's base fee: 1.2 times the base fee and the tip, as viem chose them first. */
export const maxFeePerGas = (baseFee: bigint): bigint => ((baseFee + PRIORITY_FEE) * 12n) / 10n;

const CREATE_CALL_ABI = parseAbi([
  "function performCreate2(uint256 value, bytes deploymentData, bytes32 salt) returns (address newContract)",
]);
const BUDGETS_ABI = parseAbi(["function setAgreements(address agreements_)"]);
const ENABLE_MODULE_ABI = parseAbi(["function enableModule(address module)"]);
const ROLES_ABI = parseAbi([
  "function scopeTarget(bytes32 roleKey, address targetAddress)",
  "function scopeFunction(bytes32 roleKey, address targetAddress, bytes4 selector, (uint8 parent, uint8 paramType, uint8 operator, bytes compValue)[] conditions, uint8 options)",
  "function assignRoles(address module, bytes32[] roleKeys, bool[] memberOf)",
]);

/** A role key as Solidity writes `bytes32("capxul.claim.<tier>")`. */
export const claimRoleKey = (tier: string): Hex =>
  padHex(stringToHex(`capxul.claim.${tier}`), { dir: "right", size: 32 });
export const companyRoleKey = (tier: string): Hex =>
  padHex(stringToHex(`capxul.company.${tier}`), { dir: "right", size: 32 });

const PARAMETER = { static: 1, calldata: 5, dynamic: 2 } as const;
const OPERATOR = { pass: 0, matches: 5, equalTo: 16 } as const;
const EXECUTION_DELEGATE_CALL = 2;

/** The tier's own namespace pinned, then any string (an email or a company id) and any address. */
const namespaceConditions = (namespace: string) => [
  { parent: 0, paramType: PARAMETER.calldata, operator: OPERATOR.matches, compValue: "0x" as Hex },
  {
    parent: 0,
    paramType: PARAMETER.dynamic,
    operator: OPERATOR.equalTo,
    compValue: encodeAbiParameters(parseAbiParameters("string"), [namespace]),
  },
  { parent: 0, paramType: PARAMETER.dynamic, operator: OPERATOR.pass, compValue: "0x" as Hex },
  { parent: 0, paramType: PARAMETER.static, operator: OPERATOR.pass, compValue: "0x" as Hex },
];

/** The Directors' setup batch: enable Roles on the house, scope each tier's two roles, give both to its service. */
export const setupCalls = (
  house: Hex,
  roles: Hex,
  config: HouseConfig,
  claimer: Hex,
  minter: Hex,
): ReadonlyArray<SafeCall> => [
  { to: house, data: encodeFunctionData({ abi: ENABLE_MODULE_ABI, functionName: "enableModule", args: [roles] }) },
  ...Arr.flatMap(config.tiers, (tier) =>
    Arr.map(
      [
        encodeFunctionData({ abi: ROLES_ABI, functionName: "scopeTarget", args: [claimRoleKey(tier.tier), claimer] }),
        encodeFunctionData({
          abi: ROLES_ABI,
          functionName: "scopeFunction",
          args: [
            claimRoleKey(tier.tier),
            claimer,
            toFunctionSelector("claim(string,string,address)"),
            namespaceConditions(tier.namespace),
            EXECUTION_DELEGATE_CALL,
          ],
        }),
        encodeFunctionData({
          abi: ROLES_ABI,
          functionName: "assignRoles",
          args: [tier.member, [claimRoleKey(tier.tier)], [true]],
        }),
        encodeFunctionData({ abi: ROLES_ABI, functionName: "scopeTarget", args: [companyRoleKey(tier.tier), minter] }),
        encodeFunctionData({
          abi: ROLES_ABI,
          functionName: "scopeFunction",
          args: [
            companyRoleKey(tier.tier),
            minter,
            toFunctionSelector("mint(string,string,address)"),
            namespaceConditions(tier.companyNamespace),
            EXECUTION_DELEGATE_CALL,
          ],
        }),
        encodeFunctionData({
          abi: ROLES_ABI,
          functionName: "assignRoles",
          args: [tier.member, [companyRoleKey(tier.tier)], [true]],
        }),
      ],
      (data): SafeCall => ({ to: roles, data }),
    ),
  ),
];

/** A Safe call that runs `calls` in order, through MultiSend. */
const throughMultiSend = (calls: ReadonlyArray<SafeCall>): SafeCall => ({
  to: THIRD_PARTY.multiSend,
  data: multiSendData(calls),
  operation: DELEGATECALL,
});

const named = (planned: ReadonlyArray<Planned>, name: string): Result.Result<Hex, string> =>
  Result.fromOption(
    Option.map(
      Arr.findFirst(planned, (entry) => entry.name === name),
      (entry) => entry.address,
    ),
    () => `the manifest lists no ${name}`,
  );

/** Every transaction of the seed's deployment, in order, from Companies House's address and the planned entries. */
export const deploySteps = (
  config: HouseConfig,
  initializer: Hex,
  house: Hex,
  planned: ReadonlyArray<Planned>,
): Result.Result<ReadonlyArray<Step>, string> =>
  Result.gen(function* () {
    const roles = houseRoles(house).address;
    const [budgets, agreements, claimer, minter] = yield* Result.all([
      named(planned, "Budgets"),
      named(planned, "Agreements"),
      named(planned, "CompaniesHouseClaimer"),
      named(planned, "CompanySafeMinter"),
    ]);
    const batches = Arr.chunksOf(planned, BATCH);
    const safeCalls: ReadonlyArray<readonly [string, SafeCall]> = [
      ...Arr.map(batches, (batch): readonly [string, SafeCall] => [
        `Companies House creates ${Arr.join(
          Arr.map(batch, (entry) => entry.name),
          ", ",
        )}`,
        throughMultiSend(
          Arr.map(batch, (entry) => ({
            to: THIRD_PARTY.createCall,
            operation: DELEGATECALL,
            data: encodeFunctionData({
              abi: CREATE_CALL_ABI,
              functionName: "performCreate2",
              args: [0n, entry.initCode, entry.salt],
            }),
          })),
        ),
      ]),
      [
        "Budgets wired to Agreements",
        throughMultiSend([
          {
            to: budgets,
            data: encodeFunctionData({ abi: BUDGETS_ABI, functionName: "setAgreements", args: [agreements] }),
          },
        ]),
      ],
      [
        "Roles enabled, tier roles scoped, tier service added",
        throughMultiSend(setupCalls(house, roles, config, claimer, minter)),
      ],
    ];
    return [
      {
        _tag: "Call",
        name: "Companies House Safe",
        to: THIRD_PARTY.safeProxyFactory,
        data: createHouseData(initializer),
      },
      {
        _tag: "Call",
        name: "Companies House Roles module",
        to: THIRD_PARTY.moduleProxyFactory,
        data: houseRoles(house).deployData,
      },
      ...Arr.map(safeCalls, ([name, call], index): Step => ({
        _tag: "Safe",
        name,
        safe: house,
        nonce: BigInt(index),
        call,
      })),
    ];
  });
