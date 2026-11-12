// A company's life on the real v4 contracts, as operations the test sites' Core can call: a company is born under
// Companies House with its authority installed, the Board creates departments, grants hats and sets budgets, and a hat's
// wearer pays from a budget through Payments with a document hash. The proof (../proof) shows the same flow step by step;
// this module is that flow as functions, so the stand-in chain under the test sites can be replaced
// (plan task m2-contracts-under-sites).

import { concat, decodeEventLog, encodeFunctionData, pad, type Hex } from "viem";

import { send } from "../chain/service.ts";
import { claimRoleKey, companyRoleKey, DELEGATECALL, execSafe, execWithSignatures, multiSendData, ROLES_ABI, SAFE_ABI, safeTxHash, THIRD_PARTY, type SafeCall } from "../protocol/service.ts";
import { localPrivateKeySigner } from "@capxul/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { BUDGETS, CLAIMER, HATS, MINTER, PAYMENTS } from "./internal/abis.ts";
import { refusalOf } from "./internal/refusal.ts";
import { buildUserOp, ENTRY_POINT, ENTRY_POINT_V07, type Submit } from "./internal/user-op.ts";
import type { BirthKeys, Company, CreateCompany, Director, Pay, PayResult, Proposal, Protocol, Refusal } from "./types.ts";

export type * from "./types.ts";
export { AGENT_OWNER, BUDGETS, CLAIMER, ERC20, HATS, MINTER, PAYMENTS } from "./internal/abis.ts";
export { refusalOf } from "./internal/refusal.ts";
export { ENTRY_POINT, ENTRY_POINT_V07, viaBundler, viaEntryPoint, type Submit } from "./internal/user-op.ts";

const NAMESPACE = "capxul:devnet:email:v1";
const COMPANY_NAMESPACE = "capxul:devnet:company:v1";

const at = (p: Protocol, name: string): Hex => {
  const entry = p.record.contracts[name];
  if (entry === undefined) throw new Error(`the deployment record has no ${name}`);
  return entry.address;
};
const throughRoles = (role: Hex, to: Hex, data: Hex): Hex =>
  encodeFunctionData({ abi: ROLES_ABI, functionName: "execTransactionWithRole", args: [to, 0n, data, DELEGATECALL, role, true] });
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The founder's personal Safe address, claimed or not. */
export function founderSafeOf(p: Protocol, founderEmail: string): Promise<Hex> {
  return p.chain.client.readContract({ address: at(p, "CompaniesHouseClaimer"), abi: CLAIMER, functionName: "safeAddressFor", args: [p.record.companiesHouse, NAMESPACE, founderEmail] });
}

/** The company Safe's address for this founder and name, minted or not. */
export async function companySafeOf(p: Protocol, founderEmail: string, company: string): Promise<Hex> {
  const founderSafe = await founderSafeOf(p, founderEmail);
  return p.chain.client.readContract({ address: at(p, "CompanySafeMinter"), abi: MINTER, functionName: "companySafeAddressFor", args: [p.record.companiesHouse, COMPANY_NAMESPACE, company, founderSafe] });
}

/**
 * The CompanySafeMinted event that minted this founder's company Safe of this name, read from Companies House's logs (the
 * minter runs by delegatecall from the Companies House Safe, so the event's address is Companies House's): the event's Safe is the minter's companySafeAddressFor and its founderSafe is the founder's personal Safe. Undefined if
 * no such event was emitted.
 */
export async function companySafeMinted(p: Protocol, founderEmail: string, company: string): Promise<{ safe: Hex; founderSafe: Hex; company: string; deployed: boolean; txHash: Hex } | undefined> {
  const [founderSafe, safe] = await Promise.all([founderSafeOf(p, founderEmail), companySafeOf(p, founderEmail, company)]);
  const logs = await p.chain.client.getContractEvents({ address: p.record.companiesHouse, abi: MINTER, eventName: "CompanySafeMinted", args: { safe, founderSafe }, fromBlock: 0n });
  const l = logs.find((x) => x.args.company === company);
  if (l === undefined) return undefined;
  return { safe: l.args.safe as Hex, founderSafe: l.args.founderSafe as Hex, company, deployed: l.args.deployed as boolean, txHash: l.transactionHash as Hex };
}

/**
 * A person's personal Safe, claimed through Companies House if it is not yet on chain: owned by `signer`, with the
 * Safe4337Module enabled, so the person acts through it by UserOperation. Idempotent.
 */
export async function claimPersonalSafe(p: Protocol, tierServiceKey: Hex, email: string, signer: Hex): Promise<Hex> {
  const safe = await founderSafeOf(p, email);
  if ((await p.chain.client.getCode({ address: safe })) === undefined) {
    const tier = p.record.tiers[0]?.tier ?? "devnet";
    const claim = encodeFunctionData({ abi: CLAIMER, functionName: "claim", args: [NAMESPACE, email, signer] });
    await send(p.chain, { from: tierServiceKey, to: p.record.companiesHouseRoles, data: throughRoles(claimRoleKey(tier), at(p, "CompaniesHouseClaimer"), claim) });
  }
  return safe;
}

/**
 * A company is born: the founder's personal Safe is claimed, the company Safe is minted owned by it, and the authority is
 * installed (hats with the Board's top hat on the company Safe, Roles, the Signer Gate, Budgets and a top budget for the
 * token). The token is not minted here: fund the company Safe separately.
 */
export async function createCompany(p: Protocol, keys: BirthKeys, c: CreateCompany): Promise<Company> {
  const { chain, record } = p;
  const founder = privateKeyToAccount(keys.founder).address;
  const relayer = privateKeyToAccount(keys.relayer).address;
  const tier = record.tiers[0]?.tier ?? "devnet";

  const claimed = (email: string, signer: Hex) => claimPersonalSafe(p, keys.tierService, email, signer);
  const founderSafe = await claimed(c.founderEmail, founder);
  const coDirectors: Director[] = [];
  for (const d of c.coDirectors ?? []) coDirectors.push({ safe: await claimed(d.email, privateKeyToAccount(d.key).address), key: d.key });
  const directors = BigInt(1 + coDirectors.length);
  const founderOwners = await chain.client.readContract({ address: founderSafe, abi: SAFE_ABI, functionName: "getOwners" });
  if (founderOwners.length !== 1 || !same(founderOwners[0] ?? "", founder)) throw new Error(`the founder's Safe ${founderSafe} is owned by ${founderOwners.join(", ")}, not the founder's key`);

  const companySafe = await companySafeOf(p, c.founderEmail, c.company);
  if ((await chain.client.getCode({ address: companySafe })) !== undefined) throw new Error(`a company named ${c.company} already exists for this founder at ${companySafe}`);
  const mint = encodeFunctionData({ abi: MINTER, functionName: "mint", args: [COMPANY_NAMESPACE, c.company, founderSafe] });
  await send(chain, { from: keys.tierService, to: record.companiesHouseRoles, data: throughRoles(companyRoleKey(tier), at(p, "CompanySafeMinter"), mint) });

  const installer = at(p, "Installer");
  const deploy = { safe: companySafe, founderSafe, coDirectors: coDirectors.map((d) => d.safe), threshold: { thresholdType: 0, min: directors, target: directors }, officers: c.officers, salt: c.salt };
  const { result } = await chain.client.simulateContract({ account: relayer, address: installer, abi: p.installerAbi, functionName: "deployMoney", args: [deploy] });
  await send(chain, { from: keys.relayer, to: installer, data: encodeFunctionData({ abi: p.installerAbi, functionName: "deployMoney", args: [deploy] }) });
  const d = result as { boardTopHat: bigint; officerHats: readonly bigint[]; roles: Hex; gate: Hex };
  const calls = (await chain.client.readContract({
    address: installer,
    abi: p.installerAbi,
    functionName: "buildMoney",
    args: [{ safe: companySafe, founderSafe, coDirectors: coDirectors.map((d) => d.safe), deployment: result, tokens: [{ token: c.token, ceiling: c.ceiling, budgetPeriod: 0, topAmount: c.topAmount, topHat: d.boardTopHat }] }],
  })) as readonly { to: Hex; value: bigint; data: Hex }[];
  const partial = { companySafe, founderSafe, founderKey: keys.founder, relayerKey: keys.relayer };
  // Before this batch the founder's Safe is the company Safe's only owner; the batch makes the co-Directors signers.
  await board(p, partial, calls.map((call) => ({ to: call.to, value: call.value, data: call.data })));
  const topBudget = await chain.client.readContract({ address: at(p, "Budgets"), abi: BUDGETS, functionName: "budgetCount" });
  return { ...partial, token: c.token, gate: d.gate, roles: d.roles, boardTopHat: d.boardTopHat, officerHats: d.officerHats, topBudget, coDirectors };
}

type BoardOf = Pick<Company, "companySafe" | "founderSafe" | "founderKey" | "relayerKey" | "coDirectors">;
const batchOf = (calls: readonly SafeCall[]): SafeCall => ({ to: THIRD_PARTY.multiSendCallOnly, data: multiSendData(calls), operation: DELEGATECALL });
/** The approved-hash signatures of these Director Safes, in ascending address order as the Safe requires. */
const approvals = (safes: readonly Hex[]): Hex =>
  concat([...safes].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)).map((s) => concat([pad(s, { size: 32 }), pad("0x", { size: 32 }), "0x01"])));
async function approveHashAs(p: Protocol, c: BoardOf, safe: Hex, key: Hex, txHash: Hex): Promise<void> {
  await execSafe(p.chain, safe, { to: c.companySafe, data: encodeFunctionData({ abi: SAFE_ABI, functionName: "approveHash", args: [txHash] }) }, [localPrivateKeySigner({ privateKey: key })], key);
}

/** A Board action: every founding Director's Safe approves the company Safe's batch, then the relayer executes it. */
export async function board(p: Protocol, c: BoardOf, calls: readonly SafeCall[]): Promise<Hex> {
  const proposal = await propose(p, c, calls);
  for (const d of c.coDirectors ?? []) await approveHashAs(p, c, d.safe, d.key, proposal.safeTxHash);
  return execute(p, c, proposal);
}

/** A Board proposal: the founder's Safe approves the batch; it waits until the other Directors approve (`approveProposal`). */
export async function propose(p: Protocol, c: BoardOf, calls: readonly SafeCall[]): Promise<Proposal> {
  const safeTx = await safeTxHash(p.chain, c.companySafe, batchOf(calls));
  await approveHashAs(p, c, c.founderSafe, c.founderKey, safeTx);
  return { safeTxHash: safeTx, calls };
}

/**
 * Another Director approves a waiting proposal; once every founding Director has, it executes. Refuses a proposal whose hash
 * no longer matches the company Safe's next transaction (another Board action executed in between).
 */
export async function approveProposal(p: Protocol, c: BoardOf, proposal: Proposal, director: Director): Promise<{ executed: boolean; txHash?: Hex }> {
  if ((await safeTxHash(p.chain, c.companySafe, batchOf(proposal.calls))) !== proposal.safeTxHash) throw new Error("STALE_PROPOSAL: another Board action executed since it was proposed");
  await approveHashAs(p, c, director.safe, director.key, proposal.safeTxHash);
  const approved = await Promise.all([c.founderSafe, ...(c.coDirectors ?? []).map((d) => d.safe)].map((s) => approvedBy(p, c, s, proposal.safeTxHash)));
  if (approved.some((a) => !a)) return { executed: false };
  return { executed: true, txHash: await execute(p, c, proposal) };
}

/** Whether a Director's Safe has approved the company Safe's transaction hash. */
export async function approvedBy(p: Protocol, c: Pick<Company, "companySafe">, directorSafe: Hex, txHash: Hex): Promise<boolean> {
  return (await p.chain.client.readContract({ address: c.companySafe, abi: APPROVED_HASHES, functionName: "approvedHashes", args: [directorSafe, txHash] })) === 1n;
}
const APPROVED_HASHES = [{ type: "function", name: "approvedHashes", stateMutability: "view", inputs: [{ type: "address" }, { type: "bytes32" }], outputs: [{ type: "uint256" }] }] as const;

async function execute(p: Protocol, c: BoardOf, proposal: Proposal): Promise<Hex> {
  return execWithSignatures(p.chain, c.companySafe, batchOf(proposal.calls), approvals([c.founderSafe, ...(c.coDirectors ?? []).map((d) => d.safe)]), c.relayerKey);
}

/** The Board creates a department: a child budget of `parent` (the top budget by default) for `hat`, with nothing to spend yet. */
export async function createDepartment(p: Protocol, c: Company, hat: bigint, parent: bigint = c.topBudget): Promise<bigint> {
  const budgets = at(p, "Budgets");
  await board(p, c, [{ to: budgets, data: encodeFunctionData({ abi: BUDGETS, functionName: "createChildBudget", args: [parent, 0n, hat] }) }]);
  return p.chain.client.readContract({ address: budgets, abi: BUDGETS, functionName: "budgetCount" });
}

/** The Board grants a hat to a wearer (a person's key, or an agent's Safe). */
export async function grantHat(p: Protocol, c: Company, hat: bigint, wearer: Hex): Promise<Hex> {
  return board(p, c, [mintHat(hat, wearer)]);
}

/** A grant as a Board proposal: the founder approves it, and it waits for the other Directors (`approveProposal`). */
export function proposeGrant(p: Protocol, c: Company, hat: bigint, wearer: Hex): Promise<Proposal> {
  return propose(p, c, [mintHat(hat, wearer)]);
}
const mintHat = (hat: bigint, wearer: Hex): SafeCall => ({ to: THIRD_PARTY.hats, data: encodeFunctionData({ abi: HATS, functionName: "mintHat", args: [hat, wearer] }) });

/**
 * The Board takes a hat back. The company Safe is the officer hats' eligibility module (InstallerMoney), so it marks the
 * wearer ineligible, and Hats burns the hat.
 */
export async function revokeHat(p: Protocol, c: Company, hat: bigint, wearer: Hex): Promise<Hex> {
  return board(p, c, [{ to: THIRD_PARTY.hats, data: encodeFunctionData({ abi: HATS, functionName: "setHatWearerStatus", args: [hat, wearer, false, true] }) }]);
}

/** The Board sets what a budget may spend this period. */
export async function setBudget(p: Protocol, c: Company, budget: bigint, amount: bigint): Promise<Hex> {
  return board(p, c, [{ to: at(p, "Budgets"), data: encodeFunctionData({ abi: BUDGETS, functionName: "setAmount", args: [budget, amount] }) }]);
}

export function wears(p: Protocol, wearer: Hex, hat: bigint): Promise<boolean> {
  return p.chain.client.readContract({ address: THIRD_PARTY.hats, abi: HATS, functionName: "isWearerOfHat", args: [wearer, hat] });
}

export function leftOf(p: Protocol, budget: bigint): Promise<bigint> {
  return p.chain.client.readContract({ address: at(p, "Budgets"), abi: BUDGETS, functionName: "leftOf", args: [budget] });
}

const refusal = (why: string): Refusal => (why.startsWith("NotAuthorised") ? "NOT_AUTHORISED" : why.startsWith("OverBudget") ? "OVER_BUDGET" : "REVERTED");

/**
 * A hat's wearer pays from a budget: `Budgets.spend` checks the hat and the budget, then the company Safe pays through
 * Roles, the Signer Gate and Payments, which stamps the document hash. A refusal is found by simulating first, so it
 * leaves nothing on chain, and is named in the blueprint's words.
 */
export async function pay(p: Protocol, x: Pay): Promise<PayResult> {
  const from = privateKeyToAccount(x.key).address;
  const data = encodeFunctionData({ abi: BUDGETS, functionName: "spend", args: [x.budget, x.to, x.amount, x.kind, x.documentHash, x.jobNonce] });
  const budgets = at(p, "Budgets");
  const why = await refusalOf(p.chain, { from, to: budgets, data }, BUDGETS);
  if (why !== undefined) return { ok: false, reason: refusal(why), detail: why };
  const txHash = await send(p.chain, { from: x.key, to: budgets, data });
  const receipt = await p.chain.client.getTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    if (!same(log.address, at(p, "Payments"))) continue;
    try {
      const event = decodeEventLog({ abi: PAYMENTS, data: log.data, topics: log.topics });
      if (event.eventName === "PaymentSent" && event.args.documentHash === x.documentHash) return { ok: true, txHash, paymentId: event.args.paymentId };
    } catch {
      // another Payments event
    }
  }
  throw new Error(`spend ${txHash} succeeded but Payments emitted no PaymentSent with document hash ${x.documentHash}`);
}

/**
 * The same spend as `pay`, made by the wearer's personal Safe as an ERC-4337 UserOperation (v4 D1): the Safe wears the
 * hat, its owner signs the op, a paymaster pays the gas, and `submit` takes it to the EntryPoint (a bundler, or
 * handleOps directly). A refusal is found by simulating the spend from the Safe first, so it leaves nothing on chain.
 */
export async function payByUserOp(p: Protocol, x: Omit<Pay, "key"> & { safe: Hex; ownerKey: Hex; paymaster: Hex; submit: Submit }): Promise<PayResult & { userOpHash?: Hex }> {
  const data = encodeFunctionData({ abi: BUDGETS, functionName: "spend", args: [x.budget, x.to, x.amount, x.kind, x.documentHash, x.jobNonce] });
  const budgets = at(p, "Budgets");
  const why = await refusalOf(p.chain, { from: x.safe, to: budgets, data }, BUDGETS);
  if (why !== undefined) return { ok: false, reason: refusal(why), detail: why };
  const op = await buildUserOp(p.chain, { safe: x.safe, ownerKey: x.ownerKey, module: THIRD_PARTY.safe4337Module, paymaster: x.paymaster, to: budgets, data });
  const txHash = await x.submit(op);
  const receipt = await p.chain.client.getTransactionReceipt({ hash: txHash });
  let userOpHash: Hex | undefined; let paymentId: Hex | undefined;
  for (const log of receipt.logs) {
    try {
      if (same(log.address, ENTRY_POINT_V07)) {
        const e = decodeEventLog({ abi: ENTRY_POINT, data: log.data, topics: log.topics });
        if (e.eventName === "UserOperationEvent" && same(e.args.sender, x.safe) && e.args.nonce === op.nonce) {   // this op, not another from the same Safe in the bundle
          if (!e.args.success) return { ok: false, reason: "REVERTED", detail: `user operation ${e.args.userOpHash} failed in ${txHash}` };
          userOpHash = e.args.userOpHash;
        }
      } else if (same(log.address, at(p, "Payments"))) {
        const e = decodeEventLog({ abi: PAYMENTS, data: log.data, topics: log.topics });
        if (e.eventName === "PaymentSent" && e.args.documentHash === x.documentHash) paymentId = e.args.paymentId;
      }
    } catch {
      // another event
    }
  }
  if (userOpHash === undefined || paymentId === undefined) throw new Error(`user operation in ${txHash} carried no PaymentSent with document hash ${x.documentHash}`);
  return { ok: true, txHash, paymentId, userOpHash };
}
