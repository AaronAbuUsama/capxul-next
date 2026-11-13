import { createHash, randomUUID } from "node:crypto";
import { Schema } from "effect";
import { encodeFunctionData, formatUnits, parseAbi, type Abi, type Hex, type PublicClient } from "viem";
import exported from "../../../contracts/abi/abi.json" with { type: "json" };
import { authenticate, type Principal } from "../access/door.ts";
import { worldNow } from "../devnet/door.ts";
import { requireSeat } from "../organizations/door.ts";
import type { Sql } from "../platform/db.ts";
import { proposeChange, type ChangeBirth } from "./changes.ts";

export const BUDGETS_ABI = (exported as unknown as { contracts: Record<string, { abi: Abi }> }).contracts.Budgets!.abi;
export const HATS_ABI = parseAbi([
  "function viewHat(uint256 hatId) view returns (string details,uint32 maxSupply,uint32 supply,address eligibility,address toggle,string imageURI,uint16 lastHatId,bool mutable_,bool active)",
  "function createHat(uint256 admin,string details,uint32 maxSupply,address eligibility,address toggle,bool mutable_,string imageURI) returns (uint256)",
  "function mintHat(uint256 hatId,address wearer) returns (bool)",
]);
export const ERC20_ABI = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)"]);

export type Call = { to: string; value: string; data: Hex };
export type Proposal = { proposalId: string; nonce: string; threshold: { needed: number; of: number }; approvals: string[] };
export type Carried = { approval_id: string; proposal_id: string | null; url: string; proposal: Proposal | null };
/** Access's principal reads on the worker pool: a tenant reads only its own principal, holders are other people. */
export type People = { byEmail: (email: string) => Promise<Principal | null>; bySafe: (safe: string) => Promise<Principal | null> };
export type CarrierInput = { orgId: string; principalId: string; safe: string; calls: Call[]; note: string | null;
  summary: string; subject: { opener: "budgets"; subject_kind: "budget-change"; subject_id: string } };
/** Composition supplies what other concepts own: Organizations' deployment row, Board's Director check and both carriers. */
export type DepartmentServices = {
  client: Pick<PublicClient, "readContract">; budgets: Hex; hats: Hex;
  /** Organizations' readAdmittedDeployment. Until the People hat is named, every officer hat counts (budgets.role-conflict-unnamed-officers). */
  deployment: (sql: Sql, orgId: string) => Promise<{ safe_address: string; officer_hats: readonly string[]; people_hat?: string | null } | null>;
  isDirector: (sql: Sql, orgId: string, principal: Principal) => Promise<boolean>;
  board: (sql: Sql, input: CarrierInput) => Promise<Carried>;
  office: (sql: Sql, input: CarrierInput) => Promise<Carried>;
  carried: (sql: Sql, change: { approval_id: string; proposal_id: string | null }) => Promise<Carried>;
};

const S = Schema.String;
const Input = Schema.Struct({ orgId: S, requestKey: S, note: Schema.NullOr(S), name: S, parent: Schema.NullOr(S), amount: S,
  period: Schema.Literals(["month", "quarter", "year"]), token: Schema.NullOr(S), holders: Schema.Array(S) });
export type CreateInput = typeof Input.Type;

export const fail = (code: string, message: string): never => { throw Object.assign(new Error(`${code}: ${message}`), { code }); };
export const PERIODS = ["month", "quarter", "year"] as const;
export const hatHex = (id: bigint) => `0x${id.toString(16).padStart(64, "0")}`;
const level = (id: bigint) => { for (let i = 14; i >= 1; i--) if ((id >> BigInt(224 - 16 * i)) & 0xffffn) return i; return 0; };
/** Hats ids: a child's 16-bit index sits one level below its admin's. */
export const childHat = (admin: bigint, lastHatId: number) => admin | (BigInt(lastHatId + 1) << BigInt(224 - 16 * (level(admin) + 1)));
export const keyOf = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const OFFICE_SUPPLY = 100; // the office outlives a holder; holders are added and removed by later changes
const MAX_DEPTH = 8;

/** Who asks: an authenticated current Seat. The world clock, never the host's. */
export async function caller(sql: Sql, bearer: string, orgId: string) {
  if (!bearer) fail("NOT_AUTHENTICATED", "bearer session required");
  const at = await worldNow(sql), principal = await authenticate(sql, bearer, at);
  await requireSeat(sql, orgId, { principalId: principal.personId, kind: principal.kind === "person" ? "human" : "agent", safe: principal.safeAddress });
  // The Seat is proved; tenant reads below are this Organization's (budgets, changes, indexed views).
  await sql.query(`select set_config('app.org_id',$1,true),set_config('app.owner_kind','organization',true),
    set_config('app.owner_id',$1,true)`, [orgId]);
  return { at, principal };
}

export async function chainRead<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); } catch { return fail("PROVIDER_ERROR", "the chain did not answer"); }
}

/** budgets.departments.create: a team inside an active budget. One transaction; nothing is on chain when it returns. */
export async function createDepartment(sql: Sql, services: DepartmentServices, people: People, bearer: string, value: unknown, traceId: string) {
  let input: CreateInput;
  try { input = Schema.decodeUnknownSync(Input)(value, { onExcessProperty: "error" }); } catch { return fail("INVALID_INPUT", "department fields"); }
  const { at, principal } = await caller(sql, bearer, input.orgId);
  const org = input.orgId, key = keyOf(input.name);
  const deployment = await services.deployment(sql, org);
  if (!deployment) fail("WRONG_STATE", "money not deployed");
  // A top budget also grows the token's payout ceiling (Installer.buildSetCeiling); not built in this wave.
  if (input.parent === null) fail("WRONG_STATE", "a top budget is not available yet; name the parent budget");
  if (input.token !== null) fail("INVALID_INPUT", "a team takes its parent's token");
  if (!key) fail("INVALID_INPUT", "name");
  const safe = deployment!.safe_address.toLowerCase();
  const ref = input.parent!;
  const parentId = /^[1-9][0-9]*$/.test(ref) ? ref : (await sql.query(`select budget_id from app.budgets where org_id=$1
    and (key_claim=$2 or budget_ref=$2) and status='active'`, [org, ref])).rows[0]?.budget_id;
  const indexed = parentId && (await sql.query("select * from app.chain_budgets where budget_id=$1 and company_safe=$2", [parentId, safe])).rows[0];
  if (!indexed) fail("INVALID_INPUT", "parent is not an active budget here");
  const parent = BigInt(parentId), { client } = services;
  const [budget, left, authorised] = await chainRead(() => Promise.all([
    client.readContract({ address: services.budgets, abi: BUDGETS_ABI, functionName: "budgetOf", args: [parent] }) as Promise<any>,
    client.readContract({ address: services.budgets, abi: BUDGETS_ABI, functionName: "leftOf", args: [parent] }) as Promise<bigint>,
    client.readContract({ address: services.budgets, abi: BUDGETS_ABI, functionName: "authorised", args: [parent, principal.safeAddress as Hex] }) as Promise<boolean>,
  ]));
  if (String(budget.safe).toLowerCase() !== safe) fail("INVALID_INPUT", "parent is not this Organization's budget");
  const token = String(budget.token).toLowerCase() as Hex, period = PERIODS[Number(budget.period)]!;
  if (period !== input.period) fail("INVALID_INPUT", `a team takes its parent's period (${period})`);
  const [decimals, symbol] = await chainRead(() => Promise.all([
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" })]));
  if (!/^\d+(\.\d+)?$/.test(input.amount) || (input.amount.split(".")[1]?.length ?? 0) > decimals) fail("INVALID_INPUT", "amount");
  const [whole, fraction = ""] = input.amount.split(".");
  const amount = BigInt(whole! + fraction.padEnd(decimals, "0"));
  if (amount === 0n || amount >= 1n << 128n) fail("INVALID_INPUT", "amount");
  // SIGNER_RULE: the caller's own Safe when it acts for the parent, else the Board when the caller is a Director.
  const signer = authorised ? "office" : await services.isDirector(sql, org, principal) ? "board" : fail("ROLE_PERMISSION_DENIED", "neither the parent's office nor a Director");
  const conflicting = (deployment!.people_hat ? [deployment!.people_hat] : deployment!.officer_hats).map((h) => hatHex(BigInt(h)));
  const holders = [];
  for (const raw of input.holders) {
    const email = raw.trim().toLowerCase();
    const who = email.startsWith("@") ? null : await people.byEmail(email);
    const seat = who && (await sql.query("select safe_address from app.org_members where org_id=$1 and principal_id=$2 and status='active'",
      [org, who.personId])).rows[0];
    if (!seat?.safe_address) fail("INVALID_INPUT", `holder ${raw} is not a member with a set-up Safe`);
    const conflict = await sql.query("select 1 from app.hat_wearers where hat_id=any($1) and lower(wearer)=lower($2) and wearing",
      [conflicting, seat.safe_address]);
    if (conflict.rowCount) fail("ROLE_CONFLICT", `holder ${raw} wears ${deployment!.people_hat ? "the People hat" : "an officer hat"}`);
    holders.push({ member_id: who!.personId, safe_address: String(seat.safe_address).toLowerCase(), email });
  }
  const budgetRef = `dep_${createHash("sha256").update(`${org}\0${input.requestKey}`).digest("hex").slice(0, 24)}`;
  const admin = BigInt(budget.hat);
  const prior = (await sql.query("select * from app.budget_changes where org_id=$1 and request_key=$2", [org, input.requestKey])).rows[0];
  if (!prior) {
    if (budget.closed) fail("WRONG_STATE", "the parent budget is closed");
    if (Number(budget.depth) >= MAX_DEPTH) fail("INVALID_INPUT", "parent is eight deep");
    if (left < amount) fail("CHILDREN_EXCEED_PARENT", `the parent has ${formatUnits(left, decimals)} left to give`);
  }
  const parentKey = (await sql.query("select key from app.budgets where org_id=$1 and budget_id=$2", [org, parentId])).rows[0]?.key ?? null;
  const [, , , , , , lastHatId] = await chainRead(() => client.readContract({ address: services.hats, abi: HATS_ABI, functionName: "viewHat", args: [admin] }));
  const hat = childHat(admin, Number(lastHatId));
  const calls: Call[] = [
    { to: services.hats, value: "0", data: encodeFunctionData({ abi: HATS_ABI, functionName: "createHat",
      args: [admin, `office:${key}`, OFFICE_SUPPLY, safe as Hex, safe as Hex, true, ""] }) },
    ...holders.map((h) => ({ to: services.hats, value: "0", data: encodeFunctionData({ abi: HATS_ABI, functionName: "mintHat", args: [hat, h.safe_address as Hex] }) })),
    { to: services.budgets, value: "0", data: encodeFunctionData({ abi: BUDGETS_ABI, functionName: "createChildBudget", args: [parent, amount, hat] }) },
  ];
  const birth: ChangeBirth = { org_id: org, change_id: `change_${randomUUID()}`, request_key: input.requestKey, kind: "create",
    budget_ref: budgetRef, ceiling_token: null, signer, proposer_principal_id: principal.personId,
    terms: { amount: amount.toString(), holders: holders.map(({ member_id, safe_address }) => ({ member_id, safe_address })),
      ceiling: null, leave: null, restore: null, note: input.note },
    budget: { kind: "department", key, name: input.name.trim(), parent_budget_id: parentId, token, period, hat_id: hatHex(hat), admin_hat_id: hatHex(admin) } };
  let carried: Carried | undefined;
  const { change, repeated } = await proposeChange(sql, birth, async (inner) => {
    carried = await services[signer](inner, { orgId: org, principalId: principal.personId, safe: principal.safeAddress, calls, note: input.note,
      summary: `Create the ${input.name.trim()} department: ${input.amount} ${symbol} a ${period}`,
      subject: { opener: "budgets", subject_kind: "budget-change", subject_id: birth.change_id } });
    return { approval_id: carried.approval_id, proposal_id: carried.proposal_id };
  }, { at, traceId, actor: principal.personId });
  carried ??= await services.carried(sql, change);
  const row = (await sql.query("select * from app.budgets where org_id=$1 and budget_ref=$2", [org, change.budget_ref])).rows[0]!;
  const named = repeated ? await Promise.all((change.terms.holders as { safe_address: string }[]).map(async (h) =>
    ({ email: (await people.bySafe(h.safe_address))?.email ?? null, safe: h.safe_address }))) : holders.map((h) => ({ email: h.email, safe: h.safe_address }));
  return {
    status: change.state === "applied" ? "executed" : change.state === "abandoned" ? change.outcome : signer === "board" ? "awaiting_approvals" : "awaiting_approval",
    changeId: change.change_id, requestKey: change.request_key, signer: change.signer, approvalId: change.approval_id,
    approvalUrl: carried.url, proposal: carried.proposal,
    department: { key: row.key, id: row.budget_ref, name: row.name, parent: row.parent_budget_id,
      token: row.token, period: row.period, amount: formatUnits(BigInt(change.terms.amount), decimals), office: { hat: row.hat_id, holders: named } },
    parent: { key: parentKey, childrenAmount: formatUnits(BigInt(budget.childrenAmount), decimals), left: formatUnits(left, decimals) },
    office: { hat: row.hat_id, period: row.period },
    groups: { office: 1, holders: change.terms.holders.length, ceiling: 0, budget: 1 },
  };
}
