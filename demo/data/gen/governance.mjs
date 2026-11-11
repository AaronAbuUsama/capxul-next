// Governance: departments and their budgets per quarter, allowances, the payout ceiling, the Board and its proposals,
// equity (cap table, rounds, options, votes), seats, members, invitations, agents and the FDE's hosting.
import { rng, addDays, months, quarterOf, quarterStart, quarterEnd, at, TODAY, NOW, START, U, usdc, sum, r2, ulid, ms, hex32, address, blockAt, minDate, maxDate } from "./util.mjs";

const QUARTERS = ["2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"];

export function buildBudgets(ctx, payments) {
  const r = rng("budgets");
  // spend per budget per quarter: USDC that left the Treasury through that budget (money waiting counts when funded)
  const spend = new Map();
  const add = (b, q, micro) => {
    const k = b + "|" + q;
    spend.set(k, (spend.get(k) || 0) + micro);
  };
  for (const p of payments) {
    if (p.direction !== "out" || !p.budget || p.status === "Prepared" || (p.status === "Cancelled" && p.outcome === "Expired")) continue;
    if (p.budget === "board") continue;
    add(p.budget, quarterOf(p.sentAt.slice(0, 10)), U(p.amount));
  }
  const spentOf = (b, q) => spend.get(b + "|" + q) || 0;
  const daysIn = (q) => Math.round((Date.parse(quarterEnd(q)) - Date.parse(maxDate(quarterStart(q), START))) / 86400000) + 1;
  const elapsed = (q) => Math.round((Date.parse(minDate(quarterEnd(q), TODAY)) - Date.parse(maxDate(quarterStart(q), START))) / 86400000) + 1;
  const roundUp = (micro, step) => Math.ceil(micro / U(step)) * U(step);

  const departments = ctx.departments.map((d) => ({ ...d, budgets: [], changes: [] }));
  const allowances = ctx.allowances.map((a) => ({ ...a, months: [] }));
  const teams = departments.filter((d) => d.parent);
  for (const d of teams) {
    let prev = 0;
    for (const q of QUARTERS) {
      const s = spentOf(d.id, q);
      const proj = q === "2026-Q4" ? Math.round((s * daysIn(q)) / elapsed(q)) : s;
      const target = roundUp(Math.max(proj * 1.12, U(6000)), 5000);
      const amount = prev && prev >= proj * 1.04 && prev <= proj * 1.6 ? prev : target;
      if (amount !== prev) {
        const when = prev ? addDays(quarterStart(q), -r.int(2, 9)) : maxDate(quarterStart(q), START);
        d.changes.push({ when: maxDate(when, START), kind: prev ? "Set amount" : "Create", terms: prev ? `${fmt(prev)} → ${fmt(amount)} USDC a quarter` : `${d.name}, under Harbourline, ${fmt(amount)} USDC a quarter, holder ${ctx.personName(d.holders[0].who)}`, signedBy: "maya", signedAs: "Harbourline (office above)", state: "Applied", from: prev ? usdc(prev) : null, to: usdc(amount) });
      }
      prev = amount;
      d.budgets.push({ quarter: q, from: maxDate(quarterStart(q), START), to: quarterEnd(q), amount: usdc(amount), spent: usdc(s), committed: 0, left: null });
    }
  }
  for (const a of allowances) {
    for (const m of months(a.holders[0].from, TODAY)) {
      const s = sum(payments.filter((p) => p.budget === a.id && p.direction === "out" && p.sentAt.slice(0, 7) === m.slice(0, 7) && p.status !== "Prepared"), (p) => U(p.amount));
      a.months.push({ month: m.slice(0, 7), amount: a.monthly, spent: usdc(s), left: r2(a.monthly - usdc(s)) });
    }
    a.created = a.holders[0].from;
  }
  // Harbourline: payroll and its own spend, plus the teams and allowances carved from it
  const top = departments.find((d) => d.id === "harbourline");
  let prev = 0;
  for (const q of QUARTERS) {
    const s = spentOf("harbourline", q);
    const proj = q === "2026-Q4" ? Math.round((s * daysIn(q)) / elapsed(q)) : s;
    const children = sum(teams, (d) => U(d.budgets.find((b) => b.quarter === q).amount)) + sum(allowances, (a) => (a.created <= quarterEnd(q) ? U(a.monthly) * 3 : 0));
    const target = roundUp((proj + children) * 1.08, 25000);
    const amount = prev && prev >= (proj + children) * 1.02 ? prev : target;
    if (amount !== prev) {
      top.changes.push({ when: prev ? addDays(quarterStart(q), -r.int(3, 10)) : START, kind: prev ? "Set amount" : "Create", terms: prev ? `${fmt(prev)} → ${fmt(amount)} USDC a quarter` : `Harbourline, top department, ${fmt(amount)} USDC a quarter, holder Maya Okafor`, signedBy: "board", signedAs: "the Board", state: "Applied", from: prev ? usdc(prev) : null, to: usdc(amount) });
    }
    prev = amount;
    top.budgets.push({ quarter: q, from: maxDate(quarterStart(q), START), to: quarterEnd(q), amount: usdc(amount), spent: usdc(s), teamsAndAllowances: usdc(children), committed: 0, left: null });
  }
  // committed: running agreements to the quarter's end, and dated payments reserved
  const eng = departments.find((d) => d.id === "engineering");
  const q4 = (d) => d.budgets.find((b) => b.quarter === "2026-Q4");
  const engQ4 = q4(eng);
  engQ4.committed = 4800; // Sofia's 2 Dec collection
  for (const s of ctx.scheduled) {
    const dep = departments.find((d) => d.id === s.budget);
    if (dep && quarterOf(s.on) === "2026-Q4") q4(dep).committed = r2(q4(dep).committed + (s.amount || 0));
  }
  for (const d of departments) {
    for (const b of d.budgets) b.left = r2(b.amount - (b.teamsAndAllowances || 0) - b.spent - b.committed);
    d.kind = d.parent ? "team" : "department";
    d.period = "quarter";
    d.token = "USDC";
    d.status = "Active";
    d.changes.sort((a, b) => (a.when < b.when ? -1 : 1));
    for (const h of d.holders) h.name = ctx.personName(h.who);
  }
  // the proposed raise for Q1 2027, waiting on the Board (sp_0194)
  const topQ4 = q4(top).amount;
  top.changes.push({ when: "2026-11-09", kind: "Set amount", terms: `${fmt(U(topQ4))} → ${fmt(U(topQ4 + 75000))} USDC a quarter from Q1 2027`, signedBy: "board", signedAs: "the Board (waiting)", state: "Proposed", from: topQ4, to: topQ4 + 75000, proposal: "sp_0194" });
  return { departments, allowances, raise: { from: topQ4, to: topQ4 + 75000 } };
}

export function payoutCeiling(payments) {
  const year = (y) => sum(payments.filter((p) => p.direction === "out" && p.budget && p.budget !== "board" && p.sentAt.startsWith(y) && p.status !== "Prepared" && !(p.status === "Cancelled" && p.outcome === "Expired")), (p) => U(p.amount));
  return [
    { token: "USDC", year: 2025, ceiling: 1800000, used: usdc(year("2025")), left: r2(1800000 - usdc(year("2025"))), frozen: false },
    { token: "USDC", year: 2026, ceiling: 2100000, used: usdc(year("2026")), left: r2(2100000 - usdc(year("2026"))), frozen: false },
  ];
}

function fmt(micro) {
  return (micro / 1e6).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- the Board ----------
export function buildBoard(ctx, actions) {
  const r = rng("board");
  const directorsAt = (d) => ctx.directors.filter((x) => x.from <= d).map((x) => x.who);
  const thresholdAt = (d) => (d < "2025-09-01" ? 1 : 2);
  const list = actions.slice().sort((a, b) => (a.at < b.at ? -1 : 1));
  // ids count back from the last two, which are the ones waiting today
  const ids = [];
  let n = 194;
  for (let i = list.length - 1; i >= 0; i--) {
    ids[i] = n;
    n -= i >= list.length - 2 ? 1 : r.int(1, 5);
  }
  return list.map((a, i) => {
    const d = a.at.slice(0, 10);
    const dirs = directorsAt(d);
    const th = thresholdAt(d);
    const proposer = a.proposedBy || "maya";
    const others = dirs.filter((x) => x !== proposer);
    const approvals = [{ who: proposer, at: addMin(a.at, 1) }];
    if (a.status !== "Waiting" && a.status !== "Rejected") for (let k = 1; k < th; k++) approvals.push({ who: others[(k - 1 + i) % others.length], at: addMin(a.at, r.int(20, 600)) });
    const executedAt = a.status === "Executed" ? approvals[approvals.length - 1].at : null;
    const p = {
      id: "sp_" + String(ids[i]).padStart(4, "0"), nonce: i, title: a.title, kind: a.kind || "Transaction", note: a.note || null, calls: a.calls || [],
      proposedBy: proposer, createdAt: a.at, threshold: th, directors: dirs, approvals, status: a.status || "Executed", executedAt,
      safeTxHash: hex32(r), executionTx: executedAt ? hex32(r) : null, executionBlock: executedAt ? blockAt(executedAt) : null, why: a.why || null, ref: a.ref || null,
    };
    a.proposal = p;
    if (a.ev) a.ev.proposal = p;
    return p;
  });
}
function addMin(t, n) {
  return new Date(Date.parse(t) + n * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ---------- equity ----------
export function buildEquity(ctx) {
  const r = rng("equity");
  const classes = [
    { name: "Common", authorised: 20000000, issued: 8500000, votes: 1, preference: null },
    { name: "Seed Preferred", authorised: 3000000, issued: 0, votes: 1, preference: "1x non-participating; converts to Common one for one" },
  ];
  const safeInv = [["northbank", "Northbank Ventures", 250000, "2025-10-08"], ["juniper", "Juniper Angels Syndicate", 100000, "2025-10-14"], ["chukwu", "Ifeoma Chukwu", 50000, "2025-10-20"], ["whitlock", "Daniel Whitlock", 50000, "2025-10-29"]];
  const seedInv = [["fennel", "Fennel Capital", 500000, "2026-08-12"], ["northbank", "Northbank Ventures", 1200000, "2026-08-14"], ["juniper", "Juniper Angels Syndicate", 100000, "2026-08-18"]];
  const SAFE_SHARES = 810811;
  const PRICE = 0.8325;
  const investors = { northbank: { name: "Northbank Ventures", member: false, handle: "@northbank", contact: "Ruth Calloway" }, juniper: { name: "Juniper Angels Syndicate", member: false, handle: "@juniper-angels", contact: "Priti Desai" }, chukwu: { name: "Ifeoma Chukwu", member: false, handle: "@ifeoma", contact: "Ifeoma Chukwu" }, whitlock: { name: "Daniel Whitlock", member: false, handle: null, contact: "Daniel Whitlock" }, fennel: { name: "Fennel Capital", member: false, handle: "@fennelcapital", contact: "Tariq Hussain" } };
  const rounds = [
    { id: "rd_0001", name: "Pre-seed SAFE", kind: "SAFE", terms: "Post-money valuation cap 6,000,000 USDC, no discount", cap: 6000000, target: 450000, raised: 450000, status: "Closed", opened: "2025-10-06", closed: "2025-10-31", converted: "2026-08-20", termsHash: hex32(r),
      investments: safeInv.map(([id, name, amount, date]) => ({ investor: id, name, amount, committedAt: addDays(date, -3), paidAt: date, shares: Math.floor((amount / 450000) * SAFE_SHARES), status: "Converted" })) },
    { id: "rd_0002", name: "Seed", kind: "Priced", class: "Seed Preferred", terms: "Pre-money 9,000,000 USDC; 0.8325 USDC a share", preMoney: 9000000, price: PRICE, target: 1800000, raised: 1800000, status: "Closed", opened: "2026-07-15", closed: "2026-08-20", payBy: "2026-08-15", termsHash: hex32(r), lead: "Northbank Ventures",
      investments: seedInv.map(([id, name, amount, date]) => ({ investor: id, name, amount, committedAt: addDays(date, -9), paidAt: date, shares: Math.floor(amount / PRICE), status: "Allocated" })) },
  ];
  // the investment payments into the Reserve Safe
  for (const rd of rounds) {
    for (const inv of rd.investments) {
      const t = at(inv.paidAt, 15, r.int(0, 59), r.int(0, 59));
      ctx.cash.add({ kind: "usdc_in", to: "reserve", time: t, amount: { usdc: U(inv.amount) }, purpose: "investment",
        payer: { name: inv.name, handle: investors[inv.investor].handle, safe: address(r) }, party: inv.investor, partyType: "Shareholder",
        counter: rd.kind === "SAFE" ? [{ account: "3300", cr: Math.round(inv.amount * ctx.rate(inv.paidAt) * 100), party: inv.investor, partyType: "Shareholder" }]
          : [{ account: "3000", cr: Math.round(inv.shares * 0.0001 * 100), party: inv.investor, partyType: "Shareholder" }, { account: "3200", cr: Math.round(inv.amount * ctx.rate(inv.paidAt) * 100) - Math.round(inv.shares * 0.0001 * 100), party: inv.investor, partyType: "Shareholder" }],
        voucherType: "Payment Entry", description: `${rd.name}: investment from ${inv.name}`, memo: `${rd.id} ${rd.kind === "SAFE" ? "SAFE" : "subscription"}`,
        onSettled: (pay) => { inv.payment = pay.id; } });
    }
  }
  // SAFEs convert into Seed Preferred on 20 Aug 2026
  const safeGbp = sum(rounds[0].investments, (i) => Math.round(i.amount * ctx.rate(i.paidAt) * 100));
  const safeShares = sum(rounds[0].investments, (i) => i.shares);
  ctx.ledger.post({ date: "2026-08-20", type: "Journal Entry", entryType: "Journal Entry", title: "Pre-seed SAFEs convert into Seed Preferred shares", lines: [{ account: "3300", dr: safeGbp }, { account: "3000", cr: Math.round(safeShares * 0.0001 * 100) }, { account: "3200", cr: safeGbp - Math.round(safeShares * 0.0001 * 100) }] });

  // holders
  const holders = [
    { id: "maya", name: "Maya Okafor", member: true, common: 6000000, seed: 0, since: "2025-05-01" },
    { id: "tom", name: "Tom Ashworth", member: true, common: 2500000, seed: 0, since: "2025-05-01", vesting: { start: "2025-05-01", years: 4, cliffYears: 1, vested: Math.floor((2500000 * 18) / 48) } },
  ];
  for (const rd of rounds) for (const inv of rd.investments) {
    let h = holders.find((x) => x.id === inv.investor);
    if (!h) { h = { id: inv.investor, name: inv.name, member: false, common: 0, seed: 0, since: inv.paidAt, contact: investors[inv.investor].contact }; holders.push(h); }
    h.seed += inv.shares;
  }
  const seedIssued = sum(holders, (h) => h.seed);
  classes[1].issued = seedIssued;

  // options
  const G = [
    ["priya", 120000, 0.1, "2025-05-12"], ["kwame", 80000, 0.1, "2025-06-02"], ["isla", 40000, 0.1, "2025-06-16"], ["samw", 40000, 0.1, "2025-06-16"], ["ellis", 60000, 0.12, "2025-09-01"], ["lena", 40000, 0.12, "2025-09-01"],
    ["grace", 60000, 0.12, "2025-10-06"], ["daniel", 40000, 0.12, "2025-11-03"], ["leo", 50000, 0.14, "2026-01-12"], ["nadia", 45000, 0.14, "2026-03-03"], ["tomas", 30000, 0.14, "2026-04-07"], ["ravi", 30000, 0.14, "2026-04-07"], ["callum", 35000, 0.25, "2026-09-01"], ["zara", 25000, 0.25, "2026-09-01"],
  ];
  const vestedAt = (shares, start, d) => {
    const mths = (Number(d.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(d.slice(5, 7)) - Number(start.slice(5, 7)) - (Number(d.slice(8, 10)) < Number(start.slice(8, 10)) ? 1 : 0);
    if (mths < 12) return 0;
    return Math.floor((shares * Math.min(48, mths)) / 48);
  };
  const grants = G.map(([who, shares, strike, start], i) => {
    const p = ctx.people.find((x) => x.id === who);
    const ended = p.relieved || null;
    return { id: "gr_" + String(i + 1).padStart(4, "0"), grantee: who, name: ctx.personName(who), shares, strike, vesting: "4 years, 1-year cliff", start, cliff: addDays(start, 365), status: ended ? "Ended" : "Active", ended, vested: ended ? 0 : vestedAt(shares, start, TODAY), exercised: 0, agreementHash: hex32(r), backToPool: ended ? shares : 0 };
  });
  const granted = sum(grants.filter((g) => g.status === "Active"), (g) => g.shares);
  const pool = { reserved: 1500000, granted, left: 1500000 - granted, topUpProposed: 1000000, topUpVote: "vt_0005" };

  const votes = [
    { id: "vt_0001", matter: "amend-articles", title: "Adopt the new articles for the seed round", opens: "2026-08-01", closes: "2026-08-08", for: 8500000, against: 0, abstain: 0, quorum: 50, status: "Executed", eligible: 8500000 },
    { id: "vt_0002", matter: "approve-round", title: "Approve the seed round (rd_0002)", opens: "2026-08-06", closes: "2026-08-13", for: 8500000, against: 0, abstain: 0, quorum: 50, status: "Executed", eligible: 8500000 },
    { id: "vt_0003", matter: "elect", title: "Elect Maya Okafor, Tom Ashworth and Ruth Calloway as Directors", opens: "2026-08-20", closes: "2026-08-27", for: 8500000 + seedIssued, against: 0, abstain: 0, quorum: 50, status: "Executed", eligible: 8500000 + seedIssued },
    { id: "vt_0004", matter: "approve-plan", title: "Approve the option scheme rules (EMI)", opens: "2026-09-14", closes: "2026-09-21", for: 8500000 + seedIssued - 300300, against: 0, abstain: 300300, quorum: 50, status: "Executed", eligible: 8500000 + seedIssued },
    { id: "vt_0005", matter: "authorise", title: "Authorise 1,000,000 more Common for the option pool", opens: "2026-11-06", closes: "2026-11-16", for: 8500000, against: 0, abstain: 0, quorum: 50, status: "Voting", eligible: 8500000 + seedIssued, castBy: [["maya", 6000000, "for", "2026-11-06T09:14:00Z"], ["tom", 2500000, "for", "2026-11-06T11:02:00Z"]] },
  ];
  const total = 8500000 + seedIssued;
  const fd = total + pool.reserved;
  const capTable = holders.map((h) => ({ ...h, asConverted: h.common + h.seed, issuedPercent: Math.round(((h.common + h.seed) / total) * 10000) / 100, fullyDilutedPercent: Math.round(((h.common + h.seed) / fd) * 10000) / 100 }));
  capTable.push({ id: "options", name: `Options granted (${grants.filter((g) => g.status === "Active").length} holders)`, member: null, common: 0, seed: 0, asConverted: granted, issuedPercent: null, fullyDilutedPercent: Math.round((granted / fd) * 10000) / 100 });
  capTable.push({ id: "pool", name: "Pool not yet granted", member: null, common: 0, seed: 0, asConverted: pool.left, issuedPercent: null, fullyDilutedPercent: Math.round((pool.left / fd) * 10000) / 100 });
  return { classes, rounds, holders, grants, pool, votes, capTable, totals: { issued: total, fullyDiluted: fd, common: 8500000, seedPreferred: seedIssued }, handover: "2026-08-20", investors };
}

// ---------- seats, members, invitations, agents ----------
export function buildSeats(ctx, payments) {
  const r = rng("seats");
  const seated = [...ctx.people.filter((p) => p.seat), ...ctx.others.filter((o) => o.seat)].map((p) => ({ id: p.id, seat: p.seat }));
  seated.sort((a, b) => (a.seat < b.seat ? -1 : 1));
  const members = seated.map((s) => {
    const p = ctx.people.find((x) => x.id === s.id) || ctx.others.find((x) => x.id === s.id);
    return { id: s.id, name: ctx.personName(s.id), email: ctx.emailOf(s.id), kind: "Person", seat: "Own", joined: s.seat, status: "Active", safe: ctx.safeOf(s.id), account: "acct_" + ulid(ms(s.seat), r), hats: ctx.hatsOf(s.id, TODAY), departmentsHeld: ctx.departmentsHeld(s.id, TODAY) };
  });
  for (const a of ctx.agents) members.push({ id: a.handle, name: a.handle, email: null, kind: "Agent", seat: `Rides on ${ctx.personName(a.owner)}'s`, joined: a.created, status: a.state, safe: ctx.safeOf(a.handle), owner: a.owner, hats: a.hats, departmentsHeld: a.handle === "@tom-build" ? ["engineering"] : [] });
  members.push({ id: "@harbourline-fde", name: "Harbourline's FDE", email: null, kind: "Agent", seat: "The company's", joined: "2025-05-01", status: "Active", safe: ctx.safeOf("@harbourline-fde"), hats: [], note: "Acts with the asker's hats, not its own" });
  const invitations = seated.map((s) => ({ id: "inv_" + ulid(ms(s.seat) - 86400000 * 3, r), email: ctx.emailOf(s.id), kind: "Person", sentBy: s.seat === "2025-05-01" ? "maya" : ctx.officerHolders("people", addDays(s.seat, -3))[0] || "maya", sentAt: at(addDays(s.seat, -r.int(1, 4)), 10, r.int(0, 59)), status: "Active", acceptedAt: at(s.seat, 9, r.int(0, 59)), expires: addDays(s.seat, 11) }));
  invitations.push({ id: "inv_01JC4M2Q8W6E0R5T3Y7U1I9O2P", email: "owen.grady@gmail.com", kind: "Person", sentBy: "kwame", sentAt: "2026-11-03T11:20:00Z", status: "Pending", acceptedAt: null, expires: "2026-11-17", offers: null, note: "Senior Software Engineer, joins 4 January 2027" });
  invitations.push({ id: "inv_01HZ8K3D1F5G7H9J2K4L6M8N0P", email: "studio@margotlyle.com", kind: "Person", sentBy: "kwame", sentAt: "2026-04-14T15:05:00Z", status: "Expired", acceptedAt: null, expires: "2026-04-28", note: "Freelance illustrator; the invitation lapsed (a seat was not needed)" });
  invitations.push({ id: "inv_01J0RT6Y8U2I4O6P8A0S2D4F6G", email: "accounts@hollisreed.co.uk", kind: "Person", sentBy: "kwame", sentAt: "2026-04-10T09:30:00Z", status: "Cancelled", acceptedAt: null, expires: "2026-04-24", note: "Sent by mistake: the accountant is an FDE guest, not a member" });
  invitations.sort((a, b) => (a.sentAt < b.sentAt ? -1 : 1));
  const seatPay = payments.find((p) => p.purpose === "supplier" && p.memo === "CX-2026-0101");
  const purchases = [{ at: "2026-11-01T12:00:00Z", seats: 10, price: 10, total: 100, by: "kwame", from: "capxul", payment: seatPay ? seatPay.id : null, limitBefore: 10, limitAfter: 20 }];
  const history = [{ from: "2025-05-01", limit: 10, note: "The ten seats every Organization starts with" }, { from: "2026-11-01", limit: 20, note: "Bought 10 for 100.00 USDC" }];
  const usedAt = (d) => seated.filter((s) => s.seat <= d).length;
  const usage = months(START, TODAY).map((m) => ({ month: m.slice(0, 7), used: usedAt(minDate(addDays(m, 27), TODAY)), limit: m >= "2026-11-01" ? 20 : 10 }));
  const used = usedAt(TODAY);
  return { limit: 20, used, offersReserved: 1, bought: 10, price: 10, priceAsset: "USDC", ownAgent: true, history, usage, purchases, members, invitations, note: "People paid by Harbourline don't need a seat. A seat never ends: people leave a department, not the company." };
}

export function buildAgents(ctx, payments) {
  const r = rng("agents");
  return ctx.agents.map((a) => {
    const did = payments.filter((p) => p.preparedBy === a.handle || p.approvedBy === a.handle).slice(-12).map((p) => ({ at: p.sentAt, what: `${p.approvedBy === a.handle ? "Paid" : "Prepared a payment to"} ${p.counterparty} ${p.amount.toFixed(2)} USDC${p.budget ? ` from ${ctx.budgetName(p.budget)}` : ""}`, payment: p.id }));
    const changes = [{ at: at(a.created, 10, 5), what: "Created", tx: hex32(r) }];
    if (a.handle === "@kwame-ops") changes.push({ at: "2026-03-02T09:40:00Z", what: "Key rotated (new laptop)", tx: hex32(r) }, { at: "2026-06-30T17:10:00Z", what: "Swept 31.20 USDC back to Kwame Mensah", tx: hex32(r) });
    if (a.frozenAt) changes.push({ at: at(a.frozenAt, 18, 22), what: "Frozen by Leo Brennan (paused while the outreach templates are rewritten)", tx: hex32(r) });
    return { ...a, ownerName: ctx.personName(a.owner), safe: ctx.safeOf(a.handle), signer: address(r), keyKept: `in a file on ${ctx.personName(a.owner).split(" ")[0]}'s machine`, holds: a.handle === "@kwame-ops" ? 12.4 : 0, changes, recent: did };
  });
}
