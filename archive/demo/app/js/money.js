// Money and departments: the Treasury and the Reserve Safe, payments with their proof, sending money, scheduled
// payments, money waiting (escrow) with claim and take back, the bank (Bridge deposits and payouts, bank details, saved
// accounts, verification), requests to pay, your own money; departments with their quarterly budgets and hats, the
// swap of a holder, allowances and payout ceilings. Everything reads cx.data (fictional sample data); actions change
// it in memory and redraw.
import { cx, h } from './core.js';

const D = cx.data;
const fmt = cx.fmt;
const M = D.money;
const T = M.safes.treasury;
const R = M.safes.reserve;
const MW = M.safes.moneyWaiting;
const ORG = '--org harbourline';
const RATE = cx.rate(cx.today);
const HL_PARTY = M.payments.find((p) => p.proof?.advice?.payer?.party)?.proof.advice.payer.party || '0x999470e2e354e0a2024b593ecef2e82aa5c3e96c';

const r2 = (n) => Math.round((+n + Number.EPSILON) * 100) / 100;
const r6 = (n) => Math.round((+n + Number.EPSILON) * 1e6) / 1e6;
const gbpOf = (usdc, rate = RATE) => r2(usdc * rate);
const addDays = (d, n) => new Date(Date.parse(d.slice(0, 10) + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b.slice(0, 10) + 'T00:00:00Z') - Date.parse(a.slice(0, 10) + 'T00:00:00Z')) / 864e5);
let tick = 0;
/** A time just after "now" for each new record, so new rows sort above the data's. */
const stamp = () => new Date(cx.now.getTime() + ++tick * 41000).toISOString();
const ceiling = () => D.payoutCeilings.find((c) => c.year === Number(cx.today.slice(0, 4))) || D.payoutCeilings.at(-1);
const deptRec = (id) => D.departments.find((d) => d.id === id) || D.allowances.find((a) => a.id === id) || null;
const isAllowance = (id) => D.allowances.some((a) => a.id === id);
const monthNow = cx.today.slice(0, 7);
const allowanceMonth = (a, m = monthNow) => a.months.find((x) => x.month === m) || null;
const q = (s) => (/\s/.test(s) ? `"${s}"` : s);
/** The form view, with long record IDs allowed to wrap in its side column. */
/** Tabs whose root may shrink inside the page grid (so a wide tab bar scrolls instead of widening the page). */
const tabsV = (t, o) => { const el = cx.tabs(t, o); el.style.minWidth = '0'; return el; };
const formV = (o) => { const f = cx.formView(o); f.classList.add('mx-formv'); return f; };

/* =====================================================================================================
   Styles (tokens only)
   ===================================================================================================== */

cx.style('money', `
.mx-formv .form-side .card-body > * { min-width: 0; }
.mx-formv .form-side .hash { white-space: normal; flex-wrap: wrap; max-width: 100%; }
.mx-formv .form-side .hash > span { overflow-wrap: anywhere; min-width: 0; }
.mx-steps { display: flex; flex-wrap: wrap; list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); overflow: hidden; }
.mx-steps li { flex: 1 1 150px; min-width: 0; padding: 10px 12px 9px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); margin-bottom: -1px; display: grid; gap: 1px; font-size: 12px; color: var(--muted); position: relative; }
.mx-steps li:last-child { border-right: 0; }
.mx-steps li b { font-size: 13px; font-weight: 600; color: var(--faint); }
.mx-steps li.done b, .mx-steps li.now b { color: var(--fg); }
.mx-steps li::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 3px; background: var(--line); }
.mx-steps li.done::before { background: var(--accent); }
.mx-steps li.now::before { background: var(--t-orange); }
.mx-steps li.esc::before { background: var(--t-escrow); }
.mx-steps li.bad::before { background: var(--neg); }
.mx-steps li span { overflow-wrap: anywhere; }
.mx-total { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; }
.mx-total .big { font: 650 30px/1.1 var(--font-ui); font-stretch: var(--wide); letter-spacing: -.01em; }
.mx-acc { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
.mx-acc > a, .mx-acc > div { min-width: 0; display: grid; gap: 4px; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); color: inherit; text-decoration: none; }
.mx-acc > a:hover { border-color: var(--accent); }
.mx-acc .k { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); }
.mx-acc .k .ic { color: var(--accent); }
.mx-acc .v { font: 600 19px/1.2 var(--font-ui); overflow-wrap: anywhere; }
.mx-acc .v small { font-size: 12px; font-weight: 500; color: var(--muted); margin-left: 4px; }
.mx-acc .s { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
.mx-safe { white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; padding: 0 7px; height: 20px; border-radius: 4px; border: 1px solid var(--line-2); font-size: 11.5px; font-weight: 600; color: var(--fg-2); background: var(--surface-2); }
.mx-cal { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(30px, 1fr); gap: 2px; overflow-x: auto; padding-bottom: 4px; }
.mx-cal > div { display: grid; justify-items: center; gap: 2px; padding: 4px 0; border-radius: 4px; font-size: 11px; color: var(--muted); min-width: 30px; }
.mx-cal > div.wk { color: var(--faint); }
.mx-cal > div.has { background: var(--accent-soft); color: var(--fg); font-weight: 600; cursor: pointer; }
.mx-cal > div.today { outline: 1px solid var(--accent); }
.mx-cal i { width: 6px; height: 6px; border-radius: 50%; background: transparent; }
.mx-cal .has i { background: var(--accent); }
.mx-cal small { font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; }
.mx-esc { display: grid; gap: 12px; }
.mx-esc .card-head .pill { margin-left: 4px; }
.mx-quote { border: 1px solid var(--line-2); border-radius: var(--r); background: var(--surface-2); padding: 12px 14px; display: grid; gap: 8px; }
.mx-quote .row { display: flex; justify-content: space-between; gap: 12px; font-size: 13.5px; }
.mx-quote .row b { font-weight: 600; }
.mx-quote .row.main b { font-size: 16px; }
.mx-qr { width: 156px; height: 156px; padding: 8px; background: #fff; border-radius: 6px; border: 1px solid var(--line); }
.mx-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--sunk); min-width: 90px; }
.mx-bar i { display: block; height: 100%; }
.mx-bar i.sp { background: var(--chart-1); }
.mx-bar i.sp.hot { background: var(--t-orange); }
.mx-bar i.hd { background: var(--chart-2); }
.mx-bar i.cm { background: repeating-linear-gradient(135deg, var(--chart-3) 0 3px, transparent 3px 6px); }
.mx-tree td.dname { white-space: nowrap; }
.mx-tree td .person > span:last-child { white-space: nowrap; }
.mx-tree td.dname .pad { display: inline-block; }
.mx-tree td.dname a { font-weight: 600; }
.mx-tree tr.allow td.dname a { font-weight: 500; }
.mx-tree .kind { font-size: 11.5px; color: var(--muted); margin-left: 6px; }
.mx-holder { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.mx-holder:last-child { border-bottom: 0; }
.mx-holder .grow { flex: 1; min-width: 160px; display: grid; gap: 1px; }
.mx-holder .grow small { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.mx-stays { border-left: 3px solid var(--accent); padding: 10px 14px; background: var(--surface-2); border-radius: 0 var(--r) var(--r) 0; font-size: 13.5px; display: grid; gap: 6px; }
.mx-form { display: grid; gap: 14px; max-width: 760px; }
.mx-form .fields { --cols: 2; }
.mx-err { color: var(--neg); font-size: 12.5px; }
.mx-note { font-size: 12.5px; color: var(--muted); }
.mx-mail { border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); }
.mx-mail header { padding: 10px 14px; border-bottom: 1px solid var(--line); font-size: 12.5px; color: var(--muted); display: grid; gap: 2px; }
.mx-mail header b { color: var(--fg); font-size: 14px; }
.mx-mail .body { padding: 12px 14px; display: grid; gap: 10px; font-size: 13.5px; }
.mx-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.mx-two > * { min-width: 0; }
.mx-hop { display: grid; grid-template-columns: 28px 1fr; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.mx-hop:last-child { border-bottom: 0; }
.mx-hop .n { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 12px; background: var(--sunk); color: var(--fg-2); }
.mx-hop.done .n { background: var(--accent); color: var(--accent-fg); }
.mx-hop.now .n { background: var(--t-orange-bg); color: var(--t-orange); }
.mx-hop.bad .n { background: var(--t-red-bg); color: var(--t-red); }
.mx-hop > div { min-width: 0; display: grid; gap: 3px; }
.mx-hop small { color: var(--muted); overflow-wrap: anywhere; }
`);

/* =====================================================================================================
   Workspaces
   ===================================================================================================== */

cx.workspace({
  id: 'money', label: 'Money', icon: 'money', route: 'money',
  badge: () => M.payments.filter((p) => p.status === 'Prepared' && p.waitingFor?.who === cx.meId()).length || null,
  nav: [
    { label: 'Overview', route: 'money' },
    { label: 'Treasury', route: 'treasury' },
    { label: 'Reserve Safe', route: 'reserve' },
    { label: 'Payments', route: 'payments', match: ['payment', 'send-money'] },
    { label: 'Scheduled', route: 'scheduled-payments' },
    { label: 'Money waiting', route: 'money-waiting' },
    { label: 'Bank', route: 'bank', match: ['deposit', 'payout', 'pay-by-bank'] },
    { label: 'Requests to pay', route: 'requests-to-pay' },
  ],
});
cx.workspace({
  id: 'departments', label: 'Departments', icon: 'departments', route: 'departments',
  nav: [
    { label: 'Departments', route: 'departments', match: ['department'] },
    { label: 'Allowances', route: 'allowances', match: ['allowance'] },
    { label: 'Payout ceilings', route: 'payout-ceilings' },
  ],
});
cx.workspace({
  id: 'yours', label: 'You', icon: 'user', route: 'your-money', seatless: true,
  badge: () => (D.notices || []).filter((n) => n.to === cx.meId() && !n.read).length || null,
  nav: [{ label: 'Your money', route: 'your-money' }, { label: 'Your notices', route: 'notices' }],
});

/* =====================================================================================================
   Payments: words, tones, lookups
   ===================================================================================================== */

const TONE = { Prepared: 'gray', Scheduled: 'blue', Due: 'orange', 'Money waiting': 'escrow', Sent: 'blue', 'Needs retry': 'orange', Settled: 'green', Mismatched: 'red', Cancelled: 'muted' };
const statusText = (p) => p.status + (p.outcome ? ' · ' + p.outcome : '');
const toneOf = (p) => (p.outcome && /Returned/.test(p.outcome) ? 'orange' : TONE[p.status] || 'gray');
const payPill = (p, o) => cx.pill(statusText(p), toneOf(p), o);
const ROUTE_LABEL = { outside: 'Outside money', department: 'Department', allowance: 'Allowance', chain: 'Direct', board: 'Board', 'money-waiting': 'Money waiting', agreement: 'Pay agreement', personal: 'Personal' };
const PURPOSE = { supplier: 'Supplier', payroll: 'Payroll', claim: 'Expense claim', receipt: 'Customer receipt', advance: 'Advance', 'advance-return': 'Advance returned', investment: 'Investment', travel: 'Travel', agreement: 'Pay agreement', transfer: 'Transfer', unknown: 'Unknown' };
const fromLabel = (p) => (p.direction === 'in' ? '' : p.budget === 'board' ? 'Board' : p.budget ? cx.deptName(p.budget) : p.payer?.label || '');
const paidTo = (p) => (p.direction === 'in' ? (p.deposit ? 'Bank via Bridge' : 'Wallet') : p.payout ? 'Bank via Bridge' : p.route === 'money-waiting' ? 'Money waiting' : 'Wallet');
const signedAmt = (p) => (p.direction === 'out' ? -p.amount : p.amount);
const whenOf = (p) => (p.status === 'Prepared' ? p.createdAt : p.scheduled ? p.payAt + 'T00:00:00Z' : p.settledAt || p.sentAt || p.createdAt);

const schedCache = new WeakMap();
/** A dated payment as a payment-shaped record (it has no on-chain payment yet). */
function schedRec(s) {
  let r = schedCache.get(s);
  if (r) { r.status = s.status; r.payAt = s.day; r.outcome = s.outcome || null; return r; }
  const id = s.payment || `${s.agreement}-${s.day}`;
  r = {
    id, scheduled: s, direction: 'out', kind: 'payment', status: s.status, outcome: s.outcome || null,
    purpose: s.agreement ? 'agreement' : 'supplier', route: s.budget === 'board' ? 'board' : s.agreement ? 'agreement' : 'department', budget: s.budget,
    counterparty: s.to, payee: { name: s.to }, payer: { name: D.company.name, safe: T.address, label: 'Treasury' },
    amount: s.amount, asset: s.asset || 'USDC', amountRaw: String(Math.round(s.amount * 1e6)), gbp: gbpOf(s.amount), rate: RATE, fee: 0,
    createdAt: s.createdAt || null, payAt: s.day, preparedBy: s.scheduledBy, proposal: s.proposal || null, memo: s.what, proof: null,
  };
  schedCache.set(s, r);
  return r;
}
const allPayments = () => [...M.payments, ...M.scheduled.map(schedRec)];
function findPayment(id) {
  if (!id) return null;
  const p = cx.find(M.payments, 'id', id);
  if (p) return p;
  const e = cx.find(M.escrows, 'id', id);
  if (e) return M.payments.find((x) => x.id === e.payment) || null;
  const s = M.scheduled.find((x) => cx.slug(schedRec(x).id) === cx.slug(id));
  return s ? schedRec(s) : null;
}
const escrowOf = (p) => M.escrows.find((e) => e.payment === p.id) || null;
const payoutOf = (p) => (p.payout ? M.payouts.find((x) => x.id === p.payout) : null);
const depositOf = (p) => (p.deposit ? M.deposits.find((x) => x.id === p.deposit) : null);
const pinv = (name) => D.books.purchaseInvoices.find((x) => x.name === name) || null;
const docRoute = (v) => (!v ? null : v.startsWith('ACC-PAY') ? 'payment-entry' : v.startsWith('ACC-JV') ? 'journal-entry' : null);

/** The hat that lets the viewer act for a budget now: the budget's own, or the one above it they wear. */
function hatFor(budget, who = cx.meId()) {
  if (!budget || budget === 'board') return 'Director';
  if (cx.holders(budget).includes(who)) return cx.deptName(budget).replace(/ allowance$/, ' allowance');
  const up = cx.ancestors(budget).find((a) => cx.holders(a).includes(who));
  return up ? cx.deptName(up) : cx.deptName(budget);
}
/** Who may act for a budget's money now, in words (the hat, then its wearers). */
function whoMay(budget) {
  if (!budget || budget === 'board') return 'the Board: 2 of 3 Directors approve';
  if (isAllowance(budget)) return `whoever holds the ${cx.deptName(budget)} now (${cx.holders(budget).map(cx.name).join(', ') || 'nobody'}), or the Board`;
  const names = [...new Set([budget, ...cx.ancestors(budget)].flatMap((d) => cx.holders(d)))].map(cx.name);
  return `whoever wears the ${cx.deptName(budget)} hat or one above it now (${names.join(', ')}), or the Board`;
}
const mayAct = (budget) => (budget === 'board' ? { ok: cx.wears('Director'), reason: 'Only Directors act for the Board: it takes a Board proposal.' } : isAllowance(budget) ? (cx.holders(budget).includes(cx.meId()) ? { ok: true } : { ok: false, reason: `Needs the ${cx.deptName(budget)} hat. ${cx.holders(budget).map(cx.name).join(', ')} holds it now.` }) : cx.allowed({ dept: budget }));
/** Budgets the viewer may pay from now: departments whose hat (or one above) they wear, allowances they hold. */
function payableBudgets() {
  const out = [];
  for (const d of D.departments) if (cx.holds(d.id)) out.push(d.id);
  for (const a of D.allowances) if (cx.holders(a.id).includes(cx.meId())) out.push(a.id);
  return out;
}
function leftOf(budget) {
  if (isAllowance(budget)) return allowanceMonth(deptRec(budget))?.left ?? 0;
  return cx.budgetOn(budget)?.left ?? 0;
}
const periodWord = (budget) => (isAllowance(budget) ? 'this month' : 'this quarter');

/* =====================================================================================================
   Changing the data: the Treasury, budgets, the ceiling, the feed
   ===================================================================================================== */

function pushTable(path, obj, front) {
  const objs = cx.rows(path);
  const t = path.split('.').reduce((o, k) => o?.[k], D);
  if (!t?.cols) return;
  const arr = t.cols.map((c) => obj[c] ?? null);
  if (front) { t.rows.unshift(arr); objs.unshift(obj); } else { t.rows.push(arr); objs.push(obj); }
}
function treasuryMove(delta, at, desc, ref, tx, block) {
  T.balance = r6(T.balance + delta);
  if (T.holdings?.[0]) T.holdings[0].balance = T.balance;
  T.gbp = gbpOf(T.balance);
  T.available = r2(T.balance - T.reserved);
  pushTable('money.statements.treasury', { time: at, block, tx, logIndex: 20 + tick, direction: delta < 0 ? 'out' : 'in', amount: Math.abs(delta), balanceAfter: T.balance, description: desc, reference: ref });
}
function spendBudget(budget, amount, field = 'spent') {
  if (!budget || budget === 'board') return;
  if (isAllowance(budget)) {
    const m = allowanceMonth(deptRec(budget));
    if (m) { m[field === 'spent' ? 'spent' : 'spent'] = r2(m.spent + amount); m.left = r2(m.left - amount); }
  } else {
    const b = cx.budgetOn(budget);
    if (b) { b[field] = r2((b[field] || 0) + amount); b.left = r2(b.left - amount); }
  }
}
function useCeiling(amount) { const c = ceiling(); if (c) { c.used = r2(c.used + amount); c.left = r2(c.left - amount); } }
function addActivity(p, at) {
  pushTable('activity', { at, kind: p.kind === 'movement' ? 'Outside money' : 'Payment', direction: p.direction === 'out' ? 'Out' : p.direction === 'in' ? 'In' : 'Between your Safes', amount: signedAmt(p), counterparty: p.counterparty, status: p.status, outcome: p.outcome, budget: p.budget, safe: 'Treasury', tx: p.proof?.tx || null, payment: p.id }, true);
}
function addEvent(text, ref, kind = 'Money') { D.events.unshift({ at: stamp(), kind, text, ref, who: cx.meId() }); }
function addNotice(to, text, ref, kind = 'Money') { for (const t of [].concat(to)) D.notices.unshift({ to: t, at: stamp(), kind, text, ref, read: false }); }
function dropWaiting(pred) { const w = D.approvals.waiting; for (let i = w.length - 1; i >= 0; i--) if (pred(w[i])) w.splice(i, 1); }
function payInvoice(pi, amt, p) {
  if (!pi) return;
  pi.outstanding = r2(Math.max(0, pi.outstanding - amt));
  pi.paidAmount = r2((pi.paidAmount || 0) + amt);
  pi.status = pi.outstanding <= 0.004 ? 'Paid' : 'Partly Paid';
  (pi.payments ||= []).push({ date: cx.today, amount: amt, payment: p.id, voucher: null, channel: 'Capxul' });
}
/** One allocation of the payment advice, from a purchase invoice. */
function allocOf(pi, amt) {
  const cents = (n) => Math.round(n * 100);
  const vat = pi.taxes?.[0]?.rate || 0;
  return {
    record: 'Purchase Invoice', doc: pi.name, currency: pi.currency, number: pi.billNo || pi.name, date: pi.billDate || pi.postingDate, content: pi.contentHash, allocated: cents(amt),
    lines: (pi.items || []).map((it) => ({ idx: it.idx, description: it.description, amount: cents(it.amount), taxes: vat ? [{ name: 'VAT', bps: vat * 100, amount: cents(it.amount * vat / 100) }] : [] })),
  };
}
/** The proof of a new payment: the advice, really hashed, so Verify passes. */
async function makeProof(p, r, allocations = [], extra = {}) {
  const advice = {
    version: 1, origin: p.id, salt: cx.randHex(16),
    payer: { party: HL_PARTY, account: T.address },
    payee: { party: p.payee?.party || null, account: p.payee?.safe || (extra.bankLast4 ? 'bridge:' + extra.bankLast4 : null), ...(p.payee?.mailbox ? { mailbox: p.payee.mailbox } : {}) },
    token: p.asset, amount: p.amountRaw,
    cash: { currency: 'GBP', decimals: 2, amount: Math.round(p.gbp * 100), rate: RATE },
    allocations, adjustments: extra.adjustments || [], onAccount: 0, memo: p.memo || '', refundOf: '0x0',
    route: { kind: p.route, budget: p.budget, payAt: 0, ...(extra.payout ? { payout: extra.payout } : {}) }, batch: null,
  };
  return { network: 'Base', chainId: 8453, paymentId: cx.randHex(32), documentHash: await cx.hashOf(advice), tx: r.tx, block: r.block, logIndex: 30 + tick, settledThrough: p.route === 'money-waiting' ? 'Money waiting (escrow)' : `Budgets (${p.budget})`, finality: 'Final', advice };
}
/** Board proposals opened from money screens: Directors approve them. */
function proposeToBoard({ title, calls, note, kind = 'Transaction', why, ref }) {
  const n = Math.max(...D.board.proposals.map((x) => Number(x.id.slice(3)))) + 1;
  const id = 'sp_' + String(n).padStart(4, '0');
  const nonce = D.board.nextNonce++;
  T.nonce = D.board.nextNonce; T.waiting = (T.waiting || 0) + 1;
  const at = stamp();
  const others = D.board.directors.map((d) => d.who).filter((w) => w !== cx.meId());
  const sp = { id, nonce, title, kind, note: note || null, calls, proposedBy: cx.meId(), createdAt: at, threshold: D.board.threshold, directors: D.board.directors.map((d) => d.who), approvals: [{ who: cx.meId(), at }], status: 'Waiting', executedAt: null, safeTxHash: cx.randHex(32), executionTx: null, executionBlock: null, why: why || null, ref: ref || null };
  D.board.proposals.push(sp);
  D.approvals.waiting.unshift({ kind: 'Board', what: `Board proposal ${id}: ${title}`, amount: null, openedBy: cx.meId(), openedAt: at, waitsFor: others, because: 'Directors approve Board proposals', approvedBy: [cx.meId()], ref: { type: 'proposal', id }, command: `capxul org proposal approve ${id} ${ORG}` });
  addNotice(others, `Board proposal ${id} waits for your approval: ${title}`, { type: 'proposal', id }, 'Board');
  addEvent(`${cx.name(cx.meId())} proposed ${id}: ${title}`, { type: 'proposal', id }, 'Board');
  return sp;
}
/** Ask the Directors (the viewer approves first, from their own Safe), then open the proposal. */
async function boardAsk({ title, calls, note, kind, why, ref, cmd }) {
  const nonce = D.board.nextNonce;
  const r = await cx.approval({ title: `Board proposal: ${title}`, board: { proposal: `sp_${String(Math.max(...D.board.proposals.map((x) => Number(x.id.slice(3)))) + 1).padStart(4, '0')}`, nonce, have: 0, need: D.board.threshold, approvedBy: [] }, cmd, warnings: note ? [`Note for the Directors: ${note}`] : null });
  if (r.status === 'declined') return null;
  const sp = proposeToBoard({ title, calls, note, kind, why, ref });
  cx.toast(`Proposed ${sp.id}. It waits for one more Director.`, { tone: 'success', cmd: `capxul org proposal wait ${sp.id} ${ORG}`, action: cx.hasRoute('proposal') ? { label: 'Open', onClick: () => cx.go('proposal', sp.id) } : null });
  return sp;
}

/* =====================================================================================================
   Money moving: approve a prepared payment, take back, cancel and reschedule, send, pay by bank
   ===================================================================================================== */

/** Settle an outgoing payment after its approval: status, proof, the Treasury, the budget, the ceiling, the feed. */
async function settleOut(p, r, { allocations = [], extra = {}, desc, escrow } = {}) {
  p.approval = p.approval || cx.newId('approval');
  p.approvedBy = cx.meId(); p.approvedHat = hatFor(p.budget);
  p.sentAt = r.at; p.settledAt = r.at;
  p.status = escrow ? 'Money waiting' : 'Settled';
  p.proof = await makeProof(p, r, allocations, extra);
  if (p.route !== 'agreement') spendBudget(p.budget, p.amount);
  useCeiling(p.amount);
  treasuryMove(-p.amount, r.at, desc || p.counterparty, p.id, r.tx, r.block);
  addActivity(p, r.at);
  D.approvals.recent?.unshift({ id: p.approval, signer: cx.meId(), hat: p.approvedHat, signerSafe: cx.me().safe, openedAt: p.createdAt, signedAt: r.at, status: 'Done', preparedBy: p.preparedBy || cx.meId(), title: null, proposal: null });
}

async function approvePrepared(p) {
  const po = payoutOf(p);
  const signer = p.waitingFor?.who || p.preparedBy;
  const pi = D.books.purchaseInvoices.find((x) => x.billNo && x.billNo === p.memo);
  const expired = po && po.quoteExpiresAt && Date.parse(po.quoteExpiresAt) < cx.now.getTime() + tick * 41000;
  const r = await cx.approval({
    title: po ? `Pay ${p.counterparty} ${fmt.gbp(po.bankAmount)} by bank` : `Pay ${p.counterparty}`,
    from: `Harbourline Treasury · ${fmt.addr(T.address)} · ${cx.deptName(p.budget)} budget`,
    to: po ? `${p.counterparty} · ${po.bank.bankName} ·· ${po.bank.last4} · ${po.rail}` : `${p.counterparty}${p.payee?.safe ? ' · ' + fmt.addr(p.payee.safe) : ''}`,
    amount: p.amount, gbp: p.gbp, rate: RATE,
    rows: po ? [{ to: p.counterparty, amount: `${fmt.gbp(po.bankAmount)} requested output, exact`, rail: 'Bank via Bridge' }] : null,
    warnings: [pi ? `It pays ${pi.name} (${pi.billNo}), due ${fmt.date(pi.dueDate)}.` : null, po ? `Bridge's fee ${fmt.usdc(po.fee)} is inside the ${fmt.usdc(p.amount)}.` : null, expired ? 'The quote has expired: Capxul asks Bridge again before sending.' : null].filter(Boolean),
    signer, hat: p.waitingFor?.hat || hatFor(p.budget, signer),
    deadline: po ? `Quote expires ${fmt.time(po.quoteExpiresAt)} today` : null,
    cmd: po ? `capxul bank pay contact ${po.bankAmount} ${ORG} --account ${M.savedBankAccounts.find((a) => a.holder === p.counterparty)?.id || 'bacc_…'} --from ${p.budget}` : `capxul payment send ${p.payee?.handle || p.payee?.email || p.counterparty} ${p.amount} ${ORG} --from ${p.budget}`,
    next: `capxul payment wait ${p.approval || 'approval_' + p.id.slice(8, 20)}`,
  });
  if (r.status !== 'done') return;
  await settleOut(p, r, { allocations: pi ? [allocOf(pi, pi.outstanding)] : [], extra: po ? { bankLast4: po.bank.last4, adjustments: [{ kind: 'fee', by: 'Bridge', amount: String(Math.round(po.fee * 1e6)) }], payout: { bankAmount: Math.round(po.bankAmount * 100), currency: po.currency, rail: po.rail } } : {}, desc: po ? `Bank payout to ${p.counterparty} (via Bridge)` : p.counterparty });
  p.waitingFor = null;
  if (po) { po.status = 'In transit'; po.sentAt = r.at; }
  if (pi) payInvoice(pi, pi.outstanding, p);
  dropWaiting((a) => a.ref?.id === p.id);
  addEvent(`${cx.name(cx.meId())} paid ${p.counterparty} ${po ? fmt.gbp(po.bankAmount) + ' by bank' : fmt.usdc(p.amount)} from ${cx.deptName(p.budget)}`, { type: 'payment', id: p.id });
  addNotice(cx.holders(p.budget).filter((x) => x !== cx.meId() && !x.startsWith('@')), `Bank payout sent: ${po ? fmt.gbp(po.bankAmount) : fmt.usdc(p.amount)} to ${p.counterparty}`, { type: po ? 'payout' : 'payment', id: po ? po.id : p.id });
  cx.toast(po ? `Sent to Bridge. ${fmt.gbp(po.bankAmount)} is on its way to ${p.counterparty} by ${po.rail}.` : `Paid ${p.counterparty}.`, { tone: 'success', cmd: `capxul payment get ${p.id} ${ORG}` });
  cx.refresh();
}

async function withdrawPrepared(p) {
  const ok = await cx.confirm({ title: `Withdraw the payment to ${p.counterparty}?`, body: 'Nothing has moved. The approval is withdrawn and the quote is let go.', cmd: `capxul payment cancel ${p.id} ${ORG}`, who: `${cx.name(p.preparedBy)}, who prepared it`, confirmLabel: 'Withdraw', danger: true });
  if (!ok) return;
  p.status = 'Cancelled'; p.outcome = 'Withdrawn'; p.waitingFor = null;
  const po = payoutOf(p); if (po) { po.status = 'Expired'; po.reason = 'Withdrawn before anyone approved it'; }
  dropWaiting((a) => a.ref?.id === p.id);
  cx.toast('Withdrawn. Nothing moved.', { tone: 'info', cmd: `capxul payment cancel ${p.id} ${ORG}` });
  cx.refresh();
}

async function takeBack(p) {
  const e = escrowOf(p);
  if (!e || e.status !== 'Open') return;
  const cmd = `capxul payment cancel ${p.id} ${ORG}`;
  const ok = await cx.confirm({
    title: `Take back ${fmt.usdc(p.amount)} waiting for ${e.email}?`,
    body: `The money goes back to the Treasury. ${cx.deptName(e.from)}'s budget for this quarter stays spent: taking it back does not give the room back. If ${e.email} claims it before your approval lands, the chain decides and the claim stands.`,
    cmd, who: whoMay(e.from), confirmLabel: 'Take it back', danger: true,
  });
  if (!ok) return;
  const r = await cx.approval({ title: `Take back money waiting for ${e.email}`, from: `Money waiting · escrow ${fmt.addr(e.escrowAddress)}`, to: `Harbourline Treasury · ${fmt.addr(T.address)}`, amount: p.amount, gbp: gbpOf(p.amount), rate: RATE, signer: cx.meId(), hat: hatFor(e.from), cmd, next: `capxul payment wait ${p.id}` });
  if (r.status !== 'done') return;
  e.status = 'Taken back'; e.takenBackAt = r.at; e.takenBackBy = cx.meId(); e.takeBackTx = r.tx;
  p.status = 'Cancelled'; p.outcome = 'Taken back'; p.cancelledAt = r.at;
  MW.balance = r2(MW.balance - p.amount); MW.open = Math.max(0, MW.open - 1);
  pushTable('money.statements.moneyWaiting', { time: r.at, block: r.block, tx: r.tx, logIndex: 40 + tick, direction: 'out', amount: p.amount, balanceAfter: MW.balance, description: 'Taken back by Harbourline', reference: p.id });
  treasuryMove(p.amount, r.at, `Taken back from money waiting for ${e.email}`, p.id, r.tx, r.block);
  addActivity({ ...p, direction: 'in', kind: 'payment' }, r.at);
  dropWaiting((a) => a.ref?.id === p.id);
  addEvent(`${cx.name(cx.meId())} took back ${fmt.usdc(p.amount)} waiting for ${e.email}`, { type: 'payment', id: p.id });
  addNotice(cx.holders(e.from).filter((x) => x !== cx.meId()), `Money taken back: ${fmt.usdc(p.amount)} waiting for ${e.email} is back in the Treasury`, { type: 'payment', id: p.id });
  cx.toast(`Taken back. ${fmt.usdc(p.amount)} is in the Treasury again; ${cx.deptName(e.from)}'s room stays spent.`, { tone: 'success', cmd });
  cx.refresh();
}

function claimLine(e) { return `Sign up at capxul.com with ${e.email} to claim ${fmt.usdc(e.amount)} from ${D.company.name}. Until you do, ${D.company.short} can take it back.`; }

/** What the person the money waits for sees: the email, the last step of sign-up, the claim. */
function recipientPreview(e) {
  const p = M.payments.find((x) => x.id === e.payment);
  const first = e.email.split('@')[0].split(/[._]/)[0];
  const name = p?.counterparty && !p.counterparty.includes('@') ? p.counterparty : e.email;
  const body = h('div', { style: 'display:grid;gap:14px' },
    h('p.mx-note', `A preview of what ${name} sees. Only the Safe that ${e.email} sets up can claim this money; nobody at Harbourline can claim it for them.`),
    h('div', h('div.ws-sec-title', '1 · The email'), h('div.mx-mail',
      h('header', h('span', 'From: Capxul <notices@capxul.com> · To: ' + e.email), h('b', `${D.company.name} sent you ${fmt.usdc(e.amount)}`)),
      h('div.body',
        h('p', `Hello ${first.charAt(0).toUpperCase() + first.slice(1)},`),
        h('p', `${D.company.name} sent you ${fmt.usdc(e.amount)} (about ${fmt.gbp(gbpOf(e.amount))}) for ${e.what.replace('Purchase Invoice ', 'invoice ')}. It is waiting for you. Sign up with this email address to claim it. Until you do, ${D.company.short} can take it back.`),
        h('div', h('span.btn.primary', 'Sign up and claim'), ' ', h('span.mx-note', 'The money is held on chain at ', cx.addr(e.escrowAddress))),
        h('p.mx-note', `Reminders follow at 3, 10 and 30 days. ${e.reminders?.length ? 'Sent so far: ' + e.reminders.map((x) => `day ${x.day} (${fmt.date(x.sentAt)})`).join(', ') + '.' : ''}`)))),
    h('div', h('div.ws-sec-title', '2 · The last step of sign-up'), h('div.mx-mail', h('div.body',
      h('b', `${fmt.usdc(e.amount)} from ${D.company.name} is waiting for you.`),
      h('p', 'Claim it into your new Safe. One approval with the passkey you just made.'),
      h('div', cx.btn(`Claim ${fmt.usdc(e.amount)}`, { kind: 'primary', icon: 'passkey', cmd: 'capxul payment claim', disabled: true, reason: `Only ${e.email}'s own new Safe can claim this. This is a preview.` }))))),
    h('div', h('div.ws-sec-title', '3 · Later'), h('p.mx-note', 'Under Your money › Money waiting for you, with Claim; "Claim all" when there are several. The command takes no payment ID: it claims everything waiting for you.')));
  cx.modal({ title: `What ${name} sees`, wide: true, body, actions: [{ label: 'Copy what to tell them', onClick: (close) => { cx.copy(claimLine(e)); cx.toast('Copied: ' + claimLine(e)); close(); } }, { label: 'Close', primary: true }] });
}

async function cancelScheduled(s) {
  const p = schedRec(s);
  const board = s.budget === 'board';
  const cmd = `capxul payment cancel ${p.id} ${ORG}${board ? ' --as-directors' : ''}`;
  if (board) {
    await boardAsk({ title: `Cancel the payment of ${fmt.usdc(s.amount)} to ${s.to} on ${fmt.date(s.day)}`, calls: [`Budgets.cancelScheduled(${p.id})`], kind: 'Transaction', note: 'Cancel the dated payment', cmd, ref: { type: 'payment', id: p.id } });
    return;
  }
  const ok = await cx.confirm({ title: `Cancel ${fmt.usdc(s.amount)} to ${s.to} on ${fmt.date(s.day)}?`, body: `The money stays in the Treasury and ${fmt.usdc(s.amount)} of ${cx.deptName(s.budget)}'s room comes back for this ${isAllowance(s.budget) ? 'month' : 'quarter'}.`, cmd, who: whoMay(s.budget), confirmLabel: 'Cancel the payment', cancelLabel: 'Keep it', danger: true });
  if (!ok) return;
  const r = await cx.approval({ title: `Cancel the dated payment to ${s.to}`, from: `${cx.deptName(s.budget)} budget`, to: s.to, amount: s.amount, gbp: gbpOf(s.amount), rate: RATE, signer: cx.meId(), hat: hatFor(s.budget), cmd });
  if (r.status !== 'done') return;
  s.status = 'Cancelled'; s.outcome = 'Cancelled in budget'; s.reserved = false;
  T.reserved = r2(T.reserved - s.amount); T.available = r2(T.balance - T.reserved);
  const b = cx.budgetOn(s.budget); if (b) { b.committed = r2(Math.max(0, b.committed - s.amount)); b.left = r2(b.left + s.amount); }
  addEvent(`${cx.name(cx.meId())} cancelled ${fmt.usdc(s.amount)} to ${s.to} due ${fmt.date(s.day)}`, { type: 'payment', id: p.id });
  cx.toast('Cancelled. The room is back in the budget.', { tone: 'success', cmd });
  cx.refresh();
}

function rescheduleScheduled(s) {
  const p = schedRec(s);
  const model = { day: addDays(s.day, 5) };
  const board = s.budget === 'board';
  const cmdOf = () => `capxul payment reschedule ${p.id} --on ${model.day} ${ORG}${board ? ' --as-directors' : ''}`;
  const err = h('div.mx-err');
  const m = cx.modal({
    title: `Reschedule ${fmt.usdc(s.amount)} to ${s.to}`,
    body: h('div', { style: 'display:grid;gap:12px' },
      cx.kv([['Now', `${fmt.date(s.day)}, 00:00 UTC`], ['From', cx.deptName(s.budget)], ['Who may', whoMay(s.budget)]]),
      cx.field({ label: 'New day', type: 'date', edit: true, model, key: 'day', onChange: () => cx.showAction(cmdOf(), 'Reschedule', { pin: true }) }), err,
      h('p.mx-note', 'It was signed when it was scheduled. On the day, Capxul asks the budget to pay it; nobody needs to be online.')),
    actions: [{ label: 'Back' }, { label: board ? 'Propose to the Board' : 'Reschedule', primary: true, cmd: cmdOf(), onClick: async (close) => {
      if (!model.day || model.day <= cx.today) { err.textContent = 'Pick a day after today.'; return; }
      close();
      if (board) { await boardAsk({ title: `Move the payment to ${s.to} to ${fmt.date(model.day)}`, calls: [`Budgets.reschedule(${p.id}, ${model.day})`], cmd: cmdOf(), ref: { type: 'payment', id: p.id } }); return; }
      const r = await cx.approval({ title: `Reschedule the payment to ${s.to}`, from: `${cx.deptName(s.budget)} budget`, to: s.to, amount: s.amount, gbp: gbpOf(s.amount), rate: RATE, signer: cx.meId(), hat: hatFor(s.budget), deadline: `Sent on ${fmt.date(model.day)}, 00:00 UTC`, cmd: cmdOf() });
      if (r.status !== 'done') return;
      s.day = model.day;
      M.scheduled.sort((a, b) => a.day.localeCompare(b.day));
      cx.toast(`Moved to ${fmt.date(model.day)}.`, { tone: 'success', cmd: cmdOf() });
      cx.refresh();
    } }],
  });
  return m;
}

/* =====================================================================================================
   Money overview
   ===================================================================================================== */

function inTransit() { return M.payouts.filter((x) => x.status === 'In transit'); }
function thisMonth() {
  const from = monthNow + '-01';
  const rows = cx.rows('activity').filter((r) => String(r.at) >= from && r.safe === 'Treasury' && r.direction !== 'Between your Safes');
  const inn = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const out = rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0);
  const pending = M.deposits.filter((d) => d.status === 'Arriving');
  return { inn, out, net: inn - out, count: rows.length, pending };
}
const barclays = () => D.books.bankAccounts?.[0];

cx.route('money', () => {
  if (cx.acting() === 'personal') return yourMoneyPage();
  const tr = inTransit();
  const bank = barclays();
  const trGbp = tr.reduce((s, x) => s + x.bankAmount, 0);
  const total = T.gbp + R.gbp + gbpOf(MW.balance) + trGbp + (bank?.balance || 0);
  const tm = thisMonth();
  const prep = M.payments.filter((p) => p.status === 'Prepared');
  const needs = [
    ...prep.map((p) => ({ label: `Approve: pay ${p.counterparty} ${payoutOf(p) ? fmt.gbp(payoutOf(p).bankAmount) + ' by bank' : fmt.usdc(p.amount)}`, sub: `waits for ${cx.name(p.waitingFor?.who || p.preparedBy)} (${p.waitingFor?.hat || cx.deptName(p.budget)})`, right: fmt.usdc(p.amount), route: 'payment', id: p.id })),
    ...D.board.proposals.filter((x) => x.status === 'Waiting').map((x) => ({ label: `Board proposal ${x.id}: ${x.title}`, sub: `${x.approvals.length} of ${x.threshold} approvals`, route: 'proposal', id: x.id })),
    ...M.deposits.filter((d) => d.match === 'Unmatched').map((d) => ({ label: `Match a deposit: ${d.from} ${fmt.money(d.bankAmount, d.currency)}`, sub: `credited ${fmt.date(d.creditedAt)} · Books`, right: fmt.usdc(d.net), route: 'deposit', id: d.id })),
    ...M.escrows.filter((e) => e.status === 'Open').map((e) => ({ label: `Uncollected: ${e.email}`, sub: `${cx.deptName(e.from)} · waiting ${daysBetween(e.fundedAt, cx.today)} days`, right: fmt.usdc(e.amount), route: 'payment', id: e.payment })),
  ];
  const tre = cx.rows('money.statements.treasury');
  const monthEnd = new Map(); for (const r of tre) monthEnd.set(String(r.time).slice(0, 7), r.balanceAfter);
  const months = [...monthEnd.keys()].sort().slice(-12);
  const accounts = h('div.mx-acc',
    h('a', { href: '#treasury' }, h('span.k', cx.icon('lock', { size: 13 }), 'Treasury ', h('span.mx-safe', 'Safe · Base')), h('span.v', fmt.num(T.balance, 2), h('small', 'USDC')), h('span.s', `${fmt.gbp(T.gbp)} · ${fmt.usdc(T.available)} available · ${fmt.usdc(T.reserved)} reserved for ${M.scheduled.filter((s) => s.reserved).length} dated payments`), h('span.s.mono', fmt.addr(T.address))),
    h('a', { href: '#reserve' }, h('span.k', cx.icon('shield', { size: 13 }), 'Reserve Safe ', h('span.mx-safe', 'Safe · Base')), h('span.v', fmt.num(R.balance, 2), h('small', 'USDC')), h('span.s', `${fmt.gbp(R.gbp)} · moves only by Board proposal`), h('span.s.mono', fmt.addr(R.address))),
    h('a', { href: '#money-waiting' }, h('span.k', cx.icon('hourglass', { size: 13 }), 'Money waiting ', h('span.mx-safe', 'Escrow')), h('span.v', fmt.num(MW.balance, 2), h('small', 'USDC')), h('span.s', `${fmt.plural(MW.open, 'escrow')} open · ${fmt.gbp(gbpOf(MW.balance))} · to be claimed`)),
    h('a', { href: '#bank' }, h('span.k', cx.icon('out', { size: 13 }), 'Payouts in transit ', h('span.mx-safe', 'via Bridge')), h('span.v', fmt.gbp(trGbp)), h('span.s', `${fmt.plural(tr.length, 'payout')} · ${fmt.usdc(tr.reduce((s, x) => s + x.sent, 0))} sent`)),
    bank ? h('a', { href: cx.hasRoute('bank-account') ? cx.href('bank-account', bank.name) : '#bank' }, h('span.k', cx.icon('bank', { size: 13 }), 'Barclays Business ', h('span.mx-safe', 'Bank · GBP')), h('span.v', fmt.gbp(bank.balance)), h('span.s', `per Books · ·· ${bank.last4} · statement to ${fmt.date(bank.statementTo)} · ${bank.toReconcile} to reconcile`)) : null);
  const totalNode = h('div.card', h('div.card-body', { style: 'display:grid;gap:14px' },
    h('div.mx-total', h('span.muted', 'Total cash'), h('span.big', fmt.gbp(total)), h('span.mx-note', `at 1 USDC = £${RATE} · ${fmt.datetime(D.meta.now)}`)),
    accounts,
    h('p.mx-note', cx.icon('lock', { size: 12 }), ' Only an approval by a department\'s holder, or a Board proposal, can move money out of a Safe. Capxul never signs for anyone.')));
  const actions = [
    cx.menu(null, [
      { label: 'Show deposit address', icon: 'chain', cmd: `capxul address ${ORG}`, onClick: () => cx.go('treasury', null, { tab: 'Deposit address' }) },
      { label: 'Payout ceilings', icon: 'shield', cmd: `capxul org department ceiling set --token USDC ${ORG}`, href: ['payout-ceilings'] },
      { label: 'Requests to pay', icon: 'list', cmd: `capxul inbox list ${ORG}`, href: ['requests-to-pay'] },
    ]),
    cx.btn('Get paid by bank', { icon: 'in', cmd: `capxul bank details ${ORG}`, href: ['bank'] }),
    cx.btn('Pay a bank account', { icon: 'bank', cmd: `capxul bank pay contact <amount> ${ORG} --from <budget>`, href: ['pay-by-bank'] }),
    cx.btn('Send money', { kind: 'primary', icon: 'send', cmd: `capxul payment send <to> <amount> ${ORG} --from <budget>`, href: ['send-money'] }),
  ];
  return cx.workspacePage({
    title: 'Money', workspace: 'money', actions,
    cmd: { cli: `capxul balance ${ORG}`, sdk: 'client.accounts.read({ org: "harbourline" })', who: 'any member', json: { balances: [{ account: 'Treasury', address: T.address, network: 'Base', chainId: 8453, asset: 'USDC', balance: fmt.num(T.balance, 6).replace(/,/g, ''), available: String(T.available) }, { account: 'Reserve Safe', address: R.address, asset: 'USDC', balance: String(R.balance) }], moneyWaiting: { balance: String(MW.balance), open: MW.open } } },
    order: ['body', 'cards', 'charts', 'shortcuts', 'quick', 'links'],
    body: [totalNode],
    cards: [
      { label: 'In this month', value: '+' + fmt.usdc(tm.inn), sub: `${fmt.gbp(gbpOf(tm.inn))} · since 1 ${fmt.month(monthNow).split(' ')[0]}`, cmd: `capxul activity summary ${ORG} --from ${monthNow}-01`, href: ['activity'] },
      { label: 'Out this month', value: '−' + fmt.usdc(tm.out), sub: `${fmt.gbp(gbpOf(tm.out))} · suppliers, escrows, seats, allowances`, cmd: `capxul activity summary ${ORG} --from ${monthNow}-01`, href: ['payments'] },
      { label: 'Net', value: (tm.net >= 0 ? '+' : '−') + fmt.usdc(Math.abs(tm.net)), sub: `${tm.count} movements`, delta: { text: tm.net >= 0 ? 'more in than out' : 'more out than in', good: tm.net >= 0 } },
      { label: 'Pending in', value: tm.pending.map((d) => fmt.money(d.bankAmount, d.currency)).join(' + ') || '0', sub: tm.pending.map((d) => `${d.from.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())} · arriving`).join(', ') || 'nothing arriving', href: tm.pending[0] ? ['deposit', tm.pending[0].id] : null },
    ],
    charts: [
      { title: 'Treasury balance at month end', cmd: `capxul activity list ${ORG}`, node: cx.chart.line({ labels: months.map((m) => fmt.monthShort(m)), series: [{ name: 'Treasury', values: months.map((m) => monthEnd.get(m)) }], area: true, height: 200, format: (v) => fmt.compact(v), tipFormat: (v) => fmt.usdc(v) }) },
      { title: 'Where the Treasury\'s money went, this quarter', cmd: `capxul org department list ${ORG}`, node: cx.chart.hbar({ items: D.departments.map((d) => ({ label: d.name, value: cx.budgetOn(d.id)?.spent || 0, href: ['department', d.id] })).sort((a, b) => b.value - a.value), format: (v) => fmt.usdc(v, 0) }) },
    ],
    shortcuts: [
      { label: 'Payments', route: 'payments', icon: 'list', count: M.payments.length },
      { label: 'Scheduled', route: 'scheduled-payments', icon: 'calendar', count: M.scheduled.filter((s) => s.status === 'Scheduled').length, tone: 'blue' },
      { label: 'Money waiting', route: 'money-waiting', icon: 'hourglass', count: M.escrows.filter((e) => e.status === 'Open').length, tone: 'orange' },
      { label: 'Bank', route: 'bank', icon: 'bank' },
      { label: 'Requests to pay', route: 'requests-to-pay', icon: 'mail', count: M.requestsToPay.filter((r) => /^Open/.test(r.status)).length },
      { label: 'Departments', route: 'departments', icon: 'departments' },
    ],
    quick: [
      { title: 'Needs you', items: needs.slice(0, 6) },
      { title: 'Latest movements', items: cx.rows('activity').slice(0, 6).map((r) => ({ label: `${r.amount < 0 ? 'To' : 'From'} ${r.counterparty}`, sub: `${fmt.datetime(r.at)} · ${r.kind}${r.budget ? ' · ' + cx.deptName(r.budget) : ''}`, right: fmt.signed(r.amount, 'USDC'), route: r.payment ? 'payment' : 'activity', id: r.payment })) },
    ],
    links: [
      { title: 'Safes', items: [{ label: 'Treasury', route: 'treasury' }, { label: 'Reserve Safe', route: 'reserve' }, { label: 'Deposit address', route: 'treasury' }] },
      { title: 'Bank (via Bridge)', items: [{ label: 'Bank details', route: 'bank' }, { label: 'Deposits', route: 'bank', count: M.deposits.length }, { label: 'Payouts', route: 'bank', count: M.payouts.length }, { label: 'Pay a bank account', route: 'pay-by-bank' }] },
      { title: 'Books', items: [{ label: 'Barclays Business', route: cx.hasRoute('bank-account') ? 'bank-account' : null, id: D.books.bankAccounts?.[0]?.name }, { label: 'Bank reconciliation', route: cx.hasRoute('banking') ? 'banking' : null }, { label: 'Payment entries', route: cx.hasRoute('payment-entries') ? 'payment-entries' : null, kind: 'report' }] },
    ],
  });
}, { workspace: 'money', title: 'Money' });

/* =====================================================================================================
   A Safe: Treasury and Reserve
   ===================================================================================================== */

function qrCode(text) {
  let x = 0; for (const c of text) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const n = 25, cells = [];
  const finder = (r, c) => [[0, 0], [0, n - 7], [n - 7, 0]].some(([fr, fc]) => r >= fr && r < fr + 7 && c >= fc && c < fc + 7);
  const finderOn = (r, c) => { for (const [fr, fc] of [[0, 0], [0, n - 7], [n - 7, 0]]) { if (r >= fr && r < fr + 7 && c >= fc && c < fc + 7) { const rr = r - fr, cc = c - fc; return rr === 0 || rr === 6 || cc === 0 || cc === 6 || (rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4); } } return false; };
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const on = finder(r, c) ? finderOn(r, c) : rnd() > 0.52; if (on) cells.push(cx.s('rect', { x: c, y: r, width: 1, height: 1, style: 'fill:#111' })); }
  return cx.s('svg', { class: 'mx-qr', viewBox: `0 0 ${n} ${n}`, role: 'img', 'aria-label': 'QR code of the address' }, cells);
}

function safePage(key, ctx) {
  const sf = key === 'treasury' ? T : R;
  const stmtPath = `money.statements.${key}`;
  const isT = key === 'treasury';
  const c = ceiling();
  const holdings = h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Token'), h('th.num', 'Balance'), h('th.num', 'Available'), h('th.num', 'Value (GBP)'), h('th.num.opt', 'Payout ceiling left this year'))),
    h('tbody', (sf.holdings || []).map((x) => h('tr', h('td', h('b', x.token), ' ', h('span.muted.mono', fmt.addr(x.contract))), h('td.num', fmt.num(x.balance, 2)), h('td.num', fmt.num(isT && x.token === 'USDC' ? T.available : x.balance, 2)), h('td.num', fmt.gbp(gbpOf(x.balance))), h('td.num.opt', isT && x.token === 'USDC' ? `${fmt.num(c.left, 2)} of ${fmt.num(c.ceiling, 2)}` : isT ? 'none set' : 'no budgets: Board only'))))));
  const holdTab = () => h('div', { style: 'display:grid;gap:12px;padding:14px 0' },
    holdings,
    isT ? cx.kv([['Balance', fmt.both(T.balance, T.gbp)], ['Reserved for dated payments', h('a', { href: '#scheduled-payments' }, `${fmt.usdc(T.reserved)} (${M.scheduled.filter((s) => s.reserved).length} payments)`)], ['Available', fmt.usdc(T.available)], ['About to leave', `${M.payouts.filter((p) => p.status === 'Quoted').map((p) => `${fmt.usdc(p.sent)} quoted to ${p.to}, not yet approved`).join('; ') || 'nothing quoted'}`]])
      : cx.kv([['Balance', fmt.both(R.balance, R.gbp)], ['What it holds', R.note || 'The money the rounds raised.'], ['Moved to the Treasury', h('span', '200,000.00 USDC on 1 Nov 2025 by ', cx.link('Board proposal sp_0162', 'proposal', 'sp_0162'))]]));
  const stmtTab = () => {
    const rows = cx.rows(stmtPath);
    return h('div', { style: 'padding-top:12px' }, cx.listView({
      key: 'safe-stmt-' + key, rows: () => rows, id: (r) => r.tx + ':' + r.logIndex, noun: 'line',
      titleCol: { key: 'description', label: 'Description', sub: (r) => fmt.datetime(r.time) },
      columns: [
        { key: 'time', label: 'Date', type: 'datetime' },
        { key: 'reference', label: 'Reference', render: (r) => (String(r.reference).startsWith('payment_') ? h('span.mono', String(r.reference).slice(0, 16) + '…') : h('span.mono', r.reference || '')) },
        { key: 'tx', label: 'Transaction', render: (r) => (r.tx ? cx.tx(r.tx) : '') },
        { key: 'out', label: 'Out', type: 'usdc', get: (r) => (r.direction === 'out' ? r.amount : null) },
        { key: 'in', label: 'In', type: 'usdc', get: (r) => (r.direction === 'in' ? r.amount : null) },
      ],
      right: { key: 'balanceAfter', label: 'Balance after', type: 'usdc' },
      status: (r) => ({ text: r.direction === 'in' ? 'In' : 'Out', tone: r.direction === 'in' ? 'green' : 'gray' }),
      filters: [{ key: 'description', label: 'Description' }, { key: 'direction', label: 'Direction', type: 'select', options: ['in', 'out'], flag: '--direction' }, { key: 'time', label: 'Month', type: 'month' }],
      tabs: [{ label: 'All' }, { label: 'Payments', filter: (r) => !/via Bridge \(|Received via Bridge|Pre-seed|Seed:/.test(r.description) }, { label: 'Outside money', filter: (r) => r.direction === 'in' }],
      sort: { options: [{ key: 'time', label: 'Date' }, { key: 'amount', label: 'Amount' }], default: { key: 'time', dir: 'desc' } },
      href: (r) => (String(r.reference).startsWith('payment_') ? ['payment', r.reference] : null),
      cmd: { cli: `capxul activity list ${ORG}${isT ? '' : ' --account reserve'} --limit 25`, sdk: 'client.activity.list({ org: "harbourline", limit: 25 })' },
      pageSize: 20,
    }));
  };
  const props = D.board.proposals.filter((x) => x.status === 'Waiting');
  const ctlTab = () => h('div', { style: 'display:grid;gap:12px;padding:14px 0' },
    cx.card({ title: 'Who can move this money', cmd: `capxul org director list ${ORG}`, body: h('div', { style: 'display:grid;gap:10px' },
      h('div', h('b', `Board proposals: ${D.board.threshold} of ${D.board.directors.length} Directors approve`), h('div.chips', { style: 'margin-top:6px' }, D.board.directors.map((d) => cx.personChip(d.who))), h('div.mx-note', h('a', { href: '#board' }, 'Open the Board'))),
      isT ? h('div', h('b', 'Department and allowance holders'), h('div.mx-note', `within each budget's room this quarter (or month) and the payout ceiling: ${fmt.usdc(c.left)} left of ${fmt.usdc(c.ceiling)} this year. `, h('a', { href: '#departments' }, 'Open Departments'))) : h('div', h('b', 'No budgets'), h('div.mx-note', 'Nothing can leave the Reserve Safe except by Board proposal.')),
      h('div', h('b', 'Nothing else'), h('div.mx-note', 'The Safe\'s guard refuses any other change. Capxul cannot move this money, and neither can any agent.'))) }),
    cx.card({ title: 'The Safe', body: cx.kv([['Address', cx.addr(sf.address)], ['Network', `Base · chain ID ${sf.chainId}`], ['Next proposal nonce', String(D.board.nextNonce)], ['Proposals waiting', props.length ? h('span', props.map((x, i) => [i ? ', ' : '', cx.link(x.id, 'proposal', x.id)])) : 'none'], ['Signers', D.board.directors.map((d) => `${cx.name(d.who)} ${fmt.addr(cx.person(d.who)?.safe || '')}`).join(' · ')]]) }));
  const depTab = () => h('div', { style: 'display:grid;gap:12px;padding:14px 0' }, cx.card({ title: 'Deposit address', cmd: `capxul address ${ORG}`, body: h('div.mx-two',
    h('div', { style: 'display:grid;gap:10px' }, cx.kv([['Network', 'Base'], ['Chain ID', '8453'], ['Address', h('span.mono', { style: 'overflow-wrap:anywhere' }, sf.address)], ['Currency', isT ? 'USDC or EURC' : 'USDC'], ['Label', `${D.company.name} · ${sf.label}`]]),
      h('div', cx.btn('Copy address', { icon: 'copy', onClick: () => { cx.copy(sf.address); cx.toast('Address copied'); } }), ' ', cx.btn('View on explorer', { icon: 'external', href: `https://basescan.org/address/${sf.address}` })),
      cx.banner(`Send only ${isT ? 'USDC or EURC' : 'USDC'} on Base. Anything else is lost.`, { tone: 'warning' })),
    h('div', { style: 'display:grid;justify-items:start;gap:6px' }, qrCode(sf.address), h('span.mx-note', 'Scan to copy the address'))) }));
  const tabs = [{ label: 'Holdings', render: holdTab }, { label: 'Statement', count: cx.rows(stmtPath).length, render: stmtTab }, { label: 'Control', render: ctlTab }, { label: 'Deposit address', render: depTab }];
  const want = ctx.state?.tab ? tabs.findIndex((t) => t.label === ctx.state.tab) : -1;
  return cx.page({
    title: sf.label, status: [cx.pill('Safe', 'teal', { lg: true })],
    sub: h('span', cx.addr(sf.address), ` · Base · ${fmt.both(sf.balance, sf.gbp)}`),
    actions: [cx.btn('Copy address', { icon: 'copy', cmd: `capxul address ${ORG}`, onClick: () => { cx.copy(sf.address); cx.toast('Address copied'); } }), cx.btn('View on explorer', { icon: 'external', href: `https://basescan.org/address/${sf.address}` }), isT ? cx.btn('Send money', { kind: 'primary', icon: 'send', href: ['send-money'], cmd: `capxul payment send <to> <amount> ${ORG} --from <budget>` }) : cx.btn('Move to the Treasury', { kind: 'primary', icon: 'swap', needs: 'Director', cmd: `capxul payment send ${T.address} <amount> ${ORG} --as-directors --from-safe reserve`, onClick: () => moveFromReserve() })],
    cmd: { cli: `capxul balance ${ORG}`, sdk: 'client.accounts.read({ org: "harbourline" })', json: { address: sf.address, network: 'Base', chainId: 8453, label: sf.label, balances: (sf.holdings || []).map((x) => ({ asset: x.token, balance: String(x.balance) })) } },
    body: tabsV(tabs, { key: 'safe-' + key, active: want >= 0 ? want : undefined }),
  });
}
function moveFromReserve() {
  const model = { amount: 150000 };
  cx.modal({ title: 'Move money from the Reserve Safe to the Treasury', body: h('div', { style: 'display:grid;gap:12px' },
    cx.field({ label: 'Amount (USDC)', type: 'usdc', edit: true, model, key: 'amount' }),
    h('p.mx-note', `The Reserve Safe holds ${fmt.usdc(R.balance)}. The Directors approve this as a Board proposal; it executes at ${D.board.threshold} approvals.`)),
  actions: [{ label: 'Back' }, { label: 'Propose to the Board', primary: true, needs: 'Director', cmd: `capxul payment send ${T.address} ${model.amount} ${ORG} --as-directors`, onClick: async (close) => { close(); await boardAsk({ title: `Move ${fmt.usdc(model.amount)} from the Reserve Safe to the Treasury`, calls: [`Reserve Safe: USDC.transfer(Treasury, ${model.amount})`], note: 'Top up the Treasury', cmd: `capxul payment send ${T.address} ${model.amount} ${ORG} --as-directors` }); } }] });
}
cx.route('treasury', (ctx) => safePage('treasury', ctx), { workspace: 'money', title: 'Treasury' });
cx.route('reserve', (ctx) => safePage('reserve', ctx), { workspace: 'money', title: 'Reserve Safe' });

/* =====================================================================================================
   Payments (list)
   ===================================================================================================== */

cx.route('payments', () => {
  const list = cx.listView({
    key: 'payments', rows: allPayments, id: (p) => p.id, noun: 'payment', showId: true,
    titleCol: { key: 'counterparty', label: 'Counterparty', sub: (p) => (p.batch ? `${p.batch.label} · line ${p.batch.index} of ${p.batch.count}` : p.scheduled ? `on ${fmt.date(p.payAt)} · ${p.memo}` : p.memo || PURPOSE[p.purpose] || '') },
    status: (p) => payPill(p),
    columns: [
      { key: 'when', label: 'Date', get: (p) => whenOf(p), render: (p) => (p.scheduled ? fmt.date(p.payAt) : fmt.datetime(whenOf(p))) },
      { key: 'direction', label: 'Direction', render: (p) => cx.dir(p.direction === 'out' ? 'Out' : p.direction === 'in' ? 'In' : 'Between your Safes') },
      { key: 'from', label: 'From', get: (p) => fromLabel(p) },
      { key: 'route', label: 'Route', get: (p) => ROUTE_LABEL[p.route] || p.route },
      { key: 'paidTo', label: 'Paid to', get: (p) => paidTo(p) },
      { key: 'proof', label: 'Proof', render: (p) => (p.proof ? h('span', { title: 'A document hash is on chain and verifies' }, cx.icon('shield', { size: 14 })) : h('span.faint', '—')) },
    ],
    right: { key: 'amount', label: 'Amount', get: (p) => signedAmt(p), render: (p) => cx.amount(signedAmt(p), p.asset, { gbp: p.direction === 'out' ? -p.gbp : p.gbp, sign: true, color: true, stack: true }) },
    modified: (p) => whenOf(p),
    filters: [
      { key: 'counterparty', label: 'Counterparty' },
      { key: 'budget', label: 'From', type: 'select', options: [['', 'Any budget'], ...D.departments.map((d) => [d.id, d.name]), ...D.allowances.map((a) => [a.id, a.name + ' allowance']), ['board', 'Board']], flag: '--from' },
      { key: 'status', label: 'Status', type: 'select', options: ['Prepared', 'Scheduled', 'Money waiting', 'Settled', 'Cancelled'], flag: '--status' },
      { key: 'purpose', label: 'Purpose', type: 'select', options: Object.keys(PURPOSE).map((k) => [k, PURPOSE[k]]) },
      { key: 'when', label: 'Month', type: 'month', get: (p) => whenOf(p) },
    ],
    tabs: [
      { label: 'All' },
      { label: 'Out', filter: (p) => p.direction === 'out' },
      { label: 'In', filter: (p) => p.direction === 'in' },
      { label: 'Scheduled', filter: (p) => p.status === 'Scheduled' },
      { label: 'Money waiting', filter: (p) => p.route === 'money-waiting' },
      { label: 'Needs attention', filter: (p) => ['Needs retry', 'Mismatched', 'Prepared'].includes(p.status) || /Expired|Returned/.test(p.outcome || '') },
    ],
    sort: { options: [{ key: 'when', label: 'Date', get: (p) => whenOf(p) || '' }, { key: 'amount', label: 'Amount', get: (p) => p.amount }, { key: 'counterparty', label: 'Counterparty' }], default: { key: 'when', dir: 'desc' } },
    groupBy: [{ key: 'status', label: 'Status' }, { key: 'budget', label: 'From', get: (p) => fromLabel(p) || 'Outside' }, { key: 'purpose', label: 'Purpose', get: (p) => PURPOSE[p.purpose] || p.purpose }, { key: 'route', label: 'Route', get: (p) => ROUTE_LABEL[p.route] }],
    href: (p) => ['payment', p.id],
    cmd: (st) => ({ cli: `capxul payment list ${ORG}${st.tab === 3 ? ' --scheduled' : ''}${st.filters?.budget ? ' --from ' + st.filters.budget : ''}${st.filters?.status ? ' --status ' + q(st.filters.status) : ''} --limit 25`, sdk: `client.payments.list({ org: "harbourline"${st.tab === 3 ? ', scheduled: true' : ''}, limit: 25 })`, note: 'Outside money (In) comes from capxul activity list --kind movement.' }),
    pageSize: 20,
  });
  return cx.page({ title: 'Payments', actions: [cx.menu(null, [{ label: 'Export', icon: 'list', cmd: `capxul payment list ${ORG} --json`, onClick: () => cx.toast('Export shows its command. The mock-up makes no downloads.') }, { label: 'Scheduled payments', icon: 'calendar', href: ['scheduled-payments'] }]), cx.btn('Pay a bank account', { icon: 'bank', href: ['pay-by-bank'], cmd: `capxul bank pay contact <amount> ${ORG} --from <budget>` }), cx.btn('Send money', { kind: 'primary', icon: 'send', href: ['send-money'], cmd: `capxul payment send <to> <amount> ${ORG} --from <budget>` })], body: list });
}, { workspace: 'money', title: 'Payments' });

/* =====================================================================================================
   Payment (one), with its proof
   ===================================================================================================== */

function stepsOf(p) {
  const e = escrowOf(p), po = payoutOf(p), dep = depositOf(p);
  const st = (label, at, cls, note) => ({ label, at, cls, note });
  if (p.scheduled) {
    const s = p.scheduled;
    if (s.status === 'Cancelled') return [st('Scheduled', null, 'done', `by ${cx.name(s.scheduledBy)}`), st('Cancelled', null, 'bad', s.outcome || '')];
    return [st('Scheduled', null, 'done', s.proposal ? `Board proposal ${s.proposal}` : `by ${cx.name(s.scheduledBy)}${s.onBehalfOf ? ' for ' + cx.name(s.onBehalfOf) : ''}`), st('Reserved', null, 'done', `in ${cx.deptName(s.budget)}`), st('Due', addDays(s.day, -1) + 'T00:00:00Z', 'now', `${daysBetween(cx.today, s.day)} days to go`), st('Sent', s.day + 'T00:00:00Z', '', 'nobody needs to be online'), st('Settled', null, '', 'on chain')];
  }
  if (p.direction === 'in' && dep) return [st('Bank transfer received', dep.receivedAt, 'done', `${fmt.money(dep.bankAmount, dep.currency)} · ${dep.rail}`), st('Converted by Bridge', dep.creditedAt, 'done', `fees ${fmt.usdc(dep.fees || 0)}`), st('In the Treasury', p.settledAt, 'done', dep.block ? `block ${fmt.int(dep.block)}` : ''), st(dep.match === 'Matched' ? 'Matched' : dep.match, null, dep.match === 'Unmatched' ? 'now' : 'done', (dep.matchedTo || []).join(', ')), st('Booked', null, p.voucher ? 'done' : '', p.voucher || '')];
  if (p.direction === 'in') return [st('Sent by ' + p.counterparty, p.sentAt, 'done', ''), st('On chain', p.settledAt, 'done', p.proof ? `block ${fmt.int(p.proof.block)}` : ''), st('Booked', null, p.voucher ? 'done' : '', p.voucher || '')];
  if (p.status === 'Prepared') return [st('Prepared', p.createdAt, 'done', `by ${cx.name(p.preparedBy)}`), st('Approval', null, 'now', `waits for ${cx.name(p.waitingFor?.who || p.preparedBy)}`), st(po ? 'To Bridge' : 'Sent', null, '', ''), st(po ? 'Delivered to the bank' : 'Settled', null, '', ''), st('Booked', null, '', '')];
  if (p.status === 'Cancelled' && !e) return [st('Prepared', p.createdAt, 'done', `by ${cx.name(p.preparedBy)}`), st('Cancelled', p.settledAt, 'bad', p.outcome || '')];
  if (e) {
    const steps = [st('Prepared', p.createdAt, 'done', `by ${cx.name(p.preparedBy)}`), st('Approved', p.sentAt, 'done', `${cx.name(p.approvedBy)} · ${p.approvedHat} hat`), st('Money waiting', e.fundedAt, e.status === 'Open' ? 'esc' : 'done', `for ${e.email}`)];
    if (e.status === 'Claimed') steps.push(st('Claimed', e.claimedAt, 'done', e.claimBlock ? `block ${fmt.int(e.claimBlock)}` : ''));
    else if (e.status === 'Taken back') steps.push(st('Taken back', e.takenBackAt, 'bad', `by ${cx.name(e.takenBackBy)}`));
    else steps.push(st('Claimed or taken back', null, '', 'no expiry'));
    steps.push(st('Booked', null, p.voucher ? 'done' : '', p.voucher || 'when claimed'));
    return steps;
  }
  const steps = [st('Prepared', p.createdAt, 'done', p.preparedBy ? `by ${cx.name(p.preparedBy)}` : p.route === 'agreement' ? 'by the pay agreement' : ''), st('Approved', p.sentAt, 'done', p.approvedBy ? `${cx.name(p.approvedBy)} · ${p.approvedHat || ''}`.trim() : p.route === 'agreement' ? 'signed once, at the agreement' : '')];
  steps.push(st(po ? 'On chain to Bridge' : 'On chain', p.settledAt, 'done', p.proof ? `block ${fmt.int(p.proof.block)}` : ''));
  if (po) steps.push(st(po.status === 'Delivered' ? 'Delivered' : po.status === 'Refunded' ? 'Returned by the bank' : po.status, po.deliveredAt || po.returnedAt, po.status === 'Delivered' ? 'done' : po.status === 'Refunded' ? 'bad' : 'now', `${fmt.gbp(po.bankAmount)} · ${po.bank.bankName} ·· ${po.bank.last4}`));
  steps.push(st('Booked', null, p.voucher ? 'done' : '', p.voucher || ''));
  return steps;
}
function stepsNode(p) {
  return h('ol.mx-steps', stepsOf(p).map((x) => h('li', { class: x.cls }, h('b', x.label), x.at ? h('span', fmt.datetime(x.at)) : null, x.note ? h('span', x.note) : null)));
}

cx.route('payment', (ctx) => {
  const p = findPayment(ctx.id);
  if (!p) return cx.page({ title: 'Not found', body: cx.empty(`No payment ${ctx.id || ''}`, cx.btn('All payments', { href: ['payments'] })) });
  const e = escrowOf(p), po = payoutOf(p), dep = depositOf(p);
  const title = p.scheduled ? `Scheduled payment to ${p.counterparty}` : e && e.status === 'Open' ? `Money waiting for ${e.email}` : p.direction === 'in' ? (p.kind === 'movement' ? `Outside money from ${p.counterparty}` : `Received from ${p.counterparty}`) : p.direction === 'between' ? `${p.payer?.label || 'Safe'} to ${p.counterparty}` : `Payment to ${p.counterparty}`;
  const allocs = p.proof?.advice?.allocations || [];
  const cmd = `capxul payment get ${p.id} ${ORG}`;
  const acts = [];
  const may = mayAct(p.budget);
  if (p.status === 'Prepared') {
    acts.push(cx.btn('Withdraw', { kind: 'danger', needs: () => p.preparedBy === cx.meId() || `Only ${cx.name(p.preparedBy)}, who prepared it, can withdraw it.`, cmd: `capxul payment cancel ${p.id} ${ORG}`, onClick: () => withdrawPrepared(p) }));
    acts.push(cx.btn('Open approval', { kind: 'primary', icon: 'passkey', cmd: `capxul payment wait approval_${p.id.slice(8, 22)}`, onClick: () => approvePrepared(p) }));
  } else if (p.scheduled && p.status === 'Scheduled') {
    acts.push(cx.btn('Cancel', { kind: 'danger', needs: () => mayAct(p.budget).ok || mayAct(p.budget).reason, cmd: `capxul payment cancel ${p.id} ${ORG}${p.budget === 'board' ? ' --as-directors' : ''}`, onClick: () => cancelScheduled(p.scheduled) }));
    acts.push(cx.btn('Reschedule', { kind: 'primary', icon: 'calendar', needs: () => mayAct(p.budget).ok || mayAct(p.budget).reason, cmd: `capxul payment reschedule ${p.id} --on <day> ${ORG}`, onClick: () => rescheduleScheduled(p.scheduled) }));
  } else if (e && e.status === 'Open') {
    acts.push(cx.menu('More', [{ label: 'Copy what to tell them', icon: 'copy', onClick: () => { cx.copy(claimLine(e)); cx.toast('Copied: ' + claimLine(e)); } }, { label: 'What they see', icon: 'eye', onClick: () => recipientPreview(e) }, { label: 'Resend the email', icon: 'mail', cmd: 'no command yet (a gap the book records)', onClick: () => cx.toast('There is no command to resend the email yet. Capxul sends reminders at 3, 10 and 30 days.', { tone: 'info' }) }]));
    acts.push(cx.btn('Take back', { kind: 'danger', icon: 'swap', needs: () => may.ok || may.reason, cmd: `capxul payment cancel ${p.id} ${ORG}`, onClick: () => takeBack(p) }));
  } else if (p.status === 'Needs retry') {
    acts.push(cx.btn('Retry', { kind: 'primary', needs: () => may.ok || may.reason, cmd: `capxul payment retry ${p.id} ${ORG}`, onClick: () => cx.toast('Retried.', { cmd: `capxul payment retry ${p.id}` }) }));
  }
  if (po && po.status === 'Expired') acts.push(cx.btn('Get a new quote', { kind: 'primary', icon: 'refresh', href: ['pay-by-bank'], cmd: `capxul bank pay contact ${po.bankAmount} ${ORG} --from ${po.from}` }));
  if (p.proof) {
    const v = docRoute(p.voucher);
    acts.unshift(cx.menu('View', [
      { label: 'Verify proof', icon: 'shield', cmd: `capxul document verify --document-hash ${p.proof.documentHash}${allocs[0] ? ' --content-hash ' + allocs[0].content : ''}`, onClick: () => { const b = document.querySelector('.proof-tools .btn.primary'); b?.scrollIntoView({ block: 'center', behavior: 'smooth' }); b?.click(); } },
      { label: 'Save advice as PDF', icon: 'file', cmd: `capxul document render --document-hash ${p.proof.documentHash}`, onClick: () => cx.toast('This is the command Capxul would run. The mock-up makes no downloads.') },
      v && cx.hasRoute(v) ? { label: 'Open in Books', icon: 'books', href: [v, p.voucher], cmd: `capxul org doc get ${v} ${p.voucher}` } : null,
      { label: 'Follow it live', icon: 'clock', cmd: `capxul payment wait ${p.id}`, onClick: () => cx.toast('Settled: nothing more to wait for.', { cmd: `capxul payment wait ${p.id}` }) },
      { label: 'Copy payment ID', icon: 'copy', onClick: () => { cx.copy(p.id); cx.toast('Copied ' + p.id); } },
    ].filter(Boolean)));
  }
  const summary = [
    { label: 'From', value: p.direction === 'in' ? h('span', p.payer?.name || p.counterparty, p.payer?.safe ? h('span.muted', ' · ' + fmt.addr(p.payer.safe)) : null) : h('span', `${p.payer?.label === 'Reserve Safe' ? 'Harbourline Reserve Safe' : 'Harbourline Treasury'} `, h('span.muted.mono', fmt.addr(p.payer?.safe || T.address))) },
    { label: 'Paid from', value: p.budget ? (p.budget === 'board' ? 'the Board (a Board proposal)' : h('a', { href: cx.href(isAllowance(p.budget) ? 'allowance' : 'department', p.budget) }, `${cx.deptName(p.budget)}${isAllowance(p.budget) ? '' : ' budget'}`)) : p.direction === 'in' ? 'received from outside Capxul' : '—' },
    { label: 'Approved by', value: p.proposal ? h('span', 'the Board, by ', cx.link(`proposal ${p.proposal}`, 'proposal', p.proposal)) : p.approvedBy && p.approvedBy !== 'board' ? h('span', cx.personChip(p.approvedBy), h('span.muted', ` wearing the ${p.approvedHat} hat${cx.person(p.approvedBy)?.safe ? ', from ' + (p.approvedBy.startsWith('@') ? 'its' : 'their') + ' Safe ' + fmt.addr(cx.person(p.approvedBy).safe) : ''}`)) : p.route === 'agreement' ? 'signed once, when the pay agreement was accepted' : p.status === 'Prepared' ? h('span.muted', `waiting for ${cx.name(p.waitingFor?.who || p.preparedBy)}`) : '—' },
    { label: 'To', value: p.direction === 'in' ? 'Harbourline Treasury' : h('span', p.counterparty, p.payee?.safe ? h('span.muted.mono', ' · ' + fmt.addr(p.payee.safe)) : p.payee?.email && e ? h('span.muted', ' · ' + p.payee.email) : po ? h('span.muted', ` · ${po.bank.bankName} ·· ${po.bank.last4}`) : null) },
    { label: 'Amount', value: fmt.money(p.amount, p.asset, 2), type: 'usdc' },
    { label: 'In GBP', value: `${fmt.gbp(p.gbp)} at 1 USDC = £${p.rate}` },
    { label: 'Fee', value: p.fee ? `${fmt.usdc(p.fee)} (Bridge${p.direction === 'in' ? ' and Capxul' : ''})` : 'none' },
    { label: 'Booked to', value: p.voucher ? (docRoute(p.voucher) && cx.hasRoute(docRoute(p.voucher)) ? cx.link(p.voucher, docRoute(p.voucher), p.voucher) : p.voucher) : h('span.muted', p.status === 'Settled' ? 'Books post it automatically' : 'when it settles') },
    { label: 'Created', value: p.createdAt ? fmt.datetime(p.createdAt) : null },
    { label: p.scheduled ? 'Pays on' : 'Settled', value: p.scheduled ? `${fmt.date(p.payAt)}, 00:00 UTC` : p.status === 'Prepared' ? null : p.settledAt ? fmt.utc(p.settledAt) : null },
    { label: 'Route', value: ROUTE_LABEL[p.route] || p.route },
    { label: 'Payment ID', value: h('span.mono', { style: 'overflow-wrap:anywhere' }, p.id) },
  ];
  const sections = [{ label: 'Summary', fields: summary.map((f) => ({ ...f, render: () => f.value ?? h('span.faint', '—') })) }];
  if (allocs.length || p.scheduled) {
    sections.push({ label: 'What it pays', node: h('div', { style: 'display:grid;gap:8px' }, allocs.length ? allocs.map((al) => {
      const r = { 'Purchase Invoice': 'purchase-invoice', 'Sales Invoice': 'sales-invoice', 'Salary Slip': 'payslip', 'Expense Claim': 'expense-claim', 'Employee Advance': 'advance' }[al.record];
      return h('div.alloc', h('div.alloc-head', h('span.muted', al.record), r && cx.hasRoute(r) ? cx.link(al.number || al.doc, r, al.doc) : h('b', al.number || al.doc), al.doc !== al.number ? h('span.muted', `(Capxul's ${al.doc})`) : null, al.date ? h('span.muted', fmt.date(al.date)) : null, h('span', { style: 'margin-left:auto' }, 'Allocated ', h('b', fmt.money(al.allocated / 100, al.currency)))),
        h('div.alloc-lines', (al.lines || []).slice(0, 6).map((ln) => h('div.alloc-line', h('span', `${ln.idx} · ${ln.description}`), h('span.num', fmt.money(ln.amount / 100, al.currency), (ln.taxes || []).map((t) => h('span.muted', ` + VAT ${t.bps ? t.bps / 100 : t.rate}% ${fmt.money(t.amount / 100, al.currency)}`)))))));
    }) : h('p.muted', p.memo || 'Nothing named yet.'), p.proof?.advice ? h('div.mx-note', `Adjustments: ${(p.proof.advice.adjustments || []).map((a) => `${a.kind} ${fmt.usdc(Number(a.amount) / 1e6)} (${a.by})`).join(', ') || 'none'} · On account: ${fmt.gbp(p.proof.advice.onAccount || 0)} · Memo: ${p.proof.advice.memo || 'none'}`) : null) });
  }
  if (po) sections.push({ label: 'Bank payout', fields: [
    { label: 'Payout', render: () => cx.link(po.id, 'payout', po.id) }, { label: 'Status', value: po.status, type: 'status' },
    { label: 'Their account', value: `${p.counterparty} · ${po.bank.bankName} · ${po.bank.sortCode} · ending ${po.bank.last4}` }, { label: 'Bank receives', value: fmt.money(po.bankAmount, po.currency) },
    { label: 'Rail', value: po.rail }, { label: 'Reason', value: po.reason },
  ] });
  if (e) sections.push({ label: 'Money waiting', fields: [
    { label: 'For', value: e.email }, { label: 'Status', render: () => cx.pill(e.status === 'Open' ? 'Money waiting' : e.status, e.status === 'Open' ? 'escrow' : e.status === 'Claimed' ? 'green' : 'muted') },
    { label: 'Escrow', render: () => cx.addr(e.escrowAddress) }, { label: 'Waiting since', value: `${fmt.datetime(e.fundedAt)} (${daysBetween(e.fundedAt, e.claimedAt || e.takenBackAt || cx.today)} days)` },
    { label: 'Expires', value: 'Never: it waits until claimed or taken back' }, { label: 'Who can take it back now', value: e.status === 'Open' ? whoMay(e.from) : '—' },
    e.claimedAt ? { label: 'Claimed', value: `${fmt.datetime(e.claimedAt)}${e.claimBlock ? ' · block ' + fmt.int(e.claimBlock) : ''}` } : null,
    e.takenBackAt ? { label: 'Taken back', value: `${fmt.datetime(e.takenBackAt)} by ${cx.name(e.takenBackBy)}` } : null,
  ].filter(Boolean) });
  if (dep) sections.push({ label: 'Bank deposit', fields: [{ label: 'Deposit', render: () => cx.link(dep.id, 'deposit', dep.id) }, { label: 'Sent by', value: dep.from }, { label: 'Bank amount', value: fmt.money(dep.bankAmount, dep.currency) }, { label: 'Reference', value: dep.reference, type: 'mono' }, { label: 'Matched', value: [dep.match, ...(dep.matchedTo || [])].join(' · ') }, { label: 'Bridge deposit ID', value: dep.bridgeId, type: 'mono' }] });
  if (p.batch) sections.push({ label: 'Batch', fields: [{ label: 'Batch', value: p.batch.label }, { label: 'Line', value: `${p.batch.index} of ${p.batch.count}` }, { label: 'Payroll run', render: () => (cx.hasRoute('payroll-run') ? cx.link(p.batch.id.replace('batch_', ''), 'payroll-run', p.batch.id.replace('batch_', '')) : p.batch.id.replace('batch_', '')) }] });
  sections.push({ label: 'Proof', node: cx.proof(p, { none: p.scheduled ? 'No proof yet: a dated payment carries its proof when it pays on its day.' : p.status === 'Prepared' ? 'No proof yet: the payment carries its proof once it is approved and on chain.' : dep ? `No proof on chain: a bank deposit carries no document hash. It matched by its reference ${dep.reference}.` : p.route === 'board' ? 'A move between Harbourline\'s own Safes, by Board proposal: no document to pay.' : undefined }) });
  sections.push({ label: 'Documents', node: h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, p.proof ? [h('span', 'Payment advice (proof)'), cx.btn('Read', { sm: true, cmd: `capxul document get --document-hash ${p.proof.documentHash}`, onClick: () => cx.modal({ title: 'Payment advice', wide: true, body: h('pre.raw', JSON.stringify(p.proof.advice, null, 2)), actions: [{ label: 'Close', primary: true }] }) }), cx.btn('Save as PDF', { sm: true, cmd: `capxul document render --document-hash ${p.proof.documentHash}`, onClick: () => cx.toast('This is the command Capxul would run. The mock-up makes no downloads.') })] : h('span.muted', 'No documents yet.')) });
  const tl = [];
  if (p.createdAt) tl.push({ at: p.createdAt, who: p.preparedBy && !String(p.preparedBy).startsWith('board') ? p.preparedBy : null, kind: 'created', text: p.preparedBy ? 'prepared this payment' : 'Payment created' });
  if (p.approvedBy && p.approvedBy !== 'board' && p.sentAt) tl.push({ at: p.sentAt, who: p.approvedBy, kind: 'approval', text: `approved it with a passkey, wearing the ${p.approvedHat} hat` });
  if (p.proposal) tl.push({ at: p.sentAt || p.createdAt, kind: 'approval', text: `The Board approved proposal ${p.proposal}`, href: ['proposal', p.proposal] });
  if (p.settledAt && p.proof) tl.push({ at: p.settledAt, kind: 'money', text: `On chain at block ${fmt.int(p.proof.block)}`, sub: fmt.hash(p.proof.tx) });
  if (e?.claimedAt) tl.push({ at: e.claimedAt, kind: 'money', text: `Claimed by ${p.counterparty}` });
  if (e?.takenBackAt) tl.push({ at: e.takenBackAt, who: e.takenBackBy, kind: 'cancelled', text: 'took the money back' });
  for (const rm of e?.reminders || []) tl.push({ at: rm.sentAt, kind: 'email', text: `Reminder sent to ${rm.to} (day ${rm.day})` });
  if (po?.deliveredAt) tl.push({ at: po.deliveredAt, kind: 'money', text: `Delivered to ${po.bank.bankName} ·· ${po.bank.last4}` });
  if (po?.returnedAt) tl.push({ at: po.returnedAt, kind: 'cancelled', text: `${po.reason}; ${fmt.usdc(po.refund)} back in the Treasury` });
  if (p.voucher) tl.push({ at: p.settledAt || p.createdAt, kind: 'submitted', text: `Booked as ${p.voucher}` });
  const form = formV({
    doc: p, tabKey: 'payment',
    tabs: [{ label: 'Details', sections }],
    connections: [
      { group: 'Books', items: [{ label: docRoute(p.voucher) === 'journal-entry' ? 'Journal entry' : 'Payment entry', count: p.voucher ? 1 : 0, route: docRoute(p.voucher), id: p.voucher }, { label: 'Purchase invoice', count: allocs.filter((a) => a.record === 'Purchase Invoice').length, route: 'purchase-invoice', id: allocs.find((a) => a.record === 'Purchase Invoice')?.doc }] },
      { group: 'Money', items: [{ label: 'Bank payout', count: po ? 1 : 0, route: 'payout', id: po?.id }, { label: 'Bank deposit', count: dep ? 1 : 0, route: 'deposit', id: dep?.id }, { label: 'Board proposal', count: p.proposal ? 1 : 0, route: 'proposal', id: p.proposal }] },
    ],
    side: { id: p.id, title: p.counterparty, cmd, assigned: [p.preparedBy, p.approvedBy].filter((x) => x && x !== 'board' && cx.person(x)), tags: [PURPOSE[p.purpose] || p.purpose, ROUTE_LABEL[p.route]].filter(Boolean), created: p.createdAt ? { by: p.preparedBy && cx.person(p.preparedBy) ? p.preparedBy : null, at: p.createdAt } : null, modified: { by: p.approvedBy && cx.person(p.approvedBy) ? p.approvedBy : null, at: p.settledAt || p.createdAt } },
    timeline: { items: tl },
  });
  const banner = p.status === 'Prepared' ? cx.banner(h('span', `This waits for ${cx.name(p.waitingFor?.who || p.preparedBy)}'s approval${po ? `; the quote expires at ${fmt.time(po.quoteExpiresAt)}` : ''}. `, cx.meId() === (p.waitingFor?.who || p.preparedBy) ? 'It is yours to approve.' : `Only ${cx.firstName(p.waitingFor?.who || p.preparedBy)} can approve it, from their own Safe.`), { tone: 'warning' })
    : e && e.status === 'Open' ? cx.banner(`Money waiting for ${e.email} since ${fmt.date(e.fundedAt)}. Only their future Safe can claim it. ${whoMay(e.from).replace(/^w/, 'W')} can take it back until then; it never expires.`, { tone: 'escrow' })
      : p.scheduled && p.status === 'Scheduled' ? cx.banner(`${cx.name(p.scheduled.scheduledBy)} scheduled this${p.scheduled.onBehalfOf ? ' for ' + cx.name(p.scheduled.onBehalfOf) : ''}. If someone else wears the ${cx.deptName(p.budget)} hat on the day, it still pays, and they can cancel it.`, { tone: 'info' }) : null;
  return cx.page({
    title, crumbs: [{ label: 'Money', route: 'money' }, { label: 'Payments', route: 'payments' }],
    status: [payPill(p, { lg: true })],
    sub: h('span', cx.amount(signedAmt(p), p.asset, { gbp: p.direction === 'out' ? -p.gbp : p.gbp, sign: true }), ' · ', p.scheduled ? `on ${fmt.date(p.payAt)}` : fmt.datetime(whenOf(p))),
    actions: acts, banner,
    cmd: { cli: cmd, sdk: `client.payments.get("${p.id}")`, json: { id: p.id, status: (p.status || '').toLowerCase().replace(/ /g, '_'), direction: p.direction, counterparty: p.counterparty, amount: String(p.amount), asset: p.asset, budget: p.budget, route: p.route, createdAt: p.createdAt, timing: { settledAt: p.settledAt || null, payAt: p.payAt || null }, proof: p.proof ? { documentHash: p.proof.documentHash, tx: p.proof.tx, block: p.proof.block } : null } },
    fde: `${title} (${p.id})`,
    body: [stepsNode(p), form],
  });
}, { workspace: 'money', title: 'Payment' });

/* =====================================================================================================
   Send money
   ===================================================================================================== */

const KNOWN = (() => {
  const m = new Map();
  for (const p of M.payments) {
    const y = p.payee; if (!y || y.type === 'Self' || !y.name) continue;
    if (y.handle && !m.has(y.handle)) m.set(y.handle, { label: y.name, handle: y.handle, safe: y.safe, party: y.party, email: y.email });
    if (y.email && !m.has(y.email)) m.set(y.email, { label: y.name, handle: y.handle, safe: y.safe, party: y.party, email: y.email });
  }
  return m;
})();
const EXP_ACCOUNTS = (D.books.accounts || []).filter((a) => !a.isGroup && /^[56]\d{3}$/.test(String(a.code || '')));

cx.route('send-money', (ctx) => {
  const st = ctx.state || {};
  const mine = payableBudgets();
  const pi0 = st.pinv ? pinv(st.pinv) : null;
  const model = { to: st.to || '', amount: st.amount ?? (pi0 ? pi0.outstanding : null), asset: 'USDC', from: st.from || mine[0] || (cx.wears('Director') ? 'board' : ''), when: 'now', on: addDays(cx.today, 6), pays: pi0?.name || '', account: '', note: '' };
  if (pi0 && !model.to) { const k = [...KNOWN.values()].find((x) => x.label === pi0.supplierName); model.to = k?.handle || k?.email || ''; }
  const opts = [...mine.map((b) => [b, `${cx.deptName(b)} · ${fmt.usdc(leftOf(b))} left ${periodWord(b)}`]), ...(cx.wears('Director') ? [['board', 'The Treasury, by Board proposal']] : [])];
  const openInv = D.books.purchaseInvoices.filter((x) => x.outstanding > 0);
  const errs = h('div', { style: 'display:grid;gap:4px' });
  const info = h('div');
  const review = h('div');
  const cmdOf = () => {
    const parts = [`capxul payment send ${model.to || '<to>'} ${model.amount || '<amount>'} ${ORG}`];
    if (model.from === 'board') parts.push('--as-directors'); else if (model.from) parts.push(`--from ${model.from}`);
    if (model.asset !== 'USDC') parts.push(`--asset ${model.asset}`);
    if (model.when === 'on') parts.push(`--on ${model.on}`);
    if (model.account) parts.push(`--account ${model.account}`);
    if (model.from === 'board' && model.note) parts.push(`--note ${JSON.stringify(model.note)}`);
    return parts.join(' ');
  };
  const sdkOf = () => `client.payments.pay({ org: "harbourline", to: "${model.to}", amount: "${model.amount ?? ''}", ${model.from === 'board' ? 'asDirectors: true' : `from: "${model.from}"`}${model.when === 'on' ? `, payAt: "${model.on}"` : ''} })`;
  const fill = cx.fill;
  const sync = () => { cx.setCommand({ cli: cmdOf(), sdk: sdkOf(), who: model.from ? whoMay(model.from) : 'a holder of a department or allowance, or the Directors' }); recipientInfo(); fill(review); };
  function recipientInfo() {
    const t = (model.to || '').trim();
    let node = null;
    if (t.startsWith('@')) node = KNOWN.has(t) ? h('div.mx-note', cx.icon('check', { size: 12 }), ` ${KNOWN.get(t).label} · Safe ${fmt.addr(KNOWN.get(t).safe || '')}`) : null;
    else if (t.includes('@')) {
      const k = KNOWN.get(t);
      node = k?.safe ? h('div.mx-note', cx.icon('check', { size: 12 }), ` ${k.label} has a Capxul account · Safe ${fmt.addr(k.safe)}`) : cx.banner('No Capxul account yet: the money will wait for them in escrow until they claim it, and you can take it back until then.', { tone: 'escrow' });
    } else if (/^0x[0-9a-fA-F]{40}$/.test(t)) node = h('div.mx-note', 'A Safe address on Base.');
    fill(info, node);
  }
  function check() {
    const out = [];
    const t = (model.to || '').trim();
    if (!t) out.push(['to', 'Who to pay: an email, an @handle or an address.']);
    else if (t.startsWith('@') && !KNOWN.has(t)) out.push(['to', `INVALID_RECIPIENT · Nobody has the handle ${t}. Check it, or pay an email.`]);
    if (!(model.amount > 0)) out.push(['amount', 'The amount must be more than zero.']);
    if (!model.from) out.push(['from', `ROLE_PERMISSION_DENIED · You don't wear a department's hat or hold an allowance, so you can't pay from a budget. Ask the FDE to draft it for a holder.`]);
    else if (model.from !== 'board') {
      const a = mayAct(model.from);
      if (!a.ok) out.push(['from', `ROLE_PERMISSION_DENIED · ${a.reason}`]);
      else if (model.amount > leftOf(model.from)) out.push(['amount', `PAYROLL_BUDGET_EXCEEDED · ${cx.deptName(model.from)} has ${fmt.usdc(leftOf(model.from))} left ${periodWord(model.from)}.`]);
    }
    if (model.amount > T.available) out.push(['amount', `INSUFFICIENT_BALANCE · The Treasury has ${fmt.usdc(T.available)} available.`]);
    if (model.amount > ceiling().left) out.push(['amount', `The payout ceiling has ${fmt.usdc(ceiling().left)} left this year.`]);
    if (model.when === 'on' && model.on <= cx.today) out.push(['when', 'Pick a day after today.']);
    return out;
  }
  const fieldsEl = h('div.fields', { style: { '--cols': 2 } },
    cx.field({ label: 'To', edit: true, model, key: 'to', reqd: true, placeholder: 'Email, @handle or 0x… address', onChange: sync, help: 'People with no Capxul account are paid into money waiting, which only they can claim.' }),
    cx.field({ label: 'Amount', type: 'usdc', edit: true, model, key: 'amount', reqd: true, onChange: sync }),
    cx.field({ label: 'Asset', type: 'select', edit: true, model, key: 'asset', options: ['USDC', 'EURC'], onChange: sync, help: 'Only what the Treasury holds.' }),
    cx.field({ label: 'Pay from', type: 'select', edit: true, model, key: 'from', reqd: true, options: opts.length ? opts : [['', 'No budget you can pay from']], onChange: sync, help: 'Budgets whose hat (or one above) you wear now.' }),
    cx.field({ label: 'When', type: 'select', edit: true, model, key: 'when', options: [['now', 'Now'], ['on', 'On a day']], onChange: () => { onRow.hidden = model.when !== 'on'; sync(); } }),
    cx.field({ label: 'What it pays', type: 'select', edit: true, model, key: 'pays', options: [['', 'Nothing: add a note'], ...openInv.map((x) => [x.name, `${x.name} · ${x.supplierName} · ${fmt.money(x.outstanding, x.currency)}`])], onChange: (v) => { const x = pinv(v); if (x) { if (!model.amount) model.amount = x.currency === 'GBP' ? r2(x.outstanding / RATE) : x.outstanding; } sync(); } }),
    cx.field({ label: 'Booked to', type: 'select', edit: true, model, key: 'account', options: [['', 'Let Books choose'], ...EXP_ACCOUNTS.map((a) => [a.code, `${a.code} · ${a.name}`])], onChange: sync }),
    cx.field({ label: 'Note for the Directors', edit: true, model, key: 'note', placeholder: 'Only with a Board proposal', onChange: sync }));
  const onRow = cx.field({ label: 'Day', type: 'date', edit: true, model, key: 'on', onChange: sync });
  onRow.hidden = true;
  fieldsEl.appendChild(onRow);
  function doReview() {
    const bad = check();
    fill(errs, bad.map(([, msg]) => h('div.mx-err', cx.icon('alert', { size: 12 }), ' ', msg)));
    if (bad.length) { fill(review); return; }
    const t = model.to.trim();
    const k = KNOWN.get(t);
    const escrow = t.includes('@') && !t.startsWith('@') && !k?.safe;
    const x = pinv(model.pays);
    const gbp = x && x.currency === 'GBP' ? Math.min(x.outstanding, gbpOf(model.amount)) : gbpOf(model.amount);
    const leftAfter = model.from === 'board' ? null : r2(leftOf(model.from) - model.amount);
    fill(review, cx.card({ title: 'Review', body: h('div', { style: 'display:grid;gap:10px' },
      cx.kv([
        ['Pay', `${fmt.usdc(model.amount)} (${fmt.gbp(gbp)})`], ['To', `${k?.label || t}${escrow ? ' · into money waiting' : ''}`],
        ['From', model.from === 'board' ? 'the Treasury, by Board proposal' : `${cx.deptName(model.from)} · ${fmt.usdc(leftOf(model.from))} left ${periodWord(model.from)}; after this, ${fmt.usdc(leftAfter)}`],
        ['When', model.when === 'on' ? `${fmt.date(model.on)}, 00:00 UTC (reserved in the budget from today)` : 'now'],
        ['Payout ceiling', `${fmt.usdc(ceiling().left)} left this year`],
        ['Proof', x ? `This payment will carry a proof that it pays ${x.name} (${x.billNo}), ${fmt.money(x.netTotal, x.currency)} + VAT ${fmt.money(x.totalTaxes || 0, x.currency)}` : 'The proof will carry your note; no document.'],
      ]),
      h('div', cx.btn(model.from === 'board' ? 'Propose to the Board' : 'Send for approval', { kind: 'primary', icon: 'passkey', cmd: cmdOf(), onClick: () => send(escrow, k, x, gbp) }), ' ', cx.btn('Edit', { onClick: () => fill(review) })))}));
    review.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  async function send(escrow, k, x, gbp) {
    const t = model.to.trim();
    const label = k?.label || t;
    if (model.from === 'board') {
      await boardAsk({ title: `Pay ${label} ${fmt.usdc(model.amount)}${model.when === 'on' ? ' on ' + fmt.date(model.on) : ''}`, calls: [`${model.when === 'on' ? 'Budgets.schedule' : 'USDC.transfer'}(${label}, ${model.amount})`], kind: model.when === 'on' ? 'Scheduled payment' : 'Transaction', note: model.note || null, cmd: cmdOf() });
      cx.go('payments');
      return;
    }
    const id = cx.newId('payment');
    const r = await cx.approval({ title: `Pay ${label}`, from: `Harbourline Treasury · ${fmt.addr(T.address)} · ${cx.deptName(model.from)}${isAllowance(model.from) ? '' : ' budget'}`, to: `${label}${k?.safe ? ' · ' + fmt.addr(k.safe) : escrow ? ' · money waiting' : ''}`, amount: model.amount, gbp, rate: RATE, warnings: [escrow ? `${t} has no Capxul account: the money waits in escrow until they claim it.` : null, t.startsWith('0x') ? 'The address is new to you' : null].filter(Boolean), signer: cx.meId(), hat: hatFor(model.from), deadline: model.when === 'on' ? `Sent on ${fmt.date(model.on)} (send_after)` : null, cmd: cmdOf(), next: `capxul payment wait ${id}` });
    if (r.status !== 'done') return;
    const p = { id, direction: 'out', kind: 'payment', status: 'Prepared', outcome: null, purpose: x ? 'supplier' : 'transfer', route: escrow ? 'money-waiting' : isAllowance(model.from) ? 'allowance' : 'department', budget: model.from, counterparty: label, payee: { type: x ? 'Supplier' : 'Other', name: label, handle: k?.handle || null, safe: k?.safe || null, party: k?.party || null, email: k?.email || (t.includes('@') && !t.startsWith('@') ? t : null), mailbox: escrow ? t : undefined, bank: null }, payer: { type: 'Self', name: D.company.name, safe: T.address, label: 'Treasury' }, amount: model.amount, asset: model.asset, amountRaw: String(Math.round(model.amount * 1e6)), gbp, rate: RATE, fee: 0, createdAt: r.at, preparedBy: cx.meId(), proposal: null, batch: null, memo: x?.billNo || model.note || null, account: model.account || null, proof: null, books: null, voucher: null };
    if (model.when === 'on') {
      const s = { day: model.on, to: label, amount: model.amount, asset: model.asset, budget: model.from, scheduledBy: cx.meId(), proposal: null, what: x ? `${x.name} (${x.billNo})` : model.note || 'Dated payment', status: 'Scheduled', reserved: true, payment: id, createdAt: r.at };
      M.scheduled.push(s); M.scheduled.sort((a, b) => a.day.localeCompare(b.day));
      T.reserved = r2(T.reserved + model.amount); T.available = r2(T.balance - T.reserved);
      if (!isAllowance(model.from)) { const b = cx.budgetOn(model.from); if (b) { b.committed = r2(b.committed + model.amount); b.left = r2(b.left - model.amount); } }
      addEvent(`${cx.name(cx.meId())} scheduled ${fmt.usdc(model.amount)} to ${label} on ${fmt.date(model.on)}`, { type: 'payment', id });
      cx.toast(`Scheduled for ${fmt.date(model.on)}. ${fmt.usdc(model.amount)} is reserved in ${cx.deptName(model.from)}.`, { tone: 'success', cmd: cmdOf() });
      cx.go('payment', id);
      return;
    }
    M.payments.push(p);
    await settleOut(p, r, { allocations: x ? [allocOf(x, x.currency === 'GBP' ? gbp : model.amount)] : [], escrow, desc: escrow ? `To money waiting for ${t}` : label });
    if (escrow) {
      const eid = 'escrow_' + id.slice(8);
      const addr = cx.randHex(20);
      M.escrows.push({ id: eid, payment: id, email: t, amount: model.amount, from: model.from, sentBy: cx.meId(), fundedAt: r.at, escrowAddress: addr, status: 'Open', claimedAt: null, takenBackAt: null, takenBackBy: null, reminders: [], what: x ? `Purchase Invoice ${x.name}` : model.note || 'Payment' });
      p.escrow = eid;
      MW.balance = r2(MW.balance + model.amount); MW.open += 1;
      pushTable('money.statements.moneyWaiting', { time: r.at, block: r.block, tx: r.tx, logIndex: 50 + tick, direction: 'in', amount: model.amount, balanceAfter: MW.balance, description: `Money waiting for ${t}`, reference: id });
      D.approvals.waiting.push({ kind: 'Money', what: `Money uncollected: ${t}, ${fmt.usdc(model.amount)} from ${cx.deptName(model.from)}, 0 days`, amount: fmt.usdc(model.amount), openedBy: cx.meId(), openedAt: r.at, waitsFor: [...new Set([model.from, ...cx.ancestors(model.from)].flatMap((d) => cx.holders(d)))], because: `wears the ${cx.deptName(model.from)} hat or one above`, action: 'Take back', ref: { type: 'payment', id }, command: `capxul payment cancel ${id} ${ORG}` });
    } else if (x) payInvoice(x, x.currency === 'GBP' ? gbp : model.amount, p);
    addEvent(`${cx.name(cx.meId())} paid ${label} ${fmt.usdc(model.amount)} from ${cx.deptName(model.from)}${escrow ? ' (money waiting)' : ''}`, { type: 'payment', id });
    cx.toast(escrow ? `${fmt.usdc(model.amount)} waits for ${t}. Capxul emailed them.` : `Paid ${label} ${fmt.usdc(model.amount)}.`, { tone: 'success', cmd: `capxul payment get ${id} ${ORG}` });
    cx.go('payment', id);
  }
  const body = h('div.mx-form',
    !opts.length ? cx.banner(`${cx.me().name} wears no department's hat and holds no allowance, so ${cx.me().firstName || 'they'} can't pay from a budget. The FDE can draft a payment for someone who can.`, { tone: 'warning', action: cx.btn('Ask the FDE', { sm: true, icon: 'fde', onClick: () => cx.fde.open({ ask: 'Draft a payment for whoever can pay it' }) }) }) : null,
    cx.card({ body: h('div', { style: 'display:grid;gap:12px' }, fieldsEl, info, errs, h('div', cx.btn('Review', { kind: 'primary', onClick: doReview }), ' ', cx.btn('Cancel', { href: ['payments'] }))) }),
    review);
  setTimeout(sync, 0);
  return cx.page({ title: 'Send money', crumbs: [{ label: 'Money', route: 'money' }, { label: 'Payments', route: 'payments' }], status: [cx.pill('New', 'gray', { lg: true })], cmd: { cli: cmdOf(), sdk: sdkOf() }, fde: 'Send money (a new payment)', body });
}, { workspace: 'money', title: 'Send money' });

/* =====================================================================================================
   Scheduled payments
   ===================================================================================================== */

cx.route('scheduled-payments', () => {
  const items = M.scheduled;
  const open = items.filter((s) => s.status === 'Scheduled');
  const days = [];
  for (let i = 0; i < 60; i++) days.push(addDays(cx.today, i));
  const cal = h('div.mx-cal', days.map((d) => {
    const on = open.filter((s) => s.day === d);
    const wk = [0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay());
    return h('div', { class: { has: on.length, wk, today: d === cx.today }, title: on.length ? on.map((s) => `${fmt.usdc(s.amount)} to ${s.to}`).join('\n') : fmt.date(d), onclick: on.length ? () => cx.go('payment', schedRec(on[0]).id) : null }, h('small', fmt.weekday(d).slice(0, 2)), h('span', String(Number(d.slice(8)))), h('i'));
  }));
  const rows = items.map((s) => {
    const p = schedRec(s);
    const a = mayAct(s.budget);
    const short = s.status === 'Scheduled' && !isAllowance(s.budget) && s.budget !== 'board' && cx.budgetOn(s.budget, s.day) && false;
    return h('tr.click', { onclick: (ev) => { if (!ev.target.closest('.menu-wrap,.btn,a')) cx.go('payment', p.id); } },
      h('td', h('b', fmt.date(s.day)), h('div.muted', { style: 'font-size:12px' }, `${daysBetween(cx.today, s.day)} days`)),
      h('td.wrap', h('a', { href: cx.href('payment', p.id) }, s.to), h('div.muted', { style: 'font-size:12px' }, s.what)),
      h('td.num', fmt.usdc(s.amount), h('div.muted', { style: 'font-size:12px' }, fmt.gbp(gbpOf(s.amount)))),
      h('td', s.budget === 'board' ? 'Board (Treasury)' : cx.deptName(s.budget)),
      h('td.opt', s.reserved ? 'yes' : 'no'),
      h('td', cx.pill(s.status === 'Scheduled' && daysBetween(cx.today, s.day) <= 1 ? 'Due' : s.status, s.status === 'Cancelled' ? 'muted' : 'blue')),
      h('td.opt', short ? cx.pill('Budget exhausted', 'red') : h('span.faint', '—')),
      h('td.opt', s.proposal ? cx.link(`Board proposal ${s.proposal}`, 'proposal', s.proposal) : s.scheduledBy === 'agreement' ? 'the pay agreement' : h('span', cx.name(s.scheduledBy), s.onBehalfOf ? h('span.muted', ` for ${cx.name(s.onBehalfOf)}`) : null)),
      h('td', s.status === 'Scheduled' && !s.agreement ? cx.menu(null, [
        { label: 'Reschedule', icon: 'calendar', needs: () => a.ok || a.reason, cmd: `capxul payment reschedule ${p.id} --on <day> ${ORG}${s.budget === 'board' ? ' --as-directors' : ''}`, onClick: () => rescheduleScheduled(s) },
        { label: 'Cancel', icon: 'x', danger: true, needs: () => a.ok || a.reason, cmd: `capxul payment cancel ${p.id} ${ORG}${s.budget === 'board' ? ' --as-directors' : ''}`, onClick: () => cancelScheduled(s) },
        { divider: true }, { note: whoMay(s.budget).replace(/^w/, 'W') },
      ]) : s.agreement ? h('span.muted', { style: 'font-size:12px', title: 'An agreement collects each month; end it from Payroll' }, 'agreement') : null));
  });
  return cx.page({
    title: 'Scheduled payments', crumbs: [{ label: 'Money', route: 'money' }],
    actions: [cx.btn('Schedule a payment', { kind: 'primary', icon: 'calendar', href: ['send-money'], cmd: `capxul payment send <to> <amount> ${ORG} --from <budget> --on <day>` })],
    cmd: { cli: `capxul payment list ${ORG} --scheduled`, sdk: 'client.payments.list({ org: "harbourline", scheduled: true })' },
    banner: cx.banner(`${fmt.usdc(T.reserved)} of the Treasury is reserved for ${open.filter((s) => s.reserved).length} dated payments. Each was signed when it was scheduled: on the day, Capxul asks the budget to pay it, and nobody needs to be online. Whoever wears the budget's hat on the day can still cancel it.`, { tone: 'info' }),
    body: [
      cx.card({ title: 'The next 60 days', body: cal }),
      cx.card({ flush: true, body: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Day'), h('th', 'To'), h('th.num', 'Amount'), h('th', 'From'), h('th.opt', 'Reserved'), h('th', 'Status'), h('th.opt', 'Shortfall'), h('th.opt', 'Scheduled by'), h('th', ''))), h('tbody', rows))) }),
    ],
  });
}, { workspace: 'money', title: 'Scheduled payments' });

/* =====================================================================================================
   Money waiting
   ===================================================================================================== */

function escrowCard(e) {
  const p = M.payments.find((x) => x.id === e.payment);
  const a = mayAct(e.from);
  const days = daysBetween(e.fundedAt, e.claimedAt || e.takenBackAt || cx.today);
  const next = [3, 10, 30].find((d) => !(e.reminders || []).some((r) => r.day === d));
  const pi = /ACC-PINV-\S+/.exec(e.what || '')?.[0];
  const slip = /Sal Slip\/\S+/.exec(e.what || '')?.[0];
  const what = pi ? h('span', cx.hasRoute('purchase-invoice') ? cx.link(pi, 'purchase-invoice', pi) : pi, pinv(pi) ? h('span.muted', ` · ${pinv(pi).items?.[0]?.description || ''}`) : null) : slip ? h('span', 'October pay · ', cx.hasRoute('payslip') ? cx.link(slip, 'payslip', slip) : slip) : e.what;
  const rem = [3, 10, 30].map((d) => { const r = (e.reminders || []).find((x) => x.day === d); return r ? `Sent ${fmt.day(r.sentAt)} (${d} days)` : `${e.status === 'Open' ? 'next' : 'not sent'} ${fmt.day(addDays(e.fundedAt, d))} (${d} days)`; }).join(' · ');
  return cx.card({
    title: h('span', e.email, ' ', cx.pill(e.status === 'Open' ? 'Money waiting' : e.status, e.status === 'Open' ? 'escrow' : e.status === 'Claimed' ? 'green' : 'muted')),
    actions: h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' }, e.status === 'Open' ? [
      cx.btn('What they see', { sm: true, icon: 'eye', onClick: () => recipientPreview(e) }),
      cx.btn('Copy what to tell them', { sm: true, icon: 'copy', onClick: () => { cx.copy(claimLine(e)); cx.toast('Copied: ' + claimLine(e)); } }),
      cx.btn('Take back', { sm: true, kind: 'danger', needs: () => a.ok || a.reason, cmd: `capxul payment cancel ${e.payment} ${ORG}`, onClick: () => takeBack(p) }),
    ] : [cx.btn('Open', { sm: true, href: ['payment', e.payment] })]),
    body: cx.kv([
      ['For', h('span', e.email, p && p.counterparty !== e.email ? h('span.muted', ` · ${p.counterparty}`) : null)],
      ['Amount', fmt.both(e.amount, gbpOf(e.amount, p?.rate || RATE))],
      ['From', h('span', `${cx.deptName(e.from)} budget, sent by `, cx.personChip(e.sentBy))],
      ['What it pays', what],
      ['Waiting since', `${fmt.datetime(e.fundedAt)} (${days} days)`],
      e.status === 'Open' ? ['Reminders', h('span', rem, next === 10 ? h('span.muted', `; at 10 days ${cx.deptName(e.from)}'s holders are told it is uncollected`) : null)] : null,
      ['Escrow', h('span', cx.addr(e.escrowAddress), ` (on chain, ${e.status === 'Open' ? 'open' : e.status.toLowerCase()})`)],
      e.status === 'Open' ? ['Who can take it back now', whoMay(e.from)] : null,
      e.status === 'Open' ? ['Expires', 'Never: it waits until claimed or taken back'] : null,
      e.claimedAt ? ['Claimed', `${fmt.datetime(e.claimedAt)}${e.claimBlock ? ` · block ${fmt.int(e.claimBlock)}` : ''}${e.email.startsWith('hannah') ? ', when she set up her account' : ''}`] : null,
      e.takenBackAt ? ['Taken back', `${fmt.datetime(e.takenBackAt)} by ${cx.name(e.takenBackBy)}; the money returned to the Treasury and ${cx.deptName(e.from)}'s room stayed spent`] : null,
      ['Payment', cx.link(e.payment, 'payment', e.payment)],
    ]),
  });
}
cx.route('money-waiting', () => {
  const by = (s) => M.escrows.filter((e) => e.status === s).sort((a, b) => b.fundedAt.localeCompare(a.fundedAt));
  const tab = (label, s, empty) => ({ label, count: by(s).length, render: () => h('div.mx-esc', { style: 'padding-top:12px' }, by(s).length ? by(s).map(escrowCard) : cx.empty(empty)) });
  return cx.page({
    title: 'Money waiting', crumbs: [{ label: 'Money', route: 'money' }],
    sub: `${fmt.usdc(MW.balance)} in ${fmt.plural(MW.open, 'escrow')} · ${fmt.gbp(gbpOf(MW.balance))}`,
    actions: [cx.btn('Money waiting for you', { icon: 'user', href: ['your-money'], cmd: 'capxul payment claim' }), cx.btn('Pay someone by email', { kind: 'primary', icon: 'send', href: ['send-money'], cmd: `capxul payment send <email> <amount> ${ORG} --from <budget>` })],
    cmd: { cli: `capxul payment list ${ORG} --status escrowed`, sdk: 'client.payments.list({ org: "harbourline", status: "escrowed" })', note: 'Take back: capxul payment cancel <payment> · client.payments.cancel(id)' },
    banner: cx.banner('Money Harbourline sent to someone with no Capxul account yet. It is held on chain in an escrow only their future Safe can claim, and whoever wears the funding budget\'s hat (or one above it), or the Board, can take it back until then. It never expires.', { tone: 'escrow' }),
    body: tabsV([tab('Waiting', 'Open', 'Nothing is waiting to be claimed.'), tab('Claimed', 'Claimed', 'Nothing claimed yet.'), tab('Taken back', 'Taken back', 'Nothing taken back.')], { key: 'money-waiting' }),
  });
}, { workspace: 'money', title: 'Money waiting' });

/* =====================================================================================================
   Your money (acting as yourself, and people with no seat)
   ===================================================================================================== */

function yourMoneyPage() {
  const meP = cx.me();
  const mails = [meP.personalEmail, meP.payMailbox, meP.companyEmail, meP.email].filter(Boolean);
  const mineIn = M.payments.filter((p) => p.payee?.id === meP.id || (p.payee?.safe && p.payee.safe === meP.safe)).sort((a, b) => String(whenOf(b)).localeCompare(String(whenOf(a))));
  const waiting = M.escrows.filter((e) => mails.includes(e.email));
  const open = waiting.filter((e) => e.status === 'Open');
  const year = cx.today.slice(0, 4);
  const thisYear = mineIn.filter((p) => String(whenOf(p)).startsWith(year) && p.status !== 'Cancelled');
  const claim = async () => {
    if (!open.length) { cx.toast('Nothing is waiting for you.', { tone: 'info', cmd: 'capxul payment claim' }); return; }
    const total = open.reduce((s, e) => s + e.amount, 0);
    const r = await cx.approval({ title: `Claim ${fmt.usdc(total)}`, from: 'Money waiting', to: `Your Safe ${fmt.addr(meP.safe || '')}`, amount: total, gbp: gbpOf(total), rate: RATE, signer: meP.id, cmd: 'capxul payment claim' });
    if (r.status !== 'done') return;
    for (const e of open) { e.status = 'Claimed'; e.claimedAt = r.at; e.claimTx = r.tx; e.claimBlock = r.block; const p = M.payments.find((x) => x.id === e.payment); if (p) { p.status = 'Settled'; p.outcome = 'Claimed'; p.settledAt = r.at; } MW.balance = r2(MW.balance - e.amount); MW.open -= 1; }
    cx.toast('Claimed into your Safe.', { tone: 'success', cmd: 'capxul payment claim' }); cx.refresh();
  };
  return cx.page({
    title: 'Your money', crumbs: [], status: [cx.pill('Acting as yourself', 'gray', { lg: true })],
    sub: meP.safe ? h('span', 'Your Safe ', cx.addr(meP.safe), ' · Base') : 'No Safe yet',
    actions: [cx.btn(open.length > 1 ? 'Claim all' : 'Claim', { kind: 'primary', icon: 'passkey', cmd: 'capxul payment claim', onClick: claim, disabled: !open.length, reason: 'Nothing is waiting for you.' })],
    cmd: { cli: ['capxul use personal', 'capxul balance', 'capxul payment list --limit 25'], note: 'Your own records span every Organization; capxul payment claim takes no ID.' },
    body: [
      h('div.ncards',
        cx.numberCard({ label: `Paid to you in ${year}`, value: fmt.usdc(thisYear.reduce((s, p) => s + p.amount, 0)), sub: `${thisYear.length} payments from ${D.company.short}` }),
        cx.numberCard({ label: 'Money waiting for you', value: fmt.usdc(open.reduce((s, e) => s + e.amount, 0)), sub: open.length ? `${open.length} to claim` : 'nothing to claim' }),
        cx.numberCard({ label: 'Your Safe', value: meP.safe ? fmt.addr(meP.safe) : 'none', sub: meP.seat ? 'with a seat at Harbourline' : 'no seat: your own records only' })),
      cx.card({ title: 'Money waiting for you', cmd: 'capxul payment claim', body: waiting.length ? h('div', { style: 'display:grid;gap:8px' }, waiting.map((e) => h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center' }, h('b', fmt.usdc(e.amount)), h('span', `from ${D.company.name}`), h('span.muted', `waiting from ${fmt.datetime(e.fundedAt)}`), e.status === 'Claimed' ? cx.pill(`Claimed ${fmt.datetime(e.claimedAt)}`, 'green') : e.status === 'Taken back' ? cx.pill(`${D.company.short} took this back on ${fmt.date(e.takenBackAt)}`, 'muted') : cx.btn('Claim', { sm: true, kind: 'primary', cmd: 'capxul payment claim', onClick: claim })))) : cx.empty('Nothing is waiting for you.') }),
      cx.card({ title: 'Paid to you', flush: true, cmd: 'capxul payment list --limit 25', body: mineIn.length ? h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Date'), h('th', 'What'), h('th', 'Status'), h('th.num', 'Amount'))), h('tbody', mineIn.slice(0, 24).map((p) => h('tr.click', { onclick: () => (cx.hasSeat() ? cx.go('payment', p.id) : cx.toast('Your payslips show each payment and its proof.', { tone: 'info' })) }, h('td', fmt.date(whenOf(p))), h('td.wrap', p.batch?.label || PURPOSE[p.purpose] || p.memo || ''), h('td', payPill(p)), h('td.num', fmt.usdc(p.amount))))))) : cx.empty('No payments to you yet.') }),
    ],
  });
}
cx.route('your-money', () => yourMoneyPage(), { workspace: 'yours', title: 'Your money' });

/* =====================================================================================================
   Bank: details, deposits, payouts, saved accounts, verification
   ===================================================================================================== */

const DEP_TONE = { Processing: 'blue', Arriving: 'blue', Credited: 'green', 'Below minimum': 'muted', Returned: 'muted' };
const PO_TONE = { Quoted: 'gray', 'In transit': 'blue', Delivered: 'green', Returning: 'orange', Refunded: 'muted', Expired: 'muted', 'Needs attention': 'red' };
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bLtd\b/i, 'Ltd');
const depFrom = (d) => d.payer?.name && !/^\(/.test(d.payer.name) ? d.payer.name : d.from;

function depositsList() {
  return cx.listView({
    key: 'bank-deposits', rows: () => [...M.deposits].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)), id: (d) => d.id, noun: 'deposit',
    titleCol: { key: 'from', label: 'From', get: (d) => depFrom(d), sub: (d) => `${d.reference} · ${d.rail}` },
    status: (d) => ({ text: d.status, tone: DEP_TONE[d.status] }),
    columns: [
      { key: 'receivedAt', label: 'Received', type: 'datetime' },
      { key: 'bankAmount', label: 'Bank amount', render: (d) => fmt.money(d.bankAmount, d.currency) },
      { key: 'fees', label: 'Fees', render: (d) => (d.fees != null ? fmt.usdc(d.fees) : h('span.faint', '—')) },
      { key: 'match', label: 'Matched to', render: (d) => (d.match === 'Unmatched' ? cx.pill('Unmatched', 'orange') : (d.matchedTo || []).length ? h('span', (d.matchedTo || []).join(', ')) : h('span.muted', d.match)) },
    ],
    right: { key: 'net', label: 'Net', render: (d) => (d.net != null ? fmt.usdc(d.net) : h('span.faint', '—')) },
    filters: [{ key: 'from', label: 'From', get: (d) => depFrom(d) }, { key: 'currency', label: 'Currency', type: 'select', options: ['GBP', 'USD', 'EUR'] }, { key: 'status', label: 'Status', type: 'select' }, { key: 'receivedAt', label: 'Month', type: 'month' }],
    tabs: [{ label: 'All' }, { label: 'Unmatched', filter: (d) => d.match === 'Unmatched' }, { label: 'Arriving', filter: (d) => d.status === 'Arriving' }, { label: 'Not credited', filter: (d) => ['Returned', 'Below minimum'].includes(d.status) }],
    sort: { options: [{ key: 'receivedAt', label: 'Received' }, { key: 'bankAmount', label: 'Bank amount' }], default: { key: 'receivedAt', dir: 'desc' } },
    groupBy: [{ key: 'currency', label: 'Currency' }, { key: 'match', label: 'Match' }],
    href: (d) => ['deposit', d.id],
    cmd: (st) => ({ cli: `capxul bank deposits ${ORG}${st.tab === 1 ? ' --unmatched' : ''}`, sdk: `client.banking.deposits.list({ org: "harbourline"${st.tab === 1 ? ', unmatched: true' : ''} })` }),
  });
}
function payoutsList() {
  return cx.listView({
    key: 'bank-payouts', rows: () => [...M.payouts].sort((a, b) => b.quotedAt.localeCompare(a.quotedAt)), id: (x) => x.id, noun: 'payout',
    titleCol: { key: 'to', label: 'To', sub: (x) => `${x.bank.bankName} ·· ${x.bank.last4} · ${x.rail}` },
    status: (x) => ({ text: x.status, tone: PO_TONE[x.status] }),
    columns: [
      { key: 'quotedAt', label: 'Date', type: 'datetime' },
      { key: 'sent', label: 'Sent', type: 'usdc', get: (x) => (x.status === 'Expired' || x.status === 'Quoted' ? null : x.sent) },
      { key: 'fee', label: 'Fee', type: 'usdc' },
      { key: 'from', label: 'From', get: (x) => cx.deptName(x.from) },
      { key: 'purpose', label: 'For', get: (x) => PURPOSE[x.purpose] || x.purpose },
      { key: 'reason', label: 'Reason' },
    ],
    right: { key: 'bankAmount', label: 'Bank amount', render: (x) => fmt.money(x.bankAmount, x.currency) },
    filters: [{ key: 'to', label: 'To' }, { key: 'status', label: 'Status', type: 'select' }, { key: 'from', label: 'From', type: 'select', options: [['', 'Any'], ...D.departments.map((d) => [d.id, d.name])] }, { key: 'quotedAt', label: 'Month', type: 'month' }],
    tabs: [{ label: 'All' }, { label: 'In transit', filter: (x) => ['Quoted', 'In transit', 'Returning'].includes(x.status) }, { label: 'Suppliers', filter: (x) => x.purpose === 'supplier' }, { label: 'Payroll', filter: (x) => x.purpose === 'payroll' }, { label: 'Not delivered', filter: (x) => ['Refunded', 'Expired', 'Needs attention'].includes(x.status) }],
    sort: { options: [{ key: 'quotedAt', label: 'Date' }, { key: 'bankAmount', label: 'Bank amount' }], default: { key: 'quotedAt', dir: 'desc' } },
    groupBy: [{ key: 'status', label: 'Status' }, { key: 'purpose', label: 'For', get: (x) => PURPOSE[x.purpose] }],
    href: (x) => ['payout', x.id],
    cmd: { cli: `capxul payment list ${ORG} --kind bank_payout`, note: 'No booked command lists payouts on their own (a gap); payouts are read through payment list.' },
  });
}
function savedAccounts() {
  const canSave = { any: ['Books', 'Director', { dept: 'operations' }] };
  return h('div', { style: 'display:grid;gap:12px;padding-top:12px' },
    cx.card({ title: 'Saved bank accounts', cmd: `capxul bank accounts ${ORG}`, actions: cx.btn('Save a bank account', { sm: true, kind: 'primary', icon: 'plus', needs: canSave, cmd: `capxul bank accounts add ${ORG} --currency GBP`, onClick: saveAccount }), flush: true, body: h('div.tbl-scroll', h('table.tbl',
      h('thead', h('tr', h('th', 'Holder'), h('th', 'Bank'), h('th', 'Last four'), h('th.opt', 'Currency'), h('th', 'For'), h('th', 'State'), h('th.opt', 'Saved by'), h('th.opt', 'ID'), h('th', ''))),
      h('tbody', M.savedBankAccounts.map((a) => h('tr', h('td.wrap', h('b', a.holder)), h('td', a.bank), h('td.mono', a.last4), h('td.opt', a.currency), h('td', a.for), h('td', cx.pill(a.state.split(' (')[0], /Inactive|Removed/.test(a.state) ? 'muted' : 'green'), /\(/.test(a.state) ? h('div.muted', { style: 'font-size:12px' }, a.state.replace(/^.*\(/, '(')) : null), h('td.opt', cx.name(a.savedBy)), h('td.opt.mono', { style: 'font-size:12px' }, a.id),
        h('td', a.state === 'Active' ? cx.menu(null, [{ label: 'Pay this account', icon: 'send', onClick: () => cx.go('pay-by-bank', null, { account: a.id }) }, { label: 'Remove', icon: 'trash', danger: true, needs: canSave, cmd: `capxul bank accounts remove ${a.id}`, onClick: async () => { if (await cx.confirm({ title: `Remove ${a.holder}'s ${a.bank} account ending ${a.last4}?`, body: 'Payouts already sent are not affected. You can save it again later.', cmd: `capxul bank accounts remove ${a.id}`, danger: true, confirmLabel: 'Remove' })) { a.state = 'Removed'; cx.toast('Removed', { cmd: `capxul bank accounts remove ${a.id}` }); cx.refresh(); } } }]) : null)))))) }),
    cx.card({ title: 'Other accounts Harbourline keeps', cmd: 'capxul org doc get bank-account "Barclays Business"', body: (() => { const b = barclays(); return b ? h('div', { style: 'display:grid;gap:8px' }, h('div', h('b', 'Barclays Business · GBP'), h('span.muted', ` · sort code ${b.sortCode} · ending ${b.last4}`)), cx.kv([['Balance per Books', fmt.gbp(b.balance)], ['Statement', `to ${fmt.date(b.statementTo)}, ${fmt.gbp(b.statementBalance)}`], ['To reconcile', `${b.toReconcile} lines`]]), h('p.mx-note', b.note), h('p.mx-note', 'Moving money between the Treasury and Barclays is a bank payout to "Yourself" one way, and a bank transfer into the GBP bank details the other.'), h('div', cx.btn('Reconcile in Books', { icon: 'books', href: cx.hasRoute('bank-account') ? ['bank-account', b.name] : cx.hasRoute('banking') ? ['banking'] : null, onClick: cx.hasRoute('bank-account') || cx.hasRoute('banking') ? null : () => cx.toast('Books is not part of this view.') }))) : cx.empty('No other accounts.'); })() }));
}
function saveAccount() {
  const model = { holder: '', bank: '', sortCode: '', account: '', currency: 'GBP', for: 'Supplier' };
  const err = h('div.mx-err');
  cx.modal({ title: 'Save a bank account', body: h('div', { style: 'display:grid;gap:10px' },
    h('div.fields', { style: { '--cols': 2 } },
      cx.field({ label: 'Account holder', edit: true, model, key: 'holder', reqd: true }), cx.field({ label: 'Bank', edit: true, model, key: 'bank' }),
      cx.field({ label: 'Currency', type: 'select', edit: true, model, key: 'currency', options: ['GBP', 'EUR', 'USD'] }), cx.field({ label: 'For', type: 'select', edit: true, model, key: 'for', options: ['Supplier', 'Payee (salary)', 'Yourself'] }),
      cx.field({ label: 'Sort code', edit: true, model, key: 'sortCode', placeholder: '00-00-00' }), cx.field({ label: 'Account number', edit: true, model, key: 'account', placeholder: '8 digits, typed hidden' })), err,
    h('p.mx-note', 'Capxul keeps the numbers with Bridge; screens show only the last four.')),
  actions: [{ label: 'Back' }, { label: 'Save', primary: true, cmd: `capxul bank accounts add ${ORG} --currency ${model.currency}`, onClick: (close) => {
    if (!model.holder || !/^\d{6,8}$/.test(String(model.account).replace(/\s/g, ''))) { err.textContent = 'An account holder and an account number (6 to 8 digits) are needed.'; return; }
    const id = 'bacc_' + cx.slug(model.holder).toLowerCase().slice(0, 18);
    M.savedBankAccounts.push({ holder: model.holder, bank: model.bank || 'Bank', last4: String(model.account).slice(-4), currency: model.currency, for: model.for, state: 'Active', savedBy: cx.meId(), id });
    close(); cx.toast(`Saved ${model.holder}'s account ending ${String(model.account).slice(-4)}.`, { tone: 'success', cmd: `capxul bank accounts add ${ORG} --currency ${model.currency}` }); cx.refresh();
  } }] });
}
function bankDetailsTab() {
  const reveal = new Set();
  const full = { GBP: 'Sort code 04-06-05 · Account 21486630', USD: 'Routing 101019644 · Account 900017731 (Lead Bank)', EUR: 'IBAN DE89 3704 0044 0532 0144 10 · BIC LEADDEFF' };
  const box = h('div', { style: 'display:grid;gap:12px;padding-top:12px' });
  const draw = () => cx.fill(box,
    h('div.mx-two', M.bankDetails.map((b) => cx.card({ title: h('span', `${b.currency} · ${b.bank}`, ' ', cx.pill(b.state, 'green')), cmd: `capxul bank details ${ORG} --currency ${b.currency}`, body: h('div', { style: 'display:grid;gap:10px' },
      cx.kv([['Payee', b.payee], ['Account', reveal.has(b.currency) ? h('b.mono', full[b.currency]) : b.account.replace(/\d(?=\d{0,}(,|$))/g, (d) => d).replace(/sort code \d\d-\d\d-\d\d/, 'sort code •• •• ••')], ['Rails', b.rails.join(', ')], ['Minimum', fmt.money(b.minimum, b.currency)], ['Capxul fee', b.fee], ['Becomes', b.becomes]]),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        cx.btn(reveal.has(b.currency) ? 'Hide' : 'Show full details', { sm: true, icon: 'eye', needs: { any: ['Books', 'Invoicing', 'Director'] }, cmd: `capxul bank details ${ORG} --currency ${b.currency}`, onClick: () => { reveal.has(b.currency) ? reveal.delete(b.currency) : reveal.add(b.currency); draw(); } }),
        cx.btn('Change what it becomes', { sm: true, needs: 'Books', cmd: `capxul bank settle ${b.currency} --to EURC`, onClick: async () => { if (await cx.confirm({ title: `Settle ${b.currency} deposits as EURC instead of USDC?`, body: 'New deposits land in the Treasury as EURC. Deposits already credited do not change.', cmd: `capxul bank settle ${b.currency} --to EURC`, who: 'whoever wears the Books hat', confirmLabel: 'Change it' })) { b.becomes = 'EURC in the Treasury'; cx.toast(`${b.currency} deposits now become EURC.`, { tone: 'success', cmd: `capxul bank settle ${b.currency} --to EURC` }); draw(); } } })),
      h('p.mx-note', 'Invoices print these details and an RF reference, so a payment matches its invoice by itself.')) }))),
    h('p.mx-note', 'Money paid into these details is converted at the edge by Bridge, Capxul\'s banking partner, and lands in the Treasury. Capxul\'s 0.50% fee is how Capxul is paid.'));
  draw();
  return box;
}
function verificationTab() {
  const v = M.verification;
  return h('div', { style: 'display:grid;gap:12px;padding-top:12px' }, cx.card({ title: h('span', 'Business verification ', cx.pill(v.status, 'green')), cmd: `capxul verify status ${ORG}`, body: h('div', { style: 'display:grid;gap:10px' },
    cx.kv([['Status', `${v.status} on ${fmt.date(v.approvedAt)}`], ...Object.entries(v.currencies).map(([c, s]) => [c, cx.pill(s, 'green')])]),
    h('div', h('b', 'People Bridge asked for'), h('ul', { style: 'margin:6px 0 0;padding-left:18px' }, v.people.map((p) => h('li', `${p.name} (${p.role}), approved ${fmt.date(p.approvedAt)}`)))),
    h('p.mx-note', 'Bridge, Capxul\'s banking partner, made these decisions.')) }));
}
cx.route('bank', (ctx) => {
  const tabs = [
    { label: 'Bank details', render: bankDetailsTab },
    { label: 'Deposits', count: M.deposits.length, render: () => h('div', { style: 'padding-top:12px' }, depositsList()) },
    { label: 'Payouts', count: M.payouts.length, render: () => h('div', { style: 'padding-top:12px' }, payoutsList()) },
    { label: 'Accounts', count: M.savedBankAccounts.length, render: savedAccounts },
    { label: 'Verification', render: verificationTab },
  ];
  const want = ctx.state?.tab ? tabs.findIndex((t) => t.label === ctx.state.tab) : -1;
  const unmatched = M.deposits.filter((d) => d.match === 'Unmatched');
  return cx.page({
    title: 'Bank', crumbs: [{ label: 'Money', route: 'money' }], sub: h('span', 'Fiat in and out, via Bridge ', h('span.mx-safe', 'via Bridge')),
    actions: [cx.btn('Get paid by bank', { icon: 'in', cmd: `capxul bank details ${ORG}`, onClick: () => tabsEl.show(0) }), cx.btn('Pay a bank account', { kind: 'primary', icon: 'bank', href: ['pay-by-bank'], cmd: `capxul bank pay contact <amount> ${ORG} --from <budget>` })],
    cmd: { cli: `capxul bank details ${ORG}`, sdk: 'client.banking.details.get({ org: "harbourline" })' },
    banner: unmatched.length ? cx.banner(`${fmt.plural(unmatched.length, 'deposit')} credited but not matched: ${unmatched.map((d) => `${d.from} ${fmt.money(d.bankAmount, d.currency)}`).join(', ')}.`, { tone: 'warning', action: cx.btn('Match', { sm: true, href: ['deposit', unmatched[0].id] }) }) : null,
    body: (tabsEl = tabsV(tabs, { key: 'bank', active: want >= 0 ? want : undefined })),
  });
}, { workspace: 'money', title: 'Bank' });
let tabsEl = null;

/* deposit (one) */
function matchDeposit(d) {
  const cands = D.books.salesInvoices.filter((i) => i.outstanding > 0).map((i) => ({ i, diff: Math.abs((i.currency === d.currency ? i.outstanding : i.outstanding) - d.bankAmount) })).sort((a, b) => a.diff - b.diff).slice(0, 5);
  const model = { pick: cands[0]?.i.name || 'none' };
  const cmdOf = () => `capxul bank match ${d.id} ${model.pick === 'none' ? 'none' : model.pick}`;
  cx.modal({ title: `Match ${depFrom(d)} ${fmt.money(d.bankAmount, d.currency)}`, body: h('div', { style: 'display:grid;gap:10px' },
    h('p.mx-note', `Reference "${d.reference}" names no invoice. Pick the likeliest, or say it is not an invoice.`),
    h('div', { style: 'display:grid;gap:6px' }, [...cands.map(({ i }) => h('label', { style: 'display:flex;gap:8px;align-items:flex-start' }, h('input', { type: 'radio', name: 'mx-match', checked: model.pick === i.name, onchange: () => { model.pick = i.name; cx.showAction(cmdOf(), 'Match', { pin: true }); } }), h('span', h('b', i.name), ` · ${i.customerName} · ${fmt.money(i.outstanding, i.currency)} outstanding · due ${fmt.date(i.dueDate)}`))),
      h('label', { style: 'display:flex;gap:8px' }, h('input', { type: 'radio', name: 'mx-match', checked: model.pick === 'none', onchange: () => { model.pick = 'none'; cx.showAction(cmdOf(), 'Match', { pin: true }); } }), h('span', h('b', 'Not an invoice'), ' · Books reviews it (6999 or 4999)'))])),
  actions: [{ label: 'Back' }, { label: 'Match', primary: true, needs: { any: ['Books', 'Invoicing'] }, cmd: cmdOf(), onClick: (close) => {
    d.match = model.pick === 'none' ? 'Not a request' : 'Matched'; d.matchedTo = model.pick === 'none' ? [] : [model.pick];
    dropWaiting((a) => a.ref?.id === d.id);
    close(); cx.toast(model.pick === 'none' ? 'Marked as not an invoice: Books reviews it.' : `Matched to ${model.pick}.`, { tone: 'success', cmd: cmdOf() }); cx.refresh();
  } }] });
}
/** Bridge finishes converting an arriving deposit: USDC lands in the Treasury, Capxul matches it to the invoice its
 *  reference names, and Books gets the payment entry. Incoming money needs nobody's approval. */
const landTimers = new Map();
function creditDeposit(d) {
  if (!d || d.status !== 'Arriving') return null;
  clearTimeout(landTimers.get(d.id)); landTimers.delete(d.id);
  const at = stamp();
  const rate = RATE;
  const gross = d.bankAmount / rate;
  const capxulFee = r2(gross * 0.005), exchange = r2(gross * 0.001);
  const fees = r2(capxulFee + exchange);
  const net = r6(gross - fees);
  const tx = cx.randHex(32), block = cx.blockAt(at);
  const inv = D.books.salesInvoices.find((i) => (d.matchedTo || []).includes(i.name));
  const payer = inv?.customerName || depFrom(d);
  const id = cx.newId('payment');
  const p = { id, direction: 'in', kind: 'movement', status: 'Settled', outcome: null, purpose: 'receipt', route: 'outside', budget: null, counterparty: payer,
    payee: { type: 'Self', name: D.company.name, safe: T.address }, payer: { name: payer, party: inv?.customer || null },
    amount: net, asset: 'USDC', amountRaw: String(Math.round(net * 1e6)), gbp: d.bankAmount, rate, fee: fees, createdAt: d.receivedAt, sentAt: at, settledAt: at,
    approval: null, approvedBy: null, approvedHat: null, preparedBy: null, proposal: null, batch: null, memo: d.reference, account: null, proof: null, books: null, deposit: d.id, voucher: null };
  M.payments.push(p);
  Object.assign(d, { status: 'Credited', net, fees, feeBreakdown: { capxul: capxulFee, exchange }, match: inv ? 'Matched' : 'Unmatched', matchedTo: inv ? [inv.name] : [], creditedAt: at, tx, block,
    bridgeId: d.bridgeId || 'dep_' + cx.randHex(12).slice(2), purpose: inv ? 'receipt' : 'unknown', payment: id, payer: d.payer || { name: payer, party: inv?.customer || null } });
  treasuryMove(net, at, `Bridge deposit from ${d.from}`, id, tx, block);
  addActivity(p, at);
  const voucher = inv && cx.native?.bookBridgeDeposit ? cx.native.bookBridgeDeposit(d, p, inv) : null;
  if (voucher) { d.voucher = voucher; p.books = voucher; p.voucher = voucher; }
  dropWaiting((a) => a.ref?.id === d.id);
  addEvent(`${fmt.money(d.bankAmount, d.currency)} from ${payer} arrived through Bridge as ${fmt.usdc(net)}${inv ? ` and paid ${inv.name}` : ''}`, { type: 'deposit', id: d.id });
  const tellers = [...new Set(D.seats.members.filter((m) => (m.hats || []).some((x) => x === 'Invoicing' || x === 'Books')).map((m) => m.id))];
  addNotice(tellers, `${payer} paid ${inv ? inv.name : 'by bank'}: ${fmt.money(d.bankAmount, d.currency)} arrived as ${fmt.usdc(net)}`, { type: 'deposit', id: d.id });
  return p;
}
/** On the deposit's page, an arriving deposit lands by itself a few seconds later, as Bridge finishes. */
function watchArrival(d) {
  if (d.status !== 'Arriving' || landTimers.has(d.id)) return;
  landTimers.set(d.id, setTimeout(() => {
    landTimers.delete(d.id);
    const p = creditDeposit(d);
    if (!p) return;
    cx.toast(`Bridge credited ${fmt.usdc(d.net)} to the Treasury. ${d.matchedTo?.length ? `Matched to ${d.matchedTo[0]} by its reference and booked as ${d.voucher}.` : ''}`, { tone: 'success', cmd: `capxul bank deposits ${ORG}` });
    if (['deposit', 'sales-invoice', 'bank', 'money', 'treasury', 'payments'].includes(cx.current.name)) cx.refresh();
  }, 6000));
}
cx.route('deposit', (ctx) => {
  const d = cx.find(M.deposits, 'id', ctx.id);
  if (!d) return cx.page({ title: 'Not found', body: cx.empty('No such deposit', cx.btn('Bank', { href: ['bank'] })) });
  watchArrival(d);
  const p = d.payment ? M.payments.find((x) => x.id === d.payment) : null;
  const fb = d.feeBreakdown;
  const form = formV({
    doc: d, tabKey: 'deposit',
    tabs: [{ label: 'Details', sections: [
      { label: 'Bank side', fields: [{ label: 'Sender', value: d.from }, { label: 'Named as', value: depFrom(d) }, { label: 'Bank amount', value: fmt.money(d.bankAmount, d.currency) }, { label: 'Rail', value: d.rail }, { label: 'Reference', value: d.reference, type: 'mono' }, { label: 'Received', value: fmt.datetime(d.receivedAt) }, { label: "Bridge's deposit ID", value: d.bridgeId, type: 'mono' }, { label: 'Into', value: `${d.currency} bank details (${M.bankDetails.find((b) => b.currency === d.currency)?.bank || ''})` }] },
      { label: 'Chain side', fields: [{ label: 'Arrived in the Treasury', value: d.net != null ? fmt.usdc(d.net) : null }, { label: 'Transaction', render: () => (d.tx ? cx.tx(d.tx) : h('span.faint', '—')) }, { label: 'Block', value: d.block ? fmt.int(d.block) : null }, { label: 'Credited', value: d.creditedAt ? fmt.datetime(d.creditedAt) : null }, { label: 'Payment', render: () => (p ? cx.link(p.id, 'payment', p.id) : h('span.faint', '—')) }, { label: 'Booked', render: () => (d.voucher && cx.hasRoute('payment-entry') ? cx.link(d.voucher, 'payment-entry', d.voucher) : d.voucher || h('span.faint', '—')) }] },
      { label: 'Fees', cols: 3, fields: [{ label: 'Capxul (0.50%)', value: fb ? fmt.usdc(fb.capxul) : null }, { label: 'Exchange (0.10%)', value: fb ? fmt.usdc(fb.exchange) : null }, { label: 'Total', value: d.fees != null ? fmt.usdc(d.fees) : null }] },
      { label: 'Match', fields: [{ label: 'Match', render: () => cx.pill(d.match, d.match === 'Unmatched' ? 'orange' : d.match === 'Matched' || /reference/.test(d.match) ? 'green' : 'muted') }, { label: 'Matched to', render: () => ((d.matchedTo || []).length ? h('span', d.matchedTo.map((n, i) => [i ? ', ' : '', cx.hasRoute('sales-invoice') && n.startsWith('ACC-SINV') ? cx.link(n, 'sales-invoice', n) : n])) : h('span.faint', '—')) }] },
      { label: 'Proof', node: cx.proof({ deposit: d.id, reference: d.reference, proof: null }, { none: `No proof on chain: Bridge's transfer carries no document hash. ${d.match === 'Matched' ? `It matched by reference ${d.reference}.` : d.status === 'Credited' ? 'Match it to an invoice to book it.' : ''}` }) },
    ] }],
    side: { id: d.id, title: depFrom(d), cmd: `capxul bank deposits ${ORG}`, tags: [d.currency, d.rail], created: { at: d.receivedAt } },
    timeline: { items: [{ at: d.receivedAt, kind: 'money', text: `${fmt.money(d.bankAmount, d.currency)} received from ${d.from} by ${d.rail}` }, d.creditedAt ? { at: d.creditedAt, kind: 'money', text: `${fmt.usdc(d.net)} credited to the Treasury` } : null, d.status === 'Returned' ? { at: d.receivedAt, kind: 'cancelled', text: 'Returned to the sender: no account matched and the sender is unknown' } : null, d.status === 'Below minimum' ? { at: d.receivedAt, kind: 'cancelled', text: `Below the ${fmt.money(2, d.currency)} minimum; not credited` } : null].filter(Boolean) },
  });
  return cx.page({
    title: `Deposit from ${depFrom(d)}`, crumbs: [{ label: 'Money', route: 'money' }, { label: 'Bank', route: 'bank' }],
    status: [cx.pill(d.status, DEP_TONE[d.status], { lg: true }), d.match === 'Unmatched' ? cx.pill('Unmatched', 'orange', { lg: true }) : null].filter(Boolean),
    sub: `${fmt.money(d.bankAmount, d.currency)} · ${fmt.datetime(d.receivedAt)}`,
    actions: d.match === 'Unmatched' ? [cx.btn('Match', { kind: 'primary', needs: { any: ['Books', 'Invoicing'] }, cmd: `capxul bank match ${d.id} <request|none>`, onClick: () => matchDeposit(d) })]
      : d.status === 'Arriving' ? [cx.btn('Check with Bridge', { icon: 'refresh', cmd: `capxul bank deposits ${ORG}`, onClick: () => { const p = creditDeposit(d); if (p) { cx.toast(`Bridge credited ${fmt.usdc(d.net)} to the Treasury.${d.voucher ? ` Matched to ${d.matchedTo[0]} and booked as ${d.voucher}.` : ''}`, { tone: 'success', cmd: `capxul bank deposits ${ORG}` }); cx.refresh(); } } })] : [],
    banner: d.status === 'Arriving' ? cx.banner(`Arriving: Bridge has the transfer and is converting it to USDC. Reference ${d.reference} matches ${(d.matchedTo || []).join(', ')}, so Capxul books it to that invoice when it lands, usually within a minute.`, { tone: 'info', icon: 'hourglass' })
      : d.creditedAt && d.voucher && d.matchedTo?.length ? cx.banner(h('span', `Reconciled: ${fmt.usdc(d.net)} arrived in the Treasury, matched to `, cx.link(d.matchedTo[0], 'sales-invoice', d.matchedTo[0]), ' by its reference, and booked as ', cx.link(d.voucher, 'payment-entry', d.voucher), '.'), { tone: 'success', icon: 'check' }) : null,
    cmd: { cli: `capxul bank deposits ${ORG}`, sdk: 'client.banking.deposits.list({ org: "harbourline" })', json: { id: d.id, state: d.status.toLowerCase(), currency: d.currency, amount: String(d.bankAmount), net: d.net, reference: d.reference, match: d.match } },
    body: form,
  });
}, { workspace: 'money', title: 'Deposit' });

/* payout (one) */
cx.route('payout', (ctx) => {
  const x = cx.find(M.payouts, 'id', ctx.id);
  if (!x) return cx.page({ title: 'Not found', body: cx.empty('No such payout', cx.btn('Bank', { href: ['bank'] })) });
  const p = M.payments.find((y) => y.id === x.payment);
  const hop1 = x.sentAt ? 'done' : x.status === 'Quoted' ? 'now' : x.status === 'Expired' ? 'bad' : '';
  const hop2 = x.status === 'Delivered' ? 'done' : x.status === 'In transit' ? 'now' : x.status === 'Refunded' ? 'bad' : '';
  const hops = cx.card({ title: 'Two hops', flush: true, body: h('div',
    h('div.mx-hop', { class: hop1 }, h('span.n', '1'), h('div', h('b', 'From the Treasury to Bridge'), h('small', x.sentAt ? `On chain ${fmt.datetime(x.sentAt)}${p?.proof ? ` · block ${fmt.int(p.proof.block)}` : ''} · ${fmt.usdc(x.sent)} from ${cx.deptName(x.from)}` : x.status === 'Expired' ? 'Never sent: the quote expired' : 'Waiting for the approval'), p?.proof ? h('small', cx.tx(p.proof.tx), ' · ', h('a', { href: cx.href('payment', p.id) }, 'proof')) : null)),
    h('div.mx-hop', { class: hop2 }, h('span.n', '2'), h('div', h('b', `Bridge to ${x.to}'s bank`), h('small', x.status === 'Delivered' ? `Delivered ${fmt.datetime(x.deliveredAt)}: ${fmt.money(x.bankAmount, x.currency)} by ${x.rail}` : x.status === 'In transit' ? `In transit by ${x.rail}, usually within minutes` : x.status === 'Refunded' ? `${x.reason}. ${fmt.usdc(x.refund)} came back to the Treasury on ${fmt.datetime(x.returnedAt)}.` : '—')))) });
  const quote = h('div.mx-quote',
    h('div.row.main', h('span', 'Bank receives'), h('b', fmt.money(x.bankAmount, x.currency))),
    h('div.row', h('span', 'Treasury sends'), h('b', fmt.usdc(x.sent))),
    h('div.row', h('span', 'Rate'), h('span', `1 USDC = £${x.quoteRate}`)),
    h('div.row', h('span', 'Bridge fee'), h('span', fmt.usdc(x.fee))),
    h('div.row', h('span', 'Rail'), h('span', x.rail)),
    h('div.row', h('span', 'Quote expires'), h('span', fmt.datetime(x.quoteExpiresAt))));
  const acts = [];
  if (x.status === 'Quoted' && p?.status === 'Prepared') acts.push(cx.btn('Approve', { kind: 'primary', icon: 'passkey', cmd: `capxul payment wait approval_${p.id.slice(8, 22)}`, onClick: () => approvePrepared(p) }));
  if (x.status === 'Expired') acts.push(cx.btn('Get a new quote', { kind: 'primary', icon: 'refresh', cmd: `capxul bank pay contact ${x.bankAmount} ${ORG} --from ${x.from}`, onClick: () => cx.go('pay-by-bank', null, { account: M.savedBankAccounts.find((a) => a.holder === x.to)?.id, amount: x.bankAmount, from: x.from }) }));
  if (x.status === 'Refunded') acts.push(cx.btn('Pay again', { kind: 'primary', icon: 'send', cmd: `capxul bank pay contact ${x.bankAmount} ${ORG} --from ${x.from}`, onClick: () => cx.go('pay-by-bank', null, { amount: x.bankAmount, from: x.from }) }));
  return cx.page({
    title: `Bank payout to ${x.to}`, crumbs: [{ label: 'Money', route: 'money' }, { label: 'Bank', route: 'bank' }],
    status: [cx.pill(x.status, PO_TONE[x.status], { lg: true })],
    sub: `${fmt.money(x.bankAmount, x.currency)} to ${x.bank.bankName} ·· ${x.bank.last4} · ${fmt.datetime(x.quotedAt)}`,
    actions: acts,
    banner: x.reason ? cx.banner(x.reason, { tone: x.status === 'Refunded' ? 'warning' : 'info' }) : null,
    cmd: { cli: p ? `capxul payment get ${p.id} ${ORG}` : `capxul payment list ${ORG}`, sdk: p ? `client.payments.get("${p.id}")` : undefined, json: { id: x.id, state: x.status.toLowerCase().replace(/ /g, '_'), quote: { input: String(x.sent), output: String(x.bankAmount), currency: x.currency, fee: String(x.fee), rate: String(x.quoteRate), expiresAt: x.quoteExpiresAt }, bridgeTransfer: x.bridgeId } },
    body: [hops, h('div.grid.side', cx.card({ title: 'Payout', body: cx.kv([['To', x.to], ['Their account', `${x.bank.bankName} · ${x.bank.sortCode} · ending ${x.bank.last4}`], ['For', PURPOSE[x.purpose] || x.purpose], ['From', cx.deptName(x.from)], ["Bridge's transfer", h('span.mono', x.bridgeId)], ['Payment', p ? cx.link(p.id, 'payment', p.id) : '—']]) }), cx.card({ title: 'The quote', body: quote })), p ? cx.proof(p) : null],
  });
}, { workspace: 'money', title: 'Bank payout' });

/* pay a bank account */
cx.route('pay-by-bank', (ctx) => {
  const st = ctx.state || {};
  const mine = payableBudgets().filter((b) => !isAllowance(b) || b === 'travel');
  const accts = M.savedBankAccounts.filter((a) => a.state === 'Active');
  const model = { account: st.account || accts.find((a) => a.for === 'Supplier')?.id || accts[0]?.id, amount: st.amount ?? null, fixed: 'receive', from: st.from && mine.includes(st.from) ? st.from : mine[0] || '', pays: '' };
  const quoteBox = h('div');
  const errs = h('div');
  const acct = () => accts.find((a) => a.id === model.account);
  const cmdOf = () => `capxul bank pay ${acct()?.for === 'Yourself' ? 'self' : 'contact'} ${model.amount ?? '<amount>'}${model.fixed === 'send' ? ' USDC' : ''} ${ORG} --account ${model.account} --from ${model.from || '<budget>'}`;
  const sync = () => { cx.setCommand({ cli: cmdOf(), sdk: 'client.approvals.prepare({ kind: "bank_payout", … })', who: model.from ? whoMay(model.from) : 'a holder of a department, or Directors' }); cx.fill(quoteBox); };
  const invs = () => D.books.purchaseInvoices.filter((x) => x.outstanding > 0 && x.supplierName === acct()?.holder);
  const invField = h('div');
  const drawInv = () => cx.fill(invField, cx.field({ label: 'What it pays', type: 'select', edit: true, model, key: 'pays', options: [['', invs().length ? 'Choose an invoice' : 'No open invoice for this account'], ...invs().map((x) => [x.name, `${x.name} · ${x.billNo} · due ${fmt.date(x.dueDate)} · ${fmt.money(x.outstanding, x.currency)}`])], onChange: (v) => { const x = pinv(v); if (x) { model.amount = x.outstanding; amtIn.querySelector('input').value = x.outstanding; } sync(); } }));
  const amtIn = cx.field({ label: 'Amount', type: 'float', edit: true, model, key: 'amount', reqd: true, onChange: sync });
  function getQuote() {
    const bad = [];
    const a = acct();
    if (!a) bad.push('Choose an account.');
    if (!(model.amount > 0)) bad.push('Enter an amount.');
    if (!model.from) bad.push(`ROLE_PERMISSION_DENIED · ${cx.me().name} wears no department's hat, so can't pay from a budget.`);
    cx.fill(errs, bad.map((b) => h('div.mx-err', b)));
    if (bad.length) return;
    const rate = r6(RATE - 0.00011);
    const fee = r2(Math.max(0.5, model.amount * 0.00064));
    const sent = model.fixed === 'receive' ? r2(model.amount / rate + fee) : model.amount;
    const receives = model.fixed === 'receive' ? model.amount : r2((model.amount - fee) * rate);
    const exp = new Date(cx.now.getTime() + (tick + 14) * 41000 + 10 * 60000).toISOString();
    const left = leftOf(model.from);
    cx.fill(quoteBox, cx.card({ title: 'Quote from Bridge', body: h('div', { style: 'display:grid;gap:10px' },
      h('div.mx-quote',
        h('div.row.main', h('span', 'Bank receives'), h('b', fmt.money(receives, a.currency))),
        h('div.row', h('span', 'Treasury sends'), h('b', fmt.usdc(sent))),
        h('div.row', h('span', 'Rate'), h('span', `1 USDC = £${rate}`)),
        h('div.row', h('span', 'Bridge fee'), h('span', fmt.usdc(fee))),
        h('div.row', h('span', 'Slippage buffer'), h('span', fmt.usdc(r2(sent * 0.00014)))),
        h('div.row', h('span', 'Rail'), h('span', 'Faster Payments, usually within minutes')),
        h('div.row', h('span', 'Quote expires'), h('span', `${fmt.time(exp)} (in 10:00)`))),
      sent > left ? h('div.mx-err', `PAYROLL_BUDGET_EXCEEDED · ${cx.deptName(model.from)} has ${fmt.usdc(left)} left ${periodWord(model.from)}.`) : h('div.mx-note', `${cx.deptName(model.from)} has ${fmt.usdc(left)} left ${periodWord(model.from)}; after this, ${fmt.usdc(r2(left - sent))}.`),
      h('div', cx.btn('Send for approval', { kind: 'primary', icon: 'passkey', cmd: cmdOf(), disabled: sent > left, reason: 'Not enough room in the budget', onClick: () => approve({ a, rate, fee, sent, receives, exp }) }))) }));
  }
  async function approve({ a, rate, fee, sent, receives, exp }) {
    const pid = cx.newId('payment');
    const x = pinv(model.pays);
    const r = await cx.approval({ title: `Pay ${a.holder} ${fmt.money(receives, a.currency)} by bank`, from: `Harbourline Treasury · ${fmt.addr(T.address)} · ${cx.deptName(model.from)} budget`, to: `${a.holder} · ${a.bank} ·· ${a.last4}`, amount: sent, gbp: gbpOf(sent), rate, rows: [{ to: a.holder, amount: `${fmt.money(receives, a.currency)} requested output, ${model.fixed === 'receive' ? 'exact' : 'about'}`, rail: 'Bank via Bridge' }], warnings: x ? [`It pays ${x.name} (${x.billNo}).`] : [], signer: cx.meId(), hat: hatFor(model.from), deadline: `Quote expires ${fmt.time(exp)}`, cmd: cmdOf(), next: `capxul payment wait ${pid}` });
    if (r.status !== 'done') return;
    const bid = cx.newId('payment').replace('payment_', 'bpo_');
    const p = { id: pid, direction: 'out', kind: 'payment', status: 'Prepared', outcome: null, purpose: x ? 'supplier' : a.for === 'Yourself' ? 'transfer' : 'supplier', route: 'department', budget: model.from, counterparty: a.holder, payee: { type: a.for === 'Yourself' ? 'Self' : 'Supplier', name: a.holder, bank: { bankName: a.bank, last4: a.last4 } }, payer: { type: 'Self', name: D.company.name, safe: T.address, label: 'Treasury' }, amount: sent, asset: 'USDC', amountRaw: String(Math.round(sent * 1e6)), gbp: x && x.currency === 'GBP' ? receives : gbpOf(sent), rate, fee, createdAt: r.at, preparedBy: cx.meId(), proposal: null, batch: null, memo: x?.billNo || null, account: null, proof: null, books: null, payout: bid };
    M.payments.push(p);
    const po = { id: bid, payment: pid, to: a.holder, bankAmount: receives, currency: a.currency, sent, net: r2(sent - fee), fee, quoteRate: rate, rail: 'Faster Payments', from: model.from, status: 'In transit', reason: null, quotedAt: r.at, quoteExpiresAt: exp, sentAt: r.at, deliveredAt: null, returnedAt: null, refund: null, bridgeId: 'tr_' + cx.randHex(12).slice(2), purpose: p.purpose, payeeType: p.payee.type, bank: { bankName: a.bank, last4: a.last4, sortCode: '••-••-••' } };
    M.payouts.push(po);
    await settleOut(p, r, { allocations: x ? [allocOf(x, receives)] : [], extra: { bankLast4: a.last4, adjustments: [{ kind: 'fee', by: 'Bridge', amount: String(Math.round(fee * 1e6)) }], payout: { bankAmount: Math.round(receives * 100), currency: a.currency, rail: 'Faster Payments' } }, desc: `Bank payout to ${a.holder} (via Bridge)` });
    if (x) payInvoice(x, receives, p);
    addEvent(`${cx.name(cx.meId())} paid ${a.holder} ${fmt.money(receives, a.currency)} by bank from ${cx.deptName(model.from)}`, { type: 'payout', id: bid });
    cx.toast(`Sent to Bridge. ${fmt.money(receives, a.currency)} is on its way to ${a.holder}.`, { tone: 'success', cmd: `capxul payment get ${pid} ${ORG}` });
    cx.go('payout', bid);
  }
  drawInv();
  const body = h('div.mx-form',
    !mine.length ? cx.banner(`${cx.me().name} wears no department's hat, so can't pay from a budget. The FDE can draft it for whoever can.`, { tone: 'warning' }) : null,
    cx.card({ body: h('div', { style: 'display:grid;gap:12px' },
      h('div.fields', { style: { '--cols': 2 } },
        cx.field({ label: 'Pay', type: 'select', edit: true, model, key: 'account', reqd: true, options: accts.map((a) => [a.id, `${a.holder} · ${a.bank} ·· ${a.last4} · ${a.currency}${a.for === 'Yourself' ? ' (yourself)' : ''}`]), onChange: () => { model.pays = ''; drawInv(); sync(); } }),
        cx.field({ label: 'Pay from', type: 'select', edit: true, model, key: 'from', reqd: true, options: mine.length ? mine.map((b) => [b, `${cx.deptName(b)} · ${fmt.usdc(leftOf(b))} left ${periodWord(b)}`]) : [['', 'No budget you can pay from']], onChange: sync }),
        amtIn,
        cx.field({ label: 'Fix', type: 'select', edit: true, model, key: 'fixed', options: [['receive', 'What reaches the bank'], ['send', 'What leaves the Treasury (USDC)']], onChange: sync }),
        invField),
      errs,
      h('div', cx.btn('Get a quote', { kind: 'primary', icon: 'refresh', cmd: cmdOf(), onClick: getQuote }), ' ', cx.btn('Cancel', { href: ['bank'] })),
      h('p.mx-note', 'The USDC leaves the Treasury for Bridge, and Bridge delivers pounds, euros or dollars to the bank. The quote holds for ten minutes.')) }),
    quoteBox);
  setTimeout(sync, 0);
  return cx.page({ title: 'Pay a bank account', crumbs: [{ label: 'Money', route: 'money' }, { label: 'Bank', route: 'bank' }], status: [cx.pill('New', 'gray', { lg: true })], cmd: { cli: cmdOf() }, fde: 'Pay a bank account (a new bank payout)', body });
}, { workspace: 'money', title: 'Pay a bank account' });

/* =====================================================================================================
   Requests to pay
   ===================================================================================================== */

cx.route('requests-to-pay', () => {
  const rows = M.requestsToPay;
  const tone = (s) => (/^Open/.test(s) ? 'orange' : s === 'Paid' ? 'green' : 'muted');
  const may = payableBudgets();
  const table = h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Received'), h('th', 'From'), h('th.opt', 'Reference'), h('th.num', 'Amount'), h('th', 'Due'), h('th', 'Status'), h('th.opt', 'ID'), h('th', ''))),
    h('tbody', rows.map((r) => h('tr', h('td', fmt.date(r.received)), h('td', h('b', r.from)), h('td.opt.wrap', r.reference), h('td.num', r.amount != null ? fmt.usdc(r.amount) : fmt.gbp(r.gbp)), h('td', fmt.date(r.due)), h('td', cx.pill(r.status, tone(r.status))), h('td.opt.mono', { style: 'font-size:12px' }, r.id.slice(0, 14) + '…'),
      h('td', /^Open/.test(r.status) ? cx.menu(null, [
        { label: 'Pay now', icon: 'send', needs: () => may.length > 0 || 'Needs a budget whose hat you wear.', cmd: `capxul inbox pay ${r.id} ${ORG}`, onClick: () => cx.go('send-money', null, { to: '@studiovarga', amount: r.amount, pinv: D.books.purchaseInvoices.find((x) => r.reference.startsWith(x.billNo))?.name }) },
        { label: 'Pay on its due date', icon: 'calendar', needs: () => may.length > 0 || 'Needs a budget whose hat you wear.', cmd: `capxul inbox pay ${r.id} ${ORG} --on due`, onClick: () => cx.toast(r.status.includes('scheduled') ? 'Already scheduled for its due date.' : 'Scheduled for its due date.', { cmd: `capxul inbox pay ${r.id} --on due` }) },
        { label: 'Decline', icon: 'x', danger: true, needs: () => may.length > 0 || 'Needs a budget whose hat you wear.', cmd: `capxul inbox decline ${r.id}`, onClick: async () => { if (await cx.confirm({ title: `Decline ${r.from}'s request?`, body: `${r.from} is told it was declined. Nothing is paid.`, cmd: `capxul inbox decline ${r.id}`, danger: true, confirmLabel: 'Decline' })) { r.status = 'Declined'; cx.toast('Declined', { cmd: `capxul inbox decline ${r.id}` }); cx.refresh(); } } },
      ]) : null))))));
  return cx.page({
    title: 'Requests to pay', crumbs: [{ label: 'Money', route: 'money' }],
    cmd: { cli: `capxul inbox list ${ORG}`, sdk: 'client.account.inbox.list({ org: "harbourline" })' },
    banner: cx.banner('Payment requests other Capxul users sent to Harbourline. Pay one exactly, or decline it. The invoices behind them are in Books.', { tone: 'info' }),
    body: cx.card({ flush: true, body: table }),
  });
}, { workspace: 'money', title: 'Requests to pay' });

/* =====================================================================================================
   Departments
   ===================================================================================================== */

const QUARTERS = [...new Set(D.departments.flatMap((d) => d.budgets.map((b) => b.quarter)))].sort();
const qLabel = (qq) => qq.replace('-', ' ');
const budgetQ = (d, qq) => d.budgets.find((b) => b.quarter === qq) || null;
function bar(total, spent, handed = 0, committed = 0) {
  const pc = (v) => Math.max(0, Math.min(100, (v / (total || 1)) * 100)) + '%';
  return h('div.mx-bar', { title: `Spent ${fmt.usdc(spent)} · handed down ${fmt.usdc(handed)} · committed ${fmt.usdc(committed)} of ${fmt.usdc(total)}` }, h('i.sp', { class: { hot: (spent + handed + committed) / (total || 1) > 0.85 }, style: { width: pc(spent) } }), handed ? h('i.hd', { style: { width: pc(handed) } }) : null, committed ? h('i.cm', { style: { width: pc(committed) } }) : null);
}
const peopleHat = (id) => cx.wears('People', id);

cx.route('departments', (ctx) => {
  const qq = ctx.state?.quarter || cx.store.get('dept-q', QUARTERS.at(-1));
  const isNow = qq === QUARTERS.at(-1);
  const kids = (id) => D.departments.filter((d) => d.parent === id);
  const allowUnder = (id) => D.allowances.filter((a) => a.parent === id);
  const rows = [];
  const walk = (d, lvl) => {
    const b = budgetQ(d, qq);
    const day = isNow ? cx.today : b?.to;
    const holders = d.holders.filter((x) => x.from <= (day || cx.today) && (!x.to || x.to > (day || cx.today))).map((x) => x.who);
    const may = mayAct(d.id);
    rows.push(h('tr', { class: lvl ? '' : 'group' },
      h('td.dname', h('span.pad', { style: { width: lvl * 18 + 'px' } }), lvl ? h('span.faint', '└ ') : null, h('a', { href: cx.href('department', d.id) }, d.name), h('span.kind', lvl ? 'team' : 'top'), d.status !== 'Active' ? [' ', cx.pill(d.status, 'muted')] : null),
      h('td.wrap', holders.length ? h('div.chips', holders.map((w) => cx.personChip(w))) : h('span.faint', 'nobody')),
      h('td.num', b ? fmt.num(b.amount, 2) : '—'),
      h('td.num.opt', b ? fmt.num(b.teamsAndAllowances || 0, 2) : '—'),
      h('td.num', b ? fmt.num(b.spent, 2) : '—'),
      h('td.num.opt', b ? fmt.num(b.committed || 0, 2) : '—'),
      h('td.num', b ? h('b', fmt.num(b.left, 2)) : '—'),
      h('td.opt', b ? bar(b.amount, b.spent, b.teamsAndAllowances || 0, b.committed || 0) : null),
      h('td', cx.menu(null, [
        { label: `Pay from ${d.name}`, icon: 'send', needs: () => may.ok || may.reason, cmd: `capxul org department pay ${d.id} --to <who> --amount <n> ${ORG}`, onClick: () => cx.go('send-money', null, { from: d.id }) },
        { label: 'New team under it', icon: 'plus', needs: () => may.ok || cx.wears('Director') || may.reason, cmd: `capxul org department create <name> --parent ${d.id} --budget <n>/quarter --holder <email> ${ORG}`, onClick: () => newDepartment(d.id) },
        { label: 'Change its budget', icon: 'edit', needs: () => (d.parent ? cx.holds(d.parent) || cx.wears('Director') || `Only the holder of ${cx.deptName(d.parent)}, above ${d.name}, or the Board can change it. Never its own holders.` : cx.wears('Director') || 'A top department\'s budget changes by Board proposal.'), cmd: `capxul org department budget set ${d.id} --budget <n>/quarter ${ORG}`, onClick: () => changeBudget(d) },
        { label: 'Holders', icon: 'hat', onClick: () => cx.go('department', d.id, { tab: 'Holders' }) },
        { divider: true },
        { label: d.status === 'Active' ? 'Close' : 'Reopen', icon: 'lock', danger: d.status === 'Active', needs: () => (d.parent ? cx.holds(d.parent) || cx.wears('Director') || 'Only the department above, or the Board.' : cx.wears('Director') || 'Only the Board.'), cmd: `capxul org department ${d.status === 'Active' ? 'close' : 'reopen'} ${d.id} ${ORG}`, onClick: () => closeDept(d) },
      ]))));
    for (const a of allowUnder(d.id)) {
      const m = a.months.filter((x) => x.month >= (b?.from || '').slice(0, 7) && x.month <= (b?.to || '').slice(0, 7));
      const startM = a.created.slice(0, 7) > (b?.from || '').slice(0, 7) ? a.created.slice(0, 7) : (b?.from || '').slice(0, 7);
      const monthsIn = b ? Math.max(0, (Number(b.to.slice(0, 4)) - Number(startM.slice(0, 4))) * 12 + Number(b.to.slice(5, 7)) - Number(startM.slice(5, 7)) + 1) : 0;
      const amt = a.monthly * monthsIn, sp = m.reduce((s, x) => s + x.spent, 0);
      rows.push(h('tr.allow', h('td.dname', h('span.pad', { style: { width: (lvl + 1) * 18 + 'px' } }), h('span.faint', '└ '), h('a', { href: cx.href('allowance', a.id) }, a.name), h('span.kind', `allowance · ${fmt.num(a.monthly, 0)}/month`)), h('td.wrap', h('div.chips', cx.holders(a.id).map((w) => cx.personChip(w)))), h('td.num', amt ? fmt.num(amt, 2) : '—'), h('td.num.opt', ''), h('td.num', fmt.num(sp, 2)), h('td.num.opt', ''), h('td.num', fmt.num(amt - sp, 2)), h('td.opt', amt ? bar(amt, sp) : null), h('td')));
    }
    for (const k of kids(d.id)) walk(k, lvl + 1);
  };
  for (const d of D.departments.filter((x) => !x.parent)) walk(d, 0);
  const top = budgetQ(D.departments[0], qq);
  const sel = h('select.ctl', { 'aria-label': 'Quarter', onchange: (e) => { cx.store.set('dept-q', e.target.value); cx.go('departments', null, { quarter: e.target.value }); } }, QUARTERS.map((x) => h('option', { value: x, selected: x === qq }, `${qLabel(x)}${x === QUARTERS.at(-1) ? ' (now)' : ''}`)));
  const ppl = (D.seats.members || []).filter((m) => m.kind === 'Person' && peopleHat(m.id)).map((m) => cx.name(m.id));
  return cx.page({
    title: 'Departments', sub: h('span', 'Quarter ', sel, top ? ` · ${fmt.date(top.from)} to ${fmt.date(top.to)} (UTC) · USDC · refills ${fmt.date(addDays(top.to, 1))}` : ''),
    actions: [cx.btn('Payout ceilings', { icon: 'shield', href: ['payout-ceilings'], cmd: `capxul org department ceiling set --token USDC ${ORG}` }), cx.btn('New department', { kind: 'primary', icon: 'plus', needs: () => cx.wears('Director') || payableBudgets().some((b) => !isAllowance(b)) || 'The Board makes a top department; a holder makes a team under theirs.', cmd: `capxul org department create <name> --budget <n>/quarter --holder <email> ${ORG}`, onClick: () => newDepartment(null) })],
    cmd: { cli: `capxul org department list ${ORG}`, sdk: 'client.org(orgId).departments.list()', json: D.departments.map((d) => { const b = budgetQ(d, qq); return { id: d.id, name: d.name, parent: d.parent, holders: d.holders.filter((x) => !x.to).map((x) => x.who), amount: b?.amount, spent: b?.spent, committed: b?.committed, left: b?.left }; }) },
    body: [
      cx.card({ flush: true, body: h('div.tbl-scroll', h('table.tbl.mx-tree', h('thead', h('tr', h('th', 'Department'), h('th', 'Holders'), h('th.num', 'Budget'), h('th.num.opt', 'Handed down'), h('th.num', 'Spent'), h('th.num.opt', 'Committed'), h('th.num', 'Left'), h('th.opt', ''), h('th', ''))), h('tbody', rows))) }),
      h('div.legend', h('span', h('i', { style: 'background:var(--chart-1)' }), 'Spent'), h('span', h('i', { style: 'background:var(--chart-2)' }), 'Handed down to teams and allowances'), h('span', h('i', { style: 'background:var(--chart-3)' }), 'Committed (agreements, dated payments)'), h('span', h('i', { style: 'background:var(--t-orange)' }), 'Above 85%')),
      cx.banner(h('span', 'Budgets belong to departments. Whoever wears a department\'s hat now acts for its money; a swap moves the authority at once. A team\'s budget is carved from its parent\'s. ', ppl.length ? `${ppl.join(', ')} wear${ppl.length === 1 ? 's' : ''} People, so cannot hold a department or team while they do.` : ''), { tone: 'info' }),
    ],
  });
}, { workspace: 'departments', title: 'Departments' });

function newDepartment(parent) {
  const parents = D.departments.filter((d) => cx.holds(d.id)).map((d) => d.id);
  const model = { name: '', parent: parent || parents[0] || '', amount: 15000, holder: '' };
  const seated = (D.seats.members || []).filter((m) => m.status === 'Active' && m.id !== '@harbourline-fde');
  const cmdOf = () => `capxul org department create ${JSON.stringify(model.name || '<name>')}${model.parent ? ' --parent ' + model.parent : ''} --budget ${model.amount}/quarter --holder ${model.holder ? (model.holder.startsWith('@') ? model.holder : cx.person(model.holder)?.companyEmail || model.holder) : '<email>'} ${ORG}`;
  const err = h('div.mx-err');
  cx.modal({ title: 'New department', body: h('div', { style: 'display:grid;gap:10px' },
    h('div.fields', { style: { '--cols': 2 } },
      cx.field({ label: 'Name', edit: true, model, key: 'name', reqd: true, placeholder: 'Brand', onChange: () => cx.showAction(cmdOf(), 'Create', { pin: true }) }),
      cx.field({ label: 'Under', type: 'select', edit: true, model, key: 'parent', options: [...(cx.wears('Director') ? [['', 'Top department (Board proposal)']] : []), ...parents.map((p) => [p, cx.deptName(p)])], onChange: () => cx.showAction(cmdOf(), 'Create', { pin: true }) }),
      cx.field({ label: 'Budget a quarter (USDC)', type: 'usdc', edit: true, model, key: 'amount', onChange: () => cx.showAction(cmdOf(), 'Create', { pin: true }) }),
      cx.field({ label: 'Holder', type: 'select', edit: true, model, key: 'holder', options: [['', 'Choose a member'], ...seated.map((m) => [m.id, `${cx.name(m.id)}${peopleHat(m.id) ? ' (wears People: cannot hold)' : ''}`])], onChange: () => cx.showAction(cmdOf(), 'Create', { pin: true }) })), err,
    h('p.mx-note', 'A team takes its parent\'s token and period. Its budget is carved from the parent\'s room.')),
  actions: [{ label: 'Back' }, { label: 'Create', primary: true, cmd: cmdOf(), onClick: async (close) => {
    if (!model.name) { err.textContent = 'Give it a name.'; return; }
    if (model.holder && peopleHat(model.holder)) { err.textContent = `ROLE_CONFLICT · ${cx.name(model.holder)} wears People, so cannot hold a department while they do.`; return; }
    if (model.parent && model.amount > leftOf(model.parent)) { err.textContent = `PAYROLL_BUDGET_EXCEEDED · ${cx.deptName(model.parent)} has ${fmt.usdc(leftOf(model.parent))} left this quarter.`; return; }
    close();
    if (!model.parent) { await boardAsk({ title: `Create the ${model.name} department (top), ${fmt.usdc(model.amount)} a quarter`, calls: [`Budgets.create(${model.name}, top, ${model.amount} a quarter)`, `Hats.mint(${model.name}, ${cx.name(model.holder) || 'nobody yet'})`], cmd: cmdOf() }); return; }
    const r = await cx.approval({ title: `Create ${model.name} under ${cx.deptName(model.parent)}`, from: `${cx.deptName(model.parent)} budget`, to: `${model.name} (team)`, amount: model.amount, gbp: gbpOf(model.amount), rate: RATE, signer: cx.meId(), hat: hatFor(model.parent), cmd: cmdOf() });
    if (r.status !== 'done') return;
    const id = cx.slug(model.name).toLowerCase();
    const pb = cx.budgetOn(model.parent);
    D.departments.push({ id, name: model.name, parent: model.parent, costCenter: model.name, holders: model.holder ? [{ who: model.holder, from: cx.today, name: cx.name(model.holder) }] : [], budgets: [{ quarter: QUARTERS.at(-1), from: pb.from, to: pb.to, amount: model.amount, spent: 0, committed: 0, left: model.amount }], changes: [{ when: cx.today, kind: 'Create', terms: `${model.name}, under ${cx.deptName(model.parent)}, ${fmt.num(model.amount, 2)} USDC a quarter, holder ${cx.name(model.holder) || 'nobody yet'}`, signedBy: cx.meId(), signedAs: `${cx.deptName(model.parent)} (office above)`, state: 'Applied', from: null, to: model.amount }], kind: 'department', period: 'quarter', token: 'USDC', status: 'Active' });
    pb.teamsAndAllowances = r2((pb.teamsAndAllowances || 0) + model.amount); pb.left = r2(pb.left - model.amount);
    if (model.holder) { const pp = cx.person(model.holder); pp?.hats?.push(model.name); }
    addEvent(`${cx.name(cx.meId())} created ${model.name} under ${cx.deptName(model.parent)}`, { type: 'department', id }, 'Departments');
    cx.toast(`Created ${model.name}.`, { tone: 'success', cmd: cmdOf() });
    cx.go('department', id);
  } }] });
}
function changeBudget(d) {
  const b = cx.budgetOn(d.id);
  const model = { amount: b?.amount || 0, note: '' };
  const top = !d.parent;
  const cmdOf = () => `capxul org department budget set ${d.id} --budget ${model.amount}/quarter${model.note ? ` --note ${JSON.stringify(model.note)}` : ''} ${ORG}`;
  const err = h('div.mx-err');
  cx.modal({ title: `Change ${d.name}'s budget`, body: h('div', { style: 'display:grid;gap:10px' },
    cx.kv([['Now', `${fmt.usdc(b?.amount)} a quarter · ${fmt.usdc(b?.spent)} spent`], ['Who may', top ? 'the Board (a Board proposal): nobody changes their own budget through its own hat' : `the holder of ${cx.deptName(d.parent)} above it (${cx.holders(d.parent).map(cx.name).join(', ')}), or the Board. Never its own holders.`]]),
    h('div.fields', { style: { '--cols': 2 } }, cx.field({ label: 'New amount a quarter (USDC)', type: 'usdc', edit: true, model, key: 'amount' }), cx.field({ label: 'Note', edit: true, model, key: 'note', placeholder: 'Why' })), err),
  actions: [{ label: 'Back' }, { label: top ? 'Propose to the Board' : 'Change', primary: true, cmd: cmdOf(), onClick: async (close) => {
    if (!(model.amount >= (b?.spent || 0) + (b?.committed || 0))) { err.textContent = `The amount can't go below what is spent and committed (${fmt.usdc((b?.spent || 0) + (b?.committed || 0))}).`; return; }
    close();
    if (top) { await boardAsk({ title: `Set ${d.name}'s budget: ${fmt.num(b.amount, 2)} → ${fmt.num(model.amount, 2)} USDC a quarter`, calls: [`Budgets.setAmount(${d.name}, ${model.amount} a quarter)`], note: model.note, cmd: cmdOf(), why: `${d.name} is a top department, and nobody changes their own budget through its own hat` }); return; }
    const pb = cx.budgetOn(d.parent);
    const delta = model.amount - b.amount;
    if (delta > pb.left) { cx.toast(`${cx.deptName(d.parent)} has only ${fmt.usdc(pb.left)} left to hand down.`, { tone: 'warning' }); return; }
    const r = await cx.approval({ title: `Set ${d.name}'s budget to ${fmt.usdc(model.amount)} a quarter`, from: `${cx.deptName(d.parent)} budget`, to: d.name, amount: Math.abs(delta), gbp: gbpOf(Math.abs(delta)), rate: RATE, signer: cx.meId(), hat: hatFor(d.parent), cmd: cmdOf() });
    if (r.status !== 'done') return;
    d.changes.push({ when: cx.today, kind: 'Set amount', terms: `${fmt.num(b.amount, 2)} → ${fmt.num(model.amount, 2)} USDC a quarter`, signedBy: cx.meId(), signedAs: `${cx.deptName(d.parent)} (office above)`, state: 'Applied', from: b.amount, to: model.amount });
    b.amount = model.amount; b.left = r2(b.left + delta); pb.teamsAndAllowances = r2((pb.teamsAndAllowances || 0) + delta); pb.left = r2(pb.left - delta);
    addEvent(`${cx.name(cx.meId())} set ${d.name}'s budget to ${fmt.usdc(model.amount)} a quarter`, { type: 'department', id: d.id }, 'Departments');
    cx.toast(`${d.name} now has ${fmt.usdc(model.amount)} a quarter.`, { tone: 'success', cmd: cmdOf() }); cx.refresh();
  } }] });
}
async function closeDept(d) {
  const cmd = `capxul org department ${d.status === 'Active' ? 'close' : 'reopen'} ${d.id} ${ORG}`;
  if (!d.parent) { await boardAsk({ title: `${d.status === 'Active' ? 'Close' : 'Reopen'} ${d.name}`, calls: [`Budgets.${d.status === 'Active' ? 'close' : 'reopen'}(${d.name})`], cmd }); return; }
  const ok = await cx.confirm({ title: `${d.status === 'Active' ? 'Close' : 'Reopen'} ${d.name}?`, body: d.status === 'Active' ? `${d.name} stops paying out. Its agreements end, dated payments are cancelled, and money waiting can still be taken back.` : `${d.name} can pay again from its budget.`, cmd, who: `the holder of ${cx.deptName(d.parent)}, or the Board`, danger: d.status === 'Active', confirmLabel: d.status === 'Active' ? 'Close it' : 'Reopen it' });
  if (!ok) return;
  const r = await cx.approval({ title: `${d.status === 'Active' ? 'Close' : 'Reopen'} ${d.name}`, from: `${cx.deptName(d.parent)} (office above)`, to: d.name, signer: cx.meId(), hat: hatFor(d.parent), cmd });
  if (r.status !== 'done') return;
  d.status = d.status === 'Active' ? 'Closed' : 'Active';
  d.changes.push({ when: cx.today, kind: d.status === 'Closed' ? 'Close' : 'Reopen', terms: d.name, signedBy: cx.meId(), signedAs: `${cx.deptName(d.parent)} (office above)`, state: 'Applied' });
  cx.toast(`${d.name} is ${d.status.toLowerCase()}.`, { tone: 'success', cmd }); cx.refresh();
}

/* the swap */
async function addHolder(d, who) {
  if (!who) return;
  if (peopleHat(who)) { cx.toast(`ROLE_CONFLICT · ${cx.name(who)} wears People, so cannot hold a department while they do.`, { tone: 'warning' }); return; }
  const top = !d.parent;
  const member = who.startsWith('@') ? who : cx.person(who)?.companyEmail || who;
  const cmd = `capxul org department holder add ${d.id} ${member} ${ORG}`;
  if (top) { await boardAsk({ title: `Add ${cx.name(who)} as a holder of ${d.name}`, calls: [`Hats.mint(${d.name}, ${cx.name(who)})`], cmd }); return; }
  const r = await cx.approval({ title: `Add ${cx.name(who)} to ${d.name}`, from: `${cx.deptName(d.parent)} (the hat above ${d.name})`, to: `${cx.name(who)}${cx.person(who)?.safe ? ' · ' + fmt.addr(cx.person(who).safe) : ''}`, warnings: [`${cx.name(who)} can act for ${d.name}'s money as soon as this lands.`], signer: cx.meId(), hat: hatFor(d.parent), cmd });
  if (r.status !== 'done') return;
  d.holders.push({ who, from: cx.today, name: cx.name(who) });
  d.changes.push({ when: cx.today, kind: 'Add holder', terms: cx.name(who), signedBy: cx.meId(), signedAs: `${cx.deptName(d.parent)} (office above)`, state: 'Applied' });
  const pp = cx.person(who); if (pp && !pp.hats?.includes(d.name)) pp.hats = [...(pp.hats || []), d.name];
  const raw = D.people.find((x) => x.id === who); if (raw && !raw.hats.includes(d.name)) raw.hats.push(d.name);
  addEvent(`${cx.name(cx.meId())} added ${cx.name(who)} as a holder of ${d.name}`, { type: 'department', id: d.id }, 'Departments');
  addNotice(who, `You now wear the ${d.name} hat: you can act for ${d.name}'s budget`, { type: 'department', id: d.id }, 'People');
  cx.toast(`${cx.name(who)} now wears the ${d.name} hat.`, { tone: 'success', cmd });
  cx.refresh();
}
async function removeHolder(d, who) {
  const top = !d.parent;
  const member = who.startsWith('@') ? who : cx.person(who)?.companyEmail || who;
  const cmd = `capxul org department holder remove ${d.id} ${member} ${ORG}`;
  const allowHats = D.allowances.filter((a) => a.parent === d.id && cx.holders(a.id).includes(who));
  const ok = await cx.confirm({ title: `Remove ${cx.name(who)} from ${d.name}?`, body: h('div', { style: 'display:grid;gap:6px' }, h('p', `${cx.firstName(who)} stops being able to act for ${d.name}'s money at once. An approval ${cx.firstName(who)} opened and didn't sign will be refused.`), allowHats.length ? h('p', `${cx.firstName(who)}'s ${allowHats.map((a) => a.name + ' allowance').join(', ')} is a separate hat, which only the Board changes: remove it too with a Board proposal afterwards.`) : null, cx.holders(d.id).length === 1 ? h('p.mx-err', `${d.name} will have no holder: only the hat above it, or the Board, can act for it until someone is added.`) : null), cmd, who: top ? 'the Board' : `the holder of ${cx.deptName(d.parent)}, or the Board`, danger: true, confirmLabel: 'Remove' });
  if (!ok) return;
  if (top) { await boardAsk({ title: `Remove ${cx.name(who)} as a holder of ${d.name}`, calls: [`Hats.burn(${d.name}, ${cx.name(who)})`], cmd }); return; }
  const r = await cx.approval({ title: `Remove ${cx.name(who)} from ${d.name}`, from: `${cx.deptName(d.parent)} (the hat above ${d.name})`, to: cx.name(who), signer: cx.meId(), hat: hatFor(d.parent), cmd });
  if (r.status !== 'done') return;
  const hh = d.holders.find((x) => x.who === who && !x.to); if (hh) hh.to = cx.today;
  d.changes.push({ when: cx.today, kind: 'Remove holder', terms: cx.name(who), signedBy: cx.meId(), signedAs: `${cx.deptName(d.parent)} (office above)`, state: 'Applied' });
  const pp = cx.person(who); if (pp?.hats) pp.hats = pp.hats.filter((x) => x !== d.name);
  const raw = D.people.find((x) => x.id === who); if (raw) raw.hats = raw.hats.filter((x) => x !== d.name);
  addEvent(`${cx.name(cx.meId())} removed ${cx.name(who)} from ${d.name}`, { type: 'department', id: d.id }, 'Departments');
  cx.toast(`${cx.name(who)} no longer wears the ${d.name} hat.`, { tone: 'success', cmd, action: allowHats.length ? { label: 'Propose the allowance change', onClick: () => boardAsk({ title: `Revoke ${cx.name(who)}'s ${allowHats[0].name} allowance`, calls: [`Hats.burn(${allowHats[0].name} allowance, ${cx.name(who)})`], cmd: `capxul org allowance revoke ${allowHats[0].id} --member ${member} ${ORG}` }) } : null });
  cx.refresh();
}

cx.route('department', (ctx) => {
  const d = cx.find(D.departments, 'id', ctx.id);
  if (!d) {
    const a = cx.find(D.allowances, 'id', ctx.id);
    if (a) { cx.go('allowance', a.id); return cx.page({ title: a.name }); }
    return cx.page({ title: 'Not found', body: cx.empty('No such department', cx.btn('Departments', { href: ['departments'] })) });
  }
  const b = cx.budgetOn(d.id);
  const holdersNow = cx.holders(d.id);
  const may = mayAct(d.id);
  const swapNeed = () => (d.parent ? cx.holds(d.parent) || cx.wears('Director') || `Only the holder of ${cx.deptName(d.parent)}, above ${d.name}, or the Board can change ${d.name}'s holders.` : cx.wears('Director') || `Only the Board changes the holders of ${d.name}, a top department.`);
  const pays = M.payments.filter((p) => p.budget === d.id);
  const c = ceiling();
  const overview = () => {
    const year = cx.today.slice(0, 4);
    const months = []; for (let m = 1; m <= Number(cx.today.slice(5, 7)); m++) months.push(`${year}-${String(m).padStart(2, '0')}`);
    const spentBy = new Map(months.map((m) => [m, 0]));
    for (const p of pays) { if (p.direction !== 'out' || p.status === 'Cancelled' || p.status === 'Prepared') continue; const m = String(p.settledAt || '').slice(0, 7); if (spentBy.has(m)) spentBy.set(m, spentBy.get(m) + p.amount); }
    const up = cx.ancestors(d.id);
    return h('div', { style: 'display:grid;gap:14px;padding-top:12px' },
      b ? cx.card({ title: `${qLabel(b.quarter)} · ${fmt.date(b.from)} to ${fmt.date(b.to)}`, body: h('div', { style: 'display:grid;gap:12px' },
        h('div.ncards', cx.numberCard({ label: 'Budget', value: fmt.usdc(b.amount), sub: 'this quarter' }), cx.numberCard({ label: 'Spent', value: fmt.usdc(b.spent), sub: fmt.pct(b.spent / b.amount, 0) + ' of the budget' }), b.teamsAndAllowances ? cx.numberCard({ label: 'Handed down', value: fmt.usdc(b.teamsAndAllowances), sub: 'to teams and allowances' }) : null, cx.numberCard({ label: 'Committed', value: fmt.usdc(b.committed || 0), sub: 'agreements and dated payments' }), cx.numberCard({ label: 'Left', value: fmt.usdc(b.left), sub: `refills ${fmt.date(addDays(b.to, 1))}` })),
        cx.chart.meter({ total: b.amount, parts: [{ label: 'Spent', value: b.spent }, ...(b.teamsAndAllowances ? [{ label: 'Handed down', value: b.teamsAndAllowances, color: '2' }] : []), { label: 'Committed', value: b.committed || 0, color: '3' }], warnAt: 0.85, format: (v) => fmt.usdc(v, 0) })) }) : null,
      h('div.grid.c2',
        cx.card({ title: `Spent each month, ${year}`, cmd: `capxul payment list ${ORG} --from ${d.id} --since ${year}-01-01`, body: cx.chart.bar({ labels: months.map((m) => fmt.monthShort(m)), series: [{ name: 'Spent', values: months.map((m) => spentBy.get(m)), color: '1' }], height: 200, format: (v) => fmt.compact(v), tipFormat: (v) => fmt.usdc(v) }) }),
        cx.card({ title: 'Budget and spend by quarter', body: cx.chart.bar({ labels: d.budgets.map((x) => qLabel(x.quarter)), series: [{ name: 'Budget', values: d.budgets.map((x) => x.amount), color: 'muted' }, { name: 'Spent', values: d.budgets.map((x) => x.spent), color: '1' }], height: 200, format: (v) => fmt.compact(v), tipFormat: (v) => fmt.usdc(v) }) })),
      cx.card({ title: `Who can act for ${d.name} now`, body: h('div', { style: 'display:grid;gap:8px' },
        h('div', h('b', 'Holders: '), holdersNow.length ? h('span.chips', holdersNow.map((w) => cx.personChip(w))) : h('span.muted', 'nobody')),
        up.map((u) => h('div', h('b', `${cx.deptName(u)} (above): `), h('span.chips', cx.holders(u).map((w) => cx.personChip(w))))),
        h('div', h('b', 'The Board: '), `${D.board.threshold} of ${D.board.directors.length} Directors, by Board proposal`),
        h('div.mx-note', `It pays within the USDC payout ceiling: ${fmt.usdc(c.left)} left of ${fmt.usdc(c.ceiling)} this year.`)) }));
  };
  const holdersTab = () => {
    const seated = (D.seats.members || []).filter((m) => m.status === 'Active' && m.id !== '@harbourline-fde' && !holdersNow.includes(m.id));
    const model = { who: '' };
    const swapOk = swapNeed() === true;
    return h('div', { style: 'display:grid;gap:14px;padding-top:12px' },
      cx.card({ title: 'Holders now', flush: true, cmd: `capxul org department show ${d.id} ${ORG}`, body: holdersNow.length ? h('div', holdersNow.map((w) => {
        const since = d.holders.find((x) => x.who === w && !x.to)?.from;
        const pp = cx.person(w);
        return h('div.mx-holder', cx.avatar(w), h('div.grow', h('b', cx.name(w)), h('small', `${w.startsWith('@') ? (pp?.label || 'agent') + ' of ' + cx.name(pp?.owner) : pp?.companyEmail || ''}${pp?.safe ? ' · Safe ' + fmt.addr(pp.safe) : ''} · since ${fmt.date(since)}`)), cx.hat(d.name), cx.btn('Remove', { sm: true, kind: 'danger', needs: swapNeed, cmd: `capxul org department holder remove ${d.id} ${w.startsWith('@') ? w : pp?.companyEmail} ${ORG}`, onClick: () => removeHolder(d, w) }));
      })) : cx.empty('Nobody wears this hat now.') }),
      cx.card({ title: 'Add a holder', body: h('div', { style: 'display:grid;gap:10px' },
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end' },
          h('div', { style: 'flex:1;min-width:220px' }, cx.field({ label: 'Member', type: 'select', edit: true, model, key: 'who', options: [['', 'Choose a member or agent'], ...seated.map((m) => [m.id, `${cx.name(m.id)}${m.kind === 'Agent' ? ' (agent)' : ''}${peopleHat(m.id) ? ' · wears People: cannot hold' : ''}`])], onChange: (v) => cx.showAction(`capxul org department holder add ${d.id} ${v.startsWith('@') ? v : cx.person(v)?.companyEmail || v} ${ORG}`, 'Add a holder', { pin: true }) })),
          cx.btn('Add', { kind: 'primary', icon: 'plus', needs: swapNeed, cmd: `capxul org department holder add ${d.id} <member> ${ORG}`, onClick: () => addHolder(d, model.who) })),
        h('div.mx-note', `People-hat wearers can't hold a department while they wear People (${(D.seats.members || []).filter((m) => m.kind === 'Person' && peopleHat(m.id)).map((m) => cx.name(m.id)).join(', ')}).`),
        !swapOk ? cx.banner(String(swapNeed()), { tone: 'warning' }) : null) }),
      h('div.mx-stays', h('b', 'What stays with the department'), h('span', 'Agreements keep paying and their payees keep collecting. Dated payments still pay on their day. Money waiting can still be taken back. Teams keep their budgets. The budget, its room and the payout ceiling don\'t change. Whoever wears the hat next acts on all of them.'), h('span', 'An approval the old holder opened and didn\'t sign will be refused.')),
      cx.card({ title: 'History', flush: true, body: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Holder'), h('th', 'From'), h('th', 'To'))), h('tbody', [...d.holders].reverse().map((x) => h('tr', h('td', cx.personChip(x.who)), h('td', fmt.date(x.from)), h('td', x.to ? fmt.date(x.to) : cx.pill('Now', 'green'))))))) }),
      d.id === 'delivery' && holdersNow.includes('grace') ? cx.banner(h('span', 'Grace Adeyemi asked for parental leave from 1 December. Ravi Shah is to take the Delivery hat: add Ravi, then remove Grace. Her Travel allowance is a separate hat that only the Board changes.'), { tone: 'info' }) : null);
  };
  const running = () => {
    const ag = (D.payroll.agreements || []).filter((x) => x.budget === d.id);
    const sch = M.scheduled.filter((s) => s.budget === d.id && s.status === 'Scheduled');
    const esc = M.escrows.filter((e) => e.from === d.id && e.status === 'Open');
    const teams = [...D.departments.filter((x) => x.parent === d.id), ...D.allowances.filter((x) => x.parent === d.id)];
    const sec = (title, items, empty) => cx.card({ title, body: items.length ? h('ul.feed', items) : h('p.muted', empty) });
    return h('div', { style: 'display:grid;gap:12px;padding-top:12px' },
      sec('Agreements', ag.map((x) => h('li', cx.icon('swap'), h('span', `${cx.name(x.payee)} · ${fmt.usdc(x.amount)} a ${x.period} · running since ${fmt.date(x.start)} · collected ${fmt.usdc(x.collections.reduce((s, c2) => s + c2.amount, 0))} to ${fmt.date(x.collections.at(-1)?.at)} · offered by ${cx.name(x.offeredBy)}`), h('span.ago', x.status))), 'None.'),
      sec('Dated payments', sch.map((s) => h('li', cx.icon('calendar'), h('a', { href: cx.href('payment', schedRec(s).id) }, `${s.to} · ${fmt.usdc(s.amount)} on ${fmt.date(s.day)}`), h('span.ago', cx.name(s.scheduledBy)))), 'None.'),
      sec('Money waiting', esc.map((e) => h('li', cx.icon('hourglass'), h('a', { href: cx.href('payment', e.payment) }, `${e.email} · ${fmt.usdc(e.amount)} since ${fmt.date(e.fundedAt)}`), h('span.ago', fmt.ago(e.fundedAt)))), 'None.'),
      sec('Teams and allowances', teams.map((t) => h('li', cx.icon('departments'), h('a', { href: cx.href(D.allowances.includes(t) ? 'allowance' : 'department', t.id) }, cx.deptName(t.id)), h('span.ago', cx.holders(t.id).map(cx.name).join(', ')))), 'None.'),
      h('p.mx-note', 'What a department set running stays the department\'s, whoever holds the hat.'));
  };
  const paysTab = () => h('div', { style: 'padding-top:12px' }, cx.listView({
    key: 'dept-pays-' + d.id, rows: () => allPayments().filter((p) => p.budget === d.id), id: (p) => p.id, noun: 'payment',
    titleCol: { key: 'counterparty', label: 'Counterparty', sub: (p) => p.batch?.label || p.memo || '' }, status: (p) => payPill(p),
    columns: [{ key: 'when', label: 'Date', get: (p) => whenOf(p), type: 'datetime' }, { key: 'purpose', label: 'Purpose', get: (p) => PURPOSE[p.purpose] }, { key: 'approvedBy', label: 'Approved by', render: (p) => (p.approvedBy && cx.person(p.approvedBy) ? cx.personChip(p.approvedBy, { link: false }) : h('span.faint', '—')) }],
    right: { key: 'amount', label: 'Amount', type: 'usdc' },
    filters: [{ key: 'counterparty', label: 'Counterparty' }, { key: 'status', label: 'Status', type: 'select' }, { key: 'when', label: 'Month', type: 'month', get: (p) => whenOf(p) }],
    sort: { options: [{ key: 'when', label: 'Date', get: (p) => whenOf(p) || '' }, { key: 'amount', label: 'Amount' }], default: { key: 'when', dir: 'desc' } },
    href: (p) => ['payment', p.id], cmd: { cli: `capxul payment list ${ORG} --from ${d.id}` },
  }));
  const changes = () => h('div', { style: 'padding-top:12px' }, cx.card({ flush: true, cmd: `capxul org department show ${d.id} ${ORG}`, body: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'When'), h('th', 'Change'), h('th', 'Terms'), h('th', 'Signed by'), h('th', 'State'))), h('tbody', [...d.changes].reverse().map((x) => h('tr', h('td', fmt.date(x.when)), h('td', x.kind), h('td.wrap', x.terms), h('td.wrap', x.signedBy === 'board' ? h('span', x.signedAs, x.proposal ? [' · ', cx.link(x.proposal, 'proposal', x.proposal)] : null) : h('span', cx.name(x.signedBy), h('span.muted', ` (${x.signedAs})`))), h('td', cx.pill(x.state, x.state === 'Applied' ? 'green' : x.state === 'Proposed' ? 'blue' : 'muted')))))) ) }));
  const tabs = [{ label: 'Overview', render: overview }, { label: 'Holders', count: holdersNow.length, render: holdersTab }, { label: 'Running', render: running }, { label: 'Payments', count: pays.length, render: paysTab }, { label: 'Changes', count: d.changes.length, render: changes }];
  const want = ctx.state?.tab ? tabs.findIndex((t) => t.label === ctx.state.tab) : -1;
  return cx.page({
    title: d.name, crumbs: [{ label: 'Departments', route: 'departments' }, ...cx.ancestors(d.id).reverse().map((a) => ({ label: cx.deptName(a), route: 'department', id: a }))],
    status: [cx.pill(d.status, d.status === 'Active' ? 'green' : 'muted', { lg: true })],
    sub: h('span.chips', holdersNow.map((w) => h('span', cx.personChip(w), ' ', cx.hat(d.name))), b ? h('span.muted', ` · ${fmt.usdc(b.left)} left of ${fmt.usdc(b.amount)} this quarter`) : null),
    actions: [
      cx.menu(null, [
        { label: 'New team under it', icon: 'plus', needs: () => may.ok || cx.wears('Director') || may.reason, cmd: `capxul org department create <name> --parent ${d.id} --budget <n>/quarter --holder <email> ${ORG}`, onClick: () => newDepartment(d.id) },
        { label: 'Change its budget', icon: 'edit', needs: () => (d.parent ? cx.holds(d.parent) || cx.wears('Director') || 'Only the department above, or the Board. Never its own holders.' : cx.wears('Director') || 'A top department\'s budget changes by Board proposal.'), cmd: `capxul org department budget set ${d.id} --budget <n>/quarter ${ORG}`, onClick: () => changeBudget(d) },
        { label: d.status === 'Active' ? 'Close' : 'Reopen', icon: 'lock', danger: true, needs: () => (d.parent ? cx.holds(d.parent) || cx.wears('Director') || 'Only the department above, or the Board.' : cx.wears('Director') || 'Only the Board.'), cmd: `capxul org department close ${d.id} ${ORG}`, onClick: () => closeDept(d) },
      ]),
      cx.btn('Ask the FDE', { icon: 'fde', onClick: () => cx.fde.open({ ask: `Why is ${d.name} at ${b ? Math.round((b.spent / b.amount) * 100) : 0}% of its budget this quarter?` }) }),
      cx.btn(`Pay from ${d.name}`, { kind: 'primary', icon: 'send', needs: () => may.ok || may.reason, cmd: `capxul org department pay ${d.id} --to <who> --amount <n> ${ORG}`, onClick: () => cx.go('send-money', null, { from: d.id }) }),
    ],
    cmd: { cli: `capxul org department show ${d.id} ${ORG}`, sdk: `client.org(orgId).departments.get("${d.id}")`, json: { id: d.id, name: d.name, parent: d.parent, period: 'quarter', token: 'USDC', holders: holdersNow, amount: b?.amount, spent: b?.spent, committed: b?.committed, left: b?.left, refillsAt: b ? addDays(b.to, 1) : null, status: d.status } },
    fde: `Department ${d.name}`,
    body: tabsV(tabs, { key: 'department', active: want >= 0 ? want : undefined }),
  });
}, { workspace: 'departments', title: 'Department' });

/* allowances */
cx.route('allowances', () => {
  const rows = D.allowances.map((a) => {
    const m = allowanceMonth(a) || { amount: a.monthly, spent: 0, left: a.monthly };
    return h('tr.click', { onclick: (e) => { if (!e.target.closest('.menu-wrap,a')) cx.go('allowance', a.id); } },
      h('td', h('a', { href: cx.href('allowance', a.id) }, h('b', a.name)), h('div.muted', { style: 'font-size:12px' }, a.purpose)),
      h('td', h('div.chips', cx.holders(a.id).map((w) => cx.personChip(w)))), h('td.opt', cx.deptName(a.parent)),
      h('td.num', `${fmt.num(a.monthly, 2)} / month`), h('td.num', fmt.num(m.spent, 2)), h('td.num', h('b', fmt.num(m.left, 2))), h('td.opt', bar(m.amount, m.spent)),
      h('td.opt', fmt.date(addDays(monthNow + '-28', 4).slice(0, 8) + '01')), h('td', cx.pill('Active', 'green')), h('td.opt.mono', { style: 'font-size:12px' }, a.id),
      h('td', cx.menu(null, [
        { label: 'Assign a holder', icon: 'hat', needs: 'Director', cmd: `capxul org allowance assign ${a.id} --member <member> ${ORG}`, onClick: () => allowanceAssign(a) },
        { label: 'Revoke a holder', icon: 'x', needs: 'Director', cmd: `capxul org allowance revoke ${a.id} --member ${cx.holders(a.id)[0]} ${ORG}`, onClick: () => boardAsk({ title: `Revoke ${cx.name(cx.holders(a.id)[0])}'s ${a.name} allowance`, calls: [`Hats.burn(${a.name} allowance, ${cx.name(cx.holders(a.id)[0])})`], cmd: `capxul org allowance revoke ${a.id} --member ${cx.holders(a.id)[0]} ${ORG}` }) },
        { label: 'Change amount', icon: 'edit', needs: () => cx.holds(a.parent) || cx.wears('Director') || `Only the holder of ${cx.deptName(a.parent)} or the Board.`, cmd: `capxul org allowance change ${a.id} --amount <n>/month ${ORG}`, onClick: () => allowanceAmount(a) },
      ])));
  });
  return cx.page({
    title: 'Allowances', crumbs: [{ label: 'Departments', route: 'departments' }],
    actions: [cx.btn('New allowance', { kind: 'primary', icon: 'plus', needs: 'Director', cmd: `capxul org allowance create --input allowance.json ${ORG}`, onClick: () => allowanceNew() })],
    cmd: { cli: `capxul org allowance list ${ORG}`, sdk: 'client.org(orgId).allowances.list()' },
    banner: cx.banner('Small budgets for one person or agent to spend from, refilled each month. Their hats sit under the Board\'s, so only the Board changes who holds them; their amount comes out of the parent department\'s room. The Capxul allowance exists because the People hat cannot hold a department, and seats are bought from a budget the buyer holds.', { tone: 'info' }),
    body: cx.card({ flush: true, body: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Name'), h('th', 'Holder'), h('th.opt', 'Under'), h('th.num', 'Amount'), h('th.num', `Spent (${fmt.monthShort(monthNow)})`), h('th.num', 'Left'), h('th.opt', ''), h('th.opt', 'Refills'), h('th', 'State'), h('th.opt', 'ID'), h('th', ''))), h('tbody', rows))) }),
  });
}, { workspace: 'departments', title: 'Allowances' });
function allowanceNew() {
  const model = { name: '', parent: 'operations', monthly: 300, holder: '' };
  const seated = (D.seats.members || []).filter((m) => m.status === 'Active' && m.id !== '@harbourline-fde');
  cx.modal({ title: 'New allowance', body: h('div.fields', { style: { '--cols': 2 } }, cx.field({ label: 'Name', edit: true, model, key: 'name', reqd: true }), cx.field({ label: 'Under', type: 'select', edit: true, model, key: 'parent', options: D.departments.map((d) => [d.id, d.name]) }), cx.field({ label: 'A month (USDC)', type: 'usdc', edit: true, model, key: 'monthly' }), cx.field({ label: 'Holder', type: 'select', edit: true, model, key: 'holder', options: [['', 'Choose'], ...seated.map((m) => [m.id, cx.name(m.id)])] })),
    actions: [{ label: 'Back' }, { label: 'Propose to the Board', primary: true, needs: 'Director', cmd: `capxul org allowance create --input allowance.json ${ORG}`, onClick: async (close) => { if (!model.name) return; close(); await boardAsk({ title: `Create the ${model.name} allowance (${fmt.num(model.monthly, 0)} USDC a month, under ${cx.deptName(model.parent)}) for ${cx.name(model.holder) || 'nobody yet'}`, calls: [`Budgets.create(${model.name}, under ${cx.deptName(model.parent)}, ${model.monthly} a month)`, `Hats.mint(${model.name} allowance, ${cx.name(model.holder)})`], cmd: `capxul org allowance create --input allowance.json ${ORG}` }); } }] });
}
function allowanceAssign(a) {
  const model = { who: '' };
  const seated = (D.seats.members || []).filter((m) => m.status === 'Active' && m.id !== '@harbourline-fde' && !cx.holders(a.id).includes(m.id));
  cx.modal({ title: `Assign the ${a.name} allowance`, body: cx.field({ label: 'Member or agent', type: 'select', edit: true, model, key: 'who', options: [['', 'Choose'], ...seated.map((m) => [m.id, cx.name(m.id)])] }),
    actions: [{ label: 'Back' }, { label: 'Propose to the Board', primary: true, needs: 'Director', cmd: `capxul org allowance assign ${a.id} --member <member> ${ORG}`, onClick: async (close) => { if (!model.who) return; close(); await boardAsk({ title: `Assign the ${a.name} allowance to ${cx.name(model.who)}`, calls: [`Hats.mint(${a.name} allowance, ${cx.name(model.who)})`], cmd: `capxul org allowance assign ${a.id} --member ${model.who} ${ORG}` }); } }] });
}
function allowanceAmount(a) {
  const model = { monthly: a.monthly };
  const cmdOf = () => `capxul org allowance change ${a.id} --amount ${model.monthly}/month ${ORG}`;
  cx.modal({ title: `Change the ${a.name} allowance`, body: cx.field({ label: 'A month (USDC)', type: 'usdc', edit: true, model, key: 'monthly' }),
    actions: [{ label: 'Back' }, { label: 'Change', primary: true, cmd: cmdOf(), onClick: async (close) => {
      close();
      const r = await cx.approval({ title: `Set the ${a.name} allowance to ${fmt.usdc(model.monthly)} a month`, from: `${cx.deptName(a.parent)} budget`, to: `${a.name} allowance`, amount: model.monthly, gbp: gbpOf(model.monthly), rate: RATE, signer: cx.meId(), hat: hatFor(a.parent), cmd: cmdOf() });
      if (r.status !== 'done') return;
      const m = allowanceMonth(a); const delta = model.monthly - a.monthly; a.monthly = model.monthly; if (m) { m.amount = model.monthly; m.left = r2(m.left + delta); }
      cx.toast(`${a.name} is now ${fmt.usdc(model.monthly)} a month.`, { tone: 'success', cmd: cmdOf() }); cx.refresh();
    } }] });
}
cx.route('allowance', (ctx) => {
  const a = cx.find(D.allowances, 'id', ctx.id);
  if (!a) return cx.page({ title: 'Not found', body: cx.empty('No such allowance', cx.btn('Allowances', { href: ['allowances'] })) });
  const m = allowanceMonth(a) || { amount: a.monthly, spent: 0, left: a.monthly };
  const pays = M.payments.filter((p) => p.budget === a.id).sort((x, y) => String(whenOf(y)).localeCompare(String(whenOf(x))));
  const may = mayAct(a.id);
  return cx.page({
    title: `${a.name} allowance`, crumbs: [{ label: 'Departments', route: 'departments' }, { label: 'Allowances', route: 'allowances' }],
    status: [cx.pill('Active', 'green', { lg: true })],
    sub: h('span.chips', cx.holders(a.id).map((w) => h('span', cx.personChip(w), ' ', cx.hat(`${a.name} allowance`))), h('span.muted', ` · under ${cx.deptName(a.parent)} · ${fmt.usdc(a.monthly)} a month`)),
    actions: [cx.btn(`Pay from ${a.name}`, { kind: 'primary', icon: 'send', needs: () => may.ok || may.reason, cmd: `capxul payment send <to> <amount> ${ORG} --from ${a.id}`, onClick: () => cx.go('send-money', null, { from: a.id }) })],
    cmd: { cli: `capxul org allowance get ${a.id} ${ORG}`, sdk: `client.org(orgId).allowances.get("${a.id}")`, json: { id: a.id, name: a.name, parent: a.parent, amount: String(a.monthly), period: 'month', holders: cx.holders(a.id), spent: m.spent, left: m.left } },
    body: [
      h('div.ncards', cx.numberCard({ label: 'This month', value: fmt.usdc(m.amount) }), cx.numberCard({ label: 'Spent', value: fmt.usdc(m.spent) }), cx.numberCard({ label: 'Left', value: fmt.usdc(m.left), sub: `refills 1 ${fmt.month(addDays(monthNow + '-28', 4)).split(' ')[0]}` }), cx.numberCard({ label: 'Since', value: fmt.date(a.created), sub: a.purpose })),
      h('div.grid.c2',
        cx.card({ title: 'Spent each month', body: cx.chart.bar({ labels: a.months.map((x) => fmt.monthShort(x.month)), series: [{ name: 'Spent', values: a.months.map((x) => x.spent), color: '1' }], line: { name: 'Allowance', values: a.months.map((x) => x.amount) }, height: 200, format: (v) => fmt.compact(v), tipFormat: (v) => fmt.usdc(v) }) }),
        cx.card({ title: 'Holders', body: h('div', { style: 'display:grid;gap:8px' }, a.holders.map((x) => h('div', cx.personChip(x.who), h('span.muted', ` from ${fmt.date(x.from)}${x.to ? ' to ' + fmt.date(x.to) : ''}`))), h('p.mx-note', 'Only the Board changes who holds an allowance (a Board proposal).')) })),
      cx.card({ title: 'Payments', flush: true, cmd: `capxul payment list ${ORG} --from ${a.id}`, body: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Date'), h('th', 'To'), h('th.opt', 'Approved by'), h('th', 'Status'), h('th.num', 'Amount'))), h('tbody', pays.slice(0, 30).map((p) => h('tr.click', { onclick: () => cx.go('payment', p.id) }, h('td', fmt.date(whenOf(p))), h('td.wrap', p.counterparty, h('div.muted', { style: 'font-size:12px' }, p.memo || '')), h('td.opt', p.approvedBy ? cx.name(p.approvedBy) : '—'), h('td', payPill(p)), h('td.num', fmt.usdc(p.amount))))))) }),
    ],
  });
}, { workspace: 'departments', title: 'Allowance' });

/* payout ceilings */
cx.route('payout-ceilings', () => {
  const rows = [...D.payoutCeilings].sort((a, b) => b.year - a.year);
  const cur = ceiling();
  const act = (label, title, calls, cmd, danger) => cx.btn(label, { kind: danger ? 'danger' : null, needs: 'Director', cmd, onClick: async () => { if (danger && !(await cx.confirm({ title, body: 'Every department and allowance stops paying out in USDC until the Directors unfreeze it. Agreements don\'t end.', cmd, who: 'the Board (a Board proposal)', danger: true, confirmLabel: 'Propose the freeze' }))) return; await boardAsk({ title, calls, cmd }); } });
  return cx.page({
    title: 'Payout ceilings', crumbs: [{ label: 'Departments', route: 'departments' }],
    actions: [act('Freeze', 'Freeze USDC payouts', ['Roles: freeze the USDC payout ceiling, leave 0'], `capxul org department ceiling freeze --token USDC --leave 0 ${ORG}`, true), act('Set', `Set the USDC payout ceiling to 2,400,000 a year`, ['Roles: resize the USDC payout ceiling to 2,400,000.00'], `capxul org department ceiling set --token USDC --amount 2400000/year ${ORG}`)],
    cmd: { cli: `capxul org department ceiling set --token USDC --amount ${cur.ceiling}/year ${ORG}`, note: 'Set, freeze and unfreeze are Board proposals.' },
    banner: cx.banner('The most that can leave the Treasury through departments and allowances each year, per token: the company\'s brake. Board proposals are not counted against it.', { tone: 'info' }),
    body: [
      cx.card({ title: `USDC · ${cur.year}`, body: h('div', { style: 'display:grid;gap:10px' }, cx.chart.meter({ total: cur.ceiling, parts: [{ label: 'Used', value: cur.used }], warnAt: 0.85, format: (v) => fmt.usdc(v, 0) }), h('p.mx-note', `${fmt.usdc(cur.left)} left of ${fmt.usdc(cur.ceiling)}. Raising Harbourline's budget (proposal sp_0194) also resizes the ceiling to 2,400,000.00.`)) }),
      cx.card({ flush: true, body: h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Token'), h('th', 'Year'), h('th.num', 'Ceiling'), h('th.num', 'Used'), h('th.num', 'Left'), h('th', 'Frozen'))), h('tbody', rows.map((c) => h('tr', h('td', h('b', c.token)), h('td', String(c.year)), h('td.num', fmt.num(c.ceiling, 2)), h('td.num', fmt.num(c.used, 2)), h('td.num', h('b', fmt.num(c.left, 2))), h('td', c.frozen ? cx.pill('Frozen', 'red') : 'No'))))) ) }),
    ],
  });
}, { workspace: 'departments', title: 'Payout ceilings' });

/* =====================================================================================================
   Search
   ===================================================================================================== */

cx.search.add((qs, limit) => {
  const t = qs.toLowerCase();
  const out = [];
  for (const p of M.payments) {
    if (out.length >= limit) break;
    if (p.id.toLowerCase().includes(t) || String(p.counterparty).toLowerCase().includes(t) || String(p.memo || '').toLowerCase().includes(t)) out.push({ kind: 'Payments', label: `${p.direction === 'in' ? 'From' : 'To'} ${p.counterparty} · ${fmt.usdc(p.amount)}`, sub: `${statusText(p)} · ${fmt.date(whenOf(p))}`, route: 'payment', id: p.id, icon: 'money' });
  }
  for (const d of M.deposits) if (out.length < limit * 2 && (d.from.toLowerCase().includes(t) || d.reference.toLowerCase().includes(t) || d.id.toLowerCase().includes(t))) out.push({ kind: 'Bank', label: `Deposit from ${depFrom(d)} · ${fmt.money(d.bankAmount, d.currency)}`, sub: `${d.status} · ${fmt.date(d.receivedAt)}`, route: 'deposit', id: d.id, icon: 'in' });
  for (const x of M.payouts) if (out.length < limit * 3 && (x.to.toLowerCase().includes(t) || x.id.toLowerCase().includes(t))) out.push({ kind: 'Bank', label: `Payout to ${x.to} · ${fmt.money(x.bankAmount, x.currency)}`, sub: `${x.status} · ${fmt.date(x.quotedAt)}`, route: 'payout', id: x.id, icon: 'out' });
  for (const e of M.escrows) if (e.email.includes(t)) out.push({ kind: 'Money waiting', label: `${e.email} · ${fmt.usdc(e.amount)}`, sub: e.status, route: 'payment', id: e.payment, icon: 'hourglass' });
  return out;
});

/* =====================================================================================================
   Shared with governance.js and fde.js (read at call time: every module has loaded before anyone clicks)
   ===================================================================================================== */

const CAPXUL_PAYEE = M.payments.find((p) => p.payee?.id === 'capxul')?.payee || { type: 'Supplier', id: 'capxul', name: 'Capxul', handle: '@capxul', email: 'billing@capxul.com' };
/** Pay from a budget the viewer holds: their approval, then a settled payment with its proof. → the payment, or null. */
async function payFromBudget({ title, to, payee, amount, budget, memo, purpose = 'supplier', cmd, warnings, allocations = [] }) {
  const id = cx.newId('payment');
  const r = await cx.approval({ title, from: `Harbourline Treasury · ${fmt.addr(T.address)} · ${cx.deptName(budget)}`, to: to || payee.name, amount, gbp: gbpOf(amount), rate: RATE, signer: cx.meId(), hat: hatFor(budget), warnings, cmd, next: `capxul payment wait ${id}` });
  if (r.status !== 'done') return null;
  const p = { id, direction: 'out', kind: 'payment', status: 'Prepared', outcome: null, purpose, route: isAllowance(budget) ? 'allowance' : 'department', budget, counterparty: payee.name, payee: { type: 'Supplier', ...payee }, payer: { type: 'Self', name: D.company.name, safe: T.address, label: 'Treasury' }, amount, asset: 'USDC', amountRaw: String(Math.round(amount * 1e6)), gbp: gbpOf(amount), rate: RATE, fee: 0, createdAt: r.at, preparedBy: cx.meId(), proposal: null, batch: null, memo: memo || null, account: null, proof: null, books: null, voucher: null };
  M.payments.push(p);
  await settleOut(p, r, { allocations, desc: payee.name });
  addEvent(`${cx.name(cx.meId())} paid ${payee.name} ${fmt.usdc(amount)} from ${cx.deptName(budget)}${memo ? ' (' + memo + ')' : ''}`, { type: 'payment', id });
  return p;
}
cx.native = Object.assign(cx.native || {}, {
  ORG, RATE, gbpOf, stamp, creditDeposit, watchArrival, boardAsk, proposeToBoard, payFromBudget, CAPXUL_PAYEE, addEvent, addNotice, dropWaiting, pushTable,
  payableBudgets, mayAct, hatFor, whoMay, leftOf, isAllowance, payPill, findPayment, approvePrepared, takeBack, cancelScheduled, schedRec, escrowOf, payoutOf,
});
