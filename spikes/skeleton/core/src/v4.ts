// The REAL v4 contracts under the test sites (plan task m2-contracts-under-sites), behind CHAIN_MODE=v4. The chain is
// packages/contracts' seeded state (Companies House and the 15 v4 contracts deployed); every chain action goes through
// packages/devnet's company module. The stand-in's ideas map like this:
//   org create        -> a company Safe minted by Companies House for the admin (the founder), authority installed, funded
//   a hat name        -> an officer hat created at installation (the seven names below, in order)
//   hat grant/revoke  -> a Board action (the founder's Safe approves the company Safe's batch): Hats.mintHat / setHatWearerStatus.
//                        Core checks first that the acting admin wears the admin hat, as the stand-in's contract did
//   Payments.send     -> Budgets.spend from the budget whose hat the payer wears (admin's or budget-holder's), through
//                        Roles, the Signer Gate and Payments, which stamps the document hash
//   the department    -> carried by Core with the grant (the stand-in carried it in the event; neither chain enforces it)
// Throwaway like the rest of the spike: what it teaches goes into the blueprint, then into packages.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeEventLog, keccak256, toHex, type Abi, type Address, type Hex, type Log } from "viem";
import { randomBytes } from "node:crypto";
import { connect } from "../../../../packages/devnet/src/modules/chain/service.ts";
import { THIRD_PARTY } from "../../../../packages/devnet/src/modules/protocol/service.ts";
import type { DeploymentRecord } from "../../../../packages/devnet/src/modules/protocol/types.ts";
import {
  createCompany, createDepartment, ERC20, grantHat, HATS, pay, PAYMENTS, revokeHat, setBudget, wears as wearsHat,
  type Company, type Protocol,
} from "../../../../packages/devnet/src/modules/company/service.ts";
import { config, skeletonDir } from "./config.ts";
import { loadJson, saveJson } from "./store.ts";
import { operatorKey, people } from "./people.ts";

export const HAT_NAMES = ["admin", "budget-holder", "payroll-approver", "member", "sales", "hr-manager", "project-manager"] as const;
const contractsDir = join(skeletonDir, "..", "..", "packages", "contracts");
// Companies House's devnet tier service: Anvil account 3 (packages/devnet test-keys "tierService"); public test key.
const TIER_SERVICE: Hex = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";

export type V4Org = {
  slug: string; company: Company; hats: Record<string, string>; budgets: Record<string, string>;
  /** `${hatId}:${wearer}` -> the department the last grant named */
  departments: Record<string, string>;
};
type Registry = Record<string, V4Org>;

// bigint does not survive JSON: hats and budgets are kept as decimal strings, the company's with a reviver
const reviveCompany = (c: any): Company => ({ ...c, boardTopHat: BigInt(c.boardTopHat), officerHats: c.officerHats.map(BigInt), topBudget: BigInt(c.topBudget) });
const registry = (): Registry => {
  const r = loadJson<Registry>("v4-orgs.json", {});
  for (const o of Object.values(r)) o.company = reviveCompany(o.company);
  return r;
};
const saveRegistry = (r: Registry) => saveJson("v4-orgs.json", JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v))));
export const v4Org = (slug: string): V4Org | undefined => registry()[slug];

let protocol: Promise<Protocol> | undefined;
export function proto(): Promise<Protocol> {
  protocol ??= (async () => {
    const record = JSON.parse(readFileSync(join(contractsDir, "deployments", "devnet.json"), "utf8")) as DeploymentRecord;
    const installer = JSON.parse(readFileSync(join(contractsDir, "out", "Installer.sol", "Installer.json"), "utf8")) as { abi: Abi };
    return { chain: await connect(config.rpcUrl), record, installerAbi: installer.abi };
  })();
  return protocol;
}
export const tokenArtifact = () => JSON.parse(readFileSync(join(contractsDir, "out", "MockERC20.sol", "MockERC20.json"), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
export const v4Addresses = async () => { const p = await proto(); return { hats: THIRD_PARTY.hats as Address, payments: p.record.contracts.Payments!.address as Address, budgets: p.record.contracts.Budgets!.address as Address }; };

/** Gas for the test people: the seeded chain funds Anvil's accounts 0 to 8 only. */
export async function fundPeople(): Promise<void> {
  const p = await proto();
  for (const a of [...people.map((x) => x.address), "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"]) {
    await (p.chain.client as any).request({ method: "anvil_setBalance", params: [a, toHex(10n ** 21n)] });
  }
}

export async function v4EnsureOrg(slug: string, admin: { email: string; address: string; privateKey: Hex }, budget: bigint, fund: bigint, token: Address): Promise<{ safe: Address; created: boolean }> {
  const known = v4Org(slug);
  if (known) return { safe: known.company.companySafe as Address, created: false };
  const p = await proto();
  await fundPeople();
  const company = await createCompany(p, { tierService: TIER_SERVICE, relayer: operatorKey, founder: admin.privateKey }, {
    founderEmail: admin.email, company: slug, token,
    officers: HAT_NAMES.map((n) => ({ details: n, maxSupply: 20 })),
    ceiling: fund, topAmount: budget, salt: keccak256(toHex(`capxul-skeleton:${slug}`)),
  });
  const hats = Object.fromEntries(HAT_NAMES.map((n, i) => [n, company.officerHats[i]!.toString()]));
  // One spending budget, as the stand-in's one budget per org: budget-holder's budget is a child of admin's, and Budgets
  // lets the wearer of a parent budget's hat spend from a child, so both hats pay from the same money.
  const adminBudget = await createDepartment(p, company, BigInt(hats.admin!));
  await setBudget(p, company, adminBudget, budget);
  const spending = await createDepartment(p, company, BigInt(hats["budget-holder"]!), adminBudget);
  await setBudget(p, company, spending, budget);
  const budgets: Record<string, string> = { admin: adminBudget.toString(), "budget-holder": spending.toString() };
  const r = registry(); r[slug] = { slug, company, hats, budgets, departments: {} }; saveRegistry(r);
  const wallet = p.chain.walletFor(operatorKey);
  const mint = await wallet.writeContract({ address: token, abi: ERC20, functionName: "mint", args: [company.companySafe, fund] });
  await p.chain.client.waitForTransactionReceipt({ hash: mint });
  await v4Hat("grant", slug, "admin", admin.address as Address, "");
  return { safe: company.companySafe as Address, created: true };
}

export async function v4Wears(slug: string, who: Address, hat: string): Promise<boolean> {
  const o = v4Org(slug); const id = o?.hats[hat];
  if (!o || id === undefined) return false;
  return wearsHat(await proto(), who, BigInt(id));
}

/** A hat grant or revoke: the Board's batch, signed by the founder's key. Refuses as the stand-in's contract did. */
export async function v4Hat(kind: "grant" | "revoke", slug: string, hat: string, wearer: Address, department: string): Promise<Hex> {
  const r = registry(); const o = r[slug];
  if (!o) throw new Error(`UnknownOrg: no company ${slug} on the chain`);
  const id = o.hats[hat]; if (id === undefined) throw new Error(`UnknownHat: ${hat}`);
  const p = await proto();
  const worn = await wearsHat(p, wearer, BigInt(id));
  if (kind === "grant" && worn) throw new Error(`AlreadyWorn: ${wearer} already wears ${hat}`);
  if (kind === "revoke" && !worn) throw new Error(`NotWorn: ${wearer} does not wear ${hat}`);
  o.departments[`${id}:${wearer.toLowerCase()}`] = department; saveRegistry(r);
  return kind === "grant" ? grantHat(p, o.company, BigInt(id), wearer) : revokeHat(p, o.company, BigInt(id), wearer);
}

export async function v4Pay(slug: string, to: Address, amount: bigint, documentHash: Hex, privateKey: Hex): Promise<{ ok: true; txHash: Hex } | { ok: false; reason: "NOT_AUTHORISED" | "OVER_BUDGET" | "REVERTED"; detail: string }> {
  const o = v4Org(slug);
  if (!o) return { ok: false, reason: "REVERTED", detail: `UnknownOrg ${slug}` };
  const p = await proto();
  const budget = BigInt(o.budgets["budget-holder"]!);   // the org's spending budget (see v4EnsureOrg)
  const r = await pay(p, { key: privateKey, budget, to, amount, kind: 1, documentHash, jobNonce: keccak256(randomBytes(32)) });
  return r.ok ? { ok: true, txHash: r.txHash } : r;
}

/** What the watcher turns into outbox events: hat grants and revokes, and payments, of companies this Core made. */
export type V4Event =
  | { slug: string; safe: string; kind: "hat_granted" | "hat_revoked"; hat: string; wearer: string; department: string | null }
  | { slug: string; safe: string; kind: "payment_sent"; paymentId: Hex; documentHash: Hex; from: string; to: string; amount: bigint };

export async function v4Decode(l: Log): Promise<V4Event | undefined> {
  const r = registry(); const { hats, payments } = await v4Addresses();
  if (l.address.toLowerCase() === hats.toLowerCase()) {
    let ev; try { ev = decodeEventLog({ abi: HATS, data: l.data, topics: l.topics as [Hex] }); } catch { return undefined; }
    if (ev.eventName !== "TransferSingle") return undefined;
    const { from, to, id } = ev.args as { from: string; to: string; id: bigint };
    for (const o of Object.values(r)) {
      const hat = Object.entries(o.hats).find(([, v]) => v === id.toString())?.[0];
      if (!hat) continue;
      const granted = /^0x0{40}$/.test(from);
      const wearer = granted ? to : from;
      return { slug: o.slug, safe: o.company.companySafe, kind: granted ? "hat_granted" : "hat_revoked", hat, wearer, department: o.departments[`${id}:${wearer.toLowerCase()}`] || null };
    }
    return undefined;
  }
  if (l.address.toLowerCase() === payments.toLowerCase()) {
    let ev; try { ev = decodeEventLog({ abi: PAYMENTS, data: l.data, topics: l.topics as [Hex] }); } catch { return undefined; }
    if (ev.eventName !== "PaymentSent") return undefined;
    const a = ev.args as { paymentId: Hex; sender: string; recipient: string; amount: bigint; documentHash: Hex };
    const o = Object.values(r).find((x) => x.company.companySafe.toLowerCase() === a.sender.toLowerCase());
    if (!o) return undefined;
    return { slug: o.slug, safe: o.company.companySafe, kind: "payment_sent", paymentId: a.paymentId, documentHash: a.documentHash, from: a.sender, to: a.recipient, amount: a.amount };
  }
  return undefined;
}
