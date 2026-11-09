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
    if (d < from || d > to || r.safe !== 'Treasury' || r.direction === 'Between your Safes' || purpose.get(r.payment) === 'investment') continue;
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
    return { text: `Cash is ${fmt.usdc(cash)} across the two Safes (about ${fmt.gbp(r2(cash * RATE))}) plus ${fmt.gbp(bank?.balance || 0)} in Barclays. Over August to October, ${fmt.usdc(out / 3)} a month left the Treasury (suppliers, payroll and top-ups of Barclays) and ${fmt.usdc(inn / 3)} a month came in from customers, so the net burn is about ${fmt.usdc(burn)} a month. ${months ? `On that pace the money lasts ${months} months.` : 'More came in than went out.'} The seed money sits in the Reserve Safe and only moves to the Treasury by Board proposal.`,
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
/* ---------- HR, payroll, CRM and projects: the asks the module pages send, answered over the live data ---------- */

const MONTH_IX = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11, jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
/** "21 to 24 December", "21-24 Dec", "from 3 to 5 March": the first range of days in a sentence, in the year ahead. */
function dayRange(q) {
  const m = q.match(/(\d{1,2})(?:st|nd|rd|th)?\s*(?:to|-|–|until|till)\s*(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/) || q.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s*(?:to|-|–|until|till)\s*(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/);
  if (!m) return null;
  let d1, d2, m1, m2;
  if (m.length === 4) { d1 = +m[1]; d2 = +m[2]; m1 = m2 = MONTH_IX[m[3]]; } else { d1 = +m[1]; m1 = MONTH_IX[m[2]]; d2 = +m[3]; m2 = MONTH_IX[m[4]]; }
  if (m1 == null || m2 == null) return null;
  const y = +cx.today.slice(0, 4);
  let from = ymd(y, m1, d1), to = ymd(y, m2, d2);
  if (from < cx.today) { from = ymd(y + 1, m1, d1); to = ymd(y + 1, m2, d2); }
  if (to < from) to = ymd(+from.slice(0, 4) + 1, m2, d2);
  return { from, to };
}
function holidayOn(day) {
  for (const l of D.hr.holidayLists) for (const x of l.holidays) if (x.date === day) return x;
  return null;
}
function workingDays(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) { const wd = new Date(d + 'T00:00:00Z').getUTCDay(); if (wd !== 0 && wd !== 6 && !holidayOn(d)) out.push(d); }
  return out;
}
const peopleWearers = () => D.people.filter((p) => p.status === 'Active' && (p.hats || []).includes('People')).map((p) => p.id);
const firstPeople = (me) => ((me.hats || []).includes('People') ? me.id : peopleWearers()[0]);
const harbourlineHolder = () => cx.holders('harbourline').find((x) => !String(x).startsWith('@')) || 'maya';
const isPeople = (me) => (me.hats || []).includes('People');
function leaveLeft(id, type) {
  const emp = cx.person(id)?.employee;
  const a = D.hr.leaveAllocations.find((x) => (x.employee === id || x.employee === emp) && x.leaveType === type && x.fromDate <= cx.today && x.toDate >= cx.today);
  if (!a) return null;
  const used = D.hr.leaveApplications.filter((x) => (x.employee === id || x.employee === emp) && x.leaveType === type && ['Approved', 'Open'].includes(x.status) && x.fromDate >= a.fromDate && x.toDate <= a.toDate).reduce((s, x) => s + x.totalLeaveDays, 0);
  return { allocated: a.totalLeavesAllocated, left: r2(a.totalLeavesAllocated - used), to: a.toDate };
}
const nameIn = (q) => D.people.find((p) => q.includes(p.name.toLowerCase())) || D.people.find((p) => new RegExp(`\\b${p.firstName.toLowerCase()}('s)?\\b`).test(q));
const runPay = (run) => { const slips = D.payroll.slips.filter((s) => s.payrollEntry === run.name); return { slips, net: r2(slips.reduce((s, x) => s + x.netPay, 0)) }; };

const moreIntents = [
  // a new hire: the founder's steps, and People's steps drafted for whoever wears People
  { test: (q) => /\b(hire|hiring|new starter|onboard|joins|joining|starts on|starting on|start on)\b/.test(q) && !/\bhannah\b/.test(q), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const owen = D.others.find((o) => o.id === 'owen');
    const inv = D.seats.invitations.find((i) => i.email === owen.email);
    const eng = cx.budgetOn('engineering');
    const sp = D.board.proposals.find((p) => p.id === 'sp_0194');
    const founder = harbourlineHolder();
    const people = firstPeople(me);
    const monthly = 6250, quarter = r2(monthly * 3 * 1.18 / RATE);
    const newBudget = Math.ceil((eng.amount + quarter) / 1000) * 1000;
    const pool = D.equity.pool, granted = D.equity.grants.filter((g) => g.status === 'Active').reduce((s, g) => s + g.shares, 0);
    const looked = [
      { command: `capxul org invite list ${ORG}`, result: inv ? `${owen.email}: ${inv.status}, sent ${fmt.day(inv.sentAt)} by ${cx.firstName(inv.sentBy)}, expires ${fmt.day(inv.expires)}` : 'no invitation' },
      { command: `capxul org department show engineering ${ORG}`, result: `${fmt.usdc(eng.amount)} a quarter; ${fmt.usdc(eng.left)} left this quarter` },
      { command: `capxul org options show ${ORG}`, result: `${fmt.int(pool.reserved - granted)} options left in the pool` },
      sp ? { command: `capxul org proposal get ${sp.id} ${ORG}`, result: `${sp.title}: ${sp.approvals.length} of ${sp.threshold}` } : null,
    ].filter(Boolean);
    const founderDraft = { for: founder, by: FDE_HANDLE, at: stamp(), title: `Owen Grady's hire: the founder's two steps`,
      why: `Owen joins Engineering as a Senior Software Engineer on Monday 4 January 2027, on ${fmt.gbp(monthly * 12, 0)} a year. His pay comes out of Engineering's budget, and his options need the Board.`,
      steps: [
        `Raise Engineering's budget from ${fmt.usdc(eng.amount, 0)} to ${fmt.usdc(newBudget, 0)} a quarter from Q1 2027, for his salary and employer costs. You wear Harbourline, the hat above Engineering, so it is your passkey.`,
        `Offer him 40,000 options at 0.25 USDC, vesting over 4 years with a 1-year cliff from 4 January 2027. It is a Board proposal: you approve it first, then Tom or Ruth.`,
      ],
      cmd: [`capxul org department budget set engineering --budget ${newBudget}/quarter --from 2027-01-01 --note "Owen Grady joins 4 Jan" ${ORG}`, `capxul org options grant --to ${owen.email} --shares 40000 --strike 0.25 --agreement option-agreement.pdf --vest 4y --cliff 1y --start 2027-01-04 ${ORG}`],
      runLabel: 'Review and approve',
      onRun: async () => {
        const r = await cx.approval({ title: "Raise Engineering's budget", from: 'Harbourline (the hat above Engineering)', to: 'Engineering', amount: newBudget, asset: 'USDC', signer: founder, hat: 'Harbourline', warnings: [`${fmt.usdc(eng.amount, 0)} → ${fmt.usdc(newBudget, 0)} a quarter from 1 January 2027`, 'Owen Grady joins on 4 January 2027'], cmd: `capxul org department budget set engineering --budget ${newBudget}/quarter --from 2027-01-01 ${ORG}` });
        if (r.status !== 'done') return;
        const dept = D.departments.find((d) => d.id === 'engineering');
        (dept.changes ||= []).push({ when: cx.today, kind: 'Set amount', terms: `${fmt.num(eng.amount, 2)} → ${fmt.num(newBudget, 2)} USDC a quarter from Q1 2027`, signedBy: founder, signedAs: 'Harbourline (office above)', state: 'Scheduled', from: eng.amount, to: newBudget, note: 'Owen Grady joins 4 Jan' });
        N().addEvent?.(`${cx.name(founder)} raised Engineering's budget to ${fmt.usdc(newBudget, 0)} a quarter from Q1 2027`, { type: 'department', id: 'engineering' }, 'Departments');
        const ask = N().boardAsk || (() => null);
        const p2 = await ask({ title: 'Grant 40,000 options to Owen Grady', calls: [`Options.grant(${owen.email}, 40000, strike 0.25, 4y/1y from 2027-01-04)`], note: 'Senior Software Engineer, joins 4 January 2027', cmd: `capxul org options grant --to ${owen.email} --shares 40000 --strike 0.25 --agreement option-agreement.pdf --vest 4y --cliff 1y --start 2027-01-04 ${ORG}` });
        cx.toast(p2 ? `Engineering's budget is set for Q1, and ${p2.id} waits for Tom or Ruth.` : "Engineering's budget is set for Q1. The options proposal was not sent.", { tone: 'success' });
        cx.refresh();
      } };
    const peopleDraft = { for: people, by: FDE_HANDLE, at: stamp(), title: 'Add Owen Grady as an employee from 4 January 2027',
      why: `From his signed offer. An employee needs no seat; ${inv?.status === 'Pending' ? `his seat invitation from ${fmt.day(inv.sentAt)} is still open until ${fmt.day(inv.expires)}.` : 'offer one with org member invite.'}`,
      steps: ['Add the employee record (Engineering, reports to Tom Ashworth, paid to his Safe once he claims his account)', `Assign the UK Monthly 2026/27 salary structure from 4 January, base ${fmt.gbp(monthly, 0)} a month`, 'Assign the Studio Day shift'],
      cmd: [`capxul org hr employee add ${owen.email} --first-name Owen --last-name Grady --joined 2027-01-04 --department engineering --designation "Senior Software Engineer" --type full-time`, `capxul org payroll structure assign "UK Monthly 2026/27" --employee owen.grady --from 2027-01-04 --base ${monthly}`, 'capxul org hr shift-type assign "Studio Day" --employee owen.grady --from 2027-01-04'],
      runLabel: 'Open the employee form', onRun: () => cx.go('employee-new', null, { fill: 'owen' }) };
    const mineFirst = me.id === people ? [peopleDraft, founderDraft] : [founderDraft, peopleDraft];
    const canPeople = me.id === people, isFounder = me.id === founder;
    return {
      text: `${isFounder || canPeople ? '' : `I can't run any of this as you: it needs the People hat or the Harbourline hat, and you wear ${hatsLine(me)}. `}Owen Grady joins Engineering on 4 January 2027. Five steps in all. Three are People's (${peopleWearers().map(cx.firstName).join(', ')}): the employee record, his salary structure and his shift; I've drafted them for ${cx.name(people)}${canPeople ? ', that is you' : ''}. Two are the founder's: Engineering's budget for Q1, and his options, which need the Board. I've drafted those for ${cx.name(founder)}${isFounder ? ', that is you' : ''}. His seat invitation went out on ${fmt.day(inv?.sentAt)}; he pays nothing for it and gets his own Safe when he accepts.`,
      lookedAt: looked, drafts: mineFirst,
      links: [{ label: 'Engineering', route: 'department', id: 'engineering' }, { label: 'Seats', route: 'seats' }, { label: 'Options', route: 'options' }],
    };
  } },
  // book leave for yourself
  { test: (q) => /(book|take|apply for|request).*(off|leave|holiday)|(off|leave|holiday).*\d{1,2}(st|nd|rd|th)?\s*(to|-|–)\s*\d/.test(q) && !/balance|how much|left/.test(q), run: (q, me) => {
    if (me.kind !== 'employee') return { text: `I can only book leave for an employee, and ${me.name} is not one of Harbourline's employees.`, lookedAt: [{ command: `capxul org me ${ORG}`, result: `${me.name}: not an employee` }] };
    const range = dayRange(q) || { from: '2026-12-21', to: '2026-12-24' };
    const type = /sick/.test(q) ? 'Sick Leave' : 'Annual Leave';
    const days = workingDays(range.from, range.to);
    const bal = leaveLeft(me.id, type);
    const hols = []; for (let d = range.from; d <= range.to; d = addDays(d, 1)) { const x = holidayOn(d); if (x && !x.weeklyOff) hols.push(`${x.description} (${fmt.day(d)})`); }
    const deciders = cx.holders(me.department).filter((x) => !String(x).startsWith('@') && x !== me.id);
    const cmd = `capxul hr leave apply --type "${type}" --start ${range.from} --end ${range.to}`;
    const enough = !bal || bal.left >= days.length;
    return { text: `${fmt.date(range.from)} to ${fmt.date(range.to)} is ${fmt.plural(days.length, 'working day')}${hols.length ? `, not counting ${hols.join(' and ')}` : ''}. ${bal ? `You have ${fmt.num(bal.left, 1)} days of ${type} left until ${fmt.date(bal.to)}${enough ? '' : ', which is not enough'}.` : ''} ${enough ? `I've drafted the application for you to send. ${deciders.length ? cx.name(deciders[0]) : 'Your department\'s hat'} (who wears ${cx.deptName(me.department)}) or People decides it.` : 'Ask People about unpaid leave for the rest.'}`.replace(/\s+/g, ' '),
      lookedAt: [{ command: 'capxul hr leave balance', result: bal ? `${type}: ${fmt.num(bal.left, 1)} of ${fmt.num(bal.allocated, 1)} left` : 'no allocation' }, { command: `capxul org hr holiday list --year ${range.from.slice(0, 4)}`, result: hols.length ? hols.join('; ') : 'no bank holidays in those days' }],
      draft: enough ? { for: me.id, by: FDE_HANDLE, at: stamp(), title: `${type}, ${fmt.date(range.from)} to ${fmt.date(range.to)}`, why: `${fmt.plural(days.length, 'day')} from your ${fmt.num(bal?.left ?? 0, 1)} left.`, cmd, runLabel: 'Open the application', onRun: () => cx.go('leave-new', null, { leave: { leaveType: type, fromDate: range.from, toDate: range.to } }) } : null,
      links: [{ label: 'My leave', route: 'me-leave' }, cx.hasSeat() ? { label: 'Leave calendar', route: 'leave-calendar' } : null].filter(Boolean) };
  } },
  // run the month's payroll
  { test: (q) => /(run|do|start|create|process|pay).*payroll|payroll run|month.?end pay|pay (everyone|the team|salaries)/.test(q), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const runs = D.payroll.runs.filter((r) => r.status !== 'Cancelled');
    const want = Object.keys(MONTH_IX).find((m) => m.length > 3 && q.includes(m));
    const last = runs.at(-1);
    const named = want ? runs.find((r) => +r.startDate.slice(5, 7) - 1 === MONTH_IX[want] && r.startDate.slice(0, 4) === (MONTH_IX[want] > 10 ? '2025' : '2026')) || runs.find((r) => +r.startDate.slice(5, 7) - 1 === MONTH_IX[want]) : null;
    const founder = harbourlineHolder();
    const people = firstPeople(me);
    if (named && named.status === 'Paid') {
      const { slips, net } = runPay(named);
      const waiting = M.escrows.filter((e) => e.from === 'harbourline' && e.fundedAt.slice(0, 10) === named.postingDate);
      return { text: `${fmt.month(named.startDate)}'s payroll is done: ${named.name}, ${fmt.plural(slips.length, 'payslip')}, ${fmt.gbp(net)} net, paid on ${fmt.date(named.postingDate)} in one approval by ${cx.name(founder)}. Each payslip's payment carries its own document hash.${waiting.length ? ` ${waiting.map((e) => `${e.email}'s ${fmt.usdc(e.amount)} went to money waiting${e.claimedAt ? ` and was claimed on ${fmt.date(e.claimedAt)}` : ''}`).join('; ')}.` : ''} The next one is ${fmt.month(addDays(named.endDate, 1))}'s, paid on Monday 30 November.`,
        lookedAt: [{ command: `capxul org payroll run get ${named.name} ${ORG}`, result: `Paid ${fmt.date(named.postingDate)} · ${slips.length} payslips · ${fmt.gbp(net)} net` }],
        links: [{ label: `Open ${named.name}`, route: 'payroll-run', id: named.name }, { label: 'Payroll runs', route: 'payroll-runs' }] };
    }
    const open = runs.find((r) => ['Draft', 'Submitted'].includes(r.status));
    const start = addDays(last.endDate, 1);
    const drafts = [];
    if (!open || open.status === 'Draft') drafts.push({ for: people, by: FDE_HANDLE, at: stamp(), title: `Create and submit ${fmt.month(start)}'s payroll`, why: `${D.people.filter((p) => p.status === 'Active').length} active employees. People creates the run and checks the payslips; submitting locks them for payment.`, steps: ['Create the run for the month', 'Check the payslips (withhold any that are not ready)', 'Submit the payslips'], cmd: [`capxul org payroll run create harbourline --start ${start} --end ${addDays(addDays(start, 32).slice(0, 8) + '01', -1)}`, `capxul org payroll run submit <run>`], runLabel: 'Open the new run', onRun: () => cx.go(open ? 'payroll-run' : 'payroll-run-new', open?.name) });
    drafts.push({ for: founder, by: FDE_HANDLE, at: stamp(), title: `Pay ${open?.status === 'Submitted' ? open.name : `${fmt.month(start)}'s payslips`} in one approval`, why: `Paid from Harbourline's budget, so whoever wears the Harbourline hat approves: one passkey for every payslip, each payment with its own proof. Someone with no account gets theirs as money waiting.`, cmd: `capxul org payroll run pay ${open?.status === 'Submitted' ? open.name : '<run>'} ${ORG}`, runLabel: open?.status === 'Submitted' ? 'Open the run to pay' : 'Open Payroll', onRun: () => cx.go(open?.status === 'Submitted' ? 'payroll-run' : 'payroll-runs', open?.status === 'Submitted' ? open.name : null) });
    const mine = drafts.filter((d) => d.for === me.id);
    return { text: `${mine.length ? '' : `I can't run payroll as you: People creates and submits the run, and the Harbourline hat pays it; you wear ${hatsLine(me)}. `}${fmt.month(start)}'s payroll is ${open ? `${open.name}, ${open.status.toLowerCase()}` : 'not created yet'}. Last month's ${last.name} paid ${fmt.gbp(runPay(last).net)} net to ${runPay(last).slips.length} people on ${fmt.date(last.postingDate)}. I've drafted ${drafts.map((d) => `"${d.title}" for ${d.for === me.id ? 'you' : cx.name(d.for)}`).join(' and ')}.`,
      lookedAt: [{ command: `capxul org payroll run list ${ORG}`, result: `${runs.length} runs; last ${last.name} ${last.status}` }, { command: `capxul org department show harbourline ${ORG}`, result: `pays payroll; hat: ${cx.holders('harbourline').map(cx.name).join(', ')}` }],
      drafts: [...mine, ...drafts.filter((d) => d.for !== me.id)],
      links: [{ label: 'Payroll', route: 'payroll' }] };
  } },
  // whose pay waits to be claimed
  { test: (q) => /(claimed|claim) (their|my|his|her)? ?pay|unclaimed|hasn.t claimed|not claimed|who.*claim/.test(q), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const pay = M.escrows.filter((e) => e.from === 'harbourline');
    const open = M.escrows.filter((e) => e.status === 'Open');
    const lastRun = D.payroll.runs.filter((r) => r.status === 'Paid').at(-1);
    const fromRun = pay.filter((e) => e.fundedAt.slice(0, 10) === lastRun.postingDate);
    return { text: `${fromRun.length ? `From ${lastRun.name} (paid ${fmt.date(lastRun.postingDate)}), ${fromRun.map((e) => `${e.email}'s ${fmt.usdc(e.amount)} went to money waiting${e.status === 'Claimed' ? ` and was claimed on ${fmt.datetime(e.claimedAt)}` : ', not claimed yet'}`).join('; ')}. Everyone else was paid straight to their Safe or bank.` : `Everyone in ${lastRun.name} was paid straight to their Safe or bank.`} ${open.length ? `Not pay, but still waiting: ${open.map((e) => `${fmt.usdc(e.amount)} for ${e.email} from ${cx.deptName(e.from)}`).join('; ')}.` : ''}`,
      lookedAt: [{ command: `capxul org payroll run get ${lastRun.name} ${ORG}`, result: `${fromRun.length} payslip${fromRun.length === 1 ? '' : 's'} sent to money waiting` }, { command: `capxul payment list ${ORG} --status escrowed`, result: open.map((e) => e.email).join(', ') || 'none open' }],
      links: [{ label: 'Money waiting', route: 'money-waiting' }, { label: `Open ${lastRun.name}`, route: 'payroll-run', id: lastRun.name }] };
  } },
  // approve someone's expense claim
  { test: (q) => /claim/.test(q) && /approve|bristol|expense|receipt/.test(q), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const open = D.hr.expenseClaims.filter((c) => ['Open', 'Approved'].includes(c.status) && c.status !== 'Paid');
    const who = nameIn(q);
    const c = open.find((x) => who && x.employee === who.id) || open.find((x) => q.includes(x.name.toLowerCase())) || open[0];
    if (!c) return { text: 'No expense claim is waiting for a decision.', lookedAt: [{ command: 'capxul org hr expense-claim list --status open', result: 'none' }], links: [{ label: 'Expense claims', route: 'expense-claims' }] };
    const may = cx.holds(c.department);
    const decider = may ? me.id : cx.holders(c.department).find((x) => !String(x).startsWith('@'));
    const lines = c.expenses.map((e) => `${e.description} ${fmt.gbp(e.sanctionedAmount ?? e.amount)}`).join('; ');
    return { text: `${who && who.id !== c.employee ? `${who.name} has no claim waiting; the open one is ${cx.name(c.employee)}'s. ` : ''}${c.name} from ${cx.name(c.employee)} is ${fmt.gbp(c.grandTotal)}: ${lines}. Every line has its receipt. ${may ? `You wear the ${cx.deptName(c.department)} hat or one above it, so the decision and the payment are yours.` : `I can't approve it as you: it is decided on ${cx.deptName(c.department)}'s budget, and you wear ${hatsLine(me)}. I've drafted it for ${cx.name(decider)}.`}`,
      lookedAt: [{ command: `capxul org hr expense-claim get ${c.name}`, result: `${c.status} · ${fmt.gbp(c.grandTotal)} · ${c.expenses.length} lines` }],
      draft: { for: decider, by: FDE_HANDLE, at: stamp(), title: `Approve and pay ${c.name}`, why: `${cx.name(c.employee)} · ${fmt.gbp(c.grandTotal)} from ${cx.deptName(c.department)}'s budget`, cmd: [`capxul org hr expense-claim approve ${c.name}`, `capxul org hr expense-claim pay ${c.name} ${ORG}`], runLabel: 'Open the claim', onRun: () => cx.go('expense-claim', c.name) },
      links: [{ label: `Open ${c.name}`, route: 'expense-claim', id: c.name }] };
  } },
  // a call to log on a lead or deal
  { test: (q) => /(called|call with|just spoke|phoned|rang)\b/.test(q) || /log (a|the|my) call/.test(q), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const C = D.crm;
    const cur = cx.current;
    const onRec = ['lead', 'deal'].includes(cur?.name) ? (cur.name === 'lead' ? cx.find(C.leads, 'name', cur.id) : cx.find(C.deals, 'name', cur.id)) : null;
    const lead = onRec || C.leads.find((l) => !l.converted && (q.includes(String(l.org || '').toLowerCase().split(' ')[0]) || q.includes(String(l.firstName || '').toLowerCase()))) || C.leads.filter((l) => !l.converted && l.status !== 'Junk').at(-1);
    const kind = onRec && cur.name === 'deal' ? 'deal' : 'lead';
    const title = kind === 'lead' ? `${lead.firstName} ${lead.lastName}${lead.org ? ' at ' + lead.org : ''}` : lead.title;
    const minutes = +(q.match(/(\d+)\s*(min|minute)/)?.[1] || 20);
    const note = /proposal/.test(q) ? 'Wants a proposal' : 'Call logged from the FDE';
    const moveTo = kind === 'lead' && lead.status === 'New' ? 'Contacted' : null;
    const runner = isPeople(me) ? me.id : firstPeople(me);
    const cmd = [`capxul org crm call log ${lead.name} --type outgoing --status completed --start ${cx.today}T${fmt.time(cx.now.toISOString())} --duration ${minutes * 60} --note "${note}"`, moveTo ? `capxul org crm ${kind} move ${lead.name} ${moveTo}` : null].filter(Boolean);
    return { text: `${isPeople(me) ? '' : `I can't write to the CRM as you: changes need the People hat (${peopleWearers().map(cx.name).join(', ')}), and you wear ${hatsLine(me)}. `}${lead.name} is ${title}, ${lead.status}. I've drafted the call log (outgoing, ${minutes} minutes: "${note}")${moveTo ? ` and the move to ${moveTo}` : ''} for ${runner === me.id ? 'you' : cx.name(runner)} to run.`,
      lookedAt: [{ command: `capxul org crm ${kind} get ${lead.name}`, result: `${lead.status}${lead.owner ? ' · owner ' + cx.name(lead.owner) : ''}` }],
      draft: { for: runner, by: FDE_HANDLE, at: stamp(), title: `Log the call on ${lead.name}${moveTo ? ' and move it to ' + moveTo : ''}`, why: title, cmd, runLabel: 'Run',
        onRun: async () => { const c = N().crmLogCall?.(kind, lead, { minutes, note, other: title }); if (!c) return; if (moveTo) await N().crmMove?.(kind, lead, moveTo); cx.toast(`Logged ${c.name} on ${lead.name}`, { tone: 'success', cmd: cmd[0] }); cx.go(kind, lead.name); } },
      links: [{ label: `Open ${lead.name}`, route: kind, id: lead.name }] };
  } },
  // a change to a CRM record, asked from its read-only banner
  { test: (q) => /i want to change|draft the command for/.test(q), run: (q, me) => {
    const cur = cx.current;
    const kind = ['lead', 'deal', 'contact', 'company'].includes(cur?.name) ? cur.name : 'lead';
    const forP = D.people.find((p) => q.includes(p.name.toLowerCase())) || cx.person(firstPeople(me));
    const id = cur?.id || '<record>';
    return { text: `${cx.name(forP.id)} wears the People hat, so the change is theirs to run. Tell me which field and the new value and I'll fill it in; meanwhile here is the command with its blanks. ${forP.id === me.id ? '' : `Only ${cx.firstName(forP.id)} can press Run.`}`,
      lookedAt: [{ command: `capxul org crm ${kind} get ${id}`, result: 'read' }, { command: `capxul org me ${ORG}`, result: `${me.name}: ${hatsLine(me)}` }],
      draft: { for: forP.id, by: FDE_HANDLE, at: stamp(), title: `Change ${kind} ${id}`, cmd: `capxul org crm ${kind} change ${id} --<field> "<new value>"`, runLabel: 'Open it', onRun: () => cx.go(kind, cur?.id) } };
  } },
  // what will close this month
  { test: (q) => /(close|closing) this month|what will close|forecast|pipeline/.test(q), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const open = D.crm.deals.filter((d) => !['Won', 'Lost'].includes(d.status));
    const month = cx.today.slice(0, 7), next = addDays(month + '-28', 7).slice(0, 7);
    const gbpOf = (d) => (d.currency === 'USD' ? d.dealValue * RATE : d.dealValue);
    const line = (d) => `${d.title}, ${fmt.money(d.dealValue, d.currency, 0)} at ${d.probability}%, closing ${fmt.day(d.expectedClosureDate)}`;
    const now = open.filter((d) => String(d.expectedClosureDate).startsWith(month));
    const later = open.filter((d) => String(d.expectedClosureDate).startsWith(next));
    const w = (l) => r2(l.reduce((s, d) => s + gbpOf(d) * d.probability / 100, 0));
    return { text: `${now.length ? `This month: ${now.map(line).join('; ')}, weighted ${fmt.gbp(w(now), 0)}.` : 'Nothing is set to close this month.'} ${later.length ? `Next month: ${later.map(line).join('; ')}, weighted ${fmt.gbp(w(later), 0)}.` : ''} The whole open pipeline is ${fmt.plural(open.length, 'deal')}, weighted ${fmt.gbp(w(open), 0)}.`,
      lookedAt: [{ command: 'capxul org crm deal list --stage ongoing', result: `${open.length} open deals` }], links: [{ label: 'Deals', route: 'deals' }, { label: 'Pipeline', route: 'pipeline' }] };
  } },
  // bill a customer's time
  { test: (q) => /\bbill\b|invoice .*hours|unbilled/.test(q), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const P = D.projects;
    const logs = cx.rows('projects.logs');
    const proj = P.projects.find((p) => q.includes(p.projectName.toLowerCase().split(' ')[0]) || (p.customer && q.includes(p.customer))) || P.projects.find((p) => p.name === 'PROJ-0011');
    const want = Object.keys(MONTH_IX).find((m) => m.length > 3 && q.includes(m));
    const tsDone = new Map(P.timesheets.map((t) => [t.name, t]));
    const unbilled = logs.filter((l) => l.project === proj.name && l.billable && !l.invoice && ['Submitted'].includes(tsDone.get(l.timesheet)?.status));
    const inMonth = want ? unbilled.filter((l) => +l.date.slice(5, 7) - 1 === MONTH_IX[want]) : unbilled;
    const use = inMonth.length ? inMonth : unbilled;
    const ts = [...new Set(use.map((l) => l.timesheet))];
    const hours = r2(use.reduce((s, l) => s + l.hours, 0)), net = r2(use.reduce((s, l) => s + l.billingAmount, 0));
    const billed = want && !inMonth.length ? logs.filter((l) => l.project === proj.name && l.invoice && +l.date.slice(5, 7) - 1 === MONTH_IX[want]) : [];
    const invs = [...new Set(billed.map((l) => l.invoice))];
    const runner = cx.wears('Invoicing') ? me.id : D.people.find((p) => (p.hats || []).includes('Invoicing'))?.id || 'maya';
    const cust = D.crm.companies.find((c) => c.id === proj.customer)?.name || proj.customer;
    const head = invs.length ? `${cust}'s ${want[0].toUpperCase() + want.slice(1)} time is billed already, on ${invs.join(', ')}. ` : '';
    if (!use.length) return { text: `${head}Nothing billable is waiting on ${proj.name} · ${proj.projectName}.`, lookedAt: [{ command: `capxul org doc list timesheet --filter project=${proj.name} --filter status=Submitted`, result: 'nothing unbilled' }], links: [{ label: `Open ${proj.name}`, route: 'project', id: proj.name }] };
    return { text: `${head}${proj.name} · ${proj.projectName} has ${fmt.hours(hours)} of submitted, unbilled time on ${fmt.plural(ts.length, 'timesheet')}: ${fmt.money(net, proj.currency || 'GBP')} before VAT. ${runner === me.id ? 'You wear Invoicing, so you can bill it:' : `Billing needs the Invoicing hat; I've drafted it for ${cx.name(runner)}:`} one invoice, a line per activity and rate, to ${cust}'s accounts mailbox. It is posted as it is made.`,
      lookedAt: [{ command: `capxul org doc list timesheet --filter project=${proj.name} --filter status=Submitted`, result: `${ts.length} timesheets · ${fmt.hours(hours)} unbilled` }],
      draft: { for: runner, by: FDE_HANDLE, at: stamp(), title: `Bill ${cust}: ${fmt.hours(hours)} on ${proj.name}`, why: `${fmt.money(net, proj.currency || 'GBP')} net`, cmd: `capxul org projects timesheet bill ${ts.slice(0, 4).join(' ')}${ts.length > 4 ? ' …' : ''} --to <accounts mailbox>`, runLabel: 'Review the invoice', onRun: () => (N().billTimesheets ? N().billTimesheets(ts, proj.name) : cx.go('project', proj.name)) },
      links: [{ label: `Open ${proj.name}`, route: 'project', id: proj.name }, { label: 'Project billing summary', route: 'timesheet-billing' }] };
  } },
  // is a project on track
  { test: (q) => /on track|behind|late|how is .* going|status of/.test(q) && (/project|larkspur|meridian|saltmarsh|aldermoor|studio|beta|launch/.test(q)), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const P = D.projects;
    const proj = P.projects.find((p) => q.includes(p.projectName.toLowerCase().split(' ')[0]) || (p.customer && q.includes(p.customer))) || P.projects.find((p) => p.name === 'PROJ-0011');
    const tasks = P.tasks.filter((t) => t.project === proj.name && !t.isGroup);
    const done = new Set(tasks.filter((t) => t.status === 'Completed').map((t) => t.name));
    const overdue = tasks.filter((t) => t.status === 'Overdue');
    const blocked = tasks.filter((t) => !['Completed', 'Cancelled'].includes(t.status) && (t.dependsOn || []).some((d) => !done.has(d)));
    const unassigned = tasks.filter((t) => !['Completed', 'Cancelled'].includes(t.status) && !(t.assignees || []).length);
    const expected = tasks.reduce((s, t) => s + (t.expectedTime || 0), 0);
    const used = proj.actualTime || 0;
    const subj = (n) => P.tasks.find((t) => t.name === n)?.subject || n;
    return { text: `${proj.name} · ${proj.projectName} is ${Math.round(proj.percentComplete)}% complete, due ${fmt.date(proj.expectedEnd)}. ${overdue.length ? `Overdue: ${overdue.map((t) => `${t.subject} (${cx.name((t.assignees || [])[0])})`).join(', ')}.` : 'Nothing is overdue.'} ${blocked.length ? `Waiting on others: ${blocked.map((t) => `${t.subject} waits for ${(t.dependsOn || []).filter((d) => !done.has(d)).map(subj).join(' and ')}`).join('; ')}.` : ''} ${unassigned.length ? `Nobody is on ${unassigned.map((t) => t.subject).join(', ')}.` : ''} ${expected ? `${fmt.hours(used)} logged against ${fmt.hours(expected)} expected (${Math.round((used / expected) * 100)}%).` : `${fmt.hours(used)} logged so far.`}`.replace(/\s+/g, ' '),
      lookedAt: [{ command: `capxul org projects task list --project ${proj.name}`, result: `${tasks.length} tasks, ${done.size} completed, ${overdue.length} overdue` }, { command: `capxul org projects project get ${proj.name}`, result: `${Math.round(proj.percentComplete)}% · ${fmt.hours(used)} logged` }],
      links: [{ label: `Open ${proj.name}`, route: 'project', id: proj.name }, { label: 'Gantt', route: 'tasks-gantt', id: proj.name }] };
  } },
  // log my week
  { test: (q) => /log (my|the) (week|time|hours)|log .* (monday|tuesday|wednesday|thursday|friday)/.test(q), run: (q, me) => {
    if (me.kind !== 'employee') return { text: 'Only an employee logs time.', lookedAt: [] };
    const P = D.projects;
    const proj = P.projects.find((p) => p.status === 'Open' && (q.includes(p.projectName.toLowerCase().split(' ')[0]) || (p.customer && q.includes(p.customer)))) || P.projects.find((p) => p.name === 'PROJ-0011');
    const tasks = P.tasks.filter((t) => t.project === proj.name && !t.isGroup);
    const taskFor = (word) => tasks.find((t) => t.subject.toLowerCase().includes(word)) || null;
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    const monday = (() => { const d = new Date(cx.today + 'T00:00:00Z'); const wd = (d.getUTCDay() + 6) % 7; return addDays(cx.today, -wd); })();
    const parts = q.split(/,|;| and (?=[a-z]+ (?:on|monday|tuesday|wednesday|thursday|friday))/).map((x) => x.trim()).filter(Boolean);
    const entries = [];
    for (const part of parts) {
      const range = part.match(/(monday|tuesday|wednesday|thursday|friday)\s*(?:to|-|–)\s*(monday|tuesday|wednesday|thursday|friday)/);
      const single = part.match(/\b(monday|tuesday|wednesday|thursday|friday)\b/);
      if (!range && !single) continue;
      const a = days.indexOf(range ? range[1] : single[1]), b = range ? days.indexOf(range[2]) : a;
      const word = (part.match(/(square|ios|android|checkout|loyalty|history|beta|design|review)/) || [])[1];
      const t = word ? taskFor(word) : null;
      for (let i = a; i <= b; i++) entries.push({ date: addDays(monday, i), hours: 6.5, activity: /design/.test(part) ? 'Design' : 'Engineering', task: t?.name || null, note: t ? t.subject : part.slice(0, 60) });
    }
    if (!entries.length) for (let i = 0; i < 5; i++) entries.push({ date: addDays(monday, i), hours: 6.5, activity: 'Engineering', task: null, note: proj.projectName });
    const ts0 = P.timesheets.find((t) => t.employee === me.id && t.status === 'Draft' && t.startDate >= monday);
    const ahead = entries.filter((e) => e.date > cx.today).length;
    const cmd = [ts0 ? null : `capxul org projects timesheet create --project ${proj.name}`, ...entries.slice(0, 3).map((e) => `capxul org projects timesheet log ${ts0?.name || '<timesheet>'} --activity ${e.activity} --start ${e.date}T09:00 --hours ${e.hours}${e.task ? ' --task ' + e.task : ''} --billable`), entries.length > 3 ? `# and ${entries.length - 3} more logs` : null, `capxul org projects timesheet submit ${ts0?.name || '<timesheet>'}`].filter(Boolean);
    return { text: `${fmt.plural(entries.length, 'day')} on ${proj.name} · ${proj.projectName}, ${fmt.hours(entries.length * 6.5)} in all: ${entries.map((e) => `${fmt.weekday(e.date)} ${e.note}`).join(', ')}. It is your own time, so you can log it yourself${ts0 ? ` into your draft ${ts0.name}` : ' in a new timesheet'}. ${ahead ? `${ahead === 1 ? 'One day is' : `${ahead} days are`} still ahead of today, so check the hours before you submit on Friday.` : 'Check it, then submit it.'}`,
      lookedAt: [{ command: `capxul org doc list timesheet --filter employee=${me.employee} --filter status=Draft`, result: ts0 ? `${ts0.name}, ${fmt.hours(ts0.totalHours || 0)}` : 'no draft this week' }, { command: `capxul org projects task list --project ${proj.name} --assignee ${me.employee}`, result: tasks.filter((t) => (t.assignees || []).includes(me.id)).map((t) => t.subject).join(', ') || 'none' }],
      draft: { for: me.id, by: FDE_HANDLE, at: stamp(), title: `Log ${fmt.hours(entries.length * 6.5)} on ${proj.name}`, cmd, runLabel: 'Log it', onRun: () => { const ts = N().logWeekFor?.(me.id, proj.name, entries); if (ts) { cx.toast(`Logged ${fmt.plural(entries.length, 'day')} on ${ts.name}. Submit it when the week is done.`, { tone: 'success', cmd: `capxul org projects timesheet submit ${ts.name}` }); cx.go('timesheet', ts.name); } } },
      links: [{ label: 'Timesheets', route: 'timesheets' }] };
  } },
  // what waits for me
  { test: (q) => /waiting for me|what.*(should i do|do first)|my approvals|waits for me/.test(q), run: (q, me) => {
    const mine = D.approvals.waiting.filter((a) => (a.waitsFor || []).includes(me.id));
    if (!mine.length) return { text: 'Nothing waits for you.', lookedAt: [{ command: `capxul org approval list ${ORG} --for me`, result: 'none' }] };
    const order = [...mine].sort((a, b) => (a.kind === 'Money' ? -1 : 0) - (b.kind === 'Money' ? -1 : 0) || String(a.openedAt).localeCompare(String(b.openedAt)));
    return { text: `${fmt.plural(mine.length, 'thing')} ${mine.length === 1 ? 'waits' : 'wait'} for you. Start with ${order[0].what}${order[0].amount ? ` (${order[0].amount})` : ''}, from ${cx.name(order[0].openedBy)} ${fmt.agoLong(order[0].openedAt)}: ${order[0].because}. Then: ${order.slice(1, 4).map((a) => a.what).join('; ') || 'nothing else'}.`,
      lookedAt: [{ command: `capxul org approval list ${ORG} --for me`, result: `${mine.length} waiting` }], links: [{ label: 'Approvals', route: 'approvals' }, ...(order[0].ref ? [{ label: 'Open the first', route: cx.refRoute(order[0].ref)?.[0], id: cx.refRoute(order[0].ref)?.[1] }] : [])].filter((l) => l.route) };
  } },
  // what to know about an employee
  { test: (q) => /what should i know about|tell me about|who is/.test(q) && !!nameIn(q), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const p = nameIn(q);
    const leaves = D.hr.leaveApplications.filter((l) => l.employee === p.id && l.toDate >= cx.today && ['Open', 'Approved'].includes(l.status));
    const claims = D.hr.expenseClaims.filter((c) => c.employee === p.id && c.status === 'Open');
    const tasks = D.projects.tasks.filter((t) => (t.assignees || []).includes(p.id) && ['Open', 'Working', 'Overdue', 'Pending Review'].includes(t.status) && !t.isGroup);
    const bal = leaveLeft(p.id, 'Annual Leave');
    return { text: `${p.name} is a ${p.designation} in ${cx.deptName(p.department)}, since ${fmt.date(p.dateOfJoining)}${p.reportsTo ? `, reporting to ${cx.name(p.reportsTo)}` : ''}. ${p.hats?.length ? `Wears ${p.hats.join(', ')}.` : 'Wears no hat.'} ${cx.hasSeat(p.id) ? 'Has a seat.' : 'Has no seat.'} Paid to ${p.salaryMode === 'Bank' ? 'a bank account through Bridge' : 'their Safe'}. ${bal ? `${fmt.num(bal.left, 1)} days of annual leave left.` : ''} ${leaves.length ? `Leave coming up: ${leaves.map((l) => `${fmt.day(l.fromDate)} to ${fmt.day(l.toDate)} (${l.status})`).join(', ')}.` : ''} ${claims.length ? `${fmt.plural(claims.length, 'expense claim')} open.` : ''} ${tasks.length ? `Open tasks: ${tasks.slice(0, 4).map((t) => t.subject).join(', ')}.` : ''}`.replace(/\s+/g, ' '),
      lookedAt: [{ command: `capxul org hr employee get ${p.employee}`, result: `${p.status} · ${p.designation}` }, { command: `capxul org hr leave list --employee ${p.employee}`, result: `${leaves.length} coming up` }],
      links: [{ label: `Open ${p.name}`, route: 'employee', id: p.employee }] };
  } },
];

function noSeat(me) {
  return { text: `You have no seat at Harbourline, so I can only show your own records: your payslips, your leave and money waiting for you. Ask me about those.`, lookedAt: [{ command: `capxul org me ${ORG}`, result: `${me.name}: no seat` }] };
}
async function answer(question, { context, me } = {}) {
  await sleep(500);
  const q = String(question).toLowerCase();
  for (const it of [...moreIntents, ...intents]) {
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
      [].concat(t.draft || [], t.drafts || []).map((d) => cx.draft(d)),
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
