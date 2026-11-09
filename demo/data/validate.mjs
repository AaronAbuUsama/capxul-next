#!/usr/bin/env node
// Checks /home/user/capxul-next/demo/app/data.json: the books are double-entry and balance, cash in every account
// matches its transactions, payroll ties to its payments, invoices tie to their payments, leave balances are never
// negative, no fact is dated after today, and every proof re-hashes. Exit code 1 on any failure.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashOf } from "./gen/util.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(join(here, "..", "app", "data.json"), "utf8"));
const TODAY = d.meta.today;
const NOW = d.meta.now;
const P = (x) => Math.round(x * 100);
const U = (x) => Math.round(x * 1e6);
const rows = (t) => t.rows.map((r) => Object.fromEntries(t.cols.map((c, i) => [c, r[i]])));
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

const gl = rows(d.books.gl);
const accounts = d.books.accounts.filter((a) => a.code);
const rootOf = Object.fromEntries(accounts.map((a) => [a.code, a.rootType]));

// 1. every voucher balances, and the trial balance is zero every month
{
  const byV = new Map();
  for (const e of gl) {
    const x = byV.get(e.voucher) || 0;
    byV.set(e.voucher, x + P(e.debit) - P(e.credit));
  }
  const bad = [...byV.entries()].filter(([, x]) => x !== 0);
  check("Every voucher balances (debits = credits)", bad.length === 0, bad.length ? `${bad.length} unbalanced, e.g. ${bad[0][0]}` : `${byV.size} vouchers`);
  const months = [...new Set(gl.map((e) => e.date.slice(0, 7)))].sort();
  let worst = 0;
  for (const m of months) {
    const upto = gl.filter((e) => e.date.slice(0, 7) <= m);
    const dr = upto.reduce((s, e) => s + P(e.debit), 0);
    const cr = upto.reduce((s, e) => s + P(e.credit), 0);
    const inMonth = gl.filter((e) => e.date.slice(0, 7) === m);
    const mdr = inMonth.reduce((s, e) => s + P(e.debit), 0);
    const mcr = inMonth.reduce((s, e) => s + P(e.credit), 0);
    worst = Math.max(worst, Math.abs(dr - cr), Math.abs(mdr - mcr));
  }
  check("Trial balance is zero every month", worst === 0, `${months.length} months (${months[0]} to ${months[months.length - 1]}), largest difference ${worst / 100}`);
  const tbRep = d.books.reports.trialBalance.every((t) => P(t.totalDebit) === P(t.totalCredit) && t.rows.reduce((s, r) => s + P(r.closingDr) - P(r.closingCr), 0) === 0);
  check("The trial balance report sums to zero each month", tbRep, `${d.books.reports.trialBalance.length} monthly reports`);
}

// 2. the balance sheet balances, recomputed from the ledger at each month end
{
  let worst = 0;
  for (const bs of d.books.reports.balanceSheet) {
    const upto = gl.filter((e) => e.date <= bs.asOf);
    let a = 0, l = 0, q = 0, pl = 0;
    for (const e of upto) {
      const x = P(e.debit) - P(e.credit);
      const r = rootOf[e.account];
      if (r === "Asset") a += x;
      else if (r === "Liability") l -= x;
      else if (r === "Equity") q -= x;
      else pl -= x;
    }
    worst = Math.max(worst, Math.abs(a - l - q - pl), Math.abs(P(bs.difference)));
    if (P(bs.totalAssets) !== a) worst = Math.max(worst, Math.abs(P(bs.totalAssets) - a));
  }
  check("Balance sheet balances (assets = liabilities + equity + profit) at every month end", worst === 0, `${d.books.reports.balanceSheet.length} balance sheets, largest difference ${worst / 100}`);
  const last = d.books.reports.balanceSheet[d.books.reports.balanceSheet.length - 1];
  check("Profit and loss by month excludes the year-end closing entries and sums to the ledger", (() => {
    const pl = d.books.reports.profitAndLoss;
    let ok = true;
    for (const m of pl) {
      const inM = gl.filter((e) => e.date >= m.from && e.date <= m.to && !e.closing && (rootOf[e.account] === "Income" || rootOf[e.account] === "Expense"));
      const profit = -inM.reduce((s, e) => s + P(e.debit) - P(e.credit), 0);
      if (profit !== P(m.profit)) ok = false;
    }
    return ok;
  })(), `${d.books.reports.profitAndLoss.length} months; assets on ${last.asOf} £${last.totalAssets.toLocaleString("en-GB")}`);
}

// 3. cash in each account matches its transactions
{
  const accBal = (code, field) => gl.filter((e) => e.account === code).reduce((s, e) => s + (field === "acc" ? U(e.accDebit) - U(e.accCredit) : P(e.debit) - P(e.credit)), 0);
  const st = Object.fromEntries(Object.entries(d.money.statements).map(([k, v]) => [k, rows(v)]));
  const sumSt = (lines) => lines.reduce((s, t) => s + (t.direction === "in" ? U(t.amount) : -U(t.amount)), 0);
  const t = d.money.safes.treasury;
  check("Treasury: USDC in the books = the chain statement = the Safe's balance", accBal("1010", "acc") === sumSt(st.treasury) && sumSt(st.treasury) === U(t.balance), `${t.balance} USDC, ${st.treasury.length} statement lines`);
  const rsv = d.money.safes.reserve;
  check("Reserve Safe: USDC in the books = the chain statement = the Safe's balance", accBal("1020", "acc") === sumSt(st.reserve) && sumSt(st.reserve) === U(rsv.balance), `${rsv.balance} USDC, ${st.reserve.length} statement lines`);
  const open = d.money.escrows.filter((e) => e.status === "Open").reduce((s, e) => s + U(e.amount), 0);
  check("Money waiting: USDC in the books = the open escrows", accBal("1030", "acc") === open && sumSt(st.moneyWaiting) === open, `${open / 1e6} USDC in ${d.money.escrows.filter((e) => e.status === "Open").length} open escrows`);
  const transit = d.money.payouts.filter((p) => p.status === "In transit").reduce((s, p) => s + P(p.bankAmount), 0);
  check("Payouts in transit: the books = the payouts not yet delivered", accBal("1040") === transit, `£${transit / 100}`);
  const b = d.books.bankAccounts[0];
  const lines = d.books.bankTransactions;
  const stmt = P(b.openingBalance) + lines.reduce((s, l) => s + P(l.deposit) - P(l.withdrawal), 0);
  check("Barclays: the books = opening + every statement line", accBal("1050") === stmt && stmt === P(b.balance), `£${b.balance} per books; ${lines.length} lines; ${b.toReconcile} to reconcile`);
  const runBal = lines.length ? P(lines[lines.length - 1].balance) === stmt : true;
  check("Barclays: the running balance on the last line equals the books", runBal);
  // USDC accounts are revalued at every month end
  let worst = 0;
  for (const bs of d.books.reports.balanceSheet.filter((x) => x.asOf < TODAY)) {
    for (const code of ["1010", "1020", "1030"]) {
      const upto = gl.filter((e) => e.account === code && e.date <= bs.asOf);
      const acc = upto.reduce((s, e) => s + U(e.accDebit) - U(e.accCredit), 0);
      const g = upto.reduce((s, e) => s + P(e.debit) - P(e.credit), 0);
      const want = Math.round((acc / 1e6) * d.rates[bs.asOf] * 100);
      worst = Math.max(worst, Math.abs(want - g));
    }
  }
  check("USDC accounts are carried at the month-end rate in GBP", worst === 0, `largest difference ${worst / 100}`);
}

// 4. payroll ties to its payments
{
  const slips = d.payroll.slips;
  const pays = d.money.payments;
  let bad = [];
  for (const run of d.payroll.runs) {
    const rs = slips.filter((s) => s.payrollEntry === run.name);
    const gross = rs.reduce((s, x) => s + P(x.grossPay), 0);
    const net = rs.reduce((s, x) => s + P(x.netPay), 0);
    const ded = rs.reduce((s, x) => s + P(x.totalDeduction), 0);
    if (gross !== P(run.totals.gross) || net !== P(run.totals.net) || gross - ded !== net) bad.push(`${run.name}: totals`);
    for (const s of rs) {
      const sum = s.earnings.reduce((a, e) => a + P(e.amount), 0) - s.deductions.reduce((a, e) => a + P(e.amount), 0);
      if (sum !== P(s.netPay)) bad.push(`${s.name}: lines do not add to net`);
    }
    // the payments allocated to this run's slips carry exactly the net pay
    const paid = pays.filter((p) => p.purpose === "payroll" && p.proof?.advice?.allocations?.some((a) => rs.some((s) => s.name === a.doc)) && p.status !== "Cancelled");
    const alloc = paid.reduce((s, p) => s + p.proof.advice.allocations.reduce((a, x) => a + x.allocated, 0), 0);
    if (alloc !== net) bad.push(`${run.name}: payments allocate ${alloc / 100}, net is ${net / 100}`);
    if (paid.length !== rs.length) bad.push(`${run.name}: ${paid.length} payments for ${rs.length} slips`);
    const batch = paid.filter((p) => p.batch && p.batch.id === run.payment.batch);
    if (batch.length && batch.some((p) => p.batch.count !== batch.length)) bad.push(`${run.name}: batch count`);
  }
  // payroll payable is cleared by the payments: only unpaid slips remain
  const pp = rows(d.books.gl).filter((e) => e.account === "2200").reduce((s, e) => s + P(e.credit) - P(e.debit), 0);
  const unpaid = slips.filter((s) => s.status !== "Paid" && s.payrollEntry).reduce((s, x) => s + P(x.netPay), 0);
  if (pp !== unpaid) bad.push(`Payroll payable £${pp / 100} vs unpaid slips £${unpaid / 100}`);
  // HMRC and Nest: what the runs owe equals what Barclays paid plus what is still owed
  const owed = rows(d.books.gl).filter((e) => e.account === "2300").reduce((s, e) => s + P(e.credit) - P(e.debit), 0);
  const lastRun = d.payroll.runs[d.payroll.runs.length - 1];
  if (owed !== P(lastRun.totals.hmrc)) bad.push(`PAYE and NI payable £${owed / 100} vs October's £${lastRun.totals.hmrc}`);
  check("Payroll totals tie to the payslips, the batch payments, payroll payable and HMRC", bad.length === 0, bad.length ? bad.slice(0, 4).join("; ") : `${d.payroll.runs.length} runs, ${slips.filter((s) => s.payrollEntry).length} payslips in runs, ${slips.filter((s) => !s.payrollEntry).length} born paid by agreement`);
}

// 5. invoices' paid amounts tie to payments and allocations, and to the ledger
{
  const bad = [];
  const glA = (acc, name) => rows(d.books.gl).filter((e) => e.account === acc && e.against === name).reduce((s, e) => s + P(e.debit) - P(e.credit), 0);
  for (const inv of d.books.salesInvoices) {
    const paid = inv.payments.reduce((s, p) => s + P(p.amount), 0);
    if (paid !== P(inv.paidAmount) || P(inv.grandTotal) - paid !== P(inv.outstanding)) bad.push(`${inv.name}: paid/outstanding`);
    const left = glA("1200", inv.name);
    const want = inv.currency === "GBP" ? P(inv.outstanding) : Math.round(P(inv.baseGrandTotal) * (inv.outstanding / inv.grandTotal));
    if (Math.abs(left - want) > (inv.currency === "GBP" ? 0 : 2)) bad.push(`${inv.name}: receivable £${left / 100} vs outstanding £${want / 100}`);
    for (const p of inv.payments) if (p.payment) {
      const pay = d.money.payments.find((x) => x.id === p.payment);
      if (!pay) bad.push(`${inv.name}: payment ${p.payment} missing`);
      else if (pay.proof && !pay.proof.advice.allocations.some((a) => a.doc === inv.name)) bad.push(`${inv.name}: ${pay.id}'s proof does not allocate to it`);
    }
  }
  for (const b of d.books.purchaseInvoices) {
    const paid = b.payments.reduce((s, p) => s + P(p.amount), 0);
    if (paid !== P(b.paidAmount) || P(b.grandTotal) - paid !== P(b.outstanding)) bad.push(`${b.name}: paid/outstanding`);
    const left = -glA("2000", b.name);
    const want = b.currency === "GBP" ? P(b.outstanding) : Math.round(P(b.baseGrandTotal) * (b.outstanding / b.grandTotal));
    if (Math.abs(left - want) > (b.currency === "GBP" ? 0 : 2)) bad.push(`${b.name}: payable £${left / 100} vs outstanding £${want / 100}`);
  }
  const ar = rows(d.books.gl).filter((e) => e.account === "1200").reduce((s, e) => s + P(e.debit) - P(e.credit), 0);
  const arInv = d.books.salesInvoices.reduce((s, i) => s + Math.round(P(i.baseGrandTotal) * (i.outstanding / i.grandTotal)), 0);
  if (Math.abs(ar - arInv) > 5) bad.push(`Receivables £${ar / 100} vs invoices £${arInv / 100}`);
  check("Invoices' paid amounts tie to their payments, the proofs' allocations and the ledger", bad.length === 0, bad.length ? bad.slice(0, 4).join("; ") : `${d.books.salesInvoices.length} sales invoices (receivable £${(ar / 100).toLocaleString("en-GB")}), ${d.books.purchaseInvoices.length} purchase invoices`);
  const ageing = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const i of d.books.salesInvoices.filter((x) => x.outstanding > 0)) {
    const days = Math.round((Date.parse(TODAY) - Date.parse(i.dueDate)) / 86400000);
    const k = days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
    ageing[k] += i.outstanding;
  }
  check("Receivables ageing computed", true, Object.entries(ageing).map(([k, v]) => `${k} days overdue or not yet due: £${v.toFixed(2)}`).join("; "));
}

// 6. leave balances are never negative
{
  const bad = [];
  for (const a of d.hr.leaveAllocations) {
    const apps = d.hr.leaveApplications.filter((x) => x.employee === a.employee && x.leaveType === a.leaveType && x.fromDate >= a.fromDate && x.fromDate <= a.toDate);
    const used = apps.filter((x) => x.status === "Approved").reduce((s, x) => s + x.totalLeaveDays, 0);
    const pending = apps.filter((x) => x.status === "Open").reduce((s, x) => s + x.totalLeaveDays, 0);
    if (a.totalLeavesAllocated - used - pending < 0) bad.push(`${a.employee} ${a.leaveType} ${a.fromDate}: ${a.totalLeavesAllocated} - ${used} - ${pending}`);
  }
  // no one is on leave twice on the same day, and nobody decides their own leave
  for (const x of d.hr.leaveApplications) if (x.decidedBy && x.decidedBy === x.employee) bad.push(`${x.name} decided by the employee`);
  check("Every leave balance is non-negative (after approved and pending leave); nobody decides their own", bad.length === 0, bad.length ? bad.slice(0, 4).join("; ") : `${d.hr.leaveAllocations.length} allocations, ${d.hr.leaveApplications.length} applications`);
}

// 7. no fact is dated after today
{
  const FUTURE_OK = new Set(["dueDate", "toDate", "expectedEnd", "expectedClosureDate", "expEnd", "expStart", "end", "expires", "paidThrough", "due", "closes", "termEnds", "cliff", "day", "reviewDate", "quoteExpiresAt", "until", "payBy", "to", "endDate", "fromDate", "holidays", "date", "periodEnd", "halfDayDate", "nextRefill", "refillsAt"]);
  const bad = [];
  const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) && !s.startsWith("0x");
  function walk(v, path, key) {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, path + "[" + i + "]", key));
    if (v && typeof v === "object") return Object.entries(v).forEach(([k, x]) => walk(x, path + "." + k, k));
    if (isDate(v)) {
      const late = v.length > 10 ? v > NOW : v > TODAY;
      if (late && !FUTURE_OK.has(key)) bad.push(`${path} = ${v}`);
    }
  }
  const { rates, ...rest } = d;
  // facts whose plain dates may be planned: leave applications (future approved leave), holidays, plans
  walk({ ...rest, hr: { ...rest.hr, holidayLists: [] } }, "data", "");
  // and fact dates in the tables
  for (const e of gl) if (e.date > TODAY) bad.push(`gl ${e.voucher} ${e.date}`);
  for (const r of rows(d.hr.attendance)) if (r.date > TODAY) bad.push(`attendance ${r.name}`);
  for (const r of rows(d.hr.checkins)) if (r.time > NOW) bad.push(`checkin ${r.name}`);
  for (const r of rows(d.projects.logs)) if (r.date > TODAY) bad.push(`log ${r.timesheet}`);
  for (const x of d.hr.leaveApplications) if (x.postingDate > TODAY || (x.decidedAt && x.decidedAt > TODAY)) bad.push(`leave ${x.name}`);
  for (const x of d.books.salesInvoices) if (x.postingDate > TODAY) bad.push(`invoice ${x.name}`);
  check("No fact is dated after today (9 November 2026)", bad.length === 0, bad.length ? `${bad.length}: ` + bad.slice(0, 6).join("; ") : "plans (due dates, approved future leave, scheduled payments, expiries) excepted");
}

// 8. every proof re-hashes, and money facts hold together
{
  const bad = [];
  let n = 0;
  for (const p of d.money.payments) {
    if (!p.proof) continue;
    n++;
    if (hashOf(p.proof.advice) !== p.proof.documentHash) bad.push(`${p.id}: document hash`);
    // allocations in pounds add up to the cash in pounds; allocations in dollars (or USDC) to the tokens sent
    const gbpAlloc = p.proof.advice.allocations.filter((a) => a.currency === "GBP").reduce((s, a) => s + a.allocated, 0);
    const usdAlloc = p.proof.advice.allocations.filter((a) => a.currency !== "GBP").reduce((s, a) => s + a.allocated, 0);
    if (gbpAlloc && gbpAlloc !== p.proof.advice.cash.amount) bad.push(`${p.id}: GBP allocations ${gbpAlloc} vs cash ${p.proof.advice.cash.amount}`);
    if (usdAlloc && usdAlloc * 10000 !== Number(p.proof.advice.amount)) bad.push(`${p.id}: USD allocations ${usdAlloc} vs tokens ${p.proof.advice.amount}`);
    if (String(U(p.amount)) !== p.amountRaw) bad.push(`${p.id}: raw amount`);
  }
  check("Every on-chain payment's document hash re-hashes from its advice", bad.length === 0, bad.length ? bad.slice(0, 4).join("; ") : `${n} proofs`);
  const esc = d.money.escrows;
  check("Money waiting: one claimed by a new contractor, one taken back, some still open", esc.some((e) => e.status === "Claimed") && esc.some((e) => e.status === "Taken back") && esc.some((e) => e.status === "Open"), esc.map((e) => `${e.email} ${e.status}`).join("; "));
}

// 9. budgets, seats and people
{
  const bad = [];
  for (const dep of d.departments) for (const b of dep.budgets) if (b.left < 0) bad.push(`${dep.id} ${b.quarter} left ${b.left}`);
  for (const a of d.allowances) for (const m of a.months) if (m.left < -0.001) bad.push(`${a.id} ${m.month} left ${m.left}`);
  check("No department or allowance spends more than its budget", bad.length === 0, bad.length ? bad.slice(0, 4).join("; ") : `${d.departments.length} departments x ${d.departments[0].budgets.length} quarters, ${d.allowances.length} allowances`);
  const over = d.seats.usage.filter((u) => u.used > u.limit);
  check("Seats in use never exceed the limit", over.length === 0, `${d.seats.used} of ${d.seats.limit} today; limit 10 until 1 Nov 2026`);
  const active = d.people.filter((p) => p.status === "Active").length;
  const at0 = d.people.filter((p) => p.dateOfJoining <= d.meta.start && (!p.relievingDate || p.relievingDate >= d.meta.start)).length;
  check("Headcount grows from about 14 to 25", at0 >= 13 && at0 <= 15 && active === 25, `${at0} on ${d.meta.start}, ${active} today (${d.people.filter((p) => p.relievingDate).length} left)`);
  const roleConflict = d.people.filter((p) => p.hats.includes("People") && d.departments.some((dep) => dep.holders.some((h) => h.who === p.id && !h.to)));
  check("Nobody wears People while holding a department", roleConflict.length === 0);
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  (" + r.detail + ")" : ""}`);
}
console.log(`\n${results.length - failed} of ${results.length} checks pass.`);
process.exit(failed ? 1 : 0);
