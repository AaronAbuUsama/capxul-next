#!/usr/bin/env node
// Generates /home/user/capxul-next/demo/app/data.json: Harbourline Studio Ltd, a 25-person design and engineering
// studio, running on Capxul from 1 May 2025 to "today", 9 November 2026. Deterministic: a seeded random generator,
// no dependencies. Run: node demo/data/generate.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  rng, SEED, TODAY, NOW, START, addDays, months, monthEnd, quarterEnd, at, P, U, gbp, usdc, sum, r2, ms, iso, hashOf, address, Series, table, eachDay,
} from "./gen/util.mjs";
import { COMPANY, PEOPLE, OTHERS, DEPARTMENTS, ALLOWANCES, OFFICER_HATS, DIRECTORS, AGENTS, CUSTOMERS, SUPPLIERS, PROJECTS, RETAINERS, FIXED_FEES, BANK, RATE_ANCHORS } from "./gen/world.mjs";
import { Ledger, chartForOutput, buildReports, USDC_ACCOUNTS } from "./gen/ledger.mjs";
import { buildHR, buildClaims, finishAdvances, EXPENSE_TYPES, isWorking } from "./gen/hr.mjs";
import { buildPayroll, finishPayroll } from "./gen/payroll.mjs";
import { buildProjects, finishProjects } from "./gen/projects.mjs";
import { buildSales, finishSales } from "./gen/sales.mjs";
import { buildPurchases, finishPurchases } from "./gen/purchases.mjs";
import { CashBook } from "./gen/money.mjs";
import { buildBudgets, payoutCeiling, buildBoard, buildEquity, buildSeats, buildAgents } from "./gen/governance.mjs";
import { buildCRM, finishCRM } from "./gen/crm.mjs";
import { buildFDE, buildApprovals, buildNotices, buildEvents, buildActivity } from "./gen/feed.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "app", "data.json");
const REF = Symbol("ref");
const mark = (o, kind) => { if (o && typeof o === "object") Object.defineProperty(o, REF, { value: kind, enumerable: false }); return o; };

// ---------- context ----------
const ctx = { series: new Series(), ledger: new Ledger(), assets: [], scheduled: [], advanceRecoveries: [], boardActions: [] };
const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
ctx.people = PEOPLE.map((p, i) => ({ ...p, emp: "HR-EMP-" + String(i + 1).padStart(5, "0"), name: `${p.first} ${p.last}`, email: `${strip(p.first)}@${COMPANY.domain}` }));
ctx.others = OTHERS.map((o) => ({ ...o, name: `${o.first} ${o.last}` }));
ctx.departments = DEPARTMENTS;
ctx.allowances = ALLOWANCES;
ctx.officerHats = OFFICER_HATS;
ctx.directors = DIRECTORS;
ctx.agents = AGENTS;
ctx.customers = CUSTOMERS;
ctx.suppliers = SUPPLIERS;
ctx.projectsDef = PROJECTS;
ctx.retainers = RETAINERS;
ctx.fixedFees = FIXED_FEES;
ctx.hashOf = hashOf;

// rates: GBP per USDC, daily, interpolated between the anchors with a little noise; today is exact
const rateMap = new Map();
{
  const rr = rng("rates");
  for (let i = 0; i < RATE_ANCHORS.length - 1; i++) {
    const [a, ra] = RATE_ANCHORS[i];
    const [b, rb] = RATE_ANCHORS[i + 1];
    const days = eachDay(a, addDays(b, -1));
    days.forEach((d, k) => {
      const base = ra + ((rb - ra) * k) / days.length;
      const noise = d === TODAY ? 0 : rr.float(-0.0018, 0.0018);
      rateMap.set(d, Math.round((base + noise) * 10000) / 10000);
    });
  }
  rateMap.set(TODAY, 0.7893);
}
ctx.rate = (d) => {
  const r = rateMap.get(d.slice(0, 10));
  if (!r) throw new Error("no rate for " + d);
  return r;
};

const person = (id) => ctx.people.find((p) => p.id === id) || ctx.others.find((p) => p.id === id);
ctx.personName = (id) => {
  if (!id) return "";
  if (id === "board") return "the Board";
  if (id.startsWith("@")) return id;
  const p = person(id);
  return p ? p.name : id;
};
ctx.emailOf = (id) => {
  if (!id) return null;
  if (id.startsWith("@")) return id;
  const p = person(id);
  return p.email || null;
};
const within = (h, d) => h.from <= d && (!h.to || d < h.to);
ctx.holdersOf = (dept, d) => {
  const dep = DEPARTMENTS.find((x) => x.id === dept) || ALLOWANCES.find((x) => x.id === dept);
  return dep ? dep.holders.filter((h) => within(h, d)).map((h) => h.who) : [];
};
ctx.officerHolders = (hat, d) => OFFICER_HATS[hat].filter((h) => within(h, d)).map((h) => h.who);
ctx.deptName = (id) => (DEPARTMENTS.find((x) => x.id === id) || {}).name || id;
ctx.ccOf = (id) => (id === "harbourline" ? "Main" : ctx.deptName(id));
ctx.budgetName = (id) => {
  if (!id) return "";
  if (id === "board") return "the Board (Treasury)";
  const a = ALLOWANCES.find((x) => x.id === id);
  if (a) return `${a.name} allowance`;
  return ctx.deptName(id);
};
ctx.signerFor = (budget, d, preparedBy) => {
  if (budget === "board") return { who: "board", hat: "Board" };
  if (!budget) return { who: "maya", hat: "Director" };
  const holders = ctx.holdersOf(budget, d);
  const people_ = holders.filter((h) => !h.startsWith("@"));
  if (preparedBy && holders.includes(preparedBy)) return { who: preparedBy, hat: ctx.budgetName(budget) };
  if (people_.length) return { who: people_[0], hat: ctx.budgetName(budget) };
  if (holders.length) return { who: holders[0], hat: ctx.budgetName(budget) };
  return { who: "maya", hat: "Harbourline" };
};
ctx.budgetDecider = (dept, d, employee) => {
  const h = ctx.holdersOf(dept, d).filter((x) => x !== employee && !x.startsWith("@"));
  if (h.length) return { who: h[0], hat: ctx.deptName(dept) };
  const top = ctx.holdersOf("harbourline", d).filter((x) => x !== employee);
  if (top.length) return { who: top[0], hat: "Harbourline" };
  return { who: ctx.officerHolders("people", d)[0], hat: "People" };
};
ctx.hatsOf = (id, d) => {
  const hats = [];
  if (DIRECTORS.some((x) => x.who === id && x.from <= d)) hats.push("Director");
  for (const dep of DEPARTMENTS) if (dep.holders.some((h) => h.who === id && within(h, d))) hats.push(dep.name);
  for (const a of ALLOWANCES) if (a.holders.some((h) => h.who === id && within(h, d))) hats.push(`${a.name} allowance`);
  for (const [hat, hs] of Object.entries(OFFICER_HATS)) if (hs.some((h) => h.who === id && within(h, d))) hats.push(hat[0].toUpperCase() + hat.slice(1));
  return hats;
};
ctx.departmentsHeld = (id, d) => DEPARTMENTS.filter((dep) => dep.holders.some((h) => h.who === id && within(h, d))).map((x) => x.id);
const addrCache = new Map();
ctx.safeOf = (id) => {
  if (!addrCache.has(id)) addrCache.set(id, address(rng("safe-" + id)));
  return addrCache.get(id);
};
ctx.customerSafe = (c) => ctx.safeOf("cust-" + c.id);
ctx.supplierSafe = (s) => ctx.safeOf("supp-" + s.id);
ctx.partyOfCompany = hashOf({ party: "@harbourline" }).slice(0, 42);
ctx.safes = {
  treasury: { address: "0x4A1f6B2c93D0e7A5f18C4b2E9a7d3F60c11b9c2E", label: "Treasury" },
  reserve: { address: "0x7Be93c0A15d4F2e8b6C1a9D3f05E2b7C48d61a3F", label: "Reserve Safe" },
};
ctx.payeeOfPerson = (p) => ({
  type: "Employee", id: p.id, name: p.name, email: p.personal, safe: p.paidTo === "safe" ? ctx.safeOf(p.id) : null,
  party: hashOf({ party: p.personal }).slice(0, 42), bank: p.bank ? { bankName: p.bank[0], last4: p.bank[1].slice(-4), sortCode: p.bank[2] } : null,
});
ctx.cash = new CashBook(ctx);

// ---------- HR, projects, sales, purchases, claims, payroll, equity ----------
const hr = buildHR(ctx);
ctx.checkedInToday = new Set(hr.checkins.filter((c) => c.date === TODAY).map((c) => c.employee));
ctx.hrApps = hr.leaveApplications;
ctx.hrAllocs = hr.leaveAllocations;
ctx.leaveDetails = (emp, d) => {
  const allocs = hr.leaveAllocations.filter((a) => a.employee === emp && a.fromDate <= d && a.toDate >= d);
  return allocs.map((a) => {
    const apps = hr.leaveApplications.filter((x) => x.employee === emp && x.leaveType === a.leaveType && x.fromDate >= a.fromDate && x.fromDate <= a.toDate);
    const used = sum(apps.filter((x) => x.status === "Approved" && x.fromDate <= d), (x) => x.totalLeaveDays);
    const pending = sum(apps.filter((x) => x.status === "Open"), (x) => x.totalLeaveDays);
    return { leaveType: a.leaveType, totalAllocated: a.totalLeavesAllocated, expired: 0, used, pending, available: r2(a.totalLeavesAllocated - used) };
  });
};
const pj = buildProjects(ctx);
ctx.logs = pj.logs;
const salesInvoices = buildSales(ctx);
ctx.salesInvoices = salesInvoices;
const purchaseInvoices = buildPurchases(ctx);
ctx.purchaseInvoices = purchaseInvoices;
const { claims, advances } = buildClaims(ctx);
const payroll = buildPayroll(ctx);
const equity = buildEquity(ctx);

// ---------- opening balances, 30 April 2025 ----------
const L = ctx.ledger;
const openBarclays = P(212400);
{
  const april = PEOPLE.filter((p) => p.joined < START && p.type !== "Contract");
  const { computeSlip } = await import("./gen/payroll.mjs");
  let paye = 0;
  let pens = 0;
  for (const p of april) {
    const s = computeSlip(p.base);
    paye += P(s.paye) + P(s.ni) + P(s.erni);
    pens += P(s.pen) + P(s.erpen);
  }
  ctx.openingPayroll = { paye, pens };
  const lines = [
    { account: "1050", dr: openBarclays },
    { account: "1500", dr: P(21600) },
    { account: "1510", cr: P(5400) },
    { account: "2101", cr: P(16680) },
    { account: "2102", dr: P(2950) },
    { account: "2300", cr: paye },
    { account: "2400", cr: pens },
    { account: "3000", cr: P(850) },
  ];
  const dr = sum(lines, (l) => l.dr || 0);
  const cr = sum(lines, (l) => l.cr || 0);
  lines.push({ account: "3990", cr: dr - cr });
  L.post({ date: "2025-04-30", type: "Journal Entry", entryType: "Opening Entry", title: "Opening balances from the old books, 30 April 2025", lines });
  // the opening invoices and bill posted to 3990; close 3990 into retained earnings
  const b3990 = L.balances("2025-04-30").get("3990").gbp;
  L.post({ date: "2025-04-30", type: "Journal Entry", entryType: "Opening Entry", title: "Opening balances closed to retained earnings", lines: [{ account: "3990", dr: b3990 < 0 ? -b3990 : 0, cr: b3990 > 0 ? b3990 : 0 }, { account: "3100", cr: b3990 < 0 ? -b3990 : 0, dr: b3990 > 0 ? b3990 : 0 }] });
  // PAYE, NI and pensions for April 2025, owed at the move
  ctx.cash.add({ kind: "bank_out", time: at("2025-05-22", 7, 30), amount: { gbp: paye }, bankText: "HMRC PAYE 120PB0047202504", title: "PAYE and NI for 2025-04 (from the old payroll)", party: "hmrc", partyType: "Supplier", counter: [{ account: "2300", dr: paye }], voucherType: "Journal Entry", entryType: "Bank Entry", purpose: "tax", ref: "PAYE 2025-04" });
  ctx.cash.add({ kind: "bank_out", time: at("2025-05-19", 6, 10), amount: { gbp: pens }, bankText: "DD NEST PENSIONS HARBOURLINE 202504", title: "Pensions for 2025-04 (from the old payroll)", party: "nest", partyType: "Supplier", counter: [{ account: "2400", dr: pens }], voucherType: "Journal Entry", entryType: "Bank Entry", purpose: "pension", ref: "Nest 2025-04" });
  // VAT for January to March 2025, from the old books
  ctx.cash.add({ kind: "bank_out", time: at("2025-05-07", 7, 0), amount: { gbp: P(10240) }, bankText: "HMRC VAT 412883061 2503", title: "VAT return January to March 2025", party: "hmrc", partyType: "Supplier", counter: [{ account: "2101", dr: P(12890) }, { account: "2102", cr: P(2650) }], voucherType: "Journal Entry", entryType: "Bank Entry", purpose: "vat", ref: "VAT 03/25" });
}

// VAT returns: each calendar quarter, paid on the 7th of the second month after it, from Barclays
const vatReturns = [];
{
  let clearedS = P(12890);
  let clearedP = P(2650);
  for (const q of ["2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3"]) {
    const end = quarterEnd(q);
    const b = L.balances(end);
    const sOut = -(b.get("2101")?.gbp || 0) - clearedS;
    const pIn = (b.get("2102")?.gbp || 0) - clearedP;
    let pd = iso(Date.parse(end) + 86400000 * 38).slice(0, 8) + "07";
    while (!isWorking(pd)) pd = addDays(pd, 1);
    if (pd > TODAY) continue;
    const net = sOut - pIn;
    clearedS += sOut;
    clearedP += pIn;
    vatReturns.push({ quarter: q, periodEnd: end, paidOn: pd, sales: sOut, purchases: pIn, net });
    ctx.cash.add({ kind: "bank_out", time: at(pd, 7, 0), amount: { gbp: net }, bankText: `HMRC VAT 412883061 ${end.slice(2, 4)}${end.slice(5, 7)}`, title: `VAT return ${q}`, party: "hmrc", partyType: "Supplier", counter: [{ account: "2101", dr: sOut }, { account: "2102", cr: pIn }], voucherType: "Journal Entry", entryType: "Bank Entry", purpose: "vat", ref: `VAT ${end.slice(5, 7)}/${end.slice(2, 4)}` });
  }
}

// ---------- top-ups the finance people make ----------
let topupN = 0;
ctx.topupBarclays = (d, bal, need) => {
  const want = Math.max(P(30000), Math.ceil((need + P(25000) - bal.barclays) / P(10000)) * P(10000));
  topupN++;
  return { kind: "payout", time: at(d, 4, 10 + (topupN % 20)), amount: { gbp: want }, budget: "harbourline", purpose: "transfer", memo: "Top up Barclays for HMRC, Nest and the card",
    payee: { type: "Self", id: "barclays", name: "Harbourline Studio Ltd (Barclays ·· 4417)", bank: { bankName: "Barclays", last4: "4417", sortCode: "20-45-77" } },
    payout: { status: "Delivered", deliverAt: at(d, 4, 14 + (topupN % 20)), rail: "Faster Payments" }, voucherType: "Payment Entry", paymentType: "Internal Transfer" };
};
ctx.topupTreasury = (d, bal, need, floor) => {
  const gap = need + floor - bal.treasury;
  if (bal.reserve >= gap + U(10000) && bal.reserve >= U(100000)) {
    const amt = Math.min(bal.reserve, Math.max(U(200000), Math.ceil(gap / U(50000)) * U(50000)));
    const ev = { kind: "safe_transfer", from: "reserve", to: "treasury", time: at(d, 3, 5), amount: { usdc: amt }, purpose: "transfer", memo: `Move ${usdc(amt).toLocaleString("en-GB")} USDC from the Reserve Safe to the Treasury`, budget: "board" };
    ctx.boardActions.push({ at: at(addDays(d, -1), 16, 30), title: `Move ${usdc(amt).toLocaleString("en-GB", { minimumFractionDigits: 2 })} USDC from the Reserve Safe to the Treasury`, kind: "Transaction", calls: [`USDC.transfer(Treasury, ${usdc(amt).toFixed(2)}) from the Reserve Safe`], note: "Top up the Treasury for payroll and suppliers", proposedBy: "maya", status: "Executed", ev, why: "Money leaves a Safe only by Board proposal or a budget; the Reserve Safe has no budgets" });
    return ev;
  }
  const gbpNeed = Math.ceil(((gap / 1e6) * ctx.rate(d) * 100) / P(10000)) * P(10000) + P(10000);
  if (bal.barclays - gbpNeed > P(15000)) {
    return { kind: "deposit", time: at(d, 3, 40), amount: { gbp: gbpNeed }, purpose: "transfer", deposit: { status: "Credited", creditAt: at(d, 3, 44), sender: "HARBOURLINE STUDIO LTD", reference: "TREASURY", rail: "Faster Payments", match: "Not a request", currency: "GBP", fromBarclays: true },
      payer: { name: "Harbourline Studio Ltd (Barclays)" }, counter: [{ account: "1050", cr: gbpNeed }] };
  }
  return null;
};

// ---------- the other Board actions ----------
const BA = (at_, title, o = {}) => ctx.boardActions.push({ at: at_, title, kind: "Transaction", status: "Executed", proposedBy: "maya", ...o });
BA("2025-05-01T09:20:00Z", "Create the Harbourline department (top) and set the USDC payout ceiling to 1,800,000 a year", { calls: ["Budgets.create(Harbourline, top, quarter)", "Roles: set the USDC payout ceiling to 1,800,000.00 a year"] });
BA("2025-05-01T09:40:00Z", "Grant People to Sam Whitfield; Books and Invoicing to Maya Okafor", { calls: ["Hats.mint(People, Sam Whitfield)", "Hats.mint(Books, Maya Okafor)", "Hats.mint(Invoicing, Maya Okafor)"] });
BA("2025-06-02T10:15:00Z", "Grant People to Kwame Mensah; move Books from Maya Okafor to Kwame Mensah; grant Invoicing to Kwame Mensah", { calls: ["Hats.mint(People, Kwame Mensah)", "Hats.transfer(Books, Maya Okafor → Kwame Mensah)", "Hats.mint(Invoicing, Kwame Mensah)"] });
BA("2025-07-01T09:30:00Z", "Create the Subscriptions allowance (1,200 USDC a month, under Operations) for @kwame-ops", { calls: ["Budgets.create(Subscriptions, under Operations, 1,200.00/month)", "Hats.mint(Subscriptions, @kwame-ops)"] });
BA("2025-07-01T09:45:00Z", "Create the Capxul allowance (200 USDC a month, under Operations) for Kwame Mensah", { calls: ["Budgets.create(Capxul, under Operations, 200.00/month)", "Hats.mint(Capxul, Kwame Mensah)"], why: "Kwame wears People, so he cannot hold a department; seats and the FDE are paid from an allowance he holds" });
BA("2025-09-01T09:00:00Z", "Seat Tom Ashworth as a Director; threshold 1 → 2", { calls: ["Safe.addOwnerWithThreshold(Tom Ashworth, 2)"] });
BA("2025-10-06T09:10:00Z", "Grant People to Isla Morgan", { calls: ["Hats.mint(People, Isla Morgan)"], note: "Isla gives up the Delivery hat to Grace today; People lets her keep managing projects" });
BA("2025-10-13T09:00:00Z", "Create the Travel allowance (2,000 USDC a month, under Delivery) for Grace Adeyemi", { calls: ["Budgets.create(Travel, under Delivery, 2,000.00/month)", "Hats.mint(Travel, Grace Adeyemi)"] });
BA("2026-01-19T09:00:00Z", "Grant Invoicing to Leo Brennan", { calls: ["Hats.mint(Invoicing, Leo Brennan)"] });
BA("2026-03-31T16:00:00Z", "End Daniel Price's option grant (40,000 back to the pool)", { calls: ["Options.end(gr_0008)"] });
BA("2026-01-02T10:00:00Z", "Set the USDC payout ceiling to 2,100,000 a year", { calls: ["Roles: set the USDC payout ceiling to 2,100,000.00 a year"] });
for (const [who, shares, d] of [["Priya Raman", 120000, "2025-05-12"], ["Kwame Mensah", 80000, "2025-06-02"], ["Isla Morgan and Sam Whitfield", 80000, "2025-06-16"], ["Ellis Hart and Lena Fischer", 100000, "2025-09-01"], ["Grace Adeyemi", 60000, "2025-10-06"], ["Daniel Price", 40000, "2025-11-03"], ["Leo Brennan", 50000, "2026-01-12"], ["Nadia Farouk", 45000, "2026-03-03"], ["Tomás Reyes and Ravi Shah", 60000, "2026-04-07"], ["Callum Burke and Zara Ahmed", 60000, "2026-09-01"]]) {
  BA(at(d, 15, 0), `Grant ${shares.toLocaleString("en-GB")} options to ${who}`, { calls: [`Options.grant(${who}, ${shares})`], proposedBy: d >= "2025-09-01" ? "tom" : "maya" });
}
BA("2026-05-12T11:00:00Z", "Freeze USDC payouts", { status: "Rejected", note: "Test of the freeze, rejected", proposedBy: "tom", calls: ["Roles: freeze the USDC payout ceiling, leave 0"] });
BA("2026-05-12T11:20:00Z", "Reject proposal: Freeze USDC payouts", { kind: "Rejection", status: "Executed", proposedBy: "tom", calls: ["(an empty transaction at the same nonce)"] });
BA("2026-10-30T10:00:00Z", "Pay Northbank Ventures 12,000.00 USDC on 30 Nov 2026", { kind: "Scheduled payment", note: "Seed legal costs, per the term sheet", proposedBy: "ruth", calls: ["Budgets.schedule(top, Northbank Ventures, 12,000.00 USDC, 2026-11-30)"] });
BA("2026-11-08T16:12:00Z", "Grant Books to Nadia Farouk", { status: "Waiting", note: "Month-end close", proposedBy: "maya", calls: ["Hats.mint(Books, Nadia Farouk)"], why: "Kwame asked the FDE; Maya proposed" });
BA("2026-11-09T09:30:00Z", "Raise Harbourline's quarterly budget from Q1 2027", { status: "Waiting", note: "Two engineering hires in Q1 (Owen Grady, one more)", proposedBy: "maya", calls: ["Budgets.setAmount(Harbourline, from 2027-01-01)", "Roles: resize the USDC payout ceiling to 2,400,000.00"], why: "Harbourline is a top department, and nobody changes their own budget through its own hat" });

// ---------- simulate the accounts, then render every movement ----------
ctx.cash.simulate({ treasury: 0, reserve: 0, barclays: openBarclays });
const money = ctx.cash.render();

// Harbourline's quarterly budget changes go through the Board too (added after we know the spend)
const budgets = buildBudgets(ctx, money.payments);
for (const ch of budgets.departments.find((x) => x.id === "harbourline").changes) {
  if (ch.kind === "Set amount" && ch.state === "Applied") BA(at(ch.when, 10, 0), `Set Harbourline's budget: ${ch.terms}`, { calls: [`Budgets.setAmount(Harbourline, ${ch.to.toFixed(2)} a quarter)`], why: "A top department's budget is the Board's to change" });
}
const proposals = buildBoard(ctx, ctx.boardActions);
// the two waiting proposals are named in the department's changes
const raise = proposals.find((p) => p.status === "Waiting" && p.title.startsWith("Raise"));
const books = proposals.find((p) => p.status === "Waiting" && p.title.startsWith("Grant Books"));
budgets.departments.find((x) => x.id === "harbourline").changes.forEach((c) => { if (c.state === "Proposed") c.proposal = raise.id; });
raise.title = `Raise Harbourline's budget to ${budgets.raise.to.toLocaleString("en-GB", { minimumFractionDigits: 2 })} USDC a quarter from Q1 2027`;
raise.calls[0] = `Budgets.setAmount(Harbourline, ${budgets.raise.to.toFixed(2)} a quarter, from 2027-01-01)`;
for (const p of money.payments) if (p.route === "board" && p.direction === "between") {
  const ev = ctx.cash.events.find((e) => e.kind === "safe_transfer" && e.time === p.sentAt);
  if (ev?.proposal) { p.proposal = ev.proposal.id; p.approvedBy = "board"; p.approvedHat = "Board"; }
}
for (const t of money.chain) if (t.description.includes("Board proposal")) {
  const p = money.payments.find((x) => x.id === t.reference);
  if (p?.proposal) t.description = t.description.replace(/Board proposal\s*\)/, `Board proposal ${p.proposal})`);
}

// ---------- depreciation, revaluation, corporation tax, year-end close ----------
for (const m of months(START, "2026-10-31")) {
  const end = monthEnd(m);
  const cost = P(21600) + sum(ctx.assets.filter((a) => a.date < m), (a) => a.cost);
  const dep = Math.round(cost / 36);
  L.post({ date: end, type: "Journal Entry", entryType: "Depreciation Entry", title: `Depreciation ${m.slice(0, 7)}`, lines: [{ account: "6800", dr: dep, cc: "Main" }, { account: "1510", cr: dep }] });
}
function revalue(end) {
  const b = L.balances(end);
  const rate = ctx.rate(end);
  const lines = [];
  for (const acc of USDC_ACCOUNTS) {
    const x = b.get(acc) || { gbp: 0, acc: 0 };
    const target = Math.round((x.acc / 1e6) * rate * 100);
    const diff = target - x.gbp;
    if (diff) lines.push(diff > 0 ? { account: acc, dr: diff, accDr: 0 } : { account: acc, cr: -diff, accCr: 0 });
  }
  if (!lines.length) return;
  const net = sum(lines, (l) => (l.dr || 0) - (l.cr || 0));
  lines.push(net > 0 ? { account: "6510", cr: net, cc: "Main" } : { account: "6510", dr: -net, cc: "Main" });
  L.post({ date: end, type: "Journal Entry", entryType: "Exchange Rate Revaluation", title: `Revaluation of the USDC accounts at ${rate} on ${end}`, revaluation: true, lines });
}
for (const m of months(START, "2026-03-31")) revalue(monthEnd(m));
// corporation tax on the first year's profit, then close it into retained earnings
const pcvDate = "2026-03-31";
{
  const b = L.balances(pcvDate);
  let profit = 0;
  for (const a of L.accounts.values()) if (a.root === "Income" || a.root === "Expense") profit -= b.get(a.code)?.gbp || 0;
  ctx.fyProfit = profit;
  if (profit > 0) {
    const ct = Math.round(profit * 0.25);
    L.post({ date: pcvDate, type: "Journal Entry", entryType: "Journal Entry", title: "Corporation tax for the year to 31 March 2026 (25%), due 1 January 2027", lines: [{ account: "6950", dr: ct, cc: "Main" }, { account: "2700", cr: ct }] });
    ctx.corporationTax = ct;
  }
  const b2 = L.balances(pcvDate);
  const lines = [];
  let net = 0;
  for (const a of L.accounts.values()) {
    if (a.root !== "Income" && a.root !== "Expense") continue;
    const x = b2.get(a.code)?.gbp || 0;
    if (!x) continue;
    lines.push(x > 0 ? { account: a.code, cr: x } : { account: a.code, dr: -x });
    net += x;
  }
  lines.push(net > 0 ? { account: "3100", dr: net } : { account: "3100", cr: -net });
  ctx.pcv = L.post({ date: pcvDate, type: "Period Closing Voucher", title: "Year-end close 2025-2026, signed off by Harbourline's accountants", closing: true, lines, submittedAt: "2026-06-19T15:30:00Z" });
}
for (const m of months("2026-04-01", "2026-10-31")) revalue(monthEnd(m));

// ---------- name the vouchers ----------
{
  const order = L.vouchers.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const prefix = { "Payment Entry": "ACC-PAY", "Journal Entry": "ACC-JV", "Period Closing Voucher": "ACC-PCV", "Expense Claim": null, "Sales Invoice": null, "Purchase Invoice": null };
  for (const v of order) {
    if (v.type === "Sales Invoice" || v.type === "Purchase Invoice" || v.type === "Expense Claim") v.name = v.ref.name;
    else v.name = ctx.series.next(`${prefix[v.type]}-${v.date.slice(0, 4)}-`);
    mark(v, "voucher");
  }
  for (const p of money.payments) p.books = p.voucher ? p.voucher.name : null;
}

// ---------- finish records ----------
finishSales(salesInvoices);
finishPurchases(purchaseInvoices);
finishAdvances(advances);
finishPayroll(payroll, ctx);
finishProjects(pj, ctx);
const crm = buildCRM(ctx);
ctx.crmMoney(money.payments);
finishCRM(crm, ctx);
const seats = buildSeats(ctx, money.payments);
const agents = buildAgents(ctx, money.payments);
const ceilings = payoutCeiling(money.payments);
for (const c of claims) { if (c.payment) { c.paymentInfo = { payment: c.payment.id, documentHash: c.payment.proof?.documentHash, tx: c.payment.proof?.tx, block: c.payment.proof?.block, settledAt: c.payment.settledAt, amountSent: c.payment.amount, fee: c.payment.fee, route: c.payment.payout ? "Bank through Bridge" : "Capxul Safe" }; delete c.payment; } }
for (const a of advances) { if (a.payment) { a.paymentInfo = { payment: a.payment.id, documentHash: a.payment.proof?.documentHash, tx: a.payment.proof?.tx, settledAt: a.payment.settledAt, amountSent: a.payment.amount }; delete a.payment; } }

// ---------- reports ----------
const reports = buildReports(L, START, "2026-10-31", TODAY);

// ---------- Safes and the bank: balances and statements ----------
const chainSorted = money.chain.slice().sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.micro - b.micro));
const bal = { treasury: 0, reserve: 0, escrow: 0 };
const statements = { treasury: [], reserve: [], escrow: [] };
for (const t of chainSorted) {
  bal[t.account] += t.micro;
  t.balanceAfter = usdc(bal[t.account]);
  statements[t.account].push(t);
}
const reservedScheduled = sum(ctx.scheduled.filter((s) => s.budget !== "board"), (s) => U(s.amount || 0)) + sum(ctx.scheduled.filter((s) => s.budget === "board"), (s) => U(s.amount || 0));
const safes = {
  treasury: { ...ctx.safes.treasury, network: "Base", chainId: 8453, asset: "USDC", balance: usdc(bal.treasury), gbp: r2(usdc(bal.treasury) * ctx.rate(TODAY)), reserved: usdc(reservedScheduled + U(4800) + U(2051)), available: null, holdings: [{ token: "USDC", contract: COMPANY.chain.usdc, balance: usdc(bal.treasury) }, { token: "EURC", contract: COMPANY.chain.eurc, balance: 0 }], directors: ["maya", "tom", "ruth"], threshold: 2, nonce: proposals.length, waiting: proposals.filter((p) => p.status === "Waiting").length },
  reserve: { ...ctx.safes.reserve, network: "Base", chainId: 8453, asset: "USDC", balance: usdc(bal.reserve), gbp: r2(usdc(bal.reserve) * ctx.rate(TODAY)), holdings: [{ token: "USDC", contract: COMPANY.chain.usdc, balance: usdc(bal.reserve) }], directors: ["maya", "tom", "ruth"], threshold: 2, note: "Holds the money the rounds raised. It has no budgets: money leaves it only by Board proposal." },
  moneyWaiting: { balance: usdc(bal.escrow), open: money.escrows.filter((e) => e.status === "Open").length },
};
safes.treasury.available = r2(safes.treasury.balance - safes.treasury.reserved);
// the scheduled payments, reserved but not yet paid
const scheduled = [
  ...ctx.scheduled.map((s) => ({ day: s.on, to: s.supplier.name, amount: s.amount, asset: "USDC", budget: s.budget, scheduledBy: s.budget === "board" ? "board" : s.by, proposal: s.budget === "board" ? proposals.find((p) => p.kind === "Scheduled payment")?.id : null, what: `${s.bill.name} (${s.bill.billNo})`, status: "Scheduled", reserved: true, payment: "payment_" + hashOf({ s: s.bill.name }).slice(2, 28).toUpperCase() })),
  { day: "2026-12-02", to: "Sofia Lindqvist", amount: 4800, asset: "USDC", budget: "engineering", scheduledBy: "agreement", what: "Pay agreement collection 10", status: "Scheduled", reserved: true, payment: null, agreement: payroll.agreements[0].id },
  { day: "2026-12-04", to: "Marta Kowalczyk", amount: 4800, asset: "USDC", budget: "engineering", scheduledBy: "tom", what: "November's contract engineering (invoice to come)", status: "Scheduled", reserved: true, payment: "payment_01JC5T7R2W9E4Q6Y8U0I3O5P7A" },
  { day: "2026-12-05", to: "Kestrel Cloud Ltd", amount: 2051, asset: "USDC", budget: "engineering", scheduledBy: "@tom-build", onBehalfOf: "tom", what: "November's hosting (request from Kestrel's Capxul)", status: "Scheduled", reserved: true, payment: "payment_01JC5T9B4N6M8K0J2H4G6F8D0S" },
].sort((a, b) => (a.day < b.day ? -1 : 1));

const glBal = L.balances(TODAY);
const barclaysLines = money.barclays.slice().sort((a, b) => (a.time < b.time ? -1 : 1));
let bb = openBarclays;
const statementTo = "2026-11-06";
for (const l of barclaysLines) {
  bb += P(l.deposit) - P(l.withdrawal);
  l.balance = gbp(bb);
  l.name = ctx.series.next(`ACC-BTN-${l.date.slice(0, 4)}-`);
  l.voucher = l.voucher ? l.voucher.name : null;
  l.onStatement = l.date <= statementTo;
  l.status = !l.onStatement ? "Not on statement yet" : l.date >= "2026-11-03" ? "Unreconciled" : "Reconciled";
  l.bankAccount = "Barclays Business · GBP";
}
const bankAccounts = [{ ...BANK.barclays, ledgerAccount: "1050", balance: gbp(glBal.get("1050").gbp), openingBalance: gbp(openBarclays), statementTo, statementBalance: gbp(sum(barclaysLines.filter((l) => l.onStatement), (l) => P(l.deposit) - P(l.withdrawal)) + openBarclays), toReconcile: barclaysLines.filter((l) => l.status === "Unreconciled").length, reconciled: barclaysLines.filter((l) => l.status === "Reconciled").length, note: "Payments from this account are recorded in Books. Capxul does not move money in it." }];

// ---------- feed ----------
const chainTx = new Map(money.chain.map((t) => [t.reference, t.tx]));
const D = {
  departments: budgets.departments, allowances: budgets.allowances, payments: money.payments, slips: payroll.slips, runs: payroll.runs, payouts: money.payouts, purchaseInvoices,
  escrows: money.escrows, safes, bankAccounts, reports, crm, proposals, directors: DIRECTORS, leaveApplications: hr.leaveApplications, expenseClaims: claims, advances, deposits: money.deposits,
  approvals: money.approvals, seats, projects: pj.projects, equity, chainTx,
};
const fde = buildFDE(ctx, D);
const approvals = buildApprovals(ctx, D);
const notices = buildNotices(ctx, D);
const events = buildEvents(ctx, D);
const activity = buildActivity(ctx, D);

// ---------- output ----------
for (const x of [...salesInvoices]) mark(x, "invoice");
for (const x of purchaseInvoices) mark(x, "bill");
for (const x of pj.timesheets) mark(x, "timesheet");
for (const x of pj.tasks) mark(x, "task");
for (const x of payroll.slips) mark(x, "slip");
for (const x of claims) mark(x, "claim");
for (const x of advances) mark(x, "advance");
for (const x of hr.leaveApplications) mark(x, "leave");
function clean(v, root = false) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "function") return undefined;
  if (typeof v !== "object") return v;
  if (!root && v[REF]) return v.name;
  if (Array.isArray(v)) return v.map((x) => clean(x)).filter((x) => x !== undefined);
  const o = {};
  for (const [k, x] of Object.entries(v)) {
    if (k.startsWith("_") || typeof x === "function") continue;
    if (k === "ref" && x && typeof x === "object" && x[REF]) { o.ref = x.name; continue; }
    const c = clean(x);
    if (c !== undefined) o[k] = c;
  }
  return o;
}
const recs = (arr) => arr.map((x) => clean(x, true));
const stmt = (lines) => table(["time", "block", "tx", "logIndex", "direction", "amount", "balanceAfter", "description", "reference"], lines);

// the ledger as a compact table, and voucher headers
const gl = [];
for (const e of L.entries) {
  gl.push({ voucher: e.v.name, type: e.v.type, date: e.v.date, account: e.account, debit: gbp(e.dr), credit: gbp(e.cr), accDebit: e.accDr ? usdc(e.accDr) : 0, accCredit: e.accCr ? usdc(e.accCr) : 0, party: e.party || null, partyType: e.partyType || null, costCenter: e.cc || null, project: e.project || null, againstType: e.against?.type || null, against: e.against?.ref?.name || null, closing: e.v.closing ? 1 : 0 });
}
gl.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.voucher < b.voucher ? -1 : 1));
const vouchers = L.vouchers.map((v) => ({ name: v.name, type: v.type, entryType: v.entryType || null, paymentType: v.paymentType || null, date: v.date, title: v.title, total: gbp(v.total), party: v.party || null, partyType: v.partyType || null, payment: v.payment?.id || null, closing: !!v.closing }))
  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name < b.name ? -1 : 1));
const journalEntries = vouchers.filter((v) => v.type === "Journal Entry");
const paymentEntries = vouchers.filter((v) => v.type === "Payment Entry");
const people = ctx.people.map((p) => ({
  id: p.id, employee: p.emp, name: p.name, firstName: p.first, lastName: p.last, gender: p.gender, dateOfBirth: p.dob, dateOfJoining: p.joined, relievingDate: p.relieved || null,
  status: p.relieved ? "Left" : "Active", department: p.dept, designation: p.desig, employmentType: p.type || "Full-time", reportsTo: p.reportsTo, companyEmail: p.email, personalEmail: p.personal,
  payMailbox: p.personal, mobile: p.mobile, city: p.city, country: p.abroad || "United Kingdom", holidayList: "Holidays 2026", defaultShift: p.type === "Contract" ? null : "Studio Day",
  salaryMode: p.paidTo === "safe" ? "Capxul Safe" : "Bank", salaryCurrency: p.type === "Contract" ? "USDC" : "GBP", bank: p.bank ? { name: p.bank[0], account: "····" + p.bank[1].slice(-4), sortCode: p.bank[2] } : null,
  safe: p.paidTo === "safe" ? ctx.safeOf(p.id) : null, seat: p.seat || null, hats: ctx.hatsOf(p.id, TODAY), base: p.type === "Contract" ? null : (p.raise && !p.relieved ? p.raise : p.base),
  agreement: p.agreement || null, exit: p.exit || null, billableShare: p.billable || null, noAccountUntil: p.noAccountUntil || null,
  attendanceDeviceId: p.type === "Contract" ? null : `HL-${String(100 + PEOPLE.indexOf(PEOPLE.find((x) => x.id === p.id))).padStart(4, "0")}`,
}));
const data = {
  meta: {
    generator: "demo/data/generate.mjs", seed: SEED, today: TODAY, now: NOW, start: START, fictional: "Fictional sample data. Harbourline Studio Ltd and everyone in it are invented.",
    currency: "GBP", rate: { gbpPerUsdc: ctx.rate(TODAY), asOf: TODAY },
    rules: [
      "Books are in GBP. USDC accounts carry their USDC and are revalued to GBP at each month end (6510 Exchange gain or loss).",
      "UK staff are paid in GBP terms: PAYE, National Insurance and pensions are worked in pounds; the net leaves the Treasury in USDC, to the person's Safe at the day's rate or to their bank in pounds through Bridge (USDC sent includes Bridge's fee).",
      "Contractors abroad are paid in USDC: Sofia Lindqvist by a pay agreement she collects monthly (never in a run); Marta Kowalczyk and Studio Varga by invoice.",
      "One payroll run a month on the top department, Harbourline: one command, one approval by whoever wears the Harbourline hat, one payment per payslip, each with a proof that commits to the payslip.",
      "UK customers are invoiced in GBP and pay by bank transfer to Harbourline's Bridge bank details (RF reference on the invoice); the money lands in the Treasury as USDC. Three older customers pay into Barclays (Fernhill switched to the Bridge details in January 2026). US customers on Capxul are invoiced in USD and pay USDC from their own Safe; Copperleaf paid at the request's pay link.",
      "PAYE, NI, VAT and pensions are paid from the ordinary Barclays account, which is topped up from the Treasury by bank payout to Harbourline itself.",
      "Two Safes: the Treasury (budgets pay from it) and the Reserve Safe (the rounds' money; it moves only by Board proposal).",
      "Department budgets are per calendar quarter in USDC; allowances are per month. A team's budget is carved from Harbourline's.",
      "Document hashes are SHA-256 of the canonical JSON of the advice (sorted keys); the app can re-hash `payments[].proof.advice` to verify `documentHash`.",
    ],
    counts: {},
  },
  company: { ...COMPANY, treasury: ctx.safes.treasury.address, reserve: ctx.safes.reserve.address },
  rates: Object.fromEntries([...rateMap.entries()].filter(([d]) => d >= "2025-04-30" && d <= TODAY)),
  people, others: ctx.others.map((o) => ({ ...o, email: o.email })),
  departments: budgets.departments.map((d) => ({ ...d, costCenter: d.costCenter })), allowances: budgets.allowances, officerHats: OFFICER_HATS, payoutCeilings: ceilings,
  board: { directors: DIRECTORS, threshold: 2, thresholdHistory: [{ from: "2025-05-01", threshold: 1 }, { from: "2025-09-01", threshold: 2 }], proposals, nextNonce: proposals.length, handover: "2026-08-20" },
  equity, seats, agents, fde,
  money: { safes, payments: recs(money.payments), deposits: recs([...money.deposits, ...(ctx.arriving ? [ctx.arriving] : [])]), payouts: recs(money.payouts.map(({ payee, ...p }) => ({ ...p, payeeType: payee.type, bank: payee.bank || null }))), escrows: recs(money.escrows), scheduled, statements: { treasury: stmt(statements.treasury), reserve: stmt(statements.reserve), moneyWaiting: stmt(statements.escrow) }, bankDetails: [
    { currency: "GBP", state: "Active", bank: "ClearBank", payee: COMPANY.name, account: "sort code 04-06-05, account ending 6630", rails: ["Faster Payments"], minimum: 2, fee: "0.50%", becomes: "USDC in the Treasury" },
    { currency: "USD", state: "Active", bank: "Lead Bank", payee: COMPANY.name, account: "routing ending 644, account ending 7731", rails: ["ACH", "Wire"], minimum: 2, fee: "0.50%", becomes: "USDC in the Treasury" },
    { currency: "EUR", state: "Active", bank: "Bridge's EU partner bank", payee: COMPANY.name, account: "IBAN ending 4410", rails: ["SEPA"], minimum: 2, fee: "0.50%", becomes: "USDC in the Treasury" }],
    verification: { status: "Approved", approvedAt: "2025-05-14", currencies: { GBP: "Approved", USD: "Approved", EUR: "Approved" }, people: [{ name: "Maya Okafor", role: "Director, owner", approvedAt: "2025-05-14" }] },
    savedBankAccounts: [
      { holder: COMPANY.name, bank: "Barclays", last4: "4417", currency: "GBP", for: "Yourself", state: "Active", savedBy: "maya", id: "bacc_self_barclays" },
      ...SUPPLIERS.filter((s) => s.bank).map((s) => ({ holder: s.name, bank: s.bank[0], last4: s.bank[1], currency: "GBP", for: "Supplier", state: s.id === "fieldwork" ? "Inactive (returned 28 Oct)" : "Active", savedBy: s.id === "brightfield" ? "maya" : "nadia", id: `bacc_${s.id}` })),
      ...ctx.people.filter((p) => p.bank && !p.relieved).map((p) => ({ holder: p.name, bank: p.bank[0], last4: p.bank[1].slice(-4), currency: "GBP", for: "Payee (salary)", state: "Active", savedBy: "kwame", id: `bacc_${p.id}` })),
    ],
    requestsToPay: [
      { received: "2026-11-07", from: "Studio Varga", reference: "SV-0412 Motion design, Aldermoor annual report film", amount: 3200, asset: "USDC", due: "2026-11-15", status: "Open (scheduled for 15 Nov)", id: "req_01JC6V2B8N4M6K8J0H2G4F6D8S" },
      ...purchaseInvoices.filter((b) => b.supplier === "kestrel").slice(-4).map((b) => ({ received: b.postingDate, from: b.supplierName, reference: b.billNo, amount: null, gbp: b.grandTotal, asset: "USDC", due: b.dueDate, status: b.status === "Paid" ? "Paid" : "Open", id: "req_" + hashOf({ r: b.name }).slice(2, 28).toUpperCase() })),
    ],
  },
  books: {
    accounts: chartForOutput(L), costCenters: [{ name: "Harbourline", isGroup: true, parent: null }, ...["Main", "Design", "Engineering", "Delivery", "Growth", "Operations"].map((n) => ({ name: n, isGroup: false, parent: "Harbourline", department: n === "Main" ? "harbourline" : n.toLowerCase() }))],
    fiscalYears: [{ name: "2025-2026", start: "2025-04-01", end: "2026-03-31", closed: true, note: "On Capxul from 1 May 2025" }, { name: "2026-2027", start: "2026-04-01", end: "2027-03-31", closed: false }],
    periodClosing: { name: ctx.pcv.name, fiscalYear: "2025-2026", periodStart: "2025-04-01", periodEnd: "2026-03-31", closingAccount: "3100", remarks: ctx.pcv.title, submittedAt: "2026-06-19T15:30:00Z", profit: gbp(ctx.fyProfit), corporationTax: gbp(ctx.corporationTax || 0) },
    vatReturns: vatReturns.map((v) => ({ ...v, sales: gbp(v.sales), purchases: gbp(v.purchases), net: gbp(v.net) })),
    salesInvoices: recs(salesInvoices), purchaseInvoices: recs(purchaseInvoices), vouchers, paymentEntryCount: paymentEntries.length, journalEntryCount: journalEntries.length,
    gl: table(["voucher", "type", "date", "account", "debit", "credit", "accDebit", "accCredit", "party", "partyType", "costCenter", "project", "againstType", "against", "closing"], gl),
    bankAccounts, bankTransactions: recs(barclaysLines), reports, customers: CUSTOMERS.map(({ payDays, partial, opening, switchToBridge, ...c }) => ({ ...c, customerGroup: "Commercial", customerType: "Company" })),
    suppliers: SUPPLIERS.map(({ bank, ...s }) => ({ ...s, bankLast4: bank ? bank[1] : null })),
  },
  hr: {
    holidayLists: hr.holidayLists, leaveTypes: hr.leaveTypes, leaveAllocations: recs(hr.leaveAllocations), leaveApplications: recs(hr.leaveApplications),
    attendance: table(["name", "date", "employee", "status", "leaveType", "leaveApplication", "workingHours", "inTime", "outTime", "lateEntry", "earlyExit"], hr.attendance.map((a) => ({ ...a, leaveApplication: a.leaveApplication ? a.leaveApplication.name : null, lateEntry: a.lateEntry ? 1 : 0, earlyExit: a.earlyExit ? 1 : 0 }))),
    checkins: table(["name", "employee", "logType", "time", "device"], hr.checkins), shiftTypes: hr.shiftTypes, shiftAssignments: hr.shiftAssignments,
    expenseClaimTypes: EXPENSE_TYPES, expenseClaims: recs(claims), advances: recs(advances), designations: [...new Set(PEOPLE.map((p) => p.desig))].map((d) => ({ name: d })),
  },
  payroll: { components: payroll.components, structures: payroll.structures, assignments: payroll.assignments, runs: recs(payroll.runs), slips: recs(payroll.slips), agreements: payroll.agreements },
  projects: {
    activityTypes: pj.activityTypes, projectTypes: [{ name: "Internal" }, { name: "External" }, { name: "Other" }], projects: recs(pj.projects), tasks: recs(pj.tasks),
    timesheets: recs(pj.timesheets.map(({ logs, realStart, ...t }) => ({ ...t, logCount: logs.length }))),
    logs: table(["timesheet", "idx", "date", "hours", "activity", "project", "task", "billable", "billingRate", "billingAmount", "costingRate", "invoice", "completed"], pj.logs.map((l) => ({ ...l, timesheet: l.timesheet.name, task: l.task ? l.task.name : null, invoice: l.invoice ? l.invoice.name : null, billable: l.billingHours > 0 ? 1 : 0, completed: l.completed ? 1 : 0 }))),
  },
  crm, approvals: { waiting: approvals.waiting, recent: approvals.recent }, notices, events, activity: table(["at", "kind", "direction", "amount", "counterparty", "status", "outcome", "budget", "safe", "tx", "payment"], activity),
};

// counts
const c = data.meta.counts;
Object.assign(c, {
  employees: people.length, activeEmployees: people.filter((p) => p.status === "Active").length, seatsUsed: seats.used, seatLimit: seats.limit, agents: agents.length,
  departments: budgets.departments.length, allowances: budgets.allowances.length, boardProposals: proposals.length, waitingProposals: proposals.filter((p) => p.status === "Waiting").length,
  salesInvoices: salesInvoices.length, purchaseInvoices: purchaseInvoices.length, paymentEntries: paymentEntries.length, journalEntries: journalEntries.length, glRows: gl.length,
  payments: money.payments.length, deposits: money.deposits.length, payouts: money.payouts.length, escrows: money.escrows.length, chainTransfers: money.chain.length, barclaysLines: barclaysLines.length,
  payrollRuns: payroll.runs.length, payslips: payroll.slips.length, leaveAllocations: hr.leaveAllocations.length, leaveApplications: hr.leaveApplications.length, attendance: hr.attendance.length, checkins: hr.checkins.length,
  expenseClaims: claims.length, advances: advances.length, projects: pj.projects.length, tasks: pj.tasks.length, timesheets: pj.timesheets.length, timeLogs: pj.logs.length,
  leads: crm.leads.length, deals: crm.deals.length, companies: crm.companies.length, contacts: crm.contacts.length, timelineItems: crm.timeline.length, crmNotes: crm.notes.length, crmTasks: crm.tasks.length, calls: crm.calls.length,
  emails: crm.counts.emails, whatsapp: crm.counts.whatsapp, fdeConversations: fde.conversations.length, approvalsWaiting: approvals.waiting.length, notices: notices.length, events: events.length, activity: activity.length,
});
mkdirSync(dirname(OUT), { recursive: true });
const json = JSON.stringify(clean(data, true));
writeFileSync(OUT, json);
console.log(`Wrote ${OUT} (${(json.length / 1024 / 1024).toFixed(2)} MB)`);
console.log("Treasury", safes.treasury.balance, "USDC; Reserve", safes.reserve.balance, "USDC; Barclays £", bankAccounts[0].balance, "; lowest", JSON.stringify({ t: usdc(ctx.cash.lowest.treasury), r: usdc(ctx.cash.lowest.reserve), b: gbp(ctx.cash.lowest.barclays) }), "; top-ups", ctx.cash.topups.length);
console.log("Counts", JSON.stringify(c));
