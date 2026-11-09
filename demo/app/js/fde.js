// The FDE and the feeds: Harbourline's Forward Deployed Engineer (hosted by Capxul; anyone may talk to it; it acts
// only with the asker's permissions and drafts risky actions for the asker to run), its hosting, guests and the
// asker's own conversations; the money feed (activity) with its summary and each row's evidence; the company's events;
// the viewer's notices. The FDE answers from a script over the real figures in cx.data (fictional sample data).
import { cx, h } from './core.js';

const D = cx.data;
const fmt = cx.fmt;
const ORG = '--org harbourline';
const N = () => cx.native || {};
const M = D.money;
const F = D.fde;
const RATE = cx.rate(cx.today);
const r2 = (n) => Math.round((+n + Number.EPSILON) * 100) / 100;
const addDays = (d, n) => new Date(Date.parse(d.slice(0, 10) + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b.slice(0, 10) + 'T00:00:00Z') - Date.parse(a.slice(0, 10) + 'T00:00:00Z')) / 864e5);
const tabsV = (t, o) => { const el = cx.tabs(t, o); el.style.minWidth = '0'; return el; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tick = 0;
const stamp = () => (N().stamp ? N().stamp() : new Date(cx.now.getTime() + ++tick * 45000).toISOString());
const FDE_HANDLE = F.hosting.handle;

cx.style('fde', `
.fd-chat { display: grid; gap: 14px; }
.fd-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 10px 14px; border-bottom: 1px solid var(--line); font-size: 13px; color: var(--fg-2); }
.fd-head b { color: var(--fg); }
.fd-body { padding: 14px; display: grid; gap: 14px; max-height: min(62vh, 640px); overflow-y: auto; }
.fd-foot { border-top: 1px solid var(--line); padding: 12px 14px; display: grid; gap: 8px; }
.fd-foot form { display: flex; gap: 8px; align-items: flex-end; }
.fd-foot textarea { flex: 1; min-width: 0; resize: vertical; }
.fd-hand { border: 1px solid var(--line-2); border-radius: var(--r); background: var(--surface); }
.fd-hand header { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid var(--line); font-size: 12.5px; color: var(--muted); }
.fd-hand .b { padding: 10px 12px; display: grid; gap: 8px; }
.fd-hand .b h4 { font-size: 14px; }
.fd-refused { border-left: 3px solid var(--t-orange); padding: 6px 10px; font-size: 13px; background: var(--t-orange-bg); color: var(--fg); border-radius: 0 6px 6px 0; }
.fd-feed { list-style: none; margin: 0; padding: 0; }
.fd-day { padding: 8px 14px; font-size: 12px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--faint); background: var(--surface-2); border-bottom: 1px solid var(--line); border-top: 1px solid var(--line); }
.fd-feed li:first-child .fd-day { border-top: 0; }
.fd-row { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; }
.fd-row:hover { background: var(--hover); }
.fd-row .ic-wrap { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--sunk); color: var(--fg-2); }
.fd-row .ic-wrap.in { background: var(--t-green-bg); color: var(--t-green); }
.fd-row .ic-wrap.out { background: var(--sunk); color: var(--fg-2); }
.fd-row .t { min-width: 0; display: grid; gap: 1px; }
.fd-row .t b { font-weight: 600; overflow-wrap: anywhere; }
.fd-row .t small { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.fd-row .r { text-align: right; display: grid; gap: 1px; justify-items: end; }
.fd-filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.fd-filters .ctl { width: auto; min-width: 0; max-width: 100%; }
.fd-notice { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 10px; align-items: start; padding: 11px 14px; border-bottom: 1px solid var(--line); }
.fd-notice .dot2 { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; background: var(--accent); }
.fd-notice.read .dot2 { background: transparent; }
.fd-notice.read .tx { color: var(--fg-2); font-weight: 400; }
.fd-notice .tx { font-weight: 600; overflow-wrap: anywhere; }
.fd-notice small { display: block; color: var(--muted); font-size: 12px; font-weight: 400; }
`);

/* =====================================================================================================
   Workspaces
   ===================================================================================================== */

cx.workspace({ id: 'fde', label: 'FDE', icon: 'fde', route: 'fde', seatless: true, nav: [{ label: 'Talk', route: 'fde', match: ['fde-conversation'] }] });
cx.workspace({ id: 'activity', label: 'Activity', icon: 'activity', route: 'activity', nav: [{ label: 'Money feed', route: 'activity', match: ['activity-item'] }, { label: 'Events', route: 'events' }, { label: 'Notices', route: 'notices' }] });

/* =====================================================================================================
   The FDE's brain: scripted over the real figures, within the asker's hats
   ===================================================================================================== */

const NUMS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const findDept = (q) => [...D.departments, ...D.allowances].find((d) => q.includes(d.name.toLowerCase()) || q.includes(d.id));
const hatsLine = (me) => (me.hats?.length ? me.hats.join(', ') : 'no hats');
const holdersLine = (id) => cx.holders(id).map(cx.name).join(' and ') || 'nobody';
function treasuryFlows(from, to) {
  const purpose = new Map(M.payments.map((p) => [p.id, p.purpose]));
  let inn = 0, out = 0;
  for (const r of cx.rows('activity')) {
    const d = String(r.at).slice(0, 10);
    if (d < from || d > to || r.safe !== 'Treasury' || r.direction === 'Between your Safes' || ['investment', 'transfer'].includes(purpose.get(r.payment))) continue;
    if (r.amount > 0) inn += r.amount; else out -= r.amount;
  }
  return { inn, out };
}
function quarterPayees(deptId) {
  const b = cx.budgetOn(deptId);
  const by = new Map();
  for (const p of M.payments) if (p.budget === deptId && p.direction === 'out' && p.status !== 'Cancelled' && p.status !== 'Prepared' && String(p.settledAt) >= b.from) by.set(p.counterparty, (by.get(p.counterparty) || 0) + p.amount);
  return [...by.entries()].sort((a, b2) => b2[1] - a[1]);
}
function myEmployee(me) { return me.employee || D.people.find((p) => p.id === me.id)?.employee; }

const intents = [
  // runway
  { test: (q) => /runway|how long.*(money|cash)|burn|how much (cash|money)/.test(q), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const T = M.safes.treasury, R = M.safes.reserve, bank = D.books.bankAccounts?.[0];
    const { inn, out } = treasuryFlows('2026-08-01', '2026-10-31');
    const burn = (out - inn) / 3;
    const cash = T.balance + R.balance;
    const months = burn > 0 ? Math.floor(cash / burn) : null;
    return { text: `Cash is ${fmt.usdc(cash)} across the two Safes (about ${fmt.gbp(r2(cash * RATE))}) plus ${fmt.gbp(bank?.balance || 0)} in Barclays. Over August to October, ${fmt.usdc(out / 3)} a month left the Treasury and ${fmt.usdc(inn / 3)} a month came in from customers, so the net burn is about ${fmt.usdc(burn)} a month. ${months ? `On that pace the money lasts ${months} months.` : 'More came in than went out.'} The seed money sits in the Reserve Safe and only moves to the Treasury by Board proposal.`,
      lookedAt: [{ command: `capxul balance ${ORG}`, result: `Treasury ${fmt.usdc(T.balance)}; Reserve Safe ${fmt.usdc(R.balance)}` }, { command: 'capxul org doc get bank-account "Barclays Business"', result: `Barclays ${fmt.gbp(bank?.balance || 0)} per books` }, { command: `capxul activity summary ${ORG} --from 2026-08-01 --to 2026-10-31`, result: `Out ${fmt.usdc(out)}, in ${fmt.usdc(inn)} over three months` }],
      links: [{ label: 'Open Money', route: 'money' }, { label: 'Treasury statement', route: 'treasury' }] };
  } },
  // due this week
  { test: (q) => /due|this week|coming up|what.*(owe|pay) (this|next)/.test(q), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const until = addDays(cx.today, 7);
    const sch = M.scheduled.filter((s) => s.status === 'Scheduled' && s.day <= until);
    const pinv = D.books.purchaseInvoices.filter((x) => x.outstanding > 0 && x.dueDate <= until);
    const sinv = D.books.salesInvoices.filter((x) => x.outstanding > 0 && x.dueDate <= until);
    const vote = D.equity.votes.find((v) => v.status === 'Voting' && v.closes <= until);
    const mine = D.approvals.waiting.filter((a) => a.waitsFor.includes(me.id));
    const lines = [
      sch.length ? `Dated payments: ${sch.map((s) => `${fmt.usdc(s.amount)} to ${s.to} on ${fmt.day(s.day)}`).join('; ')}.` : null,
      pinv.length ? `Bills due or overdue: ${pinv.map((x) => `${x.supplierName} ${fmt.money(x.outstanding, x.currency)} (${x.dueDate < cx.today ? 'overdue since ' + fmt.day(x.dueDate) : 'due ' + fmt.day(x.dueDate)})`).join('; ')}.` : null,
      sinv.length ? `Customers owe: ${sinv.map((x) => `${x.customerName} ${fmt.money(x.outstanding, x.currency)} (${x.dueDate < cx.today ? 'overdue' : 'due ' + fmt.day(x.dueDate)})`).join('; ')}.` : null,
      vote ? `Vote ${vote.id} closes on ${fmt.day(vote.closes)}.` : null,
      mine.length ? `And ${mine.length} things wait for you in Approvals.` : null,
    ].filter(Boolean);
    return { text: lines.join(' ') || 'Nothing is due in the next seven days.', lookedAt: [{ command: `capxul payment list ${ORG} --scheduled`, result: `${sch.length} dated payments in 7 days` }, { command: `capxul org doc list purchase-invoice --filter outstanding>0 --filter due_date<=${until}`, result: `${pinv.length} bills` }, { command: `capxul org doc list sales-invoice --filter outstanding>0 --filter due_date<=${until}`, result: `${sinv.length} invoices` }], links: [{ label: 'Scheduled payments', route: 'scheduled-payments' }, { label: 'Approvals', route: 'approvals' }] };
  } },
  // seats
  { test: (q) => /seat/.test(q), run: (q, me) => {
    const S = D.seats;
    const used = S.members.filter((m) => m.kind === 'Person' && m.status === 'Active').length;
    const held = S.invitations.filter((i) => i.status === 'Pending').length;
    const n = Number((q.match(/\b(\d+)\b/) || [])[1]) || Object.entries(NUMS).find(([w]) => new RegExp(`\\b${w}\\b`).test(q))?.[1] || 0;
    const looked = [{ command: `capxul org seats show ${ORG}`, result: `${used} of ${S.limit} seats in use, ${held} invitation open, ${S.price.toFixed(2)} USDC a seat` }];
    const base = `${used} of ${S.limit} seats are in use and ${held} is held for ${S.invitations.find((i) => i.status === 'Pending')?.email || 'an invitation'}, so ${S.limit - used - held} are free.`;
    if (!n || !/buy|need|more|add/.test(q)) return { text: `${base} A seat costs ${S.price.toFixed(2)} USDC, once. People paid by Harbourline don't need one.`, lookedAt: looked, links: [{ label: 'Seats', route: 'seats' }] };
    const total = n * S.price;
    const allow = cx.holders('capxul').includes(me.id) && cx.wears('People');
    looked.push({ command: `capxul org allowance get capxul ${ORG}`, result: `Capxul allowance: ${fmt.usdc(N().leftOf?.('capxul') ?? 0)} of 200.00 left this month` });
    const draft = { for: allow ? me.id : 'kwame', by: FDE_HANDLE, at: stamp(), title: `Buy ${n} seats`, why: `${fmt.usdc(total)} from the Capxul allowance, which has ${fmt.usdc(N().leftOf?.('capxul') ?? 0)} left this month.`, steps: ['Pay Capxul from the Capxul allowance', `Harbourline goes from ${S.limit} to ${S.limit + n} seats`], cmd: `capxul org seats buy ${n} ${ORG} --from capxul`, runLabel: 'Review and approve',
      onRun: async () => { const p = await N().payFromBudget({ title: `Buy ${n} seats`, to: `Capxul · ${n} seats`, payee: N().CAPXUL_PAYEE, amount: total, budget: 'capxul', memo: `${n} seats`, cmd: `capxul org seats buy ${n} ${ORG} --from capxul` }); if (p) { S.purchases.push({ at: p.settledAt, seats: n, price: S.price, total, by: me.id, from: 'capxul', payment: p.id, limitBefore: S.limit, limitAfter: S.limit + n }); S.limit += n; S.bought += n; cx.toast(`Bought ${n} seats.`, { tone: 'success' }); cx.refresh(); } } };
    return { text: allow ? `${base} ${n} more cost ${fmt.usdc(total)}, once. You wear People and hold the Capxul allowance, so you can pay for them yourself. I've prepared it; it needs your approval.` : `I can't do that as you: buying seats needs the People hat and a budget you hold, and you wear ${hatsLine(me)}. ${base} I've drafted it for Kwame Mensah, who wears People and holds the Capxul allowance.`, lookedAt: looked, draft, links: [{ label: 'Seats', route: 'seats' }] };
  } },
  // Hannah's pay / money waiting
  { test: (q) => /hannah|never arrived|didn.t arrive|pay (never|hasn)/.test(q), run: (q, me) => {
    const e = M.escrows.find((x) => x.email.startsWith('hannah'));
    return { text: `Her pay waited for her because she had no Capxul account yet: ${fmt.usdc(e.amount)} went into money waiting on ${fmt.date(e.fundedAt)}, and Capxul emailed her (and reminded her at three days). She set up her account and claimed it on ${fmt.datetime(e.claimedAt)}, so it is in her Safe now. Nothing more to do. Her November pay goes straight to her Safe.`, lookedAt: [{ command: `capxul org payroll run get HR-PRUN-2026-00010 ${ORG}`, result: 'paid 30 Oct, one payslip into money waiting' }, { command: `capxul payment get ${e.payment}`, result: `Money waiting for ${e.email}: claimed ${fmt.datetime(e.claimedAt)}` }], links: [{ label: 'The payment', route: 'payment', id: e.payment }] };
  } },
  // take back / money waiting
  { test: (q) => /take (it )?back|money waiting|uncollected|escrow|jules|ian pryce/.test(q), run: (q, me) => {
    const open = M.escrows.filter((e) => e.status === 'Open');
    const e = open.find((x) => q.includes(x.email.split(/[.@]/)[0])) || (open.length === 1 ? open[0] : null);
    const looked = [{ command: `capxul payment list ${ORG} --status escrowed`, result: open.map((x) => `${x.email} ${fmt.usdc(x.amount)} since ${fmt.day(x.fundedAt)}`).join('; ') || 'none' }];
    if (!e || !/take|cancel|back/.test(q)) return { text: open.length ? `${open.length} payments wait to be claimed: ${open.map((x) => `${fmt.usdc(x.amount)} for ${x.email} from ${cx.deptName(x.from)}, ${daysBetween(x.fundedAt, cx.today)} days`).join('; ')}. Nothing expires: whoever wears the funding budget's hat (or one above it), or the Board, can take each back until it is claimed.` : 'Nothing is waiting to be claimed.', lookedAt: looked, links: [{ label: 'Money waiting', route: 'money-waiting' }] };
    const p = M.payments.find((x) => x.id === e.payment);
    const may = N().mayAct?.(e.from) || { ok: false };
    const holder = may.ok ? me.id : cx.holders(e.from)[0];
    return { text: `${may.ok ? '' : `I can't do that as you: taking it back needs the ${cx.deptName(e.from)} hat or one above it, and you wear ${hatsLine(me)}. `}The ${fmt.usdc(e.amount)} for ${e.email} has waited since ${fmt.date(e.fundedAt)} and nobody has claimed it. The money returns to the Treasury, but ${cx.deptName(e.from)}'s room for this quarter stays spent: taking it back does not give the room back. I've drafted the take-back${may.ok ? '' : ` for ${cx.name(holder)}`}.`,
      lookedAt: [...looked, { command: `capxul payment get ${e.payment}`, result: `Money waiting for ${e.email}: ${fmt.usdc(e.amount)} since ${fmt.day(e.fundedAt)}` }],
      draft: { for: holder, by: FDE_HANDLE, at: stamp(), title: `Take back money waiting for ${e.email}`, why: `${fmt.usdc(e.amount)} back to the Treasury. ${cx.deptName(e.from)}'s room stays spent.`, cmd: `capxul payment cancel ${e.payment} ${ORG}`, runLabel: 'Review and approve', onRun: () => N().takeBack?.(p) },
      links: [{ label: 'Open the payment', route: 'payment', id: e.payment }] };
  } },
  // pay a supplier
  { test: (q) => /\bpay\b|rent/.test(q) && !/payslip|my pay|pay agreement/.test(q), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const pinvs = D.books.purchaseInvoices.filter((x) => x.outstanding > 0);
    const pi = pinvs.find((x) => q.includes(x.supplierName.toLowerCase().split(' ')[0])) || (/rent/.test(q) ? pinvs.find((x) => /rent/i.test(x.items?.[0]?.description || '')) : null);
    if (!pi) return { text: `Who should I pay? Open bills: ${pinvs.map((x) => `${x.supplierName} ${fmt.money(x.outstanding, x.currency)}`).join('; ')}.`, lookedAt: [{ command: 'capxul org doc list purchase-invoice --filter status=Unpaid', result: `${pinvs.length} open bills` }], links: [{ label: 'Purchase invoices', route: 'purchase-invoices' }] };
    const dept = pi.department || 'operations';
    const may = N().mayAct?.(dept) || { ok: false };
    const acct = M.savedBankAccounts.find((a) => a.holder === pi.supplierName && a.state === 'Active');
    const prepared = M.payments.find((p) => p.status === 'Prepared' && p.memo === pi.billNo);
    const holder = may.ok ? me.id : cx.holders(dept).find((x) => !x.startsWith('@'));
    const looked = [{ command: `capxul org doc list purchase-invoice --filter supplier="${pi.supplierName}" --filter status=Unpaid`, result: `${pi.name} · ${pi.billNo} · ${fmt.money(pi.outstanding, pi.currency)} due ${pi.dueDate}` }];
    if (acct) {
      const sent = prepared?.amount || r2(pi.outstanding / (RATE - 0.00011) + 4.08);
      looked.push({ command: `capxul bank pay contact ${pi.outstanding} ${ORG} --account ${acct.id} --from ${dept} --quote`, result: `Quote: ${fmt.usdc(sent)} for ${fmt.gbp(pi.outstanding)}` });
      return { text: `${may.ok ? '' : `I can't pay it as you: ${cx.deptName(dept)} pays it, and you wear ${hatsLine(me)}. `}${pi.name} (their ${pi.billNo}) is ${fmt.money(pi.outstanding, pi.currency)} including VAT, due on ${fmt.date(pi.dueDate)}. I got a quote: about ${fmt.usdc(sent)} leaves the Treasury from ${cx.deptName(dept)} and ${pi.supplierName}'s ${acct.bank} account ending ${acct.last4} receives exactly ${fmt.gbp(pi.outstanding)} by Faster Payments. The quote holds for ten minutes. ${may.ok ? 'You wear the ' + cx.deptName(dept) + ' hat, so the approval is yours.' : `I've drafted it for ${cx.name(holder)}.`}`,
        lookedAt: looked,
        draft: { for: holder, by: FDE_HANDLE, at: stamp(), title: `Pay ${pi.supplierName} ${fmt.gbp(pi.outstanding)} by bank`, why: `${pi.name} · ${pi.billNo} · due ${fmt.date(pi.dueDate)}`, cmd: `capxul bank pay contact ${pi.outstanding} ${ORG} --account ${acct.id} --from ${dept}`, runLabel: 'Review and approve', onRun: () => (prepared && prepared.waitingFor?.who === me.id ? N().approvePrepared(prepared) : cx.go('pay-by-bank', null, { account: acct.id, amount: pi.outstanding, from: dept })) },
        links: [{ label: `Open ${pi.name}`, route: 'purchase-invoice', id: pi.name }] };
    }
    return { text: `${may.ok ? '' : `I can't pay it as you: ${cx.deptName(dept)} pays it. `}${pi.name} from ${pi.supplierName} is ${fmt.money(pi.outstanding, pi.currency)}, due ${fmt.date(pi.dueDate)}. ${pi.currency === 'GBP' ? '' : 'It is billed in dollars, so it is paid in USDC.'} I've drafted the payment${may.ok ? '' : ` for ${cx.name(holder)}`}.`,
      lookedAt: looked, draft: { for: holder, by: FDE_HANDLE, at: stamp(), title: `Pay ${pi.supplierName}`, why: `${pi.name} · ${fmt.money(pi.outstanding, pi.currency)}`, cmd: `capxul payment send <to> ${pi.outstanding} ${ORG} --from ${dept}`, runLabel: 'Review and approve', onRun: () => cx.go('send-money', null, { pinv: pi.name, from: dept }) } };
  } },
  // department budget
  { test: (q, ctx) => (/budget|spent|spend|left|%|percent/.test(q) && (findDept(q) || /department/.test(ctx || ''))), run: (q, me, ctx) => {
    if (!cx.hasSeat()) return noSeat(me);
    const d = findDept(q) || findDept(String(ctx).toLowerCase());
    if (!d) return null;
    if (D.allowances.includes(d)) {
      const m = d.months.at(-1);
      return { text: `The ${d.name} allowance is ${fmt.usdc(d.monthly)} a month, held by ${holdersLine(d.id)}. This month ${fmt.usdc(m.spent)} is spent and ${fmt.usdc(m.left)} is left; it refills on the 1st.`, lookedAt: [{ command: `capxul org allowance get ${d.id} ${ORG}`, result: `${d.name}: ${fmt.usdc(m.left)} left this month` }], links: [{ label: `Open ${d.name}`, route: 'allowance', id: d.id }] };
    }
    const b = cx.budgetOn(d.id);
    const top = quarterPayees(d.id).slice(0, 3);
    const days = daysBetween(b.from, cx.today) + 1, all = daysBetween(b.from, b.to) + 1;
    const pace = b.amount - (b.spent / days) * all - (b.committed || 0) - (b.teamsAndAllowances || 0);
    const ag = (D.payroll.agreements || []).find((a) => a.budget === d.id);
    return { text: `${d.name} has spent ${fmt.num(b.spent, 2)} and committed ${fmt.num(b.committed || 0, 2)} of its ${fmt.usdc(b.amount)} for ${fmt.date(b.from)} to ${fmt.date(b.to)}${b.teamsAndAllowances ? `, and handed ${fmt.num(b.teamsAndAllowances, 2)} down to teams and allowances` : ''}. ${top.length ? `Most of it is ${top.map(([n, v]) => `${n} (${fmt.num(v, 2)})`).join(', ')}.` : ''} ${ag ? `The committed part is ${cx.name(ag.payee)}'s next collection under the pay agreement: it is already promised, so I count it.` : ''} At this pace ${d.name} ends the quarter with about ${fmt.num(Math.max(0, pace), 2)} left. ${d.parent ? `More room comes from ${cx.deptName(d.parent)}, the hat above it (${holdersLine(d.parent)}).` : 'More room for a top department needs a Board proposal.'}`.replace(/\s+/g, ' '),
      lookedAt: [{ command: `capxul org department show ${d.id} ${ORG}`, result: `${d.name}: ${fmt.usdc(b.amount)} this quarter, ${fmt.num(b.spent, 2)} spent, ${fmt.num(b.committed || 0, 2)} committed, ${fmt.num(b.left, 2)} left` }, { command: `capxul payment list ${ORG} --from ${d.id} --since ${b.from}`, result: `${M.payments.filter((p) => p.budget === d.id && String(p.settledAt) >= b.from).length} payments since ${fmt.day(b.from)}` }],
      links: [{ label: `Open ${d.name}`, route: 'department', id: d.id }] };
  } },
  // proposals
  { test: (q) => /proposal|sp_0|approve|board/.test(q), run: (q, me) => {
    const waiting = D.board.proposals.filter((p) => p.status === 'Waiting');
    const dir = cx.wears('Director');
    const sp = waiting.find((p) => q.includes(p.id)) || waiting.find((p) => !p.approvals.some((a) => a.who === me.id)) || waiting[0];
    const looked = [{ command: `capxul org proposal list ${ORG} --status waiting`, result: waiting.map((p) => `${p.id} ${p.approvals.length} of ${p.threshold}`).join('; ') || 'none' }];
    if (!waiting.length) return { text: 'No Board proposal is waiting.', lookedAt: looked, links: [{ label: 'Proposals', route: 'proposals' }] };
    const list = waiting.map((p) => `${p.id} (${p.title}, ${p.approvals.length} of ${p.threshold}, approved by ${p.approvals.map((a) => cx.firstName(a.who)).join(' and ')})`).join('; ');
    if (!dir) return { text: `I can't approve anything as you: only Directors approve proposals (${D.board.directors.map((d) => cx.name(d.who)).join(', ')}), and you wear ${hatsLine(me)}. Waiting: ${list}.`, lookedAt: looked, links: [{ label: 'Proposals', route: 'proposals' }] };
    if (sp.approvals.some((a) => a.who === me.id)) return { text: `You have approved ${sp.id} already; it waits for ${D.board.directors.map((d) => d.who).filter((w) => !sp.approvals.some((a) => a.who === w)).map(cx.firstName).join(' or ')}. Waiting: ${list}.`, lookedAt: looked, links: [{ label: `Open ${sp.id}`, route: 'proposal', id: sp.id }] };
    return { text: `Waiting: ${list}. ${sp.id} needs one more Director; you're one of them. I've put it here for you to approve with your passkey. I can't sign it for you.`, lookedAt: [...looked, { command: `capxul org proposal get ${sp.id} ${ORG}`, result: sp.calls.join(' · ') }],
      draft: { for: me.id, by: FDE_HANDLE, at: stamp(), title: `Approve ${sp.id}: ${sp.title}`, why: sp.note || '', steps: sp.calls, cmd: `capxul org proposal approve ${sp.id} ${ORG}`, runLabel: 'Review and approve', onRun: () => N().approveProposal?.(sp) },
      links: [{ label: `Open ${sp.id}`, route: 'proposal', id: sp.id }] };
  } },
  // leave balance and payslip (personal)
  { test: (q) => /leave|holiday|payslip|my pay|next pay|salary/.test(q), run: (q, me) => {
    const emp = myEmployee(me);
    const allocs = D.hr.leaveAllocations.filter((a) => (a.employee === me.id || a.employee === emp) && a.toDate >= cx.today && a.fromDate <= cx.today);
    const taken = (lt) => D.hr.leaveApplications.filter((a) => (a.employee === me.id || a.employee === emp) && a.leaveType === lt && a.status === 'Approved' && a.fromDate.slice(0, 4) === cx.today.slice(0, 4)).reduce((s, a) => s + a.totalLeaveDays, 0);
    const slips = D.payroll.slips.filter((s) => s.employee === me.id || s.employee === emp).sort((a, b) => a.postingDate.localeCompare(b.postingDate));
    const last = slips.at(-1);
    const parts = [];
    if (/payslip|pay|salary/.test(q) && last) parts.push(`Your last payslip, ${last.name}, was ${fmt.money(last.netPay, last.currency)} net for ${fmt.date(last.startDate)} to ${fmt.date(last.endDate)}, paid ${fmt.date(last.postingDate)}. ${last.salaryStructure === 'Pay agreement' ? 'Your pay agreement collects on the 2nd of each month.' : 'The next one is paid on Monday 30 November, straight to your Safe.'}`);
    if (/leave|holiday/.test(q)) parts.push(allocs.length ? `Leave left this year: ${allocs.map((a) => `${a.leaveType} ${fmt.num(a.totalLeavesAllocated - taken(a.leaveType), 1)} of ${fmt.num(a.totalLeavesAllocated, 1)}`).join(', ')}. To book leave, tell me the dates or use Leave › New.` : 'You have no leave allocated this year.');
    return { text: parts.join(' ') || 'I found nothing for you yet.', lookedAt: [{ command: 'capxul payroll payslip list', result: `${slips.length} payslips` }, { command: 'capxul hr leave balance', result: allocs.map((a) => `${a.leaveType} ${a.totalLeavesAllocated}`).join(', ') || 'none' }], links: last && cx.hasRoute('me-payslip') ? [{ label: 'Your payslips', route: 'me-payslips' }] : [] };
  } },
  // timesheets
  { test: (q) => /timesheet/.test(q), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const wk = '2026-11-02';
    const sub = new Set(D.projects.timesheets.filter((t) => t.startDate === wk && t.status === 'Submitted').map((t) => t.employee));
    const due = D.people.filter((p) => p.status === 'Active' && p.id !== 'maya' && p.department !== 'operations' || ['nadia'].includes(p.id)).filter((p) => p.status === 'Active');
    const missing = due.filter((p) => !sub.has(p.id) && !['maya', 'nadia', 'kwame', 'samw'].includes(p.id));
    return { text: missing.length ? `For the week of ${fmt.date(wk)}, ${missing.map((p) => p.name).join(', ')} ${missing.length === 1 ? 'hasn\'t' : 'haven\'t'} submitted a timesheet. ${cx.wears('People') ? 'You wear People, so you can log time for someone without a seat.' : 'Whoever wears People can log time for someone without a seat.'}` : `Everyone who logs time submitted a timesheet for the week of ${fmt.date(wk)}. This week's drafts are still open.`, lookedAt: [{ command: `capxul org doc list timesheet --filter start_date=${wk}`, result: `${sub.size} people submitted` }], links: [{ label: 'Timesheets', route: cx.hasRoute('timesheets') ? 'timesheets' : 'projects' }] };
  } },
  // receivables
  { test: (q) => /owe|overdue|receivable|unpaid invoice|customers/.test(q), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const open = D.books.salesInvoices.filter((x) => x.outstanding > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const over = open.filter((x) => x.dueDate < cx.today);
    return { text: `Customers owe ${fmt.gbp(open.reduce((s, x) => s + x.outstanding, 0))} on ${open.length} invoices. Overdue: ${over.map((x) => `${x.customerName} ${fmt.gbp(x.outstanding)} (${x.name}, due ${fmt.day(x.dueDate)})`).join('; ') || 'none'}. Saltmarsh's ${fmt.gbp(13680)} is arriving by bank today and matches its invoice by reference.`, lookedAt: [{ command: `capxul org report run accounts-receivable ${ORG}`, result: `${open.length} open, ${over.length} overdue` }, { command: `capxul bank deposits ${ORG}`, result: '1 arriving' }], links: [{ label: 'Accounts receivable', route: 'accounts-receivable' }] };
  } },
  // who wears
  { test: (q) => /who (wears|holds|can)|hat/.test(q), run: (q) => {
    const d = findDept(q);
    if (d) return { text: `${holdersLine(d.id)} ${cx.holders(d.id).length > 1 ? 'wear' : 'wears'} the ${cx.deptName(d.id)} hat now.${d.parent ? ` Above it, ${holdersLine(d.parent)} wears ${cx.deptName(d.parent)}, and can act for it too.` : ''} The Board (${D.board.threshold} of ${D.board.directors.length} Directors) can act for any of them by proposal.`, lookedAt: [{ command: `capxul org department show ${d.id} ${ORG}`, result: `holders: ${cx.holders(d.id).join(', ')}` }], links: [{ label: `Open ${d.name}`, route: 'department', id: d.id }] };
    const off = ['People', 'Books', 'Invoicing'].find((x) => q.includes(x.toLowerCase()));
    if (off) return { text: `${D.seats.members.filter((m) => m.hats?.includes(off)).map((m) => cx.name(m.id)).join(', ')} ${off === 'People' ? 'wear' : 'wear'} the ${off} hat. Officer hats carry no money; the Board grants them.`, lookedAt: [{ command: `capxul org board show ${ORG}`, result: 'officer hats' }], links: [{ label: 'Board', route: 'board' }] };
    return { text: `Departments and their holders now: ${D.departments.map((x) => `${x.name}: ${holdersLine(x.id)}`).join('; ')}.`, lookedAt: [{ command: `capxul org department list ${ORG}`, result: `${D.departments.length} departments` }], links: [{ label: 'Departments', route: 'departments' }] };
  } },
  // vat / books reports
  { test: (q) => /vat|profit|p&l|loss|books/.test(q), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const m = D.books.reports.profitAndLoss.filter((x) => x.month < cx.today.slice(0, 7)).at(-1);
    if (/vat/.test(q) && !cx.wears('Books')) return { text: `I can't share the VAT return as you: it needs the Books hat, which ${D.seats.members.filter((x) => x.hats?.includes('Books')).map((x) => cx.name(x.id)).join(' and ')} wear${D.seats.members.filter((x) => x.hats?.includes('Books')).length > 1 ? '' : 's'}. Ask them to share it.`, lookedAt: [{ command: `capxul org me ${ORG}`, result: `${me.name}: ${hatsLine(me)}` }] };
    return { text: `In ${fmt.month(m.month)} Harbourline invoiced ${fmt.gbp(m.income)} and spent ${fmt.gbp(m.expense)}, a profit of ${fmt.gbp(m.profit)}.`, lookedAt: [{ command: `capxul org books reports profit-and-loss --from ${m.from} --to ${m.to}`, result: `income ${fmt.gbp(m.income)}, expense ${fmt.gbp(m.expense)}` }], links: [{ label: 'Profit and loss', route: 'profit-and-loss' }] };
  } },
];
function noSeat(me) {
  return { text: `You have no seat at Harbourline, so I can only show your own records: your payslips, your leave and money waiting for you. Ask me about those.`, lookedAt: [{ command: `capxul org me ${ORG}`, result: `${me.name}: no seat` }] };
}
async function answer(question, { context, me } = {}) {
  await sleep(500);
  const q = String(question).toLowerCase();
  for (const it of intents) {
    if (!it.test(q, String(context || '').toLowerCase())) continue;
    const r = it.run(q, me || cx.me(), context);
    if (r) { recordAsk(question); return r; }
  }
  recordAsk(question);
  const strip = document.querySelector('.strip-cmd')?.textContent?.replace(/^\$\s*/, '').trim();
  return { text: `I read "${context || 'Home'}" with your permissions (${hatsLine(me || cx.me())}). I can answer about money, budgets, payments, bills, seats, proposals, leave and payslips, and draft what needs your approval. ${strip ? 'This screen\'s command is below, so you can run it yourself.' : ''}`, lookedAt: strip ? [{ command: strip, result: 'read' }] : [] };
}
function recordAsk(q) {
  const at = stamp();
  F.recentAsks.unshift({ at, asker: cx.meId(), turn: cx.newId('turn'), until: new Date(Date.parse(at) + 15 * 60000).toISOString(), guest: false });
  F.hosting.lastAsked = { at, by: cx.meId() };
}
function suggestFor(name) {
  const me = cx.me();
  if (!cx.hasSeat()) return ["When's my next payslip?", 'How much leave do I have left?', 'Is any money waiting for me?'];
  if (/department/.test(name)) return [`Why is ${cx.current?.id ? cx.dept(cx.current.id)?.name || 'Engineering' : 'Engineering'} at this much of its budget?`, 'Who wears the Delivery hat?', "What's due this week?"];
  if (/seat|agent|member/.test(name)) return ['We need five more seats for the January hires.', 'Who wears People?', 'How many seats are free?'];
  if (/bank|payout|deposit|pay-by-bank/.test(name)) return ["Pay Brightfield's rent today.", 'Who owes us money?', "What's due this week?"];
  if (/money-waiting|payment/.test(name)) return ['Take back the money for Jules.', 'Hannah said her October pay never arrived.', "What's due this week?"];
  if (/board|proposal|vote|cap-table|option|round/.test(name)) return ['Which Board proposals are waiting?', 'Who can approve sp_0194?', 'How much runway do we have?'];
  if (/approval/.test(name)) return ['Which Board proposals are waiting?', "What's due this week?", 'Take back the money for Ian Pryce.'];
  return me.hats?.includes('Director') ? ["What's due this week?", 'How much runway do we have?', 'Which Board proposals are waiting?'] : ["What's due this week?", 'How much runway do we have?', "Who hasn't submitted timesheets?"];
}
cx.fde.answer = answer;
cx.fde.suggestions = suggestFor('home');
cx.on('route', (ctx) => { cx.fde.suggestions = suggestFor(ctx?.name || ''); });
cx.on('persona', () => { cx.fde.suggestions = suggestFor(cx.current?.name || ''); });

/* =====================================================================================================
   The FDE page: talk, your conversations, hosting, guests
   ===================================================================================================== */

function handover(ho, at) {
  const mine = ho.signer === cx.meId();
  const p = ho.payment ? M.payments.find((x) => x.id === ho.payment) : null;
  const tone = /Waiting/.test(ho.status) ? 'orange' : ho.status === 'Not now' ? 'muted' : 'green';
  return h('section.fd-hand',
    h('header', cx.icon('fde', { size: 13 }), h('span', 'Ready for ', h('b', cx.name(ho.signer)), ' to approve'), cx.pill(p && p.status !== 'Prepared' ? 'Done' : ho.status, p && p.status !== 'Prepared' ? 'green' : tone), at ? h('span', '· ' + fmt.agoLong(at)) : null),
    h('div.b', h('h4', ho.title),
      cx.kv([ho.from ? ['From', ho.from] : null, ho.to ? ['To', ho.to] : null, ho.amount ? ['Amount', ho.amount] : null, ['Signer', `${cx.name(ho.signer)} · wears ${ho.signerHat}`]].filter(Boolean)),
      h('div.confirm-cmd', ho.command.split(' && ').map((l, i) => [i ? '\n' : '', h('span.p', '$ '), l])),
      ho.note ? h('p', { style: 'font-size:12.5px;color:var(--muted)' }, ho.note) : null,
      p && p.status === 'Prepared' ? h('div', cx.btn('Review and approve', { kind: 'primary', icon: 'passkey', disabled: !mine, reason: `Only ${cx.name(ho.signer)} can approve this. The FDE never signs.`, cmd: ho.command, onClick: () => N().approvePrepared?.(p) }), ' ', cx.btn('Not now', { onClick: () => cx.toast('Left unsigned. Nothing moved.', { tone: 'info' }) })) : null));
}
function convoView(c) {
  return h('div.chat', c.turns.map((t) => h('div.chat-turn', { class: t.role === 'user' ? 'user' : 'fde' },
    t.lookedAt?.length ? h('div.looked', h('span', 'What I looked at'), t.lookedAt.map((x) => h('div', h('code', '$ ' + x.command), x.result ? h('div', h('span', x.result)) : null))) : null,
    t.refused ? h('div.fd-refused', t.refused) : null,
    h('div.bubble', t.text),
    t.handover ? handover(t.handover, t.at) : null,
    h('div', { style: 'font-size:11.5px;color:var(--faint)' }, `${t.role === 'user' ? cx.name(c.asker) : FDE_HANDLE} · ${fmt.datetime(t.at)} · ${t.id}`))));
}
function talkPanel(pageTurns, ctxLabel) {
  const me = cx.me();
  const body = h('div.fd-body');
  const ta = h('textarea.finput', { rows: 2, placeholder: 'Ask anything about Harbourline', 'aria-label': 'Ask the FDE' });
  const draw = () => {
    cx.fill(body, pageTurns.length ? pageTurns.map((t) => h('div.chat-turn', { class: t.role },
      t.role === 'fde' && t.lookedAt?.length ? h('div.looked', h('span', 'What I looked at'), t.lookedAt.map((x) => h('div', h('code', '$ ' + x.command), x.result ? h('div', h('span', x.result)) : null))) : null,
      h('div.bubble', t.text === '…' ? h('span', { style: 'color:var(--muted)' }, 'Working…') : t.text),
      t.draft ? cx.draft(t.draft) : null,
      t.links?.length ? h('div.chips', t.links.filter((l) => cx.hasRoute(l.route)).map((l) => h('a.btn.sm', { href: cx.href(l.route, l.id) }, l.label))) : null)) : h('div', { style: 'display:grid;gap:8px' }, h('p', { style: 'color:var(--muted)' }, 'Ask about anything in the company. Try:'), h('div.suggest', suggestFor(cx.current?.name || 'fde').map((sg) => h('button', { type: 'button', onclick: () => ask(sg) }, sg)))));
    body.scrollTop = body.scrollHeight;
  };
  async function ask(qs) {
    qs = String(qs || '').trim(); if (!qs) return;
    cx.showAction(`capxul org fde ask ${JSON.stringify(qs)} ${ORG}`, 'Ask the FDE', { pin: true });
    pageTurns.push({ role: 'user', text: qs }, { role: 'fde', text: '…' });
    draw();
    const r = await answer(qs, { context: ctxLabel, me: cx.me() });
    pageTurns[pageTurns.length - 1] = { role: 'fde', ...r };
    draw();
  }
  draw();
  return cx.card({ flush: true, body: h('div',
    h('div.fd-head', cx.avatar(FDE_HANDLE, { size: 'sm' }), h('span', h('b', "Harbourline's FDE"), ` · acting as you (${me.name}: ${hatsLine(me)})`), F.hosting.status === 'Running' ? cx.pill('Running', 'green') : cx.pill(F.hosting.status, 'red')),
    body,
    h('div.fd-foot', h('form', { onsubmit: (e) => { e.preventDefault(); const v = ta.value; ta.value = ''; ask(v); } }, ta, h('button.btn.primary', { type: 'submit' }, cx.icon('send'), h('span', 'Ask'))), h('span', { style: 'font-size:12px;color:var(--muted)' }, 'The FDE can make mistakes. It can only do what you can do, and it drafts anything risky for you to run.'))) });
}
const pageTurns = [];
function payHosting() {
  const hst = F.hosting;
  const budgets = N().payableBudgets?.() || [];
  const from = budgets.includes('capxul') ? 'capxul' : budgets[0];
  const cmd = `capxul org fde pay 1 ${ORG} --from ${from || '<budget>'}`;
  if (!from) { cx.toast(`${cx.me().name} holds no budget to pay from. Kwame Mensah holds the Capxul allowance.`, { tone: 'warning' }); return; }
  return N().payFromBudget({ title: 'Pay for the FDE\'s hosting, 1 month', to: 'Capxul · FDE hosting', payee: N().CAPXUL_PAYEE, amount: hst.price, budget: from, memo: `FDE hosting to ${fmt.date(addDays(hst.paidThrough, 30))}`, cmd }).then((p) => {
    if (!p) return;
    const next = new Date(hst.paidThrough + 'T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1);
    hst.paidThrough = next.toISOString().slice(0, 10); hst.due = addDays(hst.paidThrough, -7); hst.monthsPaid += 1; hst.paidTotal += hst.price;
    const w = D.approvals.waiting; for (let i = w.length - 1; i >= 0; i--) if (w[i].ref?.type === 'fde') w.splice(i, 1);
    cx.toast(`Hosting paid through ${fmt.date(hst.paidThrough)}.`, { tone: 'success', cmd }); cx.refresh();
  });
}
function nameGuest() {
  const model = { email: '', note: '' };
  const cmdOf = () => `capxul org fde guest add ${model.email || '<email>'} --note ${JSON.stringify(model.note || '…')} ${ORG}`;
  cx.modal({ title: 'Name a guest', body: h('div', { style: 'display:grid;gap:10px' }, h('div.fields', { style: { '--cols': 2 } }, cx.field({ label: 'Email', edit: true, model, key: 'email', onChange: () => cx.showAction(cmdOf(), 'Name a guest', { pin: true }) }), cx.field({ label: 'Note', edit: true, model, key: 'note', placeholder: 'Our accountant' })), h('p', { style: 'font-size:12.5px;color:var(--muted)' }, 'A guest may ask the FDE about their own dealings with Harbourline only. It reads nothing else of the company\'s for them.')),
    actions: [{ label: 'Back' }, { label: 'Name them', primary: true, needs: { any: ['People', 'Director'] }, cmd: cmdOf(), onClick: (close) => { if (!/@/.test(model.email)) return; F.guests.push({ email: model.email, name: model.email.split('@')[0], note: model.note, namedBy: cx.meId(), since: cx.today, status: 'Active' }); close(); cx.toast(`${model.email} can now ask the FDE about their own dealings.`, { tone: 'success', cmd: cmdOf() }); cx.refresh(); } }] });
}
cx.route('fde', (ctx) => {
  const me = cx.me();
  const hst = F.hosting;
  const mine = F.conversations.filter((c) => c.asker === me.id).sort((a, b) => b.at.localeCompare(a.at));
  const months = [...new Set(F.asksByMonth.map((a) => a.month))].sort();
  const talk = () => h('div', { style: 'display:grid;gap:12px;padding-top:12px' }, talkPanel(pageTurns, 'FDE › Talk'));
  const convos = () => h('div', { style: 'display:grid;gap:12px;padding-top:12px' },
    cx.banner('Capxul records each ask (who asked, when, and until when the FDE may act for them), never the message. Only you read your own conversations.', { tone: 'info' }),
    cx.card({ title: 'Your conversations', flush: true, body: mine.length ? h('ul.feed', mine.map((c) => h('li', cx.icon('message'), h('a', { href: cx.href('fde-conversation', c.id), style: 'color:inherit;min-width:0' }, h('b', c.turns[0].text), h('div', { style: 'font-size:12px;color:var(--muted)' }, `on ${c.screen} · ${c.turns.length} turns${c.turns.some((t) => t.handover) ? ' · a hand-over' : ''}`)), h('span.ago', { title: fmt.datetime(c.at) }, fmt.ago(c.at))))) : cx.empty('You have not talked to the FDE yet.') }),
    cx.card({ title: 'Asks the book keeps', flush: true, cmd: `capxul org fde show ${ORG}`, body: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Asked'), h('th', 'By'), h('th.opt', 'Turn'), h('th', 'May act until'))), h('tbody', F.recentAsks.slice(0, 12).map((a) => h('tr', h('td', fmt.datetime(a.at)), h('td', a.guest ? 'a guest' : cx.personChip(a.asker)), h('td.opt.mono', { style: 'font-size:12px' }, a.turn.slice(0, 16) + '…'), h('td', fmt.time(a.until))))))) }));
  const hosting = () => h('div', { style: 'display:grid;gap:12px;padding-top:12px' },
    h('div.grid.c2',
      cx.card({ title: 'Hosting', cmd: `capxul org fde show ${ORG}`, body: cx.kv([['Status', cx.pill(`${hst.status} on Capxul`, hst.status === 'Running' ? 'green' : 'red')], ['Handle and Safe', h('span', hst.handle, ' · ', cx.addr(hst.safe))], ['Hats its Safe wears', 'none: it acts with each asker\'s hats, not its own'], ['Started', fmt.date(hst.started)], ['Paid through', `${fmt.date(hst.paidThrough)}, 00:00`], ['Due', `${fmt.date(hst.due)} (seven days before)`], ['Price', `${fmt.usdc(hst.price)} a month`], ['Months paid', `${hst.monthsPaid} (${fmt.usdc(hst.paidTotal)})`], ['Last asked', `${fmt.datetime(hst.lastAsked.at)}, by ${cx.name(hst.lastAsked.by)}`]]) }),
      cx.card({ title: 'Asks each month', body: cx.chart.bar({ labels: months.map((m) => fmt.monthShort(m)), series: [{ name: 'Asks', values: months.map((m) => F.asksByMonth.filter((a) => a.month === m).reduce((s, a) => s + a.count, 0)), color: '1' }], height: 200, format: (v) => String(Math.round(v)) }) })),
    cx.banner(`If hosting is not paid by ${fmt.date(hst.paidThrough)}, the FDE pauses. Nothing on chain changes, and paying resumes it.`, { tone: 'info', action: cx.btn('Pay for hosting', { sm: true, kind: 'primary', icon: 'passkey', needs: () => ((N().payableBudgets?.() || []).length ? true : 'Needs a budget whose hat you wear. A person pays, never an agent.'), cmd: `capxul org fde pay 1 ${ORG} --from capxul`, onClick: payHosting }) }));
  const guests = () => h('div', { style: 'display:grid;gap:12px;padding-top:12px' }, cx.card({ title: 'Guests', flush: true, cmd: `capxul org fde guest list ${ORG}`, actions: cx.btn('Name a guest', { sm: true, icon: 'plus', needs: { any: ['People', 'Director'] }, cmd: `capxul org fde guest add <email> --note "…" ${ORG}`, onClick: nameGuest }), body: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Guest'), h('th', 'Note'), h('th.opt', 'Named by'), h('th', 'Since'), h('th', 'Status'), h('th', ''))), h('tbody', F.guests.map((g) => h('tr', h('td.wrap', h('b', g.name), h('div', { style: 'font-size:12px;color:var(--muted)' }, g.email)), h('td.wrap', g.note), h('td.opt', cx.name(g.namedBy)), h('td', fmt.date(g.since)), h('td', cx.pill(g.status === 'Active' ? 'Active' : `Removed ${fmt.date(g.removed)}`, g.status === 'Active' ? 'green' : 'muted')), h('td', g.status === 'Active' ? cx.btn('Remove', { sm: true, needs: { any: ['People', 'Director'] }, cmd: `capxul org fde guest remove ${g.email} ${ORG}`, onClick: async () => { if (await cx.confirm({ title: `Remove ${g.name} as a guest?`, body: 'They can no longer ask the FDE about Harbourline.', cmd: `capxul org fde guest remove ${g.email} ${ORG}`, danger: true, confirmLabel: 'Remove' })) { g.status = 'Removed'; g.removed = cx.today; cx.toast('Removed.', { cmd: `capxul org fde guest remove ${g.email}` }); cx.refresh(); } } }) : null)))))) }),
    h('p', { style: 'font-size:12.5px;color:var(--muted)' }, 'A guest asks about their own dealings only: Sam Hollis can see Hollis & Reed\'s invoices and payments, never the VAT return.'));
  const tabs = [{ label: 'Talk', render: talk }, { label: 'Your conversations', count: mine.length, render: convos }, { label: 'Hosting', render: hosting }, { label: 'Guests', count: F.guests.filter((g) => g.status === 'Active').length, render: guests }];
  const want = ctx.state?.tab ? tabs.findIndex((t) => t.label === ctx.state.tab) : -1;
  return cx.page({
    title: 'FDE', sub: h('span', `${hst.handle} · Harbourline's Forward Deployed Engineer, hosted by Capxul · anyone in Harbourline can talk to it; it acts only with the asker's permissions`),
    status: [cx.pill(hst.status, hst.status === 'Running' ? 'green' : 'red', { lg: true })],
    actions: [cx.btn('Open in the side panel', { icon: 'fde', onClick: () => cx.fde.open() })],
    cmd: { cli: `capxul org fde show ${ORG}`, sdk: 'client.org(orgId).fde.show()', json: { handle: hst.handle, safe: hst.safe, status: hst.status.toLowerCase(), paidThrough: hst.paidThrough, due: hst.due, price: `${hst.price.toFixed(2)} USDC`, guests: F.guests.filter((g) => g.status === 'Active').length } },
    fde: 'FDE',
    body: tabsV(tabs, { key: 'fde', active: want >= 0 ? want : undefined }),
  });
}, { workspace: 'fde', title: 'FDE' });

cx.route('fde-conversation', (ctx) => {
  const c = cx.find(F.conversations, 'id', ctx.id);
  if (!c) return cx.page({ title: 'Not found', body: cx.empty('No such conversation', cx.btn('FDE', { href: ['fde'] })) });
  const mine = c.asker === cx.meId();
  return cx.page({
    title: mine ? c.turns[0].text : 'A conversation', crumbs: [{ label: 'FDE', route: 'fde' }],
    sub: `${cx.name(c.asker)} · on ${c.screen} · ${fmt.datetime(c.at)}`,
    cmd: { cli: `capxul org fde turn get ${c.turns.at(-1).id} ${ORG}`, sdk: `client.org(orgId).fde.turns.get("${c.turns.at(-1).id}")` },
    body: mine ? cx.card({ body: convoView(c) }) : cx.empty(`Only ${cx.name(c.asker)} reads their own conversation: the reply may hold what only they may see.`),
  });
}, { workspace: 'fde', title: 'Conversation' });

/* =====================================================================================================
   Activity: the money feed
   ===================================================================================================== */

const actRows = () => cx.rows('activity');
const findAct = (id) => actRows().find((r) => cx.slug(r.payment || r.tx) === cx.slug(id));
cx.route('activity', () => {
  const st = cx.store.get('activity-f', { kind: '', dir: '', budget: '', month: '' });
  let limit = 60;
  const list = h('div');
  const sum = h('div.ncards');
  const filt = (r) => (!st.kind || r.kind === st.kind) && (!st.dir || r.direction === st.dir) && (!st.budget || r.budget === st.budget) && (!st.month || String(r.at).startsWith(st.month));
  const months = [...new Set(actRows().map((r) => String(r.at).slice(0, 7)))].sort().reverse();
  const sel = (key, opts, label) => h('select.ctl', { 'aria-label': label, onchange: (e) => { st[key] = e.target.value; cx.store.set('activity-f', st); limit = 60; draw(); } }, opts.map(([v, t]) => h('option', { value: v, selected: st[key] === v }, t)));
  const filters = h('div.fd-filters',
    sel('kind', [['', 'Any kind'], ['Payment', 'Payments'], ['Outside money', 'Outside money']], 'Kind'),
    sel('dir', [['', 'Any direction'], ['In', 'In'], ['Out', 'Out'], ['Between your Safes', 'Between your Safes']], 'Direction'),
    sel('budget', [['', 'Any budget'], ...D.departments.map((d) => [d.id, d.name]), ...D.allowances.map((a) => [a.id, a.name + ' allowance'])], 'From'),
    sel('month', [['', 'Any month'], ...months.map((m) => [m, fmt.month(m)])], 'Month'));
  const draw = () => {
    const rows = actRows().filter(filt);
    const inn = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const out = rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0);
    const pend = M.deposits.filter((d) => d.status === 'Arriving');
    const flags = [st.kind === 'Outside money' ? '--kind movement' : st.kind === 'Payment' ? '--kind payment' : '', st.dir ? `--direction ${st.dir.toLowerCase().split(' ')[0]}` : '', st.month ? `--from ${st.month}-01` : ''].filter(Boolean).join(' ');
    cx.setCommand({ cli: `capxul activity list ${ORG}${flags ? ' ' + flags : ''} --limit 25`, sdk: 'client.activity.list({ org: "harbourline", limit: 25 })', json: { items: rows.slice(0, 3).map((r) => ({ kind: r.kind === 'Payment' ? 'payment' : 'movement', at: r.at, direction: r.direction.toLowerCase(), amount: String(r.amount), asset: 'USDC', counterparty: r.counterparty, status: r.status, txHash: r.tx })), next: 'cursor_…' } });
    cx.fill(sum,
      cx.numberCard({ label: 'In', value: '+' + fmt.usdc(inn), sub: fmt.gbp(inn * RATE), cmd: `capxul activity summary ${ORG}` }),
      cx.numberCard({ label: 'Out', value: '−' + fmt.usdc(out), sub: fmt.gbp(out * RATE) }),
      cx.numberCard({ label: 'Net', value: (inn - out >= 0 ? '+' : '−') + fmt.usdc(Math.abs(inn - out)), delta: { text: inn >= out ? 'more in than out' : 'more out than in', good: inn >= out } }),
      cx.numberCard({ label: 'Pending in', value: pend.map((d) => fmt.money(d.bankAmount, d.currency)).join(' + ') || '0', sub: `${rows.length} movements` }));
    const shown = rows.slice(0, limit);
    const days = new Map();
    for (const r of shown) { const d = String(r.at).slice(0, 10); if (!days.has(d)) days.set(d, []); days.get(d).push(r); }
    cx.fill(list, shown.length ? cx.card({ flush: true, body: h('ul.fd-feed', [...days.entries()].map(([d, rs]) => h('li', h('div.fd-day', d === cx.today ? 'Today' : fmt.dateLong(d)), rs.map((r) => {
      const isIn = r.amount > 0;
      return h('a.fd-row', { href: cx.href('activity-item', r.payment || r.tx) },
        h('span.ic-wrap', { class: isIn ? 'in' : 'out' }, cx.icon(r.direction === 'Between your Safes' ? 'swap' : isIn ? 'in' : 'out', { size: 14 })),
        h('span.t', h('b', `${isIn ? 'From' : r.direction === 'Between your Safes' ? '' : 'To'} ${r.counterparty}`.trim()), h('small', [fmt.time(r.at), r.kind === 'Outside money' ? 'Outside money (received via Bridge)' : 'Payment', r.budget ? cx.deptName(r.budget) : null, r.tx ? fmt.hash(r.tx) : null].filter(Boolean).join(' · '))),
        h('span.r', cx.amount(r.amount, 'USDC', { gbp: r2(r.amount * RATE), sign: true, color: true }), r.kind === 'Payment' ? cx.pill(r.status + (r.outcome ? ' · ' + r.outcome : ''), r.status === 'Settled' ? 'green' : r.status === 'Money waiting' ? 'escrow' : 'muted') : null));
    })))) }) : cx.empty('Nothing matches.'), rows.length > limit ? h('div', { style: 'text-align:center' }, cx.btn(`Load more (${rows.length - limit} older)`, { onClick: () => { limit += 100; draw(); } })) : null);
  };
  draw();
  return cx.page({
    title: 'Activity', sub: 'Everything that moved money for Harbourline, newest first: Capxul payments and outside money',
    actions: [cx.btn('Follow live', { icon: 'activity', cmd: `capxul activity events ${ORG} --wait`, onClick: () => cx.toast('Following: new rows slide in at the top as the chain confirms them.', { cmd: `capxul activity events ${ORG} --wait` }) })],
    cmd: { cli: `capxul activity list ${ORG} --limit 25`, sdk: 'client.activity.list({ org: "harbourline", limit: 25 })' },
    body: [filters, sum, list],
  });
}, { workspace: 'activity', title: 'Activity' });

cx.route('activity-item', (ctx) => {
  const r = findAct(ctx.id);
  if (!r) return cx.page({ title: 'Not found', body: cx.empty('No such movement', cx.btn('Activity', { href: ['activity'] })) });
  const p = r.payment ? M.payments.find((x) => x.id === r.payment) : null;
  const ann = (r.annotation ||= { account: p?.account || null, memo: p?.memo || null });
  const isMove = r.kind === 'Outside money';
  const id = isMove ? `8453:${r.tx}:${p?.proof?.logIndex ?? 211}:in` : r.payment;
  const annotate = () => {
    const model = { account: ann.account || '', memo: ann.memo || '' };
    const accts = (D.books.accounts || []).filter((a) => !a.isGroup && a.code);
    const cmdOf = () => `capxul activity annotate --kind ${isMove ? 'movement' : 'payment'} --id ${id} --account ${model.account || '<code>'}${model.memo ? ` --memo ${JSON.stringify(model.memo)}` : ''}`;
    cx.modal({ title: 'Annotate', body: h('div', { style: 'display:grid;gap:10px' }, cx.field({ label: 'Account', type: 'select', edit: true, model, key: 'account', options: [['', 'Choose'], ['6999', 'Not sure: 6999 (Books reviews it)'], ...accts.map((a) => [a.code, `${a.code} · ${a.name}`])], onChange: () => cx.showAction(cmdOf(), 'Annotate', { pin: true }) }), cx.field({ label: 'Memo', edit: true, model, key: 'memo' })),
      actions: [{ label: 'Back' }, { label: 'Save', primary: true, needs: { seat: true }, cmd: cmdOf(), onClick: (close) => { ann.account = model.account; ann.memo = model.memo; close(); cx.toast('Annotated.', { tone: 'success', cmd: cmdOf() }); cx.refresh(); } }] });
  };
  const acc = ann.account ? (D.books.accounts || []).find((a) => String(a.code) === String(ann.account)) : null;
  return cx.page({
    title: `${r.amount > 0 ? 'From' : 'To'} ${r.counterparty}`, crumbs: [{ label: 'Activity', route: 'activity' }],
    status: [cx.pill(isMove ? 'Outside money' : r.status, isMove ? 'teal' : r.status === 'Settled' ? 'green' : 'muted', { lg: true })],
    sub: h('span', cx.amount(r.amount, 'USDC', { gbp: r2(r.amount * RATE), sign: true }), ' · ', fmt.datetime(r.at)),
    actions: [cx.btn('Annotate', { icon: 'edit', cmd: `capxul activity annotate --kind ${isMove ? 'movement' : 'payment'} --id ${id} --account <code>`, onClick: annotate }), p ? cx.btn('Open the payment', { kind: 'primary', href: ['payment', p.id] }) : null].filter(Boolean),
    cmd: { cli: `capxul activity get --kind ${isMove ? 'movement' : 'payment'} --id ${id}`, sdk: `client.activity.get({ kind: "${isMove ? 'movement' : 'payment'}", id: "${id}" })` },
    body: [
      h('div.grid.c2',
        cx.card({ title: 'Movement', body: cx.kv([['Time', fmt.utc(r.at)], ['Kind', isMove ? 'Outside money (received from outside Capxul, via Bridge)' : 'Capxul payment'], ['Direction', cx.dir(r.direction)], ['Amount', fmt.usdc(r.amount)], ['Counterparty', r.counterparty], ['Account', r.safe], ['From budget', r.budget ? cx.deptName(r.budget) : '—']]) }),
        cx.card({ title: 'Evidence', body: cx.kv([['Chain', 'Base · 8453'], ['Contract', isMove ? 'USDC 0x8335…2913' : 'Budgets (Capxul payments)'], ['Settled through', p?.proof?.settledThrough || (isMove ? 'a Transfer into the Treasury' : '—')], ['Token', 'USDC'], ['Transaction', r.tx ? cx.tx(r.tx) : '—'], ['Block', p?.proof?.block ? fmt.int(p.proof.block) : p?.deposit ? fmt.int(M.deposits.find((d) => d.id === p.deposit)?.block || 0) : '—'], ['Log', p?.proof ? `PaymentSent #${p.proof.logIndex}, Transfer #${p.proof.logIndex - 1}` : `Transfer #${p?.proof?.logIndex ?? 211}`]]) })),
      cx.card({ title: 'Annotation', body: h('div', { style: 'display:grid;gap:8px' }, cx.kv([['Account', acc ? `${acc.code} · ${acc.name}` : ann.account || 'not set'], ['Memo', ann.memo || '—']]), h('p', { style: 'font-size:12.5px;color:var(--muted)' }, '"Not sure" puts it in 6999 or 4999 for Books to review.')) }),
    ],
  });
}, { workspace: 'activity', title: 'Movement' });

/* =====================================================================================================
   Events and notices
   ===================================================================================================== */

const EV_ICON = { Money: 'money', People: 'hr', Payroll: 'payroll', Projects: 'projects', Agents: 'fde', Board: 'board', Equity: 'board', CRM: 'crm', Books: 'books', Departments: 'departments', Seats: 'seats', Banking: 'bank', Company: 'home' };
cx.route('events', () => {
  let kind = cx.store.get('events-kind', '');
  const box = h('div');
  const kinds = [...new Set(D.events.map((e) => e.kind))].sort();
  const draw = () => {
    const rows = D.events.filter((e) => !kind || e.kind === kind);
    const days = new Map();
    for (const e of rows) { const d = String(e.at).slice(0, 10); if (!days.has(d)) days.set(d, []); days.get(d).push(e); }
    cx.fill(box, cx.card({ flush: true, body: h('ul.fd-feed', [...days.entries()].map(([d, es]) => h('li', h('div.fd-day', d === cx.today ? 'Today' : fmt.dateLong(d)), es.map((e) => {
      const href = cx.refHref(e.ref);
      return h(href ? 'a.fd-row' : 'div.fd-row', { href }, e.who ? cx.avatar(e.who, { size: 'sm' }) : h('span.ic-wrap', cx.icon(EV_ICON[e.kind] || 'activity', { size: 13 })), h('span.t', h('b', e.text), h('small', `${e.kind} · ${fmt.time(e.at)}`)), h('span.r', h('span', { style: 'font-size:12px;color:var(--muted)' }, fmt.ago(e.at))));
    })))) }));
  };
  draw();
  return cx.page({
    title: 'Events', sub: 'What happened at Harbourline, newest first',
    actions: [h('select.ctl', { 'aria-label': 'Kind', style: 'width:auto', onchange: (e) => { kind = e.target.value; cx.store.set('events-kind', kind); draw(); } }, [['', 'Every kind'], ...kinds.map((k) => [k, k])].map(([v, t]) => h('option', { value: v, selected: v === kind }, t)))],
    cmd: { cli: `capxul activity events ${ORG}`, note: 'Money events come from the chain; the rest from each record\'s changes.' },
    body: box,
  });
}, { workspace: 'activity', title: 'Events' });

cx.route('notices', () => {
  const me = cx.me();
  let kind = '';
  const box = h('div');
  const mine = () => D.notices.filter((n) => n.to === me.id);
  const kinds = ['Money', 'Board', 'HR', 'People', 'Banking', 'FDE'];
  const chips = h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' });
  const draw = () => {
    cx.fill(chips, [['', 'All'], ...kinds.map((k) => [k, k])].map(([v, t]) => cx.btn(`${t} · ${v ? mine().filter((n) => n.kind === v).length : mine().length}`, { sm: true, kind: kind === v ? 'primary' : null, onClick: () => { kind = v; draw(); } })));
    const rows = mine().filter((n) => !kind || n.kind === kind);
    cx.fill(box, cx.card({ flush: true, body: rows.length ? h('div', rows.map((n) => {
      const href = cx.refHref(n.ref);
      return h('div.fd-notice', { class: { read: n.read } }, h('span.dot2'), h('div', h('div.tx', n.text), h('small', `${n.kind} · ${fmt.datetime(n.at)} · sent by email to ${me.companyEmail || me.email || me.personalEmail}`)), href ? cx.btn('Open', { sm: true, href, onClick: () => { n.read = true; } }) : h('span'));
    })) : cx.empty('No notices for you.') }));
  };
  draw();
  return cx.page({
    title: 'Notices', crumbs: [], sub: `What Capxul told ${me.name}, newest first. Notices are emails; the bell shows the same.`,
    actions: [cx.btn('Mark all read', { onClick: () => { mine().forEach((n) => { n.read = true; }); cx.toast('All read.'); cx.refresh(); } })],
    cmd: { cli: `capxul dev mail notices --to ${me.companyEmail || me.email || 'you'}`, note: 'No command lists a person\'s notices (a gap the book records); on the devnet, dev mail notices shows the emails.' },
    body: [chips, box],
  });
}, { workspace: 'yours', title: 'Notices' });

/* =====================================================================================================
   Search
   ===================================================================================================== */

cx.search.add((qs, limit) => {
  const t = qs.toLowerCase();
  const out = [];
  for (const c of F.conversations) if (c.asker === cx.meId() && c.turns[0].text.toLowerCase().includes(t)) out.push({ kind: 'FDE', label: c.turns[0].text, sub: `${c.screen} · ${fmt.date(c.at)}`, route: 'fde-conversation', id: c.id, icon: 'fde' });
  for (const g of F.guests) if (g.name.toLowerCase().includes(t) || g.email.includes(t)) out.push({ kind: 'FDE', label: `${g.name} (guest)`, sub: g.note, route: 'fde', icon: 'fde' });
  return out.slice(0, limit);
});
