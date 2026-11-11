// The cash book. Every domain asks for money movements here; the cash book simulates the accounts day by day
// (inserting the top-ups a finance person would make), then renders each movement into Capxul's records
// (payments, escrows, bank payouts, bank deposits), the Safes' chain statements, the Barclays statement and
// balanced vouchers in the ledger.
import {
  rng, ulid, hashOf, hex32, blockAt, ms, iso, isoTime, addDays, at, TODAY, NOW, START, P, U, gbp, usdc, sum, maxDate,
} from "./util.mjs";

const r = rng("money");
const floorTreasury = (d) => (d >= "2025-11-01" ? U(120000) : U(45000));
const FLOOR_BARCLAYS = P(9000);

export const ACCOUNT_OF = { treasury: "1010", reserve: "1020" };

export class CashBook {
  constructor(ctx) {
    this.ctx = ctx;
    this.events = [];
    this.seq = 0;
  }
  add(ev) {
    ev.seq = this.seq++;
    if (!ev.time) throw new Error("cash event without time: " + JSON.stringify(ev).slice(0, 200));
    if (ev.time.slice(0, 10) > TODAY) throw new Error("cash event after today: " + ev.time);
    this.events.push(ev);
    return ev;
  }

  // ---------- convenience creators ----------
  // Pay an employee (claim, advance, final pay): to their Safe in USDC, or to their bank through Bridge.
  payEmployee({ person, date, hour, gbpPence, budget, purpose, account, against, pays, onSettled, batch, approval, memo }) {
    const time = at(date, hour ?? 11, r.int(0, 59), r.int(0, 59));
    const base = {
      time, budget, purpose, batch, approval, memo, onSettled,
      payee: this.ctx.payeeOfPerson(person),
      counter: [{ account, dr: gbpPence, party: person.id, partyType: "Employee", against }],
      pays, voucherType: purpose === "payroll" ? "Journal Entry" : "Payment Entry", entryType: "Bank Entry", paymentType: "Pay",
      party: person.id, partyType: "Employee",
    };
    if (person.paidTo === "bank") {
      return this.add({ ...base, kind: "payout", amount: { gbp: gbpPence }, payout: { status: "Delivered", deliverAt: addMinutes(time, r.int(2, 9)), rail: "Faster Payments" } });
    }
    if (person.noAccountUntil && date < person.noAccountUntil) {
      return this.add({ ...base, kind: "escrow", amount: { gbp: gbpPence }, escrow: { email: person.personal, claimAt: at(person.noAccountUntil, 9, 12, 4) } });
    }
    return this.add({ ...base, kind: "usdc_out", from: "treasury", amount: { gbp: gbpPence } });
  }
  employeeReturns({ person, date, gbpPence, advance }) {
    // the unspent part of an advance comes back to the Treasury from the employee's Safe
    return this.add({
      kind: "usdc_in", to: "treasury", time: at(date, 15, 20, 11), amount: { gbp: gbpPence }, purpose: "advance-return",
      payer: this.ctx.payeeOfPerson(person), counter: [{ account: "1400", cr: gbpPence, party: person.id, partyType: "Employee", against: { type: "Employee Advance", ref: advance } }],
      voucherType: "Payment Entry", paymentType: "Receive", party: person.id, partyType: "Employee",
      pays: [{ record: "Employee Advance", ref: advance, date: advance.postingDate, allocated: gbpPence, lines: [{ idx: 1, description: "Unspent advance returned", amount: gbpPence, vatRate: 0, vat: 0 }] }],
    });
  }

  // ---------- simulation ----------
  prepare(ev) {
    const rate = this.ctx.rate(ev.time.slice(0, 10));
    ev.rate = rate;
    const toUsdc = (pence) => Math.ceil((pence / 100 / rate) * 100) * 10000; // micro, rounded up to the cent
    if (ev.kind === "usdc_out" || ev.kind === "escrow" || ev.kind === "usdc_in" || ev.kind === "safe_transfer") {
      ev.usdc = ev.amount.usdc ?? toUsdc(ev.amount.gbp);
    } else if (ev.kind === "payout") {
      const quote = Math.round(rate * 0.9996 * 1e5) / 1e5;
      ev.quoteRate = quote;
      ev.bank = ev.amount.gbp;
      ev.usdcNet = Math.ceil((ev.bank / 100 / quote) * 100) * 10000;
      ev.fee = U(0.25) + Math.round((ev.usdcNet * 0.0006) / 10000) * 10000;
      ev.usdc = ev.usdcNet + ev.fee;
      if (ev.payout.status === "Refunded") ev.refund = ev.usdc - U(2.4);
    } else if (ev.kind === "deposit") {
      ev.bank = ev.amount.gbp;
      if (ev.deposit.status === "Credited") {
        const gross = Math.round((ev.bank / 100 / rate) * 1e6);
        ev.fee = Math.round((gross * 0.006) / 10000) * 10000;
        ev.usdc = gross - ev.fee;
      } else {
        ev.usdc = 0;
        ev.fee = 0;
      }
    } else if (ev.kind === "bank_in" || ev.kind === "bank_out") {
      ev.bank = ev.amount.gbp;
    }
  }
  effects(ev) {
    // [time, account, delta] for treasury (micro), reserve (micro), barclays (pence)
    const out = [];
    const t = ev.time;
    switch (ev.kind) {
      case "usdc_out":
        out.push([t, ev.from, -ev.usdc]);
        break;
      case "escrow":
        out.push([t, ev.from || "treasury", -ev.usdc]);
        if (ev.escrow.cancelAt) out.push([ev.escrow.cancelAt, ev.from || "treasury", ev.usdc]);
        break;
      case "payout":
        if (ev.payout.status === "Quoted" || ev.payout.status === "Expired") break;
        out.push([t, "treasury", -ev.usdc]);
        if (ev.payout.status === "Refunded") out.push([ev.payout.returnAt, "treasury", ev.refund]);
        if (ev.payee.type === "Self" && ev.payout.status === "Delivered") out.push([ev.payout.deliverAt, "barclays", ev.bank]);
        break;
      case "deposit":
        if (ev.deposit.status === "Credited") out.push([ev.deposit.creditAt, "treasury", ev.usdc]);
        if (ev.deposit.fromBarclays) out.push([t, "barclays", -ev.bank]);
        break;
      case "usdc_in":
        out.push([t, ev.to, ev.usdc]);
        break;
      case "safe_transfer":
        out.push([t, ev.from, -ev.usdc]);
        out.push([t, ev.to, ev.usdc]);
        break;
      case "bank_in":
        out.push([t, "barclays", ev.bank]);
        break;
      case "bank_out":
        out.push([t, "barclays", -ev.bank]);
        break;
    }
    return out;
  }
  simulate(opening) {
    for (const ev of this.events) this.prepare(ev);
    const bal = { treasury: opening.treasury, reserve: opening.reserve, barclays: opening.barclays };
    const days = [];
    for (let d = START; d <= TODAY; d = addDays(d, 1)) days.push(d);
    const effectsByDay = new Map();
    const addEffects = (ev) => {
      for (const e of this.effects(ev)) {
        const d = e[0].slice(0, 10);
        if (!effectsByDay.has(d)) effectsByDay.set(d, []);
        effectsByDay.get(d).push(e);
      }
    };
    for (const ev of this.events) addEffects(ev);
    this.topups = [];
    const lowest = { treasury: Infinity, reserve: Infinity, barclays: Infinity };
    for (const d of days) {
      if (!effectsByDay.has(d)) effectsByDay.set(d, []);
      const eff = effectsByDay.get(d);
      const extra = { treasury: 0, reserve: 0, barclays: 0 };
      const need = (acc) => sum(eff.filter((e) => e[1] === acc && e[2] < 0), (e) => -e[2]);
      const pushEv = (ev) => {
        this.prepare(ev);
        this.add(ev);
        this.topups.push(ev);
        for (const e of this.effects(ev)) {
          const dd = e[0].slice(0, 10);
          if (dd === d) {
            eff.push(e);
            if (e[2] > 0) extra[e[1]] += e[2];
          } else {
            if (!effectsByDay.has(dd)) effectsByDay.set(dd, []);
            effectsByDay.get(dd).push(e);
          }
        }
      };
      // Barclays first: topping it up takes money from the Treasury
      let guard = 0;
      while (bal.barclays + extra.barclays - need("barclays") < FLOOR_BARCLAYS && guard++ < 6) pushEv(this.ctx.topupBarclays(d, bal, need("barclays") - extra.barclays));
      guard = 0;
      while (bal.treasury + extra.treasury - need("treasury") < floorTreasury(d) && guard++ < 6) {
        const ev = this.ctx.topupTreasury(d, bal, need("treasury") - extra.treasury, floorTreasury(d));
        if (!ev) break;
        pushEv(ev);
      }
      eff.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : b[2] - a[2]));
      for (const e of eff) {
        bal[e[1]] += e[2];
        lowest[e[1]] = Math.min(lowest[e[1]], bal[e[1]]);
        if (bal[e[1]] < 0) throw new Error(`${e[1]} goes negative on ${e[0]}: ${bal[e[1]]}`);
      }
    }
    this.closing = bal;
    this.lowest = lowest;
  }

  // ---------- rendering ----------
  render() {
    const ctx = this.ctx;
    const L = ctx.ledger;
    const evs = this.events.slice().sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.seq - b.seq));
    const payments = [];
    const deposits = [];
    const payouts = [];
    const escrows = [];
    const chain = []; // Safe and escrow transfers
    const barclays = []; // Barclays statement lines
    const approvals = [];
    const batches = new Map();

    const approvalFor = (ev) => {
      if (ev.noApproval) return null;
      if (ev.batch && batches.has(ev.batch.id)) return batches.get(ev.batch.id);
      const signer = ev.approval?.signer || ctx.signerFor(ev.budget, ev.time.slice(0, 10), ev.preparedBy);
      const opened = addMinutes(ev.time, -r.int(2, 30));
      const a = {
        id: "approval_" + ulid(ms(opened), r), signer: signer.who, hat: signer.hat, signerSafe: ctx.safeOf(signer.who),
        openedAt: opened, signedAt: addMinutes(ev.time, -1), status: "Done", preparedBy: ev.preparedBy || signer.who,
        title: ev.approval?.title || null, proposal: signer.proposal || null,
      };
      approvals.push(a);
      if (ev.batch) batches.set(ev.batch.id, a);
      return a;
    };

    const glLines = (counter, cashLines, extra = []) => {
      const lines = [...counter.map((c) => ({ ...c })), ...cashLines, ...extra];
      const dr = sum(lines, (l) => Math.round(l.dr || 0));
      const cr = sum(lines, (l) => Math.round(l.cr || 0));
      if (dr !== cr) lines.push(dr > cr ? { account: "6510", cr: dr - cr } : { account: "6510", dr: cr - dr });
      return lines;
    };
    const gbpOf = (micro, rate) => Math.round((micro / 1e6) * rate * 100);

    for (const ev of evs) {
      const d = ev.time.slice(0, 10);
      const rate = ev.rate;
      const fromAcc = ACCOUNT_OF[ev.from || "treasury"];
      if (ev.kind === "usdc_out" || ev.kind === "escrow") {
        const approval = approvalFor(ev);
        const pay = this.newPayment(ev, "out", approval);
        payments.push(pay);
        const cashGbp = gbpOf(ev.usdc, rate);
        const counter = ev.counter || [{ account: ev.expense.account, dr: cashGbp, cc: ev.expense.cc, project: ev.expense.project, party: ev.party, partyType: ev.partyType }];
        if (ev.kind === "usdc_out") {
          pay.status = "Settled";
          pay.voucher = L.post({ date: d, type: ev.voucherType || "Payment Entry", entryType: ev.entryType, paymentType: "Pay", title: pay.counterparty, party: ev.party, partyType: ev.partyType, payment: pay,
            lines: glLines(counter, [{ account: fromAcc, cr: cashGbp, accCr: ev.usdc }]) });
          chain.push(this.transfer(ev, pay, ev.from || "treasury", -ev.usdc, ev.time, pay.counterparty));
          if (ev.onSettled) ev.onSettled(pay);
        } else {
          // money waiting: funding moves the USDC from the Safe to the escrow
          const esc = {
            id: "escrow_" + pay.id.slice(8), payment: pay.id, email: ev.escrow.email, amount: usdc(ev.usdc), from: ev.budget, sentBy: approval ? approval.signer : null,
            fundedAt: ev.time, escrowAddress: hex20(), status: "Open", claimedAt: null, takenBackAt: null, takenBackBy: null,
            reminders: [], what: ev.pays ? ev.pays.map((p) => `${p.record} ${p.ref.name || p.number}`).join(", ") : ev.memo,
          };
          pay.escrow = esc.id;
          pay._esc = esc;
          pay.status = "Money waiting";
          const fund = L.post({ date: d, type: "Journal Entry", entryType: "Contra Entry", title: `Money waiting for ${esc.email}`, payment: pay,
            lines: [{ account: "1030", dr: cashGbp, accDr: ev.usdc }, { account: fromAcc, cr: cashGbp, accCr: ev.usdc }] });
          pay.fundingVoucher = fund;
          chain.push(this.transfer(ev, pay, ev.from || "treasury", -ev.usdc, ev.time, `To money waiting for ${esc.email}`));
          chain.push(this.transfer(ev, pay, "escrow", ev.usdc, ev.time, `Money waiting for ${esc.email}`, esc.escrowAddress));
          const fundDay = d;
          for (const n of [3, 10, 30]) {
            const rd = addDays(fundDay, n);
            const endAt = ev.escrow.claimAt || ev.escrow.cancelAt || NOW;
            if (rd < endAt.slice(0, 10)) esc.reminders.push({ day: n, sentAt: at(rd, 9, 0), to: n === 10 ? "holders" : esc.email });
          }
          if (ev.escrow.claimAt && ev.escrow.claimAt <= NOW) {
            const cd = ev.escrow.claimAt.slice(0, 10);
            const crate = ctx.rate(cd);
            const cg = gbpOf(ev.usdc, crate);
            esc.status = "Claimed";
            esc.claimedAt = ev.escrow.claimAt;
            esc.claimTx = hex32(r);
            esc.claimBlock = blockAt(ev.escrow.claimAt);
            pay.status = "Settled";
            pay.outcome = "Claimed";
            pay.settledAt = ev.escrow.claimAt;
            pay.voucher = L.post({ date: cd, type: ev.voucherType || "Payment Entry", entryType: ev.entryType, paymentType: "Pay", title: pay.counterparty, party: ev.party, partyType: ev.partyType, payment: pay,
              lines: glLines(counter, [{ account: "1030", cr: cg, accCr: ev.usdc }]) });
            chain.push(this.transfer(ev, pay, "escrow", -ev.usdc, ev.escrow.claimAt, `Claimed by ${pay.counterparty}`, esc.escrowAddress, esc.claimTx));
            if (ev.onSettled) ev.onSettled(pay);
          } else if (ev.escrow.cancelAt && ev.escrow.cancelAt <= NOW) {
            const cd = ev.escrow.cancelAt.slice(0, 10);
            const cg = gbpOf(ev.usdc, ctx.rate(cd));
            esc.status = "Taken back";
            esc.takenBackAt = ev.escrow.cancelAt;
            esc.takenBackBy = ev.escrow.cancelBy;
            esc.takeBackTx = hex32(r);
            pay.status = "Cancelled";
            pay.outcome = "Taken back";
            pay.cancelledAt = ev.escrow.cancelAt;
            pay.voucher = L.post({ date: cd, type: "Journal Entry", entryType: "Contra Entry", title: `Taken back from ${esc.email}`, payment: pay,
              lines: [{ account: fromAcc, dr: cg, accDr: ev.usdc }, { account: "1030", cr: cg, accCr: ev.usdc }] });
            chain.push(this.transfer(ev, pay, "escrow", -ev.usdc, ev.escrow.cancelAt, `Taken back by Harbourline`, esc.escrowAddress, esc.takeBackTx));
            chain.push(this.transfer(ev, pay, ev.from || "treasury", ev.usdc, ev.escrow.cancelAt, `Taken back from money waiting (${esc.email})`, null, esc.takeBackTx));
          }
          escrows.push(esc);
        }
      } else if (ev.kind === "payout") {
        const approval = ev.payout.status === "Quoted" ? null : approvalFor(ev);
        const pay = this.newPayment(ev, "out", approval);
        const po = {
          id: "bpo_" + ulid(ms(ev.time), r), payment: pay.id, to: pay.counterparty, payee: ev.payee, bankAmount: gbp(ev.bank), currency: "GBP",
          sent: usdc(ev.usdc), net: usdc(ev.usdcNet), fee: usdc(ev.fee), quoteRate: ev.quoteRate, rail: ev.payout.rail || "Faster Payments",
          from: ev.budget, status: ev.payout.status, reason: ev.payout.reason || null, quotedAt: addMinutes(ev.time, -r.int(1, 6)),
          quoteExpiresAt: addMinutes(ev.time, 10), sentAt: null, deliveredAt: null, returnedAt: null, refund: null, bridgeId: "tr_" + r.hex(12), purpose: ev.purpose,
        };
        pay.payout = po.id;
        payouts.push(po);
        if (ev.payout.status === "Quoted" || ev.payout.status === "Expired") {
          pay.status = ev.payout.status === "Quoted" ? "Prepared" : "Cancelled";
          pay.outcome = ev.payout.status === "Expired" ? "Expired" : null;
          pay.waitingFor = ev.payout.status === "Quoted" ? ctx.signerFor(ev.budget, d) : null;
          pay.proof = null;
          payments.push(pay);
          continue;
        }
        payments.push(pay);
        const cashGbp = gbpOf(ev.usdc, rate);
        const feeGbp = gbpOf(ev.fee, rate);
        po.sentAt = ev.time;
        const v1 = L.post({ date: d, type: "Payment Entry", paymentType: "Internal Transfer", title: `Bank payout to ${pay.counterparty}`, payment: pay,
          lines: glLines([{ account: "1040", dr: ev.bank }, { account: "6500", dr: feeGbp, cc: "Main" }], [{ account: "1010", cr: cashGbp, accCr: ev.usdc }]) });
        pay.fundingVoucher = v1;
        chain.push(this.transfer(ev, pay, "treasury", -ev.usdc, ev.time, `Bank payout to ${pay.counterparty} (via Bridge)`));
        if (ev.payout.status === "Delivered") {
          po.deliveredAt = ev.payout.deliverAt;
          pay.status = "Settled";
          const dd = ev.payout.deliverAt.slice(0, 10);
          const counter = ev.payee.type === "Self" ? [{ account: "1050", dr: ev.bank }] : ev.counter;
          pay.voucher = L.post({ date: dd, type: ev.voucherType === "Journal Entry" ? "Journal Entry" : "Payment Entry", entryType: ev.entryType, paymentType: "Pay", title: pay.counterparty, party: ev.party, partyType: ev.partyType, payment: pay,
            lines: glLines(counter, [{ account: "1040", cr: ev.bank }]) });
          if (ev.payee.type === "Self") barclays.push(this.bankLine(ev.payout.deliverAt, `BRIDGE BUILDING SOL HARBOURLINE TREASURY ${po.bridgeId.slice(3, 11).toUpperCase()}`, ev.bank, 0, pay.voucher, "Transfer from the Treasury (bank payout to yourself)"));
          if (ev.onSettled) ev.onSettled(pay);
        } else if (ev.payout.status === "In transit") {
          pay.status = "Settled";
          pay.outcome = null;
        } else if (ev.payout.status === "Refunded") {
          const rd = ev.payout.returnAt.slice(0, 10);
          const rg = gbpOf(ev.refund, ctx.rate(rd));
          po.returnedAt = ev.payout.returnAt;
          po.refund = usdc(ev.refund);
          pay.status = "Settled";
          pay.outcome = "Returned by the bank";
          pay.voucher = L.post({ date: rd, type: "Payment Entry", paymentType: "Internal Transfer", title: `Payout returned: ${pay.counterparty}`, payment: pay,
            lines: glLines([{ account: "1010", dr: rg, accDr: ev.refund }], [{ account: "1040", cr: ev.bank }]) });
          chain.push(this.transfer(ev, pay, "treasury", ev.refund, ev.payout.returnAt, `Refund of bank payout to ${pay.counterparty} (returned by the bank)`));
        }
      } else if (ev.kind === "deposit") {
        const dep = {
          id: "bdep_" + ulid(ms(ev.time), r), receivedAt: ev.time, from: ev.deposit.sender, payer: ev.payer || null, bankAmount: gbp(ev.bank), currency: ev.deposit.currency || "GBP",
          rail: ev.deposit.rail || "Faster Payments", reference: ev.deposit.reference || null, status: ev.deposit.status, net: ev.usdc ? usdc(ev.usdc) : null,
          fees: ev.fee ? usdc(ev.fee) : null, feeBreakdown: ev.fee ? { capxul: usdc(Math.round((ev.fee * 5) / 6 / 10000) * 10000), exchange: usdc(ev.fee - Math.round((ev.fee * 5) / 6 / 10000) * 10000) } : null,
          match: ev.deposit.match || "Unmatched", matchedTo: [], creditedAt: ev.deposit.creditAt || null, tx: null, block: null, bridgeId: "dep_" + r.hex(12), purpose: ev.purpose,
        };
        deposits.push(dep);
        if (ev.deposit.status === "Credited") {
          const cg = gbpOf(ev.usdc, rate);
          const fg = ev.bank - cg;
          const counter = ev.counter || [{ account: "4999", cr: ev.bank, cc: "Main" }];
          const pay = this.newPayment(ev, "in", null);
          pay.kind = "movement";
          pay.status = "Settled";
          pay.deposit = dep.id;
          payments.push(pay);
          dep.payment = pay.id;
          dep.voucher = L.post({ date: ev.deposit.creditAt.slice(0, 10), type: "Payment Entry", paymentType: ev.deposit.fromBarclays ? "Internal Transfer" : "Receive", title: `Bridge deposit from ${dep.from}`, party: ev.party, partyType: ev.partyType, payment: pay,
            lines: glLines(counter, [{ account: "1010", dr: cg, accDr: ev.usdc }, { account: "6500", dr: fg, cc: "Main" }]) });
          pay.voucher = dep.voucher;
          const tr = this.transfer(ev, pay, "treasury", ev.usdc, ev.deposit.creditAt, `Received via Bridge from ${dep.from}`);
          chain.push(tr);
          dep.tx = tr.tx;
          dep.block = tr.block;
          if (ev.pays) dep.matchedTo = ev.pays.map((p) => p.ref);
          if (ev.deposit.fromBarclays) barclays.push(this.bankLine(ev.time, `FP HARBOURLINE STUDIO ${ev.deposit.reference || "TREASURY"}`, 0, ev.bank, dep.voucher, "Transfer to the Treasury through Bridge"));
          if (ev.onSettled) ev.onSettled(pay);
        }
      } else if (ev.kind === "usdc_in") {
        const pay = this.newPayment(ev, "in", null);
        pay.status = "Settled";
        payments.push(pay);
        const toAcc = ACCOUNT_OF[ev.to];
        const cg = gbpOf(ev.usdc, rate);
        pay.voucher = L.post({ date: d, type: ev.voucherType || "Payment Entry", entryType: ev.entryType, paymentType: "Receive", title: pay.counterparty, party: ev.party, partyType: ev.partyType, payment: pay,
          lines: glLines(ev.counter, [{ account: toAcc, dr: cg, accDr: ev.usdc }]) });
        chain.push(this.transfer(ev, pay, ev.to, ev.usdc, ev.time, ev.description || `Payment from ${pay.counterparty}`));
        if (ev.onSettled) ev.onSettled(pay);
      } else if (ev.kind === "safe_transfer") {
        const pay = this.newPayment(ev, "between", null);
        pay.status = "Settled";
        payments.push(pay);
        const cg = gbpOf(ev.usdc, rate);
        pay.voucher = L.post({ date: d, type: "Journal Entry", entryType: "Contra Entry", title: ev.memo, payment: pay,
          lines: [{ account: ACCOUNT_OF[ev.to], dr: cg, accDr: ev.usdc }, { account: ACCOUNT_OF[ev.from], cr: cg, accCr: ev.usdc }] });
        const tx = hex32(r);
        chain.push(this.transfer(ev, pay, ev.from, -ev.usdc, ev.time, `To the ${ev.to === "treasury" ? "Treasury" : "Reserve Safe"} (Board proposal ${ev.proposal?.id || ""})`.trim(), null, tx));
        chain.push(this.transfer(ev, pay, ev.to, ev.usdc, ev.time, `From the ${ev.from === "reserve" ? "Reserve Safe" : "Treasury"} (Board proposal ${ev.proposal?.id || ""})`.trim(), null, tx));
      } else if (ev.kind === "bank_in" || ev.kind === "bank_out") {
        const lines = ev.kind === "bank_in" ? [{ account: "1050", dr: ev.bank }] : [{ account: "1050", cr: ev.bank }];
        const v = L.post({ date: d, type: ev.voucherType || "Payment Entry", entryType: ev.entryType, paymentType: ev.kind === "bank_in" ? "Receive" : "Pay", title: ev.title || ev.bankText, party: ev.party, partyType: ev.partyType, bankRef: ev.ref,
          lines: glLines(ev.counter, lines) });
        ev.voucher = v;
        barclays.push(this.bankLine(ev.clearAt || ev.time, ev.bankText, ev.kind === "bank_in" ? ev.bank : 0, ev.kind === "bank_out" ? ev.bank : 0, v, ev.title, ev.party, ev.partyType, ev.ref));
        if (ev.onSettled) ev.onSettled({ voucher: v, bank: true });
      }
    }
    return { payments, deposits, payouts, escrows, chain, barclays, approvals };
  }

  newPayment(ev, direction, approval) {
    const ctx = this.ctx;
    const id = "payment_" + ulid(ms(ev.time) - r.int(30000, 90000), r);
    const pay = {
      id, direction, kind: "payment", status: "Prepared", outcome: null, purpose: ev.purpose || null,
      route: routeOf(ev, direction), budget: ev.budget || null,
      counterparty: direction === "in" ? (ev.payer?.name || ev.deposit?.sender || "") : direction === "between" ? (ev.to === "treasury" ? "Treasury" : "Reserve Safe") : ev.payee.name,
      payee: direction === "out" ? ev.payee : { type: "Self", name: "Harbourline Studio Ltd", safe: ctx.safes[ev.to || "treasury"].address },
      payer: direction === "out" || direction === "between" ? { type: "Self", name: "Harbourline Studio Ltd", safe: ctx.safes[ev.from || "treasury"].address, label: ev.from === "reserve" ? "Reserve Safe" : "Treasury" } : ev.payer || null,
      amount: usdc(ev.usdc), asset: "USDC", amountRaw: String(ev.usdc), gbp: null, rate: ev.rate, fee: ev.fee ? usdc(ev.fee) : 0,
      createdAt: addMinutes(ev.time, -r.int(1, 4)), sentAt: ev.time, settledAt: ev.time,
      approval: approval ? approval.id : null, approvedBy: approval ? approval.signer : null, approvedHat: approval ? approval.hat : null,
      preparedBy: ev.preparedBy || (approval ? approval.preparedBy : null), proposal: ev.proposal?.id || null,
      batch: ev.batch ? { id: ev.batch.id, label: ev.batch.label, index: ev.batch.index, count: ev.batch.count } : null,
      memo: ev.memo || null, account: null, proof: null, books: null,
    };
    if (ev.kind === "payout") pay.gbp = gbp(ev.bank);
    else if (ev.kind === "deposit") pay.gbp = gbp(ev.bank);
    else pay.gbp = ev.amount.gbp !== undefined ? gbp(ev.amount.gbp) : Math.round((ev.usdc / 1e6) * ev.rate * 100) / 100;
    // proof: what the document hash commits to
    if (ev.kind !== "deposit" && ev.kind !== "safe_transfer") {
      const advice = {
        version: 1, origin: id, salt: "0x" + r.hex(16),
        payer: { party: direction === "in" ? (ev.payer?.party || null) : ctx.partyOfCompany, account: pay.payer?.safe || null },
        payee: direction === "in" ? { party: ctx.partyOfCompany, account: ctx.safes[ev.to || "treasury"].address } : { party: ev.payee.party || null, account: ev.kind === "payout" ? "bridge:" + (ev.payee.bank?.last4 || "") : (ev.payee.safe || null), mailbox: ev.kind === "escrow" ? ev.escrow.email : undefined },
        token: "USDC", amount: String(ev.usdc),
        cash: { currency: "GBP", decimals: 2, amount: ev.kind === "payout" ? ev.bank : (ev.amount.gbp ?? Math.round((ev.usdc / 1e6) * ev.rate * 100)), rate: ev.rate },
        allocations: (ev.pays || []).map((p) => ({
          record: p.record, doc: p.ref.name || p.number, currency: p.currency || "GBP", number: p.number || p.ref.billNo || p.ref.name, date: p.date,
          content: p.ref.contentHash || hashOf({ doc: p.ref.name || p.number }), allocated: p.allocated,
          lines: (p.lines || []).map((l) => ({ idx: l.idx, description: l.description, amount: l.amount, taxes: l.vat ? [{ name: "VAT", bps: l.vatRate || 2000, amount: l.vat }] : [] })),
        })),
        adjustments: ev.kind === "payout" ? [{ kind: "fee", by: "Bridge", amount: String(ev.fee) }] : [],
        onAccount: 0, memo: ev.memo || "", refundOf: "0x0",
        route: { kind: pay.route, budget: ev.budget || null, payAt: 0, payout: ev.kind === "payout" ? { bankAmount: ev.bank, currency: "GBP", rail: ev.payout.rail || "Faster Payments" } : undefined },
        batch: ev.batch ? { id: ev.batch.id, index: ev.batch.index, count: ev.batch.count } : null,
      };
      const documentHash = hashOf(advice);
      pay.proof = {
        network: "Base", chainId: 8453, paymentId: hashOf({ terms: id, amount: ev.usdc, payee: advice.payee, documentHash }),
        documentHash, tx: null, block: null, logIndex: null, settledThrough: pay.route === "board" ? "Board proposal" : pay.route === "money-waiting" ? "Money waiting (escrow)" : pay.budget ? `Budgets (${pay.budget})` : "Direct", finality: "Final",
        advice,
      };
    }
    return pay;
  }

  transfer(ev, pay, account, delta, time, description, escrowAddress = null, tx = null) {
    const t = {
      account, time, block: blockAt(time), tx: tx || hex32(r), logIndex: r.int(3, 240), direction: delta < 0 ? "out" : "in",
      amount: usdc(Math.abs(delta)), micro: delta, description, reference: pay ? pay.id : null, counterparty: pay ? pay.counterparty : null, escrowAddress,
    };
    if (pay && pay.proof && !pay.proof.tx) {
      pay.proof.tx = t.tx;
      pay.proof.block = t.block;
      pay.proof.logIndex = t.logIndex;
    }
    return t;
  }
  bankLine(time, text, deposit, withdrawal, voucher, note, party, partyType, ref) {
    return { date: time.slice(0, 10), time, description: text, deposit: gbp(deposit), withdrawal: gbp(withdrawal), voucher, note: note || null, party: party || null, partyType: partyType || null, reference: ref || null };
  }
}

function routeOf(ev, direction) {
  if (direction === "between") return "board";
  if (direction === "in") return ev.kind === "deposit" ? "outside" : "chain";
  if (ev.kind === "escrow") return "money-waiting";
  if (ev.budget === "board") return "board";
  if (ev.purpose === "agreement") return "agreement";
  if (["subscriptions", "capxul", "travel"].includes(ev.budget)) return "allowance";
  return ev.budget ? "department" : "personal";
}
export function addMinutes(t, n) {
  return isoTime(Date.parse(t) + n * 60000);
}
function hex20() {
  return "0x" + r.hex(20);
}
