// The proof of Capxul Core, from keys alone (no browser, no outside service): a company is born under Companies House, its
// authority is installed (hats, Roles, Signer Gate, Budgets), a department is given a budget and a hat, a payment is made
// from the budget under the hat through Payments with a document hash, the refusals hold, and an agent, created through
// AgentOwner, spends under a hat it was granted and is stopped from everything else.
//
// The call sequence follows the old fork tests `test_Proof_StartupMoneyJourney` and `test_RealBudgetPaysThroughInstalledRoles`.

import { localPrivateKeySigner } from "@capxul/sdk";
import { concat, encodeFunctionData, keccak256, pad, stringToHex, type Abi, type Hex } from "viem";

import { send } from "../chain/service.ts";
import { claimRoleKey, companyRoleKey, DELEGATECALL, execSafe, execWithSignatures, multiSendData, ROLES_ABI, SAFE_ABI, safeTxHash, signedExecData, THIRD_PARTY, type SafeCall } from "../protocol/service.ts";
import { AGENT_OWNER, BUDGETS, CLAIMER, ERC20, HATS, MINTER, PAYMENTS } from "./internal/abis.ts";
import { refusalOf } from "./internal/refusal.ts";
import type { ProofInput, ProofState, StepResult } from "./types.ts";

export type * from "./types.ts";

const NAMESPACE = "capxul:devnet:email:v1";
const COMPANY_NAMESPACE = "capxul:devnet:company:v1";
const UNIT = 1_000_000n; // the token has 6 decimals
const hash = (text: string): Hex => keccak256(stringToHex(text));

export async function runProof(input: ProofInput): Promise<readonly StepResult[]> {
  const { chain, record, keys } = input;
  const at = (name: string): Hex => {
    const entry = record.contracts[name];
    if (entry === undefined) throw new Error(`the deployment record has no ${name}`);
    return entry.address;
  };
  const house = record.companiesHouse;
  const roles = record.companiesHouseRoles;
  const founderSigner = localPrivateKeySigner({ privateKey: keys.founder.key });
  const secondSigner = localPrivateKeySigner({ privateKey: keys.second.key });
  const agentSigner = localPrivateKeySigner({ privateKey: keys.agent.key });
  const results: StepResult[] = [];
  const state: Partial<ProofState> = {};
  const need = <K extends keyof ProofState>(name: K): ProofState[K] => {
    const value = state[name];
    if (value === undefined) throw new Error(`needs ${name}, which an earlier step did not produce`);
    return value as ProofState[K];
  };

  async function step(name: string, run: () => Promise<string>): Promise<void> {
    let result: StepResult;
    try {
      result = { name, ok: true, detail: await run() };
    } catch (error) {
      result = { name, ok: false, detail: error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error) };
    }
    results.push(result);
    input.report(result);
  }

  /** A step that must be refused: it passes when the call would revert, and names the revert. */
  async function refused(name: string, call: () => { from: Hex; to: Hex; data: Hex } | Promise<{ from: Hex; to: Hex; data: Hex }>, abi: Abi, expect: RegExp): Promise<void> {
    await step(name, async () => {
      const why = await refusalOf(chain, await call(), abi);
      if (why === undefined) throw new Error("it was not refused");
      if (!expect.test(why)) throw new Error(`refused for the wrong reason: ${why}`);
      return `refused: ${why}`;
    });
  }

  /** A Board action: the founder's Safe approves the company Safe's batch, then anyone executes it. */
  async function board(calls: readonly SafeCall[]): Promise<void> {
    const companySafe = need("companySafe");
    const founderSafe = need("founderSafe");
    const batch: SafeCall = { to: THIRD_PARTY.multiSendCallOnly, data: multiSendData(calls), operation: DELEGATECALL };
    const txHash = await safeTxHash(chain, companySafe, batch);
    await execSafe(chain, founderSafe, { to: companySafe, data: encodeFunctionData({ abi: SAFE_ABI, functionName: "approveHash", args: [txHash] }) }, [founderSigner], keys.founder.key);
    const approved = concat([pad(founderSafe, { size: 32 }), pad("0x", { size: 32 }), "0x01"]);
    await execWithSignatures(chain, companySafe, batch, approved, keys.deployer.key);
  }

  const throughRoles = (role: Hex, to: Hex, data: Hex): Hex =>
    encodeFunctionData({ abi: ROLES_ABI, functionName: "execTransactionWithRole", args: [to, 0n, data, DELEGATECALL, role, true] });

  // 1. Companies House's claim role, held by the tier's service key, makes the founder's personal Safe.
  await step("founder's personal Safe claimed through Companies House's claim role", async () => {
    const email = "founder@acme.test";
    const claimer = at("CompaniesHouseClaimer");
    const claim = encodeFunctionData({ abi: CLAIMER, functionName: "claim", args: [NAMESPACE, email, keys.founder.address] });
    await send(chain, { from: keys.tierService.key, to: roles, data: throughRoles(claimRoleKey("devnet"), claimer, claim) });
    const safe = await chain.client.readContract({ address: claimer, abi: CLAIMER, functionName: "safeAddressFor", args: [house, NAMESPACE, email] });
    const owners = await chain.client.readContract({ address: safe, abi: SAFE_ABI, functionName: "getOwners" });
    if (owners.length !== 1 || owners[0]?.toLowerCase() !== keys.founder.address.toLowerCase()) throw new Error(`owners are ${owners.join(", ")}`);
    state.founderSafe = safe;
    return `Safe ${safe}, its one owner the founder's key ${keys.founder.address}`;
  });

  // 2. The company role makes the company Safe, owned by the founder's Safe.
  await step("company Safe minted through Companies House's company role, owned by the founder's Safe", async () => {
    const founderSafe = need("founderSafe");
    const minter = at("CompanySafeMinter");
    const company = "acme-ltd";
    const mint = encodeFunctionData({ abi: MINTER, functionName: "mint", args: [COMPANY_NAMESPACE, company, founderSafe] });
    await send(chain, { from: keys.tierService.key, to: roles, data: throughRoles(companyRoleKey("devnet"), minter, mint) });
    const safe = await chain.client.readContract({ address: minter, abi: MINTER, functionName: "companySafeAddressFor", args: [house, COMPANY_NAMESPACE, company, founderSafe] });
    const owners = await chain.client.readContract({ address: safe, abi: SAFE_ABI, functionName: "getOwners" });
    if (owners.length !== 1 || owners[0]?.toLowerCase() !== founderSafe.toLowerCase()) throw new Error(`owners are ${owners.join(", ")}`);
    state.companySafe = safe;
    return `Safe ${safe}, its one owner ${founderSafe}`;
  });

  // 3. Authority is installed: hats, Roles, the Signer Gate, Budgets and a top budget, in one batch the founder approves.
  await step("authority installed on the company Safe (hats, Roles, Signer Gate, Budgets, top budget)", async () => {
    const companySafe = need("companySafe");
    const founderSafe = need("founderSafe");
    const installer = at("Installer");
    const installerAbi = (input.artifacts.installer as { abi: Abi }).abi;
    const tokenArtifact = input.artifacts.token as { abi: Abi; bytecode: { object: Hex } };
    const wallet = chain.walletFor(keys.deployer.key);
    const deployHash = await wallet.deployContract({ abi: tokenArtifact.abi, bytecode: tokenArtifact.bytecode.object, args: ["Test USD", "TUSD", 6] });
    const token = (await chain.client.waitForTransactionReceipt({ hash: deployHash })).contractAddress;
    if (token === null || token === undefined) throw new Error("the test token did not deploy");
    await send(chain, { from: keys.deployer.key, to: token, data: encodeFunctionData({ abi: ERC20, functionName: "mint", args: [companySafe, 100_000n * UNIT] }) });
    state.token = token;

    const deploy = {
      safe: companySafe,
      founderSafe,
      coDirectors: [],
      threshold: { thresholdType: 0, min: 1n, target: 1n },
      officers: [{ details: "Operations", maxSupply: 3 }],
      salt: pad("0x1", { size: 32 }),
    };
    const { result: deployment } = await chain.client.simulateContract({ account: keys.deployer.address, address: installer, abi: installerAbi, functionName: "deployMoney", args: [deploy] });
    await send(chain, { from: keys.deployer.key, to: installer, data: encodeFunctionData({ abi: installerAbi, functionName: "deployMoney", args: [deploy] }) });
    const d = deployment as { boardTopHat: bigint; officerHats: readonly bigint[]; roles: Hex; gate: Hex };
    const calls = (await chain.client.readContract({
      address: installer,
      abi: installerAbi,
      functionName: "buildMoney",
      args: [{ safe: companySafe, founderSafe, coDirectors: [], deployment, tokens: [{ token, ceiling: 50_000n * UNIT, budgetPeriod: 0, topAmount: 50_000n * UNIT, topHat: d.boardTopHat }] }],
    })) as readonly { to: Hex; value: bigint; data: Hex }[];
    state.gate = d.gate;
    state.roles = d.roles;
    state.boardTopHat = d.boardTopHat;
    state.opsHat = d.officerHats[0] as bigint;
    await board(calls.map((call) => ({ to: call.to, value: call.value, data: call.data })));

    const [moduleOn, owners, wornByBoard, configured] = await Promise.all([
      chain.client.readContract({ address: companySafe, abi: SAFE_ABI, functionName: "isModuleEnabled", args: [d.gate] }),
      chain.client.readContract({ address: companySafe, abi: SAFE_ABI, functionName: "getOwners" }),
      chain.client.readContract({ address: THIRD_PARTY.hats, abi: HATS, functionName: "isWearerOfHat", args: [companySafe, d.boardTopHat] }),
      chain.client.readContract({ address: at("Budgets"), abi: BUDGETS, functionName: "configs", args: [companySafe] }),
    ]);
    if (!moduleOn) throw new Error("the Signer Gate is not a module of the company Safe");
    if (!wornByBoard) throw new Error("the company Safe does not wear the Board's top hat");
    if (configured[0].toLowerCase() !== d.roles.toLowerCase()) throw new Error("Budgets is not configured with the company's Roles");
    state.topBudget = await chain.client.readContract({ address: at("Budgets"), abi: BUDGETS, functionName: "budgetCount" });
    return `Gate ${d.gate} is the Safe's module, Roles ${d.roles}, Board top hat on the Safe, owners now ${owners.join(", ")}, top budget #${state.topBudget} of 50,000 TUSD`;
  });

  // 4. A department: a child budget under the top budget, its hat the Operations hat.
  await step("department created: a child budget under the top budget, for the Operations hat", async () => {
    const budgets = at("Budgets");
    await board([{ to: budgets, data: encodeFunctionData({ abi: BUDGETS, functionName: "createChildBudget", args: [need("topBudget"), 0n, need("opsHat")] }) }]);
    state.department = await chain.client.readContract({ address: budgets, abi: BUDGETS, functionName: "budgetCount" });
    return `budget #${state.department}, parent #${state.topBudget}`;
  });

  // 5. The Board grants the Operations hat to the second key.
  await step("Operations hat granted to the second key", async () => {
    await board([{ to: THIRD_PARTY.hats, data: encodeFunctionData({ abi: HATS, functionName: "mintHat", args: [need("opsHat"), keys.second.address] }) }]);
    const wears = await chain.client.readContract({ address: THIRD_PARTY.hats, abi: HATS, functionName: "isWearerOfHat", args: [keys.second.address, need("opsHat")] });
    if (!wears) throw new Error("the key does not wear the hat");
    return `${keys.second.address} wears hat ${need("opsHat")}`;
  });

  // 6. The department's budget is set.
  await step("department budget set to 5,000 TUSD a month", async () => {
    const budgets = at("Budgets");
    await board([{ to: budgets, data: encodeFunctionData({ abi: BUDGETS, functionName: "setAmount", args: [need("department"), 5_000n * UNIT] }) }]);
    const left = await chain.client.readContract({ address: budgets, abi: BUDGETS, functionName: "leftOf", args: [need("department")] });
    if (left !== 5_000n * UNIT) throw new Error(`${left} left`);
    return `left this period: ${left / UNIT} TUSD`;
  });

  const spendData = (amount: bigint, doc: Hex, nonce: Hex): Hex =>
    encodeFunctionData({ abi: BUDGETS, functionName: "spend", args: [need("department"), keys.payee.address, amount as never, 1, doc, nonce] });

  // 7. The hat's wearer pays a third address from the budget, through Payments, with a document hash.
  await step("second key pays a third address 1,000 TUSD from the budget, through Payments, with a document hash", async () => {
    const token = need("token");
    const doc = hash("invoice INV-0001");
    const before = await chain.client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [keys.payee.address] });
    const tx = await send(chain, { from: keys.second.key, to: at("Budgets"), data: spendData(1_000n * UNIT, doc, hash("job 1")) });
    const after = await chain.client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [keys.payee.address] });
    if (after - before !== 1_000n * UNIT) throw new Error(`the payee gained ${after - before}`);
    const receipt = await chain.client.getTransactionReceipt({ hash: tx });
    const sent = receipt.logs.filter((log) => log.address.toLowerCase() === at("Payments").toLowerCase());
    const event = sent.map((log) => { try { return decodePayment(log); } catch { return undefined; } }).find((decoded) => decoded !== undefined);
    if (event === undefined || event.documentHash !== doc) throw new Error("no PaymentSent carrying the document hash");
    const paid = await chain.client.readContract({ address: at("Payments"), abi: PAYMENTS, functionName: "paid", args: [event.paymentId] });
    if (!paid) throw new Error("Payments does not show the payment as paid");
    return `PaymentSent ${event.paymentId} stamped with document hash ${doc}`;
  });

  // 8. The refusals: no hat, and over the budget.
  await refused("a key without the hat is refused", () => ({ from: keys.stranger.address, to: at("Budgets"), data: spendData(10n * UNIT, hash("invoice x"), hash("job x")) }), BUDGETS, /^NotAuthorised/);
  await refused("an amount over the budget is refused, even for the hat's wearer", () => ({ from: keys.second.address, to: at("Budgets"), data: spendData(4_500n * UNIT, hash("invoice y"), hash("job y")) }), BUDGETS, /^OverBudget/);

  // 9. An agent, created through AgentOwner by the company Safe, with a Safe of its own and its key the one signer.
  await step("agent created through AgentOwner: its own Safe, its key the one signer, the company its owner", async () => {
    await board([{ to: at("AgentOwner"), data: encodeFunctionData({ abi: AGENT_OWNER, functionName: "create", args: [keys.agent.address, need("companySafe")] }) }]);
    const safe = await chain.client.readContract({ address: at("AgentOwner"), abi: AGENT_OWNER, functionName: "safeAddressFor", args: [keys.agent.address, need("companySafe")] });
    const [owners, agent] = await Promise.all([
      chain.client.readContract({ address: safe, abi: SAFE_ABI, functionName: "getOwners" }),
      chain.client.readContract({ address: at("AgentOwner"), abi: AGENT_OWNER, functionName: "agentOf", args: [safe] }),
    ]);
    if (owners.length !== 1 || owners[0]?.toLowerCase() !== keys.agent.address.toLowerCase()) throw new Error(`owners are ${owners.join(", ")}`);
    if (agent.owner.toLowerCase() !== need("companySafe").toLowerCase()) throw new Error("the agent's owner is not the company Safe");
    state.agentSafe = safe;
    return `agent Safe ${safe}, owner ${agent.owner}`;
  });

  const agentSpend = (amount: bigint, doc: Hex, nonce: Hex): SafeCall => ({ to: at("Budgets"), data: spendData(amount, doc, nonce) });
  const asAgent = async (call: SafeCall) => ({ from: keys.agent.address, to: need("agentSafe"), data: await signedExecData(chain, need("agentSafe"), call, [agentSigner]) });
  const AGENT_ERRORS = [...AGENT_OWNER, ...BUDGETS] as Abi;

  await refused("agent with no hat is refused (Budgets sees the agent's Safe, which wears nothing)", () => ({ from: need("agentSafe"), to: at("Budgets"), data: agentSpend(10n * UNIT, hash("a0"), hash("a0")).data }), BUDGETS, /^NotAuthorised/);

  await step("Operations hat granted to the agent's Safe", async () => {
    await board([{ to: THIRD_PARTY.hats, data: encodeFunctionData({ abi: HATS, functionName: "mintHat", args: [need("opsHat"), need("agentSafe")] }) }]);
    const wears = await chain.client.readContract({ address: THIRD_PARTY.hats, abi: HATS, functionName: "isWearerOfHat", args: [need("agentSafe"), need("opsHat")] });
    if (!wears) throw new Error("the agent's Safe does not wear the hat");
    return `the agent's Safe wears hat ${need("opsHat")}`;
  });

  await step("agent pays 500 TUSD from the department budget under its hat, signed by its key alone (no bundler)", async () => {
    const token = need("token");
    const before = await chain.client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [keys.payee.address] });
    await execSafe(chain, need("agentSafe"), agentSpend(500n * UNIT, hash("invoice INV-0002"), hash("job 2")), [agentSigner], keys.agent.key);
    const after = await chain.client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [keys.payee.address] });
    if (after - before !== 500n * UNIT) throw new Error(`the payee gained ${after - before}`);
    return "Agent key -> agent Safe.execTransaction -> Budgets.spend (msg.sender = agent Safe, wears the hat) -> Roles -> Gate -> company Safe -> Payments";
  });

  await refused("agent over the department budget is refused", () => ({ from: need("agentSafe"), to: at("Budgets"), data: agentSpend(4_000n * UNIT, hash("a2"), hash("a2")).data }), BUDGETS, /^OverBudget/);
  await refused("agent cannot call its own Safe (swap its owner, change its guard)", () => asAgent({ to: need("agentSafe"), data: encodeFunctionData({ abi: SAFE_ABI, functionName: "enableModule", args: [keys.agent.address] }) }), AGENT_ERRORS, /^AgentSelfCall/);
  await refused("agent cannot delegatecall", () => asAgent({ to: at("Payments"), data: "0x", operation: DELEGATECALL }), AGENT_ERRORS, /^AgentSelfCall/);

  await step("owner freezes the agent: the company Safe takes its key's place on the agent's Safe", async () => {
    await board([{ to: at("AgentOwner"), data: encodeFunctionData({ abi: AGENT_OWNER, functionName: "freeze", args: [need("agentSafe")] }) }]);
    const agent = await chain.client.readContract({ address: at("AgentOwner"), abi: AGENT_OWNER, functionName: "agentOf", args: [need("agentSafe")] });
    if (!agent.frozen) throw new Error("not frozen");
    return "AgentOwner now holds the owner slot; the agent's key is no longer a signer";
  });
  await refused("a frozen agent can no longer sign: its payment is refused", () => asAgent(agentSpend(10n * UNIT, hash("a3"), hash("a3"))), AGENT_ERRORS, /GS026|invalid owner|signatures/i);

  return results;
}

function decodePayment(log: { data: Hex; topics: readonly Hex[] }): { paymentId: Hex; documentHash: Hex } {
  // PaymentSent(bytes32 indexed paymentId, address indexed sender, address indexed recipient, address token, uint256 amount, uint16 kind, bytes32 documentHash)
  const [signature, paymentId] = log.topics;
  if (signature === undefined || paymentId === undefined) throw new Error("not a PaymentSent");
  const words = log.data.slice(2).match(/.{64}/g) ?? [];
  const documentHash = words[3];
  if (words.length !== 4 || documentHash === undefined) throw new Error("not a PaymentSent");
  return { paymentId, documentHash: `0x${documentHash}` };
}

