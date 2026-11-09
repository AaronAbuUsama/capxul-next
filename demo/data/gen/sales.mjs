// Sales: opening invoices, monthly time-and-materials invoices from timesheets, retainers in advance, fixed fees,
// a deposit invoice; then each customer's paying habits, as cash movements on the channel they use.
import { rng, addDays, monthEnd, months, at, TODAY, START, P, U, gbp, sum, r2, inWords, hashOf, maxDate, minDate } from "./util.mjs";
import { isWorking } from "./hr.mjs";
import { billingRate } from "./projects.mjs";

function firstWorkingDay(d) {
  while (!isWorking(d)) d = addDays(d, 1);
  return d;
}
export function rfReference(seq, year) {
  const ref = `HL${String(year).slice(2)}${String(seq).padStart(4, "0")}`;
  const conv = (ref + "RF00").replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let mod = 0;
  for (const ch of conv) mod = (mod * 10 + Number(ch)) % 97;
  const check = String(98 - mod).padStart(2, "0");
  const s = `RF${check}${ref}`;
  return s.replace(/(.{4})/g, "$1 ").trim();
}

export function buildSales(ctx) {
  const { series, ledger, customers } = ctx;
  const r = rng("sales");
  const invoices = [];
  const cust = (id) => customers.find((c) => c.id === id);

  const make = (o) => {
    const c = cust(o.customer);
    const currency = c.currency;
    const conv = currency === "USD" ? ctx.rate(o.postingDate) : 1;
    const items = o.items.map((it, i) => ({ idx: i + 1, uom: "Hour", ...it, amount: r2(it.qty * it.rate) }));
    const net = r2(sum(items, (i) => i.amount));
    const vatRate = c.reverseCharge ? 0 : 20;
    const vat = r2(net * vatRate / 100);
    const inv = {
      customer: c.id, customerName: c.name, postingDate: o.postingDate, dueDate: o.dueDate || addDays(o.postingDate, c.terms), currency, conversionRate: conv,
      isOpening: !!o.isOpening, originalDate: o.originalDate || null, project: o.project || null, costCenter: o.costCenter, items, timesheets: o.timesheets || [],
      totalQty: r2(sum(items, (i) => (i.uom === "Hour" ? i.qty : 0))), netTotal: net,
      taxes: vatRate ? [{ type: "On Net Total", account: "2101", rate: vatRate, taxAmount: vat, total: r2(net + vat), description: "VAT 20%" }] : [],
      taxNote: c.reverseCharge ? (c.territory === "United States" ? "Outside the scope of UK VAT (services to a business outside the UK)" : "Reverse charge: customer to account for VAT (Article 196, Council Directive 2006/112/EC)") : null,
      totalTaxes: vat, grandTotal: r2(net + vat), baseNetTotal: r2(net * conv), baseTotalTaxes: r2(vat * conv), baseGrandTotal: r2((net + vat) * conv),
      inWords: inWords(P(net + vat), currency), paymentTerms: `Net ${c.terms}`, debitTo: "1200", remarks: o.remarks || null,
      createdBy: o.createdBy, payments: [], outstanding: r2(net + vat), status: "Unpaid", requestSent: null, plan: o.plan || null, kind: o.kind,
    };
    invoices.push(inv);
    return inv;
  };

  // opening invoices carried in from the old books
  make({ customer: "fernhill", postingDate: "2025-04-30", originalDate: "2025-04-01", dueDate: "2025-05-01", isOpening: true, project: "PROJ-0001", costCenter: "Delivery", kind: "opening",
    items: [{ item: "Engineering services", description: "Fernhill field app: March 2025 (opening balance)", qty: 1, uom: "Nos", rate: 17850, incomeAccount: "3990" }], createdBy: "maya", remarks: "Opening invoice: issued 1 Apr 2025 in the old books" });
  make({ customer: "fernhill", postingDate: "2025-04-30", originalDate: "2025-04-30", dueDate: "2025-05-30", isOpening: true, project: "PROJ-0001", costCenter: "Delivery", kind: "opening",
    items: [{ item: "Engineering services", description: "Fernhill field app: April 2025 (opening balance)", qty: 1, uom: "Nos", rate: 19200, incomeAccount: "3990" }], createdBy: "maya", remarks: "Opening invoice: issued 30 Apr 2025 in the old books" });

  // time and materials, monthly in arrears, from the timesheets' billable logs
  const billers = (d) => ctx.officerHolders("invoicing", d);
  for (const def of ctx.projectsDef.filter((p) => p.billing === "tm")) {
    for (const m of months(maxDate(def.start, START), "2026-10-31")) {
      const mEnd = monthEnd(m);
      const logs = ctx.logs.filter((l) => l.project === def.id && l.billingHours > 0 && l.date >= m && l.date <= mEnd && !l.invoice);
      if (!logs.length) continue;
      const groups = new Map();
      for (const l of logs) {
        const k = `${l.activity}|${l.billingRate}`;
        if (!groups.has(k)) groups.set(k, { activity: l.activity, rate: l.billingRate, hours: 0, logs: [] });
        const g = groups.get(k);
        g.hours = r2(g.hours + l.hours);
        g.logs.push(l);
      }
      let posting = mEnd;
      while (!isWorking(posting)) posting = addDays(posting, -1);
      if (posting > TODAY) continue;
      const monthName = new Date(Date.parse(m)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
      const designy = def.dept === "design";
      const items = [...groups.values()].sort((a, b) => b.hours - a.hours).map((g) => ({
        item: g.activity === "Engineering" ? "Engineering services" : g.activity === "Design" || g.activity === "Research" ? "Design services" : designy ? "Design services" : "Engineering services",
        description: `${g.activity}: ${def.name}, ${monthName}`, qty: g.hours, rate: g.rate,
        incomeAccount: g.activity === "Engineering" ? "4000" : g.activity === "Design" || g.activity === "Research" ? "4100" : designy ? "4100" : "4000",
        costCenter: ctx.deptName(def.dept), project: def.id, _logs: g.logs,
      }));
      const by = billers(posting);
      const inv = make({ customer: def.customer, postingDate: posting, project: def.id, costCenter: ctx.deptName(def.dept), items, kind: "timesheets", createdBy: by.includes("leo") && posting >= "2026-01-19" ? r.pick(["leo", "maya", "kwame"]) : r.pick(by) });
      const tsMap = new Map();
      for (const it of inv.items) {
        for (const l of it._logs) {
          l.invoice = inv;
          const k = l.timesheet.name + "|" + l.activity;
          if (!tsMap.has(k)) tsMap.set(k, { timesheet: l.timesheet, activity: l.activity, billingHours: 0, billingAmount: 0 });
          const x = tsMap.get(k);
          x.billingHours = r2(x.billingHours + l.hours);
          x.billingAmount = r2(x.billingAmount + l.billingAmount);
        }
        delete it._logs;
      }
      inv.timesheets = [...tsMap.values()];
      inv.billedWith = `capxul org projects timesheet bill ${[...new Set(inv.timesheets.map((t) => t.timesheet))].length} timesheets`;
    }
  }
  // retainers, monthly in advance
  const retainers = [
    ...ctx.projectsDef.filter((p) => p.billing === "retainer").map((p) => ({ customer: p.customer, project: p.id, name: p.name, start: p.start, monthly: p.retainer, cc: ctx.deptName(p.dept) })),
    ...ctx.retainers.map((x) => ({ customer: x.customer, project: x.project, name: x.name, start: x.start, monthly: x.monthly, cc: "Engineering" })),
  ];
  for (const rt of retainers) {
    for (const m of months(rt.start, TODAY)) {
      const posting = firstWorkingDay(m);
      if (posting > TODAY) continue;
      const monthName = new Date(Date.parse(m)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
      make({ customer: rt.customer, postingDate: posting, project: rt.project, costCenter: rt.cc, kind: "retainer", createdBy: r.pick(billers(posting)),
        items: [{ item: "Retainer", description: `${rt.name}: ${monthName}`, qty: 1, uom: "Month", rate: rt.monthly, incomeAccount: "4200", costCenter: rt.cc, project: rt.project }] });
    }
  }
  // fixed fees
  for (const f of ctx.fixedFees) {
    const c = cust(f.customer);
    make({ customer: f.customer, postingDate: f.date, costCenter: f.cc, kind: "fixed", createdBy: r.pick(billers(f.date)),
      items: [{ item: f.account === "4000" ? "Engineering services" : "Design services", description: f.item, qty: 1, uom: "Nos", rate: c.currency === "USD" ? f.amount : f.amount, incomeAccount: f.account, costCenter: f.cc }] });
  }
  // Saltmarsh: 30% deposit at kick-off
  make({ customer: "saltmarsh", postingDate: "2026-10-30", project: "PROJ-0010", costCenter: "Design", kind: "fixed", createdBy: "leo",
    items: [{ item: "Design services", description: "Saltmarsh online shop: 30% deposit on the fixed fee of £38,000", qty: 1, uom: "Nos", rate: 11400, incomeAccount: "4100", costCenter: "Design", project: "PROJ-0010" }] });

  // names, references, content hashes and the books
  invoices.sort((a, b) => (a.postingDate < b.postingDate ? -1 : a.postingDate > b.postingDate ? 1 : a.customer < b.customer ? -1 : 1));
  for (const inv of invoices) {
    inv.name = series.next(`ACC-SINV-${inv.postingDate.slice(0, 4)}-`);
    const seq = Number(inv.name.slice(-5));
    inv.rfReference = rfReference(seq, Number(inv.postingDate.slice(0, 4)));
    inv.contentHash = hashOf({ doc: inv.name, customer: inv.customerName, date: inv.postingDate, items: inv.items.map((i) => [i.description, i.qty, i.rate, i.amount]), taxes: inv.taxes.map((t) => [t.rate, t.taxAmount]), total: inv.grandTotal, currency: inv.currency });
    const lines = [{ account: "1200", dr: P(inv.baseGrandTotal), party: inv.customer, partyType: "Customer", against: { type: "Sales Invoice", ref: inv } }];
    if (inv.isOpening) {
      lines.push({ account: "3990", cr: P(inv.baseGrandTotal) });
    } else {
      // income lines in base currency; make the pence add up exactly
      let left = P(inv.baseNetTotal);
      inv.items.forEach((it, i) => {
        const amt = i === inv.items.length - 1 ? left : P(it.amount * inv.conversionRate);
        left -= amt;
        lines.push({ account: it.incomeAccount, cr: amt, cc: it.costCenter || inv.costCenter, project: it.project || inv.project });
      });
      if (inv.totalTaxes) lines.push({ account: "2101", cr: P(inv.baseGrandTotal) - P(inv.baseNetTotal) });
      else if (P(inv.baseGrandTotal) !== P(inv.baseNetTotal)) lines.push({ account: inv.items[0].incomeAccount, cr: P(inv.baseGrandTotal) - P(inv.baseNetTotal) });
    }
    inv.voucher = ledger.post({ date: inv.postingDate, type: "Sales Invoice", ref: inv, title: `${inv.name} ${inv.customerName}`, party: inv.customer, partyType: "Customer", lines });
    if (!inv.isOpening) inv.requestSent = at(inv.postingDate, 10, r.int(5, 50));
  }

  // ---------- who pays when ----------
  for (const inv of invoices) {
    const c = cust(inv.customer);
    const planned = [];
    const days = r.int(c.payDays[0], c.payDays[1]);
    let payDay = addDays(inv.postingDate, days);
    if (inv.isOpening) payDay = inv.originalDate === "2025-04-01" ? "2025-05-06" : "2025-06-02";
    const split = c.partial && r.chance(c.partial) && inv.grandTotal > 3000;
    if (split) {
      const first = r2(Math.round((inv.grandTotal * r.pick([0.4, 0.5, 0.6])) / 100) * 100);
      planned.push([payDay, first], [addDays(payDay, r.int(12, 30)), r2(inv.grandTotal - first)]);
    } else planned.push([payDay, inv.grandTotal]);
    inv._plan = planned;
  }
  // stories at today
  const osprey = invoices.filter((i) => i.customer === "osprey" && !i.isOpening);
  const ospLast = osprey[osprey.length - 1];
  if (ospLast) ospLast._plan = [[addDays(ospLast.postingDate, 52), r2(Math.round(ospLast.grandTotal * 0.5 / 100) * 100)]];
  const calder = invoices.filter((i) => i.customer === "calder");
  const cLast = calder[calder.length - 1];
  if (cLast) cLast._plan = [[addDays(cLast.postingDate, 48), 6000], [addDays(cLast.postingDate, 79), 4000], [addDays(cLast.postingDate, 101), r2(cLast.grandTotal - 10000)]];
  const lark = invoices.filter((i) => i.customer === "larkspur");
  const larkLast = lark[lark.length - 1];
  if (larkLast) larkLast._plan = [[addDays(larkLast.postingDate, 30), larkLast.grandTotal]];
  const salt = invoices.find((i) => i.customer === "saltmarsh");
  if (salt) salt._plan = [];
  const ald = invoices.filter((i) => i.customer === "aldermoor" && i.postingDate >= "2026-09-01");
  for (const a of ald) a._plan = a._plan.map(([d, x]) => [addDays(d, 6), x]);

  for (const inv of invoices) {
    const c = cust(inv.customer);
    for (const [d0, amount] of inv._plan) {
      let d = d0;
      while (!isWorking(d)) d = addDays(d, 1);
      if (d > TODAY || (d === TODAY)) continue;
      const share = amount / inv.grandTotal;
      const baseAlloc = inv.currency === "USD" ? Math.round(P(inv.baseGrandTotal) * share) : P(amount);
      const counter = [{ account: "1200", cr: baseAlloc, party: inv.customer, partyType: "Customer", against: { type: "Sales Invoice", ref: inv } }];
      const pays = [{ doctype: "Sales Invoice", ref: inv, number: inv.name, date: inv.postingDate, allocated: P(amount), currency: inv.currency, lines: inv.items.map((it) => ({ idx: it.idx, description: it.description, amount: P(it.amount), vatRate: inv.totalTaxes ? 2000 : 0, vat: inv.totalTaxes ? P(it.amount * 0.2) : 0 })) }];
      const onSettled = (pay) => {
        inv.payments.push({ date: d, amount, payment: pay.id || null, voucher: pay.voucher, channel });
      };
      const channel = c.channel === "barclays" && c.switchToBridge && d >= c.switchToBridge ? "bridge" : c.channel;
      const time = at(d, r.int(8, 16), r.int(0, 59), r.int(0, 59));
      if (channel === "barclays") {
        ctx.cash.add({ kind: "bank_in", time, amount: { gbp: P(amount) }, bankText: `BACS ${c.name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 22)} ${inv.name.slice(-9)}`, title: `Receipt from ${c.name}`, party: c.id, partyType: "Customer", counter, purpose: "receipt", ref: inv.name, pays,
          onSettled: (x) => inv.payments.push({ date: d, amount, payment: null, voucher: x.voucher, channel: "Barclays" }) });
      } else if (channel === "bridge") {
        ctx.cash.add({ kind: "deposit", time, amount: { gbp: P(amount) }, deposit: { status: "Credited", creditAt: at(d, Number(time.slice(11, 13)), Math.min(59, Number(time.slice(14, 16)) + 3), 12), sender: c.name.toUpperCase().replace(/[^A-Z0-9& ]/g, "").slice(0, 28), reference: inv.rfReference, rail: "Faster Payments", match: "Matched", currency: "GBP" },
          payer: { name: c.name, party: null }, party: c.id, partyType: "Customer", counter, purpose: "receipt", pays,
          onSettled: (pay) => inv.payments.push({ date: d, amount, payment: pay.id, voucher: pay.voucher, channel: "Bridge" }) });
      } else {
        const safe = ctx.customerSafe(c);
        ctx.cash.add({ kind: "usdc_in", to: "treasury", time, amount: inv.currency === "USD" ? { usdc: U(amount) } : { gbp: P(amount) },
          payer: { name: channel === "link" ? `${c.name} (pay link)` : c.name, handle: c.handle || null, safe, party: c.handle ? hashOf({ party: c.handle }).slice(0, 42) : null }, party: c.id, partyType: "Customer", counter, purpose: "receipt", pays,
          description: channel === "link" ? `Paid at the request's pay link by ${c.name}` : `Payment from ${c.name}`,
          onSettled: (pay) => inv.payments.push({ date: d, amount, payment: pay.id, voucher: pay.voucher, channel: channel === "link" ? "Pay link" : "Capxul" }) });
      }
    }
    delete inv._plan;
  }

  // deposits that match nothing, or never arrive
  ctx.cash.add({ kind: "deposit", time: "2026-11-04T15:07:22Z", amount: { gbp: P(640) }, deposit: { status: "Credited", creditAt: "2026-11-04T15:10:40Z", sender: "PAYPAL *HARBOURLN", reference: "PPX4471920", rail: "Faster Payments", match: "Unmatched", currency: "GBP" },
    payer: { name: "PAYPAL *HARBOURLN" }, counter: [{ account: "4999", cr: P(640), cc: "Main" }], purpose: "unknown" });
  ctx.cash.add({ kind: "deposit", time: "2026-10-21T08:02:10Z", amount: { gbp: P(1) }, deposit: { status: "Below minimum", sender: "R PATEL", reference: "TEST", rail: "Faster Payments", match: "Not a request", currency: "GBP" }, payer: { name: "R PATEL" }, purpose: "unknown" });
  ctx.cash.add({ kind: "deposit", time: "2026-10-14T13:30:00Z", amount: { gbp: P(237.18) }, deposit: { status: "Returned", sender: "(unknown sender)", reference: "INV 2291", rail: "ACH", match: "Not a request", currency: "USD", note: "$300.00 with no reference Harbourline recognised; returned to the sender" }, payer: { name: "(unknown sender)" }, purpose: "unknown" });
  if (salt) {
    ctx.arriving = { id: "bdep_arriving", receivedAt: "2026-11-09T10:20:31Z", from: "SALTMARSH DISTILLERY LTD", bankAmount: salt.grandTotal, currency: "GBP", rail: "Faster Payments", reference: salt.rfReference, status: "Arriving", net: null, fees: null, match: "Matches by reference", matchedTo: [salt.name] };
  }
  return invoices;
}

export function finishSales(invoices) {
  for (const inv of invoices) {
    const paid = r2(sum(inv.payments, (p) => p.amount));
    inv.paidAmount = paid;
    inv.outstanding = r2(inv.grandTotal - paid);
    inv.status = inv.outstanding <= 0.004 ? "Paid" : paid > 0 ? (inv.dueDate < TODAY ? "Overdue" : "Partly Paid") : inv.dueDate < TODAY ? "Overdue" : "Unpaid";
    if (inv.outstanding > 0 && paid > 0 && inv.dueDate < TODAY) inv.status = "Overdue";
    inv.payments = inv.payments.map((p) => ({ date: p.date, amount: p.amount, payment: p.payment, voucher: p.voucher, channel: p.channel }));
  }
}
