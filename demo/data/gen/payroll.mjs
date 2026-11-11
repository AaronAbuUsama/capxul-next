// Payroll: UK monthly payroll in GBP, paid from the Treasury in USDC (to Safes, or to banks through Bridge), one run
// and one approval a month on the top department; PAYE and NI to HMRC and pensions to Nest from Barclays; and the
// contractor abroad paid by a USDC pay agreement, outside the runs.
import { rng, addDays, monthEnd, monthStart, daysInMonth, eachDay, months, at, TODAY, START, P, gbp, U, usdc, sum, maxDate, minDate, taxYearStart, inWords, hashOf } from "./util.mjs";
import { isWorking } from "./hr.mjs";

export const COMPONENTS = [
  { name: "Basic Salary", abbr: "BS", type: "Earning", formula: "base", dependsOnPaymentDays: true, account: "5000", description: "Monthly basic salary" },
  { name: "Pension (Employee 5%)", abbr: "PEN", type: "Deduction", formula: "BS * 0.05", account: "2400", owedTo: "Nest Pensions", description: "Employee pension contribution, net pay arrangement" },
  { name: "PAYE Income Tax", abbr: "PAYE", type: "Deduction", formula: "max(0, min(BS - PEN - 1047.5, 3141.67)) * 0.2 + max(0, BS - PEN - 1047.5 - 3141.67) * 0.4", account: "2300", owedTo: "HM Revenue and Customs", description: "Tax code 1257L, monthly" },
  { name: "Employee National Insurance", abbr: "NI", type: "Deduction", formula: "max(0, min(BS, 4189) - 1048) * 0.08 + max(0, BS - 4189) * 0.02", account: "2300", owedTo: "HM Revenue and Customs", description: "Class 1, category A" },
  { name: "Advance Recovery", abbr: "ADVR", type: "Deduction", formula: "(an amount, from an advance's settlement)", account: "1400", description: "The unspent part of an advance" },
  { name: "Employer National Insurance", abbr: "ERNI", type: "Employer Contribution", formula: "max(0, BS - 416.67) * 0.15", account: "5010", liability: "2300", owedTo: "HM Revenue and Customs", description: "Secondary Class 1" },
  { name: "Pension (Employer 3%)", abbr: "ERPEN", type: "Employer Contribution", formula: "BS * 0.03", account: "5020", liability: "2400", owedTo: "Nest Pensions", description: "Employer pension contribution" },
  { name: "Agreement Pay", abbr: "AGP", type: "Earning", formula: "agreement amount", account: "5100", description: "A contractor's pay agreement, collected in USDC" },
];

const r2 = (x) => Math.round(x * 100) / 100;
export function computeSlip(bs, advr = 0) {
  const pen = r2(bs * 0.05);
  const taxable = bs - pen - 1047.5;
  const paye = r2(Math.max(0, Math.min(taxable, 3141.67)) * 0.2 + Math.max(0, taxable - 3141.67) * 0.4);
  const ni = r2(Math.max(0, Math.min(bs, 4189) - 1048) * 0.08 + Math.max(0, bs - 4189) * 0.02);
  const erni = r2(Math.max(0, bs - 416.67) * 0.15);
  const erpen = r2(bs * 0.03);
  const totalDeduction = r2(pen + paye + ni + advr);
  return { bs, pen, paye, ni, advr, erni, erpen, totalDeduction, net: r2(bs - totalDeduction) };
}

export function lastWorkingDay(month) {
  let d = monthEnd(month);
  while (!isWorking(d)) d = addDays(d, -1);
  return d;
}

export function buildPayroll(ctx) {
  const { people, series, ledger, cash } = ctx;
  const r = rng("payroll");
  const staff = people.filter((p) => p.type !== "Contract");
  const out = { components: COMPONENTS };

  out.structures = [
    { name: "UK Monthly 2025/26", isActive: "No", currency: "GBP", payrollFrequency: "Monthly", fromDate: "2025-04-06", docstatus: "Submitted", earnings: ["BS"], deductions: ["PEN", "PAYE", "NI", "ADVR"], employerContributions: ["ERNI", "ERPEN"], paidFrom: "Harbourline Treasury · USDC; bank-paid slips through Bridge", note: "Moved to Capxul on 1 May 2025 with year-to-date figures from the old payroll" },
    { name: "UK Monthly 2026/27", isActive: "Yes", currency: "GBP", payrollFrequency: "Monthly", fromDate: "2026-04-01", docstatus: "Submitted", amends: "UK Monthly 2025/26", earnings: ["BS"], deductions: ["PEN", "PAYE", "NI", "ADVR"], employerContributions: ["ERNI", "ERPEN"], paidFrom: "Harbourline Treasury · USDC; bank-paid slips through Bridge" },
    { name: "Pay agreement", isActive: "Yes", currency: "USDC", payrollFrequency: "Monthly", fromDate: "2026-02-02", docstatus: "Submitted", earnings: ["AGP"], deductions: [], employerContributions: [], paidFrom: "The Engineering budget, collected by the contractor", note: "Contractors on pay agreements are never in a run; each collection is a payslip born paid" },
  ];

  // salary structure assignments
  const assignments = [];
  for (const p of people) {
    const begin = maxDate(p.joined, START);
    if (p.type === "Contract") {
      assignments.push({ employee: p.id, salaryStructure: "Pay agreement", fromDate: p.joined, base: p.agreement, currency: "USDC", paidBy: p.dept });
      continue;
    }
    if (begin < "2026-04-01") {
      const opening = begin === START ? openingYTD(p.base) : null;
      assignments.push({ employee: p.id, salaryStructure: "UK Monthly 2025/26", fromDate: begin, base: p.base, currency: "GBP", paidBy: "harbourline", ...(opening ? { taxableEarningsTillDate: opening.gross, taxDeductedTillDate: opening.paye } : {}) });
      if (p.raise && (!p.relieved || p.relieved >= "2026-04-01")) assignments.push({ employee: p.id, salaryStructure: "UK Monthly 2026/27", fromDate: "2026-04-01", base: p.raise, currency: "GBP", paidBy: "harbourline" });
      else if (!p.relieved || p.relieved >= "2026-04-01") assignments.push({ employee: p.id, salaryStructure: "UK Monthly 2026/27", fromDate: "2026-04-01", base: p.base, currency: "GBP", paidBy: "harbourline" });
    } else {
      assignments.push({ employee: p.id, salaryStructure: "UK Monthly 2026/27", fromDate: begin, base: p.base, currency: "GBP", paidBy: "harbourline" });
    }
  }
  for (const a of assignments) {
    const p = people.find((x) => x.id === a.employee);
    a.annualGross = a.currency === "GBP" ? a.base * 12 : null;
    if (a.currency === "GBP") {
      const s = computeSlip(a.base);
      a.ctc = r2((a.base + s.erni + s.erpen) * 12);
    }
    a.department = p.dept;
    a.costCenter = ctx.deptName(p.dept);
  }
  assignments.sort((a, b) => (a.fromDate < b.fromDate ? -1 : a.fromDate > b.fromDate ? 1 : a.employee < b.employee ? -1 : 1));
  for (const a of assignments) a.name = series.next(`HR-SSA-${a.fromDate.slice(2, 4)}-${a.fromDate.slice(5, 7)}-`);
  out.assignments = assignments;
  const baseOf = (p, d) => {
    const as = assignments.filter((a) => a.employee === p.id && a.fromDate <= d).sort((a, b) => (a.fromDate < b.fromDate ? 1 : -1));
    return as[0];
  };

  // runs and slips
  const runs = [];
  const slips = [];
  const ytd = new Map(); // employee|taxYear -> totals
  const slipCounter = new Map();
  for (const m of months(START, "2026-10-31")) {
    const mEnd = monthEnd(m);
    const posting = lastWorkingDay(m);
    const run = {
      name: null, postingDate: posting, startDate: m, endDate: mEnd, department: "harbourline", currency: "GBP", payrollFrequency: "Monthly", payrollPayable: "2200",
      createdBy: ctx.officerHolders("people", addDays(posting, -5)).slice(-1)[0], createdAt: at(addDays(posting, -4), 10, 12), submittedAt: at(addDays(posting, -2), 15, 40),
      status: "Paid", slips: [], costCenter: "Main",
    };
    run.name = series.next(`HR-PRUN-${posting.slice(0, 4)}-`);
    for (const p of staff) {
      if (p.joined > mEnd || (p.relieved && p.relieved < m)) continue;
      const dim = daysInMonth(m);
      const from = maxDate(p.joined, m);
      const to = minDate(p.relieved || mEnd, mEnd);
      const employedDays = eachDay(from, to).length;
      const lwp = eachDay(from, to).filter((d) => {
        const lv = ctx.leaveDays.get(p.id).get(d);
        return lv && lv.type === "Unpaid Leave" && lv.app.status === "Approved";
      }).length;
      const paymentDays = employedDays - lwp;
      const asg = baseOf(p, to);
      const bs = r2((asg.base * paymentDays) / dim);
      const adv = ctx.advanceRecoveries.filter((x) => x.employee === p.id && x.month === m.slice(0, 7));
      const advr = r2(sum(adv, (x) => x.amount));
      const s = computeSlip(bs, advr);
      const ty = taxYearStart(posting);
      const key = p.id + "|" + ty;
      if (!ytd.has(key)) {
        const asg0 = assignments.find((a) => a.employee === p.id && a.taxableEarningsTillDate !== undefined);
        const op = ty === "2025-04-06" && asg0 ? openingYTD(p.base) : null;
        ytd.set(key, op ? { bs: op.gross, pen: op.pen, paye: op.paye, ni: op.ni, advr: 0, gross: op.gross, ded: op.ded, net: op.net } : { bs: 0, pen: 0, paye: 0, ni: 0, advr: 0, gross: 0, ded: 0, net: 0 });
      }
      const y = ytd.get(key);
      y.bs = r2(y.bs + s.bs); y.pen = r2(y.pen + s.pen); y.paye = r2(y.paye + s.paye); y.ni = r2(y.ni + s.ni); y.advr = r2(y.advr + s.advr);
      y.gross = r2(y.gross + s.bs); y.ded = r2(y.ded + s.totalDeduction); y.net = r2(y.net + s.net);
      const n = (slipCounter.get(p.id) || 0) + 1;
      slipCounter.set(p.id, n);
      const slip = {
        name: `Sal Slip/${p.emp}/${String(n).padStart(5, "0")}`, employee: p.id, department: p.dept, designation: p.desig,
        postingDate: posting, startDate: m, endDate: mEnd, salaryStructure: asg.salaryStructure, payrollEntry: run.name, currency: "GBP",
        payrollFrequency: "Monthly", status: "Submitted", workingDays: dim, paymentDays, leaveWithoutPay: lwp, absentDays: 0,
        earnings: [{ component: "Basic Salary", abbr: "BS", amount: s.bs, ytd: y.bs }],
        deductions: [
          { component: "Pension (Employee 5%)", abbr: "PEN", amount: s.pen, ytd: y.pen },
          { component: "PAYE Income Tax", abbr: "PAYE", amount: s.paye, ytd: y.paye },
          { component: "Employee National Insurance", abbr: "NI", amount: s.ni, ytd: y.ni },
          ...(s.advr ? [{ component: "Advance Recovery", abbr: "ADVR", amount: s.advr, ytd: y.advr, advance: adv.map((a) => a.advance.name).join(", ") }] : []),
        ],
        employerContributions: [{ component: "Employer National Insurance", abbr: "ERNI", amount: s.erni }, { component: "Pension (Employer 3%)", abbr: "ERPEN", amount: s.erpen }],
        grossPay: s.bs, grossYTD: y.gross, totalDeduction: s.totalDeduction, netPay: s.net, netYTD: y.net, totalInWords: inWords(P(s.net)),
        leaveDetails: ctx.leaveDetails(p.id, mEnd), paidTo: p.paidTo, base: asg.base, payment: null, _p: p, _s: s,
      };
      slip.contentHash = hashOf({ slip: slip.name, employee: p.emp, period: [m, mEnd], gross: s.bs, deductions: slip.deductions.map((x) => [x.abbr, x.amount]), net: s.net });
      run.slips.push(slip);
      slips.push(slip);
    }
    runs.push(run);
  }

  // Oliver's final pay is withheld until his laptop comes back
  const oliverSlip = slips.find((s) => s.employee === "oliver" && s.startDate === "2025-08-01");
  if (oliverSlip) {
    oliverSlip.withheld = { reason: "Final pay held until equipment is returned", by: "kwame", at: "2025-08-27T11:02:00Z", releasedAt: "2025-09-05T10:15:00Z", releasedBy: "kwame" };
  }

  // accrual and payment per run
  for (const run of runs) {
    const lines = [];
    const byCc = new Map();
    for (const sl of run.slips) {
      const cc = ctx.deptName(sl.department);
      const x = byCc.get(cc) || { bs: 0, erni: 0, erpen: 0 };
      x.bs += P(sl._s.bs); x.erni += P(sl._s.erni); x.erpen += P(sl._s.erpen);
      byCc.set(cc, x);
    }
    for (const [cc, x] of byCc) {
      lines.push({ account: "5000", dr: x.bs, cc });
      lines.push({ account: "5010", dr: x.erni, cc });
      lines.push({ account: "5020", dr: x.erpen, cc });
    }
    for (const sl of run.slips) lines.push({ account: "2200", cr: P(sl._s.net), party: sl.employee, partyType: "Employee", against: { type: "Salary Slip", ref: sl } });
    const hmrc = sum(run.slips, (sl) => P(sl._s.paye) + P(sl._s.ni) + P(sl._s.erni));
    const pens = sum(run.slips, (sl) => P(sl._s.pen) + P(sl._s.erpen));
    const advr = sum(run.slips, (sl) => P(sl._s.advr));
    lines.push({ account: "2300", cr: hmrc });
    lines.push({ account: "2400", cr: pens });
    if (advr) {
      for (const sl of run.slips.filter((s) => s._s.advr)) lines.push({ account: "1400", cr: P(sl._s.advr), party: sl.employee, partyType: "Employee" });
    }
    run.accrual = ledger.post({ date: run.postingDate, type: "Journal Entry", entryType: "Journal Entry", title: `Payroll accrual ${run.name}`, ref: run, lines });
    run.totals = {
      employees: run.slips.length, gross: gbp(sum(run.slips, (s) => P(s._s.bs))), deductions: gbp(sum(run.slips, (s) => P(s._s.totalDeduction))),
      net: gbp(sum(run.slips, (s) => P(s._s.net))), employerContributions: gbp(sum(run.slips, (s) => P(s._s.erni) + P(s._s.erpen))),
      paye: gbp(sum(run.slips, (s) => P(s._s.paye))), ni: gbp(sum(run.slips, (s) => P(s._s.ni))), erni: gbp(sum(run.slips, (s) => P(s._s.erni))),
      pension: gbp(sum(run.slips, (s) => P(s._s.pen))), erpen: gbp(sum(run.slips, (s) => P(s._s.erpen))), hmrc: gbp(hmrc), pensions: gbp(pens),
    };
    // pay: one command, one approval by the Harbourline hat, one payment per slip
    const toPay = run.slips.filter((s) => !s.withheld);
    const batchId = "batch_" + run.name;
    const approver = ctx.signerFor("harbourline", run.postingDate);
    run.paidBy = approver.who;
    run.paidAt = at(run.postingDate, 16, 2);
    run.batch = batchId;
    toPay.forEach((sl, i) => {
      const p = sl._p;
      const label = `Payroll ${new Date(Date.parse(run.startDate)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`;
      cash.payEmployee({
        person: p, date: run.postingDate, hour: 16, gbpPence: P(sl._s.net), budget: "harbourline", purpose: "payroll", account: "2200",
        against: { type: "Salary Slip", ref: sl }, batch: { id: batchId, label, index: i + 1, count: toPay.length, run: run.name },
        approval: { signer: approver, title: `Pay ${toPay.length} payslips for ${label}` },
        pays: [{ record: "Salary Slip", ref: sl, number: sl.name, date: sl.postingDate, allocated: P(sl._s.net), lines: [{ idx: 1, description: `Net pay ${sl.startDate} to ${sl.endDate}`, amount: P(sl._s.net), vatRate: 0, vat: 0 }] }],
        onSettled: (pay) => { sl.payment = pay; },
      });
    });
    for (const sl of run.slips.filter((s) => s.withheld)) {
      const p = sl._p;
      cash.payEmployee({
        person: p, date: sl.withheld.releasedAt.slice(0, 10), hour: 14, gbpPence: P(sl._s.net), budget: "harbourline", purpose: "payroll", account: "2200",
        against: { type: "Salary Slip", ref: sl }, memo: `Released withheld slip ${sl.name}`,
        pays: [{ record: "Salary Slip", ref: sl, number: sl.name, date: sl.postingDate, allocated: P(sl._s.net), lines: [{ idx: 1, description: `Final net pay ${sl.startDate} to ${sl.endDate}`, amount: P(sl._s.net), vatRate: 0, vat: 0 }] }],
        onSettled: (pay) => { sl.payment = pay; },
      });
    }
    // HMRC by the 22nd and Nest by the 19th of the next month, from Barclays
    const nextM = addDays(run.endDate, 1);
    let hd = nextM.slice(0, 8) + "22";
    while (!isWorking(hd)) hd = addDays(hd, -1);
    let nd = nextM.slice(0, 8) + "19";
    while (!isWorking(nd)) nd = addDays(nd, -1);
    const period = run.startDate.slice(0, 7);
    if (hd <= TODAY) {
      cash.add({ kind: "bank_out", time: at(hd, 7, 30), amount: { gbp: hmrc }, bankText: `HMRC PAYE 120PB00${(4471 + Number(period.replace("-", "")) % 97)} ${period.replace("-", "")}`, title: `PAYE and NI for ${period}`, party: "hmrc", partyType: "Supplier",
        counter: [{ account: "2300", dr: hmrc }], voucherType: "Journal Entry", entryType: "Bank Entry", purpose: "tax", ref: `PAYE ${period}` });
      run.hmrcPaid = hd;
    }
    if (nd <= TODAY) {
      cash.add({ kind: "bank_out", time: at(nd, 6, 10), amount: { gbp: pens }, bankText: `DD NEST PENSIONS HARBOURLINE ${period.replace("-", "")}`, title: `Pensions for ${period}`, party: "nest", partyType: "Supplier",
        counter: [{ account: "2400", dr: pens }], voucherType: "Journal Entry", entryType: "Bank Entry", purpose: "pension", ref: `Nest ${period}` });
      run.nestPaid = nd;
    }
  }

  // contractor pay agreement: Sofia collects 4,800 USDC on the 2nd of each month
  const sofia = people.find((p) => p.id === "sofia");
  const agreement = {
    id: "agr_01JKC4X8V2N6Q9R3T5W7Y0Z1AB", payee: "sofia", amount: sofia.agreement, asset: "USDC", period: "month", budget: "engineering",
    start: sofia.joined, firstCollection: "2026-03-02", offeredBy: "tom", acceptedAt: "2026-01-29T16:40:00Z", status: "Running", collections: [],
  };
  let n = 0;
  for (const m of months("2026-03-01", TODAY)) {
    const d = m.slice(0, 8) + "02";
    if (d > TODAY) break;
    n++;
    const slipName = `Sal Slip/${sofia.emp}/${String(n).padStart(5, "0")}`;
    const slip = {
      name: slipName, employee: "sofia", department: "engineering", designation: sofia.desig, postingDate: d, startDate: addDays(m, -27).slice(0, 8) + "02", endDate: addDays(d, -1),
      salaryStructure: "Pay agreement", payrollEntry: null, currency: "USDC", payrollFrequency: "Monthly", status: "Paid",
      workingDays: null, paymentDays: null, leaveWithoutPay: 0, absentDays: 0, earnings: [{ component: "Agreement Pay", abbr: "AGP", amount: sofia.agreement, ytd: sofia.agreement * n }],
      deductions: [], employerContributions: [], grossPay: sofia.agreement, grossYTD: sofia.agreement * n, totalDeduction: 0, netPay: sofia.agreement, netYTD: sofia.agreement * n,
      totalInWords: `USDC ${sofia.agreement.toLocaleString("en-GB")} only.`, leaveDetails: [], paidTo: "safe", agreement: agreement.id, payment: null, bornPaid: true,
    };
    slip.contentHash = hashOf({ slip: slipName, agreement: agreement.id, amount: sofia.agreement });
    slips.push(slip);
    cash.add({
      kind: "usdc_out", from: "treasury", time: at(d, 6, 0, r.int(0, 59)), amount: { usdc: U(sofia.agreement) }, budget: "engineering", purpose: "agreement", noApproval: true,
      payee: ctx.payeeOfPerson(sofia), expense: { account: "5100", cc: "Engineering" }, party: "sofia", partyType: "Employee", voucherType: "Journal Entry", entryType: "Bank Entry",
      pays: [{ record: "Salary Slip", ref: slip, number: slipName, date: d, allocated: sofia.agreement * 100, currency: "USDC", lines: [{ idx: 1, description: `Pay agreement ${agreement.id}, collection ${n}`, amount: sofia.agreement * 100, vatRate: 0, vat: 0 }] }],
      memo: `Pay agreement collection ${n}`,
      onSettled: (pay) => { slip.payment = pay; agreement.collections.push({ n, at: pay.settledAt, amount: sofia.agreement, payment: pay.id, slip: slipName }); },
    });
  }
  out.agreements = [agreement];
  out.runs = runs;
  out.slips = slips;
  return out;
}

// what the old payroll had paid in April 2025 (the tax year's first month), carried in as year-to-date
function openingYTD(base) {
  const s = computeSlip(base);
  return { gross: s.bs, pen: s.pen, paye: s.paye, ni: s.ni, ded: s.totalDeduction, net: s.net };
}

export function finishPayroll(payroll, ctx) {
  for (const sl of payroll.slips) {
    const pay = sl.payment;
    if (sl.withheld && !pay) sl.status = "Withheld";
    if (pay) {
      sl.status = pay.status === "Money waiting" ? "Escrowed" : "Paid";
      sl.paymentInfo = {
        payment: pay.id, status: pay.status, outcome: pay.outcome || null, amountSent: pay.amount, fee: pay.fee, rate: pay.rate,
        paidTo: pay.payout ? `Bank through Bridge (${sl._p?.bank ? sl._p.bank[0] + " ·· " + sl._p.bank[1].slice(-4) : ""})` : pay._esc ? `Money waiting for ${pay._esc.email}` : "Capxul Safe",
        documentHash: pay.proof?.documentHash || null, tx: pay.proof?.tx || null, block: pay.proof?.block || null, settledAt: pay.settledAt,
        escrow: pay._esc ? { status: pay._esc.status, fundedAt: pay._esc.fundedAt, claimedAt: pay._esc.claimedAt } : null,
        batchIndex: pay.batch ? pay.batch.index : null, batchCount: pay.batch ? pay.batch.count : null,
      };
    }
    delete sl.payment;
    delete sl._p;
    delete sl._s;
  }
  for (const run of payroll.runs) {
    run.slips = run.slips.map((s) => s.name);
    run.payment = {
      approvedBy: run.paidBy, approvedAt: run.paidAt, batch: run.batch,
      paid: payroll.slips.filter((s) => s.payrollEntry === run.name && s.status === "Paid").length,
      escrowed: payroll.slips.filter((s) => s.payrollEntry === run.name && s.status === "Escrowed").length,
      withheld: payroll.slips.filter((s) => s.payrollEntry === run.name && s.status === "Withheld").length,
    };
  }
}
