// HR: employees, departments and designations, holidays, leave, attendance and check-ins, shift types, expense claims
// and advances, and every employee's own side (My HR). payroll.js imports the shared parts exported here.
import { cx, h } from './core.js';

const D = cx.data;
const fmt = cx.fmt;
const H = D.hr;

/* =====================================================================================================
   Shared helpers
   ===================================================================================================== */

export const round2 = (n) => Math.round((+n + Number.EPSILON) * 100) / 100;
export const sum = (arr, f) => arr.reduce((a, x) => a + (+(f ? f(x) : x) || 0), 0);
export const emp = (id) => (id == null ? null : D.people.find((p) => p.id === id || p.employee === id) || null);
export const empNo = (id) => emp(id)?.employee || id;
export const empName = (id) => emp(id)?.name || cx.name(id);
export const empLink = (id, text) => { const e = emp(id); return e ? cx.link(text || e.name, 'employee', e.employee) : h('span', cx.name(id)); };
export const deptLink = (id) => (id ? cx.link(cx.deptName(id), 'hr-department', id) : null);
export const hatHolders = (deptId) => cx.holders(deptId).filter((x) => !String(x).startsWith('@'));
export const wearersOf = (hat) => D.people.filter((p) => (p.hats || []).includes(hat)).map((p) => p.id);
export const namesList = (ids) => { const n = ids.map(cx.name); return n.length <= 1 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + n.at(-1); };
export const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export const eachDay = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };
export const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
export const weekdayOf = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
const toObjs = (t) => t.rows.map((r) => Object.fromEntries(t.cols.map((c, i) => [c, r[i]])));
let ATT = null; let CKIN = null;
export const attendance = () => (ATT ||= toObjs(H.attendance));
export const checkins = () => (CKIN ||= toObjs(H.checkins));
const holidayIdx = new Map();
for (const hl of H.holidayLists) for (const x of hl.holidays) holidayIdx.set(x.date, x);
export const holidayOn = (d) => holidayIdx.get(d) || ([0, 6].includes(weekdayOf(d)) ? { date: d, description: weekdayOf(d) ? 'Saturday' : 'Sunday', weeklyOff: true } : null);
export const workingDaysIn = (a, b) => eachDay(a, b).filter((d) => !holidayOn(d));
export const paidTo = (e) => (!e ? '' : e.agreement || e.employmentType === 'Contract' ? 'Safe (pay agreement)' : e.salaryMode === 'Bank' ? 'Bank' : 'Safe');
export const paidToLong = (e) => (!e ? '' : e.salaryMode === 'Bank' && e.bank ? `Bank through Bridge · ${e.bank.name} ·· ${e.bank.account.slice(-4)}` : e.safe ? `Capxul Safe · ${fmt.addr(e.safe)}` : 'Capxul Safe');
export const isMine = (rec) => rec && (rec.employee === cx.meId() || rec.id === cx.meId());
const T = (status, map) => ({ text: status, tone: map[status] || cx.toneOf(status) });
export const LEAVE_TONE = { Open: 'orange', Approved: 'green', Rejected: 'red', Cancelled: 'red', Draft: 'red' };
export const CLAIM_TONE = { Draft: 'red', Open: 'orange', Unpaid: 'orange', Paying: 'blue', Paid: 'green', Rejected: 'red', Cancelled: 'red' };
export const ADV_TONE = { Requested: 'orange', Paying: 'blue', Paid: 'green', Claimed: 'green', Returned: 'gray', 'Partly Claimed and Returned': 'yellow', Rejected: 'red', Cancelled: 'red' };
const ATT_TONE = { Present: 'green', 'Work From Home': 'green', Absent: 'red', 'On Leave': 'red', 'Half Day': 'orange' };
const peopleHat = () => namesList(wearersOf('People'));
const plainHat = (d) => cx.deptName(d);

/** Without a seat, Capxul shows a person only their own records. */
export function seatGate(title, ws = 'hr') {
  if (cx.hasSeat()) return null;
  const me = cx.me();
  return cx.page({
    title, workspace: ws,
    cmd: { cli: 'capxul hr leave list', who: 'any employee, with or without a seat', note: 'An employee needs no seat for their own records.' },
    body: cx.card({ body: h('div', { style: 'display:grid;gap:10px;max-width:62ch' },
      h('p', h('b', `${me.name} has no seat at Harbourline.`), ` Without a seat Capxul shows ${me.firstName}'s own records only: leave, attendance, check-ins, expense claims, advances and payslips. Everyone else's are not shown.`),
      h('p.muted', `A seat is offered by whoever wears the People hat (${peopleHat()}).`),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, cx.btn('My HR', { kind: 'primary', href: ['me'] }), cx.btn('My leave', { href: ['me-leave'] }), cx.btn('My payslips', { href: ['me-payslips'] }))) }),
  });
}

/** Leave is decided by whoever wears the employee's department's hat or one above it, or People; never by the applicant. */
export function leaveDecision(l) {
  const e = emp(l.employee); const me = cx.meId();
  const dName = plainHat(e.department);
  if (l.employee === me) return { ok: false, reason: `You can't decide your own leave. Someone who wears the ${dName} hat or one above it, or People, decides it.` };
  const held = [e.department, ...cx.ancestors(e.department)].find((d) => cx.holders(d).includes(me));
  if (held) return { ok: true, hat: plainHat(held) };
  if (cx.wears('People')) return { ok: true, hat: 'People' };
  return { ok: false, reason: `Needs the ${dName} hat or one above it, or People. ${namesList(hatHolders(e.department))} wears ${dName} now; ${peopleHat()} wear People.` };
}
/** Claims and advances are decided and paid on the department's budget: its hat or one above it; never by the claimant. */
export function budgetDecision(rec, noun = 'claim') {
  const dept = rec.department || emp(rec.employee)?.department; const me = cx.meId();
  if (rec.employee === me) return { ok: false, reason: `You can't decide or pay your own ${noun}. Whoever wears the ${plainHat(dept)} hat or one above it does.` };
  const held = [dept, ...cx.ancestors(dept)].find((d) => cx.holders(d).includes(me));
  if (held) return { ok: true, hat: plainHat(held), dept: held };
  return { ok: false, reason: `Needs the ${plainHat(dept)} hat or one above it, on ${plainHat(dept)}'s budget. ${namesList(hatHolders(dept))} wears it now.` };
}
export const asNeed = (fn) => () => { const d = fn(); return d.ok || d.reason; };
/** A report view whose filters keep their width on a phone. */
export const repView = (o) => { const n = cx.reportView(o); n.classList.add('hr-rep'); return n; };

/** The leave each type has on a day: allocated, used, pending, available (as the allocated-leaves table shows it). */
export function leaveDetails(id, on = cx.today) {
  const order = H.leaveTypes.map((t) => t.name);
  return H.leaveAllocations
    .filter((a) => a.employee === id && a.status !== 'Cancelled' && a.fromDate <= on && a.toDate >= on)
    .sort((a, b) => order.indexOf(a.leaveType) - order.indexOf(b.leaveType))
    .map((a) => {
      const apps = H.leaveApplications.filter((l) => l.employee === id && l.leaveType === a.leaveType && l.fromDate >= a.fromDate && l.fromDate <= a.toDate);
      const used = sum(apps.filter((l) => l.status === 'Approved'), (l) => l.totalLeaveDays);
      const pending = sum(apps.filter((l) => l.status === 'Open'), (l) => l.totalLeaveDays);
      return { leaveType: a.leaveType, totalAllocated: a.totalLeavesAllocated, expired: 0, used, pending, available: round2(a.totalLeavesAllocated - used), alloc: a };
    });
}
export function leaveTable(rows) {
  return cx.grid({ numbered: false, columns: [
    { key: 'leaveType', label: 'Leave type' }, { key: 'totalAllocated', label: 'Total allocated', type: 'float', dp: 1 }, { key: 'expired', label: 'Expired', type: 'float', dp: 1, opt: true },
    { key: 'used', label: 'Used', type: 'float', dp: 1 }, { key: 'pending', label: 'Pending approval', type: 'float', dp: 1, opt: true },
    { key: 'available', label: 'Available', type: 'float', dp: 1, render: (r) => h('b', { style: `color:var(${r.available > 0 ? '--pos' : '--neg'})` }, fmt.num(r.available, 1)) },
  ], rows, empty: 'No leave allocated' });
}

/* ---------- money: a payment to an employee, with its proof ---------- */

const PAYER_PARTY = D.money.payments.find((p) => p.payer?.type === 'Self' && p.proof?.advice?.payer?.party)?.proof.advice.payer.party || '0x999470e2e354e0a2024b593ecef2e82aa5c3e96c';
const counters = {};
/** The next free record name in a series, e.g. nextName('ACC-PAY-2026-', names) → 'ACC-PAY-2026-00422'. */
export function nextName(prefix, names, pad = 5) {
  if (counters[prefix] == null) counters[prefix] = Math.max(0, ...names.filter((n) => n && String(n).startsWith(prefix)).map((n) => +String(n).slice(prefix.length) || 0));
  counters[prefix] += 1;
  return prefix + String(counters[prefix]).padStart(pad, '0');
}
const voucherNames = () => [...D.money.payments.map((p) => p.voucher), ...(D.books.vouchers || []).map((v) => v.name || v.voucher)];
export const payeeOf = (id) => D.money.payments.find((p) => p.payee?.id === id && p.payee.party)?.payee || null;
/**
 * Make a settled payment from the Treasury to an employee for one document, with its advice and document hash (really
 * hashed, so Verify passes). o: { empId, gbp, purpose, budget, docKind, doc, date, content, lines, approval, at, tx, block, hat, batch }
 */
export async function makePayment(o) {
  const e = emp(o.empId);
  const rate = cx.rate(cx.today);
  const bank = e.salaryMode === 'Bank' && e.bank;
  const fee = bank ? round2(Math.max(0.5, (o.gbp / rate) * 0.00066)) : 0;
  const amount = round2(o.gbp / rate + fee);
  const id = cx.newId('payment');
  const prev = payeeOf(e.id);
  const party = prev?.party || cx.randHex(20);
  const advice = {
    version: 1, origin: id, salt: cx.randHex(16),
    payer: { party: PAYER_PARTY, account: D.company.treasury },
    payee: { party, account: bank ? 'bridge:' + e.bank.account.slice(-4) : e.safe },
    token: 'USDC', amount: String(Math.round(amount * 1e6)),
    cash: { currency: 'GBP', decimals: 2, amount: Math.round(o.gbp * 100), rate },
    allocations: [{ doctype: o.docKind, doc: o.doc, currency: 'GBP', number: o.doc, date: o.date, content: o.content, allocated: Math.round(o.gbp * 100), lines: o.lines }],
    adjustments: fee ? [{ kind: 'fee', by: 'Bridge', amount: String(Math.round(fee * 1e6)) }] : [],
    onAccount: 0, memo: '', refundOf: '0x0',
    route: { kind: 'department', budget: o.budget, payAt: 0, ...(bank ? { payout: { bankAmount: Math.round(o.gbp * 100), currency: 'GBP', rail: 'Faster Payments' } } : {}) },
    batch: o.batch ? { id: o.batch.id, index: o.batch.index, count: o.batch.count } : null,
  };
  const documentHash = await cx.hashOf(advice);
  const at = o.at || new Date(cx.now.getTime() + 60000).toISOString();
  const voucher = nextName('ACC-PAY-2026-', voucherNames());
  const p = {
    id, direction: 'out', kind: 'payment', status: 'Settled', outcome: null, purpose: o.purpose, route: 'department', budget: o.budget,
    counterparty: e.name, payee: { type: 'Employee', id: e.id, name: e.name, email: e.payMailbox, safe: bank ? null : e.safe, party, bank: bank ? { bankName: e.bank.name, last4: e.bank.account.slice(-4), sortCode: e.bank.sortCode } : null },
    payer: { type: 'Self', name: D.company.name, safe: D.company.treasury, label: 'Treasury' },
    amount, asset: 'USDC', amountRaw: advice.amount, gbp: o.gbp, rate, fee, createdAt: at, sentAt: at, settledAt: at,
    approval: o.approval, approvedBy: cx.meId(), approvedHat: o.hat, preparedBy: cx.meId(), proposal: null,
    batch: o.batch ? { id: o.batch.id, label: o.batch.label, index: o.batch.index, count: o.batch.count } : null, memo: null, account: null,
    proof: { network: 'Base', chainId: 8453, paymentId: cx.randHex(32), documentHash, tx: o.tx || cx.randHex(32), block: o.block || cx.blockAt(at), logIndex: 1 + Math.floor(Math.random() * 240), settledThrough: `Budgets (${o.budget})`, finality: 'Final', advice },
    books: voucher, voucher,
  };
  D.money.payments.push(p);
  const b = cx.budgetOn(o.budget);
  if (b) { b.spent = round2(b.spent + amount); b.left = round2(b.left - amount); }
  D.events.unshift({ at, kind: 'Money', text: `${cx.name(cx.meId())} paid ${e.name} ${fmt.usdc(amount)} (${fmt.gbp(o.gbp)}) for ${o.doc}`, ref: { type: 'payment', id }, who: cx.meId() });
  return p;
}
export const paymentOf = (id) => (id ? D.money.payments.find((p) => p.id === id) || null : null);
export function dropApproval(refId) {
  if (D.approvals?.waiting) D.approvals.waiting = D.approvals.waiting.filter((a) => a.ref?.id !== refId);
  for (const n of D.notices || []) if (n.ref?.id === refId) n.read = true;
}
export const nowIso = () => new Date(cx.now.getTime() + 60000).toISOString();
const sideOf = (rec, extra = {}) => ({ assigned: [], attachments: [], tags: [], ...extra });

/* =====================================================================================================
   Workspace and navigation (a person with no seat sees My HR only)
   ===================================================================================================== */

const openLeave = () => H.leaveApplications.filter((l) => l.status === 'Open');
const mineToDecide = () => [...openLeave().filter((l) => leaveDecision(l).ok), ...H.expenseClaims.filter((c) => c.status === 'Open' && budgetDecision(c).ok), ...H.advances.filter((a) => a.status === 'Requested' && budgetDecision(a, 'advance').ok)];
function registerHr() {
  const my = [
    { label: 'My HR', route: 'me' },
    { label: 'My attendance', route: 'me-attendance' },
    { label: 'My leave', route: 'me-leave' },
    { label: 'My expenses', route: 'me-expenses' },
    { label: 'My payslips', route: 'me-payslips', match: ['me-payslip'] },
  ];
  const nav = cx.hasSeat() ? [
    { label: 'Home', route: 'hr' },
    { label: 'Employees', route: 'employees', match: ['employee', 'employee-new'] },
    { label: 'Organisation chart', route: 'org-chart' },
    { section: 'Leave', items: [
      { label: 'Leave home', route: 'leave-home' },
      { label: 'Leave', route: 'leaves', match: ['leave', 'leave-new'], badge: () => openLeave().length || null },
      { label: 'Leave calendar', route: 'leave-calendar' },
      { label: 'Leave allocations', route: 'leave-allocations', match: ['leave-allocation'] },
      { label: 'Leave balance', route: 'leave-balance' },
      { label: 'Leave balance summary', route: 'leave-balance-summary' },
    ] },
    { section: 'Attendance', collapsed: true, items: [
      { label: 'Attendance home', route: 'attendance-home' },
      { label: 'Attendance', route: 'attendance', match: ['attendance-record'] },
      { label: 'Check-ins', route: 'checkins', match: ['checkin'] },
      { label: 'Monthly attendance sheet', route: 'attendance-sheet' },
      { label: 'Shift types', route: 'shift-types', match: ['shift-type'] },
      { label: 'Shift assignments', route: 'shift-assignments', match: ['shift-assignment'] },
    ] },
    { section: 'Expenses', collapsed: true, items: [
      { label: 'Expenses home', route: 'expenses' },
      { label: 'Expense claims', route: 'expense-claims', match: ['expense-claim', 'expense-claim-new'], badge: () => H.expenseClaims.filter((c) => c.status === 'Open').length || null },
      { label: 'Advances', route: 'advances', match: ['advance', 'advance-new'] },
      { label: 'Unpaid expense claims', route: 'unpaid-claims' },
    ] },
    { section: 'Setup', collapsed: true, items: [
      { label: 'Departments', route: 'hr-departments', match: ['hr-department'] },
      { label: 'Designations', route: 'designations', match: ['designation'] },
      { label: 'Holidays', route: 'holidays', match: ['holiday-list'] },
      { label: 'Leave types', route: 'leave-types', match: ['leave-type'] },
      { label: 'Expense types', route: 'expense-types', match: ['expense-type'] },
      { label: 'HR configuration', route: 'hr-config' },
    ] },
    { section: 'My HR', collapsed: true, items: my },
  ] : my;
  cx.workspace({ id: 'hr', label: 'HR', icon: 'hr', route: 'hr', seatless: true, nav, badge: () => (cx.hasSeat() ? mineToDecide().length || null : null) });
}
registerHr();
cx.on('persona', registerHr);

/* =====================================================================================================
   Styles (tokens only)
   ===================================================================================================== */

cx.style('hr', `
.hr-app { width: 100%; max-width: 460px; margin: 0 auto; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--bg); overflow: hidden; display: grid; min-width: 0; }
.hr-app-top { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--surface); border-bottom: 1px solid var(--line); }
.hr-app-top b { font: 600 15px/1.2 var(--font-ui); font-stretch: var(--wide); flex: 1; }
.hr-app-body { padding: 14px; display: grid; gap: 14px; min-width: 0; }
.hr-tabbar { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-top: 1px solid var(--line); background: var(--surface); }
.hr-tabbar a { display: grid; justify-items: center; gap: 3px; padding: 8px 2px 9px; font-size: 11px; color: var(--muted); text-decoration: none; }
.hr-tabbar a.on { color: var(--accent); font-weight: 600; }
.hr-tabbar a:hover { background: var(--hover); }
.hr-panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 12px; display: grid; gap: 10px; min-width: 0; }
.hr-panel h3 { font: 600 13.5px/1.3 var(--font-ui); margin: 0; display: flex; align-items: center; gap: 8px; }
.hr-panel h3 .grow { flex: 1; }
.hr-hello { font: 600 19px/1.25 var(--font-ui); font-stretch: var(--wide); margin: 0; }
.hr-quick { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.hr-quick a, .hr-quick button { display: flex; align-items: center; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); color: var(--fg); text-decoration: none; font: 500 13px/1.25 var(--font-ui); text-align: left; cursor: pointer; min-width: 0; }
.hr-quick a:hover, .hr-quick button:hover { background: var(--hover); }
.hr-row { display: flex; gap: 10px; align-items: center; padding: 9px 0; border-top: 1px solid var(--line); min-width: 0; }
.hr-row:first-child { border-top: 0; }
.hr-row .grow { flex: 1; min-width: 0; }
.hr-row .t { font-weight: 600; font-size: 13px; overflow-wrap: anywhere; }
.hr-row .s { font-size: 12px; color: var(--muted); }
.hr-row.click { cursor: pointer; }
.hr-row.click:hover .t { color: var(--link); }
.hr-gauges { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
.hr-gauge { display: grid; justify-items: center; gap: 2px; padding: 8px 6px; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); text-align: center; }
.hr-gauge b { font: 600 15px/1.2 var(--font-ui); font-variant-numeric: tabular-nums; }
.hr-gauge small { font-size: 11.5px; color: var(--muted); }
.hr-cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 3px; }
.hr-cal .wd { font-size: 11px; color: var(--muted); text-align: center; padding: 2px 0; }
.hr-cal .d { min-height: 34px; border-radius: 6px; display: grid; place-items: center; font-size: 12.5px; font-variant-numeric: tabular-nums; background: var(--surface-2); color: var(--fg-2); }
.hr-cal .d.out { background: transparent; }
.hr-cal .d.P { background: var(--t-green-bg); color: var(--t-green); font-weight: 600; }
.hr-cal .d.WFH { background: var(--t-blue-bg); color: var(--t-blue); font-weight: 600; }
.hr-cal .d.A { background: var(--t-red-bg); color: var(--t-red); font-weight: 600; }
.hr-cal .d.L { background: var(--t-orange-bg); color: var(--t-orange); font-weight: 600; }
.hr-cal .d.HD { background: var(--t-yellow-bg); color: var(--t-yellow); font-weight: 600; }
.hr-cal .d.H { background: var(--sunk); color: var(--faint); }
.hr-cal .d.today { outline: 2px solid var(--accent); outline-offset: -2px; }
.hr-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 12px; color: var(--muted); }
.hr-legend span { display: inline-flex; align-items: center; gap: 5px; }
.hr-legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.hr-mcal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: 1px solid var(--line); border-left: 1px solid var(--line); background: var(--surface); }
.hr-mcal .wd { padding: 6px 8px; font-size: 11.5px; color: var(--muted); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--surface-2); }
.hr-mcal .c { min-height: 96px; padding: 4px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); display: grid; align-content: start; gap: 2px; min-width: 0; }
.hr-mcal .c.off { background: var(--surface-2); }
.hr-mcal .c.other { opacity: .45; }
.hr-mcal .c .n { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; display: flex; justify-content: space-between; gap: 4px; }
.hr-mcal .c.today .n b { color: var(--accent-fg); background: var(--accent); border-radius: 4px; padding: 0 4px; }
.hr-mcal .hol { font-size: 11px; color: var(--t-purple); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hr-mcal a.ev { display: block; font-size: 11.5px; line-height: 1.3; padding: 1px 5px; border-radius: 4px; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: var(--t-green-bg); color: var(--t-green); }
.hr-mcal a.ev.Open { background: var(--t-orange-bg); color: var(--t-orange); }
@media (max-width: 700px) { .hr-mcal .c { min-height: 58px; padding: 2px; } .hr-mcal a.ev { font-size: 10px; padding: 0 3px; } .hr-mcal .hol { display: none; } .hr-mcal .wd { padding: 4px 2px; text-align: center; } }
.as-cell { display: inline-block; min-width: 30px; text-align: center; padding: 1px 3px; border-radius: 4px; font: 600 11px/1.5 var(--font-mono); }
.as-P { background: var(--t-green-bg); color: var(--t-green); }
.as-WFH { background: var(--t-blue-bg); color: var(--t-blue); }
.as-A { background: var(--t-red-bg); color: var(--t-red); }
.as-L { background: var(--t-orange-bg); color: var(--t-orange); }
.as-HD { background: var(--t-yellow-bg); color: var(--t-yellow); }
.as-H, .as-WO { color: var(--faint); }
.hr-ov-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr)); padding: 16px; }
.hr-org { display: grid; gap: 4px; }
.hr-org-node { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); min-width: 0; }
.hr-org-node .grow { flex: 1; min-width: 0; }
.hr-org-node .t { font-weight: 600; font-size: 13px; }
.hr-org-node .s { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.hr-org-kids { margin-left: 18px; padding-left: 12px; border-left: 1px dashed var(--line-2); display: grid; gap: 4px; }
.hr-sheet-pick { display: grid; gap: 8px; }
.hr-sheet-pick label { display: flex; gap: 8px; align-items: center; font-size: 13px; }
.hr-clock { font: 600 28px/1.1 var(--font-mono); font-variant-numeric: tabular-nums; }
@media (max-width: 640px) { .hr-rep .lv-bar > label { width: calc(50% - 3px); min-width: 0; } .hr-rep .lv-bar > label > .ctl { width: 100%; } }
@media (max-width: 520px) { .hr-app { border: 0; border-radius: 0; background: transparent; } .hr-app-body { padding: 0; } .hr-app-top { border: 1px solid var(--line); border-radius: var(--r); } .hr-tabbar { border: 1px solid var(--line); border-radius: var(--r); } }
`);

/* =====================================================================================================
   HR workspace
   ===================================================================================================== */

const active = () => D.people.filter((p) => p.status === 'Active');
const quarterOf = (d) => { const [y, m] = d.split('-').map(Number); const q = Math.floor((m - 1) / 3); return [`${y}-${String(q * 3 + 1).padStart(2, '0')}-01`, monthEnd(`${y}-${String(q * 3 + 3).padStart(2, '0')}`)]; };
const onLeaveOn = (d) => H.leaveApplications.filter((l) => l.status === 'Approved' && l.fromDate <= d && l.toDate >= d);

cx.route('hr', () => {
  if (!cx.hasSeat()) return notEmployee('My HR') || mePage();
  const [qs, qe] = quarterOf(cx.today);
  const act = active();
  const byDept = D.departments.map((d) => ({ d, n: act.filter((p) => p.department === d.id).length })).filter((x) => x.n);
  const joined = D.people.filter((p) => p.dateOfJoining >= qs && p.dateOfJoining <= qe);
  const relieved = D.people.filter((p) => p.relievingDate && p.relievingDate >= qs && p.relievingDate <= qe);
  const out = onLeaveOn(cx.today);
  const weekEnd = addDays(cx.today, 4);
  const outWeek = H.leaveApplications.filter((l) => l.status === 'Approved' && l.fromDate <= weekEnd && l.toDate >= cx.today);
  const headcount = [];
  for (let m = '2025-05'; m <= cx.today.slice(0, 7); m = addDays(m + '-01', 32).slice(0, 7)) headcount.push([m, D.people.filter((p) => p.dateOfJoining <= monthEnd(m) && (!p.relievingDate || p.relievingDate >= monthEnd(m))).length]);
  return cx.workspacePage({
    title: 'HR', workspace: 'hr',
    cmd: { cli: 'capxul org hr employee list', who: 'anyone with a seat reads; People keeps the records', json: { count: act.length, active: act.length } },
    actions: [cx.btn('Add employee', { kind: 'primary', icon: 'plus', href: ['employee-new'], cmd: 'capxul org hr employee add <email> --first-name … --last-name … --joined …' })],
    cards: [
      { label: 'Total employees', value: fmt.int(act.length), sub: `${act.filter((p) => p.employmentType === 'Full-time').length} full-time · ${act.filter((p) => p.employmentType === 'Contract').length} contractor`, href: ['employees'], cmd: 'capxul org hr employee list --status active', spark: headcount.map((x) => x[1]) },
      { label: 'Employees joining (this quarter)', value: fmt.int(joined.length), sub: joined.map((p) => p.name).join(', ') || 'Nobody', href: ['employees'], cmd: `capxul org hr employee list --joined-after ${qs}` },
      { label: 'Employees relieving (this quarter)', value: fmt.int(relieved.length), sub: relieved.map((p) => p.name).join(', ') || 'Nobody', cmd: 'capxul org hr employee list --status left' },
      { label: 'On leave today', value: fmt.int(out.length), sub: out.map((l) => empName(l.employee)).join(', ') || 'Nobody', href: ['leave-calendar'], cmd: `capxul org hr leave list --status approved --on ${cx.today}` },
    ],
    charts: [
      { title: 'Department wise employee count', cmd: 'capxul org hr employee list --status active --group-by department', node: cx.chart.donut({ items: byDept.map((x, i) => ({ label: x.d.name, value: x.n, color: String((i % 6) + 1) })), center: String(act.length), format: (v) => fmt.int(v) }) },
      { title: 'Headcount, month by month', node: cx.chart.line({ labels: headcount.map((x) => fmt.monthShort(x[0]) + (x[0].endsWith('-01') ? ' ' + x[0].slice(2, 4) : '')), series: [{ name: 'Employees', values: headcount.map((x) => x[1]) }], area: true, format: (v) => fmt.int(v) }) },
    ],
    shortcuts: [
      { label: 'Employees', route: 'employees', count: act.length, icon: 'user' },
      { label: 'Leave waiting for a decision', route: 'leaves', count: openLeave().length, tone: 'orange', icon: 'calendar' },
      { label: 'Expense claims to approve', route: 'expense-claims', count: H.expenseClaims.filter((c) => c.status === 'Open').length, tone: 'orange', icon: 'file' },
      { label: 'Checked in today', route: 'checkins', count: checkins().filter((c) => c.time.startsWith(cx.today) && c.logType === 'IN').length, icon: 'clock' },
      { label: 'Payroll', route: 'payroll', icon: 'payroll' },
      { label: 'My HR', route: 'me', icon: 'hr' },
    ],
    quick: [
      { title: 'Out this week', cmd: `capxul org hr leave list --status approved --start ${cx.today} --end ${weekEnd}`, items: outWeek.length ? outWeek.map((l) => ({ label: `${empName(l.employee)} · ${l.leaveType}`, sub: `${fmt.day(l.fromDate)}${l.toDate !== l.fromDate ? ' to ' + fmt.day(l.toDate) : ''} · ${fmt.num(l.totalLeaveDays, 1)} d`, route: 'leave', id: l.name })) : [{ label: 'Nobody is out this week' }] },
      { title: 'Recent joiners', items: [...D.people].sort((a, b) => b.dateOfJoining.localeCompare(a.dateOfJoining)).slice(0, 5).map((p) => ({ label: p.name, sub: `${p.designation} · ${cx.deptName(p.department)}`, right: fmt.date(p.dateOfJoining), route: 'employee', id: p.employee })) },
    ],
    links: [
      { title: 'Employees', items: [{ label: 'Employee', route: 'employees', count: D.people.length }, { label: 'Organisation chart', route: 'org-chart' }, { label: 'Departments', route: 'hr-departments' }, { label: 'Designations', route: 'designations', count: H.designations.length }] },
      { title: 'Leave', items: [{ label: 'Leave', route: 'leaves', count: H.leaveApplications.length }, { label: 'Leave allocation', route: 'leave-allocations' }, { label: 'Holidays', route: 'holidays' }, { label: 'Leave type', route: 'leave-types' }, { label: 'Leave balance', route: 'leave-balance', kind: 'report' }] },
      { title: 'Attendance', items: [{ label: 'Attendance', route: 'attendance' }, { label: 'Check-in', route: 'checkins' }, { label: 'Shift type', route: 'shift-types' }, { label: 'Monthly attendance sheet', route: 'attendance-sheet', kind: 'report' }] },
      { title: 'Expenses', items: [{ label: 'Expense claim', route: 'expense-claims', count: H.expenseClaims.length }, { label: 'Advance', route: 'advances', count: H.advances.length }, { label: 'Expense type', route: 'expense-types' }, { label: 'Unpaid expense claims', route: 'unpaid-claims', kind: 'report' }] },
    ],
  });
}, { workspace: 'hr', title: 'HR' });

/* =====================================================================================================
   Employees
   ===================================================================================================== */

const empTone = { Active: 'green', Inactive: 'red', Suspended: 'orange', Left: 'gray' };
cx.route('employees', (ctx) => {
  const g = seatGate('Employees'); if (g) return g;
  const list = cx.listView({
    key: 'employees', rows: () => D.people, id: (r) => r.employee, noun: 'employee',
    titleCol: { key: 'name', label: 'Full name', sub: (r) => r.designation },
    status: (r) => ({ text: r.status, tone: empTone[r.status] }),
    columns: [
      { key: 'department', label: 'Department', get: (r) => cx.deptName(r.department) },
      { key: 'designation', label: 'Designation' },
      { key: 'employmentType', label: 'Employment type' },
      { key: 'paidTo', label: 'Paid to', get: (r) => paidTo(r) },
      { key: 'seat', label: 'Seat', render: (r) => (cx.hasSeat(r.id) ? cx.pill('Seat', 'blue') : h('span.faint', 'No')) },
    ],
    right: { key: 'dateOfJoining', label: 'Date of joining', type: 'date' },
    modified: (r) => r.relievingDate || r.dateOfJoining,
    filters: [
      { key: 'name', label: 'ID', alsoId: true },
      { key: 'department', label: 'Department', type: 'select', options: D.departments.map((d) => [d.id, d.name]), flag: '--department', get: (r) => r.department },
      { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive', 'Suspended', 'Left'], flag: '--status', default: 'Active' },
      { key: 'designation', label: 'Designation', type: 'select' },
    ],
    tabs: [{ label: 'All' }, { label: 'With a seat', filter: (r) => cx.hasSeat(r.id) }, { label: 'Paid to a bank', filter: (r) => r.salaryMode === 'Bank' }, { label: 'Joined this year', filter: (r) => r.dateOfJoining >= '2026-01-01' }],
    sort: { options: [{ key: 'dateOfJoining', label: 'Date of joining' }, { key: 'name', label: 'Full name' }, { key: 'employee', label: 'ID', get: (r) => r.employee }], default: { key: 'dateOfJoining', dir: 'desc' } },
    groupBy: [{ key: 'department', label: 'Department', get: (r) => cx.deptName(r.department) }, { key: 'designation', label: 'Designation' }, { key: 'employmentType', label: 'Employment type' }, { key: 'status', label: 'Status' }],
    href: (r) => ['employee', r.employee],
    bulk: [{ label: 'Export', cmd: 'capxul org hr employee list --json', onClick: (rows) => cx.toast(`${rows.length} employees: this is the command Capxul would run. The mock-up makes no downloads.`, { cmd: 'capxul org hr employee list --json' }) }],
    views: [{ label: 'List', route: 'employees', active: true, icon: 'list' }, { label: 'Organisation chart', route: 'org-chart', icon: 'tree' }],
    cmd: { cli: 'capxul org hr employee list', sdk: 'client.org(orgId).hr.employees.list()', who: 'anyone with a seat' },
  });
  return cx.page({ title: 'Employees', actions: [cx.menu(null, [{ label: 'Organisation chart', href: ['org-chart'], icon: 'tree' }, { label: 'Departments', href: ['hr-departments'] }, { label: 'Export', icon: 'file', cmd: 'capxul org hr employee list --json', onClick: () => cx.toast('This is the command Capxul would run. The mock-up makes no downloads.') }]), cx.btn('Add employee', { kind: 'primary', icon: 'plus', href: ['employee-new'], cmd: 'capxul org hr employee add <email> --first-name … --last-name … --joined …' })], body: list });
}, { workspace: 'hr', title: 'Employees' });

cx.route('org-chart', () => {
  const g = seatGate('Organisation chart'); if (g) return g;
  const kids = (id) => D.people.filter((p) => p.reportsTo === id && p.status === 'Active').sort((a, b) => a.dateOfJoining.localeCompare(b.dateOfJoining));
  const node = (p, depth) => {
    const ch = kids(p.id);
    const box = h('div.hr-org-kids', { hidden: depth >= 2 }, ch.map((c) => node(c, depth + 1)));
    const tog = ch.length ? h('button.btn.sm.ghost', { type: 'button', 'aria-expanded': String(depth < 2), onclick: (e) => { box.hidden = !box.hidden; e.currentTarget.setAttribute('aria-expanded', String(!box.hidden)); e.currentTarget.querySelector('span').textContent = box.hidden ? `${ch.length} report${ch.length > 1 ? 's' : ''}` : 'Hide'; } }, h('span', depth < 2 ? 'Hide' : `${ch.length} report${ch.length > 1 ? 's' : ''}`)) : null;
    return h('div.hr-org', h('div.hr-org-node', cx.avatar(p.id), h('div.grow', h('div.t', cx.link(p.name, 'employee', p.employee)), h('div.s', `${p.designation} · ${cx.deptName(p.department)}`), (p.hats || []).length ? h('div.chips', { style: 'margin-top:4px' }, p.hats.map(cx.hat)) : null), tog), ch.length ? box : null);
  };
  const roots = D.people.filter((p) => !p.reportsTo && p.status === 'Active');
  return cx.page({ title: 'Organisation chart', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Employees', route: 'employees' }], cmd: { cli: 'capxul org hr employee list --status active --json', note: 'The chart is drawn from each employee\'s Reports to.' },
    actions: [cx.btn('List', { icon: 'list', href: ['employees'] })],
    body: cx.card({ body: h('div', { style: 'display:grid;gap:6px' }, roots.map((r) => node(r, 0))) }) });
}, { workspace: 'hr', title: 'Organisation chart' });

const keeperOn = (d) => (d < '2025-06-02' ? 'samw' : d < '2025-10-06' ? 'kwame' : 'isla');
const createdOf = (e) => { const at = e.dateOfJoining < D.company.onCapxulSince ? D.company.onCapxulSince : e.dateOfJoining; return { by: keeperOn(at), at }; };
function employeeTimeline(e) {
  const moved = e.dateOfJoining < D.company.onCapxulSince;
  const items = [moved ? { at: D.company.onCapxulSince + 'T09:00:00Z', who: 'samw', kind: 'created', text: `moved ${e.name}'s record to Capxul (joined ${fmt.date(e.dateOfJoining)})` } : { at: e.dateOfJoining + 'T09:00:00Z', who: keeperOn(e.dateOfJoining), kind: 'created', text: `added ${e.name} as ${e.designation}` }];
  if (e.seat) items.push({ at: e.seat + 'T10:00:00Z', kind: 'status', text: `${e.firstName} took a seat at Harbourline` });
  for (const ev of D.events.filter((x) => x.ref?.type === 'employee' && x.ref.id === e.employee)) items.push({ at: ev.at, who: ev.who, kind: 'change', text: ev.text });
  for (const d of D.departments) for (const x of d.holders) if (x.who === e.id) { items.push({ at: x.from + 'T09:00:00Z', kind: 'approval', text: `${e.firstName} put on the ${d.name} hat` }); if (x.to) items.push({ at: x.to + 'T09:00:00Z', kind: 'change', text: `${e.firstName} took off the ${d.name} hat` }); }
  if (e.relievingDate) items.push({ at: e.relievingDate + 'T17:00:00Z', who: keeperOn(e.relievingDate), kind: 'status', text: `marked ${e.name} as Left` });
  return items;
}

export function overviewTab(e) {
  const box = h('div');
  const periods = [['fy', 'Current fiscal year'], ['l12', 'Last 12 months'], ['q', 'This quarter'], ['lfy', 'Last fiscal year']];
  const range = (k) => k === 'fy' ? ['2026-04-01', cx.today] : k === 'l12' ? [addDays(cx.today, -365), cx.today] : k === 'q' ? [quarterOf(cx.today)[0], cx.today] : ['2025-04-01', '2026-03-31'];
  let period = 'fy';
  const draw = () => {
    const [a, b] = range(period);
    const slips = D.payroll.slips.filter((s) => s.employee === e.id && s.endDate >= a && s.startDate <= b).sort((x, y) => x.startDate.localeCompare(y.startDate));
    const prevSlips = D.payroll.slips.filter((s) => s.employee === e.id && s.startDate >= addDays(a, -365) && s.startDate < addDays(b, -365));
    const gross = sum(slips, (s) => s.grossPay), net = sum(slips, (s) => s.netPay), prevGross = sum(prevSlips, (s) => s.grossPay);
    const att = attendance().filter((x) => x.employee === e.id && x.date >= a && x.date <= b);
    const cnt = (st) => att.filter((x) => x.status === st).length;
    const ld = leaveDetails(e.id);
    const pendingLeave = H.leaveApplications.filter((l) => l.employee === e.id && l.status === 'Open');
    const claimsWait = H.expenseClaims.filter((c) => c.employee === e.id && c.status === 'Open');
    const claimsPay = H.expenseClaims.filter((c) => c.employee === e.id && c.status === 'Unpaid');
    const advSettle = H.advances.filter((x) => x.employee === e.id && x.status === 'Paid' && x.pendingAmount > 0);
    const escrowed = D.payroll.slips.filter((s) => s.employee === e.id && s.paymentInfo?.escrow?.status === 'Open');
    const cur = slips[0]?.currency || 'GBP';
    const tx = [
      ...D.payroll.slips.filter((s) => s.employee === e.id).map((s) => ({ doc: s.name, type: 'Payslip', date: s.postingDate, status: s.status, amount: s.netPay, out: 0, route: 'payslip', cur: s.currency })),
      ...H.leaveApplications.filter((l) => l.employee === e.id).map((l) => ({ doc: l.name, type: 'Leave', date: l.postingDate, status: l.status, amount: null, out: null, route: 'leave', days: l.totalLeaveDays })),
      ...H.expenseClaims.filter((c) => c.employee === e.id).map((c) => ({ doc: c.name, type: 'Expense claim', date: c.postingDate, status: c.status, amount: c.grandTotal, out: round2(c.grandTotal - c.totalAmountReimbursed), route: 'expense-claim' })),
      ...H.advances.filter((x) => x.employee === e.id).map((x) => ({ doc: x.name, type: 'Advance', date: x.postingDate, status: x.status, amount: x.advanceAmount, out: x.pendingAmount, route: 'advance' })),
    ].sort((x, y) => y.date.localeCompare(x.date));
    let txType = '';
    const txBox = h('div');
    const drawTx = () => cx.fill(txBox, cx.grid({ numbered: false, columns: [
      { key: 'doc', label: 'Document', render: (r) => cx.link(r.doc, r.route, r.doc) }, { key: 'type', label: 'Type' }, { key: 'date', label: 'Date', type: 'date' },
      { key: 'status', label: 'Status', render: (r) => cx.pill(r.status) }, { key: 'amount', label: 'Amount', align: 'right', render: (r) => (r.amount == null ? (r.days ? fmt.num(r.days, 1) + ' d' : '') : fmt.money(r.amount, r.cur || 'GBP')) },
      { key: 'out', label: 'Outstanding', align: 'right', opt: true, render: (r) => (r.out ? fmt.gbp(r.out) : '') },
    ], rows: tx.filter((r) => !txType || r.type === txType).slice(0, 10), empty: 'No transactions' }));
    drawTx();
    cx.fill(box,
      h('div', { style: 'display:flex;gap:8px;align-items:center;padding:12px 16px 0;flex-wrap:wrap' }, h('label', { style: 'font-size:12.5px;color:var(--muted)', for: 'ov-period' }, 'Period'), h('select.ctl', { id: 'ov-period', style: 'width:auto', onchange: (ev) => { period = ev.target.value; draw(); } }, periods.map(([k, l]) => h('option', { value: k, selected: k === period }, l))), h('span.muted', { style: 'font-size:12px' }, `${fmt.date(a)} to ${fmt.date(b)}`)),
      h('div.ncards', { style: 'padding:12px 16px 0' },
        cx.numberCard({ label: 'Gross pay', value: fmt.money(gross, cur), sub: prevGross ? `${gross >= prevGross ? '+' : ''}${fmt.pct((gross - prevGross) / prevGross)} since last year` : `${slips.length} payslips`, href: ['payslips', e.employee] }),
        cx.numberCard({ label: 'Net pay', value: fmt.money(net, cur), sub: `${fmt.money(round2(gross - net), cur)} deducted` }),
        cx.numberCard({ label: 'Attendance', value: att.length ? fmt.pct((cnt('Present') + cnt('Work From Home') + cnt('Half Day') * 0.5) / Math.max(1, att.length - cnt('On Leave')), 0) : '—', sub: `${cnt('Present') + cnt('Work From Home')} days worked · ${cnt('Absent')} absent · ${cnt('On Leave')} on leave`, href: ['attendance', e.employee] }),
        cx.numberCard({ label: 'Leave balance', value: fmt.num(ld.find((x) => x.leaveType === 'Annual Leave')?.available ?? 0, 1) + ' days', sub: pendingLeave.length ? `${fmt.num(sum(pendingLeave, (l) => l.totalLeaveDays), 1)} days pending approval` : `Across ${ld.length} leave types`, href: ['leave-balance'] })),
      h('div.hr-ov-grid',
        cx.card({ title: 'Monthly pay', actions: cx.link('Salary register', 'salary-register'), body: slips.length ? h('div', { style: 'display:grid;gap:6px' }, cx.chart.bar({ labels: slips.map((s) => fmt.monthShort(s.startDate)), series: [{ name: 'Gross', values: slips.map((s) => s.grossPay), color: '1' }, { name: 'Net', values: slips.map((s) => s.netPay), color: '2' }], height: 190, format: (v) => fmt.compact(v, cur === 'USDC' ? null : 'GBP'), tipFormat: (v) => fmt.money(v, cur) }), h('div.muted', { style: 'font-size:12.5px' }, `Avg net pay ${fmt.money(net / slips.length, cur, 0)} a month`)) : cx.empty('No payslips in this period') }),
        cx.card({ title: 'Attendance', actions: cx.link('Attendance', 'attendance', e.employee), body: att.length ? cx.chart.donut({ items: [['Present', cnt('Present'), 'pos'], ['Work from home', cnt('Work From Home'), '2'], ['Half day', cnt('Half Day'), 'warn'], ['On leave', cnt('On Leave'), '4'], ['Absent', cnt('Absent'), 'danger']].filter((x) => x[1]).map(([label, value, color]) => ({ label, value, color })), center: String(att.length), format: (v) => fmt.int(v) + ' d' }) : cx.empty('No attendance in this period') }),
        cx.card({ title: 'Leave balance', actions: cx.link('Leave balance', 'leave-balance'), body: ld.length ? cx.chart.bar({ labels: ld.map((x) => x.leaveType.replace(' Leave', '')), series: [{ name: 'Taken', values: ld.map((x) => x.used), color: '4' }, { name: 'Remaining', values: ld.map((x) => Math.max(0, x.available)), color: 'pos' }], stacked: true, height: 180, format: (v) => fmt.num(v, 0), tipFormat: (v) => fmt.num(v, 1) + ' days' }) : cx.empty('No leave allocated') }),
        cx.card({ title: 'Pending items', body: h('div', { style: 'display:grid;gap:0' }, [
          ['Leave requests', pendingLeave.length, 'leaves', e.employee], ['Claims awaiting approval', claimsWait.length, 'expense-claims', e.employee], ['Claims to reimburse', claimsPay.length, 'expense-claims', e.employee], ['Advances to settle', advSettle.length, 'advances', e.employee], ['Pay waiting to be claimed', escrowed.length, 'payslips', e.employee],
        ].map(([l, n, r, id]) => h('div.hr-row', h('div.grow', cx.link(l, r, id)), h('span.pill', { class: n ? 't-orange' : 't-gray' }, String(n))))) }),
        cx.card({ title: 'Recent transactions', class: 'wide', actions: h('select.ctl', { style: 'width:auto', 'aria-label': 'Type', onchange: (ev) => { txType = ev.target.value; drawTx(); } }, h('option', { value: '' }, 'All types'), ['Payslip', 'Leave', 'Expense claim', 'Advance'].map((t) => h('option', { value: t }, t))), body: txBox })));
  };
  draw();
  return box;
}

const field = (label, key, extra = {}) => ({ label, key, ...extra });
function employeeForm(e, o = {}) {
  const editable = !!o.editable;
  const assign = [...D.payroll.assignments].filter((a) => a.employee === e.id).sort((a, b) => b.fromDate.localeCompare(a.fromDate))[0];
  const agr = D.payroll.agreements.find((a) => a.payee === e.id);
  const deptHat = e.department ? namesList(hatHolders(e.department)) : '';
  const view = { ...e, fullName: e.name, departmentName: cx.deptName(e.department), reportsToName: e.reportsTo ? cx.name(e.reportsTo) : null, company: D.company.name, ctc: assign?.ctc ?? null, costCenter: cx.dept(e.department)?.costCenter, advanceAccount: '1400 · Employee Advances', paidToLong: paidToLong(e), salutation: e.gender === 'Female' ? 'Ms' : e.gender === 'Male' ? 'Mr' : 'Mx', createUserPermission: 1, preferredContact: 'Company Email', preferredEmail: e.companyEmail, unsubscribed: 0, currentAddress: e.city ? `${e.city}, ${e.country}` : null, addressIs: 'Rented', offerDate: e.dateOfJoining ? addDays(e.dateOfJoining, -42) : null, confirmationDate: e.employmentType === 'Full-time' && e.dateOfJoining ? addDays(e.dateOfJoining, 182) : null, notice: e.employmentType === 'Contract' ? 30 : 30, leaveEncashed: e.relievingDate ? 'No' : null, resignationDate: e.exit?.resignation || null, exitInterview: e.exit?.interview || null, newWorkplace: e.exit?.newWorkplace || null, reasonForLeaving: e.exit?.reason || null };
  const onChange = o.onChange || (() => {});
  const statusOpts = ['Active', 'Inactive', 'Suspended', 'Left'];
  const tabs = [
    { label: 'Details', sections: [
      { columns: [
        [field('First name', 'firstName', { reqd: true }), field('Middle name', 'middleName'), field('Last name', 'lastName'), field('Full name', 'fullName', { readOnly: true })],
        [field('Gender', 'gender', { type: 'select', options: ['', 'Female', 'Male', 'Non-binary', 'Prefer not to say'] }), field('Date of birth', 'dateOfBirth', { type: 'date' }), field('Salutation', 'salutation', { type: 'select', options: ['', 'Ms', 'Mr', 'Mx', 'Dr'] })],
        [field('Date of joining', 'dateOfJoining', { type: 'date', reqd: true }), field('Status', 'status', { type: editable ? 'select' : 'status', options: statusOpts, reqd: true, readOnly: !o.isNew }), field('Employee number', 'employee', { readOnly: true, type: 'mono' })],
      ] },
      { label: 'User details', collapsible: true, collapsed: !o.isNew, fields: [field('User ID', 'companyEmail', { help: 'Their Capxul sign-in.' }), field('Create user permission', 'createUserPermission', { type: 'check', readOnly: true })] },
      { label: 'Company details', columns: [
        [field('Company', 'company', { readOnly: true }), field('Department', 'department', editable ? { type: 'select', options: D.departments.map((d) => [d.id, d.name]) } : { type: 'link', value: view.departmentName, href: ['hr-department', e.department] }), field('Employment type', 'employmentType', { type: editable ? 'select' : 'text', options: ['Full-time', 'Part-time', 'Contract', 'Intern', 'Apprentice'] })],
        [field('Designation', 'designation', editable ? { type: 'select', options: H.designations.map((d) => d.name) } : { type: 'link', href: ['designation', e.designation] }), field('Reports to', 'reportsTo', editable ? { type: 'select', options: [['', '—'], ...D.people.filter((p) => p.status === 'Active' && p.id !== e.id).map((p) => [p.id, p.name])] } : { type: 'link', value: view.reportsToName, href: e.reportsTo ? ['employee', empNo(e.reportsTo)] : null })],
      ] },
      o.isNew ? null : { label: 'Capxul identity', desc: 'The person behind the record: their Capxul party, seat and the hats they wear today.', columns: [
        [field('Party', 'payMailbox', { readOnly: true, render: () => h('span', e.name, h('span.muted', ' · ' + e.payMailbox)) }), field('Seat', 'seat', { readOnly: true, render: () => (cx.hasSeat(e.id) ? h('span', 'Yes', h('span.muted', ` · since ${fmt.date(e.seat)}`)) : h('span', 'No', h('span.muted', ' · sees only their own records'))) })],
        [field('Hats worn now', 'hats', { readOnly: true, render: () => ((e.hats || []).length ? h('div.chips', e.hats.map(cx.hat)) : h('span.faint', 'None')) }), field('Safe', 'safe', { readOnly: true, type: e.safe ? 'address' : 'text' })],
      ] },
    ].filter(Boolean) },
  ];
  if (!o.isNew) tabs.push({ label: 'Overview', render: () => overviewTab(e) });
  tabs.push(
    { label: 'Address and contacts', sections: [
      { columns: [[field('Mobile', 'mobile')], [field('Company email', 'companyEmail'), field('Personal email', 'personalEmail')], [field('Preferred contact email', 'preferredContact', { type: editable ? 'select' : 'text', options: ['Company Email', 'Personal Email', 'User ID'] }), field('Preferred email', 'preferredEmail', { readOnly: true }), field('Unsubscribed', 'unsubscribed', { type: 'check' })]] },
      { label: 'Address', fields: [field('Current address', 'currentAddress', { type: 'textarea' }), field('Current address is', 'addressIs', { type: editable ? 'select' : 'text', options: ['Rented', 'Owned'] }), field('Permanent address', 'permanentAddress', { type: 'textarea' }), field('Permanent address is', 'permanentAddressIs')] },
      { label: 'Emergency contact', cols: 3, fields: [field('Emergency contact name', 'emergencyName'), field('Emergency phone', 'emergencyPhone'), field('Relation', 'emergencyRelation')] },
    ] },
    { label: 'Attendance and leaves', sections: [
      { cols: 3, fields: [field('Attendance device ID (badge)', 'attendanceDeviceId', { type: 'mono' }), field('Holiday list', 'holidayList', { type: 'link', href: ['holiday-list', e.holidayList] }), field('Default shift', 'defaultShift', { type: 'link', href: ['shift-type', e.defaultShift] })] },
      { label: 'Decided by', desc: 'Capxul decides by hat, not by a named approver. Whoever wears the hat today decides.', fields: [
        field('Leave', 'x1', { readOnly: true, wide: true, render: () => h('span', `Whoever wears the ${cx.deptName(e.department)} hat (${deptHat || 'nobody now'}) or a hat above it, or People (${peopleHat()}). Never ${e.firstName || 'the employee'}.`) }),
        field('Expense claims and advances', 'x2', { readOnly: true, wide: true, render: () => h('span', `${cx.deptName(e.department)}'s budget: whoever wears its hat (${deptHat || 'nobody now'}) or one above it. Never ${e.firstName}.`) }),
      ] },
    ] },
    { label: 'Salary', sections: [
      { columns: [
        [field('Cost to company (CTC)', 'ctc', { type: 'currency', readOnly: true, help: assign ? `From ${assign.name}: base ${fmt.gbp(assign.base)} a month, employer NI and pension` : agr ? 'A pay agreement, no CTC' : '' }), field('Salary currency', 'salaryCurrency', { readOnly: true }), field('Salary mode', 'salaryMode', { type: editable ? 'select' : 'text', options: ['Capxul Safe', 'Bank'] })],
        [field('Paid to', 'paidToLong', { readOnly: true }), field('Pay mailbox', 'payMailbox', { help: 'Pay is keyed to this personal address; a new work email never moves it.' })],
        [field('Employee advance account', 'advanceAccount', { readOnly: true }), field('Payroll cost centre', 'costCenter', { readOnly: true })],
      ] },
      e.bank ? { label: 'Bank details', desc: 'Paid in pounds by Faster Payments through Bridge, from the Treasury in USDC.', cols: 3, fields: [field('Bank name', 'x3', { value: e.bank.name }), field('Bank account no.', 'x4', { value: e.bank.account, type: 'mono' }), field('Sort code', 'x5', { value: e.bank.sortCode, type: 'mono' })] } : null,
      e.safe ? { label: 'Capxul Safe', desc: 'Paid in USDC to their own Safe, at the day\'s rate for their pay in pounds.', fields: [field('Safe', 'safe', { type: 'address', readOnly: true }), field('Network', 'x6', { value: 'Base · USDC', readOnly: true })] } : null,
      agr ? { label: 'Pay agreement', fields: [field('Agreement', 'x7', { value: agr.id, type: 'mono' }), field('Amount', 'x8', { value: `${fmt.usdc(agr.amount)} a ${agr.period}, from ${cx.deptName(agr.budget)}'s budget` }), field('Collections', 'x9', { value: `${agr.collections.length}, each a payslip born paid` }), field('Status', 'x10', { value: agr.status, type: 'status' })] } : null,
    ].filter(Boolean) },
    { label: 'Personal details', sections: [
      { cols: 2, fields: [field('Marital status', 'maritalStatus'), field('Blood group', 'bloodGroup'), field('Family background', 'family', { type: 'textarea' }), field('Health details', 'health', { type: 'textarea' })] },
      { label: 'Passport details', collapsible: true, collapsed: true, cols: 2, fields: [field('Passport number', 'passport'), field('Valid up to', 'passportValid', { type: 'date' }), field('Date of issue', 'passportIssue', { type: 'date' }), field('Place of issue', 'passportPlace')] },
    ] },
    { label: 'Joining', sections: [{ cols: 3, fields: [field('Offer date', 'offerDate', { type: 'date' }), field('Confirmation date', 'confirmationDate', { type: 'date' }), field('Contract end date', 'contractEnd', { type: 'date' }), field('Notice (days)', 'notice', { type: 'int' }), field('Date of retirement', 'retirement', { type: 'date' })] }] },
    { label: 'Exit', sections: [
      { cols: 3, fields: [field('Resignation letter date', 'resignationDate', { type: 'date' }), field('Relieving date', 'relievingDate', { type: 'date' }), field('Exit interview held on', 'exitInterview', { type: 'date' }), field('New workplace', 'newWorkplace'), field('Leave encashed?', 'leaveEncashed')] },
      { label: 'Feedback', fields: [field('Reason for leaving', 'reasonForLeaving', { type: 'textarea', wide: true })] },
    ] },
  );
  const doc = o.isNew ? e : view;
  const conn = o.isNew ? null : [
    { group: 'Attendance', items: [{ label: 'Attendance', count: attendance().filter((x) => x.employee === e.id).length, route: 'attendance', id: e.employee }, { label: 'Check-in', count: checkins().filter((x) => x.employee === e.id).length, route: 'checkins', id: e.employee }] },
    { group: 'Leave', items: [{ label: 'Leave', count: H.leaveApplications.filter((x) => x.employee === e.id).length, route: 'leaves', id: e.employee }, { label: 'Leave allocation', count: H.leaveAllocations.filter((x) => x.employee === e.id).length, route: 'leave-allocations', id: e.employee }] },
    { group: 'Shift', items: [{ label: 'Shift assignment', count: H.shiftAssignments.filter((x) => x.employee === e.id).length, route: 'shift-assignments', id: e.employee }] },
    { group: 'Expense', items: [{ label: 'Expense claim', count: H.expenseClaims.filter((x) => x.employee === e.id).length, route: 'expense-claims', id: e.employee }, { label: 'Advance', count: H.advances.filter((x) => x.employee === e.id).length, route: 'advances', id: e.employee }] },
    { group: 'Payroll', items: [{ label: 'Salary structure assignment', count: D.payroll.assignments.filter((x) => x.employee === e.id).length, route: 'structure-assignments', id: e.employee }, { label: 'Payslip', count: D.payroll.slips.filter((x) => x.employee === e.id).length, route: 'payslips', id: e.employee }] },
  ];
  return cx.formView({
    doc, editable, tabKey: 'employee', tabs, connections: conn, onChange,
    side: o.isNew ? null : { id: e.employee, title: e.name, cmd: `capxul org hr employee get ${e.employee}`, assigned: [], attachments: e.relievingDate ? ['resignation-letter.pdf'] : ['contract-signed.pdf'], tags: [cx.deptName(e.department).toLowerCase(), e.employmentType.toLowerCase()],
      extra: h('div', { style: 'display:grid;justify-items:start;gap:6px' }, cx.avatar(e.id, { size: 'lg' }), h('span.muted', { style: 'font-size:12.5px' }, `${e.designation} · ${cx.deptName(e.department)}`)),
      created: createdOf(e), modified: e.relievingDate ? { by: keeperOn(e.relievingDate), at: e.relievingDate } : createdOf(e) },
    timeline: o.isNew ? null : { items: employeeTimeline(e) },
  });
}

cx.route('employee', (ctx) => {
  const e = emp(ctx.id) || cx.find(D.people, 'employee', ctx.id);
  if (!e) return cx.page({ title: 'Not found', body: cx.empty('No such employee') });
  if (!cx.hasSeat() && e.id !== cx.meId()) return seatGate('Employee');
  const canEdit = cx.wears('People');
  const changes = {};
  const list = D.people;
  const i = list.indexOf(e);
  const prev = list[i - 1], next = list[i + 1];
  const statusMenu = [
    { heading: 'Status' },
    e.status === 'Active' ? { label: 'Suspend', needs: 'People', cmd: `capxul org hr employee suspend ${e.employee}`, onClick: () => setStatus('Suspended', 'suspend') } : null,
    e.status === 'Active' ? { label: 'Deactivate', needs: 'People', cmd: `capxul org hr employee deactivate ${e.employee}`, onClick: () => setStatus('Inactive', 'deactivate') } : null,
    e.status !== 'Active' && e.status !== 'Left' ? { label: 'Reinstate', needs: 'People', cmd: `capxul org hr employee reinstate ${e.employee}`, onClick: () => setStatus('Active', 'reinstate') } : null,
    e.status !== 'Left' ? { label: 'Leave the company…', danger: true, needs: 'People', cmd: `capxul org hr employee leave ${e.employee} --on <date>`, onClick: () => leaveCompany() } : null,
    { divider: true },
    { label: 'Payslips', href: ['payslips', e.employee], icon: 'payroll' },
    { label: 'Leave balance', href: ['leave-balance'], icon: 'calendar' },
    { label: 'Ask the FDE about this employee', icon: 'fde', onClick: () => cx.fde.open({ ask: `What should I know about ${e.name}?` }) },
  ];
  async function setStatus(to, verb) {
    if (!(await cx.confirm({ title: `${verb[0].toUpperCase() + verb.slice(1)} ${e.name}?`, body: to === 'Active' ? `${e.firstName} goes back to Active and is in the next payroll run.` : `${e.firstName} stays on record as ${to}. ${to === 'Suspended' ? 'Their pay is withheld from runs until reinstated.' : 'They leave payroll runs until reinstated.'}`, cmd: `capxul org hr employee ${verb} ${e.employee}`, who: `whoever wears People (${peopleHat()})` }))) return;
    e.status = to; cx.toast(`${e.name} is ${to}.`, { cmd: `capxul org hr employee ${verb} ${e.employee}` }); cx.refresh();
  }
  async function leaveCompany() {
    const on = addDays(cx.today, 30);
    const preview = h('div', { style: 'display:grid;gap:8px' },
      h('p', `${e.name} leaves on ${fmt.date(on)} (30 days' notice). Capxul works out what follows:`),
      h('ul', { style: 'margin:0;padding-left:18px;display:grid;gap:3px;font-size:13.5px' },
        h('li', `Final pay: ${fmt.date(on.slice(0, 8) + '01')} to ${fmt.date(on)} in that month's run, prorated.`),
        h('li', `Leave: ${fmt.num(leaveDetails(e.id).find((x) => x.leaveType === 'Annual Leave')?.available ?? 0, 1)} days of annual leave left; not encashed unless you say so.`),
        cx.hasSeat(e.id) ? h('li', `Seat: freed on ${fmt.date(on)}; Harbourline uses ${D.seats.used} of ${D.seats.limit}.`) : null,
        (e.hats || []).length ? h('li', `Hats: ${e.hats.join(', ')} come off; the hat above names who wears them next.`) : null,
        h('li', 'Open claims and advances are settled before the final payslip.')),
      h('p.muted', { style: 'font-size:12.5px' }, 'Final once confirmed. The FDE can draft this for whoever wears People.'));
    if (!(await cx.confirm({ title: `${e.name} leaves the company`, body: preview, cmd: [`capxul org hr employee leave ${e.employee} --on ${on} --preview`, `capxul org hr employee leave ${e.employee} --on ${on} --confirm`], who: `whoever wears People (${peopleHat()})`, confirmLabel: 'Confirm the leaving date', danger: true }))) return;
    e.relievingDate = on; cx.toast(`${e.name} leaves on ${fmt.date(on)}. Status becomes Left on that day.`, { cmd: `capxul org hr employee leave ${e.employee} --on ${on} --confirm` }); cx.refresh();
  }
  const save = () => {
    const keys = Object.keys(changes);
    if (!keys.length) { cx.toast('Nothing to save.', { tone: 'info' }); return; }
    const flags = keys.map((k) => `--${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())} ${JSON.stringify(String(changes[k]))}`).join(' ');
    Object.assign(e, changes);
    if (changes.firstName || changes.lastName) e.name = `${e.firstName} ${e.lastName}`;
    cx.toast(`Saved ${e.employee}`, { cmd: `capxul org hr employee change ${e.employee} ${flags}` });
    cx.refresh();
  };
  return cx.page({
    title: e.name, crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Employees', route: 'employees' }],
    status: [{ text: e.status, tone: empTone[e.status] }],
    sub: `${e.employee} · ${e.designation} · ${cx.deptName(e.department)} · joined ${fmt.date(e.dateOfJoining)}${e.relievingDate ? ' · left ' + fmt.date(e.relievingDate) : ''}`,
    actions: [
      prev ? cx.btn(null, { icon: 'left', title: `Previous: ${prev.name}`, href: ['employee', prev.employee], sm: true }) : null,
      next ? cx.btn(null, { icon: 'right', title: `Next: ${next.name}`, href: ['employee', next.employee], sm: true }) : null,
      cx.menu(null, statusMenu),
      cx.btn('Save', { kind: 'primary', needs: 'People', cmd: `capxul org hr employee change ${e.employee} --designation "${e.designation}"`, onClick: save }),
    ],
    cmd: { cli: `capxul org hr employee get ${e.employee}`, sdk: `client.org(orgId).hr.employees.get("${e.employee}")`, who: 'anyone with a seat; the employee reads their own', json: { employee: e.employee, name: e.name, status: e.status.toLowerCase(), department: e.department, designation: e.designation, joined: e.dateOfJoining, paidTo: e.salaryMode === 'Bank' ? 'bank' : 'safe', seat: cx.hasSeat(e.id) } },
    banner: !canEdit && cx.hasSeat() ? cx.banner(`Read only for ${cx.firstName(cx.meId())}: People keeps employee records (${peopleHat()}).`, { tone: 'info' }) : null,
    fde: `Employee ${e.employee}, ${e.name}`,
    body: employeeForm(e, { editable: canEdit, onChange: (doc, key, val) => { if (!['fullName', 'departmentName', 'reportsToName'].includes(key)) changes[key] = val; } }),
  });
}, { workspace: 'hr', title: 'Employee' });

cx.route('employee-new', () => {
  const g = seatGate('New employee'); if (g) return g;
  const owen = D.others.find((x) => x.id === 'owen');
  const draft = { firstName: '', middleName: '', lastName: '', gender: '', dateOfBirth: '', dateOfJoining: '', status: 'Active', employee: '(given on save)', company: D.company.name, department: 'engineering', employmentType: 'Full-time', designation: 'Senior Software Engineer', reportsTo: 'tom', companyEmail: '', personalEmail: '', payMailbox: '', salaryMode: 'Capxul Safe', salaryCurrency: 'GBP', holidayList: 'Holidays 2027', defaultShift: 'Studio Day', hats: [], name: '' };
  const host = h('div');
  const draw = () => cx.fill(host, employeeForm(draft, { editable: true, isNew: true }));
  const fillOwen = () => { Object.assign(draft, { firstName: 'Owen', lastName: 'Grady', gender: 'Male', dateOfJoining: '2027-01-04', personalEmail: owen.email, payMailbox: owen.email, companyEmail: 'owen@harbourline.studio', designation: 'Senior Software Engineer', department: 'engineering', reportsTo: 'tom' }); draw(); cx.toast('Filled from the FDE\'s draft for Owen Grady'); };
  draw();
  const cmdOf = () => `capxul org hr employee add ${draft.payMailbox || draft.personalEmail || '<email>'} --first-name ${draft.firstName || '…'} --last-name ${draft.lastName || '…'} --joined ${draft.dateOfJoining || '…'} --department ${draft.department} --designation "${draft.designation}" --type ${String(draft.employmentType).toLowerCase()}`;
  const save = () => {
    const missing = [['First name', draft.firstName], ['Last name', draft.lastName], ['Date of joining', draft.dateOfJoining], ['Personal email', draft.personalEmail || draft.payMailbox]].filter(([, v]) => !v).map(([l]) => l);
    if (missing.length) { cx.toast(`Missing: ${missing.join(', ')}`, { tone: 'warning' }); return; }
    const n = nextName('HR-EMP-', D.people.map((p) => p.employee));
    cx.toast(`Added ${draft.firstName} ${draft.lastName} as ${n}. Next: assign a salary structure and a shift.`, { cmd: cmdOf() });
    cx.go('employees');
  };
  return cx.page({
    title: 'New employee', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Employees', route: 'employees' }], status: [{ text: 'Not saved', tone: 'orange' }],
    actions: [cx.btn('Save', { kind: 'primary', needs: 'People', cmd: 'capxul org hr employee add <email> --first-name … --last-name … --joined …', onClick: save })],
    cmd: { cli: 'capxul org hr employee add <email> --first-name … --last-name … --joined … --department … --designation … --type full-time', sdk: 'client.org(orgId).hr.employees.add({ email, firstName, lastName, joined, department, designation, type })', who: `whoever wears People (${peopleHat()})`, note: 'An employee needs no seat. Offer one separately with org member invite.' },
    banner: cx.banner(h('span', 'The FDE drafted ', h('b', 'Owen Grady'), ' (Senior Software Engineer, joins 4 January 2027) from his signed offer.'), { tone: 'info', action: cx.btn('Fill from the draft', { sm: true, onClick: fillOwen }) }),
    body: host,
  });
}, { workspace: 'hr', title: 'New employee' });

/* =====================================================================================================
   Departments and designations
   ===================================================================================================== */

cx.route('hr-departments', () => {
  const g = seatGate('Departments'); if (g) return g;
  const node = (d) => {
    const people = active().filter((p) => p.department === d.id);
    const kids = D.departments.filter((x) => x.parent === d.id);
    return { id: d.id, label: d.name, sub: `Hat: ${namesList(hatHolders(d.id)) || 'nobody'} · cost centre ${d.costCenter}`, badges: kids.length ? [cx.pill('Group', 'gray')] : [], value: `${people.length} employee${people.length === 1 ? '' : 's'}`, group: kids.length > 0, href: ['hr-department', d.id], children: kids.map(node) };
  };
  return cx.page({ title: 'Departments', crumbs: [{ label: 'HR', route: 'hr' }],
    cmd: { cli: 'capxul org department list', sdk: 'client.org(orgId).departments.list()', who: 'anyone with a seat', note: 'A department is a budget with a hat. HR reads its people; the budget lives in Departments.' },
    actions: [cx.btn('New department', { kind: 'primary', icon: 'plus', needs: { dept: 'harbourline' }, cmd: 'capxul org department create <name> --under harbourline --budget <amount> --holder <safe>', onClick: () => cx.toast('A new department is a budget under Harbourline: the command is on the strip.', { cmd: 'capxul org department create <name> --under harbourline --budget <amount> --holder <safe>' }) })],
    body: cx.treeView({ key: 'hr-departments', depth: 2, roots: D.departments.filter((d) => !d.parent).map(node),
      toolbar: (n) => [cx.btn('Open', { sm: true, href: ['hr-department', n.id] }), cx.btn('Employees', { sm: true, onClick: () => cx.go('employees', null, { list: { filters: { department: n.id, status: 'Active' } } }) }), cx.hasRoute('department') ? cx.btn('Budget and hat', { sm: true, href: ['department', n.id], cmd: `capxul org department show ${n.id}` }) : null] }) });
}, { workspace: 'hr', title: 'Departments' });

cx.route('hr-department', (ctx) => {
  const g = seatGate('Department'); if (g) return g;
  const d = cx.find(D.departments, 'id', ctx.id);
  if (!d) return cx.page({ title: 'Not found', body: cx.empty('No such department') });
  const people = D.people.filter((p) => p.department === d.id);
  const b = cx.budgetOn(d.id);
  const now = d.holders.filter((x) => !x.to);
  const before = d.holders.filter((x) => x.to);
  const doc = { name: d.name, parent: d.parent ? cx.deptName(d.parent) : null, isGroup: D.departments.some((x) => x.parent === d.id) ? 1 : 0, disabled: 0, costCenter: d.costCenter, company: D.company.name };
  return cx.page({
    title: d.name, crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Departments', route: 'hr-departments' }], status: ['Enabled'],
    actions: [cx.hasRoute('department') ? cx.btn('Budget and hat', { href: ['department', d.id], icon: 'departments', cmd: `capxul org department show ${d.id}` }) : null, cx.btn('Swap the hat', { needs: d.parent ? { dept: d.parent } : 'Director', cmd: [`capxul org department holder add ${d.id} <safe>`, `capxul org department holder remove ${d.id} <safe>`], onClick: () => cx.toast(`Swapping who wears ${d.name} is two commands, run by the hat above it.`, { cmd: `capxul org department holder add ${d.id} <safe>` }) })],
    cmd: { cli: `capxul org department show ${d.id}`, sdk: `client.org(orgId).departments.get("${d.id}")`, who: 'anyone with a seat' },
    body: cx.formView({ doc, tabs: [{ label: 'Details', sections: [
      { columns: [[field('Department', 'name', { reqd: true }), field('Parent department', 'parent', { type: 'link', href: d.parent ? ['hr-department', d.parent] : null }), field('Company', 'company', { readOnly: true })], [field('Is group', 'isGroup', { type: 'check' }), field('Disabled', 'disabled', { type: 'check' }), field('Payroll cost centre', 'costCenter')]] },
      { label: 'Hat', desc: 'Whoever wears the hat now decides leave, claims and advances for the department\'s people, and spends its budget.', fields: [
        field('Wears it now', 'x1', { render: () => (now.length ? h('div.chips', now.map((x) => h('span', cx.personChip(x.who), h('span.muted', ` since ${fmt.date(x.from)}`)))) : h('span.faint', 'Nobody')) }),
        field('Earlier wearers', 'x2', { render: () => (before.length ? h('div', { style: 'display:grid;gap:3px' }, before.map((x) => h('span', cx.name(x.who), h('span.muted', ` · ${fmt.date(x.from)} to ${fmt.date(x.to)}`)))) : h('span.faint', 'None')) }),
      ] },
      b ? { label: 'Budget this quarter', node: h('div', { style: 'display:grid;gap:8px' }, cx.chart.meter({ total: b.amount, parts: [{ label: 'Spent', value: b.spent }, { label: 'Committed', value: b.committed, color: '3' }], warnAt: 0.85, format: (v) => fmt.usdc(v, 0) }), cx.kv([['Quarter', `${b.quarter} · ${fmt.date(b.from)} to ${fmt.date(b.to)}`], ['Budget', fmt.usdc(b.amount)], ['Spent', fmt.usdc(b.spent)], ['Left', fmt.usdc(b.left)]])) } : null,
      { label: 'Decides', fields: [field('Leave of its people', 'x3', { value: `the ${d.name} hat, a hat above it, or People` }), field('Claims and advances', 'x4', { value: `the ${d.name} hat or one above it, on this budget` })] },
      { label: `People (${people.filter((p) => p.status === 'Active').length} now)`, table: { columns: [{ key: 'name', label: 'Employee', render: (r) => empLink(r.id) }, { key: 'designation', label: 'Designation' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'dateOfJoining', label: 'Joined', type: 'date', opt: true }], rows: people } },
    ].filter(Boolean) }],
    connections: [{ group: 'People', items: [{ label: 'Employee', count: people.length, route: 'employees' }] }, { group: 'Payroll', items: [{ label: 'Payslip', count: D.payroll.slips.filter((s) => s.department === d.id).length, route: 'payslips' }] }],
    side: { id: d.id, title: d.name, cmd: `capxul org department show ${d.id}`, created: { by: 'board', at: '2025-05-01' }, modified: { by: d.parent ? hatHolders(d.parent)[0] : 'board', at: d.holders.at(-1).from } } }),
  });
}, { workspace: 'hr', title: 'Department' });

cx.route('designations', () => {
  const g = seatGate('Designations'); if (g) return g;
  const rows = H.designations.map((d) => ({ ...d, count: active().filter((p) => p.designation === d.name).length }));
  return cx.page({ title: 'Designations', crumbs: [{ label: 'HR', route: 'hr' }],
    actions: [cx.btn('Add designation', { kind: 'primary', icon: 'plus', needs: 'People', cmd: 'capxul org hr employee change <employee> --designation "<new designation>"', onClick: () => addDesignation() })],
    body: cx.listView({ key: 'designations', rows: () => rows, id: (r) => r.name, noun: 'designation', showId: false, titleCol: { key: 'name', label: 'Designation' }, columns: [{ key: 'count', label: 'Employees now', type: 'int', keep: true }],
      filters: [{ key: 'name', label: 'Designation' }], sort: { options: [{ key: 'name', label: 'Designation' }, { key: 'count', label: 'Employees' }], default: { key: 'count', dir: 'desc' } }, href: (r) => ['designation', r.name],
      cmd: { cli: 'capxul org hr employee list --group-by designation', note: 'A designation has no command of its own: it is set with --designation on org hr employee add or change.', filters: false } }) });
  function addDesignation() {
    const m = { name: '', description: '' };
    const md = cx.modal({ title: 'New designation', body: h('div.fields', { style: '--cols:1' }, cx.field({ label: 'Designation', key: 'name', model: m, edit: true, reqd: true }), cx.field({ label: 'Description', key: 'description', model: m, edit: true, type: 'textarea' })),
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: (close) => { if (!m.name.trim()) { cx.toast('Give it a name', { tone: 'warning' }); return; } H.designations.push({ name: m.name.trim(), description: m.description }); close(); cx.toast(`Added ${m.name.trim()}. Give it to someone with --designation.`, { cmd: `capxul org hr employee change <employee> --designation "${m.name.trim()}"` }); cx.refresh(); } }] });
    return md;
  }
}, { workspace: 'hr', title: 'Designations' });

cx.route('designation', (ctx) => {
  const g = seatGate('Designation'); if (g) return g;
  const d = cx.find(H.designations, 'name', ctx.id);
  if (!d) return cx.page({ title: 'Not found', body: cx.empty('No such designation') });
  const people = D.people.filter((p) => p.designation === d.name);
  return cx.page({ title: d.name, crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Designations', route: 'designations' }],
    cmd: { cli: `capxul org hr employee list --designation "${d.name}"`, note: 'Set with --designation on org hr employee add or change.' },
    body: cx.formView({ doc: { name: d.name, description: d.description || `${people.filter((p) => p.status === 'Active').length} at Harbourline now.` }, tabs: [{ label: 'Details', sections: [{ cols: 1, fields: [field('Designation', 'name', { reqd: true }), field('Description', 'description', { type: 'textarea' })] }, { label: 'Employees', table: { columns: [{ key: 'name', label: 'Employee', render: (r) => empLink(r.id) }, { key: 'department', label: 'Department', get: (r) => cx.deptName(r.department) }, { key: 'status', label: 'Status', type: 'status' }], rows: people } }] }] }) });
}, { workspace: 'hr', title: 'Designation' });

/* =====================================================================================================
   Holidays, leave types, allocations
   ===================================================================================================== */

cx.route('holidays', () => {
  const rows = H.holidayLists;
  return cx.page({ title: 'Holidays', crumbs: [{ label: 'HR', route: 'hr' }],
    actions: [cx.btn('Add holidays for 2028', { kind: 'primary', icon: 'plus', needs: 'People', cmd: 'capxul org hr holiday add --weekly saturday --year 2028', onClick: () => cx.toast('Holidays are kept one list a year; 2028 starts with its weekly offs.', { cmd: 'capxul org hr holiday add --weekly saturday --year 2028' }) })],
    body: cx.listView({ key: 'holiday-lists', rows, id: (r) => r.name, noun: 'holiday list', titleCol: { key: 'name', label: 'Holiday list name' }, showId: false,
      columns: [{ key: 'fromDate', label: 'From date', type: 'date' }, { key: 'toDate', label: 'To date', type: 'date' }, { key: 'bank', label: 'Bank holidays', get: (r) => r.holidays.filter((x) => !x.weeklyOff).length, type: 'int' }],
      right: { key: 'totalHolidays', label: 'Total holidays', type: 'int' }, filters: [{ key: 'name', label: 'Name' }], sort: { options: [{ key: 'fromDate', label: 'From date' }], default: { key: 'fromDate', dir: 'desc' } }, href: (r) => ['holiday-list', r.name],
      cmd: { cli: 'capxul org hr holiday list --year 2026', filters: false, who: 'anyone at Harbourline; an employee reads theirs with hr holiday list' } }) });
}, { workspace: 'hr', title: 'Holidays' });

cx.route('holiday-list', (ctx) => {
  const hl = cx.find(H.holidayLists, 'name', ctx.id) || H.holidayLists[1];
  let showWeekly = false;
  const tblBox = h('div');
  const draw = () => cx.fill(tblBox, cx.grid({ columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'wd', label: 'Day', get: (r) => fmt.weekday(r.date) }, { key: 'description', label: 'Description' }, { key: 'weeklyOff', label: 'Weekly off', type: 'check' }], rows: hl.holidays.filter((x) => showWeekly || !x.weeklyOff), empty: 'No holidays' }));
  draw();
  const add = { date: '', description: '' };
  const weekly = { day: 'Saturday' };
  return cx.page({ title: hl.name, crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Holidays', route: 'holidays' }],
    sub: `${fmt.date(hl.fromDate)} to ${fmt.date(hl.toDate)} · ${hl.subdivision}, ${hl.country}`,
    actions: [cx.btn('Save', { kind: 'primary', needs: 'People', cmd: `capxul org hr holiday list --year ${hl.year}`, onClick: () => cx.toast('Saved', { cmd: `capxul org hr holiday list --year ${hl.year}` }) })],
    cmd: { cli: `capxul org hr holiday list --year ${hl.year}`, sdk: `client.org(orgId).hr.holidays.list({ year: ${hl.year} })`, who: 'People keeps it; every employee reads it', json: { year: hl.year, total: hl.totalHolidays, holidays: hl.holidays.filter((x) => !x.weeklyOff).map((x) => ({ date: x.date, description: x.description })) } },
    body: cx.formView({ doc: { ...hl }, tabs: [{ label: 'Details', sections: [
      { cols: 2, fields: [field('Holiday list name', 'name', { reqd: true }), field('Total holidays', 'totalHolidays', { type: 'int', readOnly: true }), field('From date', 'fromDate', { type: 'date', reqd: true }), field('To date', 'toDate', { type: 'date', reqd: true })] },
      { label: 'Add weekly holidays', collapsible: true, collapsed: true, node: h('div', { style: 'display:flex;gap:8px;align-items:end;flex-wrap:wrap' }, cx.field({ label: 'Weekly off', key: 'day', model: weekly, edit: true, type: 'select', options: ['Saturday', 'Sunday', 'Friday'] }), cx.btn('Add to holidays', { needs: 'People', cmd: `capxul org hr holiday add --weekly saturday --year ${hl.year}`, onClick: () => cx.toast(`${weekly.day}s are already weekly offs in ${hl.name}.`, { tone: 'info', cmd: `capxul org hr holiday add --weekly ${weekly.day.toLowerCase()} --year ${hl.year}` }) })) },
      { label: 'Add local holidays', collapsible: true, collapsed: true, node: h('div', { style: 'display:flex;gap:8px;align-items:end;flex-wrap:wrap' }, cx.field({ label: 'Country', value: hl.country }), cx.field({ label: 'Subdivision', value: hl.subdivision }), cx.btn('Add to holidays', { needs: 'People', onClick: () => cx.toast(`England's bank holidays for ${hl.year} are in already.`, { tone: 'info' }) })) },
      { label: 'Holidays', actions: h('label', { style: 'display:flex;gap:6px;align-items:center;font-size:12.5px;color:var(--muted)' }, h('input', { type: 'checkbox', onchange: (e) => { showWeekly = e.target.checked; draw(); } }), `Show weekly offs (${hl.holidays.filter((x) => x.weeklyOff).length})`), node: h('div', { style: 'display:grid;gap:10px' }, tblBox,
        h('form', { style: 'display:flex;gap:8px;align-items:end;flex-wrap:wrap', onsubmit: (ev) => { ev.preventDefault(); if (!cx.wears('People')) { cx.toast(cx.allowed('People').reason, { tone: 'warning' }); return; } if (!add.date || !add.description) { cx.toast('A date and a description', { tone: 'warning' }); return; } hl.holidays.push({ date: add.date, description: add.description, weeklyOff: false }); hl.holidays.sort((a, b) => a.date.localeCompare(b.date)); hl.totalHolidays += 1; holidayIdx.set(add.date, { date: add.date, description: add.description, weeklyOff: false }); cx.toast(`Added ${fmt.date(add.date)}: ${add.description}`, { cmd: `capxul org hr holiday add ${add.date} --description "${add.description}"` }); cx.refresh(); } },
          cx.field({ label: 'Date', key: 'date', model: add, edit: true, type: 'date' }), cx.field({ label: 'Description', key: 'description', model: add, edit: true, placeholder: 'Christmas Eve (half day)' }), h('button.btn', { type: 'submit' }, cx.icon('plus'), 'Add row'))) },
    ] }] }) });
}, { workspace: 'hr', title: 'Holiday list' });

cx.route('leave-types', () => {
  return cx.page({ title: 'Leave types', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Leave', route: 'leave-home' }],
    actions: [cx.btn('Add leave type', { kind: 'primary', icon: 'plus', needs: 'People', cmd: 'capxul org hr leave-type add "<name>" --max-days <n> --max-continuous <n>', onClick: () => cx.toast('A new leave type takes its limits on creation.', { cmd: 'capxul org hr leave-type add "Study Leave" --max-days 5 --max-continuous 5' }) })],
    body: cx.listView({ key: 'leave-types', rows: H.leaveTypes, id: (r) => r.name, noun: 'leave type', showId: false, titleCol: { key: 'name', label: 'Leave type name', sub: (r) => r.description },
      columns: [{ key: 'maxPerYear', label: 'Max per year', type: 'int' }, { key: 'maxConsecutive', label: 'Max consecutive', type: 'int', keep: true }, { key: 'carryForward', label: 'Is carry forward', type: 'check' }, { key: 'lwp', label: 'Without pay', type: 'check' }],
      filters: [{ key: 'name', label: 'Name' }], href: (r) => ['leave-type', r.name], cmd: { cli: 'capxul org hr leave-type list', filters: false } }) });
}, { workspace: 'hr', title: 'Leave types' });

cx.route('leave-type', (ctx) => {
  const t = cx.find(H.leaveTypes, 'name', ctx.id);
  if (!t) return cx.page({ title: 'Not found', body: cx.empty('No such leave type') });
  const doc = { ...t, partPaid: 0, negative: 0, overAlloc: 0, includeHolidays: 0, applyAfter: 0, expireCarry: null };
  const canEdit = cx.wears('People');
  const changes = {};
  return cx.page({ title: t.name, crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Leave types', route: 'leave-types' }],
    actions: [cx.btn('Save', { kind: 'primary', needs: 'People', cmd: `capxul org hr leave-type change "${t.name}" --max-days ${t.maxPerYear}`, onClick: () => { Object.assign(t, changes); cx.toast(`Saved ${t.name}`, { cmd: `capxul org hr leave-type change "${t.name}" --max-days ${t.maxPerYear} --max-continuous ${t.maxConsecutive}` }); } })],
    cmd: { cli: `capxul org hr leave-type list`, sdk: 'client.org(orgId).hr.leaveTypes.list()', json: { name: t.name, maxDays: t.maxPerYear, maxContinuous: t.maxConsecutive, carryForward: t.carryForward, maxCarry: t.maxCarry ?? null, withoutPay: t.lwp } },
    body: cx.formView({ doc, editable: canEdit, onChange: (d, k, v) => { changes[k] = v; }, tabs: [
      { label: 'Details', sections: [
        { columns: [[field('Leave type name', 'name', { reqd: true, readOnly: true }), field('Is leave without pay', 'lwp', { type: 'check' }), field('Is partially paid leave', 'partPaid', { type: 'check' })], [field('Allow negative balance', 'negative', { type: 'check' }), field('Allow over allocation', 'overAlloc', { type: 'check' }), field('Include holidays within leaves as leaves', 'includeHolidays', { type: 'check' })]] },
        { label: 'Carry forward', collapsible: true, cols: 3, fields: [field('Carry forward', 'carryForward', { type: 'check' }), field('Maximum carry forwarded leaves', 'maxCarry', { type: 'float' }), field('Expire carry forwarded leaves (days)', 'expireCarry', { type: 'int' })] },
        { label: 'Description', fields: [field('Description', 'description', { type: 'textarea', wide: true })] },
      ] },
      { label: 'Limits', sections: [{ cols: 3, fields: [field('Maximum leave allocation allowed per year', 'maxPerYear', { type: 'float' }), field('Maximum consecutive leaves allowed', 'maxConsecutive', { type: 'int' }), field('Allow leave application after (calendar days)', 'applyAfter', { type: 'int' })] }] },
    ], connections: [{ group: 'Leave', items: [{ label: 'Leave', count: H.leaveApplications.filter((l) => l.leaveType === t.name).length, route: 'leaves' }, { label: 'Leave allocation', count: H.leaveAllocations.filter((l) => l.leaveType === t.name).length, route: 'leave-allocations' }] }] }) });
}, { workspace: 'hr', title: 'Leave type' });

const empFilterOf = (ctx) => (ctx.id ? emp(ctx.id)?.id : null);
const onlyInit = (ctx) => { const e = ctx.id ? emp(ctx.id) : null; return e ? { filters: { employee: e.employee } } : null; };
const EMP_FILTER = { key: 'employee', label: 'Employee', type: 'select', options: () => D.people.map((p) => [p.employee, p.name]), get: (r) => empNo(r.employee), flag: '--employee' };
cx.route('leave-allocations', (ctx) => {
  const g = seatGate('Leave allocations'); if (g) return g;
  const only = empFilterOf(ctx);
  return cx.page({ title: 'Leave allocations', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Leave', route: 'leave-home' }],
    actions: [cx.btn('Add leave allocation', { kind: 'primary', icon: 'plus', needs: 'People', cmd: 'capxul org hr leave allocate <employee> --type "Annual Leave" --days 25 --start 2027-01-01 --end 2027-12-31 --carry-forward', onClick: () => allocateModal() })],
    body: cx.listView({ key: 'leave-allocations', reset: !!only, initial: onlyInit(ctx), rows: () => H.leaveAllocations, noun: 'leave allocation',
      titleCol: { key: 'employee', label: 'Employee name', get: (r) => empName(r.employee), sub: (r) => r.description },
      status: (r) => (r.expired ? { text: 'Expired', tone: 'gray' } : { text: 'Submitted', tone: 'blue' }),
      columns: [{ key: 'emp', label: 'Employee', get: (r) => empNo(r.employee) }, { key: 'leaveType', label: 'Leave type', keep: true }, { key: 'fromDate', label: 'From date', type: 'date' }, { key: 'toDate', label: 'To date', type: 'date' }, { key: 'carriedForward', label: 'Carried', type: 'float', dp: 1 }],
      right: { key: 'totalLeavesAllocated', label: 'Total allocated', type: 'float', dp: 1 },
      modified: (r) => r.postingDate,
      filters: [{ key: 'name', label: 'ID' }, EMP_FILTER, { key: 'leaveType', label: 'Leave type', type: 'select' }, { key: 'expired', label: 'Expired', type: 'check' }],
      tabs: [{ label: 'All' }, { label: '2026', filter: (r) => r.fromDate >= '2026-01-01' }, { label: '2025', filter: (r) => r.fromDate < '2026-01-01' }],
      sort: { options: [{ key: 'postingDate', label: 'Created on' }, { key: 'fromDate', label: 'From date' }], default: { key: 'postingDate', dir: 'desc' } },
      groupBy: [{ key: 'leaveType', label: 'Leave type' }, { key: 'employee', label: 'Employee', type: 'person' }],
      href: (r) => ['leave-allocation', r.name], cmd: { cli: 'capxul org hr leave list --allocations' } }) });
  function allocateModal() {
    const m = { employee: 'hannah', type: 'Annual Leave', days: 25, start: '2027-01-01', end: '2027-12-31', carry: 1 };
    const cmdOf = () => `capxul org hr leave allocate ${empNo(m.employee)} --type "${m.type}" --days ${m.days} --start ${m.start} --end ${m.end}${m.carry ? ' --carry-forward' : ''}`;
    cx.modal({ title: 'New leave allocation', body: h('div.fields', { style: '--cols:2' },
      cx.field({ label: 'Employee', key: 'employee', model: m, edit: true, type: 'select', options: active().map((p) => [p.id, p.name]) }), cx.field({ label: 'Leave type', key: 'type', model: m, edit: true, type: 'select', options: H.leaveTypes.map((t) => t.name) }),
      cx.field({ label: 'From date', key: 'start', model: m, edit: true, type: 'date' }), cx.field({ label: 'To date', key: 'end', model: m, edit: true, type: 'date' }),
      cx.field({ label: 'New leaves allocated', key: 'days', model: m, edit: true, type: 'float' }), cx.field({ label: 'Add unused leaves from previous allocations', key: 'carry', model: m, edit: true, type: 'check' })),
      actions: [{ label: 'Cancel' }, { label: 'Allocate', primary: true, onClick: (close) => {
        const prevA = H.leaveAllocations.filter((a) => a.employee === m.employee && a.leaveType === m.type && a.toDate < m.start).sort((a, b) => b.toDate.localeCompare(a.toDate))[0];
        const lt = H.leaveTypes.find((t) => t.name === m.type);
        const left = prevA && m.carry && lt.carryForward ? Math.min(lt.maxCarry || 0, leaveDetails(m.employee, prevA.toDate).find((x) => x.leaveType === m.type)?.available || 0) : 0;
        const name = nextName(`HR-LAL-${cx.today.slice(0, 4)}-`, H.leaveAllocations.map((a) => a.name));
        H.leaveAllocations.push({ employee: m.employee, leaveType: m.type, fromDate: m.start, toDate: m.end, newLeavesAllocated: +m.days, carryForward: !!m.carry, carriedForward: left, totalLeavesAllocated: +m.days + left, description: `${m.start.slice(0, 4)} ${m.type.toLowerCase()}${left ? `, ${left} carried` : ''}`, status: 'Submitted', expired: false, postingDate: cx.today, name });
        if (left && prevA) prevA.expired = true;
        close(); cx.toast(`Allocated ${m.days} days of ${m.type} to ${empName(m.employee)}${left ? ` (+${left} carried)` : ''}`, { cmd: cmdOf() }); cx.go('leave-allocation', name);
      } }] });
  }
}, { workspace: 'hr', title: 'Leave allocations' });

cx.route('leave-allocation', (ctx) => {
  const a = cx.find(H.leaveAllocations, 'name', ctx.id);
  if (!a) return cx.page({ title: 'Not found', body: cx.empty('No such allocation') });
  if (!cx.hasSeat() && a.employee !== cx.meId()) return seatGate('Leave allocation');
  const e = emp(a.employee);
  const doc = { ...a, emp: e.employee, employeeName: e.name, department: cx.deptName(e.department), unused: a.carriedForward, addUnused: a.carryForward ? 1 : 0 };
  return cx.page({ title: e.name, crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Leave allocations', route: 'leave-allocations' }], status: [a.expired ? { text: 'Expired', tone: 'gray' } : { text: 'Submitted', tone: 'blue' }], sub: `${a.name} · ${a.leaveType} · ${fmt.date(a.fromDate)} to ${fmt.date(a.toDate)}`,
    actions: [cx.menu(null, [{ label: 'Leave balance', href: ['leave-balance'] }, { label: 'Cancel this allocation', danger: true, needs: 'People', cmd: `capxul org hr leave unallocate ${a.name}`, onClick: async () => { if (await cx.confirm({ title: `Cancel ${a.name}?`, body: `${fmt.num(a.totalLeavesAllocated, 1)} days of ${a.leaveType} come off ${e.name}'s balance. A change is cancel and allocate again: there is no adjustment.`, cmd: `capxul org hr leave unallocate ${a.name}`, danger: true, confirmLabel: 'Cancel the allocation' })) { a.status = 'Cancelled'; cx.toast(`${a.name} cancelled`, { cmd: `capxul org hr leave unallocate ${a.name}` }); cx.go('leave-allocations'); } } }])],
    cmd: { cli: `capxul org hr leave allocate ${e.employee} --type "${a.leaveType}" --days ${a.newLeavesAllocated} --start ${a.fromDate} --end ${a.toDate}${a.carryForward ? ' --carry-forward' : ''}`, note: 'How this allocation was made. Cancel it with org hr leave unallocate.' },
    body: cx.formView({ doc, tabs: [{ label: 'Details', sections: [
      { columns: [[field('Employee', 'emp', { type: 'link', href: ['employee', e.employee], reqd: true }), field('Employee name', 'employeeName'), field('Department', 'department')], [field('Leave type', 'leaveType', { type: 'link', href: ['leave-type', a.leaveType], reqd: true }), field('From date', 'fromDate', { type: 'date', reqd: true }), field('To date', 'toDate', { type: 'date', reqd: true })]] },
      { label: 'Allocation', columns: [[field('New leaves allocated', 'newLeavesAllocated', { type: 'float', dp: 1, render: () => h('b', fmt.num(a.newLeavesAllocated, 1)) }), field('Add unused leaves from previous allocations', 'addUnused', { type: 'check' }), field('Unused leaves', 'unused', { type: 'float', dp: 1 })], [field('Total leaves allocated', 'totalLeavesAllocated', { type: 'float', dp: 1, reqd: true }), field('Carry forwarded leaves', 'carriedForward', { type: 'float', dp: 1 })]] },
      { label: 'Notes', fields: [field('Description', 'description', { type: 'textarea', wide: true })] },
    ] }], connections: [{ group: 'Leave', items: [{ label: 'Leave', count: H.leaveApplications.filter((l) => l.employee === a.employee && l.leaveType === a.leaveType && l.fromDate >= a.fromDate && l.fromDate <= a.toDate).length, route: 'leaves', id: e.employee }] }],
    side: { id: a.name, title: e.name, cmd: `capxul org hr leave balance ${e.employee} --on ${a.toDate}`, created: { by: 'kwame', at: a.postingDate }, modified: { by: 'kwame', at: a.postingDate } },
    timeline: { items: [{ at: a.postingDate + 'T09:00:00Z', who: 'kwame', kind: 'submitted', text: `allocated ${fmt.num(a.totalLeavesAllocated, 1)} days of ${a.leaveType}` }, ...(a.expired ? [{ at: a.toDate + 'T23:59:00Z', kind: 'status', text: 'Expired: the unused days carried into the next allocation' }] : [])] } }) });
}, { workspace: 'hr', title: 'Leave allocation' });

/* =====================================================================================================
   Leave: workspace, list, form, apply, approve, calendar, balances
   ===================================================================================================== */

cx.route('leave-home', () => {
  const g = seatGate('Leave'); if (g) return g;
  const yearAgo = addDays(cx.today, -365);
  const lastYear = H.leaveApplications.filter((l) => l.postingDate >= yearAgo && l.status !== 'Cancelled');
  const byType = H.leaveTypes.map((t, i) => ({ label: t.name, value: lastYear.filter((l) => l.leaveType === t.name).length, color: String(i + 1) })).filter((x) => x.value);
  const month = cx.today.slice(0, 7);
  const monthHols = H.holidayLists.flatMap((x) => x.holidays).filter((x) => !x.weeklyOff && x.date.startsWith(month));
  const upcoming = H.holidayLists.flatMap((x) => x.holidays).filter((x) => !x.weeklyOff && x.date >= cx.today).slice(0, 5);
  return cx.workspacePage({ title: 'Leave', workspace: 'hr', crumbs: [{ label: 'HR', route: 'hr' }],
    cmd: { cli: 'capxul org hr leave list --status open', sdk: 'client.org(orgId).hr.leaves.list({ status: "open" })', json: { open: openLeave().length } },
    actions: [cx.btn('Apply for leave', { kind: 'primary', icon: 'plus', href: ['leave-new'], cmd: 'capxul hr leave apply --type "Annual Leave" --start … --end …' })],
    cards: [
      { label: 'Employees on leave (today)', value: fmt.int(onLeaveOn(cx.today).length), sub: onLeaveOn(cx.today).map((l) => empName(l.employee)).join(', ') || 'Nobody', href: ['leave-calendar'] },
      { label: 'Employees on leave (this month)', value: fmt.int(new Set(H.leaveApplications.filter((l) => l.status === 'Approved' && l.fromDate.startsWith(month)).map((l) => l.employee)).size), sub: fmt.month(month) },
      { label: 'Holidays in this month', value: fmt.int(monthHols.length), sub: monthHols.length ? monthHols.map((x) => x.description).join(', ') : 'No bank holiday this month' },
      { label: 'Waiting for a decision', value: fmt.int(openLeave().length), sub: `${fmt.num(sum(openLeave(), (l) => l.totalLeaveDays), 1)} days asked`, href: ['leaves'], delta: { text: `${openLeave().filter((l) => leaveDecision(l).ok).length} you can decide`, good: null } },
    ],
    charts: [
      { title: 'Leave applications by type, last year', node: cx.chart.donut({ items: byType, center: String(lastYear.length), format: (v) => fmt.int(v) }) },
      { title: 'Days of leave taken, month by month', node: (() => { const ms = []; for (let m = '2025-05'; m <= month; m = addDays(m + '-01', 32).slice(0, 7)) ms.push(m); return cx.chart.bar({ labels: ms.map((m) => fmt.monthShort(m)), series: H.leaveTypes.slice(0, 3).map((t, i) => ({ name: t.name, values: ms.map((m) => sum(H.leaveApplications.filter((l) => l.status === 'Approved' && l.leaveType === t.name && l.fromDate.startsWith(m)), (l) => l.totalLeaveDays)), color: String(i + 1) })), stacked: true, height: 200, format: (v) => fmt.int(v), tipFormat: (v) => fmt.num(v, 1) + ' days' }); })() },
    ],
    shortcuts: [{ label: 'Leave', route: 'leaves', count: openLeave().length, tone: 'orange', icon: 'calendar' }, { label: 'Leave calendar', route: 'leave-calendar', icon: 'calendar' }, { label: 'Leave allocation', route: 'leave-allocations', icon: 'list' }, { label: 'Leave balance', route: 'leave-balance', icon: 'report' }],
    quick: [{ title: 'Waiting for a decision', items: openLeave().slice(0, 8).map((l) => ({ label: `${empName(l.employee)} · ${l.leaveType}`, sub: `${fmt.day(l.fromDate)}${l.toDate !== l.fromDate ? ' to ' + fmt.day(l.toDate) : ''} · waits for ${l.waitingFor ? cx.name(l.waitingFor.who) + ' (' + l.waitingFor.hat + ')' : 'People'}`, right: fmt.num(l.totalLeaveDays, 1) + ' d', route: 'leave', id: l.name })) },
      { title: 'Upcoming holidays', items: upcoming.map((x) => ({ label: x.description, right: fmt.date(x.date), route: 'holiday-list', id: `Holidays ${x.date.slice(0, 4)}` })) }],
    links: [{ title: 'Reports', items: [{ label: 'Leave balance', route: 'leave-balance', kind: 'report' }, { label: 'Leave balance summary', route: 'leave-balance-summary', kind: 'report' }] }, { title: 'Setup', items: [{ label: 'Holidays', route: 'holidays' }, { label: 'Leave type', route: 'leave-types', count: H.leaveTypes.length }] }],
  });
}, { workspace: 'hr', title: 'Leave' });

async function decideLeave(l, approve) {
  const e = emp(l.employee);
  const dec = leaveDecision(l);
  if (!dec.ok) { cx.toast(dec.reason, { tone: 'warning' }); return false; }
  if (approve) {
    const days = workingDaysIn(l.fromDate, l.toDate);
    l.status = 'Approved'; l.decidedBy = cx.meId(); l.decidedAt = cx.today; l.decidedHat = dec.hat; l.waitingFor = null;
    for (const d of days) {
      const name = nextName(`HR-ATT-${d.slice(0, 4)}-`, attendance().map((x) => x.name));
      const row = [name, d, l.employee, l.halfDay && l.halfDayDate === d ? 'Half Day' : 'On Leave', l.leaveType, l.name, 0, null, null, 0, 0];
      H.attendance.rows.push(row); attendance().push(Object.fromEntries(H.attendance.cols.map((c, i) => [c, row[i]])));
    }
    dropApproval(l.name);
    cx.toast(`Leave approved. ${e.firstName}'s ${days.length} day${days.length === 1 ? ' is' : 's are'} marked on leave.`, { cmd: `capxul org hr leave approve ${l.name}` });
    return true;
  }
  const m = { reason: '' };
  return new Promise((resolve) => {
    cx.modal({ title: `Reject ${e.firstName}'s leave`, body: h('div', { style: 'display:grid;gap:10px' }, h('p', `${l.leaveType}, ${fmt.date(l.fromDate)} to ${fmt.date(l.toDate)} (${fmt.num(l.totalLeaveDays, 1)} days). ${e.firstName} sees your reason.`), cx.field({ label: 'Reason', key: 'reason', model: m, edit: true, type: 'textarea', reqd: true, placeholder: 'Release week for Severn Dynamics' })),
      onClose: () => resolve(false),
      actions: [{ label: 'Back' }, { label: 'Reject', danger: true, cmd: `capxul org hr leave reject ${l.name} --reason "…"`, onClick: (close) => {
        if (!m.reason.trim()) { cx.toast('A rejection needs a reason', { tone: 'warning' }); return; }
        l.status = 'Rejected'; l.decidedBy = cx.meId(); l.decidedAt = cx.today; l.decidedHat = dec.hat; l.rejectionReason = m.reason.trim(); l.waitingFor = null;
        dropApproval(l.name); resolve(true); close();
        cx.toast(`Rejected. ${e.firstName} is told why.`, { cmd: `capxul org hr leave reject ${l.name} --reason "${m.reason.trim()}"` });
      } }] });
  });
}
export { decideLeave };

cx.route('leaves', (ctx) => {
  const g = seatGate('Leave'); if (g) return g;
  const only = empFilterOf(ctx);
  const list = cx.listView({
    key: 'leaves', reset: !!only, initial: onlyInit(ctx), rows: () => H.leaveApplications, noun: 'leave application',
    titleCol: { key: 'employee', label: 'Employee name', get: (r) => empName(r.employee), sub: (r) => r.reason },
    status: (r) => T(r.status, LEAVE_TONE),
    columns: [{ key: 'leaveType', label: 'Leave type' }, { key: 'fromDate', label: 'From date', type: 'date', keep: true }, { key: 'toDate', label: 'To date', type: 'date' }, { key: 'waiting', label: 'Decided by', render: (r) => (r.status === 'Open' ? h('span.muted', `waits for ${r.waitingFor ? cx.firstName(r.waitingFor.who) + ' · ' + r.waitingFor.hat : 'People'}`) : r.decidedBy ? h('span', cx.firstName(r.decidedBy), h('span.muted', ` · ${r.decidedHat || ''}`)) : '') }],
    right: { key: 'totalLeaveDays', label: 'Total leave days', type: 'float', dp: 1 },
    modified: (r) => r.decidedAt || r.postingDate,
    filters: [{ key: 'name', label: 'ID' }, EMP_FILTER, { key: 'leaveType', label: 'Leave type', type: 'select', flag: '--type' }, { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Approved', 'Rejected', 'Cancelled'], flag: '--status' }, { key: 'fromDate', label: 'Month', type: 'month' }],
    tabs: [{ label: 'All' }, { label: 'Open', filter: (r) => r.status === 'Open' }, { label: 'Yours to decide', filter: (r) => r.status === 'Open' && leaveDecision(r).ok }, { label: 'Upcoming', filter: (r) => r.status === 'Approved' && r.toDate >= cx.today }],
    sort: { options: [{ key: 'postingDate', label: 'Created on' }, { key: 'fromDate', label: 'From date' }, { key: 'totalLeaveDays', label: 'Total leave days' }], default: { key: 'postingDate', dir: 'desc' } },
    groupBy: [{ key: 'status', label: 'Status' }, { key: 'leaveType', label: 'Leave type' }, { key: 'dept', label: 'Department', get: (r) => cx.deptName(emp(r.employee)?.department) }, { key: 'employee', label: 'Employee', type: 'person' }],
    href: (r) => ['leave', r.name],
    bulk: [{ label: 'Approve', cmd: 'capxul org hr leave approve <application>…', onClick: async (rows) => {
      const can = rows.filter((r) => r.status === 'Open' && leaveDecision(r).ok);
      if (!can.length) { cx.toast('None of these is open and yours to decide.', { tone: 'warning' }); return; }
      for (const r of can) await decideLeave(r, true);
      cx.toast(`Approved ${can.length} of ${rows.length}`, { cmd: can.map((r) => `capxul org hr leave approve ${r.name}`) }); list.refresh();
    } }],
    views: [{ label: 'List', route: 'leaves', active: true, icon: 'list' }, { label: 'Calendar', route: 'leave-calendar', icon: 'calendar' }],
    cmd: { cli: 'capxul org hr leave list', sdk: 'client.org(orgId).hr.leaves.list()' },
  });
  return cx.page({ title: 'Leave', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Leave', route: 'leave-home' }], actions: [cx.btn('Apply for leave', { kind: 'primary', icon: 'plus', href: ['leave-new'], cmd: 'capxul hr leave apply --type "Annual Leave" --start … --end …' })], body: list });
}, { workspace: 'hr', title: 'Leave' });

cx.route('leave', (ctx) => {
  const l = cx.find(H.leaveApplications, 'name', ctx.id);
  if (!l) return cx.page({ title: 'Not found', body: cx.empty('No such leave application') });
  if (!cx.hasSeat() && l.employee !== cx.meId()) return seatGate('Leave');
  const e = emp(l.employee);
  const dec = leaveDecision(l);
  const mine = l.employee === cx.meId();
  const balance = leaveDetails(l.employee, l.fromDate < cx.today ? l.fromDate : cx.today);
  const before = balance.find((x) => x.leaveType === l.leaveType);
  const decidedLine = l.status === 'Open'
    ? `Waiting for the ${cx.deptName(e.department)} hat (${namesList(hatHolders(e.department))}), a hat above it, or People (${peopleHat()})`
    : l.decidedBy ? `${cx.name(l.decidedBy)}, who wears the ${l.decidedHat} hat${l.decidedAt ? ', on ' + fmt.date(l.decidedAt) : ''}` : '—';
  const doc = { ...l, emp: e.employee, employeeName: e.name, department: cx.deptName(e.department), company: D.company.name, balanceBefore: before ? round2(before.available + (l.status === 'Approved' ? l.totalLeaveDays : 0)) : null, decided: decidedLine, followEmail: 1, halfDayCheck: l.halfDay ? 1 : 0 };
  const actions = [];
  if (l.status === 'Open') {
    if (mine) actions.push(cx.btn('Cancel', { kind: 'danger', cmd: `capxul hr leave cancel ${l.name}`, onClick: async () => { if (await cx.confirm({ title: 'Withdraw this leave application?', body: 'It stays on record as Cancelled.', cmd: `capxul hr leave cancel ${l.name}`, danger: true, confirmLabel: 'Withdraw it' })) { l.status = 'Cancelled'; dropApproval(l.name); cx.toast('Withdrawn', { cmd: `capxul hr leave cancel ${l.name}` }); cx.refresh(); } } }));
    if (!mine) actions.push(cx.btn('Reject', { needs: asNeed(() => leaveDecision(l)), cmd: `capxul org hr leave reject ${l.name} --reason "…"`, onClick: async () => { if (await decideLeave(l, false)) cx.refresh(); } }));
    if (!mine) actions.push(cx.btn('Approve', { kind: 'primary', icon: 'check', needs: asNeed(() => leaveDecision(l)), cmd: `capxul org hr leave approve ${l.name}`, onClick: async () => { if (await decideLeave(l, true)) cx.refresh(); } }));
  } else if (l.status === 'Approved' && l.fromDate > cx.today && mine) {
    actions.push(cx.btn('Cancel', { kind: 'danger', cmd: `capxul hr leave cancel ${l.name}`, onClick: async () => { if (await cx.confirm({ title: 'Cancel approved leave?', body: `Your days from ${fmt.date(l.fromDate)} go back to your balance.`, cmd: `capxul hr leave cancel ${l.name}`, danger: true, confirmLabel: 'Cancel the leave' })) { l.status = 'Cancelled'; cx.toast('Cancelled; the days are back in your balance', { cmd: `capxul hr leave cancel ${l.name}` }); cx.refresh(); } } }));
  }
  const tl = [{ at: l.postingDate + 'T12:00:00Z', who: l.employee, kind: 'created', text: `applied for ${fmt.num(l.totalLeaveDays, 1)} days of ${l.leaveType}` }];
  if (l.decidedBy) tl.push({ at: (l.decidedAt || l.postingDate) + 'T15:00:00Z', who: l.decidedBy, kind: l.status === 'Approved' ? 'approval' : 'cancelled', text: `${l.status === 'Approved' ? 'approved' : 'rejected'} this as ${l.decidedHat}`, body: l.rejectionReason || (l.status === 'Approved' ? `${e.firstName}'s days are marked On Leave.` : '') });
  if (l.status === 'Cancelled') tl.push({ at: l.postingDate + 'T16:00:00Z', who: l.employee, kind: 'cancelled', text: 'withdrew this application' });
  return cx.page({
    title: e.name, crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Leave', route: 'leaves' }], status: [T(l.status, LEAVE_TONE)],
    sub: `${l.name} · ${l.leaveType} · ${fmt.date(l.fromDate)}${l.toDate !== l.fromDate ? ' to ' + fmt.date(l.toDate) : ''} · ${fmt.num(l.totalLeaveDays, 1)} day${l.totalLeaveDays === 1 ? '' : 's'}`,
    actions,
    cmd: { cli: l.status === 'Open' ? `capxul org hr leave approve ${l.name}` : `capxul org hr leave list --employee ${e.employee}`, sdk: l.status === 'Open' ? `client.org(orgId).hr.leaves.approve("${l.name}")` : null, who: l.status === 'Open' ? `whoever wears ${cx.deptName(e.department)} or a hat above it, or People; never ${e.firstName}` : 'anyone with a seat; the employee reads their own', json: { name: l.name, employee: e.employee, type: l.leaveType, start: l.fromDate, end: l.toDate, days: l.totalLeaveDays, status: l.status.toLowerCase() } },
    banner: l.status === 'Open' ? cx.banner(dec.ok ? `${e.firstName} is waiting for your decision. You wear ${dec.hat}.` : mine ? 'Waiting for a decision. You can withdraw it while it is open.' : dec.reason, { tone: dec.ok ? 'warning' : 'info' }) : l.status === 'Rejected' ? cx.banner(`Rejected: ${l.rejectionReason}`, { tone: 'danger' }) : null,
    fde: `Leave ${l.name}: ${e.name}, ${l.leaveType}`,
    body: cx.formView({ doc, tabs: [{ label: 'Details', sections: [
      { label: 'Allocated leaves', node: leaveTable(balance) },
      { columns: [[field('Employee', 'emp', { type: 'link', href: ['employee', e.employee], reqd: true }), field('Employee name', 'employeeName')], [field('Leave type', 'leaveType', { type: 'link', href: ['leave-type', l.leaveType], reqd: true }), field('Department', 'department')]] },
      { label: 'Dates and reason', columns: [[field('From date', 'fromDate', { type: 'date', reqd: true }), field('To date', 'toDate', { type: 'date', reqd: true }), field('Half day', 'halfDayCheck', { type: 'check' }), l.halfDay ? field('Half day date', 'halfDayDate', { type: 'date' }) : null, field('Total leave days', 'totalLeaveDays', { type: 'float', dp: 1, readOnly: true })].filter(Boolean), [field('Reason', 'reason', { type: 'textarea' }), field('Leave balance before application', 'balanceBefore', { type: 'float', dp: 1, readOnly: true })]] },
      { label: 'Approval', columns: [[field('Decided by', 'decided', { readOnly: true }), field('Follow via email', 'followEmail', { type: 'check' })], [field('Posting date', 'postingDate', { type: 'date', reqd: true }), field('Status', 'status', { type: 'status', reqd: true })]] },
    ] }], connections: [{ group: 'Attendance', items: [{ label: 'Attendance', count: attendance().filter((x) => x.leaveApplication === l.name).length, route: 'attendance', id: e.employee }] }],
    side: { id: l.name, title: e.name, cmd: `capxul org hr leave balance ${e.employee}`, assigned: l.waitingFor ? [l.waitingFor.who] : [], created: { by: l.employee, at: l.postingDate }, modified: { by: l.decidedBy || l.employee, at: l.decidedAt || l.postingDate } },
    timeline: { items: tl } }),
  });
}, { workspace: 'hr', title: 'Leave' });

/** Apply for leave as the viewer (their own side, no seat needed). */
export function leaveApplyForm(onDone) {
  const me = cx.me();
  const types = leaveDetails(me.id).filter((x) => x.available > 0 || H.leaveTypes.find((t) => t.name === x.leaveType)?.lwp);
  const m = { leaveType: types[0]?.leaveType || 'Annual Leave', fromDate: addDays(cx.today, 14), toDate: addDays(cx.today, 15), halfDay: 0, reason: '' };
  const out = h('div', { style: 'display:grid;gap:12px' });
  const dept = me.department;
  const balEl = h('div.fval.num'); const daysEl = h('div.fval.num'); const cmdEl = h('div.confirm-cmd');
  const update = () => {
    const days = m.fromDate && m.toDate && m.toDate >= m.fromDate ? workingDaysIn(m.fromDate, m.toDate).length - (m.halfDay ? 0.5 : 0) : 0;
    const bal = leaveDetails(me.id).find((x) => x.leaveType === m.leaveType);
    cx.fill(balEl, bal ? fmt.num(bal.available, 1) : '—');
    cx.fill(daysEl, fmt.num(days, 1));
    cx.fill(cmdEl, h('span.p', '$ '), `capxul hr leave apply --type "${m.leaveType}" --start ${m.fromDate} --end ${m.toDate}${m.halfDay ? ' --half-day ' + m.toDate : ''}${m.reason ? ` --reason "${m.reason}"` : ''}`);
  };
  const ro = (label, el, help) => h('div.field', h('div.flabel', label), el, help ? h('div.fhelp', help) : null);
  cx.fill(out,
    h('div.fields', { style: '--cols:2' },
      cx.field({ label: 'Leave type', key: 'leaveType', model: m, edit: true, type: 'select', reqd: true, options: (types.length ? types : leaveDetails(me.id)).map((x) => [x.leaveType, `${x.leaveType} (${fmt.num(x.available, 1)} left)`]), onChange: update }),
      ro('Leave balance before application', balEl),
      cx.field({ label: 'From date', key: 'fromDate', model: m, edit: true, type: 'date', reqd: true, onChange: update }),
      cx.field({ label: 'To date', key: 'toDate', model: m, edit: true, type: 'date', reqd: true, onChange: update }),
      cx.field({ label: 'Half day', key: 'halfDay', model: m, edit: true, type: 'check', checkLabel: 'The last day is a half day', onChange: update }),
      ro('Total leave days', daysEl, 'Weekends and bank holidays are not counted.'),
      cx.field({ label: 'Reason', key: 'reason', model: m, edit: true, type: 'textarea', wide: true, placeholder: 'Family in Leeds before Christmas', onChange: update }),
      cx.field({ label: 'Decided by', wide: true, value: `the ${cx.deptName(dept)} hat (${namesList(hatHolders(dept))}) or one above it, or People` })),
    cmdEl);
  update();
  const submit = () => {
    const days = workingDaysIn(m.fromDate, m.toDate).length - (m.halfDay ? 0.5 : 0);
    const bal = leaveDetails(me.id).find((x) => x.leaveType === m.leaveType);
    const lt = H.leaveTypes.find((t) => t.name === m.leaveType);
    if (!m.fromDate || !m.toDate || m.toDate < m.fromDate) { cx.toast('The dates are the wrong way round.', { tone: 'warning' }); return null; }
    if (days <= 0) { cx.toast('Those days are all weekends or bank holidays.', { tone: 'warning' }); return null; }
    if (!lt?.lwp && (!bal || bal.available - (bal.pending || 0) < days)) { cx.toast(`Insufficient leave balance for ${m.leaveType}: ${fmt.num(bal ? bal.available - bal.pending : 0, 1)} days left after pending requests.`, { tone: 'danger' }); return null; }
    if (lt && days > lt.maxConsecutive) { cx.toast(`${m.leaveType} cannot be longer than ${lt.maxConsecutive} days.`, { tone: 'danger' }); return null; }
    const clash = H.leaveApplications.find((l) => l.employee === me.id && ['Open', 'Approved'].includes(l.status) && l.fromDate <= m.toDate && l.toDate >= m.fromDate);
    if (clash) { cx.toast(`You have already applied for ${clash.leaveType} between ${fmt.date(clash.fromDate)} and ${fmt.date(clash.toDate)}.`, { tone: 'danger' }); return null; }
    const name = nextName(`HR-LAP-${cx.today.slice(0, 4)}-`, H.leaveApplications.map((l) => l.name));
    const holder = hatHolders(dept).find((x) => x !== me.id) || hatHolders('harbourline')[0];
    const l = { employee: me.id, leaveType: m.leaveType, fromDate: m.fromDate, toDate: m.toDate, halfDay: !!m.halfDay, halfDayDate: m.halfDay ? m.toDate : null, totalLeaveDays: days, reason: m.reason, postingDate: cx.today, status: 'Open', decidedBy: null, decidedAt: null, rejectionReason: null, waitingFor: { who: holder, hat: cx.deptName(dept) }, name };
    H.leaveApplications.push(l);
    D.approvals?.waiting?.push({ kind: 'HR', what: `Leave: ${me.name}, ${m.fromDate} to ${m.toDate} (${m.leaveType}, ${days} days)`, openedBy: me.id, openedAt: nowIso(), waitsFor: [holder, ...wearersOf('People').filter((x) => x !== me.id)], because: `wears the ${cx.deptName(dept)} hat, or People`, ref: { type: 'leave', id: name }, command: `capxul org hr leave approve ${name}` });
    cx.toast(`Applied. ${cx.name(holder)} is told.`, { cmd: `capxul hr leave apply --type "${m.leaveType}" --start ${m.fromDate} --end ${m.toDate}${m.reason ? ` --reason "${m.reason}"` : ''}` });
    onDone?.(l);
    return l;
  };
  out.submit = submit;
  return out;
}

cx.route('leave-new', () => {
  const ne = notEmployee('New leave application'); if (ne) return ne;
  const form = leaveApplyForm((l) => cx.go('leave', l.name));
  return cx.page({ title: 'New leave application', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Leave', route: cx.hasSeat() ? 'leaves' : 'me-leave' }], status: [{ text: 'Not saved', tone: 'orange' }],
    actions: [cx.btn('Submit', { kind: 'primary', cmd: 'capxul hr leave apply --type … --start … --end …', onClick: () => form.submit() })],
    cmd: { cli: 'capxul hr leave apply --type "Annual Leave" --start … --end … --reason "…"', sdk: 'client.me.hr.leaves.apply({ type, start, end, reason })', who: 'any employee, for themselves; no seat needed' },
    body: cx.card({ title: `${cx.me().name} · ${cx.me().employee}`, body: [h('div', { style: 'display:grid;gap:8px' }, h('h3', { style: 'font:600 13px/1.3 var(--font-ui);margin:0' }, 'Allocated leaves'), leaveTable(leaveDetails(cx.meId()))), h('div', { style: 'height:12px' }), form] }) });
}, { workspace: 'hr', title: 'New leave application' });

cx.route('leave-calendar', (ctx) => {
  const g = seatGate('Leave calendar'); if (g) return g;
  let ym = ctx.state?.month || cx.store.get('leave-cal-month', cx.today.slice(0, 7));
  const box = h('div');
  const draw = () => {
    cx.store.set('leave-cal-month', ym);
    const first = ym + '-01';
    const start = addDays(first, -((weekdayOf(first) + 6) % 7));
    const last = monthEnd(ym);
    const end = addDays(last, (7 - weekdayOf(last)) % 7);
    const apps = H.leaveApplications.filter((l) => ['Approved', 'Open'].includes(l.status) && l.toDate >= start && l.fromDate <= end);
    const cells = eachDay(start, end).map((d) => {
      const hol = holidayOn(d);
      const evs = apps.filter((l) => l.fromDate <= d && l.toDate >= d && !hol);
      return h('div.c', { class: { off: !!hol, other: !d.startsWith(ym), today: d === cx.today } },
        h('div.n', h('b', String(+d.slice(8))), evs.length > 3 ? h('span', `+${evs.length - 3}`) : null),
        hol && !hol.weeklyOff ? h('div.hol', hol.description) : null,
        evs.slice(0, 3).map((l) => h('a.ev', { class: l.status, href: cx.href('leave', l.name), title: `${empName(l.employee)}: ${l.leaveType} (${l.status})` }, `${cx.firstName(l.employee)}: ${l.leaveType.replace(' Leave', '')}`)));
    });
    cx.fill(box, h('div', { style: 'display:grid;gap:10px' },
      h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' },
        cx.btn(null, { icon: 'left', sm: true, title: 'Previous month', onClick: () => { ym = addDays(ym + '-01', -1).slice(0, 7); draw(); } }),
        h('b', { style: 'font:600 15px/1.2 var(--font-ui);min-width:110px;text-align:center' }, fmt.month(ym)),
        cx.btn(null, { icon: 'right', sm: true, title: 'Next month', onClick: () => { ym = addDays(monthEnd(ym), 1).slice(0, 7); draw(); } }),
        cx.btn('Today', { sm: true, onClick: () => { ym = cx.today.slice(0, 7); draw(); } }),
        h('span.grow', { style: 'flex:1' }),
        h('div.hr-legend', h('span', h('i', { style: 'background:var(--t-green-bg);border:1px solid var(--t-green)' }), 'Approved'), h('span', h('i', { style: 'background:var(--t-orange-bg);border:1px solid var(--t-orange)' }), 'Open'), h('span', h('i', { style: 'background:var(--surface-2);border:1px solid var(--line)' }), 'Holiday or weekend'))),
      h('div.hr-mcal', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => h('div.wd', w)), cells)));
    cx.setCommand({ cli: `capxul org hr leave list --start ${first} --end ${last}`, sdk: `client.org(orgId).hr.leaves.list({ start: "${first}", end: "${last}" })` });
  };
  draw();
  return cx.page({ title: 'Leave calendar', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Leave', route: 'leave-home' }], actions: [h('div.btn-group', cx.btn('List', { icon: 'list', href: ['leaves'] }), cx.btn('Calendar', { icon: 'calendar', kind: 'primary' })), cx.btn('Apply for leave', { kind: 'primary', icon: 'plus', href: ['leave-new'] })], cmd: { cli: `capxul org hr leave list --start ${ym}-01 --end ${monthEnd(ym)}` }, body: cx.card({ body: box }) });
}, { workspace: 'hr', title: 'Leave calendar' });

cx.route('leave-balance', () => {
  const g = seatGate('Leave balance'); if (g) return g;
  return cx.page({ title: 'Employee leave balance', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Leave', route: 'leave-home' }],
    body: repView({
      key: 'leave-balance',
      filters: [{ key: 'from', label: 'From date', type: 'date', value: '2026-01-01' }, { key: 'to', label: 'To date', type: 'date', value: '2026-12-31' }, { key: 'dept', label: 'Department', type: 'select', options: [['', 'All departments'], ...D.departments.map((d) => [d.id, d.name])], value: '' }, { key: 'employee', label: 'Employee', type: 'select', options: [['', 'All employees'], ...D.people.map((p) => [p.id, p.name])], value: '' }, { key: 'status', label: 'Employee status', type: 'select', options: ['Active', 'Left', 'All'], value: 'Active' }, { key: 'consolidate', label: 'Consolidate leave types', type: 'check', value: true }],
      cmd: (v) => ({ cli: v.employee ? `capxul org hr leave balance ${empNo(v.employee)} --on ${v.to}` : `capxul org hr leave balance <employee> --on ${v.to}`, note: v.employee ? null : 'One call per employee: each row group is one balance.', sdk: v.employee ? `client.org(orgId).hr.leaves.balance("${empNo(v.employee)}", { on: "${v.to}" })` : null }),
      run: (v) => {
        const people = D.people.filter((p) => (v.status === 'All' || p.status === v.status) && (!v.dept || p.department === v.dept) && (!v.employee || p.id === v.employee));
        const rowOf = (p, t) => {
          const allocs = H.leaveAllocations.filter((a) => a.employee === p.id && a.leaveType === t.name && a.status !== 'Cancelled' && a.fromDate <= v.to && a.toDate >= v.from);
          if (!allocs.length) return null;
          const opening = sum(allocs.filter((a) => a.fromDate >= v.from), (a) => a.carriedForward);
          const allocated = sum(allocs.filter((a) => a.fromDate >= v.from), (a) => a.newLeavesAllocated) + sum(allocs.filter((a) => a.fromDate < v.from), (a) => a.totalLeavesAllocated);
          const taken = sum(H.leaveApplications.filter((l) => l.employee === p.id && l.leaveType === t.name && l.status === 'Approved' && l.fromDate >= v.from && l.fromDate <= v.to), (l) => l.totalLeaveDays);
          const expired = sum(allocs.filter((a) => a.expired && a.toDate <= v.to), (a) => Math.max(0, a.totalLeavesAllocated - sum(H.leaveApplications.filter((l) => l.employee === p.id && l.leaveType === t.name && l.status === 'Approved' && l.fromDate >= a.fromDate && l.fromDate <= a.toDate), (l) => l.totalLeaveDays)));
          return { id: p.id + t.name, leaveType: t.name, employee: p.employee, employeeName: p.name, opening, allocated, taken, expired, closing: round2(opening + allocated - taken - expired), emp: p.id };
        };
        const rows = [];
        if (v.consolidate) {
          for (const t of H.leaveTypes) {
            const kids = people.map((p) => rowOf(p, t)).filter(Boolean);
            if (!kids.length) continue;
            rows.push({ id: t.name, leaveType: t.name, indent: 0, group: true });
            for (const k of kids) rows.push({ ...k, leaveType: '', indent: 1 });
          }
        } else for (const p of people) for (const t of H.leaveTypes) { const r = rowOf(p, t); if (r) rows.push(r); }
        const annual = people.map((p) => rowOf(p, H.leaveTypes[0])).filter(Boolean);
        return {
          columns: [{ key: 'leaveType', label: 'Leave type', width: '150px' }, { key: 'employee', label: 'Employee', href: (r) => (r.employee ? ['employee', r.employee] : null) }, { key: 'employeeName', label: 'Employee name', width: '140px' }, { key: 'opening', label: 'Opening balance', type: 'float', dp: 1 }, { key: 'allocated', label: 'Leave(s) allocated', type: 'float', dp: 1 }, { key: 'taken', label: 'Leave(s) taken', type: 'float', dp: 1 }, { key: 'expired', label: 'Leave(s) expired', type: 'float', dp: 1 }, { key: 'closing', label: 'Closing balance', type: 'float', dp: 1 }],
          rows, chartTitle: 'Annual leave: closing balance by employee',
          chart: annual.length ? cx.chart.bar({ labels: annual.map((r) => cx.firstName(r.emp)), series: [{ name: 'Closing balance', values: annual.map((r) => r.closing), color: '1' }], height: 200, format: (x) => fmt.num(x, 0), tipFormat: (x) => fmt.num(x, 1) + ' days' }) : null,
        };
      },
    }) });
}, { workspace: 'hr', title: 'Leave balance' });

cx.route('leave-balance-summary', () => {
  const g = seatGate('Leave balance summary'); if (g) return g;
  return cx.page({ title: 'Employee leave balance summary', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Leave', route: 'leave-home' }],
    body: repView({ key: 'leave-balance-summary',
      filters: [{ key: 'date', label: 'Date', type: 'date', value: cx.today }, { key: 'dept', label: 'Department', type: 'select', options: [['', 'All departments'], ...D.departments.map((d) => [d.id, d.name])], value: '' }, { key: 'status', label: 'Employee status', type: 'select', options: ['Active', 'Left'], value: 'Active' }],
      cmd: (v) => ({ cli: `capxul org hr leave balance <employee> --on ${v.date}`, note: 'One call per row.' }),
      run: (v) => ({
        columns: [{ key: 'employee', label: 'Employee', href: (r) => ['employee', r.employee] }, { key: 'employeeName', label: 'Employee name', width: '140px' }, { key: 'department', label: 'Department' }, ...H.leaveTypes.map((t) => ({ key: t.name, label: t.name, type: 'float', dp: 1 }))],
        rows: D.people.filter((p) => p.status === v.status && (!v.dept || p.department === v.dept)).map((p) => { const ld = leaveDetails(p.id, v.date); return { id: p.id, employee: p.employee, employeeName: p.name, department: cx.deptName(p.department), ...Object.fromEntries(H.leaveTypes.map((t) => [t.name, ld.find((x) => x.leaveType === t.name)?.available ?? 0])) }; }),
        totals: true,
      }),
    }) });
}, { workspace: 'hr', title: 'Leave balance summary' });

/* =====================================================================================================
   Attendance, check-ins, shifts
   ===================================================================================================== */

cx.route('attendance-home', () => {
  const g = seatGate('Attendance'); if (g) return g;
  const month = cx.today.slice(0, 7);
  const mAtt = attendance().filter((x) => x.date.startsWith(month));
  const ms = []; for (let m = addDays(cx.today, -335).slice(0, 7); m <= month; m = addDays(m + '-01', 32).slice(0, 7)) ms.push(m);
  const todayIn = checkins().filter((c) => c.time.startsWith(cx.today) && c.logType === 'IN');
  return cx.workspacePage({ title: 'Attendance', workspace: 'hr', crumbs: [{ label: 'HR', route: 'hr' }],
    cmd: { cli: `capxul org hr attendance list --start ${month}-01`, sdk: `client.org(orgId).hr.attendances.list({ start: "${month}-01" })` },
    actions: [cx.btn('Mark attendance', { kind: 'primary', needs: 'People', cmd: 'capxul org hr attendance mark <employee> --on <date> --status present', onClick: () => markAttendanceModal() })],
    cards: [
      { label: 'Total present (this month)', value: fmt.int(mAtt.filter((x) => ['Present', 'Work From Home'].includes(x.status)).length), sub: `${fmt.month(month)}, to ${fmt.day(addDays(cx.today, -3))}`, href: ['attendance'] },
      { label: 'Total absent (this month)', value: fmt.int(mAtt.filter((x) => x.status === 'Absent').length), sub: fmt.month(month) },
      { label: 'Late entry (this month)', value: fmt.int(mAtt.filter((x) => x.lateEntry).length), sub: 'After the 15 minute grace' },
      { label: 'Checked in today', value: `${todayIn.length} of ${active().filter((p) => p.employmentType !== 'Contract').length}`, sub: `First at ${fmt.time(todayIn[0]?.time)}`, href: ['checkins'] },
    ],
    charts: [{ title: 'Attendance count', wide: true, node: cx.chart.line({ labels: ms.map((m) => fmt.monthShort(m)), series: [{ name: 'Present', values: ms.map((m) => attendance().filter((x) => x.date.startsWith(m) && x.status === 'Present').length), color: 'pos' }, { name: 'Work from home', values: ms.map((m) => attendance().filter((x) => x.date.startsWith(m) && x.status === 'Work From Home').length), color: '2' }, { name: 'On leave', values: ms.map((m) => attendance().filter((x) => x.date.startsWith(m) && x.status === 'On Leave').length), color: '4' }], height: 220, format: (v) => fmt.int(v) }) }],
    shortcuts: [{ label: 'Attendance', route: 'attendance', icon: 'list' }, { label: 'Check-ins', route: 'checkins', count: todayIn.length, icon: 'clock' }, { label: 'Monthly attendance sheet', route: 'attendance-sheet', icon: 'report' }, { label: 'Shift types', route: 'shift-types', icon: 'calendar' }],
    quick: [{ title: 'Checked in this morning', items: todayIn.slice(-8).reverse().map((c) => ({ label: empName(c.employee), sub: c.device, right: fmt.time(c.time), route: 'checkin', id: c.name })) }],
    links: [{ title: 'Reports', items: [{ label: 'Monthly attendance sheet', route: 'attendance-sheet', kind: 'report' }] }, { title: 'Setup', items: [{ label: 'Shift type', route: 'shift-types' }, { label: 'Shift assignment', route: 'shift-assignments' }] }],
  });
}, { workspace: 'hr', title: 'Attendance' });

function markAttendanceModal() {
  const inToday = new Set(checkins().filter((c) => c.time.startsWith(cx.today)).map((c) => c.employee));
  const outToday = new Set(onLeaveOn(cx.today).map((l) => l.employee));
  const first = active().find((p) => p.employmentType !== 'Contract' && !inToday.has(p.id) && !outToday.has(p.id)) || active()[0];
  const m = { employee: first.id, start: cx.today, end: cx.today, status: 'Work From Home', excludeHolidays: 1 };
  const picks = new Set();
  const box = h('div');
  const draw = () => {
    const marked = new Set(attendance().filter((x) => x.employee === m.employee).map((x) => x.date));
    const days = m.start && m.end ? eachDay(m.start, m.end).filter((d) => !marked.has(d) && (!m.excludeHolidays || !holidayOn(d))) : [];
    picks.clear(); days.forEach((d) => picks.add(d));
    cx.fill(box, h('div', { style: 'display:grid;gap:10px' },
      h('div.fields', { style: '--cols:2' },
        cx.field({ label: 'For employee', key: 'employee', model: m, edit: true, type: 'select', options: active().map((p) => [p.id, p.name]), onChange: draw }),
        cx.field({ label: 'Status', key: 'status', model: m, edit: true, type: 'select', options: ['Present', 'Absent', 'Half Day', 'Work From Home'] }),
        cx.field({ label: 'Start', key: 'start', model: m, edit: true, type: 'date', onChange: draw }), cx.field({ label: 'End', key: 'end', model: m, edit: true, type: 'date', onChange: draw }),
        cx.field({ label: 'Exclude holidays', key: 'excludeHolidays', model: m, edit: true, type: 'check', onChange: draw }), cx.field({ label: 'Shift', value: 'Studio Day' })),
      h('div', h('div.flabel', 'Unmarked attendance for days'), days.length ? h('div.hr-sheet-pick', days.map((d) => h('label', h('input', { type: 'checkbox', checked: true, onchange: (e) => (e.target.checked ? picks.add(d) : picks.delete(d)) }), `${fmt.weekday(d)} ${fmt.date(d)}`))) : h('div.muted', 'Every day in the range is marked already.'))));
  };
  draw();
  cx.modal({ title: 'Mark attendance', body: box, actions: [{ label: 'Cancel' }, { label: 'Mark attendance', primary: true, needs: 'People', cmd: 'capxul org hr attendance mark <employee> --on <date> --status …', onClick: async (close) => {
    if (!picks.size) { cx.toast('No days picked', { tone: 'warning' }); return; }
    const st = m.status.toLowerCase().replace(/ /g, '_');
    const cmds = [...picks].map((d) => `capxul org hr attendance mark ${empNo(m.employee)} --on ${d} --status ${st}`);
    close();
    if (!(await cx.confirm({ title: `Mark attendance as ${m.status} for ${empName(m.employee)} on ${picks.size} day${picks.size > 1 ? 's' : ''}?`, cmd: cmds, who: `whoever wears People (${peopleHat()})` }))) return;
    for (const d of [...picks].sort()) { const name = nextName(`HR-ATT-${d.slice(0, 4)}-`, attendance().map((x) => x.name)); const row = [name, d, m.employee, m.status, null, null, m.status === 'Absent' ? 0 : 8, null, null, 0, 0]; H.attendance.rows.push(row); attendance().push(Object.fromEntries(H.attendance.cols.map((c, i) => [c, row[i]]))); }
    cx.toast(`Marked ${picks.size} day${picks.size > 1 ? 's' : ''} as ${m.status}`, { cmd: cmds }); cx.refresh();
  } }] });
}

cx.route('attendance', (ctx) => {
  const only = empFilterOf(ctx);
  if (!cx.hasSeat() && only !== cx.meId()) return seatGate('Attendance');
  const list = cx.listView({
    key: 'attendance', reset: !!only, initial: onlyInit(ctx), rows: () => attendance(), noun: 'attendance', nouns: 'attendance records',
    titleCol: { key: 'employee', label: 'Employee name', get: (r) => empName(r.employee) },
    status: (r) => T(r.status, ATT_TONE),
    columns: [{ key: 'date', label: 'Attendance date', type: 'date', keep: true }, { key: 'inTime', label: 'In time' }, { key: 'outTime', label: 'Out time' }, { key: 'leaveType', label: 'Leave type' }, { key: 'late', label: 'Late entry', get: (r) => (r.lateEntry ? 'Late' : ''), render: (r) => (r.lateEntry ? cx.pill('Late entry', 'orange') : '') }],
    right: { key: 'workingHours', label: 'Working hours', type: 'float', dp: 2 },
    filters: [{ key: 'name', label: 'ID' }, EMP_FILTER, { key: 'status', label: 'Status', type: 'select', options: ['Present', 'Absent', 'On Leave', 'Half Day', 'Work From Home'], flag: '--status' }, { key: 'date', label: 'Month', type: 'month' }, { key: 'leaveType', label: 'Leave type', type: 'select' }],
    tabs: [{ label: 'All' }, { label: 'This month', filter: (r) => r.date.startsWith(cx.today.slice(0, 7)) }, { label: 'Late entries', filter: (r) => r.lateEntry }, { label: 'Absent', filter: (r) => r.status === 'Absent' }],
    sort: { options: [{ key: 'date', label: 'Attendance date' }, { key: 'workingHours', label: 'Working hours' }], default: { key: 'date', dir: 'desc' } },
    groupBy: [{ key: 'status', label: 'Status' }, { key: 'employee', label: 'Employee', type: 'person' }],
    href: (r) => ['attendance-record', r.name],
    views: [{ label: 'List', route: 'attendance', active: true, icon: 'list' }, { label: 'Monthly sheet', route: 'attendance-sheet', icon: 'report' }],
    cmd: { cli: `capxul org hr attendance list --start ${cx.today.slice(0, 7)}-01` },
  });
  return cx.page({ title: 'Attendance', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Attendance', route: 'attendance-home' }], actions: [cx.btn('Mark attendance', { kind: 'primary', needs: 'People', cmd: 'capxul org hr attendance mark <employee> --on <date> --status present', onClick: () => markAttendanceModal() })], body: list });
}, { workspace: 'hr', title: 'Attendance' });

cx.route('attendance-record', (ctx) => {
  const a = cx.find(attendance(), 'name', ctx.id);
  if (!a) return cx.page({ title: 'Not found', body: cx.empty('No such attendance record') });
  if (!cx.hasSeat() && a.employee !== cx.meId()) return seatGate('Attendance');
  const e = emp(a.employee);
  const fromCheckins = a.date >= '2026-07-01' && a.inTime;
  const doc = { ...a, emp: e.employee, employeeName: e.name, department: cx.deptName(e.department), company: D.company.name, shift: 'Studio Day', inT: a.inTime ? `${fmt.date(a.date)} ${a.inTime}` : null, outT: a.outTime ? `${fmt.date(a.date)} ${a.outTime}` : null };
  return cx.page({ title: e.name, crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Attendance', route: 'attendance' }], status: [T(a.status, ATT_TONE), { text: 'Submitted', tone: 'blue' }], sub: `${a.name} · ${fmt.dateLong(a.date)}`,
    actions: [cx.btn('Cancel', { kind: 'danger', needs: 'People', cmd: `capxul org hr attendance cancel ${a.name}`, onClick: async () => { if (await cx.confirm({ title: `Cancel ${a.name}?`, body: `${e.firstName}'s ${fmt.date(a.date)} goes back to unmarked. Mark it again with the right status.`, cmd: `capxul org hr attendance cancel ${a.name}`, danger: true, confirmLabel: 'Cancel the record' })) { a.status = 'Cancelled'; cx.toast('Cancelled', { cmd: `capxul org hr attendance cancel ${a.name}` }); cx.go('attendance'); } } })],
    cmd: { cli: `capxul org hr attendance list --employee ${e.employee} --start ${a.date} --end ${a.date}`, json: { name: a.name, employee: e.employee, date: a.date, status: a.status.toLowerCase().replace(/ /g, '_'), workingHours: a.workingHours } },
    body: cx.formView({ doc, tabs: [{ label: 'Details', sections: [
      { columns: [[field('Employee', 'emp', { type: 'link', href: ['employee', e.employee], reqd: true }), field('Employee name', 'employeeName'), field('Working hours', 'workingHours', { type: 'float', dp: 2 }), field('Status', 'status', { type: 'status', reqd: true }), field('Leave type', 'leaveType', { type: 'link', href: a.leaveType ? ['leave-type', a.leaveType] : null }), field('Leave application', 'leaveApplication', { type: 'link', href: a.leaveApplication ? ['leave', a.leaveApplication] : null })], [field('Attendance date', 'date', { type: 'date', reqd: true }), field('Company', 'company', { readOnly: true }), field('Department', 'department')]] },
      { label: 'Details', columns: [[field('Shift', 'shift', { type: 'link', href: ['shift-type', 'Studio Day'] }), field('In time', 'inT'), field('Out time', 'outT')], [field('Late entry', 'lateEntry', { type: 'check' }), field('Early exit', 'earlyExit', { type: 'check' })]] },
    ] }], timeline: { items: [{ at: a.date + 'T19:00:00Z', kind: 'submitted', text: fromCheckins ? 'Marked from check-ins at 19:00, an hour after the shift ended' : a.leaveApplication ? `Marked On Leave when ${a.leaveApplication} was approved` : 'Marked by hand', who: fromCheckins || a.leaveApplication ? null : 'kwame' }] } }) });
}, { workspace: 'hr', title: 'Attendance' });

cx.route('attendance-sheet', () => {
  const g = seatGate('Monthly attendance sheet'); if (g) return g;
  const months = []; for (let m = '2025-05'; m <= cx.today.slice(0, 7); m = addDays(m + '-01', 32).slice(0, 7)) months.push(m);
  const CODE = { Present: 'P', Absent: 'A', 'Half Day': 'HD', 'Work From Home': 'WFH', 'On Leave': 'L' };
  return cx.page({ title: 'Monthly attendance sheet', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Attendance', route: 'attendance-home' }],
    body: repView({ key: 'attendance-sheet', columnFilters: false,
      filters: [{ key: 'month', label: 'Month', type: 'select', options: months.slice().reverse().map((m) => [m, fmt.month(m)]), value: '2026-10' }, { key: 'dept', label: 'Department', type: 'select', options: [['', 'All departments'], ...D.departments.map((d) => [d.id, d.name])], value: '' }, { key: 'summary', label: 'Summarised view', type: 'check', value: false }],
      cmd: (v) => ({ cli: `capxul org hr attendance list --start ${v.month}-01 --end ${monthEnd(v.month)}`, sdk: `client.org(orgId).hr.attendances.list({ start: "${v.month}-01", end: "${monthEnd(v.month)}" })` }),
      run: (v) => {
        const days = eachDay(v.month + '-01', monthEnd(v.month));
        const recs = attendance().filter((x) => x.date.startsWith(v.month));
        const people = D.people.filter((p) => p.dateOfJoining <= monthEnd(v.month) && (!p.relievingDate || p.relievingDate >= v.month + '-01') && p.employmentType !== 'Contract' && (!v.dept || p.department === v.dept));
        const rows = people.map((p) => {
          const mine = new Map(recs.filter((x) => x.employee === p.id).map((x) => [x.date, x]));
          const row = { id: p.id, employee: p.employee, employeeName: p.name };
          let pres = 0, leave = 0, abs = 0, hol = 0, unm = 0;
          for (const d of days) {
            const r = mine.get(d); const ho = holidayOn(d);
            let c = r ? CODE[r.status] || '' : ho ? (ho.weeklyOff ? 'WO' : 'H') : d < p.dateOfJoining || (p.relievingDate && d > p.relievingDate) || d >= cx.today ? '' : '?';
            if (c === 'P' || c === 'WFH') pres += 1; else if (c === 'HD') { pres += 0.5; leave += 0.5; } else if (c === 'L') leave += 1; else if (c === 'A') abs += 1; else if (c === 'H' || c === 'WO') hol += 1; else if (c === '?') unm += 1;
            row['d' + d.slice(8)] = c;
          }
          Object.assign(row, { present: pres, leaves: leave, absent: abs, holidays: hol, unmarked: unm });
          return row;
        });
        const dayCols = v.summary ? [] : days.map((d) => ({ key: 'd' + d.slice(8), label: `${+d.slice(8)} ${fmt.weekday(d)}`, render: (r) => (r['d' + d.slice(8)] ? h('span.as-cell', { class: 'as-' + (r['d' + d.slice(8)] === '?' ? 'WO' : r['d' + d.slice(8)]) }, r['d' + d.slice(8)] === '?' ? '–' : r['d' + d.slice(8)]) : '') }));
        const perDay = days.filter((d) => !holidayOn(d) && d < cx.today);
        return {
          message: 'P present · A absent · HD half day · WFH work from home · L on leave · H holiday · WO weekly off', messageTone: 'info',
          columns: [{ key: 'employee', label: 'Employee', href: (r) => ['employee', r.employee] }, { key: 'employeeName', label: 'Employee name', width: '130px' }, ...dayCols, { key: 'present', label: 'Total present', type: 'float', dp: 1 }, { key: 'leaves', label: 'Total leaves', type: 'float', dp: 1 }, { key: 'absent', label: 'Total absent', type: 'float', dp: 1 }, { key: 'holidays', label: 'Total holidays', type: 'int' }, { key: 'unmarked', label: 'Unmarked days', type: 'int' }],
          rows, totals: true, chartTitle: 'Present, on leave and absent, day by day',
          chart: perDay.length ? cx.chart.bar({ labels: perDay.map((d) => String(+d.slice(8))), series: [{ name: 'Present', values: perDay.map((d) => recs.filter((x) => x.date === d && ['Present', 'Work From Home'].includes(x.status)).length), color: 'pos' }, { name: 'On leave', values: perDay.map((d) => recs.filter((x) => x.date === d && x.status === 'On Leave').length), color: '4' }, { name: 'Absent', values: perDay.map((d) => recs.filter((x) => x.date === d && x.status === 'Absent').length), color: 'danger' }], stacked: true, height: 180, format: (x) => fmt.int(x) }) : null,
        };
      },
    }) });
}, { workspace: 'hr', title: 'Monthly attendance sheet' });

cx.route('checkins', (ctx) => {
  const only = empFilterOf(ctx);
  if (!cx.hasSeat() && only !== cx.meId()) return seatGate('Check-ins');
  return cx.page({ title: 'Check-ins', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Attendance', route: 'attendance-home' }],
    actions: [cx.btn('Check in', { kind: 'primary', icon: 'clock', cmd: 'capxul hr attendance checkin --log in', onClick: () => checkinSheet() })],
    body: cx.listView({ key: 'checkins', reset: !!only, initial: onlyInit(ctx), rows: () => checkins(), noun: 'check-in',
      titleCol: { key: 'employee', label: 'Employee name', get: (r) => empName(r.employee) },
      columns: [{ key: 'logType', label: 'Log type', keep: true, render: (r) => cx.pill(r.logType, r.logType === 'IN' ? 'green' : 'gray') }, { key: 'time', label: 'Time', type: 'datetime' }, { key: 'device', label: 'Location or device ID' }],
      modified: (r) => r.time,
      filters: [{ key: 'name', label: 'ID' }, EMP_FILTER, { key: 'logType', label: 'Log type', type: 'select', options: ['IN', 'OUT'] }, { key: 'time', label: 'Date', type: 'date' }],
      tabs: [{ label: 'All' }, { label: 'Today', filter: (r) => r.time.startsWith(cx.today) }, { label: 'This week', filter: (r) => r.time >= addDays(cx.today, -((weekdayOf(cx.today) + 6) % 7)) }],
      sort: { options: [{ key: 'time', label: 'Time' }], default: { key: 'time', dir: 'desc' } },
      groupBy: [{ key: 'device', label: 'Device' }, { key: 'employee', label: 'Employee', type: 'person' }],
      href: (r) => ['checkin', r.name], cmd: { cli: `capxul org hr attendance list --checkins --start ${cx.today}`, note: 'Each person checks in with hr attendance checkin.' } }) });
}, { workspace: 'hr', title: 'Check-ins' });

cx.route('checkin', (ctx) => {
  const c = cx.find(checkins(), 'name', ctx.id);
  if (!c) return cx.page({ title: 'Not found', body: cx.empty('No such check-in') });
  if (!cx.hasSeat() && c.employee !== cx.meId()) return seatGate('Check-in');
  const e = emp(c.employee);
  const att = attendance().find((x) => x.employee === c.employee && x.date === c.time.slice(0, 10));
  return cx.page({ title: e.name, crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Check-ins', route: 'checkins' }], sub: `${c.name} · ${c.logType} · ${fmt.datetime(c.time)}`,
    cmd: { cli: `capxul hr attendance checkin --log ${c.logType.toLowerCase()}`, sdk: `client.me.hr.attendances.checkin({ log: "${c.logType.toLowerCase()}" })`, note: `How ${e.firstName} made it. The time is the world's clock, not the device's.` },
    body: cx.formView({ doc: { ...c, emp: e.employee, employeeName: e.name, shift: 'Studio Day', timeShown: fmt.datetime(c.time), skip: 0, attendanceMarked: att?.name || null }, tabs: [{ label: 'Details', sections: [
      { columns: [[field('Employee', 'emp', { type: 'link', href: ['employee', e.employee], reqd: true }), field('Employee name', 'employeeName'), field('Log type', 'logType'), field('Shift', 'shift', { type: 'link', href: ['shift-type', 'Studio Day'] })], [field('Time', 'timeShown', { reqd: true, help: 'Stamped by the world\'s clock; read only.' }), field('Location or device ID', 'device'), field('Skip auto attendance', 'skip', { type: 'check' }), field('Attendance marked', 'attendanceMarked', { type: 'link', href: att ? ['attendance-record', att.name] : null })]] },
      { label: 'Location', collapsible: true, collapsed: true, fields: [field('Latitude', 'lat', { value: c.device.includes('Studio') ? '51.52735' : null }), field('Longitude', 'lng', { value: c.device.includes('Studio') ? '-0.08143' : null })] },
    ] }] }) });
}, { workspace: 'hr', title: 'Check-in' });

/** The check-in sheet: the world's clock stamps the time; it shows no map. */
export function checkinSheet(after) {
  const me = cx.me();
  if (!me.employee) { cx.toast(`${me.name} is not an employee: there is nothing to check in to.`, { tone: 'info' }); return; }
  const last = checkins().filter((c) => c.employee === me.id).sort((a, b) => a.time.localeCompare(b.time)).at(-1);
  const isIn = !last || last.logType === 'OUT' || !last.time.startsWith(cx.today);
  const log = isIn ? 'IN' : 'OUT';
  const at = new Date(cx.now.getTime() + (Date.now() % 600000)).toISOString();
  cx.modal({ title: isIn ? 'Check in' : 'Check out', body: h('div', { style: 'display:grid;gap:10px;justify-items:start' },
    h('div.hr-clock', fmt.time(at)), h('div.muted', fmt.dateLong(at)),
    cx.kv([['Employee', `${me.name} · ${me.employee}`], ['Log type', log], ['Shift', 'Studio Day, 09:30 to 18:00'], ['Device', 'Mobile app'], ['Location', 'Hoxton Square, London (51.5274, −0.0814)']]),
    h('p.muted', { style: 'font-size:12.5px' }, 'The time is the world\'s clock, not your phone\'s. Attendance is marked from check-ins at 19:00.')),
  actions: [{ label: 'Back' }, { label: isIn ? 'Confirm check in' : 'Confirm check out', primary: true, cmd: `capxul hr attendance checkin --log ${log.toLowerCase()}`, onClick: (close) => {
    const name = nextName(`EMP-CKIN-${at.slice(5, 7)}-${at.slice(0, 4)}-`, checkins().map((c) => c.name), 6);
    const row = [name, me.id, log, at, 'Mobile app'];
    H.checkins.rows.push(row); checkins().push({ name, employee: me.id, logType: log, time: at, device: 'Mobile app' });
    close(); cx.toast(`${isIn ? 'Checked in' : 'Checked out'} at ${fmt.time(at)}`, { cmd: `capxul hr attendance checkin --log ${log.toLowerCase()}` }); after ? after() : cx.refresh();
  } }] });
}

cx.route('shift-types', () => {
  const g = seatGate('Shift types'); if (g) return g;
  return cx.page({ title: 'Shift types', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Attendance', route: 'attendance-home' }],
    actions: [cx.btn('Add shift type', { kind: 'primary', icon: 'plus', needs: 'People', cmd: 'capxul org hr shift-type add "<name>" --start 09:30 --end 18:00 --auto-attendance', onClick: () => cx.toast('A shift type is fixed once made: a change is a new type.', { cmd: 'capxul org hr shift-type add "Early Studio" --start 08:00 --end 16:30 --auto-attendance --half-day-below 4 --absent-below 2 --late-grace 15 --early-grace 15' }) })],
    body: cx.listView({ key: 'shift-types', rows: H.shiftTypes, id: (r) => r.name, noun: 'shift type', showId: false, titleCol: { key: 'name', label: 'Name' }, columns: [{ key: 'startTime', label: 'Start time', keep: true }, { key: 'endTime', label: 'End time', keep: true }, { key: 'holidayList', label: 'Holiday list' }, { key: 'assigned', label: 'Assigned', get: (r) => H.shiftAssignments.filter((a) => a.shiftType === r.name && a.status === 'Active').length, type: 'int' }], href: (r) => ['shift-type', r.name], cmd: { cli: 'capxul org hr shift-type list', filters: false } }) });
}, { workspace: 'hr', title: 'Shift types' });

cx.route('shift-type', (ctx) => {
  const g = seatGate('Shift type'); if (g) return g;
  const s = cx.find(H.shiftTypes, 'name', ctx.id) || H.shiftTypes[0];
  const assigns = H.shiftAssignments.filter((a) => a.shiftType === s.name);
  return cx.page({ title: s.name, crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Shift types', route: 'shift-types' }], status: ['Enabled'], sub: `${s.startTime} to ${s.endTime} · auto attendance on`,
    actions: [cx.btn('Assign', { kind: 'primary', icon: 'plus', needs: 'People', cmd: `capxul org hr shift-type assign "${s.name}" <employee> --start <date>`, onClick: () => assignShift(s) })],
    cmd: { cli: `capxul org hr shift-type add "${s.name}" --start ${s.startTime} --end ${s.endTime} --auto-attendance --half-day-below ${s.workingHoursThresholdHalfDay} --absent-below ${s.workingHoursThresholdAbsent} --late-grace ${s.lateEntryGrace} --early-grace ${s.earlyExitGrace}`, note: 'How this shift type was made. A shift type is never changed: a change is a new type.', json: { name: s.name, start: s.startTime, end: s.endTime, assigned: assigns.filter((a) => a.status === 'Active').length } },
    banner: cx.banner('A shift type is fixed once created, so there is no Save. Check-ins mark attendance an hour after the shift ends.', { tone: 'info' }),
    body: cx.formView({ doc: { ...s, lastSync: fmt.datetime(s.lastSyncOfCheckin), lateOn: 1, earlyOn: 1 }, tabs: [{ label: 'Details', sections: [
      { cols: 3, fields: [field('Start time', 'startTime', { reqd: true }), field('End time', 'endTime', { reqd: true }), field('Holiday list', 'holidayList', { type: 'link', href: ['holiday-list', s.holidayList] }), field('Enable auto attendance', 'enableAutoAttendance', { type: 'check' })] },
      { label: 'Auto attendance settings', columns: [[field('Determine check-in and check-out', 'determineCheckInOut'), field('Working hours calculation based on', 'workingHoursCalculation'), field('Begin check-in before shift start time (minutes)', 'beginCheckInBefore', { type: 'int' }), field('Allow check-out after shift end time (minutes)', 'allowCheckOutAfter', { type: 'int' })], [field('Working hours threshold for half day', 'workingHoursThresholdHalfDay', { type: 'float', dp: 1 }), field('Working hours threshold for absent', 'workingHoursThresholdAbsent', { type: 'float', dp: 1 }), field('Process attendance after', 'processAttendanceAfter', { type: 'date' }), field('Last sync of check-in', 'lastSync'), field('Absent buffer (days)', 'absentBuffer', { type: 'int' })]] },
      { label: 'Late entry and early exit settings', cols: 2, fields: [field('Enable late entry marking', 'lateOn', { type: 'check' }), field('Late entry grace period (minutes)', 'lateEntryGrace', { type: 'int' }), field('Enable early exit marking', 'earlyOn', { type: 'check' }), field('Early exit grace period (minutes)', 'earlyExitGrace', { type: 'int' })] },
      { label: `Assignments (${assigns.length})`, table: { columns: [{ key: 'name', label: 'Shift assignment', render: (r) => cx.link(r.name, 'shift-assignment', r.name) }, { key: 'employee', label: 'Employee', render: (r) => empLink(r.employee) }, { key: 'startDate', label: 'Start date', type: 'date' }, { key: 'endDate', label: 'End date', type: 'date', opt: true }, { key: 'status', label: 'Status', type: 'status' }], rows: assigns } },
    ] }], side: { id: s.name, title: s.name, cmd: 'capxul org hr shift-type list', created: { by: 'samw', at: s.created }, modified: { by: 'samw', at: s.created } } }) });
}, { workspace: 'hr', title: 'Shift type' });

function assignShift(s) {
  const m = { employee: active().find((p) => !H.shiftAssignments.some((a) => a.employee === p.id && a.status === 'Active'))?.id || 'hannah', start: addDays(cx.today, 1) };
  cx.modal({ title: `Assign ${s.name}`, body: h('div.fields', { style: '--cols:2' }, cx.field({ label: 'Employee', key: 'employee', model: m, edit: true, type: 'select', options: active().map((p) => [p.id, p.name]) }), cx.field({ label: 'Start date', key: 'start', model: m, edit: true, type: 'date' })),
    actions: [{ label: 'Cancel' }, { label: 'Assign', primary: true, needs: 'People', onClick: (close) => {
      const name = nextName(`HR-SHA-${m.start.slice(2, 4)}-${m.start.slice(5, 7)}-`, H.shiftAssignments.map((a) => a.name));
      H.shiftAssignments.push({ employee: m.employee, shiftType: s.name, startDate: m.start, endDate: null, status: 'Active', name });
      close(); cx.toast(`${empName(m.employee)} works ${s.name} from ${fmt.date(m.start)}`, { cmd: `capxul org hr shift-type assign "${s.name}" ${empNo(m.employee)} --start ${m.start}` }); cx.go('shift-assignment', name);
    } }] });
}

cx.route('shift-assignments', (ctx) => {
  const g = seatGate('Shift assignments'); if (g) return g;
  const only = empFilterOf(ctx);
  return cx.page({ title: 'Shift assignments', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Attendance', route: 'attendance-home' }],
    actions: [cx.btn('Add shift assignment', { kind: 'primary', icon: 'plus', needs: 'People', onClick: () => assignShift(H.shiftTypes[0]) })],
    body: cx.listView({ key: 'shift-assignments', reset: !!only, initial: onlyInit(ctx), rows: () => H.shiftAssignments, noun: 'shift assignment',
      titleCol: { key: 'employee', label: 'Employee name', get: (r) => empName(r.employee) }, status: (r) => ({ text: r.status, tone: r.status === 'Active' ? 'green' : 'gray' }),
      columns: [{ key: 'shiftType', label: 'Shift type', keep: true }, { key: 'startDate', label: 'Start date', type: 'date' }, { key: 'endDate', label: 'End date', type: 'date' }],
      filters: [{ key: 'name', label: 'ID' }, EMP_FILTER, { key: 'shiftType', label: 'Shift type', type: 'select' }],
      sort: { options: [{ key: 'startDate', label: 'Start date' }], default: { key: 'startDate', dir: 'desc' } },
      href: (r) => ['shift-assignment', r.name], cmd: { cli: 'capxul org hr shift-type list --assignments' } }) });
}, { workspace: 'hr', title: 'Shift assignments' });

cx.route('shift-assignment', (ctx) => {
  const a = cx.find(H.shiftAssignments, 'name', ctx.id);
  if (!a) return cx.page({ title: 'Not found', body: cx.empty('No such shift assignment') });
  if (!cx.hasSeat() && a.employee !== cx.meId()) return seatGate('Shift assignment');
  const e = emp(a.employee);
  return cx.page({ title: e.name, crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Shift assignments', route: 'shift-assignments' }], status: [{ text: a.status, tone: a.status === 'Active' ? 'green' : 'gray' }, { text: 'Submitted', tone: 'blue' }], sub: `${a.name} · ${a.shiftType} from ${fmt.date(a.startDate)}`,
    actions: a.status === 'Active' ? [cx.btn('Unassign', { kind: 'danger', needs: 'People', cmd: `capxul org hr shift-type unassign ${a.name}`, onClick: async () => { if (await cx.confirm({ title: `End ${e.firstName}'s ${a.shiftType}?`, body: 'From tomorrow their check-ins no longer mark attendance on this shift.', cmd: `capxul org hr shift-type unassign ${a.name}`, danger: true, confirmLabel: 'Unassign' })) { a.status = 'Inactive'; a.endDate = cx.today; cx.toast('Unassigned', { cmd: `capxul org hr shift-type unassign ${a.name}` }); cx.refresh(); } } })] : [],
    cmd: { cli: `capxul org hr shift-type assign "${a.shiftType}" ${e.employee} --start ${a.startDate}`, note: 'How this assignment was made.' },
    body: cx.formView({ doc: { ...a, emp: e.employee, employeeName: e.name, company: D.company.name, department: cx.deptName(e.department) }, tabs: [{ label: 'Details', sections: [
      { label: 'Employee details', columns: [[field('Employee', 'emp', { type: 'link', href: ['employee', e.employee], reqd: true }), field('Employee name', 'employeeName')], [field('Company', 'company', { readOnly: true }), field('Department', 'department')]] },
      { label: 'Shift details', columns: [[field('Shift type', 'shiftType', { type: 'link', href: ['shift-type', a.shiftType], reqd: true }), field('Status', 'status', { type: 'status' })], [field('Start date', 'startDate', { type: 'date', reqd: true }), field('End date', 'endDate', { type: 'date' })]] },
    ] }] }) });
}, { workspace: 'hr', title: 'Shift assignment' });

/* =====================================================================================================
   Expenses: workspace, types, claims, advances
   ===================================================================================================== */

const claimText = (c) => (c.status === 'Unpaid' ? 'Unpaid' : c.status);
cx.route('expenses', () => {
  const g = seatGate('Expenses'); if (g) return g;
  const month = cx.today.slice(0, 7);
  const ms = []; for (let m = addDays(cx.today, -335).slice(0, 7); m <= month; m = addDays(m + '-01', 32).slice(0, 7)) ms.push(m);
  const lastMonth = addDays(month + '-01', -1).slice(0, 7);
  const inM = (m) => H.expenseClaims.filter((c) => c.postingDate.startsWith(m));
  return cx.workspacePage({ title: 'Expenses', workspace: 'hr', crumbs: [{ label: 'HR', route: 'hr' }],
    cmd: { cli: 'capxul org hr expense-claim list --status approved', sdk: 'client.org(orgId).hr.expenseClaims.list({ status: "approved" })' },
    actions: [cx.btn('Claim an expense', { kind: 'primary', icon: 'plus', href: ['expense-claim-new'], cmd: 'capxul hr expense-claim create --type … --amount … --on … --receipt …' })],
    cards: [
      { label: 'Expense claims (this month)', value: fmt.int(inM(month).length), sub: fmt.gbp(sum(inM(month), (c) => c.grandTotal)), href: ['expense-claims'] },
      { label: 'Approved claims (this month)', value: fmt.int(inM(month).filter((c) => ['Unpaid', 'Paid'].includes(c.status)).length), sub: `Last month ${inM(lastMonth).filter((c) => ['Unpaid', 'Paid'].includes(c.status)).length}` },
      { label: 'Rejected claims (this month)', value: fmt.int(inM(month).filter((c) => c.status === 'Rejected').length), sub: `${H.expenseClaims.filter((c) => c.status === 'Rejected').length} since May 2025` },
      { label: 'Waiting to be paid', value: fmt.gbp(sum(H.expenseClaims.filter((c) => c.status === 'Unpaid'), (c) => c.grandTotal)), sub: `${H.expenseClaims.filter((c) => c.status === 'Unpaid').length} approved claim`, href: ['unpaid-claims'] },
    ],
    charts: [{ title: 'Expense claims', wide: true, cmd: 'capxul org hr expense-claim list --group-by month', node: cx.chart.bar({ labels: ms.map((m) => fmt.monthShort(m)), series: [{ name: 'Claimed', values: ms.map((m) => sum(inM(m), (c) => c.grandTotal)), color: '1' }], height: 200, format: (v) => fmt.compact(v, 'GBP'), tipFormat: (v) => fmt.gbp(v) }) }],
    shortcuts: [{ label: 'Expense claims to approve', route: 'expense-claims', count: H.expenseClaims.filter((c) => c.status === 'Open').length, tone: 'orange', icon: 'file' }, { label: 'Advances', route: 'advances', count: H.advances.filter((a) => a.status === 'Requested').length, tone: 'orange', icon: 'bank' }, { label: 'Unpaid expense claims', route: 'unpaid-claims', icon: 'report' }, { label: 'Expense types', route: 'expense-types', icon: 'list' }],
    quick: [{ title: 'Recent claims', items: [...H.expenseClaims].reverse().slice(0, 6).map((c) => ({ label: `${empName(c.employee)} · ${c.expenses[0].expenseClaimType}${c.expenses.length > 1 ? ` & ${c.expenses.length - 1} more` : ''}`, sub: `${c.name} · ${claimText(c)}`, right: fmt.gbp(c.grandTotal), route: 'expense-claim', id: c.name })) },
      { title: 'Advances', items: [...H.advances].reverse().map((a) => ({ label: `${empName(a.employee)} · ${a.purpose}`, sub: `${a.name} · ${a.status}`, right: fmt.gbp(a.advanceAmount), route: 'advance', id: a.name })) }],
    links: [{ title: 'Accounting', items: [{ label: 'Payments', route: cx.hasRoute('payments') ? 'payments' : null }, { label: 'General ledger', route: cx.hasRoute('general-ledger') ? 'general-ledger' : null, kind: 'report' }] }, { title: 'Setup', items: [{ label: 'Expense type', route: 'expense-types', count: H.expenseClaimTypes.length }] }],
  });
}, { workspace: 'hr', title: 'Expenses' });

const acctName = (code) => { const a = D.books.accounts.find((x) => x.code === code); return a ? `${a.code} · ${a.name}` : code; };
cx.route('expense-types', () => cx.page({ title: 'Expense types', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Expenses', route: 'expenses' }],
  actions: [cx.btn('Add expense type', { kind: 'primary', icon: 'plus', needs: 'People', cmd: 'capxul org hr expense-type add <name> --account <code> --description "…"', onClick: () => cx.toast('A different account is a new type.', { cmd: 'capxul org hr expense-type add Training --account 6400 --description "Courses and books"' }) })],
  body: cx.listView({ key: 'expense-types', rows: H.expenseClaimTypes, id: (r) => r.name, noun: 'expense type', showId: false, titleCol: { key: 'name', label: 'Expense claim type', sub: (r) => r.description }, columns: [{ key: 'account', label: 'Default account', get: (r) => acctName(r.account), keep: true }, { key: 'used', label: 'Lines claimed', type: 'int', get: (r) => H.expenseClaims.flatMap((c) => c.expenses).filter((x) => x.expenseClaimType === r.name).length }], href: (r) => ['expense-type', r.name], cmd: { cli: 'capxul org hr expense-type list', filters: false, who: 'anyone; an employee reads them with hr expense-type list' } }) }), { workspace: 'hr', title: 'Expense types' });

cx.route('expense-type', (ctx) => {
  const t = cx.find(H.expenseClaimTypes, 'name', ctx.id);
  if (!t) return cx.page({ title: 'Not found', body: cx.empty('No such expense type') });
  return cx.page({ title: t.name, crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Expense types', route: 'expense-types' }],
    cmd: { cli: `capxul org hr expense-type add ${t.name} --account ${t.account} --description "${t.description}"`, note: 'How this type was made. A different account is a new type.' },
    body: cx.formView({ doc: { ...t }, tabs: [{ label: 'Details', sections: [{ cols: 1, fields: [field('Expense claim type', 'name', { reqd: true }), field('Description', 'description', { type: 'textarea' })] }, { label: 'Accounts', table: { columns: [{ key: 'company', label: 'Company' }, { key: 'account', label: 'Default account', get: (r) => acctName(r.account) }], rows: [{ company: D.company.name, account: t.account }] } }] }] }) });
}, { workspace: 'hr', title: 'Expense type' });

cx.route('expense-claims', (ctx) => {
  const only = empFilterOf(ctx);
  if (!cx.hasSeat() && only !== cx.meId()) return seatGate('Expense claims');
  return cx.page({ title: 'Expense claims', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Expenses', route: 'expenses' }],
    actions: [cx.btn('Claim an expense', { kind: 'primary', icon: 'plus', href: ['expense-claim-new'], cmd: 'capxul hr expense-claim create --type … --amount … --on … --receipt …' })],
    body: cx.listView({ key: 'expense-claims', reset: !!only, initial: onlyInit(ctx), rows: () => H.expenseClaims, noun: 'expense claim',
      titleCol: { key: 'employee', label: 'Employee name', get: (r) => empName(r.employee), sub: (r) => `${r.expenses[0].description}${r.expenses.length > 1 ? ` & ${r.expenses.length - 1} more` : ''}` },
      status: (r) => T(claimText(r), CLAIM_TONE),
      columns: [{ key: 'postingDate', label: 'Posting date', type: 'date' }, { key: 'totalClaimedAmount', label: 'Total claimed amount', type: 'currency' }, { key: 'totalAmountReimbursed', label: 'Total amount reimbursed', type: 'currency' }, { key: 'dept', label: 'Department', get: (r) => cx.deptName(r.department) }],
      right: { key: 'grandTotal', label: 'Grand total', type: 'currency' },
      modified: (r) => r.paymentInfo?.settledAt || r.approvedAt || r.postingDate,
      filters: [{ key: 'name', label: 'ID' }, EMP_FILTER, { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Open', 'Unpaid', 'Paid', 'Rejected', 'Cancelled'], flag: '--status' }, { key: 'postingDate', label: 'Posting month', type: 'month' }],
      tabs: [{ label: 'All' }, { label: 'To approve', filter: (r) => r.status === 'Open' }, { label: 'To pay', filter: (r) => r.status === 'Unpaid' }, { label: 'Paid', filter: (r) => r.status === 'Paid' }],
      sort: { options: [{ key: 'postingDate', label: 'Posting date' }, { key: 'grandTotal', label: 'Grand total' }], default: { key: 'postingDate', dir: 'desc' } },
      groupBy: [{ key: 'status', label: 'Status' }, { key: 'dept', label: 'Department', get: (r) => cx.deptName(r.department) }, { key: 'employee', label: 'Employee', type: 'person' }],
      href: (r) => ['expense-claim', r.name], cmd: { cli: 'capxul org hr expense-claim list', sdk: 'client.org(orgId).hr.expenseClaims.list()' } }) });
}, { workspace: 'hr', title: 'Expense claims' });

/** Approve a claim: the decider sanctions each line, then the claim waits to be paid. */
function approveClaim(c) {
  const dec = budgetDecision(c);
  if (!dec.ok) { cx.toast(dec.reason, { tone: 'warning' }); return; }
  const rows = c.expenses.map((x) => ({ ...x }));
  const totalEl = h('b.num');
  const showTotal = () => cx.fill(totalEl, fmt.gbp(round2(sum(rows, (x) => +x.sanctionedAmount || 0) + c.totalTaxesAndCharges)));
  showTotal();
  const table = h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Expense'), h('th.num', 'Amount'), h('th.num', 'Sanctioned amount'))),
    h('tbody', rows.map((r, i) => h('tr', h('td.wrap', h('div', { style: 'font-weight:600' }, `${r.expenseClaimType} · ${fmt.date(r.expenseDate)}`), h('div.muted', { style: 'font-size:12.5px' }, r.description)), h('td.num', fmt.gbp(r.amount)),
      h('td.num', h('input.finput.num', { type: 'number', step: '0.01', min: '0', max: String(r.amount), value: r.sanctionedAmount, style: 'width:110px', 'aria-label': `Sanctioned amount, line ${i + 1}`, oninput: (ev) => { r.sanctionedAmount = +ev.target.value; showTotal(); } }))))),
    h('tfoot', h('tr.total', h('td', `VAT ${fmt.gbp(c.totalTaxesAndCharges)} · to pay`), h('td'), h('td.num', totalEl)))));
  const md = cx.modal({ title: `Approve ${c.name}`, wide: true, body: h('div', { style: 'display:grid;gap:10px' }, h('p', `Set the sanctioned amount on each line. ${empName(c.employee)} is paid the sanctioned total plus VAT from ${cx.deptName(c.department)}'s budget.`), table, h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, c.receipts.map((r) => h('span', { style: 'display:inline-flex;gap:6px;align-items:center;font-size:12.5px' }, cx.icon('file', { size: 13 }), r.name, cx.hashChip(r.hash))))),
  actions: [{ label: 'Back' }, { label: 'Approve', primary: true, cmd: `capxul org hr expense-claim approve ${c.name}`, onClick: (close) => {
    c.expenses.forEach((x, i) => { x.sanctionedAmount = Math.min(+rows[i].sanctionedAmount || 0, x.amount); });
    c.totalSanctionedAmount = round2(sum(c.expenses, (x) => x.sanctionedAmount));
    c.grandTotal = round2(c.totalSanctionedAmount + c.totalTaxesAndCharges);
    c.status = 'Unpaid'; c.approvalStatus = 'Approved'; c.decidedBy = cx.meId(); c.decidedHat = dec.hat; c.approvedAt = cx.today; c.waitingFor = null;
    dropApproval(c.name); close();
    cx.toast(`Approved: ${fmt.gbp(c.grandTotal)} to pay ${empName(c.employee)}`, { cmd: `capxul org hr expense-claim approve ${c.name}` }); cx.refresh();
  } }] });
  return md;
}
function rejectRecord(rec, noun, cmdBase, after) {
  const m = { reason: '' };
  cx.modal({ title: `Reject ${rec.name}`, body: h('div', { style: 'display:grid;gap:10px' }, h('p', `${empName(rec.employee)} sees your reason.`), cx.field({ label: 'Reason', key: 'reason', model: m, edit: true, type: 'textarea', reqd: true, placeholder: 'Personal travel' })),
    actions: [{ label: 'Back' }, { label: 'Reject', danger: true, cmd: `${cmdBase} --reason "…"`, onClick: (close) => {
      if (!m.reason.trim()) { cx.toast('A rejection needs a reason', { tone: 'warning' }); return; }
      rec.status = 'Rejected'; rec.rejectionReason = m.reason.trim(); rec.decidedBy = cx.meId(); rec.waitingFor = null; if (rec.approvalStatus) rec.approvalStatus = 'Rejected';
      dropApproval(rec.name); close(); cx.toast(`Rejected the ${noun}`, { cmd: `${cmdBase} --reason "${m.reason.trim()}"` }); after?.();
    } }] });
}
/** Pay an approved claim from the department's budget: the hand-over, then the payment and its proof. */
async function payClaim(c) {
  const dec = budgetDecision(c);
  if (!dec.ok) { cx.toast(dec.reason, { tone: 'warning' }); return; }
  const e = emp(c.employee);
  const rate = cx.rate(cx.today);
  const usdc = round2(c.grandTotal / rate);
  const r = await cx.approval({
    title: `Pay ${e.name}'s expense claim`, from: `Harbourline Treasury · ${fmt.addr(D.company.treasury)} · ${cx.deptName(c.department)} budget`,
    to: paidToLong(e), amount: usdc, gbp: c.grandTotal, rate, signer: cx.meId(), hat: dec.hat,
    warnings: e.salaryMode === 'Bank' ? [`Bridge pays ${fmt.gbp(c.grandTotal)} to ${e.bank.name} ·· ${e.bank.account.slice(-4)} by Faster Payments; its fee comes from the Safe.`] : [],
    cmd: `capxul org hr expense-claim pay ${c.name}`, next: 'capxul payment wait approval_…',
  });
  if (r.status !== 'done') return;
  const content = await cx.hashOf({ name: c.name, employee: e.employee, expenses: c.expenses, taxes: c.taxes, grandTotal: c.grandTotal, receipts: c.receipts });
  c.contentHash = content;
  const lines = [...c.expenses.map((x) => ({ idx: x.idx, description: x.description, amount: Math.round(x.sanctionedAmount * 100), taxes: [] })), ...(c.totalTaxesAndCharges ? [{ idx: c.expenses.length + 1, description: 'VAT on receipts', amount: 0, taxes: [{ name: 'VAT', bps: 2000, amount: Math.round(c.totalTaxesAndCharges * 100) }] }] : [])];
  const p = await makePayment({ empId: e.id, gbp: c.grandTotal, purpose: 'claim', budget: c.department, docKind: 'Expense Claim', doc: c.name, date: c.postingDate, content, lines, approval: cx.newId('approval'), at: r.at, tx: r.tx, block: r.block, hat: dec.hat });
  c.status = 'Paid'; c.totalAmountReimbursed = c.grandTotal;
  c.paymentInfo = { payment: p.id, documentHash: p.proof.documentHash, tx: p.proof.tx, block: p.proof.block, settledAt: p.settledAt, amountSent: p.amount, fee: p.fee, route: e.salaryMode === 'Bank' ? 'Bank through Bridge' : 'Capxul Safe' };
  cx.toast(`Paid ${e.name} ${fmt.gbp(c.grandTotal)}. The proof is on the claim.`, { cmd: `capxul org hr expense-claim pay ${c.name}` });
  cx.refresh();
}

function claimForm(c, o = {}) {
  const e = emp(c.employee);
  const pay = paymentOf(c.paymentInfo?.payment);
  const adv = H.advances.filter((a) => a.employee === c.employee && a.claimedAmount > 0 && a.project && a.project === c.project);
  const decidedLine = c.decidedBy ? `${cx.name(c.decidedBy)}, who wears the ${c.decidedHat} hat` : c.waitingFor ? `Waiting for ${cx.deptName(c.department)}'s budget: ${cx.name(c.waitingFor.who)} (${c.waitingFor.hat}) or a hat above it` : `${cx.deptName(c.department)}'s budget`;
  const doc = { ...c, emp: e.employee, employeeName: e.name, deptName: cx.deptName(c.department), company: D.company.name, decided: decidedLine, payable: '2210 · Expense Claims Payable', exchangeRate: 1, projectName: c.project ? (D.projects.projects.find((p) => p.name === c.project)?.projectName || c.project) : null, costCenter: cx.dept(c.department)?.costCenter };
  const editable = !!o.editable;
  const totalsBox = h('div');
  const drawTotals = () => cx.fill(totalsBox, h('div.fields', { style: '--cols:3' }, [['Total sanctioned amount', c.totalSanctionedAmount], ['Total advance amount', c.totalAdvanceAmount], ['Grand total', c.grandTotal, true], ['Total claimed amount', c.totalClaimedAmount], ['Total taxes and charges', c.totalTaxesAndCharges], ['Total amount reimbursed', c.totalAmountReimbursed]].map(([l, v, b]) => cx.field({ label: l, type: 'currency', value: v, render: b ? () => h('b', fmt.gbp(v)) : null }))));
  const receiptsBox = h('div', { style: 'display:grid;gap:6px' });
  const drawReceipts = () => cx.fill(receiptsBox, c.receipts.length ? c.receipts.map((r) => h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0' }, cx.icon('file', { size: 14 }), h('span', r.name), cx.hashChip(r.hash))) : h('div.faint', 'No receipts yet'));
  drawTotals(); drawReceipts();
  const onLines = () => { o.onLines?.(); drawTotals(); };
  const onTaxes = () => { o.onTaxes?.(); drawTotals(); };
  const tabs = [
    { label: 'Expenses and advances', sections: [
      { columns: [[field('From employee', 'emp', editable ? { readOnly: true } : { type: 'link', href: ['employee', e.employee], reqd: true }), field('Employee name', 'employeeName', { readOnly: true }), field('Department', 'deptName', { readOnly: true }), field('Company', 'company', { readOnly: true })], [field('Decided by', 'decided', { readOnly: true }), field('Approval status', 'approvalStatus', { type: 'status', readOnly: true })]] },
      { label: 'Currency', collapsible: true, collapsed: true, cols: 2, fields: [field('Currency', 'currency', { readOnly: true }), field('Exchange rate', 'exchangeRate', { type: 'float', readOnly: true })] },
      { label: 'Expenses', table: { columns: [{ key: 'expenseDate', label: 'Expense date', type: 'date', edit: true }, { key: 'expenseClaimType', label: 'Expense claim type', type: 'select', options: H.expenseClaimTypes.map((t) => t.name), edit: true }, { key: 'description', label: 'Description', edit: true }, { key: 'amount', label: 'Amount', type: 'currency', edit: true }, { key: 'sanctionedAmount', label: 'Sanctioned amount', type: 'currency', opt: true }], rows: c.expenses, totals: ['amount', 'sanctionedAmount'], onChange: onLines, addLabel: 'Add row', title: 'Expense' } },
      { label: 'Receipts', desc: 'Each receipt is stored as a document with its hash; the payment commits to them.', node: h('div', { style: 'display:grid;gap:6px' }, receiptsBox, o.addReceipt ? h('div', cx.btn('Attach a receipt', { sm: true, icon: 'plus', onClick: () => { o.addReceipt(); drawReceipts(); } })) : null) },
      { label: 'Taxes and charges', collapsible: true, collapsed: !c.taxes.length, table: { columns: [{ key: 'account', label: 'Account', get: (r) => acctName(r.account) }, { key: 'rate', label: 'Rate', type: 'percent' }, { key: 'amount', label: 'Amount', type: 'currency', edit: true }, { key: 'description', label: 'Description' }], rows: c.taxes, totals: ['amount'], onChange: onTaxes } },
      { label: 'Advance payments', collapsible: true, collapsed: !adv.length, table: { columns: [{ key: 'name', label: 'Employee advance', render: (r) => cx.link(r.name, 'advance', r.name) }, { key: 'postingDate', label: 'Posting date', type: 'date' }, { key: 'paidAmount', label: 'Advance paid', type: 'currency' }, { key: 'pendingAmount', label: 'Unclaimed amount', type: 'currency' }], rows: adv, empty: 'No advances to claim against' } },
      { label: 'Totals', node: totalsBox },
      pay ? { label: 'Proof', node: cx.proof(pay, { subtitle: 'The claim\'s lines, VAT and receipts, committed on chain' }) } : null,
    ].filter(Boolean) },
    { label: 'Accounting', sections: [
      { label: 'Accounting details', columns: [[field('Posting date', 'postingDate', { type: 'date', reqd: true }), field('Payable account', 'payable', { readOnly: true })], [field('Paid', 'x1', { readOnly: true, render: () => (pay ? h('span', `${fmt.datetime(pay.settledAt)} · `, cx.hasRoute('payment') ? cx.link(pay.id, 'payment', pay.id) : h('span.mono', pay.id)) : h('span.faint', 'Not yet: Pay is the department\'s')) }), field('Remark', 'remark')]] },
      { label: 'Accounting dimensions', cols: 2, fields: [field('Project', 'projectName', { type: 'link', href: c.project ? ['project', c.project] : null }), field('Cost centre', 'costCenter')] },
    ] },
    { label: 'More info', sections: [{ cols: 2, fields: [field('Status', 'status', { type: 'status' }), field('Amended from', 'amendedFrom')] }] },
  ];
  return cx.formView({ doc, editable, tabKey: 'expense-claim', tabs,
    connections: editable ? null : [{ group: 'Payment', items: [{ label: 'Payment', count: pay ? 1 : 0, route: pay ? 'payment' : null, id: pay?.id }, { label: 'Payment entry', count: pay?.voucher ? 1 : 0, route: pay?.voucher ? 'payment-entry' : null, id: pay?.voucher }] }, { group: 'Reference', items: [{ label: 'Advance', count: adv.length, route: 'advances', id: e.employee }] }],
    side: editable ? null : { id: c.name, title: e.name, cmd: `capxul org hr expense-claim get ${c.name}`, assigned: c.waitingFor ? [c.waitingFor.who] : [], attachments: c.receipts.map((r) => r.name), tags: c.project ? ['client work'] : [], created: { by: c.employee, at: c.postingDate }, modified: { by: c.decidedBy || c.employee, at: c.paymentInfo?.settledAt || c.approvedAt || c.postingDate } },
    timeline: editable ? null : { items: [
      { at: c.postingDate + 'T10:00:00Z', who: c.employee, kind: 'created', text: `claimed ${fmt.gbp(c.totalClaimedAmount)}${c.totalTaxesAndCharges ? ` plus ${fmt.gbp(c.totalTaxesAndCharges)} VAT` : ''}`, body: `${c.receipts.length} receipt${c.receipts.length === 1 ? '' : 's'}` },
      c.decidedBy ? { at: (c.approvedAt || c.postingDate) + 'T14:00:00Z', who: c.decidedBy, kind: c.status === 'Rejected' ? 'cancelled' : 'approval', text: c.status === 'Rejected' ? 'rejected this claim' : `approved this as ${c.decidedHat}`, body: c.rejectionReason || '' } : null,
      pay ? { at: pay.settledAt, kind: 'money', text: `Paid ${fmt.usdc(pay.amount)} (${fmt.gbp(pay.gbp)}) · proof ${fmt.hash(pay.proof.documentHash)}`, href: cx.hasRoute('payment') ? ['payment', pay.id] : null } : null,
    ].filter(Boolean) } });
}

cx.route('expense-claim', (ctx) => {
  const c = cx.find(H.expenseClaims, 'name', ctx.id);
  if (!c) return cx.page({ title: 'Not found', body: cx.empty('No such expense claim') });
  if (!cx.hasSeat() && c.employee !== cx.meId()) return seatGate('Expense claim');
  const e = emp(c.employee);
  const mine = c.employee === cx.meId();
  const need = asNeed(() => budgetDecision(c));
  const actions = [];
  if (c.status === 'Draft' && mine) actions.push(cx.btn('Submit for approval', { kind: 'primary', cmd: `capxul hr expense-claim create --file ${c.name}.json`, onClick: () => { c.status = 'Open'; cx.toast(`Sent to ${cx.name(c.waitingFor?.who || hatHolders(c.department)[0])}`, { cmd: `capxul hr expense-claim create --file ${c.name}.json` }); cx.refresh(); } }));
  if (['Draft', 'Open'].includes(c.status) && mine) actions.unshift(cx.btn('Cancel', { kind: 'danger', cmd: `capxul hr expense-claim cancel ${c.name}`, onClick: async () => { if (await cx.confirm({ title: `Withdraw ${c.name}?`, body: 'It stays on record as Cancelled.', cmd: `capxul hr expense-claim cancel ${c.name}`, danger: true, confirmLabel: 'Withdraw' })) { c.status = 'Cancelled'; dropApproval(c.name); cx.toast('Withdrawn', { cmd: `capxul hr expense-claim cancel ${c.name}` }); cx.refresh(); } } }));
  if (c.status === 'Open' && !mine) actions.push(cx.btn('Reject', { needs: need, cmd: `capxul org hr expense-claim reject ${c.name} --reason "…"`, onClick: () => rejectRecord(c, 'claim', `capxul org hr expense-claim reject ${c.name}`, () => cx.refresh()) }), cx.btn('Approve', { kind: 'primary', icon: 'check', needs: need, cmd: `capxul org hr expense-claim approve ${c.name}`, onClick: () => approveClaim(c) }));
  if (c.status === 'Unpaid' && !mine) actions.push(cx.btn(`Pay ${fmt.gbp(c.grandTotal)}`, { kind: 'primary', icon: 'passkey', needs: need, cmd: `capxul org hr expense-claim pay ${c.name}`, onClick: () => payClaim(c) }));
  actions.push(cx.menu('View', [{ label: 'Ledger', cmd: `capxul org report run general-ledger --filter voucher_no=${c.name}`, href: cx.hasRoute('general-ledger') ? ['general-ledger'] : null, onClick: cx.hasRoute('general-ledger') ? null : () => cx.toast('The ledger lives in Books.') }, c.paymentInfo ? { label: 'Payment', href: cx.hasRoute('payment') ? ['payment', c.paymentInfo.payment] : null, cmd: `capxul payment get ${c.paymentInfo.payment}` } : null]));
  const banner = c.status === 'Open' ? cx.banner(budgetDecision(c).ok ? `Waiting for your decision on ${cx.deptName(c.department)}'s budget.` : mine ? `Waiting for ${cx.deptName(c.department)}'s budget (${namesList(hatHolders(c.department))}).` : budgetDecision(c).reason, { tone: budgetDecision(c).ok ? 'warning' : 'info' })
    : c.status === 'Unpaid' ? cx.banner(`Approved by ${cx.name(c.decidedBy)}. ${budgetDecision(c).ok ? 'You can pay it now: one approval with your passkey.' : `Paid by ${cx.deptName(c.department)}'s hat or one above it.`}`, { tone: 'warning' })
    : c.status === 'Draft' && mine ? cx.banner('A draft: only you can see it until you submit it.', { tone: 'info' }) : null;
  return cx.page({
    title: e.name, crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Expense claims', route: 'expense-claims' }], status: [T(claimText(c), CLAIM_TONE)],
    sub: `${c.name} · ${fmt.date(c.postingDate)} · ${fmt.gbp(c.grandTotal)}`,
    actions,
    cmd: { cli: `capxul org hr expense-claim get ${c.name}`, sdk: `client.org(orgId).hr.expenseClaims.get("${c.name}")`, who: 'the claimant, and anyone with a seat', json: { name: c.name, employee: e.employee, status: c.status.toLowerCase(), grandTotal: c.grandTotal, currency: 'GBP', payment: c.paymentInfo?.payment || null, documentHash: c.paymentInfo?.documentHash || null } },
    banner, fde: `Expense claim ${c.name} from ${e.name}`,
    body: claimForm(c),
  });
}, { workspace: 'hr', title: 'Expense claim' });

cx.route('expense-claim-new', () => {
  const ne = notEmployee('New expense claim'); if (ne) return ne;
  const me = cx.me();
  const c = { employee: me.id, department: me.department, postingDate: cx.today, project: null, expenses: [{ idx: 1, expenseDate: cx.today, expenseClaimType: 'Travel', description: '', amount: 0, sanctionedAmount: 0 }], taxes: [{ account: '2102', rate: null, amount: 0, description: 'VAT on receipts' }], totalClaimedAmount: 0, totalSanctionedAmount: 0, totalTaxesAndCharges: 0, grandTotal: 0, totalAdvanceAmount: 0, totalAmountReimbursed: 0, receipts: [], status: 'Draft', approvalStatus: 'Draft', currency: 'GBP', name: '(new)' };
  const host = h('div');
  const recalc = () => { c.expenses.forEach((x, i) => { x.idx = i + 1; x.sanctionedAmount = x.amount; }); c.totalClaimedAmount = round2(sum(c.expenses, (x) => x.amount)); c.totalSanctionedAmount = c.totalClaimedAmount; c.totalTaxesAndCharges = round2(sum(c.taxes, (x) => x.amount)); c.grandTotal = round2(c.totalClaimedAmount + c.totalTaxesAndCharges); };
  const draw = () => cx.fill(host, claimForm(c, { editable: true, onLines: recalc, onTaxes: recalc, addReceipt: () => { const t = c.expenses.at(-1)?.expenseClaimType?.toLowerCase() || 'receipt'; c.receipts.push({ name: `${t}-receipt-${c.receipts.length + 1}.jpg`, hash: cx.randHex(32) }); cx.toast('Receipt attached and hashed', { cmd: `capxul hr expense-claim create … --receipt ./${c.receipts.at(-1).name}` }); } }));
  draw();
  const cmdOf = () => c.expenses.length === 1 ? `capxul hr expense-claim create --type ${c.expenses[0].expenseClaimType} --amount ${c.expenses[0].amount} --on ${c.expenses[0].expenseDate} --description "${c.expenses[0].description}"${c.receipts.map((r) => ` --receipt ./${r.name}`).join('')}` : 'capxul hr expense-claim create --file claim.json';
  const save = (submit) => {
    recalc();
    if (!c.expenses.length || c.expenses.some((x) => !x.amount || !x.description)) { cx.toast('Each line needs a description and an amount.', { tone: 'warning' }); return; }
    if (submit && !c.receipts.length) { cx.toast('Attach a receipt before you submit.', { tone: 'warning' }); return; }
    c.name = nextName(`HR-EXP-${cx.today.slice(0, 4)}-`, H.expenseClaims.map((x) => x.name));
    const holder = hatHolders(me.department).find((x) => x !== me.id) || hatHolders('harbourline')[0];
    c.waitingFor = { who: holder, hat: cx.deptName(me.department) };
    c.status = submit ? 'Open' : 'Draft';
    H.expenseClaims.push(c);
    if (submit) D.approvals?.waiting?.push({ kind: 'HR', what: `Expense claim: ${me.name}, ${fmt.gbp(c.grandTotal)}`, openedBy: me.id, openedAt: nowIso(), waitsFor: [holder], because: `wears the ${cx.deptName(me.department)} hat`, ref: { type: 'expense-claim', id: c.name }, command: `capxul org hr expense-claim approve ${c.name}` });
    cx.toast(submit ? `Sent ${c.name} to ${cx.name(holder)}` : `Saved ${c.name} as a draft`, { cmd: cmdOf() });
    cx.go('expense-claim', c.name);
  };
  return cx.page({ title: 'New expense claim', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Expense claims', route: cx.hasSeat() ? 'expense-claims' : 'me-expenses' }], status: [{ text: 'Not saved', tone: 'orange' }],
    actions: [cx.btn('Save draft', { cmd: 'capxul hr expense-claim create --file claim.json --draft', onClick: () => save(false) }), cx.btn('Submit for approval', { kind: 'primary', cmd: 'capxul hr expense-claim create --type … --amount … --on … --receipt …', onClick: () => save(true) })],
    cmd: { cli: 'capxul hr expense-claim create --type Travel --amount … --on … --description "…" --receipt ./receipt.pdf', sdk: 'client.me.hr.expenseClaims.create({ type, amount, on, description, receipts })', who: 'any employee, for themselves; no seat needed' },
    body: host });
}, { workspace: 'hr', title: 'New expense claim' });

cx.route('unpaid-claims', () => {
  const g = seatGate('Unpaid expense claims'); if (g) return g;
  return cx.page({ title: 'Unpaid expense claims', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Expenses', route: 'expenses' }],
    body: repView({ key: 'unpaid-claims', filters: [{ key: 'employee', label: 'Employee', type: 'select', options: [['', 'All employees'], ...D.people.map((p) => [p.id, p.name])], value: '' }],
      cmd: (v) => ({ cli: `capxul org hr expense-claim list --status approved${v.employee ? ' --employee ' + empNo(v.employee) : ''}` }),
      run: (v) => ({ columns: [{ key: 'employee', label: 'Employee', href: (r) => ['employee', r.employee] }, { key: 'employeeName', label: 'Employee name' }, { key: 'name', label: 'Expense claim', href: (r) => ['expense-claim', r.name] }, { key: 'sanctioned', label: 'Sanctioned amount', type: 'currency' }, { key: 'paid', label: 'Paid amount', type: 'currency' }, { key: 'outstanding', label: 'Outstanding amount', type: 'currency' }],
        rows: H.expenseClaims.filter((c) => c.status === 'Unpaid' && (!v.employee || c.employee === v.employee)).map((c) => ({ id: c.name, employee: empNo(c.employee), employeeName: empName(c.employee), name: c.name, sanctioned: c.grandTotal, paid: c.totalAmountReimbursed, outstanding: round2(c.grandTotal - c.totalAmountReimbursed) })), totals: true, empty: 'Every approved claim is paid.' }) }) });
}, { workspace: 'hr', title: 'Unpaid expense claims' });

cx.route('advances', (ctx) => {
  const only = empFilterOf(ctx);
  if (!cx.hasSeat() && only !== cx.meId()) return seatGate('Advances');
  return cx.page({ title: 'Advances', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Expenses', route: 'expenses' }],
    actions: [cx.btn('Request an advance', { kind: 'primary', icon: 'plus', href: ['advance-new'], cmd: 'capxul hr advance request --amount … --purpose "…"' })],
    body: cx.listView({ key: 'advances', reset: !!only, initial: onlyInit(ctx), rows: () => H.advances, noun: 'advance',
      titleCol: { key: 'employee', label: 'Employee', get: (r) => empName(r.employee), sub: (r) => r.purpose }, status: (r) => T(r.status, ADV_TONE),
      columns: [{ key: 'postingDate', label: 'Posting date', type: 'date' }, { key: 'claimedAmount', label: 'Claimed amount', type: 'currency' }, { key: 'pendingAmount', label: 'Pending amount', type: 'currency' }],
      right: { key: 'advanceAmount', label: 'Advance amount', type: 'currency' }, modified: (r) => r.paymentInfo?.settledAt || r.postingDate,
      filters: [{ key: 'name', label: 'ID' }, EMP_FILTER, { key: 'status', label: 'Status', type: 'select' }],
      sort: { options: [{ key: 'postingDate', label: 'Posting date' }], default: { key: 'postingDate', dir: 'desc' } },
      href: (r) => ['advance', r.name], cmd: { cli: 'capxul org hr advance list', sdk: 'client.org(orgId).hr.advances.list()' } }) });
}, { workspace: 'hr', title: 'Advances' });

async function payAdvance(a) {
  const dec = budgetDecision(a, 'advance');
  if (!dec.ok) { cx.toast(dec.reason, { tone: 'warning' }); return; }
  const e = emp(a.employee);
  const rate = cx.rate(cx.today);
  const r = await cx.approval({ title: `Pay ${e.name}'s advance`, from: `Harbourline Treasury · ${fmt.addr(D.company.treasury)} · ${cx.deptName(a.department)} budget`, to: paidToLong(e), amount: round2(a.advanceAmount / rate), gbp: a.advanceAmount, rate, signer: cx.meId(), hat: dec.hat, warnings: ['Paying an advance approves it. The unspent part comes back by claim, return or the next payslip.'], cmd: `capxul org hr advance pay ${a.name}`, next: 'capxul payment wait approval_…' });
  if (r.status !== 'done') return;
  const content = await cx.hashOf({ name: a.name, employee: e.employee, purpose: a.purpose, advanceAmount: a.advanceAmount });
  const p = await makePayment({ empId: e.id, gbp: a.advanceAmount, purpose: 'advance', budget: a.department, docKind: 'Employee Advance', doc: a.name, date: a.postingDate, content, lines: [{ idx: 1, description: a.purpose, amount: Math.round(a.advanceAmount * 100), taxes: [] }], approval: cx.newId('approval'), at: r.at, tx: r.tx, block: r.block, hat: dec.hat });
  a.status = 'Paid'; a.paidAmount = a.advanceAmount; a.pendingAmount = a.advanceAmount; a.decidedBy = cx.meId(); a.decidedHat = dec.hat; a.waitingFor = null;
  a.paymentInfo = { payment: p.id, documentHash: p.proof.documentHash, tx: p.proof.tx, settledAt: p.settledAt, amountSent: p.amount };
  dropApproval(a.name);
  cx.toast(`Paid ${e.name} ${fmt.gbp(a.advanceAmount)}`, { cmd: `capxul org hr advance pay ${a.name}` }); cx.refresh();
}

cx.route('advance', (ctx) => {
  const a = cx.find(H.advances, 'name', ctx.id);
  if (!a) return cx.page({ title: 'Not found', body: cx.empty('No such advance') });
  if (!cx.hasSeat() && a.employee !== cx.meId()) return seatGate('Advance');
  const e = emp(a.employee);
  const pay = paymentOf(a.paymentInfo?.payment);
  const mine = a.employee === cx.meId();
  const need = asNeed(() => budgetDecision(a, 'advance'));
  const actions = [];
  if (a.status === 'Requested') {
    if (mine) actions.push(cx.btn('Cancel', { kind: 'danger', cmd: `capxul hr advance cancel ${a.name}`, onClick: async () => { if (await cx.confirm({ title: `Withdraw ${a.name}?`, cmd: `capxul hr advance cancel ${a.name}`, danger: true, confirmLabel: 'Withdraw' })) { a.status = 'Cancelled'; dropApproval(a.name); cx.toast('Withdrawn', { cmd: `capxul hr advance cancel ${a.name}` }); cx.refresh(); } } }));
    if (!mine) actions.push(cx.btn('Reject', { needs: need, cmd: `capxul org hr advance reject ${a.name} --reason "…"`, onClick: () => rejectRecord(a, 'advance', `capxul org hr advance reject ${a.name}`, () => cx.refresh()) }));
    if (!mine) actions.push(cx.btn(`Pay ${fmt.gbp(a.advanceAmount)}`, { kind: 'primary', icon: 'passkey', needs: need, cmd: `capxul org hr advance pay ${a.name}`, onClick: () => payAdvance(a) }));
  }
  if (a.status === 'Paid' && a.pendingAmount > 0) {
    actions.push(cx.menu('Create', [
      { label: 'Expense claim against it', cmd: `capxul hr expense-claim create --advance ${a.name} --type … --amount …`, disabled: !mine, href: mine ? ['expense-claim-new'] : null, hint: mine ? null : `${e.firstName} claims against it` },
      { label: 'Settle from the next payslip…', needs: need, cmd: `capxul org hr advance settle ${a.name}`, onClick: async () => {
        const next = addDays(monthEnd(cx.today.slice(0, 7)), 1).slice(0, 7);
        if (!(await cx.confirm({ title: `Settle ${fmt.gbp(a.pendingAmount)} from ${e.firstName}'s pay`, body: `The unclaimed ${fmt.gbp(a.pendingAmount)} is deducted as Advance Recovery on ${e.firstName}'s ${fmt.month(cx.today.slice(0, 7))} payslip. When that slip is submitted the advance is Returned.`, cmd: [`capxul org hr advance settle ${a.name}`, `capxul org hr advance settle ${a.name} --confirm`], who: `${cx.deptName(a.department)}'s budget`, confirmLabel: 'Settle from pay' }))) return;
        a.settleBySalary = { amount: a.pendingAmount, month: cx.today.slice(0, 7) }; a.repayFromSalary = true;
        cx.toast(`${fmt.gbp(a.pendingAmount)} comes off ${e.firstName}'s ${fmt.month(cx.today.slice(0, 7))} payslip`, { cmd: `capxul org hr advance settle ${a.name} --confirm` }); cx.refresh(); void next;
      } },
    ], { kind: 'primary' }));
  }
  const doc = { ...a, emp: e.employee, employeeName: e.name, deptName: cx.deptName(a.department), company: D.company.name, advanceAccount: '1400 · Employee Advances', repay: a.repayFromSalary ? 1 : 0, projectName: a.project ? D.projects.projects.find((p) => p.name === a.project)?.projectName || a.project : null };
  return cx.page({ title: e.name, crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Advances', route: 'advances' }], status: [T(a.status, ADV_TONE)], sub: `${a.name} · ${a.purpose}`,
    actions,
    cmd: { cli: `capxul org hr advance get ${a.name}`, sdk: `client.org(orgId).hr.advances.get("${a.name}")`, json: { name: a.name, employee: e.employee, amount: a.advanceAmount, paid: a.paidAmount, claimed: a.claimedAmount, returned: a.returnedAmount, pending: a.pendingAmount, status: a.status.toLowerCase() } },
    banner: a.status === 'Requested' ? cx.banner(budgetDecision(a, 'advance').ok ? 'Paying it approves it: one approval with your passkey.' : `Waiting for ${cx.deptName(a.department)}'s budget (${namesList(hatHolders(a.department))}).`, { tone: 'warning' }) : a.settleBySalary && a.status === 'Paid' ? cx.banner(`${fmt.gbp(a.settleBySalary.amount)} comes off ${e.firstName}'s ${fmt.month(a.settleBySalary.month)} payslip as Advance Recovery.`, { tone: 'info' }) : null,
    body: cx.formView({ doc, tabs: [{ label: 'Details', sections: [
      { columns: [[field('Employee', 'emp', { type: 'link', href: ['employee', e.employee], reqd: true }), field('Employee name', 'employeeName')], [field('Posting date', 'postingDate', { type: 'date', reqd: true }), field('Company', 'company', { readOnly: true }), field('Department', 'deptName')]] },
      { label: 'Currency', collapsible: true, collapsed: true, fields: [field('Currency', 'currency')] },
      { label: 'Purpose and amount', columns: [[field('Purpose', 'purpose', { type: 'textarea', reqd: true }), field('Project', 'projectName', { type: 'link', href: a.project ? ['project', a.project] : null })], [field('Advance amount', 'advanceAmount', { type: 'currency', reqd: true }), field('Paid amount', 'paidAmount', { type: 'currency' }), field('Pending amount', 'pendingAmount', { type: 'currency' }), field('Claimed amount', 'claimedAmount', { type: 'currency' }), field('Returned amount', 'returnedAmount', { type: 'currency' })]] },
      { label: 'Accounting', cols: 2, fields: [field('Advance account', 'advanceAccount', { readOnly: true }), field('Repay unclaimed amount from salary', 'repay', { type: 'check' })] },
      pay ? { label: 'Proof', node: cx.proof(pay) } : null,
      { label: 'More info', collapsible: true, collapsed: true, fields: [field('Status', 'status', { type: 'status' }), field('Decided by', 'x', { value: a.decidedBy ? `${cx.name(a.decidedBy)} (${a.decidedHat})` : null })] },
    ].filter(Boolean) }], connections: [{ group: 'Payment', items: [{ label: 'Payment', count: pay ? 1 : 0, route: pay ? 'payment' : null, id: pay?.id }] }, { group: 'Reference', items: [{ label: 'Expense claim', count: a.claimedAmount ? 1 : 0, route: 'expense-claims', id: e.employee }] }],
    side: { id: a.name, title: e.name, cmd: `capxul org hr advance get ${a.name}`, created: { by: a.employee, at: a.postingDate }, modified: { by: a.decidedBy || a.employee, at: a.paymentInfo?.settledAt || a.postingDate } },
    timeline: { items: [{ at: a.postingDate + 'T09:00:00Z', who: a.employee, kind: 'created', text: `asked for ${fmt.gbp(a.advanceAmount)}` }, pay ? { at: pay.settledAt, who: a.decidedBy, kind: 'money', text: `paid it as ${a.decidedHat} · proof ${fmt.hash(pay.proof.documentHash)}` } : null, a.claimedAmount ? { at: addDays(a.postingDate, 12) + 'T10:00:00Z', who: a.employee, kind: 'link', text: `claimed ${fmt.gbp(a.claimedAmount)} against it` } : null, a.returnedAmount ? { at: addDays(a.postingDate, 14) + 'T10:00:00Z', who: a.employee, kind: 'money', text: `returned ${fmt.gbp(a.returnedAmount)}` } : null].filter(Boolean) } }) });
}, { workspace: 'hr', title: 'Advance' });

/** Request an advance as the viewer: the fields, and submit() to make it. */
function advanceFields() {
  const me = cx.me();
  const m = { amount: 300, purpose: '', project: '' };
  const projects = D.projects.projects.filter((p) => p.status === 'Open');
  const node = h('div', { style: 'display:grid;gap:10px' }, h('div.fields', { style: '--cols:1' },
    cx.field({ label: 'Employee', value: `${me.name} · ${me.employee}` }),
    cx.field({ label: 'Purpose', key: 'purpose', model: m, edit: true, type: 'textarea', reqd: true, placeholder: 'Leeds: client kick-off week' }),
    cx.field({ label: 'Advance amount', key: 'amount', model: m, edit: true, type: 'currency', reqd: true }),
    cx.field({ label: 'Project', key: 'project', model: m, edit: true, type: 'select', options: [['', 'None'], ...projects.map((p) => [p.name, p.projectName])] }),
    cx.field({ label: 'Posting date', value: fmt.date(cx.today) })),
  h('p.muted', { style: 'font-size:12.5px' }, `Paid on ${cx.deptName(me.department)}'s budget by whoever wears its hat (${namesList(hatHolders(me.department))}). Paying it approves it.`));
  node.submit = () => {
    if (!m.purpose.trim() || !(+m.amount > 0)) { cx.toast('A purpose and an amount', { tone: 'warning' }); return null; }
    const name = nextName(`HR-EAD-${cx.today.slice(0, 4)}-`, H.advances.map((x) => x.name));
    const holder = hatHolders(me.department).find((x) => x !== me.id) || hatHolders('harbourline')[0];
    H.advances.push({ employee: me.id, postingDate: cx.today, purpose: m.purpose.trim(), currency: 'GBP', advanceAmount: +m.amount, paidAmount: 0, claimedAmount: 0, returnedAmount: 0, pendingAmount: 0, project: m.project || null, department: me.department, repayFromSalary: true, status: 'Requested', name, waitingFor: { who: holder, hat: cx.deptName(me.department) } });
    D.approvals?.waiting?.push({ kind: 'HR', what: `Advance: ${me.name}, ${fmt.gbp(+m.amount)}`, openedBy: me.id, openedAt: nowIso(), waitsFor: [holder], because: `wears the ${cx.deptName(me.department)} hat`, ref: { type: 'advance', id: name }, command: `capxul org hr advance pay ${name}` });
    cx.toast(`Asked ${cx.name(holder)} for ${fmt.gbp(+m.amount)}`, { cmd: `capxul hr advance request --amount ${m.amount} --purpose "${m.purpose.trim()}"` });
    return name;
  };
  return node;
}
export function advanceRequest() {
  if (!cx.me().employee) { cx.toast(`${cx.me().name} is not an employee of Harbourline.`, { tone: 'info' }); return; }
  const f = advanceFields();
  cx.modal({ title: 'Request an advance', body: f, actions: [{ label: 'Cancel' }, { label: 'Request', primary: true, cmd: 'capxul hr advance request --amount … --purpose "…"', onClick: (close) => { const n = f.submit(); if (n) { close(); cx.go('advance', n); } } }] });
}
cx.route('advance-new', () => {
  const ne = notEmployee('New advance'); if (ne) return ne;
  const f = advanceFields();
  return cx.page({ title: 'New advance', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'Advances', route: cx.hasSeat() ? 'advances' : 'me-expenses' }], status: [{ text: 'Not saved', tone: 'orange' }],
    actions: [cx.btn('Request', { kind: 'primary', cmd: 'capxul hr advance request --amount … --purpose "…"', onClick: () => { const n = f.submit(); if (n) cx.go('advance', n); } })],
    cmd: { cli: 'capxul hr advance request --amount 300 --purpose "…"', sdk: 'client.me.hr.advances.request({ amount, purpose })', who: 'any employee, for themselves; no seat needed' },
    body: cx.card({ body: f }) });
}, { workspace: 'hr', title: 'New advance' });

/* =====================================================================================================
   HR configuration
   ===================================================================================================== */

cx.route('hr-config', () => {
  const g = seatGate('HR configuration'); if (g) return g;
  const doc = { naming: 'Naming series (HR-EMP-)', standardHours: 8, retirementAge: null, stopBirthday: 1, emailSlip: 1, leaveNotify: 1, leaveStatusNotify: 1, restrictBackdated: 0, expenseApproverMandatory: 'By hat', leaveApproverMandatory: 'By hat', autoLeaveEncashment: 0, sendLeaveNotice: 'Leave Approval Notification', checkinRadius: 0 };
  return cx.page({ title: 'HR configuration', crumbs: [{ label: 'HR', route: 'hr' }], actions: [cx.btn('Save', { kind: 'primary', needs: 'People', cmd: 'capxul org hr employee list', onClick: () => cx.toast('Saved') })],
    cmd: { cli: 'capxul org hr employee list', note: 'These rules are fixed by Capxul or set on each record; there is no separate settings command.' },
    body: cx.formView({ doc, tabs: [
      { label: 'Employee settings', sections: [{ cols: 2, fields: [field('Employee naming by', 'naming', { readOnly: true }), field('Standard working hours', 'standardHours', { type: 'float' }), field('Retirement age (in years)', 'retirementAge', { type: 'int' }), field('Stop birthday reminders', 'stopBirthday', { type: 'check' })] }] },
      { label: 'Leave and expense', sections: [{ cols: 2, fields: [field('Leave decided by', 'leaveApproverMandatory', { readOnly: true, help: 'The employee\'s department hat or one above it, or People. Never the applicant.' }), field('Expense claims decided by', 'expenseApproverMandatory', { readOnly: true, help: 'The department budget\'s hat or one above it.' }), field('Send leave notification', 'leaveNotify', { type: 'check' }), field('Send leave status notification', 'leaveStatusNotify', { type: 'check' }), field('Restrict backdated leave application', 'restrictBackdated', { type: 'check' })] }] },
      { label: 'Attendance', sections: [{ cols: 2, fields: [field('Allow geolocation tracking', 'checkinRadius', { type: 'check' }), field('Attendance is marked', 'x', { value: 'From check-ins, 60 minutes after each shift ends, on the world\'s clock' })] }] },
    ] }) });
}, { workspace: 'hr', title: 'HR configuration' });

/* =====================================================================================================
   My HR: the employee's own side, shaped like the phone app (Home, Attendance, Leave, Expenses, Salary)
   ===================================================================================================== */

export function appFrame(tab, body, o = {}) {
  const me = cx.me();
  const tabs = [['me', 'Home', 'home'], ['me-attendance', 'Attendance', 'clock'], ['me-leave', 'Leave', 'calendar'], ['me-expenses', 'Expenses', 'file'], ['me-payslips', 'Salary', 'payroll']];
  const unread = (D.notices || []).filter((n) => n.to === me.id && !n.read).length;
  return h('div.hr-app',
    h('div.hr-app-top', h('b', o.title || 'Capxul'), h('span.iconbtn', { title: unread ? `${unread} unread notices` : 'No unread notices', style: 'position:relative' }, cx.icon('bell'), unread ? h('span.badge', String(unread)) : null), cx.avatar(me.id, { size: 'sm' })),
    h('div.hr-app-body', body),
    h('nav.hr-tabbar', { 'aria-label': 'My HR' }, tabs.map(([r, l, i]) => h('a', { href: cx.href(r), class: { on: r === tab }, 'aria-current': r === tab ? 'page' : null }, cx.icon(i, { size: 18 }), l))));
}
/** My HR is for employees; a guest Director with a seat has none of it. */
export const notEmployee = (title) => (cx.me()?.employee ? null : cx.page({ title, crumbs: [{ label: 'HR', route: 'hr' }], cmd: { cli: 'capxul hr leave list', note: 'Your own side of HR lists your records at every employer.' }, body: cx.card({ body: cx.empty(`${cx.me().name} is not an employee of Harbourline, so there is no leave, attendance, claim or payslip of theirs here.`) }) }));
const myPage = (title, tab, body, cmd, extra = {}) => cx.page({ title, crumbs: [{ label: 'HR', route: 'hr' }, { label: 'My HR', route: 'me' }], workspace: tab === 'me-payslips' ? 'payroll' : 'hr', cmd, fde: `${cx.me().name}'s own ${title.toLowerCase()}`, ...extra, body: appFrame(tab, body, extra) });
const panel = (title, kids, right) => h('section.hr-panel', h('h3', h('span.grow', title), right || null), kids);

export function teamRequests() {
  return [...openLeave().filter((l) => leaveDecision(l).ok).map((l) => ({ kind: 'Leave', rec: l, who: l.employee, title: l.leaveType, sub: `${fmt.day(l.fromDate)}${l.toDate !== l.fromDate ? ' to ' + fmt.day(l.toDate) : ''} · ${fmt.num(l.totalLeaveDays, 1)}d`, status: l.status })),
    ...H.expenseClaims.filter((c) => c.status === 'Open' && budgetDecision(c).ok).map((c) => ({ kind: 'Expense claim', rec: c, who: c.employee, title: `${c.expenses[0].expenseClaimType}${c.expenses.length > 1 ? ` & ${c.expenses.length - 1} more` : ''}`, sub: `${fmt.gbp(c.grandTotal)} · ${fmt.day(c.postingDate)}`, status: c.status })),
    ...H.advances.filter((a) => a.status === 'Requested' && budgetDecision(a, 'advance').ok).map((a) => ({ kind: 'Advance', rec: a, who: a.employee, title: 'Advance', sub: `${fmt.gbp(a.advanceAmount)} · ${a.purpose}`, status: a.status }))];
}
/** The request sheet: the request's fields and, for a decider, Approve and Reject. */
function requestSheet(it, after) {
  const r = it.rec; const e = emp(r.employee);
  const isLeave = it.kind === 'Leave';
  const kv = isLeave ? [['Employee', e.name], ['Leave type', r.leaveType], ['From', fmt.date(r.fromDate)], ['To', fmt.date(r.toDate)], ['Total leave days', fmt.num(r.totalLeaveDays, 1)], ['Reason', r.reason], ['Balance', `${fmt.num(leaveDetails(e.id).find((x) => x.leaveType === r.leaveType)?.available ?? 0, 1)} days of ${r.leaveType}`]]
    : it.kind === 'Advance' ? [['Employee', e.name], ['Purpose', r.purpose], ['Advance amount', fmt.gbp(r.advanceAmount)], ['Posting date', fmt.date(r.postingDate)]]
      : [['Employee', e.name], ['Lines', h('div', { style: 'display:grid;gap:2px' }, r.expenses.map((x) => h('span', `${x.expenseClaimType}: ${x.description} · ${fmt.gbp(x.amount)}`)))], ['VAT', fmt.gbp(r.totalTaxesAndCharges)], ['Grand total', fmt.gbp(r.grandTotal)], ['Receipts', `${r.receipts.length}`]];
  const md = cx.modal({ title: `${it.kind}: ${e.name}`, body: h('div', { style: 'display:grid;gap:10px' }, cx.kv(kv), h('div', cx.link(`Open ${r.name}`, isLeave ? 'leave' : it.kind === 'Advance' ? 'advance' : 'expense-claim', r.name, { onclick: () => md.close() }))),
    actions: [
      cx.btn('Reject', { kind: 'danger', cmd: isLeave ? `capxul org hr leave reject ${r.name} --reason "…"` : it.kind === 'Advance' ? `capxul org hr advance reject ${r.name} --reason "…"` : `capxul org hr expense-claim reject ${r.name} --reason "…"`, onClick: async () => { md.close(); if (isLeave) { if (await decideLeave(r, false)) after(); } else rejectRecord(r, it.kind.toLowerCase(), `capxul org hr ${it.kind === 'Advance' ? 'advance' : 'expense-claim'} reject ${r.name}`, after); } }),
      cx.btn(it.kind === 'Advance' ? 'Pay' : 'Approve', { kind: 'primary', icon: it.kind === 'Advance' ? 'passkey' : 'check', cmd: isLeave ? `capxul org hr leave approve ${r.name}` : it.kind === 'Advance' ? `capxul org hr advance pay ${r.name}` : `capxul org hr expense-claim approve ${r.name}`, onClick: async () => { md.close(); if (isLeave) { if (await decideLeave(r, true)) after(); } else if (it.kind === 'Advance') await payAdvance(r); else approveClaim(r); } }),
    ] });
}

function mePage() {
  const me = cx.me();
  if (!me.employee) return cx.page({ title: 'My HR', body: cx.empty(`${me.name} is not an employee of Harbourline.`) });
  const hh = +fmt.time(cx.now.toISOString()).slice(0, 2);
  const mine = checkins().filter((c) => c.employee === me.id).sort((a, b) => a.time.localeCompare(b.time));
  const last = mine.at(-1);
  const inNow = last && last.time.startsWith(cx.today) && last.logType === 'IN';
  const myReq = [
    ...H.leaveApplications.filter((l) => l.employee === me.id).map((l) => ({ kind: 'Leave', route: 'leave', id: l.name, title: l.leaveType, sub: `${fmt.day(l.fromDate)}${l.toDate !== l.fromDate ? ' to ' + fmt.day(l.toDate) : ''} · ${fmt.num(l.totalLeaveDays, 1)}d`, status: T(l.status, LEAVE_TONE), at: l.postingDate })),
    ...H.expenseClaims.filter((c) => c.employee === me.id).map((c) => ({ kind: 'Expense claim', route: 'expense-claim', id: c.name, title: `${c.expenses[0].expenseClaimType}${c.expenses.length > 1 ? ` & ${c.expenses.length - 1} more` : ''}`, sub: `${fmt.gbp(c.grandTotal)} · ${fmt.day(c.postingDate)}`, status: T(claimText(c), CLAIM_TONE), at: c.postingDate })),
    ...H.advances.filter((a) => a.employee === me.id).map((a) => ({ kind: 'Advance', route: 'advance', id: a.name, title: 'Advance', sub: `${fmt.gbp(a.advanceAmount)} · ${a.purpose}`, status: T(a.status, ADV_TONE), at: a.postingDate })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  const team = teamRequests();
  const reqBox = h('div');
  let tabIdx = 0;
  const drawReq = () => {
    const list = tabIdx === 0 ? myReq : team;
    cx.fill(reqBox, h('div', { style: 'display:flex;gap:6px;margin-bottom:6px' }, h('button.lv-tab', { type: 'button', 'aria-pressed': String(tabIdx === 0), onclick: () => { tabIdx = 0; drawReq(); } }, 'My requests', h('small', String(myReq.length))), team.length || (me.hats || []).length ? h('button.lv-tab', { type: 'button', 'aria-pressed': String(tabIdx === 1), onclick: () => { tabIdx = 1; drawReq(); } }, 'Team requests', h('small', String(team.length))) : null),
      list.length ? list.map((r) => tabIdx === 0
        ? h('a.hr-row.click', { href: cx.href(r.route, r.id), style: 'text-decoration:none;color:inherit' }, h('div.grow', h('div.t', `${r.kind}: ${r.title}`), h('div.s', r.sub)), cx.pill(r.status.text, r.status.tone))
        : h('div.hr-row.click', { role: 'button', tabindex: 0, onclick: () => requestSheet(r, () => cx.refresh()), onkeydown: (ev) => { if (ev.key === 'Enter') requestSheet(r, () => cx.refresh()); } }, cx.avatar(r.who, { size: 'sm' }), h('div.grow', h('div.t', `${empName(r.who)} · ${r.kind}`), h('div.s', `${r.title} · ${r.sub}`)), cx.pill(r.status, 'orange'))) : h('div.muted', { style: 'font-size:13px;padding:6px 0' }, tabIdx === 0 ? 'No requests yet.' : 'Nothing waits for you.'));
  };
  drawReq();
  const body = [
    h('p.hr-hello', `${hh < 12 ? 'Good morning' : hh < 18 ? 'Good afternoon' : 'Good evening'}, ${me.firstName}`),
    panel('Check in', h('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' }, h('div.grow', { style: 'flex:1;min-width:0' }, h('div', { style: 'font-weight:600' }, last ? `${last.logType === 'IN' ? 'Checked in' : 'Checked out'} at ${fmt.time(last.time)}${last.time.startsWith(cx.today) ? '' : ' on ' + fmt.day(last.time)}` : 'No check-ins yet'), h('div', { style: 'font-size:12.5px' }, cx.link('View list', 'checkins', me.employee))), cx.btn(inNow ? 'Check out' : 'Check in', { kind: 'primary', icon: inNow ? 'out' : 'in', cmd: `capxul hr attendance checkin --log ${inNow ? 'out' : 'in'}`, onClick: () => checkinSheet() }))),
    panel('Quick links', h('div.hr-quick', h('a', { href: cx.href('leave-new') }, cx.icon('calendar'), 'Request leave'), h('a', { href: cx.href('expense-claim-new') }, cx.icon('file'), 'Claim an expense'), h('button', { type: 'button', onclick: () => advanceRequest() }, cx.icon('bank'), 'Request an advance'), h('a', { href: cx.href('me-payslips') }, cx.icon('payroll'), 'View payslips'))),
    panel('Requests', reqBox),
  ];
  return myPage('My HR', 'me', body, { cli: 'capxul hr leave list', sdk: 'client.me.hr.leaves.list()', who: `${me.name}, for themselves; no seat needed`, note: 'Your own side of HR: the same records without org, at every employer.' });
}
cx.route('me', () => notEmployee('My HR') || mePage(), { workspace: 'hr', title: 'My HR' });

const ATT_CODE = { Present: 'P', 'Work From Home': 'WFH', Absent: 'A', 'On Leave': 'L', 'Half Day': 'HD' };
cx.route('me-attendance', (ctx) => {
  const ne = notEmployee('My attendance'); if (ne) return ne;
  const me = cx.me();
  let ym = ctx.state?.month || cx.today.slice(0, 7);
  const box = h('div');
  const draw = () => {
    const recs = new Map(attendance().filter((x) => x.employee === me.id && x.date.startsWith(ym)).map((x) => [x.date, x]));
    const first = ym + '-01'; const pad = (weekdayOf(first) + 6) % 7;
    const cnt = (s) => [...recs.values()].filter((x) => x.status === s).length;
    cx.fill(box, panel('Attendance calendar', h('div', { style: 'display:grid;gap:10px' },
      h('div', { style: 'display:flex;gap:8px;align-items:center;justify-content:space-between' }, cx.btn(null, { icon: 'left', sm: true, title: 'Previous month', onClick: () => { ym = addDays(first, -1).slice(0, 7); draw(); } }), h('b', fmt.month(ym)), cx.btn(null, { icon: 'right', sm: true, title: 'Next month', onClick: () => { if (ym < cx.today.slice(0, 7)) { ym = addDays(monthEnd(ym), 1).slice(0, 7); draw(); } } })),
      h('div.hr-cal', ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w) => h('div.wd', w)), Array.from({ length: pad }, () => h('div.d.out')), eachDay(first, monthEnd(ym)).map((d) => { const r = recs.get(d); const ho = holidayOn(d); return h('div.d', { class: [r ? ATT_CODE[r.status] : ho ? 'H' : '', d === cx.today && 'today'], title: r ? `${fmt.date(d)}: ${r.status}${r.inTime ? ` · ${r.inTime} to ${r.outTime}` : ''}` : ho ? `${fmt.date(d)}: ${ho.description}` : fmt.date(d) }, String(+d.slice(8))); })),
      h('div.hr-gauges', [['Present', cnt('Present') + cnt('Work From Home')], ['Half day', cnt('Half Day')], ['Absent', cnt('Absent')], ['On leave', cnt('On Leave')]].map(([l, n]) => h('div.hr-gauge', h('b', String(n)), h('small', l)))))));
  };
  draw();
  const sa = H.shiftAssignments.filter((a) => a.employee === me.id && a.status === 'Active');
  const mine = checkins().filter((c) => c.employee === me.id).sort((a, b) => b.time.localeCompare(a.time)).slice(0, 8);
  return myPage('My attendance', 'me-attendance', [box,
    panel('Upcoming shifts', sa.length ? sa.map((a) => h('div.hr-row', h('div.grow', h('div.t', `${a.shiftType} · 09:30 to 18:00`), h('div.s', `Monday to Friday, from ${fmt.date(a.startDate)}`)), cx.pill(a.status, 'green'))) : h('div.muted', 'No shift assigned')),
    panel('Check-ins', [mine.length ? mine.map((c) => h('a.hr-row.click', { href: cx.href('checkin', c.name), style: 'text-decoration:none;color:inherit' }, h('div.grow', h('div.t', c.logType === 'IN' ? 'Check in' : 'Check out'), h('div.s', `${fmt.dateLong(c.time)} · ${c.device}`)), h('b.num', fmt.time(c.time)))) : h('div.muted', 'No check-ins yet'), cx.btn('Check in or out', { sm: true, icon: 'clock', cmd: 'capxul hr attendance checkin --log in', onClick: () => checkinSheet() })]),
  ], { cli: `capxul hr attendance list --start ${ym}-01`, sdk: `client.me.hr.attendances.list({ start: "${ym}-01" })`, who: `${me.name}, for themselves` });
}, { workspace: 'hr', title: 'My attendance' });

function gauge(label, avail, total) {
  const pct = total ? Math.max(0, Math.min(1, avail / total)) : 0;
  const a = Math.PI * (1 - pct);
  const x = 40 + 32 * Math.cos(a), y = 40 - 32 * Math.sin(a);
  const svg = cx.s('svg', { viewBox: '0 0 80 46', width: 96, height: 55, 'aria-hidden': 'true' },
    cx.s('path', { d: 'M8 40 A32 32 0 0 1 72 40', style: 'fill:none;stroke:var(--line-2);stroke-width:7;stroke-linecap:round' }),
    pct > 0 ? cx.s('path', { d: `M8 40 A32 32 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`, style: `fill:none;stroke:var(${avail > 0 ? '--accent' : '--neg'});stroke-width:7;stroke-linecap:round` }) : null);
  return h('div.hr-gauge', svg, h('b', `${fmt.num(avail, 1)} / ${fmt.num(total, 1)}`), h('small', `${label} balance`));
}
cx.route('me-leave', () => {
  const ne = notEmployee('My leave'); if (ne) return ne;
  const me = cx.me();
  const ld = leaveDetails(me.id);
  const recent = H.leaveApplications.filter((l) => l.employee === me.id).sort((a, b) => b.fromDate.localeCompare(a.fromDate)).slice(0, 6);
  const upcoming = H.holidayLists.flatMap((x) => x.holidays).filter((x) => !x.weeklyOff && x.date >= cx.today).slice(0, 4);
  return myPage('My leave', 'me-leave', [
    panel('Leave balance', [h('div.hr-gauges', ld.map((x) => gauge(x.leaveType, x.available, x.totalAllocated))), h('div', { style: 'font-size:12.5px' }, cx.link('View leave history', 'leaves', me.employee))]),
    cx.btn('Request a leave', { kind: 'primary', icon: 'plus', href: ['leave-new'], cmd: 'capxul hr leave apply --type "Annual Leave" --start … --end …' }),
    panel('Recent leaves', recent.length ? recent.map((l) => h('a.hr-row.click', { href: cx.href('leave', l.name), style: 'text-decoration:none;color:inherit' }, h('div.grow', h('div.t', l.leaveType), h('div.s', `${fmt.day(l.fromDate)}${l.toDate !== l.fromDate ? ' to ' + fmt.day(l.toDate) : ''}`)), h('span.num', `${fmt.num(l.totalLeaveDays, 1)}d`), cx.pill(l.status, LEAVE_TONE[l.status]))) : h('div.muted', 'No leave yet'), cx.link('View list', 'leaves', me.employee)),
    panel('Upcoming holidays', upcoming.map((x) => h('div.hr-row', h('div.grow', h('div.t', x.description)), h('span.num', `${fmt.weekday(x.date)} ${fmt.date(x.date)}`))), cx.link('View all', 'holiday-list', `Holidays ${cx.today.slice(0, 4)}`)),
  ], { cli: 'capxul hr leave balance', sdk: 'client.me.hr.leaves.balance()', who: `${me.name}, for themselves`, json: Object.fromEntries(ld.map((x) => [x.leaveType, { allocated: x.totalAllocated, used: x.used, pending: x.pending, available: x.available }])) });
}, { workspace: 'hr', title: 'My leave' });

cx.route('me-expenses', () => {
  const ne = notEmployee('My expenses'); if (ne) return ne;
  const me = cx.me();
  const claims = H.expenseClaims.filter((c) => c.employee === me.id).sort((a, b) => b.postingDate.localeCompare(a.postingDate));
  const adv = H.advances.filter((a) => a.employee === me.id);
  const amt = (f) => fmt.gbp(sum(claims.filter(f), (c) => c.grandTotal));
  return myPage('My expenses', 'me-expenses', [
    panel('Expense claim summary', h('div', { style: 'display:grid;gap:8px' }, h('div', h('div.muted', { style: 'font-size:12px' }, 'Total claimed amount'), h('div', { style: 'font:600 22px/1.2 var(--font-ui);font-variant-numeric:tabular-nums' }, amt(() => true))),
      h('div.hr-gauges', h('div.hr-gauge', h('b', amt((c) => ['Open', 'Draft'].includes(c.status))), h('small', 'Pending')), h('div.hr-gauge', h('b', amt((c) => ['Unpaid', 'Paid'].includes(c.status))), h('small', 'Approved')), h('div.hr-gauge', h('b', amt((c) => c.status === 'Rejected')), h('small', 'Rejected'))))),
    cx.btn('Claim an expense', { kind: 'primary', icon: 'plus', href: ['expense-claim-new'], cmd: 'capxul hr expense-claim create --type … --amount … --on … --receipt …' }),
    panel('Recent expenses', claims.length ? claims.slice(0, 6).map((c) => h('a.hr-row.click', { href: cx.href('expense-claim', c.name), style: 'text-decoration:none;color:inherit' }, h('div.grow', h('div.t', `${c.expenses[0].expenseClaimType}${c.expenses.length > 1 ? ` & ${c.expenses.length - 1} more` : ''}`), h('div.s', `${fmt.date(c.postingDate)}${c.paymentInfo ? ` · paid ${fmt.day(c.paymentInfo.settledAt)} · proof ${fmt.hash(c.paymentInfo.documentHash)}` : ''}`)), h('b.num', fmt.gbp(c.grandTotal)), cx.pill(claimText(c), CLAIM_TONE[c.status]))) : h('div.muted', 'No claims yet'), claims.length ? cx.link('View list', 'expense-claims', me.employee) : null),
    panel('Employee advance balance', [adv.length ? adv.map((a) => h('a.hr-row.click', { href: cx.href('advance', a.name), style: 'text-decoration:none;color:inherit' }, h('div.grow', h('div.t', a.purpose), h('div.s', `${fmt.date(a.postingDate)} · unclaimed ${fmt.gbp(a.pendingAmount)}`)), h('b.num', fmt.gbp(a.advanceAmount)), cx.pill(a.status, ADV_TONE[a.status]))) : h('div.muted', 'No advances'), cx.btn('Request an advance', { sm: true, icon: 'plus', cmd: 'capxul hr advance request --amount … --purpose "…"', onClick: () => advanceRequest() })]),
  ], { cli: 'capxul hr expense-claim list', sdk: 'client.me.hr.expenseClaims.list()', who: `${me.name}, for themselves` });
}, { workspace: 'hr', title: 'My expenses' });

/* =====================================================================================================
   Search
   ===================================================================================================== */

cx.search.add((q, limit) => {
  const s = q.toLowerCase();
  if (!cx.hasSeat()) return [];
  const out = [];
  for (const l of H.leaveApplications) if (out.length < limit && (l.name.toLowerCase().includes(s) || (s.length > 3 && empName(l.employee).toLowerCase().includes(s) && l.status === 'Open'))) out.push({ kind: 'Leave', label: `${l.name} · ${empName(l.employee)}`, sub: `${l.leaveType} · ${l.status}`, route: 'leave', id: l.name, icon: 'calendar' });
  for (const c of H.expenseClaims) if (out.length < limit * 2 && (c.name.toLowerCase().includes(s) || c.expenses.some((x) => x.description.toLowerCase().includes(s)))) out.push({ kind: 'Expense claims', label: `${c.name} · ${empName(c.employee)}`, sub: `${fmt.gbp(c.grandTotal)} · ${claimText(c)}`, route: 'expense-claim', id: c.name, icon: 'file' });
  for (const a of H.advances) if (a.name.toLowerCase().includes(s) || a.purpose.toLowerCase().includes(s)) out.push({ kind: 'Advances', label: `${a.name} · ${empName(a.employee)}`, sub: a.purpose, route: 'advance', id: a.name, icon: 'bank' });
  return out;
});
