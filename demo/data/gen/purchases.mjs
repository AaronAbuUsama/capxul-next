// Purchases: suppliers' bills on their own rhythms and how each is paid (Bridge payout, USDC from a budget or an
// allowance, money waiting, Barclays), plus card spend and fees read from the Barclays statement, and the Travel
// allowance's bookings.
import { rng, addDays, months, monthEnd, at, TODAY, START, P, U, gbp, sum, r2, hashOf, maxDate, minDate } from "./util.mjs";
import { isWorking } from "./hr.mjs";

const workday = (d) => { while (!isWorking(d)) d = addDays(d, 1); return d; };

export function buildPurchases(ctx) {
  const { series, ledger, suppliers, people } = ctx;
  const r = rng("purchases");
  const bills = [];
  const sup = (id) => suppliers.find((s) => s.id === id);
  const headcount = (d) => people.filter((p) => p.joined <= d && (!p.relieved || p.relieved >= d)).length;
  const deptCount = (dept, d) => people.filter((p) => p.dept === dept && p.joined <= d && (!p.relieved || p.relieved >= d)).length;

  const bill = (o) => {
    const s = sup(o.supplier);
    const currency = s.currency;
    const conv = currency === "USD" ? ctx.rate(o.postingDate) : 1;
    const items = o.items.map((it, i) => ({ idx: i + 1, qty: 1, uom: "Nos", ...it, amount: r2((it.qty || 1) * it.rate) }));
    const net = r2(sum(items, (i) => i.amount));
    const vat = o.vat === false || !s.vat ? 0 : r2(net * 0.2);
    const b = {
      supplier: s.id, supplierName: s.name, billNo: o.billNo, billDate: o.billDate || o.postingDate, postingDate: o.postingDate, dueDate: o.dueDate || addDays(o.postingDate, 30),
      currency, conversionRate: conv, project: o.project || null, department: o.department || s.from, costCenter: ctx.ccOf(o.department || (["subscriptions", "capxul", "travel"].includes(s.from) ? "operations" : s.from) || "operations"),
      items, netTotal: net, taxes: vat ? [{ account: "2102", rate: 20, taxAmount: vat, description: "VAT 20%" }] : [], totalTaxes: vat, grandTotal: r2(net + vat),
      netTotalGbp: r2(net * conv), baseGrandTotal: r2((net + vat) * conv), creditTo: "2000", payments: [], outstanding: r2(net + vat), status: "Unpaid",
      remarks: o.remarks || null, pay: o.pay, isOpening: !!o.isOpening, onHold: o.onHold || null,
    };
    bills.push(b);
    return b;
  };

  // opening: Penrose's April bill, carried in
  bill({ supplier: "penrose", billNo: "PL/25/0418", postingDate: "2025-04-30", billDate: "2025-04-18", dueDate: "2025-05-18", isOpening: true, items: [{ item: "Legal services", description: "Shareholders' agreement update (opening balance)", rate: 1200, expenseAccount: "3990" }], pay: { via: "barclays", on: "2025-05-12" } });

  // Brightfield rent: billed on the 7th, due on the 15th, paid by bank payout from Operations
  for (const m of months(START, TODAY)) {
    const d = workday(m.slice(0, 8) + "07");
    if (d > TODAY) continue;
    const no = `BW-${m.slice(0, 4)}-${m.slice(5, 7)}07`.replace(/-(\d{2})07$/, "-$107");
    const b = bill({ supplier: "brightfield", billNo: `BW-${m.slice(0, 4)}-${m.slice(5, 7)}07`, postingDate: d, dueDate: m.slice(0, 8) + "15", department: "operations",
      items: [{ item: "Rent", description: `Studio rent, 14 Hoxton Square, ${monthName(m)} (12 desks and meeting room)`, rate: 4200, expenseAccount: "6100" }] });
    b.pay = m.startsWith("2026-11") ? { via: "payout-quoted" } : { via: "payout", on: addDays(m.slice(0, 8) + "15", -r.int(1, 3)) };
  }
  // Kestrel Cloud: usage billed at month end, paid in USDC on the 5th from Engineering
  let kc = 88140;
  for (const m of months(START, "2026-10-31")) {
    const d = monthEnd(m);
    const months_ = (Date.parse(m) - Date.parse(START)) / (30.4 * 86400000);
    const amt = r2(820 + months_ * 29.4 + r.float(-35, 35));
    const due = addDays(d, 5);
    bill({ supplier: "kestrel", billNo: `KC-${kc++}`, postingDate: d, dueDate: due, department: "engineering",
      items: [{ item: "Cloud hosting", description: `Cloud hosting, ${monthName(m)} (${Math.min(6, 2 + Math.floor(months_ / 4))} application servers, 2 databases, backups)`, rate: amt, expenseAccount: "5200" }],
      pay: { via: "usdc", on: due, inbox: true } });
  }
  // Marta Kowalczyk: contractor, $4,800 a month from January 2026, paid on the 4th from Engineering
  for (const m of months("2026-01-01", "2026-10-31")) {
    const d = monthEnd(m);
    bill({ supplier: "marta", billNo: `MK-${m.slice(0, 4)}-${m.slice(5, 7)}`, postingDate: d, dueDate: addDays(d, 4), department: "engineering", project: m < "2026-05-01" ? "PROJ-0006" : "PROJ-0011",
      items: [{ item: "Contract engineering", description: `Contract engineering, ${monthName(m)}: ${m < "2026-05-01" ? "Northstar replatform" : "Larkspur ordering app"} (back end)`, rate: 4800, expenseAccount: "5100" }],
      pay: { via: "usdc", on: addDays(d, 4) } });
  }
  // Studio Varga: motion design now and then
  for (const [d, amt, desc, proj, paid] of [["2025-09-30", 2600, "Motion identity sketches for Copperleaf", "PROJ-0003", true], ["2026-03-31", 3100, "Onboarding animations for Fernhill app v2", "PROJ-0005", true], ["2026-06-30", 2800, "Launch film for the Meridian design system", "PROJ-0012", true], ["2026-11-07", 3200, "Motion design, Aldermoor annual report film", "PROJ-0009", false]]) {
    bill({ supplier: "varga", billNo: `SV-0${400 + bills.filter((b) => b.supplier === "varga").length * 4}`, postingDate: d, dueDate: d === "2026-11-07" ? "2026-11-15" : addDays(d, 14), department: "design", project: proj,
      items: [{ item: "Motion design", description: desc, rate: amt, expenseAccount: "5100" }], pay: paid ? { via: "usdc", on: addDays(d, 12) } : { via: "scheduled", on: "2026-11-15", by: "priya" } });
  }
  // Hollis & Reed: quarterly bookkeeping and the year-end accounts
  for (const [d, amt, desc] of [["2025-07-08", 1600, "Bookkeeping and VAT return, April to June 2025"], ["2025-10-08", 1600, "Bookkeeping and VAT return, July to September 2025"], ["2026-01-08", 1600, "Bookkeeping and VAT return, October to December 2025"], ["2026-04-08", 1600, "Bookkeeping and VAT return, January to March 2026"], ["2026-06-15", 3800, "Statutory accounts and corporation tax return, year to 31 March 2026"], ["2026-07-08", 1600, "Bookkeeping and VAT return, April to June 2026"], ["2026-10-08", 1600, "Bookkeeping and VAT return, July to September 2026"]]) {
    const b = bill({ supplier: "hollis", billNo: `HR-${d.slice(2, 4)}${d.slice(5, 7)}-${r.int(100, 999)}`, postingDate: d, dueDate: addDays(d, 30), department: "operations",
      items: [{ item: "Accountancy", description: desc, rate: amt, expenseAccount: "6600" }] });
    b.pay = d === "2026-10-08" ? { via: "payout-transit", on: "2026-11-07" } : { via: "payout", on: addDays(d, r.int(18, 28)) };
  }
  // Penrose Legal: contracts, the SAFE, the seed round; paid from Barclays
  for (const [d, no, amt, desc, payOn] of [["2025-06-20", "PL/25/0577", 1200, "Employment contracts and handbook review", "2025-07-08"], ["2025-10-20", "PL/25/0861", 4500, "Pre-seed SAFE documents and investor side letters", "2025-11-12"], ["2026-08-24", "PL/26/0744", 14000, "Seed round: subscription agreement, articles, disclosure", "2026-09-15"], ["2026-10-12", "PL/26/0912", 1800, "Master services agreement review: Larkspur Coffee Co.", "2026-11-03"]]) {
    bill({ supplier: "penrose", billNo: no, postingDate: d, dueDate: addDays(d, 21), department: "operations", items: [{ item: "Legal services", description: desc, rate: amt, expenseAccount: "6600" }], pay: { via: "barclays", on: payOn } });
  }
  // Tallis: annual cover; the renewal sits unpaid after its quote expired
  bill({ supplier: "tallis", billNo: "TIB-48817", postingDate: "2025-10-01", dueDate: "2025-10-22", department: "operations", vat: false, items: [{ item: "Insurance", description: "Professional indemnity, public and employer's liability, Oct 2025 to Sep 2026 (insurance premium tax included)", rate: 1280, expenseAccount: "6700" }], pay: { via: "payout", on: "2025-10-14" } });
  bill({ supplier: "tallis", billNo: "TIB-55120", postingDate: "2026-10-01", dueDate: "2026-10-22", department: "operations", vat: false, items: [{ item: "Insurance", description: "Professional indemnity, public and employer's liability, Oct 2026 to Sep 2027 (insurance premium tax included)", rate: 1344, expenseAccount: "6700" }], pay: { via: "payout-expired", on: "2026-10-03" } });
  // Jigsaw Systems: a laptop for each new joiner, and a refresh in September 2025
  const joiners = people.filter((p) => p.joined >= START).map((p) => [addDays(p.joined, -7), p]);
  const laptopDays = [...joiners.map(([d, p]) => [d, 1, `Laptop for ${p.first} ${p.last}: 14-inch, 32 GB, 1 TB, with three-year cover`]), ["2025-09-10", 3, "Laptop refresh: three 16-inch workstations for the engineering team"]];
  for (const [d0, qty, desc] of laptopDays) {
    const d = workday(maxDate(d0, START));
    if (d > TODAY) continue;
    bill({ supplier: "jigsaw", billNo: `JS-${d.slice(2, 4)}${d.slice(5, 7)}${r.int(10, 99)}`, postingDate: d, dueDate: addDays(d, 14), department: "operations",
      items: [{ item: "Laptop", description: desc, qty, rate: 1649, expenseAccount: "1500" }], pay: { via: "payout", on: addDays(d, r.int(6, 12)) } });
  }
  // Fieldwork Catering: parties; the last payout bounced
  for (const [d, amt, desc, how] of [["2025-07-18", 1450, "Summer party, 18 July 2025 (food and drinks for 24)", "payout"], ["2025-12-12", 2600, "Christmas party, 12 December 2025", "payout"], ["2026-07-17", 1800, "Summer party, 17 July 2026", "payout"], ["2026-10-16", 343.75, "Team lunch for the Osprey launch", "payout-returned"]]) {
    bill({ supplier: "fieldwork", billNo: `FC-${d.slice(2, 4)}${d.slice(5, 7)}-${r.int(10, 99)}`, postingDate: d, dueDate: addDays(d, 14), department: "operations", items: [{ item: "Catering", description: desc, rate: amt, expenseAccount: "6400" }], pay: { via: how, on: addDays(d, 12) } });
  }
  // Software paid in USDC from the Subscriptions allowance (before July 2025, from Operations)
  for (const m of months(START, TODAY)) {
    const d = m;
    const designers = deptCount("design", d);
    const engineers = deptCount("engineering", d);
    for (const [id, desc, qty, rate] of [["canvasly", "Design tool, team plan", designers, 15], ["tracklane", "Issue tracking, business plan", headcount(d), 8], ["gitforge", "Code hosting, team plan", engineers, 21]]) {
      bill({ supplier: id, billNo: `${id.slice(0, 3).toUpperCase()}-${m.slice(0, 4)}${m.slice(5, 7)}-${r.int(1000, 9999)}`, postingDate: d, dueDate: d, department: "operations",
        items: [{ item: "Subscription", description: `${desc}, ${monthName(m)} (${qty} seats)`, qty, uom: "Seat", rate, expenseAccount: "6200" }], pay: { via: "usdc", on: d, budget: d >= "2025-07-01" ? "subscriptions" : "operations", agent: d >= "2025-07-01" } });
    }
  }
  // Capxul: the FDE's hosting (20 USDC a month) and the ten extra seats
  const fdeDays = ["2025-05-01", ...months("2025-05-01", "2026-10-31").map((m) => m.slice(0, 8) + "24")];
  fdeDays.forEach((d, i) => {
    if (d > TODAY) return;
    const covers = i === 0 ? "1 May to 1 Jun 2025" : `${monthName(addDays(d, 10))}`;
    bill({ supplier: "capxul", billNo: `CX-${d.slice(0, 4)}-${String(i + 1).padStart(4, "0")}`, postingDate: d, dueDate: d, department: "operations",
      items: [{ item: "FDE hosting", description: `Harbourline's FDE, hosted: ${covers}`, rate: 20, expenseAccount: "6200" }], pay: { via: "usdc", on: d, budget: d >= "2025-07-01" ? "capxul" : "operations" } });
  });
  bill({ supplier: "capxul", billNo: "CX-2026-0101", postingDate: "2026-11-01", dueDate: "2026-11-01", department: "operations", items: [{ item: "Seats", description: "Ten more seats, at 10.00 USDC each, once (limit 10 to 20)", qty: 10, uom: "Seat", rate: 10, expenseAccount: "6200" }], pay: { via: "usdc", on: "2026-11-01", budget: "capxul", seats: true } });
  // Design: research participants recruited and paid through Fieldnotes, for each project's discovery
  for (const def of ctx.projectsDef.filter((x) => x.customer && x.start >= START && x.billing !== "retainer")) {
    const d = workday(addDays(def.start, r.int(8, 16)));
    if (d > TODAY) continue;
    const n = r.int(6, 14);
    bill({ supplier: "fieldnotes", billNo: `FN-${d.slice(2, 4)}${d.slice(5, 7)}-${r.int(100, 999)}`, postingDate: d, dueDate: addDays(d, 14), department: "design", project: def.id,
      items: [{ item: "Research recruitment", description: `Recruiting and paying ${n} research participants: ${def.name}`, qty: n, uom: "Participant", rate: r.pick([65, 75, 85, 95]), expenseAccount: "5100" }], pay: { via: "usdc", on: addDays(d, r.int(5, 12)) } });
  }
  // Delivery: rooms for kick-offs and workshops
  for (const def of ctx.projectsDef.filter((x) => x.customer && x.start >= "2025-06-01")) {
    for (const off of [3, 45, 100]) {
      const d = workday(addDays(def.start, off + r.int(0, 6)));
      if (d > TODAY || d > def.end) continue;
      if (off > 3 && r.chance(0.5)) continue;
      bill({ supplier: "commonroom", billNo: `CR-${r.int(10000, 99999)}`, postingDate: d, dueDate: addDays(d, 14), department: "delivery", project: def.id,
        items: [{ item: "Room hire", description: `${off === 3 ? "Kick-off" : "Workshop"} room for ${def.name}, full day with lunch for ${r.int(8, 16)}`, rate: r.pick([380, 460, 540, 620, 780]), expenseAccount: "6400" }], pay: { via: "payout", on: addDays(d, r.int(4, 10)) } });
    }
  }
  // Growth: stands at shows and sponsored newsletters
  for (const [d, amt, desc] of [["2025-06-10", 3200, "Stand at UX London 2025 (shell scheme, two passes)"], ["2025-10-02", 2800, "Stand at the Retail Technology Show"], ["2026-03-10", 3600, "Stand at Digital Health Rewired 2026"], ["2026-06-16", 2400, "Stand at Housing 2026, Manchester"], ["2026-09-15", 1900, "Table at Design Week Brixton"]]) {
    bill({ supplier: "pitchside", billNo: `PE-${d.slice(2, 4)}${d.slice(5, 7)}-${r.int(10, 99)}`, postingDate: d, dueDate: addDays(d, 21), department: "growth", items: [{ item: "Exhibition", description: desc, rate: amt, expenseAccount: "6400" }], pay: { via: "payout", on: addDays(d, r.int(10, 18)) } });
  }
  for (const m of months("2025-07-01", "2026-10-31")) {
    if (!["01", "04", "07", "10"].includes(m.slice(5, 7))) continue;
    const d = workday(addDays(m, 4));
    bill({ supplier: "brightline", billNo: `BLM-${m.slice(2, 4)}${m.slice(5, 7)}`, postingDate: d, dueDate: addDays(d, 14), department: "growth", items: [{ item: "Sponsorship", description: `Sponsored slots in two product and design newsletters, ${monthName(m)} to ${monthName(addDays(m, 70))}`, rate: r.pick([1200, 1350, 1500]), expenseAccount: "6400" }], pay: { via: "usdc", on: addDays(d, r.int(6, 12)) } });
  }

  // people paid by money waiting
  bill({ supplier: "osei", billNo: "MO-0007", postingDate: "2026-07-10", dueDate: "2026-07-24", department: "growth", project: "PROJ-0008", items: [{ item: "Copywriting", description: "Three case studies for the website (Fernhill, Northstar, Osprey)", rate: 750, expenseAccount: "5100" }], pay: { via: "osei" } });
  bill({ supplier: "marchetti", billNo: "JM-2026-14", postingDate: "2026-10-30", dueDate: "2026-11-13", department: "design", project: "PROJ-0009", items: [{ item: "Illustration", description: "Illustration set for the Aldermoor annual report (12 spot illustrations)", rate: 2400, expenseAccount: "5100" }], pay: { via: "escrow-open", on: "2026-11-02" } });
  bill({ supplier: "pryce", billNo: "IP-003", postingDate: "2026-11-03", dueDate: "2026-11-17", department: "growth", items: [{ item: "Referral fee", description: "Referral fee: introduction to Kestrel Health", rate: 1500, expenseAccount: "6600" }], pay: { via: "escrow-open", on: "2026-11-03" } });
  bill({ supplier: "northbank", billNo: "NBV-2026-031", postingDate: "2026-10-28", dueDate: "2026-11-30", department: "harbourline", items: [{ item: "Legal costs", description: "Investor's legal costs on the seed round (capped in the term sheet)", rate: 12000, expenseAccount: "6600" }], pay: { via: "scheduled-board", on: "2026-11-30" } });

  // names, hashes, books
  bills.sort((a, b) => (a.postingDate < b.postingDate ? -1 : a.postingDate > b.postingDate ? 1 : a.supplier < b.supplier ? -1 : 1));
  for (const b of bills) {
    b.name = series.next(`ACC-PINV-${b.postingDate.slice(0, 4)}-`);
    b.contentHash = hashOf({ doc: b.name, supplier: b.supplierName, billNo: b.billNo, date: b.billDate, items: b.items.map((i) => [i.description, i.qty, i.rate, i.amount]), taxes: b.taxes.map((t) => [t.rate, t.taxAmount]), total: b.grandTotal, currency: b.currency });
    const lines = [];
    let left = P(b.netTotalGbp);
    b.items.forEach((it, i) => {
      const amt = i === b.items.length - 1 ? left : P(it.amount * b.conversionRate);
      left -= amt;
      lines.push({ account: it.expenseAccount, dr: amt, cc: it.expenseAccount.startsWith("1") || it.expenseAccount === "3990" ? undefined : b.costCenter, project: b.project });
    });
    if (b.totalTaxes) lines.push({ account: "2102", dr: P(b.baseGrandTotal) - P(b.netTotalGbp) });
    lines.push({ account: "2000", cr: P(b.baseGrandTotal), party: b.supplier, partyType: "Supplier", against: { type: "Purchase Invoice", ref: b } });
    b.voucher = ledger.post({ date: b.postingDate, type: "Purchase Invoice", ref: b, title: `${b.name} ${b.supplierName}`, party: b.supplier, partyType: "Supplier", lines });
    if (b.items.some((i) => i.expenseAccount === "1500")) ctx.assets.push({ date: b.postingDate, cost: P(b.netTotalGbp), bill: b });
  }

  // ---------- payments ----------
  for (const b of bills) {
    const s = sup(b.supplier);
    const p = b.pay;
    if (!p) continue;
    const pays = [{ record: "Purchase Invoice", ref: b, number: b.billNo, date: b.billDate, allocated: P(b.grandTotal), currency: b.currency, lines: b.items.map((it) => ({ idx: it.idx, description: it.description, amount: P(it.amount), vatRate: b.totalTaxes ? 2000 : 0, vat: b.totalTaxes ? P(it.amount * 0.2) : 0 })) }];
    const counter = [{ account: "2000", dr: P(b.baseGrandTotal), party: b.supplier, partyType: "Supplier", against: { type: "Purchase Invoice", ref: b } }];
    const settle = (channel) => (pay) => b.payments.push({ date: (pay.settledAt || pay.voucher?.date || "").slice(0, 10) || null, amount: b.grandTotal, payment: pay.id || null, voucher: pay.voucher, channel });
    const budget = p.budget || s.from;
    const payee = { type: "Supplier", id: s.id, name: s.name, handle: s.handle || null, safe: s.handle ? ctx.supplierSafe(s) : null, party: s.handle ? hashOf({ party: s.handle }).slice(0, 42) : null, email: s.email, bank: s.bank ? { bankName: s.bank[0], last4: s.bank[1], sortCode: s.bank[2] } : null };
    const common = { budget, payee, counter, pays, party: s.id, partyType: "Supplier", voucherType: "Payment Entry", paymentType: "Pay", purpose: "supplier", memo: `${b.billNo}` };
    const time = (d, h) => at(d, h ?? r.int(9, 16), r.int(0, 59), r.int(0, 59));
    if (p.via === "barclays") {
      ctx.cash.add({ kind: "bank_out", time: time(workday(p.on)), amount: { gbp: P(b.grandTotal) }, bankText: `BACS ${s.name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 20)} ${b.billNo.replace(/\//g, "")}`, title: `Payment to ${s.name}`, party: s.id, partyType: "Supplier", counter, purpose: "supplier", ref: b.billNo,
        onSettled: (x) => b.payments.push({ date: x.voucher.date, amount: b.grandTotal, payment: null, voucher: x.voucher, channel: "Barclays" }) });
    } else if (p.via === "payout" || p.via === "payout-transit" || p.via === "payout-returned") {
      const d = workday(p.on);
      if (d > TODAY) continue;
      const t = time(d);
      const status = p.via === "payout" ? "Delivered" : p.via === "payout-transit" ? "In transit" : "Refunded";
      ctx.cash.add({ ...common, kind: "payout", time: p.via === "payout-transit" ? "2026-11-07T16:20:14Z" : p.via === "payout-returned" ? "2026-10-28T10:10:05Z" : t, amount: { gbp: P(b.grandTotal) },
        payout: { status, deliverAt: addMinutesIso(t, r.int(2, 9)), rail: "Faster Payments", returnAt: p.via === "payout-returned" ? "2026-10-28T15:42:00Z" : null, reason: p.via === "payout-returned" ? "The bank returned it: the account is closed" : null },
        onSettled: settle("Bridge payout") });
    } else if (p.via === "payout-quoted") {
      ctx.cash.add({ ...common, kind: "payout", time: "2026-11-09T10:42:18Z", amount: { gbp: P(b.grandTotal) }, payout: { status: "Quoted", rail: "Faster Payments" }, preparedBy: "nadia" });
    } else if (p.via === "payout-expired") {
      ctx.cash.add({ ...common, kind: "payout", time: "2026-10-03T09:12:40Z", amount: { gbp: P(b.grandTotal) }, payout: { status: "Expired", rail: "Faster Payments", reason: "The quote expired before anyone approved it" }, preparedBy: "nadia" });
    } else if (p.via === "usdc") {
      const d = p.on;
      if (d > TODAY) continue;
      const noAccount = s.noAccountUntil && d < s.noAccountUntil;
      const amount = b.currency === "USD" ? { usdc: U(b.grandTotal) } : { gbp: P(b.grandTotal) };
      const ev = { ...common, kind: noAccount ? "escrow" : "usdc_out", from: "treasury", time: time(d, p.agent ? 7 : undefined), amount, onSettled: settle(noAccount ? "Money waiting" : "Capxul"),
        preparedBy: p.agent ? "@kwame-ops" : p.inbox && d >= "2026-02-02" && r.chance(0.5) ? "@tom-build" : undefined, inbox: !!p.inbox, seats: !!p.seats };
      if (p.agent) ev.approval = { signer: { who: "@kwame-ops", hat: "Subscriptions allowance" } };
      if (noAccount) ev.escrow = { email: s.email, claimAt: at(s.noAccountUntil, 8, 41, 3) };
      ctx.cash.add(ev);
    } else if (p.via === "osei") {
      ctx.cash.add({ ...common, kind: "escrow", time: "2026-07-14T13:40:22Z", amount: { usdc: U(750) }, payee: { ...payee, email: "m.osie@gmail.com", name: "m.osie@gmail.com" }, counter, escrow: { email: "m.osie@gmail.com", cancelAt: "2026-07-15T09:05:51Z", cancelBy: "leo" }, memo: "MO-0007 (mistyped email)" });
      ctx.cash.add({ ...common, kind: "escrow", time: "2026-07-15T09:20:07Z", amount: { usdc: U(750) }, escrow: { email: "m.osei@gmail.com", claimAt: "2026-07-17T19:02:44Z" }, onSettled: settle("Money waiting") });
    } else if (p.via === "escrow-open") {
      const t = b.supplier === "marchetti" ? "2026-11-02T17:31:09Z" : "2026-11-03T12:15:40Z";
      ctx.cash.add({ ...common, kind: "escrow", time: t, amount: b.currency === "USD" ? { usdc: U(b.grandTotal) } : { gbp: P(b.grandTotal) }, escrow: { email: s.email } });
    } else if (p.via === "scheduled" || p.via === "scheduled-board") {
      ctx.scheduled.push({ bill: b, supplier: s, on: p.on, budget: p.via === "scheduled-board" ? "board" : budget, by: p.by || null, amount: b.currency === "USD" ? b.grandTotal : null });
    }
  }

  // ---------- card spend and bank fees from the Barclays statement ----------
  for (const m of months(START, TODAY)) {
    const hc = headcount(m);
    for (const [day, text, amt, who] of [["03", "CARD PAYMENT TO QUILLMAIL*WORKSPACE IE", r2(11.5 * hc), "Quillmail Workspace"], ["09", "CARD PAYMENT TO PALETTE PRO DUBLIN", r2(56.98 * 4), "Palette Pro"], ["15", "CARD PAYMENT TO RELAY CHAT LTD", r2(6.5 * hc), "Relay Chat Ltd"]]) {
      const d = workday(m.slice(0, 8) + day);
      if (d >= TODAY) continue;
      ctx.cash.add({ kind: "bank_out", time: at(d, 6, 30), amount: { gbp: P(amt) }, bankText: text, title: `${who}: ${monthName(m)}`, counter: [{ account: "6200", dr: P(amt), cc: "Operations" }], voucherType: "Journal Entry", entryType: "Credit Card Entry", purpose: "card" });
    }
    const fd = workday(m);
    if (fd < TODAY) ctx.cash.add({ kind: "bank_out", time: at(fd, 5, 0), amount: { gbp: P(8.5) }, bankText: "ACCOUNT FEE BARCLAYS BUSINESS", title: `Barclays account fee ${monthName(m)}`, counter: [{ account: "6500", dr: P(8.5), cc: "Main" }], voucherType: "Journal Entry", entryType: "Bank Entry", purpose: "fee" });
    if (["01", "04", "07", "10"].includes(m.slice(5, 7)) && fd < TODAY) ctx.cash.add({ kind: "bank_out", time: at(workday(addDays(fd, 2)), 5, 0), amount: { gbp: P(18) }, bankText: "BARCLAYS COMMERCIAL CARD FEE", title: "Commercial card fee", counter: [{ account: "6500", dr: P(18), cc: "Main" }], voucherType: "Journal Entry", entryType: "Bank Entry", purpose: "fee" });
  }

  // ---------- the Travel allowance: Grace books client trips ----------
  const trips = [["Leeds", "PROJ-0005"], ["Bristol", "PROJ-0007"], ["Bristol", "PROJ-0011"], ["Reading", "PROJ-0009"], ["Birmingham", "PROJ-0006"]];
  for (const m of months("2025-10-13", TODAY)) {
    const n = r.int(1, 3);
    for (let k = 0; k < n; k++) {
      const d = workday(addDays(m, r.int(1, 26)));
      if (d < "2025-10-13" || d >= TODAY) continue;
      const live = trips.filter(([, pid]) => { const pd = ctx.projectsDef.find((x) => x.id === pid); return pd.start <= d && pd.end >= d; });
      if (!live.length) continue;
      const [city, pid] = r.pick(live);
      const hotel = r.chance(0.5);
      const amt = hotel ? r2(r.float(95, 165) * r.int(1, 2)) : r2(r.float(40, 160));
      ctx.cash.add({ kind: "usdc_out", from: "treasury", time: at(d, r.int(8, 18), r.int(0, 59)), amount: { gbp: P(amt) }, budget: "travel",
        payee: { type: "Supplier", id: "stayway", name: "Stayway Travel Ltd", handle: "@stayway", safe: ctx.supplierSafe({ id: "stayway", handle: "@stayway" }) },
        expense: { account: "6300", cc: "Delivery", project: pid }, party: "stayway", partyType: "Supplier", voucherType: "Journal Entry", entryType: "Bank Entry", purpose: "travel",
        memo: hotel ? `Hotel in ${city} for the ${ctx.projectsDef.find((x) => x.id === pid).name} team` : `Train tickets to ${city}, ${ctx.projectsDef.find((x) => x.id === pid).name}` });
    }
  }
  return bills;
}

function addMinutesIso(t, n) {
  return new Date(Date.parse(t) + n * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function monthName(d) {
  return new Date(Date.parse(d.slice(0, 7) + "-01")).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function finishPurchases(bills) {
  for (const b of bills) {
    const paid = r2(sum(b.payments, (p) => p.amount));
    b.paidAmount = paid;
    b.outstanding = r2(b.grandTotal - paid);
    b.status = b.outstanding <= 0.004 ? "Paid" : paid > 0 ? "Partly Paid" : b.dueDate < TODAY ? "Overdue" : "Unpaid";
    b.payments = b.payments.map((p) => ({ date: p.date, amount: p.amount, payment: p.payment, voucher: p.voucher, channel: p.channel }));
    delete b.pay;
  }
}
