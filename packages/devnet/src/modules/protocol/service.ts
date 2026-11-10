// Deploy the v4 protocol the way a real chain gets it: Companies House (a Safe owned by Directors) is created, then
// every contract in the manifest is created by Companies House through CreateCall, so each address is a function of the
// house, the entry's salt and its compiled init code. Running it again finishes what is missing and changes nothing else.

import { encodeFunctionData, keccak256, parseAbi, zeroAddress, type Hex } from "viem";

import { hasCode, send } from "../chain/service.ts";
import type { Chain } from "../chain/types.ts";
import {
  FACTORY_ABI,
  houseInitializer,
  houseSaltNonce,
  housePendingRoles,
  safeProxyAddress,
  setupCalls,
} from "./internal/companies-house.ts";
import { planEntries, sameRuntime } from "./internal/manifest.ts";
import { DELEGATECALL, execSafe, multiSendData, SAFE_ABI, type SafeCall } from "./internal/safe.ts";
import { THIRD_PARTY } from "./internal/third-party.ts";
import type { DeployInput, DeployResult, DeploymentRecord, PlannedEntry, Step } from "./types.ts";

export type * from "./types.ts";
export { parseManifest, saltOf } from "./internal/manifest.ts";
export { THIRD_PARTY } from "./internal/third-party.ts";
export { claimRoleKey, companyRoleKey, ROLES_ABI } from "./internal/companies-house.ts";
export { SAFE_ABI, CALL, DELEGATECALL, execData, execSafe, execWithSignatures, multiSendData, signedExecData, packCall, safeTxHash, sortedSignatures } from "./internal/safe.ts";
export type { SafeCall } from "./internal/safe.ts";

const CREATE_CALL_ABI = parseAbi(["function performCreate2(uint256 value, bytes deploymentData, bytes32 salt) returns (address newContract)"]);
const BUDGETS_ABI = parseAbi(["function agreements() view returns (address)", "function setAgreements(address agreements_)"]);
const MODULE_ENABLED = SAFE_ABI;

/** Entries per Safe transaction: each carries its whole init code, so a batch of all fifteen would be very large. */
const BATCH = 4;

async function houseAddress(chain: Chain, input: DeployInput) {
  const proxyCreationCode = await chain.client.readContract({ address: THIRD_PARTY.safeProxyFactory, abi: FACTORY_ABI, functionName: "proxyCreationCode" });
  const initializer = houseInitializer(input.config);
  return { initializer, house: safeProxyAddress(proxyCreationCode, initializer, houseSaltNonce) };
}

/** Where each contract lands, without a chain write. Needs only the chain's Safe factory for the house address. */
export async function planProtocol(input: Pick<DeployInput, "chain" | "manifest" | "config" | "artifacts">) {
  const { house } = await houseAddress(input.chain, input as DeployInput);
  return { house, roles: housePendingRoles(house).address, entries: planEntries(house, input.manifest, input.artifacts) };
}

const named = (planned: readonly PlannedEntry[], name: string): PlannedEntry => {
  const found = planned.find((entry) => entry.entry.name === name);
  if (found === undefined) throw new Error(`the manifest lists no ${name}`);
  return found;
};

export async function deployProtocol(input: DeployInput): Promise<DeployResult> {
  const { chain, config, sender } = input;
  const signers = input.owners.slice(0, config.threshold);
  if (signers.length < config.threshold) throw new Error(`Companies House needs ${config.threshold} owner signers, got ${input.owners.length}`);
  const steps: Step[] = [];
  const step = (name: string, did: boolean) => steps.push({ name, status: did ? "done" : "already" });

  const { initializer, house } = await houseAddress(chain, input);
  if (!(await hasCode(chain, house))) {
    await send(chain, {
      from: sender,
      to: THIRD_PARTY.safeProxyFactory,
      data: encodeFunctionData({ abi: FACTORY_ABI, functionName: "createProxyWithNonce", args: [THIRD_PARTY.safeSingleton, initializer, houseSaltNonce] }),
    });
    step("Companies House Safe", true);
  } else step("Companies House Safe", false);

  const roles = housePendingRoles(house);
  if (!(await hasCode(chain, roles.address))) {
    await send(chain, { from: sender, to: THIRD_PARTY.moduleProxyFactory, data: roles.deployData });
    step("Companies House Roles module", true);
  } else step("Companies House Roles module", false);

  const planned = planEntries(house, input.manifest, input.artifacts);
  const states = await Promise.all(
    planned.map(async (entry) => {
      const code = await chain.client.getCode({ address: entry.address });
      if (code === undefined || code === "0x") return "missing" as const;
      return sameRuntime(entry, code) ? ("deployed" as const) : ("differs" as const);
    }),
  );
  const differs = planned.filter((_, index) => states[index] === "differs");
  if (differs.length > 0) throw new Error(`other code is at ${differs.map((e) => `${e.entry.name} ${e.address}`).join(", ")}`);
  const missing = planned.filter((_, index) => states[index] === "missing");
  for (let start = 0; start < missing.length; start += BATCH) {
    const batch = missing.slice(start, start + BATCH);
    const calls: SafeCall[] = batch.map((entry) => ({
      to: THIRD_PARTY.createCall,
      operation: DELEGATECALL,
      data: encodeFunctionData({ abi: CREATE_CALL_ABI, functionName: "performCreate2", args: [0n, entry.initCode, entry.entry.salt] }),
    }));
    await execSafe(chain, house, { to: THIRD_PARTY.multiSend, data: multiSendData(calls), operation: DELEGATECALL }, signers, sender);
    for (const entry of batch) {
      if (!(await hasCode(chain, entry.address))) throw new Error(`${entry.entry.name} left no code at ${entry.address}`);
    }
  }
  for (const [index, entry] of planned.entries()) step(entry.entry.name, states[index] === "missing");

  const budgets = named(planned, "Budgets").address;
  const agreements = named(planned, "Agreements").address;
  const wired = await chain.client.readContract({ address: budgets, abi: BUDGETS_ABI, functionName: "agreements" });
  if (wired === zeroAddress) {
    const wire: SafeCall = { to: budgets, data: encodeFunctionData({ abi: BUDGETS_ABI, functionName: "setAgreements", args: [agreements] }) };
    await execSafe(chain, house, { to: THIRD_PARTY.multiSend, data: multiSendData([wire]), operation: DELEGATECALL }, signers, sender);
    step("Budgets wired to Agreements", true);
  } else if (wired.toLowerCase() === agreements.toLowerCase()) step("Budgets wired to Agreements", false);
  else throw new Error(`Budgets is wired to ${wired}, not ${agreements}`);

  const enabled = await chain.client.readContract({ address: house, abi: MODULE_ENABLED, functionName: "isModuleEnabled", args: [roles.address] });
  if (!enabled) {
    const calls = setupCalls(house, roles.address, config, named(planned, "CompaniesHouseClaimer").address, named(planned, "CompanySafeMinter").address);
    await execSafe(chain, house, { to: THIRD_PARTY.multiSend, data: multiSendData(calls), operation: DELEGATECALL }, signers, sender);
    step("Roles enabled, tier roles scoped, tier service added", true);
  } else step("Roles enabled, tier roles scoped, tier service added", false);

  return { record: await recordOf(chain, house, roles.address, config, planned), steps };
}

async function recordOf(chain: Chain, house: Hex, roles: Hex, config: DeployInput["config"], planned: readonly PlannedEntry[]): Promise<DeploymentRecord> {
  const contracts: DeploymentRecord["contracts"] = Object.fromEntries(
    await Promise.all(
      planned.map(async (entry) => {
        const code = (await chain.client.getCode({ address: entry.address })) ?? "0x";
        return [
          entry.entry.name,
          {
            address: entry.address,
            salt: entry.entry.salt,
            constructorArguments: entry.resolvedArguments,
            runtimeCodeHash: keccak256(code),
          },
        ] as const;
      }),
    ),
  );
  return { version: "v4", chainId: chain.chainId, companiesHouse: house, companiesHouseRoles: roles, createCall: THIRD_PARTY.createCall, tiers: config.tiers, contracts };
}

/** Read-only: every entry has its compiled code at its planned address, Budgets is wired, Roles is enabled on the house. */
export async function verifyProtocol(input: Pick<DeployInput, "chain" | "manifest" | "config" | "artifacts">): Promise<readonly { check: string; ok: boolean }[]> {
  const { chain } = input;
  const { house, roles, entries } = await planProtocol(input);
  const checks: { check: string; ok: boolean }[] = [];
  const houseCode = await hasCode(chain, house);
  checks.push({ check: `Companies House ${house} has code`, ok: houseCode });
  if (houseCode) {
    const [owners, threshold, enabled] = await Promise.all([
      chain.client.readContract({ address: house, abi: SAFE_ABI, functionName: "getOwners" }),
      chain.client.readContract({ address: house, abi: SAFE_ABI, functionName: "getThreshold" }),
      chain.client.readContract({ address: house, abi: SAFE_ABI, functionName: "isModuleEnabled", args: [roles] }),
    ]);
    checks.push({ check: `Companies House owners are the configured Directors, ${input.config.threshold} to sign`, ok: owners.length === input.config.owners.length && Number(threshold) === input.config.threshold });
    checks.push({ check: `Roles ${roles} is enabled on Companies House`, ok: enabled });
  }
  for (const entry of entries) {
    const code = await chain.client.getCode({ address: entry.address });
    checks.push({ check: `${entry.entry.name} ${entry.address} has its compiled code`, ok: code !== undefined && code !== "0x" && sameRuntime(entry, code) });
  }
  const budgets = named(entries, "Budgets").address;
  const wired = await chain.client.readContract({ address: budgets, abi: BUDGETS_ABI, functionName: "agreements" }).catch(() => zeroAddress);
  checks.push({ check: "Budgets is wired to Agreements", ok: wired.toLowerCase() === named(entries, "Agreements").address.toLowerCase() });
  return checks;
}
