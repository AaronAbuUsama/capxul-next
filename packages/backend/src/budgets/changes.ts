import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Sql } from "../platform/db.ts";
import { emit } from "../platform/outbox.ts";

export type ChangeKind = "create" | "set_amount" | "close" | "reopen" | "add_holder" | "remove_holder"
  | "set_ceiling" | "freeze_ceiling" | "unfreeze_ceiling";
export type ChangeOutcome = "rejected" | "replaced" | "failed" | "declined" | "expired";
export type Terms = {
  amount: string | null; holders: readonly { member_id: string; safe_address: string }[];
  ceiling: string | null; leave: string | null; restore: Record<string, string> | null; note: string | null;
};
/** A create's planned budget: what the chain cannot name. Amounts and wearers stay chain facts. */
export type PlannedBudget = {
  kind: "department" | "allowance"; key: string; name: string; parent_budget_id: string | null;
  token: string; period: "month" | "quarter" | "year"; hat_id: string; admin_hat_id: string;
};
export type ChangeBirth = {
  org_id: string; change_id: string; request_key: string; kind: ChangeKind; budget_ref: string | null;
  ceiling_token: string | null; signer: "board" | "office"; proposer_principal_id: string; terms: Terms;
  budget?: PlannedBudget;
};
/** What carries the change, opened by the caller in this same transaction (`board.propose` or `approvals.open`). */
export type Carry = (sql: Sql) => Promise<{ approval_id: string; proposal_id: string | null }>;
export type Context = { at: number; traceId: string; actor: string | null };

const fail = (code: string, message: string): never => { throw Object.assign(new Error(`${code}: ${message}`), { code }); };
const same = (row: Record<string, unknown>, birth: ChangeBirth) =>
  row.kind === birth.kind && row.budget_ref === birth.budget_ref && row.ceiling_token === birth.ceiling_token &&
  row.signer === birth.signer && isDeepStrictEqual(row.terms, JSON.parse(JSON.stringify(birth.terms)));

async function transitioned(sql: Sql, name: "budget_transitioned" | "budget_change_transitioned", org: string,
  entity: string, context: Context, props: Record<string, unknown>) {
  await emit(sql, { id: `event_${randomUUID()}`, name, machine: name === "budget_transitioned" ? "budget" : "budget-change",
    entity_id: JSON.stringify([org, entity]), owner_kind: "organization", owner_id: org, actor: context.actor,
    trace_id: context.traceId, at: context.at, props: { org_id: org, ...props } });
}

/** The preparing rpc's birth (budget-change.propose, and budget.propose for a create). Opens no transaction. */
export async function proposeChange(sql: Sql, birth: ChangeBirth, carry: Carry, context: Context) {
  const org = birth.org_id;
  if ((birth.kind === "create") !== !!birth.budget || (birth.kind === "create" && !birth.budget_ref))
    fail("INVALID_INPUT", "a create, and only a create, plans its budget");
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`budgets:${org}`]);
  const prior = (await sql.query("select * from app.budget_changes where org_id=$1 and request_key=$2",
    [org, birth.request_key])).rows[0];
  if (prior) {
    if (!same(prior, birth)) fail("INVALID_INPUT", "request key names another change");
    if (prior.state === "abandoned") fail("WRONG_STATE", `change ${prior.change_id} was abandoned`);
    return { change: prior, repeated: true };
  }
  const admin = birth.budget?.admin_hat_id ?? null;
  const waiting = (await sql.query(`select change_id from app.budget_changes where org_id=$1 and state='proposed'
    and (budget_ref=$2 or ceiling_token=$3 or admin_hat_id=$4) limit 1`, [org, birth.budget_ref, birth.ceiling_token, admin])).rows[0];
  if (waiting) fail("WRONG_STATE", `change ${waiting.change_id} is still waiting`);
  if (birth.budget) {
    const taken = (await sql.query("select budget_ref from app.budgets where org_id=$1 and key_claim=$2", [org, birth.budget.key])).rows[0];
    if (taken) fail("WRONG_STATE", `key ${birth.budget.key} is held by ${taken.budget_ref}`);
  }
  // Every refusal is decided before the carrier opens, so a refused request prepares nothing.
  const { approval_id, proposal_id } = await carry(sql);
  if (birth.budget) {
    const b = birth.budget;
    await sql.query(`insert into app.budgets (org_id,budget_ref,kind,key,key_claim,name,parent_budget_id,token,period,
      budget_id,hat_id,admin_hat_id,status,created_change_id,created_at,updated_at)
      values ($1,$2,$3,$4,$4,$5,$6,$7,$8,null,$9,$10,'proposed',$11,$12,$12)`,
    [org, birth.budget_ref, b.kind, b.key, b.name, b.parent_budget_id, b.token.toLowerCase(), b.period, b.hat_id,
      b.admin_hat_id, birth.change_id, context.at]);
    await transitioned(sql, "budget_transitioned", org, birth.budget_ref!, context,
      { from: null, to: "proposed", transition: "propose", budget_ref: birth.budget_ref, kind: b.kind, budget_id: null });
  }
  const change = (await sql.query(`insert into app.budget_changes (org_id,change_id,request_key,kind,budget_ref,ceiling_token,
    admin_hat_id,signer,proposal_id,approval_id,proposer_principal_id,terms,state,outcome,created_at,settled_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'proposed',null,$13,null) returning *`,
  [org, birth.change_id, birth.request_key, birth.kind, birth.budget_ref, birth.ceiling_token, admin, birth.signer,
    proposal_id, approval_id, birth.proposer_principal_id, JSON.stringify(birth.terms), context.at])).rows[0]!;
  await transitioned(sql, "budget_change_transitioned", org, birth.change_id, context, { from: null, to: "proposed",
    transition: "propose", change_id: birth.change_id, kind: birth.kind, budget_ref: birth.budget_ref, signer: birth.signer, outcome: null });
  return { change, repeated: false };
}

/** The carrier's end: Approvals' TerminalEvent or Board's proposal end, routed by opener budgets and this change as subject. */
export type CarrierEnd = {
  org_id: string; change_id: string; chain_id: number | null; transaction_hash: string | null;
  outcome: "landed" | "executed" | "reverted" | "displaced" | "expired" | "declined" | "refused" | "withdrawn"
    | "rejected" | "replaced" | "failed";
};
const ended: Record<Exclude<CarrierEnd["outcome"], "landed" | "executed">, ChangeOutcome> = {
  reverted: "failed", refused: "failed", withdrawn: "failed", failed: "failed",
  displaced: "replaced", replaced: "replaced", rejected: "rejected", expired: "expired", declined: "declined",
};
const PERIOD = { month: 0, quarter: 1, year: 2 } as const;
const hatHex = (id: string) => `0x${BigInt(id).toString(16).padStart(64, "0")}`;
const ZERO = `0x${"0".repeat(40)}`;

type Log = { contract: string; event: string; args: Record<string, string> };
/** The change's own effect among the executed transaction's indexed facts (Ponder, at finality). */
function effect(change: Record<string, any>, budget: Record<string, any> | undefined, safe: string, logs: Log[]) {
  const terms = change.terms as Terms, is = (contract: string, event: string) => logs.filter((l) => l.contract === contract && l.event === event);
  const own = (event: string) => is("budgets", event).some((l) => l.args.id === budget?.budget_id);
  switch (change.kind as ChangeKind) {
    case "create": return is("budgets", "BudgetCreated").find((l) => l.args.safe === safe.toLowerCase() &&
      hatHex(l.args.hat!) === budget!.hat_id.toLowerCase() && l.args.token === budget!.token &&
      Number(l.args.period) === PERIOD[budget!.period as keyof typeof PERIOD] &&
      (l.args.parent === "0" ? null : l.args.parent) === budget!.parent_budget_id)?.args.id ?? false;
    case "set_amount": return is("budgets", "BudgetAmountSet").some((l) => l.args.id === budget?.budget_id && l.args.amount === terms.amount);
    case "close": return own("BudgetClosed");
    case "reopen": return own("BudgetReopened");
    case "add_holder": case "remove_holder": {
      const holder = terms.holders[0]?.safe_address.toLowerCase(), mint = change.kind === "add_holder";
      return is("hats", "TransferSingle").some((l) => hatHex(l.args.id!) === budget?.hat_id.toLowerCase() &&
        (mint ? l.args.from === ZERO && l.args.to === holder : l.args.from === holder && l.args.to === ZERO));
    }
    default: return true; // A ceiling batch's own execution is its effect.
  }
}

/** budgets.changes.follow's settle step, in the caller's (carrier's) transaction. A second delivery does nothing. */
export async function settleChange(sql: Sql, end: CarrierEnd, context: Context) {
  const change = (await sql.query("select * from app.budget_changes where org_id=$1 and change_id=$2 for update",
    [end.org_id, end.change_id])).rows[0];
  if (!change) fail("INVALID_INPUT", "unknown budget change");
  if (change.state !== "proposed") return { state: change.state as string, outcome: change.outcome as ChangeOutcome | null, repeated: true };
  const budget = change.budget_ref ? (await sql.query("select * from app.budgets where org_id=$1 and budget_ref=$2 for update",
    [end.org_id, change.budget_ref])).rows[0] : undefined;
  let outcome: ChangeOutcome | null = null, bound: string | null = null;
  if (end.outcome === "landed" || end.outcome === "executed") {
    const hash = end.transaction_hash;
    if (!hash || end.chain_id === null) return fail("INVALID_INPUT", "an executed carrier names its transaction");
    const safe = (await sql.query("select safe from app.organizations where org_id=$1", [end.org_id])).rows[0]?.safe;
    const logs = (await sql.query(`select contract,event,args from app.chain_logs where chain_id=$1 and tx_hash=$2
      and contract in ('budgets','hats') order by tx_log_ordinal`, [end.chain_id, hash.toLowerCase()])).rows as Log[];
    const found = effect(change, budget, String(safe ?? ""), logs);
    if (!found) outcome = "failed";
    else if (typeof found === "string") bound = found;
  } else outcome = ended[end.outcome];
  const to = outcome ? "abandoned" : "applied";
  await sql.query("update app.budget_changes set state=$3,outcome=$4,settled_at=$5 where org_id=$1 and change_id=$2",
    [end.org_id, end.change_id, to, outcome, context.at]);
  if (change.kind === "create" && budget?.status === "proposed") {
    const status = outcome ? "abandoned" : "active";
    await sql.query(`update app.budgets set status=$3,budget_id=$4,key_claim=case when $3='abandoned' then null else key_claim end,
      updated_at=$5 where org_id=$1 and budget_ref=$2`, [end.org_id, budget.budget_ref, status, bound, context.at]);
    await transitioned(sql, "budget_transitioned", end.org_id, budget.budget_ref, context, { from: "proposed", to: status,
      transition: outcome ? "abandon" : "activate", budget_ref: budget.budget_ref, kind: budget.kind, budget_id: bound });
  }
  await transitioned(sql, "budget_change_transitioned", end.org_id, end.change_id, context, { from: "proposed", to,
    transition: outcome ? "abandon" : "apply", change_id: end.change_id, kind: change.kind, budget_ref: change.budget_ref,
    signer: change.signer, outcome });
  return { state: to, outcome, repeated: false };
}
