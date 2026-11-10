// The books: Harbourline's chart of accounts and a double-entry ledger in pence (GBP), with each USDC account also
// carrying its own amount in micro-USDC. Every voucher must balance before it is accepted.
import { gbp, usdc, monthEnd, addMonths, monthStart, months, ms } from "./util.mjs";

// code, name, rootType, accountType, currency, parent (group name), role
export const CHART = [
  ["Assets", null, "Asset", "Group", null, null],
  ["1010", "Treasury · USDC", "Asset", "Bank", "USDC", "Assets", "safe"],
  ["1020", "Reserve Safe · USDC", "Asset", "Bank", "USDC", "Assets", "safe"],
  ["1030", "Money waiting · USDC", "Asset", "Bank", "USDC", "Assets", "escrow"],
  ["1040", "Payouts in transit · GBP", "Asset", "Bank", "GBP", "Assets", "bridge"],
  ["1050", "Barclays Business · GBP", "Asset", "Bank", "GBP", "Assets", "bank"],
  ["1200", "Accounts receivable", "Asset", "Receivable", "GBP", "Assets", "receivable"],
  ["1300", "Prepayments", "Asset", "", "GBP", "Assets", null],
  ["1400", "Employee advances", "Asset", "", "GBP", "Assets", null],
  ["1500", "Equipment", "Asset", "Fixed Asset", "GBP", "Assets", null],
  ["1510", "Accumulated depreciation", "Asset", "Accumulated Depreciation", "GBP", "Assets", null],
  ["Liabilities", null, "Liability", "Group", null, null],
  ["2000", "Accounts payable", "Liability", "Payable", "GBP", "Liabilities", "payable"],
  ["2100", "VAT", "Liability", "Group", "GBP", "Liabilities", null],
  ["2101", "VAT on sales", "Liability", "Tax", "GBP", "2100", null],
  ["2102", "VAT on purchases", "Liability", "Tax", "GBP", "2100", null],
  ["2200", "Payroll payable", "Liability", "Payable", "GBP", "Liabilities", "salaries-payable"],
  ["2300", "PAYE and NI payable", "Liability", "", "GBP", "Liabilities", null],
  ["2400", "Pensions payable", "Liability", "", "GBP", "Liabilities", null],
  ["2500", "Accruals", "Liability", "", "GBP", "Liabilities", null],
  ["2600", "Expense claims payable", "Liability", "Payable", "GBP", "Liabilities", null],
  ["2700", "Corporation tax", "Liability", "Tax", "GBP", "Liabilities", null],
  ["Equity", null, "Equity", "Group", null, null],
  ["3000", "Share capital", "Equity", "Equity", "GBP", "Equity", null],
  ["3100", "Retained earnings", "Equity", "Equity", "GBP", "Equity", null],
  ["3200", "Share premium", "Equity", "Equity", "GBP", "Equity", null],
  ["3300", "SAFEs awaiting conversion", "Equity", "Equity", "GBP", "Equity", null],
  ["3990", "Opening balances", "Equity", "Temporary", "GBP", "Equity", "opening"],
  ["Income", null, "Income", "Group", null, null],
  ["4000", "Engineering services", "Income", "Income Account", "GBP", "Income", null],
  ["4100", "Design services", "Income", "Income Account", "GBP", "Income", null],
  ["4200", "Retainers", "Income", "Income Account", "GBP", "Income", null],
  ["4999", "Income, not decided", "Income", "Income Account", "GBP", "Income", "income-undecided"],
  ["Expenses", null, "Expense", "Group", null, null],
  ["Cost of services", null, "Expense", "Group", null, "Expenses"],
  ["5000", "Salaries and wages", "Expense", "Expense Account", "GBP", "Cost of services", "salaries"],
  ["5010", "Employer's National Insurance", "Expense", "Expense Account", "GBP", "Cost of services", null],
  ["5020", "Employer's pension contributions", "Expense", "Expense Account", "GBP", "Cost of services", null],
  ["5100", "Contractors", "Expense", "Expense Account", "GBP", "Cost of services", null],
  ["5200", "Cloud and computing", "Expense", "Expense Account", "GBP", "Cost of services", null],
  ["Operating expenses", null, "Expense", "Group", null, "Expenses"],
  ["6100", "Rent and premises", "Expense", "Expense Account", "GBP", "Operating expenses", null],
  ["6200", "Software and subscriptions", "Expense", "Expense Account", "GBP", "Operating expenses", null],
  ["6300", "Travel", "Expense", "Expense Account", "GBP", "Operating expenses", null],
  ["6400", "Events and conferences", "Expense", "Expense Account", "GBP", "Operating expenses", null],
  ["6500", "Bank charges", "Expense", "Chargeable", "GBP", "Operating expenses", "bank-charges"],
  ["6510", "Exchange gain or loss", "Expense", "Expense Account", "GBP", "Operating expenses", "exchange"],
  ["6600", "Professional fees", "Expense", "Expense Account", "GBP", "Operating expenses", null],
  ["6700", "Insurance", "Expense", "Expense Account", "GBP", "Operating expenses", null],
  ["6800", "Depreciation", "Expense", "Depreciation", "GBP", "Operating expenses", null],
  ["6900", "Office and sundry", "Expense", "Expense Account", "GBP", "Operating expenses", null],
  ["6950", "Corporation tax", "Expense", "Tax", "GBP", "Operating expenses", null],
  ["6999", "Expense, not decided", "Expense", "Expense Account", "GBP", "Operating expenses", "expense-undecided"],
];

export const USDC_ACCOUNTS = ["1010", "1020", "1030"];

export class Ledger {
  constructor() {
    this.accounts = new Map();
    for (const row of CHART) {
      if (row[1] === null) continue;
      const [code, name, root, type, currency, parent, role] = row;
      this.accounts.set(code, { code, name, root, type, currency, parent, role: role || null });
    }
    this.vouchers = [];
    this.entries = [];
  }
  root(code) {
    return this.accounts.get(code).root;
  }
  // v: {date, type, title, remarks, lines:[{account, dr, cr, accDr, accCr, party, partyType, cc, project, against}], closing}
  post(v) {
    let dr = 0;
    let cr = 0;
    for (const l of v.lines) {
      if (!this.accounts.has(l.account)) throw new Error(`Unknown account ${l.account} in ${v.type} ${v.title}`);
      l.dr = Math.round(l.dr || 0);
      l.cr = Math.round(l.cr || 0);
      if (l.dr < 0) { l.cr -= l.dr; l.dr = 0; }
      if (l.cr < 0) { l.dr -= l.cr; l.cr = 0; }
      dr += l.dr;
      cr += l.cr;
    }
    if (dr !== cr) throw new Error(`Unbalanced ${v.type} on ${v.date} (${v.title}): dr ${dr} cr ${cr} ${JSON.stringify(v.lines)}`);
    v.lines = v.lines.filter((l) => l.dr || l.cr || l.accDr || l.accCr);
    v.total = dr;
    this.vouchers.push(v);
    for (const l of v.lines) {
      const acc = this.accounts.get(l.account);
      if (acc.currency === "USDC" && l.accDr === undefined && l.accCr === undefined && !v.revaluation) {
        throw new Error(`USDC line without USDC amount in ${v.type} ${v.title}`);
      }
      this.entries.push({ v, ...l });
    }
    return v;
  }
  balances(upTo, opts = {}) {
    // GBP balance (dr - cr) and account-currency balance per account, on or before upTo
    const b = new Map();
    for (const e of this.entries) {
      if (e.v.date > upTo) continue;
      if (opts.from && e.v.date < opts.from) continue;
      if (opts.excludeClosing && e.v.closing) continue;
      const x = b.get(e.account) || { gbp: 0, acc: 0 };
      x.gbp += e.dr - e.cr;
      x.acc += (e.accDr || 0) - (e.accCr || 0);
      b.set(e.account, x);
    }
    return b;
  }
}

export function chartForOutput(ledger) {
  const out = [];
  for (const row of CHART) {
    const [code, name, root, type, currency, parent, role] = row;
    if (name === null) {
      // a type group or a named group
      out.push({ code: null, name: code, rootType: root, isGroup: true, parent: type === "Group" && parent ? null : null, group: parent || null });
    } else {
      out.push({ code, name, rootType: root, accountType: type === "Group" ? "" : type, isGroup: type === "Group", currency, parent, role: role || null });
    }
  }
  return out;
}

// Monthly reports from the ledger: trial balance, profit and loss, balance sheet.
export function buildReports(ledger, firstMonth, lastMonthEnd, today) {
  const ends = months(firstMonth, lastMonthEnd).map((m) => monthEnd(m));
  if (today > ends[ends.length - 1]) ends.push(today);
  const pl = new Set([...ledger.accounts.values()].filter((a) => a.root === "Income" || a.root === "Expense").map((a) => a.code));
  const trialBalance = [];
  const profitAndLoss = [];
  const balanceSheet = [];
  for (const end of ends) {
    const start = monthStart(end);
    // trial balance for the month: opening, debit, credit, closing per account
    const open = ledger.balances(prevDay(start));
    const close = ledger.balances(end);
    const rows = [];
    let td = 0;
    let tc = 0;
    for (const a of ledger.accounts.values()) {
      const o = open.get(a.code)?.gbp || 0;
      const c = close.get(a.code)?.gbp || 0;
      let dr = 0;
      let cr = 0;
      for (const e of ledger.entries) {
        if (e.account !== a.code || e.v.date < start || e.v.date > end) continue;
        dr += e.dr;
        cr += e.cr;
      }
      if (!o && !c && !dr && !cr) continue;
      td += dr;
      tc += cr;
      rows.push({ account: a.code, openingDr: o > 0 ? gbp(o) : 0, openingCr: o < 0 ? gbp(-o) : 0, debit: gbp(dr), credit: gbp(cr), closingDr: c > 0 ? gbp(c) : 0, closingCr: c < 0 ? gbp(-c) : 0 });
    }
    trialBalance.push({ month: end.slice(0, 7), from: start, to: end, rows, totalDebit: gbp(td), totalCredit: gbp(tc) });
    // profit and loss for the month (closing entries excluded)
    const mv = ledger.balances(end, { from: start, excludeClosing: true });
    const lines = [];
    let income = 0;
    let expense = 0;
    for (const code of pl) {
      const x = mv.get(code)?.gbp || 0;
      if (!x) continue;
      const a = ledger.accounts.get(code);
      const amount = a.root === "Income" ? -x : x;
      if (a.root === "Income") income += amount;
      else expense += amount;
      lines.push({ account: code, amount: gbp(amount) });
    }
    profitAndLoss.push({ month: end.slice(0, 7), from: start, to: end, lines, income: gbp(income), expense: gbp(expense), profit: gbp(income - expense) });
    // balance sheet as at the month end
    const bs = { asOf: end, assets: [], liabilities: [], equity: [] };
    let assets = 0;
    let liabilities = 0;
    let equity = 0;
    let unclosed = 0;
    for (const a of ledger.accounts.values()) {
      const x = close.get(a.code)?.gbp || 0;
      if (a.root === "Income" || a.root === "Expense") {
        unclosed -= x;
        continue;
      }
      if (!x) continue;
      if (a.root === "Asset") {
        assets += x;
        bs.assets.push({ account: a.code, amount: gbp(x) });
      } else if (a.root === "Liability") {
        liabilities -= x;
        bs.liabilities.push({ account: a.code, amount: gbp(-x) });
      } else {
        equity -= x;
        bs.equity.push({ account: a.code, amount: gbp(-x) });
      }
    }
    bs.profitForPeriod = gbp(unclosed);
    bs.totalAssets = gbp(assets);
    bs.totalLiabilities = gbp(liabilities);
    bs.totalEquity = gbp(equity + unclosed);
    bs.difference = gbp(assets - liabilities - equity - unclosed);
    balanceSheet.push(bs);
  }
  return { trialBalance, profitAndLoss, balanceSheet };
}

function prevDay(d) {
  return new Date(ms(d) - 86400000).toISOString().slice(0, 10);
}
