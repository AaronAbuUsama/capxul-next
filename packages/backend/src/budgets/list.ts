import { formatUnits, type Hex } from "viem";
import type { Sql } from "../platform/db.ts";
import { BUDGETS_ABI, caller, chainRead, ERC20_ABI, fail, PERIODS, type DepartmentServices, type People } from "./departments.ts";

/** budgets.departments.list: Capxul's departments, proposed or active, and budgets made outside Capxul, as the chain answers now. */
export async function listDepartments(sql: Sql, services: DepartmentServices, people: People, bearer: string, value: unknown) {
  const orgId = (value as { orgId?: unknown } | null)?.orgId;
  if (typeof orgId !== "string" || !orgId || Object.keys(value as object).some((k) => k !== "orgId")) return fail("INVALID_INPUT", "orgId");
  await caller(sql, bearer, orgId);
  const deployment = await services.deployment(sql, orgId);
  if (!deployment) return { items: [] };
  const safe = deployment.safe_address.toLowerCase(), { client } = services;
  // Allowances are budgets too, but `org allowance list` shows them; abandoned creates are left out.
  const indexed = (await sql.query(`select c.budget_id,c.parent_budget_id,c.token,c.hat_id,b.key,b.budget_ref,b.name,b.kind
    from app.chain_budgets c left join app.budgets b on b.org_id=$1 and b.budget_id=c.budget_id
    where c.company_safe=$2 and coalesce(b.kind,'department')='department' order by c.budget_id::numeric`, [orgId, safe])).rows;
  const proposed = (await sql.query(`select b.*,c.terms from app.budgets b join app.budget_changes c on c.org_id=b.org_id and c.change_id=b.created_change_id
    where b.org_id=$1 and b.status='proposed' and b.kind='department' order by b.budget_ref`, [orgId])).rows;
  const tokens = new Map<string, Promise<{ symbol: string; address: string; decimals: number }>>();
  const token = (address: string) => tokens.get(address) ?? tokens.set(address, chainRead(async () => ({ address,
    symbol: await client.readContract({ address: address as Hex, abi: ERC20_ABI, functionName: "symbol" }),
    decimals: await client.readContract({ address: address as Hex, abi: ERC20_ABI, functionName: "decimals" }) }))).get(address)!;
  const office = async (hat: string) => ({ hat, holders: await Promise.all((await sql.query(
    "select wearer from app.hat_wearers where hat_id=$1 and wearing order by wearer", [hat])).rows.map(async (w) =>
    ({ email: (await people.bySafe(w.wearer))?.email ?? null, safe: String(w.wearer) }))) });
  const active = await Promise.all(indexed.map(async (row) => {
    const id = BigInt(row.budget_id);
    const [b, left] = await chainRead(() => Promise.all([
      client.readContract({ address: services.budgets, abi: BUDGETS_ABI, functionName: "budgetOf", args: [id] }) as Promise<any>,
      client.readContract({ address: services.budgets, abi: BUDGETS_ABI, functionName: "leftOf", args: [id] }) as Promise<bigint>]));
    const t = await token(String(b.token).toLowerCase()), units = (v: bigint) => formatUnits(BigInt(v), t.decimals);
    return { key: row.key ?? null, id: row.budget_ref ?? null, budgetId: String(row.budget_id), name: row.name ?? null, kind: row.kind ?? null,
      status: "active" as const, parent: b.parent === 0n ? null : String(b.parent), token: t, period: PERIODS[Number(b.period)]!,
      amount: units(b.amount), childrenAmount: units(b.childrenAmount), spent: units(b.spent), committed: units(b.committed), left: units(left),
      closed: Boolean(b.closed), refillsAt: null, office: await office(String(row.hat_id)), offers: 0, runningAgreements: 0 };
  }));
  const planned = await Promise.all(proposed.map(async (row) => {
    const t = await token(row.token);
    return { key: row.key, id: row.budget_ref, budgetId: null, name: row.name, kind: row.kind, status: "proposed" as const,
      parent: row.parent_budget_id, token: t, period: row.period, amount: formatUnits(BigInt(row.terms.amount), t.decimals),
      childrenAmount: "0", spent: "0", committed: "0", left: "0", closed: false, refillsAt: null,
      office: await office(row.hat_id), offers: 0, runningAgreements: 0 };
  }));
  return { items: [...active, ...planned] };
}
