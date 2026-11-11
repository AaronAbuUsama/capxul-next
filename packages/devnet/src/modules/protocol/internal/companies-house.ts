// Companies House: a Safe with fixed genesis Directors whose address fixes every Capxul Safe under it, and a Roles
// module on it with one claim role and one company role per tier. Each role may only delegatecall one function of one
// contract (the claimer's `claim`, the minter's `mint`) with the tier's namespace pinned.

import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  keccak256,
  pad,
  padHex,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  toBytes,
  toFunctionSelector,
  type Hex,
} from "viem";

import type { CompaniesHouseConfig } from "../types.ts";
import { THIRD_PARTY } from "./third-party.ts";
import type { SafeCall } from "./safe.ts";

const ZERO: Hex = "0x0000000000000000000000000000000000000000";

/** The genesis Safe's salt nonce: keccak256 of "capxul:companies-house:v1". */
const HOUSE_SALT_NONCE = BigInt(keccak256(toBytes("capxul:companies-house:v1")));

const SAFE_SETUP = parseAbi([
  "function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
]);
export const FACTORY_ABI = parseAbi([
  "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "function proxyCreationCode() pure returns (bytes)",
]);
export const MODULE_FACTORY_ABI = parseAbi(["function deployModule(address masterCopy, bytes initializer, uint256 saltNonce) returns (address proxy)"]);
const ROLES_ABI = parseAbi([
  "function setUp(bytes initializeParams)",
  "function scopeTarget(bytes32 roleKey, address targetAddress)",
  "function scopeFunction(bytes32 roleKey, address targetAddress, bytes4 selector, (uint8 parent, uint8 paramType, uint8 operator, bytes compValue)[] conditions, uint8 options)",
  "function assignRoles(address module, bytes32[] roleKeys, bool[] memberOf)",
  "function execTransactionWithRole(address to, uint256 value, bytes data, uint8 operation, bytes32 roleKey, bool shouldRevert) returns (bool success)",
]);
export { ROLES_ABI };

/** Genesis Directors in ascending address order, so the house address does not depend on how they are listed. */
const sortedOwners = (owners: readonly Hex[]): Hex[] => [...owners].map((o) => o.toLowerCase() as Hex).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));

export function houseInitializer(config: CompaniesHouseConfig): Hex {
  return encodeFunctionData({
    abi: SAFE_SETUP,
    functionName: "setup",
    args: [sortedOwners(config.owners), BigInt(config.threshold), ZERO, "0x", THIRD_PARTY.fallbackHandler, ZERO, 0n, ZERO],
  });
}

/** The address a Safe proxy lands at: CREATE2 from the factory over the proxy creation code and the singleton. */
export function safeProxyAddress(proxyCreationCode: Hex, initializer: Hex, saltNonce: bigint): Hex {
  const salt = keccak256(concat([keccak256(initializer), pad(`0x${saltNonce.toString(16)}`, { size: 32 })]));
  return getContractAddress({
    opcode: "CREATE2",
    from: THIRD_PARTY.safeProxyFactory,
    salt,
    bytecode: concat([proxyCreationCode, pad(THIRD_PARTY.safeSingleton, { size: 32 })]),
  });
}

export const houseSaltNonce = HOUSE_SALT_NONCE;

const rolesSetUp = (house: Hex): Hex =>
  encodeFunctionData({ abi: ROLES_ABI, functionName: "setUp", args: [encodeAbiParameters(parseAbiParameters("address, address, address"), [house, house, house])] });

/** The Roles module on Companies House (owner, avatar and target the house), at salt nonce 0. */
export function housePendingRoles(house: Hex): { address: Hex; deployData: Hex } {
  const initializer = rolesSetUp(house);
  const initCode: Hex = `0x602d8060093d393df3363d3d373d3d3d363d73${THIRD_PARTY.rolesMastercopy.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;
  const salt = keccak256(concat([keccak256(initializer), pad("0x0", { size: 32 })]));
  return {
    address: getContractAddress({ opcode: "CREATE2", from: THIRD_PARTY.moduleProxyFactory, salt, bytecode: initCode }),
    deployData: encodeFunctionData({ abi: MODULE_FACTORY_ABI, functionName: "deployModule", args: [THIRD_PARTY.rolesMastercopy, initializer, 0n] }),
  };
}

/** A role key as Solidity writes `bytes32("capxul.claim.<tier>")`. */
export const claimRoleKey = (tier: string): Hex => padHex(stringToHex(`capxul.claim.${tier}`), { dir: "right", size: 32 });
export const companyRoleKey = (tier: string): Hex => padHex(stringToHex(`capxul.company.${tier}`), { dir: "right", size: 32 });

const PARAMETER = { static: 1, calldata: 5, dynamic: 2 } as const;
const OPERATOR = { pass: 0, matches: 5, equalTo: 16 } as const;
const EXECUTION_DELEGATE_CALL = 2;

/** The namespace pinned to the tier's own, any string (email or company id), any address (signer or founder's Safe). */
function namespaceConditions(namespace: string) {
  return [
    { parent: 0, paramType: PARAMETER.calldata, operator: OPERATOR.matches, compValue: "0x" as Hex },
    { parent: 0, paramType: PARAMETER.dynamic, operator: OPERATOR.equalTo, compValue: encodeAbiParameters(parseAbiParameters("string"), [namespace]) },
    { parent: 0, paramType: PARAMETER.dynamic, operator: OPERATOR.pass, compValue: "0x" as Hex },
    { parent: 0, paramType: PARAMETER.static, operator: OPERATOR.pass, compValue: "0x" as Hex },
  ];
}

const CLAIM_SELECTOR = toFunctionSelector("claim(string,string,address)");
const MINT_SELECTOR = toFunctionSelector("mint(string,string,address)");

/** The Directors' setup batch: enable Roles on the house, scope each tier's two roles, and add the tier's service to both. */
export function setupCalls(house: Hex, roles: Hex, config: CompaniesHouseConfig, claimer: Hex, minter: Hex): readonly SafeCall[] {
  const toRoles = (functionName: "scopeTarget" | "scopeFunction" | "assignRoles", args: readonly unknown[]): SafeCall => ({
    to: roles,
    data: encodeFunctionData({ abi: ROLES_ABI, functionName, args } as never),
  });
  return [
    { to: house, data: encodeFunctionData({ abi: parseAbi(["function enableModule(address module)"]), functionName: "enableModule", args: [roles] }) },
    ...config.tiers.flatMap((tier) => [
      toRoles("scopeTarget", [claimRoleKey(tier.tier), claimer]),
      toRoles("scopeFunction", [claimRoleKey(tier.tier), claimer, CLAIM_SELECTOR, namespaceConditions(tier.namespace), EXECUTION_DELEGATE_CALL]),
      toRoles("assignRoles", [tier.member, [claimRoleKey(tier.tier)], [true]]),
      toRoles("scopeTarget", [companyRoleKey(tier.tier), minter]),
      toRoles("scopeFunction", [companyRoleKey(tier.tier), minter, MINT_SELECTOR, namespaceConditions(tier.companyNamespace), EXECUTION_DELEGATE_CALL]),
      toRoles("assignRoles", [tier.member, [companyRoleKey(tier.tier)], [true]]),
    ]),
  ];
}
