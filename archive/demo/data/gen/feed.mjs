// What people see first: the approvals waiting for each hat, the FDE's conversations (scripted, from the real
// figures), notices, the company's events, and the money activity feed.
import { rng, addDays, at, TODAY, NOW, START, months, r2, ulid, ms, sum, minDate } from "./util.mjs";

const f2 = (x) => Number(x).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gb = (x) => "£" + f2(x);

export function buildFDE(ctx, d) {
  const r = rng("fde");
  const turn = (t) => "turn_" + ulid(ms(t), r);
  const q4 = (id) => d.departments.find((x) => x.id === id).budgets.find((b) => b.quarter === "2026-Q4");
  const eng = q4("engineering");
  const engPct = Math.round(((eng.spent + eng.committed) / eng.amount) * 100);
  const engPays = d.payments.filter((p) => p.budget === "engineering" && p.direction === "out" && p.sentAt >= "2026-10-01");
  const byWho = new Map();
  for (const p of engPays) byWho.set(p.counterparty, r2((byWho.get(p.counterparty) || 0) + p.amount));
  const top = [...byWho.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const hannahSlip = d.slips.find((s) => s.employee === "hannah");
  const hannahPay = d.payments.find((p) => p._esc && p._esc.email === "hannah.cole@gmail.com");
  const cap = d.allowances.find((a) => a.id === "capxul");
  const capNov = cap.months.find((m) => m.month === "2026-11");
  const bright = d.payouts.find((p) => p.status === "Quoted");
  const brightBill = d.purchaseInvoices.find((b) => b.supplier === "brightfield" && b.status !== "Paid");
  const jules = d.payments.find((p) => p._esc && p._esc.email === "jules.marchetti@proton.me");
  const hollisBills = d.purchaseInvoices.filter((b) => b.supplier === "hollis");
  const treasury = d.safes.treasury.balance;
  const reserve = d.safes.reserve.balance;
  const barclays = d.bankAccounts[0].balance;
  const rate = ctx.rate(TODAY);
  const burnMonths = d.reports.profitAndLoss.filter((m) => m.month >= "2026-05" && m.month <= "2026-10");
  const avgOut = r2(sum(d.payments.filter((p) => p.direction === "out" && p.sentAt >= "2026-08-01" && p.sentAt < "2026-11-01" && p.status !== "Prepared"), (p) => p.amount) / 3);
  const avgIn = r2(sum(d.payments.filter((p) => p.direction === "in" && p.purpose === "receipt" && p.sentAt >= "2026-08-01" && p.sentAt < "2026-11-01"), (p) => p.amount) / 3);
  const hannahLeave = hannahSlip?.leaveDetails || [];
  const kestrelDeal = d.crm.deals.find((x) => x.company === "kestrel-health");

  const conversations = [
    {
      asker: "maya", screen: "Departments › Engineering", at: "2026-11-09T09:02:11Z",
      turns: [
        { role: "user", text: `Why is Engineering already at ${engPct}% of its budget this quarter?` },
        { role: "fde", lookedAt: [
          { command: "capxul org department show engineering --org harbourline", result: `Engineering: ${f2(eng.amount)} USDC this quarter, ${f2(eng.spent)} spent, ${f2(eng.committed)} committed, ${f2(eng.left)} left` },
          { command: "capxul payment list --org harbourline --from engineering --since 2026-10-01", result: `${engPays.length} payments since 1 October` },
        ], text: `Engineering has spent ${f2(eng.spent)} and committed ${f2(eng.committed)} of its ${f2(eng.amount)} USDC for October to December. Most of it is ${top.map(([n, v]) => `${n} (${f2(v)})`).join(", ")}. The committed part is Sofia Lindqvist's December collection under her pay agreement: it is already promised, so I count it. At this pace Engineering ends the quarter with about ${f2(Math.max(0, eng.left - (eng.spent / 40) * 52 * 0.15))} left. If you want more room for the two January hires, the Board needs to raise Harbourline first (you proposed that this morning as sp_0194); then you can raise Engineering yourself, because you wear the hat above it.` },
      ],
    },
    {
      asker: "kwame", screen: "Company › Seats", at: "2026-11-06T15:40:02Z",
      turns: [
        { role: "user", text: "We need five more seats for the January hires." },
        { role: "fde", lookedAt: [
          { command: "capxul org seats show --org harbourline", result: `${d.seats.used} of ${d.seats.limit} seats in use, 1 invitation open, 10.00 USDC a seat` },
          { command: "capxul org allowance get capxul --org harbourline", result: `Capxul allowance: ${f2(capNov.left)} of ${f2(cap.monthly)} USDC left this month` },
        ], text: `You have ${d.seats.limit - d.seats.used - 1} seats free once Owen Grady accepts, so five more would leave room for the January starters and a spare. Five seats cost 50.00 USDC, once. You wear People and hold the Capxul allowance, which has ${f2(capNov.left)} USDC left this month, so you can pay for them yourself. I've prepared it; it needs your approval.`,
          handover: { title: "Buy 5 seats", command: "capxul org seats buy 5 --org harbourline --from capxul", from: "Harbourline Treasury · Capxul allowance", to: "Capxul", amount: "50.00 USDC", signer: "kwame", signerHat: "People; Capxul allowance", status: "Not now", note: "Kwame chose Not now: the January offers are not signed yet." } },
        { role: "user", text: "Not yet, let's wait until the offers are signed." },
        { role: "fde", text: "Fine. I've left it unsigned; nothing was bought. Ask me again when the offers are back." },
      ],
    },
    {
      asker: "tom", screen: "Money › Payments", at: "2026-11-04T10:31:44Z",
      turns: [
        { role: "user", text: "Hannah said her October pay never arrived." },
        { role: "fde", lookedAt: [
          { command: `capxul org payroll run get ${hannahSlip?.payrollEntry} --org harbourline`, result: `${hannahSlip?.payrollEntry}: paid 30 Oct, one payslip in money waiting` },
          { command: `capxul payment get ${hannahPay?.id}`, result: `Money waiting for hannah.cole@gmail.com: claimed 4 Nov 09:12` },
        ], text: `Her pay waited for her because she had no Capxul account yet: ${f2(hannahPay?.amount || 0)} USDC (${gb(hannahSlip?.netPay || 0)} net for 12 to 31 October) went into money waiting on 30 October, and Capxul emailed her. She set up her account this morning and claimed it at 09:12, so it is in her Safe now. Nothing more to do. Her November pay will go straight to her Safe.` },
      ],
    },
    {
      asker: "nadia", screen: "Money › Bank", at: "2026-11-09T10:40:51Z",
      turns: [
        { role: "user", text: "Pay Brightfield's rent today." },
        { role: "fde", lookedAt: [
          { command: "capxul org doc list purchase-invoice --filter supplier=\"Brightfield Workspace Ltd\" --filter status=Unpaid", result: `${brightBill?.name} · ${brightBill?.billNo} · ${gb(brightBill?.grandTotal || 0)} due ${brightBill?.dueDate}` },
          { command: "capxul bank pay contact 5040 --org harbourline --account bacc_brightfield --from operations --quote", result: `Quote: ${f2(bright?.sent || 0)} USDC for ${gb(bright?.bankAmount || 0)}, Bridge fee ${f2(bright?.fee || 0)}` },
        ], text: `November's rent is ${brightBill?.name} (their ${brightBill?.billNo}), ${gb(brightBill?.grandTotal || 0)} including VAT, due on the 15th. I got a quote: ${f2(bright?.sent || 0)} USDC leaves the Treasury from Operations and Brightfield's NatWest account ending 2291 receives exactly ${gb(bright?.bankAmount || 0)} by Faster Payments; Bridge's fee is ${f2(bright?.fee || 0)} USDC. The quote holds for ten minutes. You wear the Operations hat, so the approval is yours.`,
          handover: { title: "Pay Brightfield Workspace Ltd by bank", command: "capxul bank pay contact 5040 --org harbourline --account bacc_brightfield --from operations", from: "Harbourline Treasury · Operations", to: "Brightfield Workspace Ltd · NatWest ·· 2291", amount: `${f2(bright?.sent || 0)} USDC (£5,040.00 to the bank)`, signer: "nadia", signerHat: "Operations", status: "Waiting for you", payment: bright?.payment } },
      ],
    },
    {
      asker: "samh", guest: true, screen: "(his own Capxul)", at: "2026-11-05T14:12:09Z",
      turns: [
        { role: "user", text: "Can I have Harbourline's VAT summary for Q2?" },
        { role: "fde", lookedAt: [{ command: "capxul org fde guest list --org harbourline", result: "Sam Hollis is a guest: his own dealings only" }], text: `I can only show you your own dealings with Harbourline: Hollis & Reed's ${hollisBills.length} invoices and their payments, the latest paid by bank on 7 November and on its way to your Lloyds account. For the VAT summary, ask Kwame Mensah, who wears the Books hat; he can share it with you.`, refused: "A guest's FDE reads nothing of the Organization's beyond the guest's own dealings." },
      ],
    },
    {
      asker: "priya", screen: "Money › Money waiting", at: "2026-11-06T17:05:37Z",
      turns: [
        { role: "user", text: "Take back the money for Jules, she wants paying by bank." },
        { role: "fde", lookedAt: [{ command: `capxul payment get ${jules?.id}`, result: `Money waiting for jules.marchetti@proton.me: ${f2(jules?.amount || 0)} USDC since 2 Nov` }], text: `The ${f2(jules?.amount || 0)} USDC for jules.marchetti@proton.me has waited since 2 November and nobody has claimed it. You wear the Design hat, which funded it, so you can take it back. The money returns to the Treasury, but Design's room for this quarter stays spent: taking it back does not give the room back. I've drafted the take-back. Once you save Jules's bank details I can quote a bank payout in euros or pounds.`,
          handover: { title: "Take back money waiting for jules.marchetti@proton.me", command: `capxul payment cancel ${jules?.id} --org harbourline`, from: "Money waiting", to: "Harbourline Treasury", amount: `${f2(jules?.amount || 0)} USDC`, signer: "priya", signerHat: "Design", status: "Not now", note: "Priya is on leave until 13 Nov; Maya, who wears the Harbourline hat above Design, can also take it back." } },
      ],
    },
    {
      asker: "leo", screen: "CRM › Deals › Kestrel Health", at: "2026-11-09T08:48:20Z",
      turns: [
        { role: "user", text: "Move Kestrel Health to Negotiation and email Aisha the revised proposal." },
        { role: "fde", lookedAt: [{ command: `capxul org crm deal get ${kestrelDeal?.name}`, result: `${kestrelDeal?.name}: Proposal/Quotation, £86,000.00, owner ${ctx.personName(kestrelDeal?.owner || "samw")}` }, { command: "capxul org me --org harbourline", result: "Leo Brennan: Growth, Invoicing; not People" }],
          text: `I can't do that as you: changing a deal and sending email from the CRM needs the People hat, and you wear Growth and Invoicing. I've drafted both for Sam Whitfield, who wears People: the move to Negotiation and the email to Dr Aisha Rahman with Kestrel-proposal-v3.pdf. He'll see them in his approvals.`,
          refused: "ROLE_PERMISSION_DENIED: needs the People hat",
          handover: { title: "For Sam Whitfield: move the deal and send the proposal", command: `capxul org crm deal move ${kestrelDeal?.name} Negotiation && capxul org crm email send ${kestrelDeal?.name} --subject "Kestrel patient portal: revised proposal" --body-file proposal-v3.md --confirm`, from: "", to: "Dr Aisha Rahman", amount: "", signer: "samw", signerHat: "People", status: "Waiting for Sam Whitfield" } },
      ],
    },
    {
      asker: "hannah", screen: "Me › Payslips", at: "2026-11-05T12:20:00Z",
      turns: [
        { role: "user", text: "When's my next payslip, and how much leave do I have left?" },
        { role: "fde", lookedAt: [{ command: "capxul payroll payslip list", result: `1 payslip: ${hannahSlip?.name}` }, { command: "capxul hr leave balance", result: hannahLeave.map((l) => `${l.leaveType} ${l.available}`).join(", ") }],
          text: `Your next payslip is for November, paid on Monday 30 November, straight to your Safe now that you have one. Your October slip was ${gb(hannahSlip?.netPay || 0)} net for 12 to 31 October. You have ${hannahLeave.find((l) => l.leaveType === "Annual Leave")?.available ?? 0} days of annual leave and ${hannahLeave.find((l) => l.leaveType === "Sick Leave")?.available ?? 0} days of sick leave left this year. To book leave, tell me the dates or use Leave › New.` },
      ],
    },
    {
      asker: "maya", screen: "Home", at: "2026-11-02T08:15:40Z",
      turns: [
        { role: "user", text: "How much runway do we have?" },
        { role: "fde", lookedAt: [{ command: "capxul balance --org harbourline", result: `Treasury ${f2(treasury)} USDC; Reserve Safe ${f2(reserve)} USDC` }, { command: "capxul org doc get bank-account \"Barclays Business\"", result: `Barclays ${gb(barclays)} per books` }, { command: "capxul activity summary --org harbourline --from 2026-08-01 --to 2026-10-31", result: `Out ${f2(avgOut * 3)} USDC, in ${f2(avgIn * 3)} USDC over three months` }],
          text: `Cash is ${f2(treasury + reserve)} USDC across the two Safes (about ${gb((treasury + reserve) * rate)}) plus ${gb(barclays)} in Barclays. Over August to October, ${f2(avgOut)} USDC a month left the Treasury and ${f2(avgIn)} USDC a month came in from customers, so the net burn is about ${f2(Math.max(0, avgOut - avgIn))} USDC a month. On that pace the money lasts ${avgOut > avgIn ? Math.floor((treasury + reserve) / Math.max(1, avgOut - avgIn)) + " months" : "indefinitely: you are earning more than you spend"}. The seed money sits in the Reserve Safe and only moves to the Treasury by Board proposal.` },
      ],
    },
  ];
  for (const c of conversations) {
    let t = c.at;
    c.id = "conv_" + ulid(ms(c.at), r);
    for (const tn of c.turns) {
      tn.at = t;
      tn.id = turn(t);
      t = new Date(Date.parse(t) + (tn.role === "user" ? r.int(5, 25) : r.int(20, 120)) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    }
  }
  // the asks the book keeps (who asked, when, until when), never the messages
  const askers = ["maya", "kwame", "tom", "priya", "nadia", "leo", "grace", "samw", "isla", "ruth"];
  const asks = [];
  for (const m of months(START, TODAY)) {
    for (const who of askers) {
      const p = ctx.people.find((x) => x.id === who) || ctx.others.find((x) => x.id === who);
      const since = p.seat || p.joined;
      if (!since || since > addDays(m, 27)) continue;
      const n = r.int(who === "maya" || who === "kwame" ? 8 : 2, who === "maya" || who === "kwame" ? 26 : 12);
      asks.push({ month: m.slice(0, 7), asker: who, count: n });
    }
  }
  const recent = [];
  for (const c of conversations) recent.push({ at: c.at, asker: c.asker, turn: c.turns[1]?.id, until: new Date(Date.parse(c.at) + 15 * 60000).toISOString().replace(/\.\d{3}Z$/, "Z"), guest: !!c.guest });
  const hosting = { status: "Running", handle: "@harbourline-fde", safe: ctx.safeOf("@harbourline-fde"), hats: [], started: "2025-05-01", paidThrough: "2026-12-01", due: "2026-11-24", price: 20, monthsPaid: d.purchaseInvoices.filter((b) => b.supplier === "capxul" && b.items[0].item === "FDE hosting").length, lastAsked: { at: "2026-11-09T10:40:51Z", by: "nadia" }, model: "Hosted by Capxul" };
  hosting.paidTotal = hosting.monthsPaid * 20;
  const guests = [
    { email: "sam@hollisreed.co.uk", name: "Sam Hollis", note: "Our accountant (Hollis & Reed)", namedBy: "kwame", since: "2026-04-14", status: "Active" },
    { email: "jo.bates@aldermoorhousing.org", name: "Jo Bates", note: "Client: Aldermoor Housing Trust", namedBy: "isla", since: "2026-09-02", status: "Active" },
    { email: "alice@penroselegal.co.uk", name: "Alice Penrose", note: "Lawyer, seed round", namedBy: "maya", since: "2026-07-01", status: "Removed", removed: "2026-08-30" },
  ];
  return { hosting, guests, conversations, asksByMonth: asks, recentAsks: recent.sort((a, b) => (a.at < b.at ? 1 : -1)) };
}

export function buildApprovals(ctx, d) {
  const items = [];
  const q = (x) => items.push(x);
  for (const p of d.proposals.filter((x) => x.status === "Waiting")) {
    const approved = p.approvals.map((a) => a.who);
    q({ kind: "Board", what: `Board proposal ${p.id}: ${p.title}`, amount: null, openedBy: p.proposedBy, openedAt: p.createdAt, waitsFor: d.directors.filter((x) => !approved.includes(x.who)).map((x) => x.who), because: "Directors approve Board proposals", approvedBy: approved, ref: { type: "proposal", id: p.id }, command: `capxul org proposal approve ${p.id} --org harbourline` });
  }
  const bright = d.payments.find((p) => p.status === "Prepared");
  if (bright) q({ kind: "Money", what: `Pay ${bright.counterparty} £${f2(bright.gbp)} by bank`, amount: `${f2(bright.amount)} USDC`, openedBy: "nadia", openedAt: bright.createdAt, expires: "2026-11-09T10:52:18Z", waitsFor: ["nadia"], because: "wears the Operations hat", ref: { type: "payment", id: bright.id }, command: `capxul payment wait ${bright.approval || "approval_…"}` });
  for (const l of d.leaveApplications.filter((x) => x.status === "Open")) {
    const w = l.waitingFor;
    const who = w ? [w.who] : [];
    q({ kind: "HR", what: `Leave: ${ctx.personName(l.employee)}, ${l.fromDate} to ${l.toDate} (${l.leaveType}, ${l.totalLeaveDays} days)`, amount: null, openedBy: l.employee, openedAt: at(l.postingDate, 12, 0), waitsFor: [...new Set([...who, ...ctx.officerHolders("people", TODAY).filter((x) => x !== l.employee)])], because: w ? `wears the ${w.hat} hat, or People` : "People", ref: { type: "leave", id: l.name }, command: `capxul org hr leave approve ${l.name} --org harbourline` });
  }
  for (const c of d.expenseClaims.filter((x) => x.status === "Draft" || x.approvalStatus === "Draft")) {
    if (c.status === "Draft" && c.employee === "hannah") continue;
    q({ kind: "HR", what: `Expense claim ${c.name} from ${ctx.personName(c.employee)}: ${c.expenses.map((e) => e.description).join("; ")}`, amount: `£${f2(c.grandTotal)}`, openedBy: c.employee, openedAt: at(c.postingDate, 18, 0), waitsFor: [c.waitingFor.who, "maya"].filter((x, i, a) => a.indexOf(x) === i), because: `${c.waitingFor.hat}'s budget pays it`, ref: { type: "expense-claim", id: c.name }, command: `capxul org hr expense-claim approve ${c.name} --org harbourline` });
  }
  for (const c of d.expenseClaims.filter((x) => x.status === "Unpaid")) q({ kind: "Money", what: `Pay expense claim ${c.name} to ${ctx.personName(c.employee)} (approved)`, amount: `£${f2(c.grandTotal)}`, openedBy: c.decidedBy, openedAt: at(c.approvedAt, 16, 0), waitsFor: ctx.holdersOf(c.department, TODAY).filter((x) => !x.startsWith("@")), because: `wears the ${ctx.deptName(c.department)} hat`, ref: { type: "expense-claim", id: c.name }, command: `capxul org hr expense-claim pay ${c.name} --org harbourline` });
  for (const a of d.advances.filter((x) => x.status === "Requested")) q({ kind: "HR", what: `Advance ${a.name} for ${ctx.personName(a.employee)}: ${a.purpose}`, amount: `£${f2(a.advanceAmount)}`, openedBy: a.employee, openedAt: at(a.postingDate, 11, 30), waitsFor: [a.waitingFor.who, "maya"], because: `${a.waitingFor.hat}'s budget pays it`, ref: { type: "advance", id: a.name }, command: `capxul org hr advance pay ${a.name} --org harbourline` });
  for (const dep of d.deposits.filter((x) => x.status === "Credited" && x.match === "Unmatched")) q({ kind: "Banking", what: `Match a deposit: ${dep.from} £${f2(dep.bankAmount)}`, amount: `${f2(dep.net)} USDC`, openedBy: null, openedAt: dep.creditedAt, waitsFor: ctx.officerHolders("books", TODAY), because: "Books", ref: { type: "deposit", id: dep.id }, command: `capxul bank match ${dep.id} none` });
  for (const e of d.escrows.filter((x) => x.status === "Open")) q({ kind: "Money", what: `Money uncollected: ${e.email}, ${f2(e.amount)} USDC from ${ctx.budgetName(e.from)}, ${Math.round((Date.parse(NOW) - Date.parse(e.fundedAt)) / 86400000)} days`, amount: `${f2(e.amount)} USDC`, openedBy: e.sentBy, openedAt: e.fundedAt, waitsFor: [...new Set([...ctx.holdersOf(e.from, TODAY).filter((x) => !x.startsWith("@")), "maya"])], because: `wears the ${ctx.budgetName(e.from)} hat or one above`, action: "Take back", ref: { type: "payment", id: e.payment }, command: `capxul payment cancel ${e.payment} --org harbourline` });
  q({ kind: "Money", what: "FDE hosting due 24 Nov: 20.00 USDC (paid through 1 Dec)", amount: "20.00 USDC", openedBy: null, openedAt: "2026-11-09T00:00:00Z", waitsFor: ["kwame"], because: "holds the Capxul allowance", ref: { type: "fde" }, command: "capxul org fde pay 1 --org harbourline --from capxul" });
  q({ kind: "People", what: "Invitation to a seat: owen.grady@gmail.com (sent 3 Nov)", amount: null, openedBy: "kwame", openedAt: "2026-11-03T11:20:00Z", expires: "2026-11-17", waitsFor: ["owen"], because: "the invitee accepts", ref: { type: "invitation" }, command: "capxul org invite list --org harbourline" });
  q({ kind: "Board", what: "Shareholder vote vt_0005: authorise 1,000,000 more Common for the option pool (closes 16 Nov)", amount: null, openedBy: "maya", openedAt: "2026-11-06T09:00:00Z", waitsFor: ["ruth"], because: "shareholders vote; Northbank, Fennel and Juniper have not voted", ref: { type: "vote", id: "vt_0005" }, command: "capxul vote cast vt_0005 --for" });
  const recent = d.approvals.slice(-40).reverse();
  return { waiting: items, recent };
}

export function buildNotices(ctx, d) {
  const N = [];
  const n = (to, at_, kind, text, ref) => N.push({ to, at: at_, kind, text, ref, read: at_ < "2026-11-06" });
  const wp = d.proposals.filter((p) => p.status === "Waiting");
  for (const p of wp) for (const who of p.directors) n(who, p.createdAt, "Board", approvedBy(p, who) ? `Board proposal ${p.id} waits for one more Director: ${p.title}` : `Board proposal ${p.id} waits for your approval: ${p.title}`, { type: "proposal", id: p.id });
  const hol = d.payouts.find((p) => p.status === "In transit");
  if (hol) for (const who of ["maya", "nadia"]) n(who, "2026-11-07T16:25:00Z", "Money", `Bank payout sent: £${f2(hol.bankAmount)} to ${hol.to}`, { type: "payment", id: hol.payment });
  const grace = d.leaveApplications.find((l) => l.employee === "grace" && l.leaveType === "Parental Leave");
  if (grace) for (const who of ["maya", "kwame", "isla"]) n(who, "2026-11-06T12:00:00Z", "HR", "Grace Adeyemi asked for parental leave, 1 Dec to 26 Feb: waits for the Harbourline hat or People", { type: "leave", id: grace.name });
  const salt = ctx.arriving;
  if (salt) for (const who of ["maya", "kwame", "leo"]) n(who, "2026-11-09T10:21:00Z", "Banking", `A bank transfer is arriving from ${salt.from}: £${f2(salt.bankAmount)}, reference ${salt.reference}`, { type: "deposit", id: salt.id });
  const unm = d.deposits.find((x) => x.match === "Unmatched" && x.status === "Credited");
  if (unm) n("kwame", unm.creditedAt, "Banking", `Deposit credited but matches no invoice: ${unm.from} £${f2(unm.bankAmount)} (${f2(unm.net)} USDC)`, { type: "deposit", id: unm.id });
  const han = d.payments.find((p) => p._esc && p._esc.email === "hannah.cole@gmail.com");
  if (han) { for (const who of ["maya", "kwame"]) n(who, "2026-11-04T09:12:30Z", "Money", `Hannah Cole claimed her October pay (${f2(han.amount)} USDC)`, { type: "payment", id: han.id }); n("hannah", "2026-10-30T16:05:00Z", "Money", `Harbourline Studio Ltd sent you ${f2(han.amount)} USDC. It is waiting for you: sign up with this email address to claim it.`, { type: "payment", id: han.id }); }
  for (const who of ["maya", "kwame"]) n(who, "2026-11-01T12:01:00Z", "People", "Harbourline bought 10 seats (100.00 USDC): 20 seats now", { type: "seats" });
  const jul = d.escrows.find((e) => e.email === "jules.marchetti@proton.me");
  if (jul) for (const who of ["priya", "maya"]) n(who, "2026-11-05T09:00:00Z", "Money", `Money for jules.marchetti@proton.me is still waiting (3 days): ${f2(jul.amount)} USDC from Design`, { type: "payment", id: jul.payment });
  const ian = d.escrows.find((e) => e.email === "ian.pryce@outlook.com");
  if (ian) n("leo", "2026-11-06T09:00:00Z", "Money", `Money for ian.pryce@outlook.com is still waiting (3 days): ${f2(ian.amount)} USDC from Growth`, { type: "payment", id: ian.payment });
  for (const who of ["maya", "tom"]) n(who, "2026-11-06T09:00:00Z", "Board", "Vote vt_0005 is open until 16 Nov: authorise 1,000,000 more Common for the option pool", { type: "vote", id: "vt_0005" });
  n("kwame", "2026-10-24T09:02:00Z", "FDE", "FDE hosting paid through 1 Dec 2026 (20.00 USDC from the Capxul allowance)", { type: "fde" });
  n("maya", "2026-10-30T16:06:00Z", "Money", `Payroll October 2026 paid: ${d.runs[d.runs.length - 1].payment.paid} payslips settled, ${d.runs[d.runs.length - 1].payment.escrowed} waiting to be claimed`, { type: "run", id: d.runs[d.runs.length - 1].name });
  const fw = d.payouts.find((p) => p.status === "Refunded");
  if (fw) for (const who of ["nadia", "maya"]) n(who, fw.returnedAt, "Money", `Bank payout returned: £${f2(fw.bankAmount)} to ${fw.to} (the account is closed). ${f2(fw.refund)} USDC is back in the Treasury.`, { type: "payment", id: fw.payment });
  for (const p of d.slips.filter((s) => s.postingDate === "2026-10-30")) n(p.employee, "2026-10-30T16:10:00Z", "HR", `Your payslip for October 2026 is ready: £${f2(p.netPay)} net`, { type: "payslip", id: p.name });
  const ellis = d.leaveApplications.find((l) => l.employee === "ellis" && l.status === "Open");
  if (ellis) n("tom", at(ellis.postingDate, 12, 2), "HR", `Ellis Hart asked for leave, ${ellis.fromDate} to ${ellis.toDate}: waits for the Engineering hat`, { type: "leave", id: ellis.name });
  return N.sort((a, b) => (a.at < b.at ? 1 : -1));
}
function approvedBy(p, who) {
  return p.approvals.some((a) => a.who === who);
}

export function buildEvents(ctx, d) {
  const E = [];
  const e = (at_, kind, text, ref, who) => { if (at_.slice(0, 10) <= TODAY) E.push({ at: at_, kind, text, ref: ref || null, who: who || null }); };
  e("2025-05-01T09:00:00Z", "Company", "Harbourline moved onto Capxul: the Treasury was set up, the FDE started, and the Harbourline department and five teams were created", null, "maya");
  e("2025-05-14T11:00:00Z", "Banking", "Business verification approved by Bridge (GBP, USD, EUR); bank details opened", null, "maya");
  for (const p of ctx.people) {
    if (p.joined >= START) e(at(p.joined, 9, 0), "People", `${p.first} ${p.last} joined as ${p.desig}${p.type === "Contract" ? " (contractor, Stockholm)" : ""}`, { type: "employee", id: p.emp }, p.id);
    if (p.relieved) e(at(p.relieved, 17, 0), "People", `${p.first} ${p.last} left Harbourline`, { type: "employee", id: p.emp }, p.id);
    if (p.seat && p.seat > "2025-05-01") e(at(p.seat, 10, 0), "People", `${p.first} ${p.last} took a seat`, null, p.id);
  }
  for (const dep of ctx.departments) for (const h of dep.holders) if (h.from > "2025-05-01") e(at(h.from, 10, 30), "Departments", `${ctx.personName(h.who)} now wears the ${dep.name} hat${dep.holders.find((x) => x.to === h.from) ? ` (from ${ctx.personName(dep.holders.find((x) => x.to === h.from).who)})` : ""}`, { type: "department", id: dep.id }, h.who);
  for (const [hat, hs] of Object.entries(ctx.officerHats)) for (const h of hs) if (h.from > "2025-05-01") e(at(h.from, 11, 0), "Board", `${ctx.personName(h.who)} was granted the ${hat[0].toUpperCase() + hat.slice(1)} hat`, null, h.who);
  for (const p of d.proposals.filter((x) => x.status === "Executed")) e(p.executedAt, "Board", `Board proposal ${p.id} executed: ${p.title}`, { type: "proposal", id: p.id }, p.proposedBy);
  for (const run of d.runs) e(run.payment.approvedAt, "Payroll", `Payroll ${run.name} paid: ${run.totals.employees} payslips, £${f2(run.totals.net)} net`, { type: "run", id: run.name }, run.paidBy);
  for (const deal of d.crm.deals.filter((x) => x.status === "Won")) e(at(deal.closedDate, 16, 0), "CRM", `Deal won: ${deal.title}`, { type: "deal", id: deal.name }, deal.owner);
  for (const pr of d.projects) { e(at(pr.expectedStart < START ? START : pr.expectedStart, 9, 30), "Projects", `Project ${pr.name} started: ${pr.projectName}`, { type: "project", id: pr.name }); if (pr.status === "Completed") e(at(pr.actualEnd || pr.expectedEnd, 17, 30), "Projects", `Project ${pr.name} completed: ${pr.projectName}`, { type: "project", id: pr.name }); }
  for (const rd of d.equity.rounds) { e(at(rd.opened, 10, 0), "Equity", `${rd.name} round opened`, { type: "round", id: rd.id }, "maya"); e(at(rd.closed, 17, 0), "Equity", `${rd.name} round closed: ${f2(rd.raised)} USDC raised`, { type: "round", id: rd.id }, "maya"); }
  e("2026-08-20T12:00:00Z", "Equity", "Equity handed over to the shareholders' vote; the pre-seed SAFEs converted; Ruth Calloway seated as a Director (vote vt_0003)", { type: "vote", id: "vt_0003" }, "ruth");
  for (const a of ctx.agents) e(at(a.created, 10, 5), "Agents", `${ctx.personName(a.owner)} created the agent ${a.handle}`, { type: "agent", id: a.handle }, a.owner);
  e("2026-10-30T18:22:00Z", "Agents", "Leo Brennan froze @leo-outreach", { type: "agent", id: "@leo-outreach" }, "leo");
  for (const es of d.escrows) {
    e(es.fundedAt, "Money", `Money waiting for ${es.email}: ${f2(es.amount)} USDC from ${ctx.budgetName(es.from)}`, { type: "payment", id: es.payment }, es.sentBy);
    if (es.claimedAt) e(es.claimedAt, "Money", `${es.email} claimed ${f2(es.amount)} USDC`, { type: "payment", id: es.payment });
    if (es.takenBackAt) e(es.takenBackAt, "Money", `${ctx.personName(es.takenBackBy)} took back ${f2(es.amount)} USDC from money waiting (${es.email})`, { type: "payment", id: es.payment }, es.takenBackBy);
  }
  e("2026-11-01T12:00:00Z", "People", "Harbourline bought 10 seats for 100.00 USDC (limit 10 to 20)", null, "kwame");
  e("2026-11-03T11:20:00Z", "People", "Kwame Mensah invited owen.grady@gmail.com to a seat", null, "kwame");
  return E.sort((a, b) => (a.at < b.at ? 1 : -1));
}

export function buildActivity(ctx, d) {
  // the money feed: Capxul payments and outside money, newest first
  const rows = [];
  for (const p of d.payments) {
    if (p.status === "Prepared" || (p.status === "Cancelled" && p.outcome === "Expired")) continue;
    rows.push({
      at: p.settledAt || p.sentAt, kind: p.kind === "movement" ? "Outside money" : "Payment", direction: p.direction === "between" ? "Between your Safes" : p.direction === "in" ? "In" : "Out",
      amount: p.direction === "out" ? -p.amount : p.amount, asset: "USDC", counterparty: p.counterparty, status: p.status, outcome: p.outcome || null, budget: p.budget || null,
      account: p.account || null, memo: p.memo || null, tx: p.proof?.tx || d.chainTx.get(p.id) || null, payment: p.id, safe: p.payer?.label || (p.direction === "in" ? "Treasury" : null),
    });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : -1));
}
