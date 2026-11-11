// Books: Harbourline's accounting. The chart of accounts, sales and purchase invoices, payment entries with their
// on-chain proof, journal entries, the general ledger and the financial statements, receivables and payables with
// ageing, banking (the Safes and the Barclays account), cost centres, fiscal years, the review queue and money facts.
// Everything reads cx.data (fictional sample data); actions change it in memory and redraw.
import { cx, h } from './core.js';

const D = cx.data;
const fmt = cx.fmt;
const B = D.books;
const M = D.money;
const TODAY = cx.today;
const NOW = () => cx.now.toISOString();
const RATE = cx.rate(TODAY);

/* =====================================================================================================
   Indexes and small helpers
   ===================================================================================================== */

const r2 = (n) => Math.round((+n + Number.EPSILON) * 100) / 100;
const r6 = (n) => Math.round((+n + Number.EPSILON) * 1e6) / 1e6;
const near0 = (n) => Math.abs(n) < 0.005;
const addTo = (map, k, v) => { let a = map.get(k); if (!a) map.set(k, (a = [])); a.push(v); return a; };
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const minD = (a, b) => (a < b ? a : b);
const maxD = (a, b) => (a > b ? a : b);
function monthsBetween(from, to) {
  const out = []; let [y, m] = from.slice(0, 7).split('-').map(Number);
  const end = to.slice(0, 7);
  for (let i = 0; i < 60; i++) { const k = `${y}-${String(m).padStart(2, '0')}`; if (k > end) break; out.push(k); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

const ACC = new Map();
const reindexAccounts = () => { ACC.clear(); for (const a of B.accounts) if (a.code) ACC.set(a.code, a); };
reindexAccounts();
const acc = (code) => ACC.get(String(code));
const accLabel = (code) => { const a = acc(code); return a ? `${a.code} · ${a.name}` : String(code ?? ''); };
const BANK_CODES = new Set(['1010', '1020', '1030', '1040', '1050']);
const SAFE_CODES = new Set(['1010', '1020']);
const CHAIN_CODES = new Set(['1010', '1020', '1030']);
const ROLE_WORD = { safe: 'Safe', escrow: 'Escrow', bridge: 'Bridge', bank: 'Bank', receivable: 'role', payable: 'role', 'salaries-payable': 'role', opening: 'role', 'income-undecided': 'role', 'expense-undecided': 'role', salaries: 'role', 'bank-charges': 'role', exchange: 'role' };
const isUsdcAcc = (code) => acc(code)?.currency === 'USDC';
const isPL = (code) => ['Income', 'Expense'].includes(acc(code)?.rootType);

const GL = cx.rows('books.gl');
const glBy = new Map();
for (const r of GL) addTo(glBy, r.voucher, r);
const VCH = new Map(B.vouchers.map((v) => [v.name, v]));
const linesOf = (name) => glBy.get(name) || [];

const CUST = new Map(B.customers.map((c) => [c.id, c]));
const SUPP = new Map(B.suppliers.map((s) => [s.id, s]));
const FYS = B.fiscalYears;
const CUR_FY = FYS.find((y) => TODAY >= y.start && TODAY <= y.end) || FYS[FYS.length - 1];
const fyOf = (name) => FYS.find((y) => y.name === name) || CUR_FY;
const CLOSED_THROUGH = FYS.filter((y) => y.closed).map((y) => y.end).sort().pop();

let payIdx = null, payLen = -1, docPays = null;
function indexPayments() {
  if (payLen === M.payments.length) return;
  payIdx = new Map(M.payments.map((p) => [p.id, p]));
  docPays = new Map();
  for (const p of M.payments) {
    const docs = new Set((p.proof?.advice?.allocations || []).map((a) => a.doc));
    for (const d of docs) addTo(docPays, d, p);
    if (p.memo && p.counterparty) addTo(docPays, `memo:${p.counterparty}|${p.memo}`, p);
  }
  payLen = M.payments.length;
}
const payById = (id) => { if (!id) return null; indexPayments(); return payIdx.get(id) || null; };
const payoutOf = (p) => (p ? M.payouts.find((x) => x.payment === p.id || x.id === p.payout) || null : null);
const depositOf = (p) => (p ? M.deposits.find((x) => x.payment === p.id || x.id === p.deposit) || null : null);
const escrowOf = (p) => (p ? M.escrows.find((x) => x.payment === p.id || x.id === p.escrow) || null : null);
function paymentsForPi(pi) {
  indexPayments();
  const list = [...(docPays.get(pi.name) || []), ...(docPays.get(`memo:${pi.supplierName}|${pi.billNo}`) || [])];
  return [...new Set(list)].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function nextName(prefix) {
  let max = 0;
  const scan = (n) => { if (n && n.startsWith(prefix)) max = Math.max(max, +n.slice(prefix.length) || 0); };
  B.vouchers.forEach((v) => scan(v.name)); B.salesInvoices.forEach((i) => scan(i.name)); B.purchaseInvoices.forEach((i) => scan(i.name));
  return prefix + String(max + 1).padStart(5, '0');
}
const YEAR = TODAY.slice(0, 4);

/** Post a voucher and its ledger lines into the books (in memory). */
function postVoucher(v, lines) {
  B.vouchers.push(v); VCH.set(v.name, v);
  if (v.type === 'Payment Entry') B.paymentEntryCount = (B.paymentEntryCount || 0) + 1;
  if (v.type === 'Journal Entry') B.journalEntryCount = (B.journalEntryCount || 0) + 1;
  for (const l of lines) {
    const r = { voucher: v.name, type: v.type, date: v.date, account: l.account, debit: r2(l.debit || 0), credit: r2(l.credit || 0), accDebit: l.accDebit || 0, accCredit: l.accCredit || 0,
      party: l.party || null, partyType: l.partyType || null, costCenter: l.costCenter || null, project: l.project || null, againstType: l.againstType || null, against: l.against || null, closing: 0 };
    GL.push(r); addTo(glBy, v.name, r);
  }
}

function partyName(type, id) {
  if (!id) return '';
  if (type === 'Customer') return CUST.get(id)?.name || id;
  if (type === 'Supplier') return SUPP.get(id)?.name || id;
  if (type === 'Employee') return cx.name(id) || id;
  return CUST.get(id)?.name || SUPP.get(id)?.name || cx.name(id) || id;
}
function partyNode(type, id, label) {
  if (!id) return h('span.faint', '—');
  const name = label || partyName(type, id);
  if (type === 'Customer' && cx.hasRoute('company') && (D.crm?.companies || []).some((c) => c.id === id)) return cx.link(name, 'company', id);
  if (type === 'Employee' && cx.person(id)) return cx.personChip(id);
  return h('span', name);
}
function customerContact(id) {
  const list = (D.crm?.contacts || []).filter((x) => x.company === id);
  return list.find((x) => x.primary) || list[0] || null;
}
const customerEmail = (inv) => customerContact(inv.customer)?.email || `accounts@${CUST.get(inv.customer)?.website || 'example.co.uk'}`;
const projectName = (id) => (D.projects?.projects || []).find((p) => p.name === id)?.projectName || id;
const projectLink = (id) => (!id ? h('span.faint', '—') : cx.hasRoute('project') ? cx.link(`${id} · ${projectName(id)}`, 'project', id) : h('span', `${id} · ${projectName(id)}`));
const ccDept = (cc) => B.costCenters.find((c) => c.name === cc)?.department || null;

const VROUTE = { 'Sales Invoice': 'sales-invoice', 'Purchase Invoice': 'purchase-invoice', 'Payment Entry': 'payment-entry', 'Journal Entry': 'journal-entry', 'Period Closing Voucher': 'period-closing-voucher', 'Expense Claim': 'expense-claim', 'Employee Advance': 'advance', 'Salary Slip': 'payslip', 'Payroll Entry': 'payroll-run' };
function recordTypeOf(name) {
  const n = String(name || '');
  if (n.startsWith('ACC-SINV')) return 'Sales Invoice';
  if (n.startsWith('ACC-PINV')) return 'Purchase Invoice';
  if (n.startsWith('ACC-PAY')) return 'Payment Entry';
  if (n.startsWith('ACC-JV')) return 'Journal Entry';
  if (n.startsWith('ACC-PCV')) return 'Period Closing Voucher';
  if (n.startsWith('HR-EXP')) return 'Expense Claim';
  if (n.startsWith('HR-EAD')) return 'Employee Advance';
  if (n.startsWith('HR-PRUN')) return 'Payroll Entry';
  if (n.startsWith('Sal Slip')) return 'Salary Slip';
  return VCH.get(n)?.type || '';
}
function vLink(name, type) {
  if (!name) return h('span.faint', '—');
  const r = VROUTE[type || recordTypeOf(name)];
  return r && cx.hasRoute(r) ? cx.link(name, r, name) : h('span', name);
}
const vHref = (name) => { const r = VROUTE[recordTypeOf(name)]; return r ? [r, name] : null; };

const VIA = { Barclays: 'Bank', Bridge: 'Bridge', 'Bridge payout': 'Bridge', Capxul: 'Capxul', 'Pay link': 'Capxul', 'Money waiting': 'Capxul' };
const viaOf = (ch) => VIA[ch] || ch || null;
function viaTag(kind, title) { return kind ? h('span.ac-via', { class: 'v-' + String(kind).toLowerCase(), title: title || null }, kind) : h('span.faint', '—'); }
function paidByOfInv(inv) { const k = [...new Set((inv.payments || []).map((p) => viaOf(p.channel)))]; return k.length ? k : null; }

function invStatus(doc) {
  if (doc.docstatus === 0) return 'Draft';
  if (doc.docstatus === 2) return 'Cancelled';
  if (doc.isReturn) return 'Return';
  if (doc.onHold && doc.outstanding > 0) return doc.onHold.release && doc.onHold.release > TODAY ? 'Temporarily on Hold' : 'On Hold';
  if (near0(doc.outstanding)) return doc.creditNote ? (doc.kindOfInv === 'pi' ? 'Debit Note Issued' : 'Credit Note Issued') : 'Paid';
  if (doc.dueDate < TODAY) return 'Overdue';
  return doc.outstanding < doc.grandTotal - 0.005 ? 'Partly Paid' : 'Unpaid';
}

/** Money on its way for an invoice: shown beside its status, never instead of it. */
function siFlight(inv) {
  if (!(inv.outstanding > 0) || inv.docstatus === 0) return null;
  const dep = M.deposits.find((d) => ['Arriving', 'Processing'].includes(d.status) && (d.matchedTo || []).includes(inv.name));
  if (dep) return { text: 'Payment arriving', tone: 'info', title: `${fmt.gbp(dep.bankAmount)} by ${dep.rail} from ${dep.from}, ref ${dep.reference}`, deposit: dep };
  return null;
}
function piFlight(pi) {
  if (!(pi.outstanding > 0) || pi.docstatus === 0) return null;
  const sch = M.scheduled.find((s) => s.status === 'Scheduled' && String(s.what || '').startsWith(pi.name));
  for (const p of paymentsForPi(pi)) {
    if (p.status === 'Money waiting') return { text: 'Money waiting', tone: 'escrow', title: `Waiting in escrow for ${escrowOf(p)?.email || p.counterparty} to claim`, payment: p };
    if (p.status === 'Prepared') { const w = p.waitingFor; return { text: 'Payment prepared', tone: 'neutral', title: w ? `Waiting for ${cx.name(w.who)} to approve` : 'Waiting for approval', payment: p }; }
    const po = payoutOf(p);
    if (po?.status === 'In transit') return { text: 'Payment in transit', tone: 'info', title: `${fmt.gbp(po.bankAmount)} on its way to ${po.bank?.bankName || 'the bank'} ·· ${po.bank?.last4 || ''}`, payment: p, payout: po };
    if (po?.status === 'Refunded' || po?.status === 'Returned') return { text: 'Payout returned', tone: 'warning', title: po.reason || 'The bank returned the payout', payment: p, payout: po };
    if (po?.status === 'Expired') return { text: 'Quote expired', tone: 'neutral', title: po.reason || 'The quote expired before anyone approved it', payment: p, payout: po };
  }
  if (sch) return { text: `Scheduled for ${fmt.day(sch.day)}`, tone: 'info', title: `${fmt.usdc(sch.amount)} from ${sch.budget === 'board' ? 'the Board' : cx.deptName(sch.budget) + "'s budget"}`, sched: sch };
  return null;
}
function pills(status, flight, lg) {
  const kids = [cx.pill(status, null, { lg })];
  if (flight) kids.push(cx.pill(flight.text, flight.tone, { lg, title: flight.title }));
  return lg ? kids : h('span.ac-pills', kids);
}

const BOOKS_CRUMB = { label: 'Books', route: 'books' };
const crumbs = (...more) => [BOOKS_CRUMB, ...more];
const needBooks = { any: ['Books', 'Director'] };
const needInvoicing = 'Invoicing';
const noDownload = (cmd) => cx.toast('This is the command Capxul would run. The mock-up makes no downloads.', { cmd });
const firstSeen = new Set();
const firstVisit = (key) => { if (firstSeen.has(key)) return false; firstSeen.add(key); return true; };
/** A list opens on All the first time; a link that carries filters opens on All with them. */
const listInit = (key) => { const s = cx.current.state?.list; if (s) { firstSeen.add(key); return { ...s, tab: s.tab ?? 'All' }; } return firstVisit(key) ? { tab: 'All' } : undefined; };
const sum = (arr, f) => arr.reduce((a, x) => a + (+(typeof f === 'function' ? f(x) : x[f]) || 0), 0);
const drcr = (n, cur = 'GBP') => (near0(n) ? fmt.money(0, cur) : fmt.money(Math.abs(n), cur) + (n > 0 ? ' Dr' : ' Cr'));

/* =====================================================================================================
   Ledger arithmetic
   ===================================================================================================== */

/** Sum the ledger by account over a period: Map code → { debit, credit, accDebit, accCredit }. */
function sumGl(o = {}) {
  const out = new Map();
  for (const r of GL) {
    if (o.from && r.date < o.from) continue;
    if (o.to && r.date > o.to) continue;
    if (o.exclClosing && r.closing) continue;
    if (r.isCancelled && !o.withCancelled) continue;
    if (o.cc && r.costCenter !== o.cc) continue;
    if (o.project && r.project !== o.project) continue;
    let s = out.get(r.account);
    if (!s) out.set(r.account, (s = { debit: 0, credit: 0, accDebit: 0, accCredit: 0 }));
    s.debit += r.debit; s.credit += r.credit; s.accDebit += r.accDebit || 0; s.accCredit += r.accCredit || 0;
  }
  return out;
}
const netOf = (s, code) => { const x = s.get(code); return x ? x.debit - x.credit : 0; };
const accNetOf = (s, code) => { const x = s.get(code); return x ? x.accDebit - x.accCredit : 0; };
/** P&L sign: income is credit minus debit, expense debit minus credit. */
const plVal = (s, code) => { const x = s.get(code); if (!x) return 0; return acc(code)?.rootType === 'Income' ? x.credit - x.debit : x.debit - x.credit; };

const isRoot = (a) => !a.parent && !a.group;
const ROOTS = () => B.accounts.filter(isRoot);
function kidsOf(node) {
  return B.accounts.filter((x) => x !== node && (node.code ? x.parent === node.code : (x.parent === node.name || (!x.parent && x.group === node.name))));
}
const nodeKey = (a) => a.code || a.name;
const nodeLabel = (a) => (a.code ? `${a.code} · ${a.name}` : a.name);
function leafCodes(node) { const out = []; const walk = (n) => { const k = kidsOf(n); if (!k.length && n.code && !n.isGroup) out.push(n.code); k.forEach(walk); }; walk(node); return out; }
const rootOf = (rootType) => ROOTS().find((r) => r.rootType === rootType);

/**
 * Tree rows for a report: groups first, then their children, with indent; a group's numbers are the sum of its
 * children's. leaf(a) returns a row's numbers (or null to skip), keys are the numeric keys to sum.
 */
function treeRows(nodes, depth, leaf, keys, o = {}) {
  const rows = [];
  for (const n of nodes) {
    const kids = kidsOf(n);
    if (n.isGroup || kids.length || !n.code) {
      const sub = treeRows(kids, depth + 1, leaf, keys, o);
      const direct = sub.filter((r) => r.indent === depth + 1);
      const g = { id: nodeKey(n), code: n.code, account: nodeLabel(n), indent: depth, group: true };
      for (const k of keys) g[k] = sum(direct, k);
      if (!o.hideEmpty || sub.length) rows.push(g, ...sub);
    } else {
      const v = leaf(n);
      if (v) rows.push({ id: n.code, code: n.code, account: nodeLabel(n), indent: depth, ...v });
    }
  }
  return rows;
}

/** Periods of a range by periodicity, fiscal-year aligned. */
function periodsOf(from, to, periodicity) {
  const months = monthsBetween(from, to);
  const size = { Monthly: 1, Quarterly: 3, 'Half-yearly': 6, Yearly: 12 }[periodicity] || 1;
  const fyStartMonth = +(D.company.fiscalYearStart || '04-01').slice(0, 2);
  const out = [];
  let cur = null;
  for (const m of months) {
    const mm = +m.slice(5, 7);
    const idx = ((mm - fyStartMonth + 12) % 12);
    if (!cur || idx % size === 0) { cur = { months: [] }; out.push(cur); }
    cur.months.push(m);
  }
  return out.map((p, i) => {
    const a = p.months[0], b = p.months[p.months.length - 1];
    const pf = i === 0 ? maxD(from, a + '-01') : a + '-01';
    const pt = minD(to, monthEnd(b));
    const label = size === 1 ? fmt.month(a) : size === 12 ? `${fmt.monthShort(a)} ${a.slice(0, 4)}–${fmt.monthShort(b)} ${b.slice(0, 4)}` : `${fmt.monthShort(a)}–${fmt.monthShort(b)} ${b.slice(0, 4)}`;
    return { key: 'p' + i, from: pf, to: pt, label: pt < monthEnd(b) && size === 1 ? `${label} (to ${fmt.day(pt)})` : label };
  });
}

/* =====================================================================================================
   Styles (tokens only)
   ===================================================================================================== */

cx.style('accounting', `
.ac-pills { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.ac-via { display: inline-block; font: 600 10.5px/1.7 var(--font-ui); letter-spacing: .02em; padding: 0 6px; border-radius: 3px; border: 1px solid var(--line); color: var(--fg-2); background: var(--surface-2); white-space: nowrap; }
.ac-via.v-capxul { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, var(--line)); background: var(--accent-soft); }
.ac-via.v-bridge { color: var(--t-blue); border-color: color-mix(in srgb, var(--t-blue) 35%, var(--line)); background: var(--t-blue-bg); }
.ac-via.v-bank { color: var(--t-gray); }
.ac-vias { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.ac-mini { font-size: 12px; color: var(--muted); }
.ac-holds { display: block; font-size: 11.5px; color: var(--muted); font-weight: 400; }
.ac-howto { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.ac-howto > div { border: 1px solid var(--line); border-radius: var(--r); padding: 10px 12px; background: var(--surface-2); display: grid; gap: 4px; align-content: start; min-width: 0; }
.ac-howto h4 { margin: 0; font: 600 12.5px/1.3 var(--font-ui); }
.ac-howto .mono { font-family: var(--font-mono); font-size: 12.5px; overflow-wrap: anywhere; }
@media (max-width: 900px) { .ac-howto { grid-template-columns: minmax(0, 1fr); } }
.ac-flight { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; border: 1px solid var(--line); border-left: 3px solid var(--t-blue); border-radius: var(--r); padding: 9px 12px; background: var(--surface); font-size: 13px; }
.ac-flight.escrow { border-left-color: var(--t-escrow); }
.ac-flight.warn { border-left-color: var(--t-orange); }
.ac-strip { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; min-width: 0; }
.ac-acct { flex: 1 0 172px; max-width: 240px; text-align: left; display: grid; gap: 3px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--surface); color: var(--fg); cursor: pointer; font: inherit; }
.ac-acct:hover { border-color: var(--line-2); }
.ac-acct[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.ac-acct .nm { font-weight: 600; font-size: 13.5px; display: flex; gap: 6px; align-items: center; justify-content: space-between; }
.ac-acct .no { font: 11.5px/1.4 var(--font-mono); color: var(--muted); overflow-wrap: anywhere; }
.ac-acct .bal { font-weight: 600; font-size: 14px; }
.ac-bank { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr) 330px; align-items: start; }
@media (max-width: 1100px) { .ac-bank { grid-template-columns: minmax(0, 1fr); } }
.ac-balance { display: grid; gap: 0; }
.ac-balance .row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; font-size: 13.5px; border-bottom: 1px dashed var(--line); }
.ac-balance .row:last-of-type { border-bottom: 0; }
.ac-balance .row > span:first-child { color: var(--muted); }
.ac-balance .row.big { font-weight: 650; font-size: 15px; border-top: 1px solid var(--line-2); border-bottom: 0; margin-top: 4px; padding-top: 9px; }
.ac-balance .row.big > span:first-child { color: var(--fg); }
.ac-balance .row.bad > span:last-child { color: var(--neg); }
.ac-balance .row.ok > span:last-child { color: var(--pos); }
.ac-progress { height: 6px; border-radius: 3px; background: var(--sunk); overflow: hidden; margin-top: 6px; }
.ac-progress > i { display: block; height: 100%; background: var(--accent); }
.ac-match { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; }
@media (max-width: 900px) { .ac-match { grid-template-columns: minmax(0, 1fr); } }
.ac-lines { display: grid; gap: 8px; }
.ac-line { display: grid; gap: 3px; text-align: left; width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); color: var(--fg); cursor: pointer; font: inherit; min-width: 0; }
.ac-line:hover { border-color: var(--line-2); }
.ac-line[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.ac-line .top { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.ac-line .desc { font-weight: 600; font-size: 13px; overflow-wrap: anywhere; min-width: 0; }
.ac-line .amt { font-weight: 650; white-space: nowrap; }
.ac-line .meta { font-size: 12px; color: var(--muted); display: flex; gap: 8px; flex-wrap: wrap; }
.ac-cand { display: grid; gap: 6px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); }
.ac-cand .top { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.ac-create { display: grid; gap: 8px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 560px) { .ac-create { grid-template-columns: minmax(0, 1fr); } }
.ac-create button { text-align: left; display: grid; gap: 3px; padding: 10px 12px; border: 1px dashed var(--line-2); border-radius: var(--r); background: var(--surface-2); color: var(--fg); font: inherit; cursor: pointer; }
.ac-create button:hover { border-color: var(--accent); }
.ac-create b { font-size: 13px; }
.ac-create span { font-size: 12px; color: var(--muted); }
.ac-age { display: grid; gap: 8px; }
.ac-age-bar { display: flex; height: 18px; border-radius: 4px; overflow: hidden; background: var(--sunk); }
.ac-age-bar > i { display: block; height: 100%; min-width: 2px; }
.ac-age-legend { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 12.5px; }
.ac-age-legend span { display: inline-flex; align-items: center; gap: 6px; }
.ac-age-legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.ac-age-legend b { font-weight: 600; }
.ac-sum { display: grid; gap: 4px; font-size: 13.5px; max-width: 560px; }
.ac-sum .row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; border-bottom: 1px solid var(--line); }
.ac-sum .row.big { font-weight: 650; border-bottom: 0; border-top: 1px solid var(--line-2); }
.ac-cc { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12.5px; color: var(--muted); }
.ac-meter { width: 120px; height: 6px; border-radius: 3px; background: var(--sunk); overflow: hidden; display: inline-block; vertical-align: middle; }
.ac-meter > i { display: block; height: 100%; background: var(--chart-1); }
.ac-meter.warn > i { background: var(--t-orange); }
.ac-check { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; font-size: 13px; }
.ac-check li { display: flex; gap: 8px; align-items: flex-start; }
.ac-check li .ic { color: var(--pos); flex: 0 0 auto; margin-top: 2px; }
.ac-note { font-size: 12.5px; color: var(--muted); max-width: 72ch; }
.ac-form-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 560px) { .ac-form-grid { grid-template-columns: minmax(0, 1fr); } }
.ac-form-grid .wide { grid-column: 1 / -1; }
.ac-choice { display: grid; gap: 8px; }
.ac-choice label { display: flex; gap: 10px; align-items: flex-start; padding: 9px 11px; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); cursor: pointer; }
.ac-choice label:has(input:checked) { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.ac-choice input { margin-top: 3px; }
.ac-choice .t { display: grid; gap: 2px; min-width: 0; }
.ac-choice .t b { font-size: 13.5px; }
.ac-choice .t span { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
.ac-choice label[aria-disabled="true"] { opacity: .55; cursor: not-allowed; }
.ac-quote { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 14px; font-size: 13px; padding: 10px 12px; background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r); }
.ac-quote dt { color: var(--muted); }
.ac-quote dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.ac-pays { display: grid; gap: 4px; font-size: 13px; }
.ac-pays .ln { display: flex; justify-content: space-between; gap: 12px; }
.ac-pays .ln span:last-child { white-space: nowrap; }
.ac-err { color: var(--neg); font-size: 12.5px; }
.ac-bank > *, .ac-match > *, .ac-wrap > * { min-width: 0; }
.ac-tb-acct a { color: inherit; }
.ac-section-note { font-size: 12.5px; color: var(--muted); margin: 0; }
.ac-hidden { display: none !important; }
`);

/* =====================================================================================================
   The workspace, its sidebar and search
   ===================================================================================================== */

const openSi = () => B.salesInvoices.filter((i) => i.docstatus !== 0 && i.docstatus !== 2 && i.outstanding > 0.005);
const openPi = () => B.purchaseInvoices.filter((i) => i.docstatus !== 0 && i.docstatus !== 2 && i.outstanding > 0.005);
const unreconciledBank = () => B.bankTransactions.filter((t) => t.onStatement && t.status === 'Unreconciled');
const reviewRows = () => GL.filter((r) => (r.account === '4999' || r.account === '6999') && !r.closing);

cx.workspace({
  id: 'books', label: 'Books', icon: 'books', route: 'books',
  badge: () => openSi().filter((i) => i.dueDate < TODAY).length || null,
  nav: [
    { label: 'Home', route: 'books' },
    { label: 'Chart of accounts', route: 'chart-of-accounts', match: ['account'] },
    { label: 'Sales invoices', route: 'sales-invoices', match: ['sales-invoice'] },
    { label: 'Purchase invoices', route: 'purchase-invoices', match: ['purchase-invoice'] },
    { label: 'Payment entries', route: 'payment-entries', match: ['payment-entry'] },
    { label: 'Journal entries', route: 'journal-entries', match: ['journal-entry'] },
    { section: 'Reports', items: [
      { label: 'General ledger', route: 'general-ledger' },
      { label: 'Trial balance', route: 'trial-balance' },
      { label: 'Profit and loss', route: 'profit-and-loss' },
      { label: 'Balance sheet', route: 'balance-sheet' },
      { label: 'Cash flow', route: 'cash-flow' },
      { label: 'Accounts receivable', route: 'accounts-receivable', match: ['accounts-receivable-summary'] },
      { label: 'Accounts payable', route: 'accounts-payable', match: ['accounts-payable-summary'] },
      { label: 'VAT returns', route: 'vat-returns' },
    ] },
    { section: 'Banking', items: [
      { label: 'Banking', route: 'banking', badge: () => unreconciledBank().length || null },
      { label: 'Bank accounts', route: 'bank-accounts', match: ['bank-account'] },
    ] },
    { section: 'Capxul', items: [
      { label: 'Review queue', route: 'review-queue', badge: () => reviewRows().length || null },
      { label: 'Money facts', route: 'money-facts' },
    ] },
    { section: 'Setup', collapsed: true, items: [
      { label: 'Chart of cost centres', route: 'cost-centres' },
      { label: 'Fiscal years', route: 'fiscal-years', match: ['period-closing-voucher'] },
      { label: 'Department budgets', route: 'departments' },
    ] },
  ],
});

cx.search.add((q, limit) => {
  const s = q.toLowerCase();
  const out = [];
  const hit = (t) => String(t || '').toLowerCase().includes(s);
  for (const i of B.salesInvoices) if (hit(i.name) || hit(i.customerName) || hit(i.rfReference)) out.push({ kind: 'Sales invoices', label: `${i.name} · ${i.customerName}`, sub: `${fmt.money(i.grandTotal, i.currency)} · ${invStatus(i)}`, route: 'sales-invoice', id: i.name, icon: 'file' });
  for (const i of B.purchaseInvoices) if (hit(i.name) || hit(i.supplierName) || hit(i.billNo)) out.push({ kind: 'Purchase invoices', label: `${i.name} · ${i.supplierName}`, sub: `${i.billNo} · ${fmt.money(i.grandTotal, i.currency)} · ${invStatus(i)}`, route: 'purchase-invoice', id: i.name, icon: 'file' });
  for (const v of B.vouchers) if ((v.type === 'Payment Entry' || v.type === 'Journal Entry') && (hit(v.name) || hit(v.title))) out.push({ kind: v.type === 'Payment Entry' ? 'Payment entries' : 'Journal entries', label: `${v.name} · ${v.title}`, sub: `${fmt.date(v.date)} · ${fmt.gbp(v.total)}`, route: v.type === 'Payment Entry' ? 'payment-entry' : 'journal-entry', id: v.name, icon: 'books' });
  for (const a of B.accounts) if (a.code && (hit(a.code) || hit(a.name))) out.push({ kind: 'Accounts', label: `${a.code} · ${a.name}`, sub: a.rootType, route: 'account', id: a.code, icon: 'books' });
  return out.slice(0, limit * 4);
});

/* =====================================================================================================
   Books home
   ===================================================================================================== */

function plMonth(m) {
  const s = sumGl({ from: m + '-01', to: minD(monthEnd(m), TODAY), exclClosing: true });
  let inc = 0, exp = 0;
  for (const code of s.keys()) { const a = acc(code); if (a?.rootType === 'Income') inc += plVal(s, code); else if (a?.rootType === 'Expense') exp += plVal(s, code); }
  return { m, inc: r2(inc), exp: r2(exp), net: r2(inc - exp) };
}
function ageBuckets(list, asOf, gbpOf) {
  const b = [{ label: 'Not due', value: 0, color: '2' }, { label: '1-30 days', value: 0, color: '1' }, { label: '31-60 days', value: 0, color: '3' }, { label: '61-90 days', value: 0, color: '4' }, { label: '90+ days', value: 0, color: 'danger' }];
  for (const i of list) { const age = daysBetween(i.dueDate, asOf); const v = gbpOf(i); b[age <= 0 ? 0 : age <= 30 ? 1 : age <= 60 ? 2 : age <= 90 ? 3 : 4].value += v; }
  return b;
}
const siGbp = (i) => r2(i.outstanding * (i.conversionRate || 1));
const piGbp = (i) => r2(i.outstanding * (i.conversionRate || 1));

cx.route('books', () => {
  const fy = CUR_FY;
  const full = monthsBetween(fy.start, TODAY).filter((m) => monthEnd(m) < TODAY);
  const pl = full.map(plMonth);
  const inFy = (d) => d >= fy.start && d <= TODAY;
  const sis = B.salesInvoices.filter((i) => i.docstatus !== 0 && i.docstatus !== 2 && !i.isOpening && inFy(i.postingDate));
  const pis = B.purchaseInvoices.filter((i) => i.docstatus !== 0 && i.docstatus !== 2 && !i.isOpening && inFy(i.postingDate));
  const pes = B.vouchers.filter((v) => v.type === 'Payment Entry' && inFy(v.date) && !v.cancelled && (v.partyType === 'Customer' || v.partyType === 'Supplier' || v.partyType === 'Employee'));
  const byMonth = (list, dateKey, val) => full.map((m) => sum(list.filter((x) => String(x[dateKey]).startsWith(m)), val));
  const siM = byMonth(sis, 'postingDate', 'baseNetTotal');
  const piM = byMonth(pis, 'postingDate', (i) => i.netTotalGbp ?? i.netTotal);
  const inM = byMonth(pes.filter((v) => v.paymentType === 'Receive'), 'date', 'total');
  const outM = byMonth(pes.filter((v) => v.paymentType === 'Pay'), 'date', 'total');
  const delta = (arr) => { const a = arr[arr.length - 2], b = arr[arr.length - 1]; if (!a) return null; const d = (b - a) / a; return { text: `${d >= 0 ? '+' : '−'}${fmt.num(Math.abs(d) * 100, 1)}% on ${fmt.monthShort(full[full.length - 2])}`, good: d >= 0 }; };
  const t = M.safes.treasury, rs = M.safes.reserve;
  const openE = M.escrows.filter((e) => e.status === 'Open');
  const sOpen = openSi(), pOpen = openPi();
  const arAge = ageBuckets(sOpen, TODAY, siGbp), apAge = ageBuckets(pOpen, TODAY, piGbp);
  const toRec = unreconciledBank().length;
  const plCmd = `capxul org books reports profit-and-loss --from ${fy.start} --to ${monthEnd(full[full.length - 1])}`;
  const chase = openSi().filter((i) => i.dueDate < TODAY).sort((a, b) => b.outstanding * (b.conversionRate || 1) - a.outstanding * (a.conversionRate || 1))[0];
  const chaseDraft = chase ? cx.draft({ for: 'maya', by: '@harbourline-fde', at: TODAY + 'T08:30:00Z', title: `Send ${chase.customerName} a payment reminder for ${chase.name}`,
    why: `${fmt.money(chase.outstanding, chase.currency)} of ${fmt.money(chase.grandTotal, chase.currency)} is ${daysBetween(chase.dueDate, TODAY)} days past its due date (${fmt.date(chase.dueDate)}).${chase.payments?.length ? ` The first ${fmt.money(chase.payments[0].amount, chase.currency)} arrived through ${viaOf(chase.payments[0].channel)} on ${fmt.date(chase.payments[0].date)}.` : ''} Maya wears the Invoicing hat, so the reminder is hers to send.`,
    steps: [`A level-1 reminder to ${customerEmail(chase)}`, `The pay link and the bank details, quoting ${chase.rfReference}`, 'Look again in seven days'],
    cmd: [`capxul org doc create dunning --from sales-invoice ${chase.name}`, requestCmd(chase)], needs: needInvoicing, runLabel: 'Review and send', onRun: () => dunning(chase) }) : null;
  return cx.workspacePage({
    title: 'Books', workspace: 'books', body: chaseDraft, order: ['cards', 'body', 'charts', 'shortcuts', 'quick', 'links'],
    sub: `Fiscal year ${fy.name} · closed through ${fmt.date(CLOSED_THROUGH)} · GBP`,
    cmd: { cli: plCmd, sdk: `client.org(orgId).books.reports.profitAndLoss({ from: "${fy.start}", to: "${monthEnd(full[full.length - 1])}" })`, who: 'anyone with a seat', json: { from: fy.start, to: monthEnd(full[full.length - 1]), income: r2(sum(pl, 'inc')), expense: r2(sum(pl, 'exp')), profit: r2(sum(pl, 'net')), currency: 'GBP' } },
    fde: `Books home: fiscal year ${fy.name} to date`,
    actions: [
      cx.btn('Export for your accountant', { icon: 'file', cmd: `capxul org books export quickbooks --from ${fy.start} --to ${monthEnd(full[full.length - 1])} --out ./export`, onClick: () => noDownload(`capxul org books export quickbooks --from ${fy.start} --to ${monthEnd(full[full.length - 1])} --out ./export`) }),
      cx.menu('Create', [
        { label: 'Sales invoice', icon: 'file', needs: needInvoicing, cmd: 'capxul org doc create sales-invoice --input invoice.json', onClick: () => newSalesInvoice() },
        { label: 'Purchase invoice', icon: 'file', needs: needBooks, cmd: 'capxul org doc create purchase-invoice --input bill.json', onClick: () => newPurchaseInvoice() },
        { label: 'Journal entry', icon: 'books', needs: needBooks, cmd: 'capxul org doc create journal-entry --input entry.json', onClick: () => newJournalEntry() },
        { label: 'Payment entry (Barclays)', icon: 'bank', needs: needBooks, cmd: 'capxul org doc create payment-entry --input payment.json', onClick: () => newPaymentEntry() },
      ], { kind: 'primary' }),
    ],
    cards: [
      { label: 'Sales invoiced', value: fmt.gbp(sum(sis, 'baseNetTotal')), sub: `net of VAT, ${fy.name} to date`, delta: delta(siM), href: ['sales-invoices'], spark: siM, cmd: 'capxul org doc list sales-invoice --filter docstatus=1' },
      { label: 'Bills received', value: fmt.gbp(sum(pis, (i) => i.netTotalGbp ?? i.netTotal)), sub: `net of VAT, ${fy.name} to date`, delta: delta(piM) && { ...delta(piM), good: !delta(piM).good }, href: ['purchase-invoices'], spark: piM, cmd: 'capxul org doc list purchase-invoice --filter docstatus=1' },
      { label: 'Received', value: fmt.gbp(sum(pes.filter((v) => v.paymentType === 'Receive'), 'total')), sub: 'from customers', delta: delta(inM), href: ['payment-entries'], spark: inM, cmd: 'capxul org doc list payment-entry --filter payment_type=Receive' },
      { label: 'Paid', value: fmt.gbp(sum(pes.filter((v) => v.paymentType === 'Pay'), 'total')), sub: 'to suppliers and staff', href: ['payment-entries'], spark: outM, cmd: 'capxul org doc list payment-entry --filter payment_type=Pay' },
      { label: 'In Safes', value: fmt.usdc(t.balance + rs.balance), sub: `${fmt.gbp(t.gbp + rs.gbp)} · Treasury and Reserve`, href: ['banking', '1010'], cmd: 'capxul balance --org harbourline' },
      { label: 'Money waiting', value: fmt.usdc(M.safes.moneyWaiting.balance), sub: `${fmt.plural(openE.length, 'escrow')} not yet claimed`, href: ['banking', '1030'], cmd: 'capxul payment list --status escrowed' },
      { label: 'To review', value: fmt.int(reviewRows().length), sub: 'rows in 4999 and 6999', href: ['review-queue'], cmd: 'capxul org books accounts review' },
      { label: 'Reconciled', value: toRec ? `${toRec} to match` : 'All matched', sub: 'Safes match the chain · Barclays to 6 Nov', delta: toRec ? { text: `${toRec} Barclays lines open`, good: false } : { text: 'Nothing open', good: true }, href: ['banking', '1050'], cmd: 'capxul org books reports reconcile' },
    ],
    charts: [
      { title: `Profit and loss, ${fmt.month(full[0])} to ${fmt.month(full[full.length - 1])}`, wide: true, cmd: plCmd,
        actions: cx.btn('Open report', { sm: true, href: ['profit-and-loss'] }),
        node: cx.chart.bar({ labels: pl.map((x) => fmt.monthShort(x.m)), series: [{ name: 'Income', values: pl.map((x) => x.inc), color: 'pos' }, { name: 'Expense', values: pl.map((x) => x.exp), color: 'neg' }], line: { name: 'Net profit', values: pl.map((x) => x.net) }, format: (v) => fmt.compact(v, 'GBP'), tipFormat: (v) => fmt.gbp(v), onClick: (i) => cx.go('general-ledger', null, { report: { from: pl[i].m + '-01', to: monthEnd(pl[i].m), account: '' } }) }) },
      { title: 'Accounts receivable ageing', cmd: `capxul org report run accounts-receivable --filter report_date=${TODAY}`, actions: cx.btn('Open', { sm: true, href: ['accounts-receivable'] }),
        node: cx.chart.donut({ items: arAge, center: fmt.compact(sum(arAge, 'value'), 'GBP'), format: (v) => fmt.gbp(v, 0), tipFormat: (v) => fmt.gbp(v) }) },
      { title: 'Accounts payable ageing', cmd: `capxul org report run accounts-payable --filter report_date=${TODAY}`, actions: cx.btn('Open', { sm: true, href: ['accounts-payable'] }),
        node: cx.chart.donut({ items: apAge, center: fmt.compact(sum(apAge, 'value'), 'GBP'), format: (v) => fmt.gbp(v, 0), tipFormat: (v) => fmt.gbp(v) }) },
    ],
    shortcuts: [
      { label: 'Sales invoices', route: 'sales-invoices', count: sOpen.length, tone: 'orange', icon: 'file' },
      { label: 'Purchase invoices', route: 'purchase-invoices', count: pOpen.length, tone: 'orange', icon: 'file' },
      { label: 'Payment entries', route: 'payment-entries', icon: 'shield' },
      { label: 'Journal entries', route: 'journal-entries', icon: 'books' },
      { label: 'Chart of accounts', route: 'chart-of-accounts', icon: 'tree' },
      { label: 'General ledger', route: 'general-ledger', icon: 'report' },
      { label: 'Banking', route: 'banking', count: toRec || null, tone: 'orange', icon: 'bank' },
      { label: 'Review queue', route: 'review-queue', count: reviewRows().length || null, tone: 'yellow', icon: 'eye' },
    ],
    quick: [
      { title: 'Owed to Harbourline', cmd: 'capxul org doc list sales-invoice --filter "outstanding_amount>0"', items: sOpen.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((i) => ({ label: `${i.customerName}`, sub: `${i.name} · due ${fmt.date(i.dueDate)} · ${invStatus(i)}${siFlight(i) ? ' · ' + siFlight(i).text : ''}`, right: fmt.money(i.outstanding, i.currency), route: 'sales-invoice', id: i.name })) },
      { title: 'Bills to pay', cmd: 'capxul org doc list purchase-invoice --filter "outstanding_amount>0"', items: pOpen.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((i) => ({ label: `${i.supplierName}`, sub: `${i.billNo} · due ${fmt.date(i.dueDate)} · ${invStatus(i)}${piFlight(i) ? ' · ' + piFlight(i).text : ''}`, right: fmt.money(i.outstanding, i.currency), route: 'purchase-invoice', id: i.name })) },
    ],
    links: [
      { title: 'Financial statements', items: [{ label: 'Profit and loss', route: 'profit-and-loss', kind: 'report' }, { label: 'Balance sheet', route: 'balance-sheet', kind: 'report' }, { label: 'Cash flow', route: 'cash-flow', kind: 'report' }, { label: 'Trial balance', route: 'trial-balance', kind: 'report' }, { label: 'General ledger', route: 'general-ledger', kind: 'report' }] },
      { title: 'Receivables and payables', items: [{ label: 'Accounts receivable', route: 'accounts-receivable', kind: 'report' }, { label: 'Accounts receivable summary', route: 'accounts-receivable-summary', kind: 'report' }, { label: 'Accounts payable', route: 'accounts-payable', kind: 'report' }, { label: 'Accounts payable summary', route: 'accounts-payable-summary', kind: 'report' }, { label: 'Customer ledger summary', kind: 'report' }, { label: 'Supplier ledger summary', kind: 'report' }] },
      { title: 'Records', items: [{ label: 'Sales invoices', route: 'sales-invoices', count: B.salesInvoices.length }, { label: 'Purchase invoices', route: 'purchase-invoices', count: B.purchaseInvoices.length }, { label: 'Payment entries', route: 'payment-entries', count: B.vouchers.filter((v) => v.type === 'Payment Entry').length }, { label: 'Journal entries', route: 'journal-entries', count: B.vouchers.filter((v) => v.type === 'Journal Entry').length }] },
      { title: 'Tax', items: [{ label: 'VAT returns', route: 'vat-returns', kind: 'report', count: B.vatReturns.length }, { label: 'Sales tax templates' }, { label: 'Purchase tax templates' }] },
      { title: 'Banking', items: [{ label: 'Banking', route: 'banking', icon: 'bank' }, { label: 'Bank accounts', route: 'bank-accounts', icon: 'bank' }, { label: 'Bank reconciliation statement', route: 'banking', id: '1050', kind: 'report' }] },
      { title: 'Opening and closing', items: [{ label: 'Set up the chart', route: 'chart-of-accounts' }, { label: 'Period closing voucher', route: 'period-closing-voucher', id: B.periodClosing.name }, { label: 'Fiscal years', route: 'fiscal-years' }] },
      { title: 'Capxul', items: [{ label: 'Review queue', route: 'review-queue', count: reviewRows().length }, { label: 'Money facts', route: 'money-facts' }, { label: 'Department budgets', route: 'departments' }] },
      { title: 'Setup', items: [{ label: 'Chart of cost centres', route: 'cost-centres', icon: 'tree' }, { label: 'Payment terms' }, { label: 'Currency exchange' }] },
    ],
  });
}, { workspace: 'books', title: 'Books' });

/* =====================================================================================================
   Chart of accounts and the account form
   ===================================================================================================== */

function accBadges(a) {
  const out = [];
  if (a.code && a.currency && a.currency !== 'GBP') out.push(cx.tag(a.currency));
  if (a.role === 'safe') out.push(cx.pill('Safe', 'teal'), h('span.pill.t-gray', { title: 'Only Capxul’s own chain postings reach this account' }, cx.icon('lock', { size: 11 }), ' Chain'));
  else if (a.role === 'escrow') out.push(cx.pill('Escrow', 'escrow'));
  else if (a.role === 'bridge') out.push(cx.pill('Bridge', 'blue'));
  else if (a.role === 'bank') out.push(cx.pill('Bank', 'gray'));
  else if (a.role) out.push(h('span.tag', { title: `Capxul relies on this account (${a.role}): it cannot be archived or take sub-accounts` }, 'role'));
  if (a.archived) out.push(cx.pill('Archived', 'muted'));
  return out;
}
function nextCode(parentKey) {
  const p = B.accounts.find((a) => nodeKey(a) === parentKey);
  if (!p) return '';
  const kids = kidsOf(p).filter((a) => a.code).map((a) => +a.code);
  if (p.code) { let c = +p.code + 1; while (ACC.has(String(c))) c++; return String(c); }
  const normal = kids.filter((c) => c % 1000 < 990 && c % 100 !== 99);
  const top = normal.length ? Math.max(...normal) : ({ Asset: 1000, Liability: 2000, Equity: 3000, Income: 4000, Expense: 6000 }[p.rootType] || 9000);
  let c = (Math.floor(top / 100) + 1) * 100;
  if (Math.floor(c / 1000) !== Math.floor(top / 1000)) { c = Math.floor(top / 10) * 10 + 10; while (ACC.has(String(c))) c += 10; }
  while (ACC.has(String(c))) c += 100;
  return String(c);
}
function openAddAccount(parent) {
  const groups = B.accounts.filter((a) => (a.isGroup || !a.code) && !a.role);
  const model = { name: '', parent: parent ? nodeKey(parent) : 'Operating expenses', accountType: '', currency: 'GBP', isGroup: 0 };
  const codeEl = h('div.fval.num');
  const err = h('div.ac-err');
  const sync = () => { const c = nextCode(model.parent); codeEl.textContent = c; cx.showAction(`capxul org books accounts add "${model.name || 'New account'}" --under ${model.parent}`, 'Add account'); };
  const body = h('div', { style: 'display:grid;gap:12px' },
    h('div.ac-form-grid',
      cx.field({ label: 'Account name', key: 'name', model, edit: true, reqd: true, placeholder: 'Events and conferences', onChange: sync }),
      h('div.field', h('div.flabel', 'Account number'), codeEl, h('div.fhelp', 'Capxul gives the next free number under the parent.')),
      cx.field({ label: 'Parent account', key: 'parent', model, edit: true, type: 'select', reqd: true, options: groups.map((g) => [nodeKey(g), nodeLabel(g)]), onChange: sync }),
      cx.field({ label: 'Account type', key: 'accountType', model, edit: true, type: 'select', options: [['', '—'], 'Expense Account', 'Income Account', 'Tax', 'Fixed Asset', 'Payable', 'Receivable', 'Equity'] }),
      cx.field({ label: 'Currency', key: 'currency', model, edit: true, type: 'select', options: ['GBP', 'USD', 'EUR'] }),
      cx.field({ label: 'Is group', key: 'isGroup', model, edit: true, type: 'check', checkLabel: 'It holds sub-accounts' })),
    err,
    h('p.ac-note', 'A Safe’s account, the receivable and payable, payroll payable and the not-decided accounts are Capxul’s own and cannot be parents.'));
  sync();
  cx.modal({ title: 'New account', body, actions: [
    { label: 'Cancel' },
    { label: 'Add account', primary: true, needs: needBooks, onClick: (close) => {
      if (!model.name.trim()) { err.textContent = 'Give the account a name.'; return; }
      const p = B.accounts.find((a) => nodeKey(a) === model.parent);
      const code = nextCode(model.parent);
      const a = { code, name: model.name.trim(), rootType: p.rootType, accountType: model.accountType, isGroup: !!model.isGroup, currency: model.currency, parent: p.code || p.name, role: null, createdBy: cx.meId(), createdAt: NOW() };
      B.accounts.push(a); reindexAccounts();
      const cmd = `capxul org books accounts add "${a.name}" --under ${p.code || JSON.stringify(p.name)}`;
      close(); cx.refresh();
      cx.toast(`Added ${code} · ${a.name} under ${nodeLabel(p)}`, { tone: 'success', cmd, action: { label: 'Open', onClick: () => cx.go('account', code) } });
    } },
  ] });
}
function openRename(a) {
  const model = { name: a.name };
  cx.modal({ title: `Rename ${a.code} · ${a.name}`, body: h('div', { style: 'display:grid;gap:10px' }, cx.field({ label: 'New name', key: 'name', model, edit: true, reqd: true }), h('p.ac-note', 'The number stays. Every entry keeps pointing at the same account.')),
    actions: [{ label: 'Cancel' }, { label: 'Rename', primary: true, needs: needBooks, cmd: `capxul org books accounts rename ${a.code} --name "…"`, onClick: (close) => {
      const name = String(model.name || '').trim(); if (!name) return;
      const cmd = `capxul org books accounts rename ${a.code} --name "${name}"`;
      a.name = name; close(); cx.refresh(); cx.toast(`Renamed to ${a.code} · ${name}`, { tone: 'success', cmd });
    } }] });
}
async function archiveAccount(a) {
  const bal = netOf(sumGl({ to: TODAY }), a.code);
  const cmd = `capxul org books accounts archive ${a.code}`;
  if (await cx.confirm({ title: `Archive ${a.code} · ${a.name}?`, body: near0(bal) ? 'Nothing new can post to it. Its history stays in every report.' : `It keeps its balance of ${drcr(bal)}. Nothing new can post to it; its history stays in every report.`, cmd, who: 'whoever wears the Books hat, or a Director', confirmLabel: 'Archive the account', danger: true })) {
    a.archived = true; cx.refresh(); cx.toast(`Archived ${a.code} · ${a.name}`, { cmd, action: { label: 'Undo', onClick: () => { a.archived = false; cx.refresh(); } } });
  }
}
const roleReason = (a) => (a.role ? `Capxul keeps ${a.code} · ${a.name}: it is a role account (${a.role}).` : null);
const ledgerState = (code, from = CUR_FY.start, to = TODAY) => ({ report: { account: code || '', from, to, party: '', voucher: '' } });
const reportsMenu = () => cx.menu('Reports', [
  { label: 'Trial balance', href: ['trial-balance'], icon: 'report' }, { label: 'General ledger', href: ['general-ledger'], icon: 'report' },
  { label: 'Balance sheet', href: ['balance-sheet'], icon: 'report' }, { label: 'Profit and loss', href: ['profit-and-loss'], icon: 'report' },
  { label: 'Cash flow', href: ['cash-flow'], icon: 'report' }, { divider: true },
  { label: 'Accounts receivable', href: ['accounts-receivable'], icon: 'report' }, { label: 'Accounts payable', href: ['accounts-payable'], icon: 'report' },
]);

cx.route('chart-of-accounts', () => {
  const bal = sumGl({ to: TODAY });
  const node = (a) => {
    const kids = kidsOf(a);
    const leaf = a.code && !kids.length && !a.isGroup;
    const codes = leaf ? [a.code] : leafCodes(a);
    const gbp = codes.reduce((s, c) => s + netOf(bal, c), 0);
    const usdc = leaf && isUsdcAcc(a.code) ? accNetOf(bal, a.code) : null;
    return { id: nodeKey(a), acc: a, label: nodeLabel(a), group: !leaf, badges: accBadges(a), value: usdc != null ? `${fmt.usdc(usdc)} / ${drcr(gbp)}` : drcr(gbp), children: kids.map(node) };
  };
  const total = { id: 'root', label: D.company.name, group: true, children: ROOTS().map(node) };
  const tree = cx.treeView({
    key: 'ac-coa', depth: 2, roots: [total],
    toolbar: (n) => {
      const a = n.acc; if (!a) return [cx.btn('Add account', { sm: true, icon: 'plus', needs: needBooks, onClick: () => openAddAccount(null) })];
      if (n.group) return [
        cx.btn('Add sub-account', { sm: true, icon: 'plus', needs: needBooks, disabled: !!a.role, reason: roleReason(a), cmd: `capxul org books accounts add "New account" --under ${a.code || JSON.stringify(a.name)}`, onClick: () => openAddAccount(a) }),
        a.code ? cx.btn('Open', { sm: true, href: ['account', a.code] }) : null,
      ].filter(Boolean);
      return [
        cx.btn('View ledger', { sm: true, icon: 'report', cmd: `capxul org report run general-ledger --filter account=${a.code} --filter from_date=${CUR_FY.start} --filter to_date=${TODAY}`, onClick: () => cx.go('general-ledger', null, ledgerState(a.code)) }),
        cx.btn('Open', { sm: true, href: ['account', a.code] }),
        cx.btn('Rename', { sm: true, needs: needBooks, cmd: `capxul org books accounts rename ${a.code} --name "…"`, onClick: () => openRename(a) }),
        cx.btn('Archive', { sm: true, needs: needBooks, disabled: !!a.role || a.archived, reason: roleReason(a) || 'Already archived', cmd: `capxul org books accounts archive ${a.code}`, onClick: () => archiveAccount(a) }),
      ];
    },
    tools: h('span.ac-mini', `Balances as at ${fmt.date(TODAY)} · ${fmt.int(B.accounts.filter((a) => a.code && !a.isGroup).length)} accounts`),
  });
  return cx.page({
    title: 'Chart of accounts', crumbs: crumbs(),
    cmd: { cli: 'capxul org books accounts list', sdk: 'client.org(orgId).books.accounts.list()', who: 'anyone with a seat', json: { accounts: B.accounts.filter((a) => a.code).length, roots: ROOTS().map((r) => r.name) } },
    actions: [reportsMenu(), cx.btn('Chart of cost centres', { href: ['cost-centres'], icon: 'tree' }), cx.btn('Add account', { kind: 'primary', icon: 'plus', needs: needBooks, cmd: 'capxul org books accounts add "<name>" --under <parent>', onClick: () => openAddAccount(null) })],
    body: [tree, h('p.ac-note', 'Numbers follow the type: 1 assets, 2 liabilities, 3 equity, 4 income, 5 and 6 expenses. A Safe’s account holds USDC on Base; only the chain posts to it. Role accounts are Capxul’s own and cannot be archived or take sub-accounts. Click an account for its tools.')],
  });
}, { workspace: 'books', title: 'Chart of accounts' });

cx.route('account', (ctx) => {
  const a = cx.find(B.accounts.filter((x) => x.code), 'code', ctx.id);
  if (!a) return cx.page({ title: 'Not found', crumbs: crumbs({ label: 'Chart of accounts', route: 'chart-of-accounts' }), body: cx.empty('No such account') });
  const bal = sumGl({ to: TODAY });
  const kids = kidsOf(a);
  const codes = kids.length ? leafCodes(a) : [a.code];
  const gbp = codes.reduce((s, c) => s + netOf(bal, c), 0);
  const usdc = isUsdcAcc(a.code) ? accNetOf(bal, a.code) : null;
  const fyLines = GL.filter((r) => codes.includes(r.account) && r.date >= CUR_FY.start && !r.closing);
  const latest = GL.filter((r) => codes.includes(r.account) && !r.closing).slice(-12).reverse();
  const parent = B.accounts.find((x) => x.code === a.parent || x.name === a.parent || (!a.parent && x.name === a.group));
  const safe = a.code === '1010' ? M.safes.treasury : a.code === '1020' ? M.safes.reserve : null;
  const form = cx.formView({
    doc: a, tabKey: 'ac-account',
    tabs: [{ label: 'Details', sections: [
      { columns: [[
        { label: 'Archived', key: 'archived', type: 'check' },
        { label: 'Account name', key: 'name', reqd: true },
        { label: 'Account number', key: 'code', type: 'mono' },
        { label: 'Is group', value: kids.length ? 1 : 0, type: 'check' },
        { label: 'Root type', key: 'rootType' },
        { label: 'Report type', value: ['Income', 'Expense'].includes(a.rootType) ? 'Profit and loss' : 'Balance sheet' },
      ], [
        { label: 'Parent account', value: parent ? nodeLabel(parent) : '—', type: 'link', href: parent?.code ? ['account', parent.code] : ['chart-of-accounts'] },
        { label: 'Account type', value: a.accountType || '—' },
        { label: 'Currency', key: 'currency' },
        { label: 'Balance must be', value: a.role === 'safe' || a.accountType === 'Bank' ? 'Debit' : a.accountType === 'Payable' ? 'Credit' : '—' },
        { label: 'Frozen', value: SAFE_CODES.has(a.code) ? 'Yes: only the chain posts' : 'No' },
      ]] },
      a.role ? { label: 'Capxul', columns: [[
        { label: 'Role', value: a.role, type: 'mono', help: 'Capxul posts to this account itself; it cannot be archived or take sub-accounts.' },
      ], [
        safe ? { label: 'Safe', render: () => h('span', `${safe.label}, `, cx.addr(safe.address), ' on Base') } : a.code === '1050' ? { label: 'Bank account', render: () => cx.link('Barclays Business · GBP', 'bank-account', 'Barclays Business · GBP') } : { label: 'Statement', value: a.role === 'escrow' ? 'The escrows Harbourline funded, from the chain' : a.role === 'bridge' ? 'Bridge payouts on their way' : '—' },
        safe ? { label: 'Statement', value: 'The chain: every line is booked as it arrives' } : null,
      ].filter(Boolean)] } : null,
      { label: 'Balance', cols: 3, fields: [
        { label: `Balance on ${fmt.date(TODAY)}`, value: drcr(gbp) },
        usdc != null ? { label: 'Holds', value: fmt.usdc(usdc, 6) } : { label: 'Lines this fiscal year', value: fmt.int(fyLines.length) },
        { label: `Movement in ${CUR_FY.name}`, value: `${fmt.gbp(sum(fyLines, 'debit'))} Dr · ${fmt.gbp(sum(fyLines, 'credit'))} Cr` },
      ] },
      { label: 'Latest entries', actions: cx.btn('View ledger', { sm: true, onClick: () => cx.go('general-ledger', null, ledgerState(a.code)) }), table: cx.grid({ columns: [
        { key: 'date', label: 'Posting date', type: 'date' },
        { key: 'voucher', label: 'Voucher', render: (r) => vLink(r.voucher, r.type) },
        { key: 'party', label: 'Party', opt: true, render: (r) => r.party ? partyName(r.partyType, r.party) : h('span.faint', '—') },
        { key: 'debit', label: 'Debit', type: 'currency', currency: 'GBP' },
        { key: 'credit', label: 'Credit', type: 'currency', currency: 'GBP' },
      ], rows: latest, empty: 'No entries yet' }) },
    ].filter(Boolean) }],
    side: { id: a.code, title: a.name, cmd: 'capxul org books accounts list', tags: [a.rootType], created: { by: a.createdBy || '@harbourline-fde', at: a.createdAt || '2025-05-01T10:20:00Z' }, modified: { by: a.createdBy || 'kwame', at: a.createdAt || '2025-06-02T09:00:00Z' } },
  });
  return cx.page({
    title: `${a.code} · ${a.name}`, crumbs: crumbs({ label: 'Chart of accounts', route: 'chart-of-accounts' }),
    status: [a.archived ? 'Disabled' : 'Enabled', ...accBadges(a)],
    cmd: { cli: 'capxul org books accounts list', sdk: 'client.org(orgId).books.accounts.list()', json: { code: a.code, name: a.name, rootType: a.rootType, parent: a.parent, currency: a.currency, role: a.role || null, balance: r2(gbp), ...(usdc != null ? { holds: r6(usdc) } : {}) } },
    actions: [
      cx.btn('View ledger', { icon: 'report', cmd: `capxul org report run general-ledger --filter account=${a.code}`, onClick: () => cx.go('general-ledger', null, ledgerState(a.code)) }),
      cx.btn('Rename', { needs: needBooks, cmd: `capxul org books accounts rename ${a.code} --name "…"`, onClick: () => openRename(a) }),
      cx.btn('Archive', { needs: needBooks, disabled: !!a.role || !!a.archived, reason: roleReason(a) || 'Already archived', cmd: `capxul org books accounts archive ${a.code}`, onClick: () => archiveAccount(a) }),
    ],
    body: form,
  });
}, { workspace: 'books', title: 'Account' });

/* =====================================================================================================
   Shared document machinery: words, references, list commands, payment terms
   ===================================================================================================== */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function words3(n) {
  const hu = Math.floor(n / 100), rest = n % 100;
  const r = rest < 20 ? ONES[rest] : TENS[Math.floor(rest / 10)] + (rest % 10 ? '-' + ONES[rest % 10] : '');
  return [hu ? ONES[hu] + ' Hundred' : '', r].filter(Boolean).join(' And ');
}
function intWords(n) {
  if (!n) return 'Zero';
  const parts = [];
  for (const [v, w] of [[1e6, 'Million'], [1e3, 'Thousand'], [1, '']]) { const q = Math.floor(n / v) % 1000; if (q) parts.push(words3(q) + (w ? ' ' + w : '')); }
  return parts.join(', ');
}
function inWords(amount, cur) {
  const a = Math.abs(amount); const whole = Math.floor(a + 1e-9); const minor = Math.round((a - whole) * 100);
  const unit = { GBP: ['Pound', 'Pounds', 'Pence'], USD: ['Dollar', 'Dollars', 'Cents'], EUR: ['Euro', 'Euros', 'Cents'] }[cur] || ['', cur, ''];
  return `${intWords(whole)} ${whole === 1 ? unit[0] : unit[1]}${minor ? ` and ${intWords(minor)} ${unit[2]}` : ''} only.`;
}
function rfRef(name) {
  const m = /(\d{4})-(\d{5})$/.exec(name); if (!m) return null;
  const ref = 'HL' + m[1].slice(2) + m[2].slice(1);
  const s = (ref + 'RF00').split('').map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join('');
  let mod = 0; for (const ch of s) mod = (mod * 10 + +ch) % 97;
  return ('RF' + String(98 - mod).padStart(2, '0') + ref).replace(/(.{4})/g, '$1 ').trim();
}
const snake = (k) => String(k).replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const qv = (v) => (/[\s>|<]/.test(String(v)) ? JSON.stringify(String(v)) : String(v));
/** A list's command: the record, the saved tab's filter and the standard filters as flags. */
function lvCmd(record, tabs, specs, extra = {}) {
  return (st) => {
    const parts = [`capxul org doc list ${record}`];
    const t = tabs?.[st.tab];
    if (t?.flag) parts.push(t.flag);
    for (const f of specs) {
      const v = st.filters[f.key];
      if (v === '' || v == null || v === false) continue;
      const field = f.field || snake(f.key);
      parts.push(f.type === 'month' ? `--filter "${field} like ${v}-%"` : f.like ? `--filter "${field} like %${v}%"` : `--filter ${qv(`${field}=${v}`)}`);
    }
    for (const c of st.conds) parts.push(`--filter ${JSON.stringify(`${snake(c.field)}${c.op === 'like' ? ' like ' : c.op === 'set' ? ' is set' : c.op === 'notset' ? ' is not set' : c.op}${['set', 'notset'].includes(c.op) ? '' : c.value}`)}`);
    return { cli: parts.join(' '), sdk: `client.org(orgId).docs.list("${record}", { … })`, kind: 'family', ...extra };
  };
}
function scheduleOf(inv) {
  const paid = sum(inv.payments || [], 'amount');
  return [{ term: inv.paymentTerms || 'Net 30', description: `${inv.paymentTerms || 'Net 30'}: the whole amount`, dueDate: inv.dueDate, portion: 100, amount: inv.grandTotal, outstanding: inv.outstanding, paid: r2(Math.min(paid, inv.grandTotal)), currency: inv.currency }];
}
const termsText = (inv) => `Payment is due ${inv.paymentTerms === 'Due on receipt' ? 'on receipt' : `within ${String(inv.paymentTerms || 'Net 30').replace(/\D/g, '') || 30} days of the invoice date`}. Please quote the payment reference ${inv.rfReference || ''} with any bank transfer. Harbourline Studio Ltd, company number ${D.company.companyNumber}, VAT ${D.company.vatNumber}.`;
function timelineFor(inv, kind) {
  const items = [];
  const by = inv.createdBy || 'kwame';
  const at0 = inv.createdAt || (inv.requestSent ? new Date(Date.parse(inv.requestSent) - 4 * 60000).toISOString() : inv.postingDate + 'T09:30:00Z');
  items.push({ at: at0, who: by, kind: 'created', text: 'created this' });
  if (inv.docstatus !== 0) items.push({ at: inv.submittedAt || new Date(Date.parse(at0) + 60000).toISOString(), who: inv.submittedBy || by, kind: 'submitted', text: kind === 'si' ? 'posted this invoice' : 'posted this bill' });
  if (inv.requestSent) items.push({ at: inv.requestSent, who: by, kind: 'email', text: `sent a payment request to ${customerEmail(inv)}`, sub: `${inv.name} · ${fmt.money(inv.grandTotal, inv.currency)}`, body: `The pay link (USDC to Harbourline’s Treasury) and the bank details, quoting ${inv.rfReference}.` });
  for (const p of inv.payments || []) items.push({ at: p.at || p.date + 'T15:10:00Z', kind: 'money', text: `${kind === 'si' ? 'Received' : 'Paid'} ${fmt.money(p.amount, inv.currency)} by ${viaOf(p.channel)}${p.voucher ? ' · ' + p.voucher : ''}`, href: p.voucher ? vHref(p.voucher) : null });
  if (inv.docstatus !== 0 && inv.dueDate < TODAY && (inv.outstanding > 0.005 || (inv.payments || []).some((p) => p.date > inv.dueDate))) items.push({ at: addDays(inv.dueDate, 1) + 'T00:10:00Z', kind: 'status', text: 'Status changed from Unpaid to Overdue' });
  if (near0(inv.outstanding) && inv.payments?.length) items.push({ at: (inv.payments[inv.payments.length - 1].at || inv.payments[inv.payments.length - 1].date + 'T15:10:00Z').replace(/:10:00Z$/, ':10:01Z'), kind: 'status', text: `Status changed to ${inv.creditNote ? 'Credit Note Issued' : 'Paid'}` });
  if (inv.docstatus === 2) items.push({ at: inv.cancelledAt, who: inv.cancelledBy, kind: 'cancelled', text: 'cancelled this' });
  return [...items, ...(inv.timelineExtra || [])];
}
/** In an editable form, every field without a key is shown, not edited. */
function lockValues(tabs) {
  const fix = (f) => { if (f && !(f instanceof Node) && !f.key) f.readOnly = true; return f; };
  for (const t of tabs) for (const s of t.sections || []) { if (!s || s instanceof Node) continue; (s.fields || []).forEach(fix); (s.columns || []).forEach((col) => col.forEach(fix)); }
  return tabs;
}
function sideFor(inv, record, title) {
  return { id: inv.name, title, cmd: `capxul org doc get ${record} ${inv.name}`, assigned: [inv.createdBy || 'kwame'], attachments: inv.attachments || (record === 'purchase-invoice' && inv.billNo ? [`${inv.billNo}.pdf`] : []), tags: [inv.kind || (inv.isOpening ? 'opening' : null)].filter(Boolean),
    created: { by: inv.createdBy || 'kwame', at: inv.createdAt || inv.postingDate + 'T09:30:00Z' }, modified: { by: inv.modifiedBy || inv.createdBy || 'kwame', at: inv.modifiedAt || inv.payments?.[inv.payments.length - 1]?.date || inv.postingDate } };
}

/* =====================================================================================================
   Sales invoices
   ===================================================================================================== */

const SI_TABS = [
  { label: 'Drafts', filter: (r) => r.docstatus === 0, flag: '--filter docstatus=0' },
  { label: 'Unpaid', filter: (r) => r.docstatus !== 0 && r.docstatus !== 2 && r.outstanding > 0.005, flag: '--filter "outstanding_amount>0"' },
  { label: 'Overdue', filter: (r) => invStatus(r) === 'Overdue', flag: '--filter status=Overdue' },
  { label: 'Credit notes', filter: (r) => !!r.isReturn, flag: '--filter is_return=1' },
  { label: 'This month', filter: (r) => r.docstatus !== 0 && r.postingDate >= TODAY.slice(0, 7) + '-01', flag: `--filter "posting_date>=${TODAY.slice(0, 7)}-01"` },
  { label: 'All' },
];
const SI_STATUSES = ['Draft', 'Unpaid', 'Partly Paid', 'Overdue', 'Paid', 'Return', 'Credit Note Issued', 'Cancelled'];

cx.route('sales-invoices', () => {
  const filters = [
    { key: 'name', label: 'ID' },
    { key: 'customerName', label: 'Customer', type: 'select', field: 'customer' },
    { key: 'status', label: 'Status', type: 'select', options: SI_STATUSES, get: (r) => invStatus(r) },
    { key: 'postingDate', label: 'Posting month', type: 'month', field: 'posting_date' },
    { key: 'project', label: 'Project', type: 'select', options: () => [...new Set(B.salesInvoices.map((i) => i.project).filter(Boolean))].sort().map((p) => [p, `${p} · ${projectName(p)}`]) },
    { key: 'costCenter', label: 'Cost centre', type: 'select', field: 'cost_center' },
  ];
  const list = cx.listView({
    key: 'ac-sinv', rows: () => B.salesInvoices, noun: 'sales invoice', id: (r) => r.name,
    initial: listInit('ac-sinv'),
    titleCol: { key: 'customerName', label: 'Customer', sub: (r) => r.items?.[0]?.description },
    status: (r) => pills(invStatus(r), siFlight(r)),
    columns: [
      { key: 'postingDate', label: 'Posting date', type: 'date' },
      { key: 'dueDate', label: 'Due date', type: 'date' },
      { label: 'Paid by', render: (r) => { const k = paidByOfInv(r); return k ? h('span.ac-vias', k.map((x) => viaTag(x))) : h('span.faint', '—'); } },
      { key: 'outstanding', label: 'Outstanding', type: 'currency', keep: true },
    ],
    right: { key: 'grandTotal', label: 'Grand total', type: 'currency' },
    modified: (r) => r.modifiedAt || r.payments?.[r.payments.length - 1]?.date || r.requestSent || r.postingDate,
    filters,
    tabs: SI_TABS,
    sort: { options: [{ key: 'postingDate', label: 'Posting date' }, { key: 'dueDate', label: 'Due date' }, { key: 'grandTotal', label: 'Grand total', get: (r) => r.baseGrandTotal ?? r.grandTotal }, { key: 'outstanding', label: 'Outstanding' }, { key: 'customerName', label: 'Customer' }], default: { key: 'postingDate', dir: 'desc' } },
    groupBy: [{ key: 'customerName', label: 'Customer' }, { key: 'status', label: 'Status', get: (r) => invStatus(r) }, { key: 'createdBy', label: 'Created by', type: 'person' }, { key: 'costCenter', label: 'Cost centre' }],
    href: (r) => ['sales-invoice', r.name],
    bulk: [
      { label: 'Request payment', icon: 'send', needs: needInvoicing, cmd: 'capxul request issue <email> <amount> --reference <RF>', onClick: (rows) => {
        const open = rows.filter((r) => r.docstatus === 1 || (r.docstatus == null && r.outstanding > 0.005)).filter((r) => r.outstanding > 0.005);
        if (!open.length) { cx.toast('None of these invoices has anything outstanding.', { tone: 'warning' }); return; }
        for (const r of open) markRequested(r);
        cx.toast(`Sent ${fmt.plural(open.length, 'payment request')}`, { tone: 'success', cmd: open.map((r) => requestCmd(r)).join('\n') });
        list.refresh();
      } },
      { label: 'Record payment', icon: 'bank', needs: { any: ['Books', 'Invoicing', 'Director'] }, cmd: 'capxul org doc create payment-entry --from sales-invoice <name>', onClick: (rows) => { if (rows.length !== 1) { cx.toast('Record one payment at a time: tick a single invoice.', { tone: 'warning' }); return; } recordSiPayment(rows[0]); } },
      { label: 'Export', icon: 'file', cmd: 'capxul org doc list sales-invoice --json', onClick: (rows) => noDownload(`capxul org doc list sales-invoice --filter "name in (${rows.map((r) => r.name).join(',')})" --json`) },
    ],
    cmd: lvCmd('sales-invoice', SI_TABS, filters),
    views: [{ label: 'List', route: 'sales-invoices', active: true, icon: 'list' }, { label: 'Report', route: 'accounts-receivable', icon: 'report' }],
  });
  return cx.page({
    title: 'Sales invoices', crumbs: crumbs(),
    actions: [cx.menu(null, [{ label: 'Accounts receivable', href: ['accounts-receivable'], icon: 'report' }, { label: 'Requests sent', icon: 'send', cmd: 'capxul request list', onClick: () => cx.toast('Capxul’s own list of the payment requests it has sent.', { cmd: 'capxul request list' }) }, { label: 'Export', icon: 'file', cmd: 'capxul org doc list sales-invoice --json', onClick: () => noDownload('capxul org doc list sales-invoice --json') }]),
      cx.btn('New sales invoice', { kind: 'primary', icon: 'plus', needs: needInvoicing, cmd: 'capxul org doc create sales-invoice --input invoice.json', onClick: () => newSalesInvoice() })],
    body: list,
  });
}, { workspace: 'books', title: 'Sales invoices' });

/* ---- a sales invoice's arithmetic and ledger ---- */

const ITEM_ACC = { 'Engineering services': '4000', 'Design services': '4100', Retainer: '4200', 'Retainer services': '4200' };
function siRecompute(inv) {
  for (const it of inv.items) { it.amount = r2((+it.qty || 0) * (+it.rate || 0)); it.incomeAccount = it.incomeAccount || ITEM_ACC[it.item] || '4000'; }
  inv.totalQty = r2(sum(inv.items, 'qty'));
  inv.netTotal = r2(sum(inv.items, 'amount'));
  const vat = inv.currency === 'GBP';
  inv.taxes = vat ? [{ type: 'On Net Total', account: '2101', rate: 20, taxAmount: r2(inv.netTotal * 0.2), total: r2(inv.netTotal * 1.2), description: 'VAT 20%' }] : [];
  inv.taxNote = vat ? null : 'Outside the scope of UK VAT (services to a business outside the UK)';
  inv.totalTaxes = r2(sum(inv.taxes, 'taxAmount'));
  inv.grandTotal = r2(inv.netTotal + inv.totalTaxes);
  const cr = inv.conversionRate || 1;
  inv.baseNetTotal = r2(inv.netTotal * cr); inv.baseTotalTaxes = r2(inv.totalTaxes * cr); inv.baseGrandTotal = r2(inv.grandTotal * cr);
  inv.inWords = inWords(inv.grandTotal, inv.currency);
  if (inv.docstatus === 0) inv.outstanding = inv.grandTotal;
}
function siGlLines(inv) {
  const cr = inv.conversionRate || 1;
  const sign = inv.isReturn ? -1 : 1;
  const lines = [];
  const dr = (account, amt, o = {}) => lines.push({ account, debit: amt > 0 ? amt : 0, credit: amt < 0 ? -amt : 0, ...o });
  dr('1200', r2(sign * Math.abs(inv.grandTotal) * cr), { party: inv.customer, partyType: 'Customer', againstType: 'Sales Invoice', against: inv.returnAgainst || inv.name });
  for (const it of inv.items) dr(it.incomeAccount || ITEM_ACC[it.item] || '4000', -r2(sign * Math.abs(it.amount) * cr), { costCenter: it.costCenter || inv.costCenter, project: it.project || inv.project });
  for (const t of inv.taxes || []) dr(t.account, -r2(sign * Math.abs(t.taxAmount) * cr));
  const diff = r2(sum(lines, 'debit') - sum(lines, 'credit'));
  if (!near0(diff)) dr('6510', -diff, { costCenter: 'Main' });
  return lines;
}
function ledgerPreview(title, lines) {
  cx.modal({ title: `Ledger preview: ${title}`, wide: true, body: h('div', { style: 'display:grid;gap:10px' },
    h('p.ac-note', 'What posting writes to the ledger. Nothing is written until you post.'),
    cx.grid({ columns: [
      { key: 'account', label: 'Account', render: (r) => accLabel(r.account) },
      { key: 'party', label: 'Party', render: (r) => (r.party ? partyName(r.partyType, r.party) : h('span.faint', '—')) },
      { key: 'costCenter', label: 'Cost centre', opt: true },
      { key: 'debit', label: 'Debit', type: 'currency', currency: 'GBP' },
      { key: 'credit', label: 'Credit', type: 'currency', currency: 'GBP' },
    ], rows: lines, totals: ['debit', 'credit'] })), actions: [{ label: 'Close', primary: true }] });
}

/* ---- new, save, post ---- */

let draftSeq = 0;
function customerDefaults(inv, id) {
  const c = CUST.get(id);
  inv.customer = id; inv.customerName = c?.name || id; inv.currency = c?.currency || 'GBP';
  inv.conversionRate = inv.currency === 'GBP' ? 1 : r6(cx.rate(inv.postingDate));
  const proj = (D.projects?.projects || []).find((p) => p.customer === id && p.status === 'Open');
  inv.project = proj?.name || null;
  inv.costCenter = proj ? ({ 'PROJ-0011': 'Delivery', 'PROJ-0012': 'Design', 'PROJ-0010': 'Engineering', 'PROJ-0009': 'Engineering' }[proj.name] || 'Delivery') : (inv.costCenter || 'Delivery');
  inv.paymentTerms = `Net ${c?.terms || 30}`;
  inv.dueDate = addDays(inv.postingDate, c?.terms || 30);
}
function newSalesInvoice(from) {
  const inv = from || { items: [], timesheets: [], payments: [], taxes: [] };
  Object.assign(inv, { name: `new-sales-invoice-${++draftSeq}`, docstatus: 0, __new: true, postingDate: TODAY, createdBy: cx.meId(), createdAt: NOW(), kind: inv.kind || 'timesheets', remarks: inv.remarks ?? null, requestSent: null });
  if (!from) customerDefaults(inv, 'larkspur');
  siRecompute(inv);
  B.salesInvoices.push(inv);
  cx.go('sales-invoice', inv.name);
}
function saveSalesInvoice(inv) {
  if (!inv.customer) { cx.toast('Choose a customer first.', { tone: 'warning' }); return; }
  const old = inv.name;
  inv.name = inv.amendedFrom ? `${inv.amendedFrom}-1` : nextName(inv.isReturn ? `ACC-SINV-RET-${YEAR}-` : `ACC-SINV-${YEAR}-`);
  delete inv.__new;
  inv.modifiedAt = NOW(); inv.modifiedBy = cx.meId();
  cx.toast(`Saved ${inv.name} as a draft`, { tone: 'success', cmd: `capxul org doc create sales-invoice --input ${old}.json` });
  cx.go('sales-invoice', inv.name);
}
async function postSalesInvoice(inv) {
  siRecompute(inv);
  if (!inv.items.length || near0(inv.grandTotal)) { cx.toast('Add at least one item before posting.', { tone: 'warning' }); return; }
  const cmd = `capxul org doc submit sales-invoice ${inv.name}`;
  if (!(await cx.confirm({ title: `Post ${inv.name}?`, body: `${inv.customerName} · ${fmt.money(inv.grandTotal, inv.currency)}. Posting makes it final: it goes to the ledger and can then only be cancelled or credited.`, cmd, who: 'whoever wears the Invoicing hat', confirmLabel: 'Post' }))) return;
  await commitSalesInvoice(inv);
  cx.refresh();
  cx.toast(`Posted ${inv.name}: ${fmt.money(inv.grandTotal, inv.currency)} to ${inv.customerName}`, { tone: 'success', cmd, action: inv.isReturn ? null : { label: 'Request payment', onClick: () => requestPayment(inv) } });
}
/** The posting itself, with no questions: the ledger lines, the RF reference, the content hash, the billed hours. */
async function commitSalesInvoice(inv) {
  siRecompute(inv);
  inv.docstatus = 1; inv.submittedAt = NOW(); inv.submittedBy = cx.meId();
  inv.rfReference = inv.rfReference || rfRef(inv.name);
  inv.outstanding = inv.isReturn ? 0 : inv.grandTotal;
  inv.paidAmount = 0; inv.voucher = inv.name; inv.debitTo = '1200';
  inv.contentHash = await cx.hashOf({ record: 'Sales Invoice', name: inv.name, customer: inv.customer, currency: inv.currency, items: inv.items.map((i) => ({ idx: i.idx, description: i.description, qty: i.qty, rate: i.rate, amount: i.amount })), taxes: inv.taxes, grandTotal: inv.grandTotal });
  postVoucher({ name: inv.name, type: 'Sales Invoice', entryType: null, paymentType: null, date: inv.postingDate, title: inv.customerName, total: inv.baseGrandTotal, party: inv.customer, partyType: 'Customer', payment: null, closing: false }, siGlLines(inv));
  if (inv.isReturn && inv.returnAgainst) {
    const orig = B.salesInvoices.find((x) => x.name === inv.returnAgainst);
    if (orig) { const take = Math.min(orig.outstanding, Math.abs(inv.grandTotal)); orig.outstanding = r2(orig.outstanding - take); if (near0(orig.outstanding)) orig.creditNote = true; (orig.timelineExtra ||= []).push({ at: NOW(), who: cx.meId(), kind: 'link', text: `credited by ${inv.name} for ${fmt.money(Math.abs(inv.grandTotal), inv.currency)}`, href: ['sales-invoice', inv.name] }); }
  }
  const logs = cx.rows('projects.logs');
  for (const ts of inv.timesheets || []) for (const l of logs) if (l.timesheet === ts.timesheet && !l.invoice && l.project === inv.project) l.invoice = inv.name;
  return inv;
}
// Other modules post through this hook: Projects' "Create invoice" (capxul org projects timesheet bill) makes and posts
// the invoice in one write.
/** A customer's bank transfer that Bridge turned into USDC in the Treasury: the payment entry against the invoice its
 *  reference names (1010 at the USDC's pounds, the conversion fees to 6500, the receivable cleared). */
function bookBridgeDeposit(dep, p, inv) {
  if (!inv) return null;
  const name = nextName(`ACC-PAY-${YEAR}-`);
  const day = String(dep.creditedAt || NOW()).slice(0, 10);
  const cr = inv.conversionRate || 1;
  const got = r2(dep.net * p.rate);
  const fee = r2(dep.bankAmount - got);
  postVoucher({ name, type: 'Payment Entry', entryType: null, paymentType: 'Receive', date: day, title: `Bridge deposit from ${dep.from}`, total: dep.bankAmount, party: inv.customer, partyType: 'Customer', payment: p.id, closing: false, reference: dep.reference, refDate: day, createdBy: null, createdAt: NOW() },
    [{ account: '1010', debit: got, accDebit: dep.net }, { account: '6500', debit: fee, costCenter: 'Main' }, { account: '1200', credit: dep.bankAmount, party: inv.customer, partyType: 'Customer', againstType: 'Sales Invoice', against: inv.name }]);
  const invAmt = r2(Math.min(inv.outstanding, dep.bankAmount / cr));
  inv.payments = [...(inv.payments || []), { date: day, amount: invAmt, payment: p.id, voucher: name, channel: 'Bridge', at: NOW() }];
  inv.outstanding = r2(inv.outstanding - invAmt); inv.paidAmount = r2((inv.paidAmount || 0) + invAmt); inv.modifiedAt = NOW();
  (inv.timelineExtra ||= []).push({ at: NOW(), kind: 'money', text: `${fmt.money(dep.bankAmount, dep.currency)} arrived through Bridge as ${fmt.usdc(dep.net)}, matched by reference ${dep.reference} and booked as ${name}`, href: ['payment-entry', name] });
  return name;
}
cx.native = Object.assign(cx.native || {}, { postSalesInvoice: commitSalesInvoice, bookBridgeDeposit });

/* ---- request payment, record payment, credit note, reminder, cancel, amend ---- */

function requestCmd(inv) { return `capxul request issue ${customerEmail(inv)} ${r2(inv.outstanding)} --asset ${inv.currency === 'GBP' ? 'GBP' : 'USDC'} --reference "${inv.rfReference}"`; }
function markRequested(inv) {
  inv.requestSent = inv.requestSent || NOW();
  (inv.timelineExtra ||= []).push({ at: NOW(), who: cx.meId(), kind: 'email', text: `sent a payment request to ${customerEmail(inv)}`, sub: `${inv.name} · ${fmt.money(inv.outstanding, inv.currency)}`, body: `The pay link and the bank details, quoting ${inv.rfReference}.` });
}
function bankDetailsFor(cur) { return M.bankDetails.find((b) => b.currency === (cur === 'USD' ? 'USD' : cur === 'EUR' ? 'EUR' : 'GBP')) || M.bankDetails[0]; }
function howToPay(inv) {
  const bd = bankDetailsFor(inv.currency);
  return h('div.ac-howto',
    h('div', h('h4', 'Payment reference'), h('span.mono', inv.rfReference || 'Given when the invoice is posted'), h('span.ac-mini', 'An ISO 11649 creditor reference. Capxul matches a payment that quotes it to this invoice.')),
    h('div', h('h4', 'Pay in USDC'), h('span', `To Harbourline’s Treasury Safe, ${D.company.handle}`), cx.addr(D.company.treasury), h('span.ac-mini', 'The pay link in the request does this in one step, with the document hash on chain.')),
    h('div', h('h4', `Pay by bank transfer (${bd.currency})`), h('span', `${bd.payee}, ${bd.bank}`), h('span.mono', bd.account), h('span.ac-mini', `${bd.rails.join(', ')} · quote ${inv.rfReference || 'the reference'} · becomes ${bd.becomes}`)));
}
function requestPayment(inv) {
  const model = { to: customerEmail(inv), amount: inv.outstanding, note: '' };
  const body = h('div', { style: 'display:grid;gap:12px' },
    h('div.ac-form-grid',
      cx.field({ label: 'To', key: 'to', model, edit: true, reqd: true }),
      cx.field({ label: `Amount (${inv.currency})`, key: 'amount', model, edit: true, type: 'currency', reqd: true }),
      cx.field({ label: 'Reference', value: `${inv.rfReference} · ${inv.name}`, type: 'mono' }),
      cx.field({ label: 'Due', value: fmt.date(inv.dueDate) }),
      cx.field({ label: 'Message', key: 'note', model, edit: true, type: 'textarea', placeholder: `Hi, here is ${inv.name} for ${fmt.money(inv.grandTotal, inv.currency)}.`, wide: true })),
    h('div', { style: 'display:grid;gap:6px' }, h('b', { style: 'font-size:13px' }, 'They can pay either way'), howToPay(inv)),
    h('p.ac-note', 'A customer on Capxul gets it in their inbox and pays it from their Safe; anyone else gets an email with the link and the bank details.'));
  cx.modal({ title: `Request payment: ${inv.name}`, wide: true, body, actions: [
    { label: 'Cancel' },
    { label: 'Send request', primary: true, needs: needInvoicing, cmd: requestCmd(inv), onClick: (close) => {
      if (!String(model.to).includes('@') || !(+model.amount > 0)) { cx.toast('Give an email and an amount.', { tone: 'warning' }); return; }
      const cmd = `capxul request issue ${model.to} ${r2(model.amount)} --asset ${inv.currency === 'GBP' ? 'GBP' : 'USDC'} --reference "${inv.rfReference}"`;
      markRequested(inv); close(); cx.refresh();
      cx.toast(`Request sent to ${model.to}`, { tone: 'success', cmd });
    } },
  ] });
}
function recordSiPayment(inv) {
  if (!(inv.outstanding > 0.005)) { cx.toast(`${inv.name} has nothing outstanding.`, { tone: 'warning' }); return; }
  const cr = inv.conversionRate || 1;
  const model = { date: TODAY, amount: r2(inv.outstanding * cr), reference: '', refDate: TODAY };
  const body = h('div', { style: 'display:grid;gap:12px' },
    cx.banner('For money that reached the Barclays account outside Capxul. A payment through Capxul or Bridge is booked from the chain by itself.', { tone: 'info' }),
    h('div.ac-form-grid',
      cx.field({ label: 'Payment type', value: 'Receive' }),
      cx.field({ label: 'Posting date', key: 'date', model, edit: true, type: 'date', reqd: true }),
      cx.field({ label: 'Party', value: `Customer · ${inv.customerName}` }),
      cx.field({ label: 'Mode of payment', value: 'Bank transfer' }),
      cx.field({ label: 'Account paid from', value: accLabel('1200') }),
      cx.field({ label: 'Account paid to', value: accLabel('1050') }),
      cx.field({ label: 'Paid amount (GBP)', key: 'amount', model, edit: true, type: 'currency', reqd: true }),
      cx.field({ label: 'Allocated to', value: `${inv.name} · outstanding ${fmt.money(inv.outstanding, inv.currency)}` }),
      cx.field({ label: 'Payment reference', key: 'reference', model, edit: true, placeholder: `BACS ${inv.customerName.toUpperCase().slice(0, 14)}` }),
      cx.field({ label: 'Reference date', key: 'refDate', model, edit: true, type: 'date' })));
  cx.modal({ title: `Record payment: ${inv.name}`, wide: true, body, actions: [
    { label: 'Cancel' },
    { label: 'Post the payment entry', primary: true, needs: { any: ['Books', 'Invoicing', 'Director'] }, cmd: [`capxul org doc create payment-entry --from sales-invoice ${inv.name}`, 'capxul org doc submit payment-entry <name>'], onClick: (close) => {
      const gbp = r2(+model.amount); if (!(gbp > 0)) return;
      const name = nextName(`ACC-PAY-${YEAR}-`);
      const invAmt = r2(Math.min(inv.outstanding, gbp / cr));
      postVoucher({ name, type: 'Payment Entry', entryType: null, paymentType: 'Receive', date: model.date, title: inv.customerName, total: gbp, party: inv.customer, partyType: 'Customer', payment: null, closing: false, reference: model.reference || null, refDate: model.refDate, createdBy: cx.meId(), createdAt: NOW() },
        [{ account: '1050', debit: gbp }, { account: '1200', credit: gbp, party: inv.customer, partyType: 'Customer', againstType: 'Sales Invoice', against: inv.name }]);
      inv.payments = [...(inv.payments || []), { date: model.date, amount: invAmt, payment: null, voucher: name, channel: 'Barclays', at: NOW() }];
      inv.outstanding = r2(inv.outstanding - invAmt); inv.paidAmount = r2((inv.paidAmount || 0) + invAmt); inv.modifiedAt = NOW(); inv.modifiedBy = cx.meId();
      close(); cx.refresh();
      cx.toast(`Recorded ${fmt.gbp(gbp)} into Barclays as ${name}`, { tone: 'success', cmd: `capxul org doc submit payment-entry ${name}`, action: { label: 'Open', onClick: () => cx.go('payment-entry', name) } });
    } },
  ] });
}
function creditNote(inv) {
  const ret = {
    customer: inv.customer, customerName: inv.customerName, currency: inv.currency, conversionRate: inv.conversionRate, project: inv.project, costCenter: inv.costCenter,
    isReturn: true, returnAgainst: inv.name, kind: 'credit note', paymentTerms: inv.paymentTerms, dueDate: TODAY, timesheets: [], payments: [],
    items: inv.items.map((it, i) => ({ idx: i + 1, item: it.item, description: `Credit: ${it.description}`, qty: -Math.abs(it.qty), rate: it.rate, uom: it.uom, incomeAccount: it.incomeAccount, costCenter: it.costCenter, project: it.project })),
    remarks: `Credit note against ${inv.name}`,
  };
  newSalesInvoice(ret);
  cx.toast('A credit note is drafted with every line. Change the quantities to credit part of it.', { cmd: `capxul org doc create sales-invoice --from sales-invoice ${inv.name} --input return.json` });
}
function dunning(inv) {
  const c = customerContact(inv.customer);
  const days = daysBetween(inv.dueDate, TODAY);
  const text = `Dear ${c?.firstName || 'colleague'},\n\nOur records show ${inv.name} for ${fmt.money(inv.grandTotal, inv.currency)}, due on ${fmt.date(inv.dueDate)}, still has ${fmt.money(inv.outstanding, inv.currency)} to pay${days > 0 ? `, ${days} days after its due date` : ''}. If you have paid it already, thank you, and please ignore this.\n\nYou can pay in USDC with the link below, or by bank transfer to ${bankDetailsFor(inv.currency).payee} (${bankDetailsFor(inv.currency).account}) quoting ${inv.rfReference}.\n\nKind regards,\n${cx.me().name}\nHarbourline Studio`;
  const cmd = `capxul org doc create dunning --from sales-invoice ${inv.name}`;
  cx.modal({ title: `Payment reminder: ${inv.name}`, wide: true, body: h('div', { style: 'display:grid;gap:10px' }, h('div.ac-mini', `To ${customerEmail(inv)} · reminder level 1 · no fee or interest`), h('pre.raw', { style: 'white-space:pre-wrap' }, text)),
    actions: [{ label: 'Cancel' }, { label: 'Send reminder', primary: true, needs: needInvoicing, cmd, onClick: (close) => {
      (inv.timelineExtra ||= []).push({ at: NOW(), who: cx.meId(), kind: 'email', text: `sent a payment reminder to ${customerEmail(inv)}`, sub: `Reminder: ${inv.name}`, body: `${fmt.money(inv.outstanding, inv.currency)} outstanding, due ${fmt.date(inv.dueDate)}` });
      close(); cx.refresh(); cx.toast('Reminder sent', { tone: 'success', cmd });
    } }] });
}
async function cancelDoc(doc, record, label) {
  const cmd = `capxul org doc cancel ${record} ${doc.name}`;
  const pays = (doc.payments || []).filter((p) => p.voucher);
  if (pays.length) {
    const onChain = pays.some((p) => p.payment);
    await cx.confirm({ title: `${doc.name} cannot be cancelled yet`, body: onChain ? `It is settled by a payment made on chain (${pays.map((p) => p.voucher).join(', ')}). A payment Capxul made cannot be undone in the books; ${record === 'sales-invoice' ? 'issue a credit note and refund the customer' : 'ask the supplier for a credit note'} instead.` : `Cancel its payment entries first: ${pays.map((p) => p.voucher).join(', ')}.`, cmd, confirmLabel: 'Understood', cancelLabel: 'Back' });
    return;
  }
  if (!(await cx.confirm({ title: `Cancel ${doc.name}?`, body: `${label}. A cancelled ${record === 'sales-invoice' ? 'invoice' : 'bill'} stays in the books as cancelled, with its ledger lines reversed. Amend it to make a corrected copy.`, cmd, who: record === 'sales-invoice' ? 'whoever wears the Invoicing hat' : 'whoever wears the Books hat', confirmLabel: `Cancel the ${record === 'sales-invoice' ? 'invoice' : 'bill'}`, cancelLabel: 'Back', danger: true }))) return;
  for (const r of linesOf(doc.name)) r.isCancelled = 1;
  doc.docstatus = 2; doc.cancelledAt = NOW(); doc.cancelledBy = cx.meId(); doc.outstanding = 0;
  const v = VCH.get(doc.name); if (v) v.cancelled = true;
  cx.refresh(); cx.toast(`Cancelled ${doc.name}`, { cmd });
}
function amendSi(inv) {
  const copy = JSON.parse(JSON.stringify(inv));
  for (const k of ['docstatus', 'cancelledAt', 'cancelledBy', 'payments', 'timelineExtra', 'requestSent', 'rfReference', 'contentHash', 'submittedAt', 'submittedBy']) delete copy[k];
  copy.amendedFrom = inv.name; copy.payments = [];
  newSalesInvoice(copy);
  cx.toast(`A copy of ${inv.name} to correct. Saving it names it ${inv.name}-1.`, { cmd: `capxul org doc amend sales-invoice ${inv.name}` });
}

/* ---- get items from timesheets ---- */

function activityItem(act, cc) {
  if (act === 'Design' || act === 'Research') return 'Design services';
  if (act === 'Engineering' || act === 'Execution') return 'Engineering services';
  return cc === 'Design' ? 'Design services' : 'Engineering services';
}
function fetchTimesheets(inv) {
  const projects = (D.projects?.projects || []).filter((p) => p.customer === inv.customer && p.billing === 'tm');
  const model = { from: TODAY.slice(0, 7) + '-01', to: TODAY, project: inv.project || projects[0]?.name || '' };
  const result = h('div');
  let found = [];
  const run = () => {
    found = cx.rows('projects.logs').filter((l) => l.project === model.project && l.billable && !l.invoice && l.date >= model.from && l.date <= model.to);
    const ts = new Set(found.map((l) => l.timesheet));
    cx.fill(result, found.length ? h('div', { style: 'display:grid;gap:6px' }, h('b', `${fmt.plural(ts.size, 'timesheet')}, ${fmt.hours(sum(found, 'hours'))}, ${fmt.money(sum(found, 'billingAmount'), inv.currency)} to bill`),
      cx.grid({ columns: [{ key: 'activity', label: 'Activity type' }, { key: 'hours', label: 'Billing hours', type: 'float', dp: 1 }, { key: 'amount', label: 'Billing amount', type: 'currency', currency: inv.currency }], rows: groupLogs(found).map((g) => ({ activity: g.activity, hours: g.hours, amount: g.amount })), totals: ['hours', 'amount'] }))
      : cx.empty('No unbilled time in that range.'));
  };
  const body = h('div', { style: 'display:grid;gap:12px' },
    h('div.ac-form-grid',
      cx.field({ label: 'From', key: 'from', model, edit: true, type: 'date', onChange: run }),
      cx.field({ label: 'To', key: 'to', model, edit: true, type: 'date', onChange: run }),
      cx.field({ label: 'Project', key: 'project', model, edit: true, type: 'select', options: projects.map((p) => [p.name, `${p.name} · ${p.projectName}`]), onChange: run, wide: true })),
    result);
  run();
  cx.modal({ title: 'Fetch timesheets', wide: true, body, actions: [{ label: 'Cancel' }, { label: 'Get timesheets', primary: true, cmd: `capxul org doc list timesheet --filter project=${model.project} --filter "per_billed<100"`, onClick: (close) => {
    if (!found.length) { cx.toast('Nothing to bill in that range.', { tone: 'warning' }); return; }
    const month = fmt.month(model.to).replace(/^(\w+)/, (m) => ({ Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' })[m] || m);
    inv.project = model.project;
    inv.items = groupLogs(found).map((g, i) => ({ idx: i + 1, uom: 'Hour', item: activityItem(g.activity, inv.costCenter), description: `${g.activity}: ${projectName(model.project)}, ${month}${model.to < monthEnd(model.to.slice(0, 7)) ? ` to ${fmt.day(model.to)}` : ''}`, qty: g.hours, rate: g.rate, costCenter: inv.costCenter, project: model.project }));
    const byTs = new Map();
    for (const l of found) { const k = l.timesheet + '|' + l.activity; const o = byTs.get(k) || { timesheet: l.timesheet, activity: l.activity, billingHours: 0, billingAmount: 0 }; o.billingHours = r2(o.billingHours + l.hours); o.billingAmount = r2(o.billingAmount + l.billingAmount); byTs.set(k, o); }
    inv.timesheets = [...byTs.values()];
    inv.kind = 'timesheets';
    siRecompute(inv); close(); cx.refresh();
    cx.toast(`Added ${fmt.plural(inv.items.length, 'line')} from ${fmt.plural(new Set(found.map((l) => l.timesheet)).size, 'timesheet')}`, { tone: 'success', cmd: `capxul org projects timesheet bill --project ${model.project} --from ${model.from} --to ${model.to}` });
  } }] });
}
function groupLogs(logs) {
  const m = new Map();
  for (const l of logs) { const k = l.activity + '|' + l.billingRate; const o = m.get(k) || { activity: l.activity, rate: l.billingRate, hours: 0, amount: 0 }; o.hours = r2(o.hours + l.hours); o.amount = r2(o.amount + l.billingAmount); m.set(k, o); }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}

/* ---- the sales invoice form ---- */

function paymentsReceived(inv) {
  const rows = (inv.payments || []).map((p) => ({ ...p, via: viaOf(p.channel) }));
  const proofs = rows.filter((p) => p.payment).map((p) => payById(p.payment)).filter(Boolean);
  return h('div', { style: 'display:grid;gap:12px' },
    cx.grid({ columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'via', label: 'Paid by', render: (r) => viaTag(r.via) },
      { key: 'voucher', label: 'Payment entry', render: (r) => vLink(r.voucher) },
      { key: 'payment', label: 'Payment ID', opt: true, render: (r) => (r.payment ? h('span.mono', { style: 'font-size:12px' }, r.payment.slice(0, 18) + '…') : h('span.faint', '—')) },
      { key: 'amount', label: 'Allocated', type: 'currency', currency: inv.currency },
    ], rows, totals: ['amount'], empty: 'No payments yet' }),
    ...proofs.map((p) => cx.proof(p, { booked: p.voucher || p.books })));
}
function flightNode(f, inv) {
  if (!f) return null;
  if (f.deposit) {
    const d = f.deposit;
    return h('div.ac-flight', cx.pill(f.text, f.tone), h('span', `${fmt.money(d.bankAmount, d.currency)} by ${d.rail} from ${d.from}, reference `, h('b.mono', d.reference), `, ${d.match.toLowerCase()} to this invoice. It lands in the Treasury as USDC; the invoice turns Paid when it is credited.`), cx.hasRoute('deposit') ? cx.link('Open the deposit', 'deposit', d.id) : null);
  }
  const p = f.payment, po = f.payout;
  const cls = f.tone === 'escrow' ? 'escrow' : f.tone === 'warning' ? 'warn' : '';
  const text = po ? `${fmt.gbp(po.bankAmount)} to ${po.bank?.bankName} ·· ${po.bank?.last4} by ${po.rail}: ${po.status === 'In transit' ? `the Safe sent ${fmt.usdc(po.sent)} at ${fmt.time(po.sentAt)} on ${fmt.date(po.sentAt)}; the bill turns Paid when Bridge delivers.` : po.reason || po.status}`
    : f.sched ? `${fmt.usdc(f.sched.amount)} on ${fmt.date(f.sched.day)} from ${f.sched.budget === 'board' ? 'the Board, by proposal ' + f.sched.proposal : cx.deptName(f.sched.budget) + '’s budget'}. The money is reserved now.`
      : p?.status === 'Money waiting' ? `${fmt.usdc(p.amount)} waits in escrow for ${escrowOf(p)?.email} to claim. ${cx.name(p.approvedBy)} can take it back until it is claimed.`
        : p?.status === 'Prepared' ? `${fmt.usdc(p.amount)} prepared by ${cx.name(p.preparedBy)}, waiting for ${cx.name(p.waitingFor?.who)} to approve with their passkey.` : f.title;
  return h('div.ac-flight', { class: cls }, cx.pill(f.text, f.tone), h('span', { style: 'flex:1;min-width:0' }, text), p && cx.hasRoute('payment') ? cx.link('Open the payment', 'payment', p.id) : null);
}

function siPage(inv) {
  const draft = inv.docstatus === 0;
  const st = inv.__new ? 'Not saved' : invStatus(inv);
  const flight = siFlight(inv);
  if (flight?.deposit) cx.native?.watchArrival?.(flight.deposit);
  const cust = CUST.get(inv.customer);
  const contact = customerContact(inv.customer);
  const ccOptions = B.costCenters.filter((c) => !c.isGroup).map((c) => c.name);
  const projOptions = [['', '—'], ...(D.projects?.projects || []).filter((p) => !inv.customer || p.customer === inv.customer).map((p) => [p.name, `${p.name} · ${p.projectName}`])];
  const totalsBox = h('div', { style: 'min-width:0' });
  const drawTotals = () => cx.fill(totalsBox, cx.section({ cols: 3, fields: [
    { label: 'Total quantity', value: inv.totalQty, type: 'float', dp: 1 },
    { label: `Total (${inv.currency})`, value: inv.netTotal, type: 'currency', currency: inv.currency },
    { label: `Net total (${inv.currency})`, value: inv.netTotal, type: 'currency', currency: inv.currency },
  ] }, { doc: inv }));
  drawTotals();
  const taxBox = h('div', { style: 'min-width:0;display:grid;gap:12px' });
  const grandBox = h('div', { style: 'min-width:0' });
  const drawTax = () => {
    cx.fill(taxBox, cx.grid({ columns: [
      { key: 'type', label: 'Type' }, { key: 'account', label: 'Tax account', render: (r) => accLabel(r.account) }, { key: 'rate', label: 'Tax rate', type: 'percent' },
      { key: 'taxAmount', label: 'Amount', type: 'currency', currency: inv.currency }, { key: 'total', label: 'Total', type: 'currency', currency: inv.currency },
    ], rows: inv.taxes || [], empty: inv.taxNote || 'No taxes' }), cx.section({ cols: 2, fields: [{ label: `Total taxes and charges (${inv.currency})`, value: inv.totalTaxes, type: 'currency', currency: inv.currency }, inv.taxNote ? { label: 'Tax note', value: inv.taxNote } : { label: 'Tax category', value: 'UK VAT' }] }, { doc: inv }));
    cx.fill(grandBox, cx.section({ columns: [[
      { label: 'Grand total', render: () => h('b', { style: 'font-size:15px' }, fmt.money(inv.grandTotal, inv.currency)) },
      { label: 'In words', value: inv.inWords },
    ], [
      { label: 'Rounding adjustment', value: 0, type: 'currency', currency: inv.currency },
      { label: 'Rounded total', value: inv.grandTotal, type: 'currency', currency: inv.currency },
    ]] }, { doc: inv }));
  };
  drawTax();
  const onItems = () => { siRecompute(inv); drawTotals(); drawTax(); };
  const itemCols = [
    { key: 'item', label: 'Item', edit: true, type: 'select', options: ['Engineering services', 'Design services', 'Retainer'], width: '170px' },
    { key: 'description', label: 'Description', edit: true },
    { key: 'qty', label: 'Quantity', type: 'float', dp: 1, edit: true, width: '90px' },
    { key: 'rate', label: 'Rate', type: 'currency', currency: inv.currency, edit: true, width: '110px' },
    { key: 'amount', label: 'Amount', type: 'currency', currency: inv.currency, get: (r) => r2((+r.qty || 0) * (+r.rate || 0)) },
  ];
  const rowForm = [
    { key: 'item', label: 'Item', type: 'select', options: ['Engineering services', 'Design services', 'Retainer'] }, { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'qty', label: 'Quantity', type: 'float' }, { key: 'uom', label: 'UOM' }, { key: 'rate', label: 'Rate', type: 'currency', currency: inv.currency },
    { key: 'amount', label: 'Amount', type: 'currency', currency: inv.currency, edit: false }, { key: 'incomeAccount', label: 'Income account', render: (r) => accLabel(r.incomeAccount || ITEM_ACC[r.item]) },
    { key: 'costCenter', label: 'Cost centre' }, { key: 'project', label: 'Project' },
  ];
  const refresh = () => cx.refresh();
  const form = cx.formView({
    doc: inv, editable: draft, tabKey: 'ac-sinv',
    onChange: (doc, key) => { if (key === 'customer') { customerDefaults(doc, doc.customer); siRecompute(doc); refresh(); } else if (key === 'postingDate') { doc.dueDate = addDays(doc.postingDate, CUST.get(doc.customer)?.terms || 30); refresh(); } },
    tabs: lockValues([
      { label: 'Details', sections: [
        { columns: [[
          { label: 'Series', value: inv.isReturn ? `ACC-SINV-RET-.YYYY.-` : 'ACC-SINV-.YYYY.-', readOnly: true, reqd: true },
          draft ? { label: 'Customer', key: 'customer', type: 'select', reqd: true, options: B.customers.map((c) => [c.id, c.name]) } : { label: 'Customer', value: inv.customerName, type: 'link', href: cx.hasRoute('company') ? ['company', inv.customer] : null, reqd: true },
          { label: 'Customer name', value: inv.customerName, readOnly: true },
          { label: 'Tax ID', value: cust?.vat || '—', readOnly: true },
        ], [
          { label: 'Posting date', key: 'postingDate', type: 'date', reqd: true },
          { label: 'Posting time', value: inv.requestSent ? fmt.time(new Date(Date.parse(inv.requestSent) - 120000).toISOString()) : '09:30', readOnly: true },
          { label: 'Payment due date', key: 'dueDate', type: 'date', reqd: true },
        ], [
          { label: 'Is return (credit note)', value: inv.isReturn ? 1 : 0, type: 'check', readOnly: true },
          inv.isReturn ? { label: 'Return against', value: inv.returnAgainst, type: 'link', href: ['sales-invoice', inv.returnAgainst], readOnly: true } : null,
          { label: 'Is rate adjustment entry (debit note)', value: 0, type: 'check', readOnly: true, help: 'Issue a debit note with 0 quantity against an existing sales invoice' },
          inv.amendedFrom ? { label: 'Amends', value: inv.amendedFrom, type: 'link', href: ['sales-invoice', inv.amendedFrom], readOnly: true } : null,
          inv.isOpening ? { label: 'Is opening entry', value: 1, type: 'check', readOnly: true, help: `Issued ${fmt.date(inv.originalDate)} in the old books` } : null,
        ].filter(Boolean)] },
        { label: 'Accounting dimensions', collapsible: true, collapsed: false, columns: [[
          draft ? { label: 'Cost centre', key: 'costCenter', type: 'select', options: ccOptions } : { label: 'Cost centre', value: inv.costCenter, type: 'link', href: ['cost-centres'] },
        ], [
          draft ? { label: 'Project', key: 'project', type: 'select', options: projOptions } : { label: 'Project', render: () => projectLink(inv.project) },
        ]] },
        { label: 'Currency and price list', collapsible: true, collapsed: true, columns: [[
          { label: 'Currency', value: inv.currency, readOnly: true, reqd: true },
          { label: 'Exchange rate', value: inv.conversionRate, type: 'float', dp: 4, readOnly: true, help: inv.currency === 'GBP' ? null : `1 ${inv.currency} = £${inv.conversionRate} on ${fmt.date(inv.postingDate)}` },
        ], [
          { label: 'Price list', value: inv.currency === 'GBP' ? 'Standard Selling' : 'Standard Selling USD', readOnly: true },
          { label: 'Price list currency', value: inv.currency, readOnly: true },
          { label: 'Ignore pricing rule', value: 0, type: 'check', readOnly: true },
        ]] },
        { label: 'Items', actions: draft ? cx.btn('Get items from timesheets', { sm: true, icon: 'clock', needs: needInvoicing, onClick: () => fetchTimesheets(inv) }) : null,
          table: cx.grid({ columns: itemCols, rows: inv.items, editable: draft, totals: ['amount'], addLabel: 'Add row', rowForm, title: 'Item', onChange: onItems, empty: draft ? 'No items yet. Get them from timesheets, or add a row.' : 'No items' }) },
        { node: totalsBox },
        { label: 'Taxes and charges', node: taxBox },
        { label: 'Totals', node: grandBox },
        inv.currency !== 'GBP' ? { label: 'Totals (company currency)', columns: [[{ label: 'Grand total (GBP)', value: inv.baseGrandTotal, type: 'currency', currency: 'GBP' }, { label: 'In words (GBP)', value: inWords(inv.baseGrandTotal, 'GBP') }], [{ label: 'Rounding adjustment (GBP)', value: 0, type: 'currency', currency: 'GBP' }, { label: 'Rounded total (GBP)', value: inv.baseGrandTotal, type: 'currency', currency: 'GBP' }]] } : null,
        { cols: 2, fields: [{ label: 'Total advance', value: 0, type: 'currency', currency: inv.currency }, { label: 'Outstanding amount', render: () => h('b', fmt.money(inv.outstanding, inv.currency)) }] },
        flight ? { label: 'The payment in flight', node: flightNode(flight, inv) } : null,
        { label: 'Additional discount', collapsible: true, collapsed: true, columns: [[{ label: 'Apply additional discount on', value: 'Grand Total' }, { label: `Additional discount amount (${inv.currency})`, value: 0, type: 'currency', currency: inv.currency }], [{ label: 'Additional discount percentage', value: 0, type: 'percent' }, { label: 'Is cash or non trade discount', value: 0, type: 'check' }]] },
        inv.timesheets?.length ? { label: `Time sheet list (${inv.timesheets.length})`, collapsible: true, collapsed: true, table: cx.grid({ columns: [
          { key: 'activity', label: 'Activity type' }, { key: 'timesheet', label: 'Time sheet', render: (r) => (cx.hasRoute('timesheet') ? cx.link(r.timesheet, 'timesheet', r.timesheet) : r.timesheet) },
          { key: 'billingHours', label: 'Billing hours', type: 'float', dp: 1 }, { key: 'billingAmount', label: 'Billing amount', type: 'currency', currency: inv.currency },
        ], rows: inv.timesheets, totals: ['billingHours', 'billingAmount'] }) } : null,
        { label: 'How to pay', desc: 'Printed on the invoice and sent with every payment request.', node: howToPay(inv) },
      ].filter(Boolean) },
      { label: 'Payments', count: inv.payments?.length || null, render: () => h('div', { style: 'padding:16px;display:grid;gap:14px' },
        cx.section({ cols: 2, fields: [{ label: 'Paid amount (company currency)', value: r2(sum(inv.payments || [], 'amount') * (inv.conversionRate || 1)), type: 'currency', currency: 'GBP' }, { label: 'Outstanding amount', value: inv.outstanding, type: 'currency', currency: inv.currency }] }, { doc: inv }),
        cx.section({ label: 'Payments received', node: paymentsReceived(inv) }),
        cx.section({ label: 'Advance payments', collapsible: true, collapsed: true, columns: [[{ label: 'Allocate advances automatically (FIFO)', value: 0, type: 'check' }], [{ label: 'Only include allocated payments', value: 0, type: 'check' }]], table: { columns: [{ key: 'ref', label: 'Reference name' }, { key: 'remarks', label: 'Remarks' }, { key: 'adv', label: 'Advance amount', type: 'currency' }, { key: 'alloc', label: 'Allocated amount', type: 'currency' }], rows: [], empty: 'No advances from this customer' } }, { doc: inv })) },
      { label: 'Address and contact', sections: [
        { label: 'Billing address', columns: [[{ label: 'Customer address', value: cust ? `${cust.name}, ${cust.city}, ${cust.territory}` : '—' }, { label: 'Territory', value: cust?.territory || '—' }], [{ label: 'Contact person', value: contact?.name || '—' }, { label: 'Contact', value: contact ? `${contact.designation || ''}` : '—' }, { label: 'Contact email', value: customerEmail(inv) }]] },
        { label: 'Company address', columns: [[{ label: 'Company address', value: `${D.company.name}, ${D.company.address}` }], [{ label: 'Company contact person', value: cx.name(inv.createdBy || 'kwame') }]] },
      ] },
      { label: 'Terms', sections: [
        { label: 'Payment terms', fields: [{ label: 'Payment terms template', value: inv.paymentTerms || 'Net 30' }], table: cx.grid({ columns: [
          { key: 'term', label: 'Payment term' }, { key: 'description', label: 'Description', opt: true }, { key: 'dueDate', label: 'Due date', type: 'date' },
          { key: 'portion', label: 'Invoice portion', type: 'percent' }, { key: 'amount', label: 'Payment amount', type: 'currency' }, { key: 'outstanding', label: 'Outstanding', type: 'currency' }, { key: 'paid', label: 'Paid amount', type: 'currency', opt: true },
        ], rows: scheduleOf(inv) }) },
        { label: 'Terms and conditions', fields: [{ label: 'Terms', value: 'Standard terms of business' }, { label: 'Terms and conditions details', value: termsText(inv), type: 'textarea', wide: true }] },
      ] },
      { label: 'More info', sections: [
        { label: 'Customer’s purchase order', columns: [[{ label: 'Customer’s purchase order', value: inv.poNo || null }], [{ label: 'Customer’s purchase order date', value: inv.poDate || null, type: 'date' }]] },
        { label: 'Accounting details', columns: [[{ label: 'Debit to', value: accLabel(inv.debitTo || '1200'), type: 'link', href: ['account', inv.debitTo || '1200'], reqd: true }], [{ label: 'Is opening entry', value: inv.isOpening ? 1 : 0, type: 'check' }]] },
        { label: 'Additional info', columns: [[{ label: 'Status', value: st, type: 'status' }, { label: 'Remarks', key: 'remarks', type: 'textarea' }, { label: 'Title', value: inv.customerName }], [{ label: 'Is internal customer', value: 0, type: 'check' }, { label: 'Is discounted', value: 0, type: 'check' }, inv.billedWith ? { label: 'Made by', value: `capxul ${inv.billedWith.replace(/^capxul /, '')}`, type: 'mono' } : null, inv.contentHash ? { label: 'Content hash', value: inv.contentHash, type: 'hash', help: 'SHA-256 of the invoice’s lines and tax: what a payment’s proof commits to.' } : null].filter(Boolean)] },
      ] },
    ]),
    connections: draft ? null : [
      { group: 'Payment', items: [{ label: 'Payment entry', count: new Set((inv.payments || []).map((p) => p.voucher).filter(Boolean)).size, route: 'payment-entries' }, { label: 'Payment request', count: inv.requestSent ? 1 : 0 }, { label: 'Journal entry', count: 0, route: 'journal-entries' }] },
      { group: 'Reference', items: [{ label: 'Timesheet', count: new Set((inv.timesheets || []).map((t) => t.timesheet)).size, route: cx.hasRoute('timesheets') ? 'timesheets' : null }, { label: 'Project', count: inv.project ? 1 : 0, route: inv.project && cx.hasRoute('project') ? 'project' : null, id: inv.project }] },
      { group: 'Returns', items: [{ label: 'Sales invoice', count: B.salesInvoices.filter((x) => x.returnAgainst === inv.name).length, route: 'sales-invoices' }] },
    ],
    side: sideFor(inv, 'sales-invoice', inv.customerName),
    timeline: { items: inv.__new ? [{ at: inv.createdAt, who: inv.createdBy, kind: 'created', text: 'created this' }] : timelineFor(inv, 'si'), comment: true },
  });

  const get = `capxul org doc get sales-invoice ${inv.name}`;
  const printCmd = `capxul org doc render sales-invoice ${inv.name} --format "Sales Invoice"`;
  const more = cx.menu(null, [
    { label: 'Print', icon: 'file', cmd: printCmd, onClick: () => noDownload(printCmd) },
    { label: 'Copy the reference', icon: 'copy', onClick: () => { cx.copy(inv.rfReference || inv.name); cx.toast('Copied'); } },
    { label: 'Duplicate', icon: 'plus', needs: needInvoicing, cmd: `capxul org doc create sales-invoice --from sales-invoice ${inv.name}`, onClick: () => { const c = JSON.parse(JSON.stringify(inv)); for (const k of ['docstatus', 'payments', 'timelineExtra', 'requestSent', 'rfReference', 'contentHash', 'submittedAt', 'amendedFrom', 'cancelledAt', 'timesheets']) delete c[k]; c.payments = []; c.timesheets = []; newSalesInvoice(c); } },
    draft && !inv.__new ? { label: 'Delete', icon: 'trash', danger: true, needs: needInvoicing, cmd: `capxul org doc remove sales-invoice ${inv.name}`, onClick: async () => { if (await cx.confirm({ title: `Delete ${inv.name}?`, body: 'A draft has never been posted; deleting it leaves no trace in the books.', cmd: `capxul org doc remove sales-invoice ${inv.name}`, danger: true, confirmLabel: 'Delete the draft' })) { B.salesInvoices.splice(B.salesInvoices.indexOf(inv), 1); cx.go('sales-invoices'); cx.toast(`Deleted ${inv.name}`); } } } : null,
  ]);
  let actions;
  if (inv.__new) actions = [cx.menu('Get items from', [{ label: 'Timesheet', icon: 'clock', needs: needInvoicing, onClick: () => fetchTimesheets(inv) }]), cx.btn('Save', { kind: 'primary', needs: needInvoicing, cmd: 'capxul org doc create sales-invoice --input invoice.json', onClick: () => saveSalesInvoice(inv) })];
  else if (draft) actions = [more, cx.menu('Get items from', [{ label: 'Timesheet', icon: 'clock', needs: needInvoicing, onClick: () => fetchTimesheets(inv) }]), cx.menu('Preview', [{ label: 'Ledger preview', icon: 'report', onClick: () => { siRecompute(inv); ledgerPreview(inv.name, siGlLines(inv)); } }]), cx.btn('Post', { kind: 'primary', icon: 'check', needs: needInvoicing, cmd: `capxul org doc submit sales-invoice ${inv.name}`, onClick: () => postSalesInvoice(inv) })];
  else if (inv.docstatus === 2) actions = [more, cx.btn('Amend', { kind: 'primary', needs: needInvoicing, cmd: `capxul org doc amend sales-invoice ${inv.name}`, onClick: () => amendSi(inv) })];
  else {
    const proofPays = (inv.payments || []).filter((p) => p.payment && payById(p.payment)?.proof);
    const view = cx.menu('View', [
      { label: 'Ledger', icon: 'report', cmd: `capxul org report run general-ledger --filter voucher_no=${inv.name}`, onClick: () => cx.go('general-ledger', null, { report: { voucher: inv.name, from: inv.postingDate, to: TODAY, account: '', party: '' } }) },
      { label: 'Proof', icon: 'shield', disabled: !proofPays.length, reason: 'No payment with a proof on chain yet', cmd: proofPays[0] ? `capxul payment get ${proofPays[0].payment}` : null, onClick: () => cx.panel.open({ title: `Proof: ${inv.name}`, sub: 'What the payment committed to on chain', wide: true, body: h('div', { style: 'display:grid;gap:12px;padding:4px' }, proofPays.map((p) => cx.proof(payById(p.payment), { booked: p.voucher }))) }) },
      { label: 'Accounts receivable', icon: 'report', href: ['accounts-receivable'] },
    ]);
    const open = inv.outstanding > 0.005 && !inv.isReturn;
    const create = cx.menu('Create', [
      open ? { label: 'Request payment', icon: 'send', needs: needInvoicing, cmd: requestCmd(inv), sub: 'The pay link and the bank details', onClick: () => requestPayment(inv) } : null,
      open ? { label: 'Record payment', icon: 'bank', needs: { any: ['Books', 'Invoicing', 'Director'] }, cmd: `capxul org doc create payment-entry --from sales-invoice ${inv.name}`, sub: 'Money that reached Barclays', onClick: () => recordSiPayment(inv) } : null,
      !inv.isReturn ? { label: 'Credit note', icon: 'file', needs: needInvoicing, cmd: `capxul org doc create sales-invoice --from sales-invoice ${inv.name} --input return.json`, onClick: () => creditNote(inv) } : null,
      open ? { label: 'Payment reminder', icon: 'mail', needs: needInvoicing, cmd: `capxul org doc create dunning --from sales-invoice ${inv.name}`, onClick: () => dunning(inv) } : null,
    ], { kind: 'primary' });
    actions = [more, view, create, cx.btn('Cancel', { needs: needInvoicing, cmd: `capxul org doc cancel sales-invoice ${inv.name}`, onClick: () => cancelDoc(inv, 'sales-invoice', `${inv.customerName} · ${fmt.money(inv.grandTotal, inv.currency)}`) })];
  }
  return cx.page({
    title: inv.__new ? 'New sales invoice' : inv.customerName,
    crumbs: crumbs({ label: 'Sales invoices', route: 'sales-invoices' }),
    status: inv.__new ? [cx.pill('Not saved', 'orange', { lg: true })] : pills(st, flight, true),
    sub: inv.__new ? `${inv.customerName} · not saved` : `${inv.name} · ${fmt.date(inv.postingDate)} · ${fmt.money(inv.grandTotal, inv.currency)}${inv.currency !== 'GBP' ? ` (${fmt.gbp(inv.baseGrandTotal)})` : ''}`,
    cmd: { cli: inv.__new ? 'capxul org doc create sales-invoice --input invoice.json' : get, sdk: inv.__new ? 'client.org(orgId).docs.create("sales-invoice", invoice)' : `client.org(orgId).docs.get("sales-invoice", "${inv.name}")`, kind: 'family', who: 'anyone with a seat reads it; whoever wears the Invoicing hat posts it',
      json: inv.__new ? undefined : { name: inv.name, customer: inv.customerName, status: st, currency: inv.currency, grand_total: inv.grandTotal, outstanding_amount: inv.outstanding, due_date: inv.dueDate, payment_reference: inv.rfReference } },
    banner: draft && !inv.__new ? cx.banner('Post this invoice to make it final.', { tone: 'info' }) : inv.docstatus === 2 ? cx.banner('This invoice is cancelled. Amend it to make a corrected copy.', { tone: 'warning' }) : null,
    fde: `Sales invoice ${inv.name} to ${inv.customerName}, ${fmt.money(inv.grandTotal, inv.currency)}, ${st}`,
    actions,
    body: form,
  });
}
cx.route('sales-invoice', (ctx) => {
  const inv = cx.find(B.salesInvoices, 'name', ctx.id);
  if (!inv) return cx.page({ title: 'Not found', crumbs: crumbs({ label: 'Sales invoices', route: 'sales-invoices' }), body: cx.empty('No such sales invoice') });
  return siPage(inv);
}, { workspace: 'books', title: 'Sales invoice' });

/* =====================================================================================================
   Purchase invoices
   ===================================================================================================== */

const PI_TABS = [
  { label: 'Drafts', filter: (r) => r.docstatus === 0, flag: '--filter docstatus=0' },
  { label: 'To pay', filter: (r) => r.docstatus !== 0 && r.docstatus !== 2 && r.outstanding > 0.005, flag: '--filter "outstanding_amount>0"' },
  { label: 'Overdue', filter: (r) => invStatus(r) === 'Overdue', flag: '--filter status=Overdue' },
  { label: 'On hold', filter: (r) => !!r.onHold && r.outstanding > 0, flag: '--filter on_hold=1' },
  { label: 'Debit notes', filter: (r) => !!r.isReturn, flag: '--filter is_return=1' },
  { label: 'All' },
];
const PI_STATUSES = ['Draft', 'Unpaid', 'Partly Paid', 'Overdue', 'On Hold', 'Paid', 'Return', 'Debit Note Issued', 'Cancelled'];
const HARBOURLINE_PARTY = (() => { for (const p of M.payments) { const x = p.proof?.advice?.payer?.party; if (x) return x; } return '0x999470e2e354e0a2024b593ecef2e82aa5c3e96c'; })();
function supplierSafe(id) { const p = M.payments.find((x) => x.payee?.id === id && x.payee.safe); return p ? { safe: p.payee.safe, party: p.payee.party, handle: p.payee.handle } : null; }
function payModeOf(sup) {
  if (!sup) return 'outside';
  if (sup.pay === 'usdc') return sup.handle || supplierSafe(sup.id) ? 'safe' : 'escrow';
  if (sup.pay === 'payout') return 'bank';
  return 'outside';
}
const supplierBank = (sup) => M.savedBankAccounts.find((b) => b.holder === sup?.name) || (M.payouts.find((p) => p.to === sup?.name)?.bank ? { bank: M.payouts.find((p) => p.to === sup?.name).bank.bankName, last4: M.payouts.find((p) => p.to === sup?.name).bank.last4, sortCode: M.payouts.find((p) => p.to === sup?.name).bank.sortCode, id: `bacc_${sup.id}` } : null);

cx.route('purchase-invoices', () => {
  const filters = [
    { key: 'name', label: 'ID' },
    { key: 'supplierName', label: 'Supplier', type: 'select', field: 'supplier' },
    { key: 'status', label: 'Status', type: 'select', options: PI_STATUSES, get: (r) => invStatus(r) },
    { key: 'billNo', label: 'Supplier invoice no', field: 'bill_no', like: true },
    { key: 'postingDate', label: 'Posting month', type: 'month', field: 'posting_date' },
    { key: 'department', label: 'Department', type: 'select', field: 'cost_center', options: () => D.departments.map((d) => [d.id, d.name]) },
  ];
  const list = cx.listView({
    key: 'ac-pinv', rows: () => B.purchaseInvoices, noun: 'purchase invoice', id: (r) => r.name,
    initial: listInit('ac-pinv'),
    titleCol: { key: 'supplierName', label: 'Supplier', sub: (r) => r.items?.[0]?.description },
    status: (r) => pills(invStatus(r), piFlight(r)),
    columns: [
      { key: 'billNo', label: 'Supplier invoice no' },
      { key: 'dueDate', label: 'Due date', type: 'date' },
      { key: 'department', label: 'Department', render: (r) => (r.department ? cx.deptName(r.department) : h('span.faint', '—')) },
      { label: 'Paid by', render: (r) => { const k = paidByOfInv(r); return k ? h('span.ac-vias', k.map((x) => viaTag(x))) : h('span.faint', '—'); } },
      { key: 'outstanding', label: 'Outstanding', type: 'currency', keep: true },
    ],
    right: { key: 'grandTotal', label: 'Grand total', type: 'currency' },
    modified: (r) => r.modifiedAt || r.payments?.[r.payments.length - 1]?.date || r.postingDate,
    filters, tabs: PI_TABS,
    sort: { options: [{ key: 'postingDate', label: 'Posting date' }, { key: 'dueDate', label: 'Due date' }, { key: 'grandTotal', label: 'Grand total', get: (r) => r.baseGrandTotal ?? r.grandTotal }, { key: 'outstanding', label: 'Outstanding' }, { key: 'supplierName', label: 'Supplier' }], default: { key: 'postingDate', dir: 'desc' } },
    groupBy: [{ key: 'supplierName', label: 'Supplier' }, { key: 'status', label: 'Status', get: (r) => invStatus(r) }, { key: 'department', label: 'Department', format: (v) => cx.deptName(v) }, { key: 'currency', label: 'Currency' }],
    href: (r) => ['purchase-invoice', r.name],
    bulk: [
      { label: 'Pay selected', icon: 'send', cmd: 'capxul org department pay <department> --to <supplier> --amount <total>', onClick: (rows) => {
        const open = rows.filter((r) => r.outstanding > 0.005 && r.docstatus !== 0 && r.docstatus !== 2 && !piFlight(r));
        if (!open.length) { cx.toast('None of these bills is waiting to be paid.', { tone: 'warning' }); return; }
        if (new Set(open.map((r) => r.supplier)).size > 1 || new Set(open.map((r) => r.currency)).size > 1) { cx.toast('Pay selected makes one payment: tick bills from one supplier, in one currency.', { tone: 'warning' }); return; }
        payBill(open);
      } },
      { label: 'Export', icon: 'file', cmd: 'capxul org doc list purchase-invoice --json', onClick: (rows) => noDownload(`capxul org doc list purchase-invoice --filter "name in (${rows.map((r) => r.name).join(',')})" --json`) },
    ],
    cmd: lvCmd('purchase-invoice', PI_TABS, filters),
    views: [{ label: 'List', route: 'purchase-invoices', active: true, icon: 'list' }, { label: 'Report', route: 'accounts-payable', icon: 'report' }],
  });
  return cx.page({
    title: 'Purchase invoices', crumbs: crumbs(),
    actions: [cx.menu(null, [{ label: 'Accounts payable', href: ['accounts-payable'], icon: 'report' }, { label: 'Bills from Capxul companies', icon: 'mail', cmd: 'capxul inbox list', onClick: () => cx.toast('Requests other Capxul companies sent Harbourline arrive in the inbox and become bills here.', { cmd: 'capxul inbox list' }) }, { label: 'Export', icon: 'file', cmd: 'capxul org doc list purchase-invoice --json', onClick: () => noDownload('capxul org doc list purchase-invoice --json') }]),
      cx.btn('New purchase invoice', { kind: 'primary', icon: 'plus', needs: needBooks, cmd: 'capxul org doc create purchase-invoice --input bill.json', onClick: () => newPurchaseInvoice() })],
    body: list,
  });
}, { workspace: 'books', title: 'Purchase invoices' });

/* ---- a purchase invoice's arithmetic and ledger ---- */

function piRecompute(pi) {
  for (const it of pi.items) { it.amount = r2((+it.qty || 0) * (+it.rate || 0)); it.expenseAccount = it.expenseAccount || '6900'; }
  pi.netTotal = r2(sum(pi.items, 'amount'));
  const sup = SUPP.get(pi.supplier);
  const vat = pi.currency === 'GBP' && !!sup?.vat;
  pi.taxes = vat ? [{ account: '2102', rate: 20, taxAmount: r2(pi.netTotal * 0.2), description: 'VAT 20%' }] : [];
  pi.totalTaxes = r2(sum(pi.taxes, 'taxAmount'));
  pi.grandTotal = r2(pi.netTotal + pi.totalTaxes);
  const cr = pi.conversionRate || 1;
  pi.netTotalGbp = r2(pi.netTotal * cr); pi.baseGrandTotal = r2(pi.grandTotal * cr);
  if (pi.docstatus === 0) pi.outstanding = pi.grandTotal;
}
function piGlLines(pi) {
  const cr = pi.conversionRate || 1;
  const lines = [];
  for (const it of pi.items) lines.push({ account: it.expenseAccount || '6900', debit: r2(it.amount * cr), costCenter: pi.costCenter, project: it.project || pi.project });
  for (const t of pi.taxes || []) lines.push({ account: t.account, debit: r2(t.taxAmount * cr) });
  lines.push({ account: pi.creditTo || '2000', credit: r2(sum(lines, 'debit')), party: pi.supplier, partyType: 'Supplier', againstType: 'Purchase Invoice', against: pi.name });
  return lines;
}
const PI_ITEMS = [['6100', 'Rent'], ['6200', 'Software'], ['5200', 'Cloud hosting'], ['5100', 'Contract work'], ['6300', 'Travel'], ['6400', 'Events'], ['6600', 'Professional services'], ['6700', 'Insurance'], ['6900', 'Office supplies'], ['1500', 'Equipment']];
function supplierDefaults(pi, id) {
  const s = SUPP.get(id);
  pi.supplier = id; pi.supplierName = s?.name || id; pi.currency = s?.currency || 'GBP';
  pi.conversionRate = pi.currency === 'GBP' ? 1 : r6(cx.rate(pi.postingDate));
  pi.department = s?.from || pi.department || 'operations';
  pi.costCenter = B.costCenters.find((c) => c.department === pi.department)?.name || 'Main';
  const last = [...B.purchaseInvoices].reverse().find((x) => x.supplier === id && x.docstatus !== 0);
  if (last && !pi.items.length) pi.items = last.items.map((it, i) => ({ idx: i + 1, item: it.item, description: it.description.replace(/\b(January|February|March|April|May|June|July|August|September|October|December)\b/, 'November'), qty: it.qty, rate: it.rate, uom: it.uom, expenseAccount: it.expenseAccount }));
}
function newPurchaseInvoice(from) {
  const pi = from || { items: [], payments: [], taxes: [] };
  Object.assign(pi, { name: `new-purchase-invoice-${++draftSeq}`, docstatus: 0, __new: true, postingDate: TODAY, billDate: pi.billDate || TODAY, createdBy: cx.meId(), createdAt: NOW(), creditTo: '2000' });
  if (!from) { supplierDefaults(pi, 'commonroom'); pi.billNo = ''; pi.dueDate = addDays(TODAY, 14); }
  piRecompute(pi);
  B.purchaseInvoices.push(pi);
  cx.go('purchase-invoice', pi.name);
}
function savePurchaseInvoice(pi) {
  if (!pi.supplier || !pi.billNo) { cx.toast('A bill needs its supplier and the supplier’s invoice number.', { tone: 'warning' }); return; }
  const old = pi.name;
  pi.name = pi.amendedFrom ? `${pi.amendedFrom}-1` : nextName(pi.isReturn ? `ACC-PINV-RET-${YEAR}-` : `ACC-PINV-${YEAR}-`);
  delete pi.__new; pi.modifiedAt = NOW(); pi.modifiedBy = cx.meId();
  cx.toast(`Saved ${pi.name} as a draft`, { tone: 'success', cmd: `capxul org doc create purchase-invoice --input ${old}.json` });
  cx.go('purchase-invoice', pi.name);
}
async function postPurchaseInvoice(pi) {
  piRecompute(pi);
  if (!pi.items.length || near0(pi.grandTotal)) { cx.toast('Add at least one line before posting.', { tone: 'warning' }); return; }
  const cmd = `capxul org doc submit purchase-invoice ${pi.name}`;
  if (!(await cx.confirm({ title: `Post ${pi.name}?`, body: `${pi.supplierName} · ${pi.billNo} · ${fmt.money(pi.grandTotal, pi.currency)}, paid from ${cx.deptName(pi.department)}’s budget. Posting books it to the ledger; paying it is a separate step.`, cmd, who: 'whoever wears the Books hat, or a Director', confirmLabel: 'Post' }))) return;
  pi.docstatus = 1; pi.submittedAt = NOW(); pi.submittedBy = cx.meId(); pi.outstanding = pi.grandTotal; pi.paidAmount = 0; pi.voucher = pi.name;
  pi.contentHash = await cx.hashOf({ record: 'Purchase Invoice', name: pi.name, supplier: pi.supplier, billNo: pi.billNo, currency: pi.currency, items: pi.items.map((i) => ({ idx: i.idx, description: i.description, qty: i.qty, rate: i.rate, amount: i.amount })), taxes: pi.taxes, grandTotal: pi.grandTotal });
  postVoucher({ name: pi.name, type: 'Purchase Invoice', entryType: null, paymentType: null, date: pi.postingDate, title: pi.supplierName, total: pi.baseGrandTotal, party: pi.supplier, partyType: 'Supplier', payment: null, closing: false }, piGlLines(pi));
  cx.refresh();
  cx.toast(`Posted ${pi.name}: ${fmt.money(pi.grandTotal, pi.currency)} from ${pi.supplierName}`, { tone: 'success', cmd, action: { label: 'Pay', onClick: () => payBill([pi]) } });
}

/* ---- paying a bill: Capxul's pay step ---- */

function quarterBudget(dept) {
  const d = D.departments.find((x) => x.id === dept);
  return d?.budgets?.find((b) => b.from <= TODAY && b.to >= TODAY) || null;
}
function spendFromBudget(dept, usdc, kind = 'spent') {
  const b = quarterBudget(dept); if (!b) return;
  b[kind] = r2((b[kind] || 0) + usdc); b.left = r2(b.amount - b.spent - (b.committed || 0));
}
function quoteFor(gbp) {
  const quoteRate = r6(RATE * 0.99959);
  const net = r2(gbp / quoteRate);
  const fee = r2(Math.max(0.5, net * 0.00064));
  return { quoteRate, net, fee, sent: r2(net + fee), expires: new Date(cx.now.getTime() + 14 * 60000).toISOString() };
}
async function adviceFor(p, list, route, dept, payee, cashGbp) {
  const allocations = list.map((pi) => ({
    record: 'Purchase Invoice', doc: pi.name, currency: pi.currency, number: pi.billNo, date: pi.billDate || pi.postingDate, content: pi.contentHash,
    allocated: Math.round(pi.outstanding * 100),
    lines: pi.items.map((it) => ({ idx: it.idx, description: it.description, amount: Math.round(it.amount * 100), taxes: (pi.taxes || []).length ? [{ name: 'VAT', bps: Math.round((pi.taxes[0].rate || 20) * 100), amount: Math.round(it.amount * (pi.taxes[0].rate || 20)) }] : [] })),
  }));
  const advice = { version: 1, origin: p.id, salt: cx.randHex(16), payer: { party: HARBOURLINE_PARTY, account: D.company.treasury }, payee, token: 'USDC', amount: p.amountRaw,
    cash: { currency: 'GBP', decimals: 2, amount: Math.round(cashGbp * 100), rate: RATE }, allocations, adjustments: [], onAccount: 0, memo: list.map((x) => x.billNo).join(', '), refundOf: '0x0', route: { kind: route, budget: dept, payAt: 0 }, batch: null };
  return advice;
}
/** The pay step: from a department's budget, to the supplier's Safe, their bank through Bridge, or an escrow they claim. */
function payBill(list) {
  const pi = list[0];
  const sup = SUPP.get(pi.supplier);
  const mode = payModeOf(sup);
  if (mode === 'outside') { recordPiPayment(pi); return; }
  const cur = pi.currency;
  const owed = r2(sum(list, 'outstanding'));
  const gbp = cur === 'GBP' ? owed : r2(owed * RATE);
  const usdc = cur === 'GBP' ? (mode === 'bank' ? null : r2(owed / RATE)) : owed;
  const quote = mode === 'bank' ? quoteFor(owed) : null;
  const send = mode === 'bank' ? quote.sent : usdc;
  const depts = D.departments.filter((d) => cx.holds(d.id));
  const model = { from: depts.some((d) => d.id === pi.department) ? pi.department : depts[0]?.id || pi.department, when: 'now' };
  const safe = supplierSafe(sup?.id);
  const bank = supplierBank(sup);
  const last = paymentsForPi(pi).map(payoutOf).find(Boolean);
  const fromBox = h('div.ac-choice');
  const drawFrom = () => cx.fill(fromBox, ...D.departments.map((d) => {
    const b = quarterBudget(d.id); const ok = cx.holds(d.id); const holders = cx.holders(d.id).map(cx.name).join(', ');
    return h('label', { 'aria-disabled': ok ? null : 'true', title: ok ? null : `Needs the ${d.name} hat or one above it. ${holders} wears it now.` },
      h('input', { type: 'radio', name: 'ac-pay-from', value: d.id, checked: model.from === d.id, disabled: !ok, onchange: () => { model.from = d.id; } }),
      h('span.t', h('b', `${d.name}${d.id === pi.department ? ' · this bill’s department' : ''}`), h('span', b ? `${fmt.usdc(b.left)} left of ${fmt.usdc(b.amount)} in ${b.quarter} · ${holders} wears the hat` : `${holders} wears the hat`)));
  }), h('label', { 'aria-disabled': cx.wears('Director') ? null : 'true' }, h('input', { type: 'radio', name: 'ac-pay-from', value: 'board', checked: model.from === 'board', disabled: !cx.wears('Director'), onchange: () => { model.from = 'board'; } }), h('span.t', h('b', 'The Board'), h('span', 'From the Treasury by Board proposal: two Directors approve'))));
  drawFrom();
  const toNode = mode === 'safe'
    ? h('div.ac-quote', h('dt', 'Pays'), h('dd', `${sup.name} · ${safe?.handle || sup.handle || ''}`), h('dt', 'Their Safe'), h('dd', safe ? cx.addr(safe.safe) : '—'), h('dt', 'Amount'), h('dd', h('b', fmt.usdc(usdc))), h('dt', 'In pounds'), h('dd', `${fmt.gbp(gbp)} at 1 USDC = £${RATE}`))
    : mode === 'escrow'
      ? h('div', { style: 'display:grid;gap:8px' }, cx.banner(`${sup.name} has no Capxul account yet. The money waits in escrow for ${sup.email} to claim with payment claim; it goes back to the budget if you take it back first.`, { tone: 'escrow' }), h('div.ac-quote', h('dt', 'Waits for'), h('dd', sup.email), h('dt', 'Amount'), h('dd', h('b', fmt.usdc(usdc))), h('dt', 'In pounds'), h('dd', fmt.gbp(gbp))))
      : h('div', { style: 'display:grid;gap:8px' },
        last && ['Refunded', 'Returned'].includes(last.status) ? cx.banner(`The last payout came back: ${last.reason}. Check ${sup.name}’s bank details before paying again.`, { tone: 'warning' }) : null,
        h('div.ac-quote', h('dt', 'Their bank'), h('dd', bank ? `${bank.bank} ·· ${bank.last4}${bank.sortCode ? ' · ' + bank.sortCode : ''}` : 'Saved bank account'), h('dt', 'Bank receives'), h('dd', h('b', fmt.gbp(owed))), h('dt', 'Bridge rate'), h('dd', `1 USDC = £${quote.quoteRate}`), h('dt', 'Bridge fee'), h('dd', fmt.usdc(quote.fee)), h('dt', 'The Safe sends'), h('dd', h('b', fmt.usdc(quote.sent))), h('dt', 'Quote'), h('dd', `valid until ${fmt.time(quote.expires)}`)));
  const whenBox = h('div.ac-choice',
    h('label', h('input', { type: 'radio', name: 'ac-pay-when', checked: true, onchange: () => { model.when = 'now'; } }), h('span.t', h('b', 'Now'), h('span', mode === 'bank' ? 'Faster Payments: usually in the bank within the hour' : 'Settles on Base in seconds'))),
    pi.dueDate > TODAY && mode !== 'bank' ? h('label', h('input', { type: 'radio', name: 'ac-pay-when', onchange: () => { model.when = 'due'; } }), h('span.t', h('b', `On the due date, ${fmt.date(pi.dueDate)}`), h('span', 'A scheduled payment: the budget reserves it now; you can cancel it until then'))) : null);
  const pays = h('div.ac-pays', list.flatMap((x) => [h('div.ln', h('b', `${x.name} · ${x.billNo}`), h('span', fmt.money(x.outstanding, x.currency))), ...x.items.map((it) => h('div.ln.ac-mini', h('span', `${it.idx} · ${it.description}`), h('span', fmt.money(it.amount, x.currency) + ((x.taxes || []).length ? ` + VAT ${fmt.money(it.amount * 0.2, x.currency)}` : ''))))]));
  const deptKey = () => model.from;
  const cmdFor = () => {
    const to = safe?.handle || sup.handle || sup.email;
    if (model.from === 'board') return `capxul payment send ${to} ${send} --org harbourline --as-directors --note "${list.map((x) => x.billNo).join(', ')}"`;
    if (mode === 'bank') return `capxul bank pay contact ${owed} --org harbourline --account ${bank?.id || 'bacc_' + sup.id} --from ${deptKey()}`;
    if (mode === 'escrow') return `capxul payment send ${sup.email} ${usdc} --org harbourline --from ${deptKey()}`;
    return `capxul org department pay ${deptKey()} --to ${to} --amount ${usdc}`;
  };
  const body = h('div', { style: 'display:grid;gap:14px' },
    h('div', { style: 'display:grid;gap:6px' }, h('b', 'Pay from'), fromBox),
    h('div', { style: 'display:grid;gap:6px' }, h('b', 'To'), toNode),
    h('div', { style: 'display:grid;gap:6px' }, h('b', 'When'), whenBox),
    h('div', { style: 'display:grid;gap:6px' }, h('b', 'What it pays'), pays, h('p.ac-note', 'These lines and their VAT are the payment advice. Its SHA-256 hash goes on chain with the payment, as its proof.')));
  const m = cx.modal({ title: `Pay ${sup.name}`, wide: true, body, actions: [
    { label: 'Cancel' },
    { label: 'Prepare and approve', primary: true, cmd: cmdFor(), onClick: async (close) => {
      const dept = model.from;
      if (dept !== 'board' && !cx.holds(dept)) { cx.toast(`Needs the ${cx.deptName(dept)} hat or one above it.`, { tone: 'warning' }); return; }
      const b = dept === 'board' ? null : quarterBudget(dept);
      if (b && b.left < send) { cx.toast(`${cx.deptName(dept)} has ${fmt.usdc(b.left)} left this quarter: not enough for ${fmt.usdc(send)}.`, { tone: 'warning' }); return; }
      close();
      const cmd = cmdFor();
      const me = cx.meId();
      const held = [dept, ...cx.ancestors(dept)].find((d) => cx.holders(d).includes(me));
      const hat = dept === 'board' ? 'Director' : cx.deptName(held || dept);
      const res = await cx.approval({
        title: `Pay ${sup.name}`,
        from: `Harbourline Treasury · ${fmt.addr(D.company.treasury)} · ${dept === 'board' ? 'by Board proposal' : cx.deptName(dept) + ' budget'}`,
        to: mode === 'safe' ? `${sup.name} · ${fmt.addr(safe?.safe || '')}` : mode === 'escrow' ? `Money waiting for ${sup.email}` : `${sup.name} · ${bank?.bank || 'bank'} ·· ${bank?.last4 || ''} through Bridge`,
        amount: send, asset: 'USDC', gbp, rate: RATE, hat,
        warnings: [mode === 'bank' ? `The bank receives ${fmt.gbp(owed)}; Bridge’s fee is ${fmt.usdc(quote.fee)}` : null, mode === 'escrow' ? 'They have no Capxul account: the money waits until they claim it' : null, model.when === 'due' ? `Scheduled for ${fmt.date(pi.dueDate)}` : null].filter(Boolean),
        signer: me, deadline: mode === 'bank' ? `Quote valid until ${fmt.time(quote.expires)}` : null,
        cmd, next: 'capxul payment wait approval_…',
        board: dept === 'board' ? { proposal: `sp_0${195 + (D.board?.proposals?.length || 0) % 10}`, nonce: (M.safes.treasury.nonce || 30) + 1, have: 0, need: 2, approvedBy: [] } : undefined,
      });
      if (res.status === 'declined') return;
      await settleBill({ list, sup, mode, dept, owed, gbp, usdc: send, quote, safe, bank, res, cmd, when: model.when, hat });
    } },
  ] });
  return m;
}
async function settleBill(o) {
  const { list, sup, mode, dept, owed, gbp, usdc, quote, safe, bank, res, cmd, when, hat } = o;
  const me = cx.meId();
  const at = res.at || NOW();
  const id = o.reuse?.id || cx.newId('payment');
  const raw = String(Math.round(usdc * 1e6));
  const addPay = (x) => { if (!M.payments.includes(x)) M.payments.push(x); payLen = -1; if (D.approvals?.waiting) D.approvals.waiting = D.approvals.waiting.filter((w) => w.ref?.id !== x.id || x.status === 'Prepared'); };
  const p = Object.assign(o.reuse || {}, { id, direction: 'out', kind: 'payment', status: 'Settled', outcome: null, purpose: 'supplier', route: mode === 'escrow' ? 'money-waiting' : dept === 'board' ? 'board' : 'department', budget: dept, counterparty: sup.name,
    payee: { type: 'Supplier', id: sup.id, name: sup.name, handle: safe?.handle || sup.handle || null, safe: safe?.safe || null, party: safe?.party || null, email: sup.email, bank: mode === 'bank' && bank ? { bankName: bank.bank, last4: bank.last4, sortCode: bank.sortCode } : null },
    payer: { type: 'Self', name: D.company.name, safe: D.company.treasury, label: 'Treasury' }, amount: usdc, asset: 'USDC', amountRaw: raw, gbp, rate: RATE, fee: quote?.fee || 0,
    createdAt: o.reuse?.createdAt || NOW(), sentAt: at, settledAt: at, approval: o.reuse?.approval || cx.newId('approval'), approvedBy: me, approvedHat: hat, preparedBy: o.reuse?.preparedBy || me, proposal: null, batch: null, memo: list.map((x) => x.billNo).join(', '), account: null, proof: null, books: null, waitingFor: null });
  if (res.status === 'approved') {
    p.status = 'Prepared'; p.waitingFor = { who: 'board', hat: 'Director' }; p.settledAt = null; p.proposal = 'sp_new';
    addPay(p); cx.refresh();
    cx.toast(`Proposed: ${res.remaining} more Director to approve before ${fmt.usdc(usdc)} leaves the Treasury`, { tone: 'info', cmd });
    return;
  }
  const payee = mode === 'escrow' ? { party: null, account: null, mailbox: sup.email } : mode === 'bank' ? { party: null, account: '0x' + 'b1d6e'.padEnd(40, '0').slice(0, 40), bank: `${bank?.bank} ·· ${bank?.last4}` } : { party: safe?.party || null, account: safe?.safe || null };
  if (when === 'due') {
    p.status = 'Scheduled'; p.settledAt = null; p.sentAt = null;
    addPay(p);
    const pi = list[0];
    M.scheduled.push({ day: pi.dueDate, to: sup.name, amount: usdc, asset: 'USDC', budget: dept, scheduledBy: me, proposal: null, what: `${pi.name} (${pi.billNo})`, status: 'Scheduled', reserved: true, payment: id });
    spendFromBudget(dept, usdc, 'committed');
    for (const x of list) (x.timelineExtra ||= []).push({ at: NOW(), who: me, kind: 'money', text: `scheduled ${fmt.usdc(usdc)} for ${fmt.date(pi.dueDate)} from ${cx.deptName(dept)}’s budget` });
    cx.refresh(); cx.toast(`Scheduled for ${fmt.date(pi.dueDate)}: ${fmt.usdc(usdc)} reserved in ${cx.deptName(dept)}’s budget`, { tone: 'success', cmd });
    return;
  }
  const advice = await adviceFor(p, list, mode === 'escrow' ? 'money-waiting' : 'department', dept, payee, gbp);
  p.proof = { network: 'Base', chainId: 8453, paymentId: cx.randHex(32), documentHash: await cx.hashOf(advice), tx: res.tx || cx.randHex(32), block: res.block || cx.blockAt(at), logIndex: 1 + Math.floor(Math.random() * 200),
    settledThrough: mode === 'escrow' ? 'Money waiting (escrow)' : `Budgets (${dept})`, finality: 'Final', advice };
  const t = M.safes.treasury; t.balance = r6(t.balance - usdc); t.gbp = r2(t.gbp - usdc * RATE); if (t.available != null) t.available = r2(t.available - usdc);
  if (dept !== 'board') spendFromBudget(dept, usdc);
  const date = TODAY;
  if (mode === 'safe') {
    const name = nextName(`ACC-PAY-${YEAR}-`);
    const booked = r2(sum(list, (x) => x.outstanding * (x.conversionRate || 1)));
    const credit = r2(usdc * RATE);
    const lines = [...list.map((x) => ({ account: '2000', debit: r2(x.outstanding * (x.conversionRate || 1)), party: sup.id, partyType: 'Supplier', againstType: 'Purchase Invoice', against: x.name })), { account: '1010', credit, accCredit: usdc }];
    if (!near0(booked - credit)) lines.push(booked > credit ? { account: '6510', credit: r2(booked - credit), costCenter: 'Main' } : { account: '6510', debit: r2(credit - booked), costCenter: 'Main' });
    postVoucher({ name, type: 'Payment Entry', entryType: null, paymentType: 'Pay', date, title: sup.name, total: credit, party: sup.id, partyType: 'Supplier', payment: id, closing: false, createdBy: 'capxul', createdAt: at }, lines);
    p.books = p.voucher = name;
    for (const x of list) { x.payments = [...(x.payments || []), { date, amount: x.outstanding, payment: id, voucher: name, channel: 'Capxul', at }]; x.paidAmount = r2((x.paidAmount || 0) + x.outstanding); x.outstanding = 0; x.modifiedAt = NOW(); }
    addPay(p); cx.refresh();
    cx.toast(`Paid ${sup.name} ${fmt.usdc(usdc)} · settled in block ${fmt.int(p.proof.block)}`, { tone: 'success', cmd, action: { label: 'Open the payment entry', onClick: () => cx.go('payment-entry', name) } });
  } else if (mode === 'escrow') {
    p.status = 'Money waiting'; p.escrow = cx.newId('escrow').replace('escrow_', 'escrow_');
    const jv = nextName(`ACC-JV-${YEAR}-`);
    postVoucher({ name: jv, type: 'Journal Entry', entryType: 'Contra Entry', paymentType: null, date, title: `Money waiting for ${sup.email}`, total: r2(usdc * RATE), party: null, partyType: null, payment: id, closing: false, createdBy: 'capxul', createdAt: at }, [{ account: '1030', debit: r2(usdc * RATE), accDebit: usdc }, { account: '1010', credit: r2(usdc * RATE), accCredit: usdc }]);
    p.fundingVoucher = jv;
    M.escrows.push({ id: p.escrow, payment: id, email: sup.email, amount: usdc, from: dept, sentBy: me, fundedAt: at, escrowAddress: cx.randHex(20), status: 'Open', claimedAt: null, takenBackAt: null, takenBackBy: null, reminders: [], what: `Purchase Invoice ${list[0].name}` });
    M.safes.moneyWaiting.balance = r2(M.safes.moneyWaiting.balance + usdc); M.safes.moneyWaiting.open = (M.safes.moneyWaiting.open || 0) + 1;
    for (const x of list) (x.timelineExtra ||= []).push({ at, who: me, kind: 'money', text: `sent ${fmt.usdc(usdc)} to money waiting for ${sup.email} to claim` });
    addPay(p); cx.refresh();
    cx.toast(`${fmt.usdc(usdc)} waits for ${sup.email} to claim. You can take it back until then.`, { tone: 'success', cmd });
  } else {
    const po = Object.assign(o.reusePayout || {}, { id: o.reusePayout?.id || cx.newId('bpo'), payment: id, to: sup.name, bankAmount: owed, currency: 'GBP', sent: usdc, net: quote.net, fee: quote.fee, quoteRate: quote.quoteRate, rail: 'Faster Payments', from: dept, status: 'In transit', reason: null,
      quotedAt: NOW(), quoteExpiresAt: quote.expires, sentAt: at, deliveredAt: null, returnedAt: null, refund: null, bridgeId: 'tr_' + cx.randHex(12).slice(2), purpose: 'supplier', payeeType: 'Supplier', bank: { bankName: bank?.bank, last4: bank?.last4, sortCode: bank?.sortCode } });
    p.payout = po.id; if (!M.payouts.includes(po)) M.payouts.push(po);
    const name = nextName(`ACC-PAY-${YEAR}-`);
    const credit = r2(usdc * RATE); const feeGbp = r2(quote.fee * RATE); const diff = r2(credit - owed - feeGbp);
    const lines = [{ account: '1040', debit: owed }, { account: '6500', debit: feeGbp, costCenter: 'Main' }, { account: '1010', credit, accCredit: usdc }];
    if (!near0(diff)) lines.push(diff > 0 ? { account: '6510', debit: diff } : { account: '6510', credit: -diff });
    postVoucher({ name, type: 'Payment Entry', entryType: null, paymentType: 'Internal Transfer', date, title: `Bank payout to ${sup.name}`, total: credit, party: null, partyType: null, payment: id, closing: false, createdBy: 'capxul', createdAt: at }, lines);
    p.books = p.voucher = name;
    addPay(p); cx.refresh();
    cx.toast(`${fmt.usdc(usdc)} left the Treasury: ${fmt.gbp(owed)} is on its way to ${bank?.bank} ·· ${bank?.last4}`, { tone: 'success', cmd, action: { label: 'Open the transfer', onClick: () => cx.go('payment-entry', name) } });
    setTimeout(() => deliverPayout(po, list, sup), 7000);
  }
}
/** Bridge says the bank has it: the second entry, from Payouts in transit to the supplier, and the bill turns Paid. */
function deliverPayout(po, list, sup) {
  if (po.status !== 'In transit') return;
  po.status = 'Delivered'; po.deliveredAt = NOW();
  const name = nextName(`ACC-PAY-${YEAR}-`);
  postVoucher({ name, type: 'Payment Entry', entryType: null, paymentType: 'Pay', date: TODAY, title: sup.name, total: po.bankAmount, party: sup.id, partyType: 'Supplier', payment: po.payment, closing: false, createdBy: 'capxul', createdAt: NOW() },
    [...list.map((x) => ({ account: '2000', debit: r2(x.outstanding), party: sup.id, partyType: 'Supplier', againstType: 'Purchase Invoice', against: x.name })), { account: '1040', credit: po.bankAmount }]);
  for (const x of list) { x.payments = [...(x.payments || []), { date: TODAY, amount: x.outstanding, payment: po.payment, voucher: name, channel: 'Bridge payout', at: NOW() }]; x.paidAmount = r2((x.paidAmount || 0) + x.outstanding); x.outstanding = 0; }
  cx.refresh();
  cx.toast(`Bridge delivered ${fmt.gbp(po.bankAmount)} to ${po.bank?.bankName} ·· ${po.bank?.last4}. ${list.map((x) => x.name).join(', ')} is paid.`, { tone: 'success', cmd: `capxul payment get ${po.payment}`, action: { label: 'Open', onClick: () => cx.go('payment-entry', name) } });
}
async function approvePrepared(p, pi) {
  const po = payoutOf(p); const sup = SUPP.get(pi.supplier);
  const cmd = `capxul bank pay contact ${po?.bankAmount ?? p.gbp} --org harbourline --account ${supplierBank(sup)?.id || 'bacc_' + sup.id} --from ${p.budget}`;
  const res = await cx.approval({ title: `Pay ${p.counterparty}`, from: `Harbourline Treasury · ${fmt.addr(D.company.treasury)} · ${cx.deptName(p.budget)} budget`, to: `${p.counterparty} · ${po?.bank?.bankName} ·· ${po?.bank?.last4} through Bridge`,
    amount: p.amount, asset: 'USDC', gbp: p.gbp, rate: p.rate, signer: p.waitingFor?.who || p.preparedBy, hat: p.waitingFor?.hat, deadline: po?.quoteExpiresAt ? `Quote valid until ${fmt.time(po.quoteExpiresAt)}` : null, warnings: po ? [`The bank receives ${fmt.gbp(po.bankAmount)}; Bridge’s fee is ${fmt.usdc(po.fee)}`] : [], cmd, next: `capxul payment wait ${p.approval || 'approval_…'}` });
  if (res.status !== 'done') return;
  await settleBill({ reuse: p, reusePayout: po, list: [pi], sup, mode: 'bank', dept: p.budget, owed: po?.bankAmount ?? pi.outstanding, gbp: p.gbp, usdc: p.amount, quote: { quoteRate: po?.quoteRate || RATE, net: po?.net || p.amount, fee: po?.fee || 0, sent: p.amount, expires: po?.quoteExpiresAt }, safe: null, bank: supplierBank(sup), res, cmd, when: 'now', hat: p.waitingFor?.hat });
}
async function takeBack(p, pi) {
  const esc = escrowOf(p);
  const cmd = `capxul payment cancel ${p.id}`;
  if (!(await cx.confirm({ title: `Take back ${fmt.usdc(p.amount)} from money waiting?`, body: `${esc?.email || p.counterparty} has not claimed it yet. It goes back to ${cx.deptName(p.budget)}’s budget and ${pi.name} is unpaid again.`, cmd, who: `whoever wears the ${cx.deptName(p.budget)} hat, or one above it`, confirmLabel: 'Take it back', danger: true }))) return;
  const res = await cx.approval({ title: `Take back ${fmt.usdc(p.amount)}`, from: `Escrow ${fmt.addr(esc?.escrowAddress || '')}`, to: `Harbourline Treasury · ${cx.deptName(p.budget)} budget`, amount: p.amount, asset: 'USDC', gbp: r2(p.amount * RATE), rate: RATE, signer: cx.meId(), hat: cx.deptName(p.budget), cmd });
  if (res.status !== 'done') return;
  p.status = 'Cancelled'; if (esc) { esc.status = 'Taken back'; esc.takenBackAt = res.at; esc.takenBackBy = cx.meId(); }
  const jv = nextName(`ACC-JV-${YEAR}-`);
  postVoucher({ name: jv, type: 'Journal Entry', entryType: 'Contra Entry', paymentType: null, date: TODAY, title: `Money taken back from ${esc?.email || p.counterparty}`, total: r2(p.amount * RATE), party: null, partyType: null, payment: p.id, closing: false, createdBy: 'capxul', createdAt: res.at }, [{ account: '1010', debit: r2(p.amount * RATE), accDebit: p.amount }, { account: '1030', credit: r2(p.amount * RATE), accCredit: p.amount }]);
  M.safes.moneyWaiting.balance = r2(M.safes.moneyWaiting.balance - p.amount); M.safes.moneyWaiting.open = Math.max(0, (M.safes.moneyWaiting.open || 1) - 1);
  M.safes.treasury.balance = r6(M.safes.treasury.balance + p.amount);
  spendFromBudget(p.budget, -p.amount);
  (pi.timelineExtra ||= []).push({ at: res.at, who: cx.meId(), kind: 'money', text: `took back ${fmt.usdc(p.amount)} from money waiting` });
  payLen = -1; cx.refresh(); cx.toast(`Taken back: ${fmt.usdc(p.amount)} is in the Treasury again`, { tone: 'success', cmd });
}
function recordPiPayment(pi) {
  const cr = pi.conversionRate || 1;
  const model = { date: TODAY, amount: r2(pi.outstanding * cr), reference: pi.billNo, refDate: TODAY };
  cx.modal({ title: `Record payment: ${pi.name}`, wide: true, body: h('div', { style: 'display:grid;gap:12px' },
    cx.banner(`${pi.supplierName} is paid from the Barclays account, outside Capxul. Record what left the bank; the statement line reconciles against it.`, { tone: 'info' }),
    h('div.ac-form-grid',
      cx.field({ label: 'Payment type', value: 'Pay' }), cx.field({ label: 'Posting date', key: 'date', model, edit: true, type: 'date', reqd: true }),
      cx.field({ label: 'Party', value: `Supplier · ${pi.supplierName}` }), cx.field({ label: 'Mode of payment', value: 'Bank transfer' }),
      cx.field({ label: 'Account paid from', value: accLabel('1050') }), cx.field({ label: 'Account paid to', value: accLabel('2000') }),
      cx.field({ label: 'Paid amount (GBP)', key: 'amount', model, edit: true, type: 'currency', reqd: true }), cx.field({ label: 'Allocated to', value: `${pi.name} · ${pi.billNo}` }),
      cx.field({ label: 'Payment reference', key: 'reference', model, edit: true }), cx.field({ label: 'Reference date', key: 'refDate', model, edit: true, type: 'date' }))),
    actions: [{ label: 'Cancel' }, { label: 'Post the payment entry', primary: true, needs: needBooks, cmd: [`capxul org doc create payment-entry --from purchase-invoice ${pi.name}`, 'capxul org doc submit payment-entry <name>'], onClick: (close) => {
      const gbp = r2(+model.amount); if (!(gbp > 0)) return;
      const name = nextName(`ACC-PAY-${YEAR}-`);
      const amt = r2(Math.min(pi.outstanding, gbp / cr));
      postVoucher({ name, type: 'Payment Entry', entryType: null, paymentType: 'Pay', date: model.date, title: pi.supplierName, total: gbp, party: pi.supplier, partyType: 'Supplier', payment: null, closing: false, reference: model.reference, refDate: model.refDate, createdBy: cx.meId(), createdAt: NOW() },
        [{ account: '2000', debit: gbp, party: pi.supplier, partyType: 'Supplier', againstType: 'Purchase Invoice', against: pi.name }, { account: '1050', credit: gbp }]);
      pi.payments = [...(pi.payments || []), { date: model.date, amount: amt, payment: null, voucher: name, channel: 'Barclays', at: NOW() }];
      pi.outstanding = r2(pi.outstanding - amt); pi.paidAmount = r2((pi.paidAmount || 0) + amt); pi.modifiedAt = NOW();
      close(); cx.refresh(); cx.toast(`Recorded ${fmt.gbp(gbp)} from Barclays as ${name}`, { tone: 'success', cmd: `capxul org doc submit payment-entry ${name}`, action: { label: 'Open', onClick: () => cx.go('payment-entry', name) } });
    } }] });
}
function holdBill(pi) {
  const model = { release: '', reason: '' };
  cx.modal({ title: `Hold ${pi.name}`, body: h('div', { style: 'display:grid;gap:12px' }, h('div.ac-form-grid', cx.field({ label: 'Release date', key: 'release', model, edit: true, type: 'date', help: 'Leave empty to hold it until someone releases it' }), cx.field({ label: 'Reason for putting on hold', key: 'reason', model, edit: true, type: 'textarea', reqd: true, wide: true }))),
    actions: [{ label: 'Cancel' }, { label: 'Hold the bill', primary: true, needs: needBooks, cmd: `capxul org doc change purchase-invoice ${pi.name} --input hold.json`, onClick: (close) => {
      if (!String(model.reason).trim()) { cx.toast('Give a reason.', { tone: 'warning' }); return; }
      pi.onHold = { release: model.release || null, reason: model.reason, by: cx.meId(), at: NOW() };
      (pi.timelineExtra ||= []).push({ at: NOW(), who: cx.meId(), kind: 'status', text: `put this bill on hold${model.release ? ' until ' + fmt.date(model.release) : ''}: ${model.reason}` });
      close(); cx.refresh(); cx.toast(`${pi.name} is on hold`, { cmd: `capxul org doc change purchase-invoice ${pi.name} --input hold.json` });
    } }] });
}

/* ---- the purchase invoice form ---- */

function piPage(pi) {
  const draft = pi.docstatus === 0;
  const st = pi.__new ? 'Not saved' : invStatus(pi);
  const flight = piFlight(pi);
  const sup = SUPP.get(pi.supplier);
  const mode = payModeOf(sup);
  const holders = pi.department ? cx.holders(pi.department).map(cx.name).join(', ') : '';
  const b = pi.department ? quarterBudget(pi.department) : null;
  const totalsBox = h('div', { style: 'min-width:0' });
  const taxBox = h('div', { style: 'min-width:0;display:grid;gap:12px' });
  const draw = () => {
    cx.fill(totalsBox, cx.section({ cols: 3, fields: [{ label: 'Total quantity', value: sum(pi.items, 'qty'), type: 'float', dp: 1 }, { label: `Total (${pi.currency})`, value: pi.netTotal, type: 'currency', currency: pi.currency }, { label: `Net total (${pi.currency})`, value: pi.netTotal, type: 'currency', currency: pi.currency }] }, { doc: pi }));
    cx.fill(taxBox, cx.grid({ columns: [{ key: 'type', label: 'Type', get: () => 'On Net Total' }, { key: 'account', label: 'Tax account', render: (r) => accLabel(r.account) }, { key: 'rate', label: 'Tax rate', type: 'percent' }, { key: 'taxAmount', label: 'Amount', type: 'currency', currency: pi.currency }, { key: 'addDeduct', label: 'Add or deduct', get: () => 'Add', opt: true }], rows: pi.taxes || [], empty: pi.currency === 'GBP' ? 'No VAT on this bill' : 'No UK VAT: a supplier outside the UK' }),
      cx.section({ cols: 3, fields: [{ label: `Taxes and charges added (${pi.currency})`, value: pi.totalTaxes, type: 'currency', currency: pi.currency }, { label: `Taxes and charges deducted (${pi.currency})`, value: 0, type: 'currency', currency: pi.currency }, { label: `Total taxes and charges (${pi.currency})`, value: pi.totalTaxes, type: 'currency', currency: pi.currency }] }, { doc: pi }),
      cx.section({ label: 'Totals', columns: [[{ label: 'Grand total', render: () => h('b', { style: 'font-size:15px' }, fmt.money(pi.grandTotal, pi.currency)) }, { label: 'In words', value: inWords(pi.grandTotal, pi.currency) }], [{ label: 'Rounding adjustment', value: 0, type: 'currency', currency: pi.currency }, { label: 'Rounded total', value: pi.grandTotal, type: 'currency', currency: pi.currency }]] }, { doc: pi }));
  };
  draw();
  const onItems = () => { piRecompute(pi); draw(); };
  const deptOptions = D.departments.map((d) => [d.id, d.name]);
  const pays = (pi.payments || []).map((p) => ({ ...p, via: viaOf(p.channel) }));
  const form = cx.formView({
    doc: pi, editable: draft, tabKey: 'ac-pinv',
    onChange: (doc, key) => { if (key === 'supplier') { doc.items = []; supplierDefaults(doc, doc.supplier); piRecompute(doc); cx.refresh(); } else if (key === 'department') { doc.costCenter = B.costCenters.find((c) => c.department === doc.department)?.name || 'Main'; cx.refresh(); } },
    tabs: lockValues([
      { label: 'Details', sections: [
        { columns: [[
          { label: 'Series', value: pi.isReturn ? 'ACC-PINV-RET-.YYYY.-' : 'ACC-PINV-.YYYY.-', reqd: true },
          draft ? { label: 'Supplier', key: 'supplier', type: 'select', reqd: true, options: B.suppliers.map((s) => [s.id, s.name]) } : { label: 'Supplier', value: pi.supplierName, reqd: true },
          { label: 'Supplier name', value: pi.supplierName },
          { label: 'Tax ID', value: sup?.vat || '—' },
          draft ? { label: 'Department', key: 'department', type: 'select', reqd: true, options: deptOptions, help: 'Whose budget pays this bill' } : { label: 'Department', render: () => h('span', cx.hasRoute('department') ? cx.link(cx.deptName(pi.department), 'department', pi.department) : cx.deptName(pi.department), h('span.ac-mini', ` · ${holders} wears the hat`)), help: b ? `${fmt.usdc(b.left)} left of ${fmt.usdc(b.amount)} in ${b.quarter}` : null },
        ], [
          { label: 'Posting date', key: 'postingDate', type: 'date', reqd: true },
          { label: 'Posting time', value: '11:20' },
          { label: 'Due date', key: 'dueDate', type: 'date', reqd: true },
        ], [
          { label: 'Is paid', value: 0, type: 'check' },
          { label: 'Is return (debit note)', value: pi.isReturn ? 1 : 0, type: 'check' },
          pi.amendedFrom ? { label: 'Amends', value: pi.amendedFrom, type: 'link', href: ['purchase-invoice', pi.amendedFrom] } : null,
          pi.isOpening ? { label: 'Is opening entry', value: 1, type: 'check', help: 'Brought over from the old books' } : null,
        ].filter(Boolean)] },
        { label: 'Supplier invoice', collapsible: true, collapsed: false, columns: [[{ label: 'Supplier invoice no', key: 'billNo', reqd: true }], [{ label: 'Supplier invoice date', key: 'billDate', type: 'date' }]] },
        { label: 'Accounting dimensions', collapsible: true, collapsed: false, columns: [[{ label: 'Cost centre', value: pi.costCenter, type: 'link', href: ['cost-centres'] }], [{ label: 'Project', render: () => projectLink(pi.project) }]] },
        { label: 'Currency and price list', collapsible: true, collapsed: true, columns: [[{ label: 'Currency', value: pi.currency, reqd: true }, { label: 'Exchange rate', value: pi.conversionRate, type: 'float', dp: 4 }, { label: 'Use transaction date exchange rate', value: 1, type: 'check' }], [{ label: 'Price list', value: 'Standard Buying' }, { label: 'Price list currency', value: pi.currency }]] },
        { label: 'Items', table: cx.grid({ columns: [
          { key: 'item', label: 'Item', edit: true, width: '150px' }, { key: 'description', label: 'Description', edit: true },
          { key: 'qty', label: 'Accepted qty', type: 'float', dp: 1, edit: true, width: '90px' }, { key: 'rate', label: 'Rate', type: 'currency', currency: pi.currency, edit: true, width: '110px' },
          { key: 'expenseAccount', label: 'Expense account', edit: true, type: 'select', options: PI_ITEMS.map((x) => x[0]), opt: true, render: draft ? null : (r) => accLabel(r.expenseAccount) },
          { key: 'amount', label: 'Amount', type: 'currency', currency: pi.currency, get: (r) => r2((+r.qty || 0) * (+r.rate || 0)) },
        ], rows: pi.items, editable: draft, totals: ['amount'], rowForm: [{ key: 'item', label: 'Item' }, { key: 'description', label: 'Description', type: 'textarea' }, { key: 'qty', label: 'Accepted qty', type: 'float' }, { key: 'uom', label: 'UOM' }, { key: 'rate', label: 'Rate', type: 'currency', currency: pi.currency }, { key: 'expenseAccount', label: 'Expense account', render: (r) => accLabel(r.expenseAccount) }, { key: 'project', label: 'Project' }], title: 'Item', onChange: onItems, empty: 'No lines yet' }) },
        { node: totalsBox },
        { label: 'Taxes and charges', node: taxBox },
        pi.currency !== 'GBP' ? { label: 'Totals (company currency)', columns: [[{ label: 'Grand total (GBP)', value: pi.baseGrandTotal, type: 'currency', currency: 'GBP' }], [{ label: 'In words (GBP)', value: inWords(pi.baseGrandTotal, 'GBP') }]] } : null,
        { cols: 2, fields: [{ label: 'Total advance', value: 0, type: 'currency', currency: pi.currency }, { label: 'Outstanding amount', render: () => h('b', fmt.money(pi.outstanding, pi.currency)) }] },
        flight ? { label: 'The payment in flight', node: flightNode(flight, pi) } : null,
        { label: 'Additional discount', collapsible: true, collapsed: true, columns: [[{ label: 'Apply additional discount on', value: 'Grand Total' }], [{ label: 'Additional discount amount', value: 0, type: 'currency', currency: pi.currency }]] },
        !draft && pi.outstanding > 0.005 ? { label: 'How Capxul pays it', desc: mode === 'safe' ? `${pi.supplierName} is on Capxul: USDC goes straight to their Safe.` : mode === 'escrow' ? `${pi.supplierName} has no Capxul account: the money waits for ${sup?.email} to claim it.` : mode === 'bank' ? `${pi.supplierName} takes pounds: Bridge turns USDC into a Faster Payment to their ${supplierBank(sup)?.bank || 'bank'} account.` : `${pi.supplierName} is paid from the Barclays account, outside Capxul.`, fields: [{ label: 'Pays from', value: `${cx.deptName(pi.department)}’s budget` }, { label: 'Route', value: { safe: 'Safe to Safe (USDC)', escrow: 'Money waiting (escrow)', bank: 'Bank through Bridge (GBP)', outside: 'Barclays (record the payment)' }[mode] }] } : null,
      ].filter(Boolean) },
      { label: 'Payments', count: pays.length || null, render: () => h('div', { style: 'padding:16px;display:grid;gap:14px' },
        cx.section({ cols: 3, fields: [{ label: 'Mode of payment', value: pays.length ? [...new Set(pays.map((p) => ({ Capxul: 'Capxul', Bridge: 'Bridge', Bank: 'Bank transfer' }[p.via] || p.via)))].join(', ') : '—' }, { label: 'Paid amount (company currency)', value: r2(sum(pays, 'amount') * (pi.conversionRate || 1)), type: 'currency', currency: 'GBP' }, { label: 'Outstanding amount', value: pi.outstanding, type: 'currency', currency: pi.currency }] }, { doc: pi }),
        cx.section({ label: 'Payments made', node: h('div', { style: 'display:grid;gap:12px;min-width:0' }, cx.grid({ columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'via', label: 'Paid by', render: (r) => viaTag(r.via) }, { key: 'voucher', label: 'Payment entry', render: (r) => vLink(r.voucher) }, { key: 'amount', label: 'Allocated', type: 'currency', currency: pi.currency }], rows: pays, totals: ['amount'], empty: 'No payments yet' }),
          ...[...new Set(pays.filter((p) => p.payment).map((p) => p.payment))].map(payById).filter(Boolean).map((p) => cx.proof(p, { booked: p.voucher || p.books }))) })) },
      { label: 'Address and contact', sections: [
        { label: 'Supplier address', columns: [[{ label: 'Supplier address', value: sup ? `${sup.name}, ${sup.country}` : '—' }, { label: 'Supplier group', value: sup?.group || '—' }], [{ label: 'Contact email', value: sup?.email || '—' }, { label: 'Pays by', value: { usdc: 'USDC', payout: 'Bank (GBP)', barclays: 'Barclays', card: 'Company card' }[sup?.pay] || '—' }]] },
        { label: 'Company billing address', fields: [{ label: 'Company billing address', value: `${D.company.name}, ${D.company.address}` }] },
      ] },
      { label: 'Terms', sections: [
        { label: 'Payment terms', table: cx.grid({ columns: [{ key: 'term', label: 'Payment term' }, { key: 'dueDate', label: 'Due date', type: 'date' }, { key: 'portion', label: 'Invoice portion', type: 'percent' }, { key: 'amount', label: 'Payment amount', type: 'currency' }, { key: 'outstanding', label: 'Outstanding', type: 'currency' }], rows: scheduleOf({ ...pi, paymentTerms: `Net ${daysBetween(pi.billDate || pi.postingDate, pi.dueDate)}` }) }) },
      ] },
      { label: 'More info', sections: [
        { label: 'Accounting details', columns: [[{ label: 'Credit to', value: accLabel(pi.creditTo || '2000'), type: 'link', href: ['account', pi.creditTo || '2000'], reqd: true }], [{ label: 'Is opening entry', value: pi.isOpening ? 1 : 0, type: 'check' }]] },
        { label: 'Hold invoice', columns: [[{ label: 'Hold invoice', value: pi.onHold ? 1 : 0, type: 'check' }, { label: 'Release date', value: pi.onHold?.release || null, type: 'date' }], [{ label: 'Reason for putting on hold', value: pi.onHold?.reason || null }]] },
        { label: 'Additional info', columns: [[{ label: 'Status', value: st, type: 'status' }, { label: 'Title', value: pi.supplierName }, { label: 'Remarks', key: 'remarks', type: 'textarea' }], [{ label: 'Supplier group', value: sup?.group || '—' }, pi.contentHash ? { label: 'Content hash', value: pi.contentHash, type: 'hash', help: 'SHA-256 of the bill’s lines and tax: what a payment’s proof commits to.' } : null].filter(Boolean)] },
      ] },
    ]),
    connections: draft ? null : [
      { group: 'Payment', items: [{ label: 'Payment entry', count: new Set((pi.payments || []).map((p) => p.voucher).filter(Boolean)).size, route: 'payment-entries' }, { label: 'Payment', count: paymentsForPi(pi).length, route: cx.hasRoute('payment') && paymentsForPi(pi)[0] ? 'payment' : null, id: paymentsForPi(pi)[0]?.id }, { label: 'Journal entry', count: 0 }] },
      { group: 'Reference', items: [{ label: 'Project', count: pi.project ? 1 : 0, route: pi.project && cx.hasRoute('project') ? 'project' : null, id: pi.project }, { label: 'Department', count: pi.department ? 1 : 0, route: cx.hasRoute('department') ? 'department' : null, id: pi.department }] },
      { group: 'Returns', items: [{ label: 'Purchase invoice', count: B.purchaseInvoices.filter((x) => x.returnAgainst === pi.name).length }] },
    ],
    side: sideFor(pi, 'purchase-invoice', pi.supplierName),
    timeline: { items: pi.__new ? [{ at: pi.createdAt, who: pi.createdBy, kind: 'created', text: 'created this' }] : timelineFor(pi, 'pi'), comment: true },
  });

  const get = `capxul org doc get purchase-invoice ${pi.name}`;
  const more = cx.menu(null, [
    { label: 'Print', icon: 'file', cmd: `capxul org doc render purchase-invoice ${pi.name}`, onClick: () => noDownload(`capxul org doc render purchase-invoice ${pi.name}`) },
    { label: 'Duplicate', icon: 'plus', needs: needBooks, cmd: `capxul org doc create purchase-invoice --from purchase-invoice ${pi.name}`, onClick: () => { const c = JSON.parse(JSON.stringify(pi)); for (const k of ['docstatus', 'payments', 'timelineExtra', 'contentHash', 'submittedAt', 'amendedFrom', 'cancelledAt', 'onHold']) delete c[k]; c.payments = []; c.billNo = ''; newPurchaseInvoice(c); } },
  ]);
  let actions;
  const payNeed = pi.department ? { dept: pi.department } : null;
  if (pi.__new) actions = [cx.btn('Save', { kind: 'primary', needs: needBooks, cmd: 'capxul org doc create purchase-invoice --input bill.json', onClick: () => savePurchaseInvoice(pi) })];
  else if (draft) actions = [more, cx.menu('Preview', [{ label: 'Ledger preview', icon: 'report', onClick: () => { piRecompute(pi); ledgerPreview(pi.name, piGlLines(pi)); } }]), cx.btn('Post', { kind: 'primary', icon: 'check', needs: needBooks, cmd: `capxul org doc submit purchase-invoice ${pi.name}`, onClick: () => postPurchaseInvoice(pi) })];
  else if (pi.docstatus === 2) actions = [more, cx.btn('Amend', { kind: 'primary', needs: needBooks, cmd: `capxul org doc amend purchase-invoice ${pi.name}`, onClick: () => { const c = JSON.parse(JSON.stringify(pi)); for (const k of ['docstatus', 'payments', 'timelineExtra', 'contentHash', 'submittedAt', 'cancelledAt']) delete c[k]; c.amendedFrom = pi.name; c.payments = []; newPurchaseInvoice(c); } })];
  else {
    const proofPays = [...new Set((pi.payments || []).filter((p) => p.payment).map((p) => p.payment))].map(payById).filter((p) => p?.proof);
    const view = cx.menu('View', [
      { label: 'Ledger', icon: 'report', cmd: `capxul org report run general-ledger --filter voucher_no=${pi.name}`, onClick: () => cx.go('general-ledger', null, { report: { voucher: pi.name, from: pi.postingDate, to: TODAY, account: '', party: '' } }) },
      { label: 'Proof', icon: 'shield', disabled: !proofPays.length && !(flight?.payment?.proof), reason: 'No payment with a proof on chain yet', cmd: (proofPays[0] || flight?.payment) ? `capxul payment get ${(proofPays[0] || flight.payment).id}` : null, onClick: () => cx.panel.open({ title: `Proof: ${pi.name}`, sub: 'What the payment committed to on chain', wide: true, body: h('div', { style: 'display:grid;gap:12px;padding:4px' }, (proofPays.length ? proofPays : [flight.payment]).map((p) => cx.proof(p))) }) },
      { label: 'Accounts payable', icon: 'report', href: ['accounts-payable'] },
    ]);
    const open = pi.outstanding > 0.005;
    const createMenu = cx.menu('Create', [
      open && mode !== 'outside' ? { label: 'Record payment', icon: 'bank', needs: needBooks, sub: 'Paid from Barclays, outside Capxul', cmd: `capxul org doc create payment-entry --from purchase-invoice ${pi.name}`, onClick: () => recordPiPayment(pi) } : null,
      { label: 'Debit note', icon: 'file', needs: needBooks, cmd: `capxul org doc create purchase-invoice --from purchase-invoice ${pi.name} --input return.json`, onClick: () => { const c = JSON.parse(JSON.stringify(pi)); for (const k of ['docstatus', 'payments', 'timelineExtra', 'contentHash', 'submittedAt', 'onHold']) delete c[k]; Object.assign(c, { isReturn: true, returnAgainst: pi.name, payments: [], billNo: `${pi.billNo}-CN`, items: c.items.map((it) => ({ ...it, qty: -Math.abs(it.qty) })) }); newPurchaseInvoice(c); } },
    ]);
    const primary = [];
    if (open && !pi.onHold) {
      const fp = flight?.payment;
      if (fp?.status === 'Prepared' && fp.waitingFor?.who !== 'board') primary.push(cx.btn('Approve payment', { kind: 'primary', icon: 'passkey', needs: (me) => me.id === (fp.waitingFor?.who || fp.preparedBy) || `Only ${cx.name(fp.waitingFor?.who || fp.preparedBy)} can approve this, from their own Safe.`, cmd: `capxul bank pay contact ${payoutOf(fp)?.bankAmount ?? fp.gbp} --org harbourline --from ${fp.budget}`, onClick: () => approvePrepared(fp, pi) }));
      else if (fp?.status === 'Money waiting') primary.push(cx.btn('Take back', { icon: 'refresh', needs: { dept: fp.budget }, cmd: `capxul payment cancel ${fp.id}`, onClick: () => takeBack(fp, pi) }), cx.btn('Pay', { kind: 'primary', icon: 'send', disabled: true, reason: 'The money already waits for them to claim' }));
      else if (flight && (flight.payout?.status === 'In transit' || flight.sched)) primary.push(cx.btn('Pay', { kind: 'primary', icon: 'send', disabled: true, reason: flight.sched ? `Already scheduled for ${fmt.date(flight.sched.day)}` : 'A payment is already on its way' }));
      else if (mode === 'outside') primary.push(cx.btn('Record payment', { kind: 'primary', icon: 'bank', needs: needBooks, cmd: `capxul org doc create payment-entry --from purchase-invoice ${pi.name}`, onClick: () => recordPiPayment(pi) }));
      else primary.push(cx.btn('Pay', { kind: 'primary', icon: 'send', needs: payNeed, cmd: mode === 'bank' ? `capxul bank pay contact ${pi.outstanding} --org harbourline --account ${supplierBank(sup)?.id || 'bacc_' + sup?.id} --from ${pi.department}` : mode === 'escrow' ? `capxul payment send ${sup?.email} ${pi.currency === 'GBP' ? r2(pi.outstanding / RATE) : pi.outstanding} --org harbourline --from ${pi.department}` : `capxul org department pay ${pi.department} --to ${supplierSafe(sup?.id)?.handle || sup?.handle} --amount ${pi.currency === 'GBP' ? r2(pi.outstanding / RATE) : pi.outstanding}`, onClick: () => payBill([pi]) }));
    }
    const hold = open ? (pi.onHold ? cx.btn('Release', { needs: needBooks, cmd: `capxul org doc change purchase-invoice ${pi.name} --input release.json`, onClick: () => { pi.onHold = null; (pi.timelineExtra ||= []).push({ at: NOW(), who: cx.meId(), kind: 'status', text: 'released the hold' }); cx.refresh(); cx.toast(`${pi.name} is released`, { cmd: `capxul org doc change purchase-invoice ${pi.name} --input release.json` }); } }) : cx.btn('Hold', { needs: needBooks, cmd: `capxul org doc change purchase-invoice ${pi.name} --input hold.json`, onClick: () => holdBill(pi) })) : null;
    actions = [more, view, createMenu, hold, cx.btn('Cancel', { needs: needBooks, cmd: `capxul org doc cancel purchase-invoice ${pi.name}`, onClick: () => cancelDoc(pi, 'purchase-invoice', `${pi.supplierName} · ${pi.billNo} · ${fmt.money(pi.grandTotal, pi.currency)}`) }), ...primary].filter(Boolean);
  }
  const fp = flight?.payment;
  const draftCard = fp?.status === 'Prepared' && fp.waitingFor?.who !== 'board' ? cx.draft({ for: fp.waitingFor?.who || fp.preparedBy, by: fp.preparedBy, at: fp.createdAt, title: `Pay ${fp.counterparty} ${fmt.gbp(payoutOf(fp)?.bankAmount ?? fp.gbp)} by bank`, why: `${pi.billNo}, due ${fmt.date(pi.dueDate)}. Bridge quoted ${fmt.usdc(fp.amount)} from the Treasury, fee ${fmt.usdc(fp.fee)}; the quote holds until ${fmt.time(payoutOf(fp)?.quoteExpiresAt)}.`, steps: [`From ${cx.deptName(fp.budget)}’s budget`, `To ${payoutOf(fp)?.bank?.bankName} ·· ${payoutOf(fp)?.bank?.last4}`, 'Approve with your passkey'], cmd: `capxul bank pay contact ${payoutOf(fp)?.bankAmount ?? fp.gbp} --org harbourline --from ${fp.budget}`, runLabel: 'Approve', onRun: () => approvePrepared(fp, pi) }) : null;
  return cx.page({
    title: pi.__new ? 'New purchase invoice' : pi.supplierName,
    crumbs: crumbs({ label: 'Purchase invoices', route: 'purchase-invoices' }),
    status: pi.__new ? [cx.pill('Not saved', 'orange', { lg: true })] : pills(st, flight, true),
    sub: pi.__new ? 'Not saved' : `${pi.name} · ${pi.billNo} · ${fmt.date(pi.postingDate)} · ${fmt.money(pi.grandTotal, pi.currency)}${pi.department ? ` · ${cx.deptName(pi.department)}` : ''}`,
    cmd: { cli: pi.__new ? 'capxul org doc create purchase-invoice --input bill.json' : get, sdk: pi.__new ? 'client.org(orgId).docs.create("purchase-invoice", bill)' : `client.org(orgId).docs.get("purchase-invoice", "${pi.name}")`, kind: 'family', who: 'anyone with a seat reads it; the Books hat posts it; the department’s hat pays it',
      json: pi.__new ? undefined : { name: pi.name, supplier: pi.supplierName, bill_no: pi.billNo, status: st, currency: pi.currency, grand_total: pi.grandTotal, outstanding_amount: pi.outstanding, due_date: pi.dueDate, cost_center: pi.costCenter } },
    banner: draftCard || (draft && !pi.__new ? cx.banner('Post this bill to make it final.', { tone: 'info' }) : pi.docstatus === 2 ? cx.banner('This bill is cancelled. Amend it to make a corrected copy.', { tone: 'warning' }) : pi.onHold ? cx.banner(`On hold${pi.onHold.release ? ' until ' + fmt.date(pi.onHold.release) : ''}: ${pi.onHold.reason}`, { tone: 'warning' }) : null),
    fde: `Purchase invoice ${pi.name} from ${pi.supplierName}, ${fmt.money(pi.grandTotal, pi.currency)}, ${st}`,
    actions,
    body: form,
  });
}
cx.route('purchase-invoice', (ctx) => {
  const pi = cx.find(B.purchaseInvoices, 'name', ctx.id);
  if (!pi) return cx.page({ title: 'Not found', crumbs: crumbs({ label: 'Purchase invoices', route: 'purchase-invoices' }), body: cx.empty('No such purchase invoice') });
  return piPage(pi);
}, { workspace: 'books', title: 'Purchase invoice' });

/* =====================================================================================================
   Payment entries
   ===================================================================================================== */

const peCache = new WeakMap();
const isBankLine = (l) => BANK_CODES.has(l.account);
const isDeduction = (l) => l.account === '6500' || l.account === '6510';
function peInfo(v) {
  if (peCache.has(v) && peCache.get(v).n === linesOf(v.name).length) return peCache.get(v);
  const lines = linesOf(v.name).filter((l) => !l.isCancelled);
  const p = payById(v.payment);
  const po = payoutOf(p), dep = depositOf(p), esc = escrowOf(p);
  const via = !p ? 'Bank' : (dep || po || p.route === 'outside') ? 'Bridge' : 'Capxul';
  let from, to;
  if (v.paymentType === 'Receive') { to = lines.find((l) => isBankLine(l) && l.debit > 0); from = lines.find((l) => !isBankLine(l) && l.credit > 0 && !isDeduction(l)) || lines.find((l) => l.credit > 0 && l !== to); }
  else if (v.paymentType === 'Pay') { from = lines.find((l) => isBankLine(l) && l.credit > 0); to = lines.find((l) => !isBankLine(l) && l.debit > 0 && !isDeduction(l)) || lines.find((l) => l.debit > 0 && l !== from); }
  else { from = lines.find((l) => isBankLine(l) && l.credit > 0); to = lines.find((l) => isBankLine(l) && l.debit > 0); }
  const refs = lines.filter((l) => l.against && l.againstType && l.against !== v.name);
  const deductions = lines.filter((l) => isDeduction(l) && l !== from && l !== to);
  const party = v.party || refs[0]?.party || null;
  const partyType = v.partyType || refs[0]?.partyType || null;
  const fromCur = acc(from?.account)?.currency || 'GBP', toCur = acc(to?.account)?.currency || 'GBP';
  const paidAcc = from ? (fromCur === 'USDC' ? from.accCredit : from.credit) : v.total;
  const recvAcc = to ? (toCur === 'USDC' ? to.accDebit : to.debit) : v.total;
  const allocated = r2(sum(refs, (l) => l.debit || l.credit));
  const partyAmt = v.paymentType === 'Receive' ? (from?.credit || 0) : v.paymentType === 'Pay' ? (to?.debit || 0) : 0;
  const bt = B.bankTransactions.find((t) => t.voucher === v.name);
  const info = { n: linesOf(v.name).length, lines, p, po, dep, esc, via, from, to, refs, deductions, party, partyType, fromCur, toCur, paidAcc, recvAcc, paidGbp: from?.credit ?? v.total, recvGbp: to?.debit ?? v.total, allocated, unallocated: v.paymentType === 'Internal Transfer' ? 0 : r2(Math.max(0, partyAmt - allocated)), bt,
    clearance: p ? (p.settledAt || '').slice(0, 10) || v.date : bt?.status === 'Reconciled' ? bt.date : null };
  peCache.set(v, info);
  return info;
}
const peStatus = (v) => (v.docstatus === 0 ? 'Draft' : v.cancelled ? 'Cancelled' : 'Submitted');
function peFlight(v, i) {
  if (i.po && ['In transit', 'Quoted'].includes(i.po.status)) return { text: `Payout ${i.po.status.toLowerCase()}`, tone: 'info' };
  if (i.po && ['Refunded', 'Returned'].includes(i.po.status)) return { text: 'Payout returned', tone: 'warning' };
  if (i.esc && i.esc.status === 'Open') return { text: 'Money waiting', tone: 'escrow' };
  if (i.p && i.p.status !== 'Settled') return { text: i.p.status, tone: null };
  return null;
}
const PE_TABS = [
  { label: 'Received', filter: (v) => v.paymentType === 'Receive' && v.docstatus !== 0, flag: '--filter payment_type=Receive' },
  { label: 'Paid', filter: (v) => v.paymentType === 'Pay' && v.docstatus !== 0, flag: '--filter payment_type=Pay' },
  { label: 'Transfers', filter: (v) => v.paymentType === 'Internal Transfer', flag: '--filter "payment_type=Internal Transfer"' },
  { label: 'Unallocated', filter: (v) => v.docstatus !== 0 && !v.cancelled && peInfo(v).unallocated > 0.005, flag: '--filter "unallocated_amount>0"' },
  { label: 'Unreconciled', filter: (v) => v.docstatus !== 0 && !v.cancelled && !peInfo(v).clearance, flag: '--filter "clearance_date is not set"' },
  { label: 'Drafts', filter: (v) => v.docstatus === 0, flag: '--filter docstatus=0' },
  { label: 'All' },
];
const peRows = () => B.vouchers.filter((v) => v.type === 'Payment Entry');
const shortId = (id) => (id ? (id.length > 22 ? id.slice(0, 16) + '…' + id.slice(-4) : id) : '');

cx.route('payment-entries', () => {
  const filters = [
    { key: 'name', label: 'ID' },
    { key: 'paymentType', label: 'Payment type', type: 'select', options: ['Receive', 'Pay', 'Internal Transfer'] },
    { key: 'partyName', label: 'Party', get: (v) => partyName(peInfo(v).partyType, peInfo(v).party), field: 'party_name', like: true },
    { key: 'via', label: 'Paid by', type: 'select', options: ['Capxul', 'Bridge', 'Bank'], get: (v) => peInfo(v).via, field: 'mode_of_payment' },
    { key: 'date', label: 'Posting month', type: 'month', field: 'posting_date' },
  ];
  const list = cx.listView({
    key: 'ac-pe', rows: peRows, noun: 'payment entry', nouns: 'payment entries', id: (v) => v.name,
    initial: listInit('ac-pe'),
    titleCol: { key: 'title', label: 'Title', sub: (v) => { const i = peInfo(v); return v.paymentType === 'Internal Transfer' ? `${accLabel(i.from?.account)} → ${accLabel(i.to?.account)}` : i.refs.length ? i.refs.map((l) => l.against).join(', ') : v.paymentType === 'Receive' ? 'Unallocated' : ''; } },
    status: (v) => pills(peStatus(v), peFlight(v, peInfo(v))),
    columns: [
      { key: 'paymentType', label: 'Payment type' },
      { key: 'date', label: 'Posting date', type: 'date' },
      { key: 'party', label: 'Party', render: (v) => { const i = peInfo(v); return i.party ? partyName(i.partyType, i.party) : h('span.faint', '—'); } },
      { label: 'Paid by', render: (v) => viaTag(peInfo(v).via) },
      { label: 'Reference', render: (v) => { const i = peInfo(v); return i.p ? h('span.mono', { style: 'font-size:12px', title: i.p.proof?.paymentId || i.p.id }, i.p.proof ? fmt.hash(i.p.proof.paymentId) : shortId(i.p.id)) : v.reference ? h('span.mono', { style: 'font-size:12px' }, v.reference) : i.bt ? h('span.mono', { style: 'font-size:12px' }, i.bt.reference || i.bt.description.slice(0, 18)) : h('span.faint', '—'); } },
      { label: 'Amount', keep: false, render: (v) => { const i = peInfo(v); return i.fromCur === 'USDC' ? fmt.usdc(i.paidAcc) : i.toCur === 'USDC' ? fmt.usdc(i.recvAcc) : h('span.faint', '—'); } },
    ],
    right: { key: 'total', label: 'Paid amount (GBP)', type: 'currency', currency: 'GBP' },
    modified: (v) => v.createdAt || (peInfo(v).p?.settledAt) || v.date,
    filters, tabs: PE_TABS,
    sort: { options: [{ key: 'date', label: 'Posting date' }, { key: 'total', label: 'Paid amount' }, { key: 'name', label: 'ID' }], default: { key: 'date', dir: 'desc' } },
    groupBy: [{ key: 'paymentType', label: 'Payment type' }, { key: 'via', label: 'Paid by', get: (v) => peInfo(v).via }, { key: 'partyType', label: 'Party type', get: (v) => peInfo(v).partyType || 'None' }],
    href: (v) => ['payment-entry', v.name],
    bulk: [{ label: 'Export', icon: 'file', cmd: 'capxul org doc list payment-entry --json', onClick: (rows) => noDownload(`capxul org doc list payment-entry --filter "name in (${rows.map((r) => r.name).join(',')})" --json`) }],
    cmd: lvCmd('payment-entry', PE_TABS, filters),
    views: [{ label: 'List', route: 'payment-entries', active: true, icon: 'list' }, { label: 'Money facts', route: 'money-facts', icon: 'shield' }],
  });
  return cx.page({
    title: 'Payment entries', crumbs: crumbs(),
    actions: [cx.menu(null, [{ label: 'Capxul’s side: payments', icon: 'shield', cmd: 'capxul payment list', onClick: () => (cx.hasRoute('money') ? cx.go('money') : cx.toast('The same money from Capxul’s side.', { cmd: 'capxul payment list' })) }, { label: 'Export', icon: 'file', cmd: 'capxul org doc list payment-entry --json', onClick: () => noDownload('capxul org doc list payment-entry --json') }]),
      cx.btn('New payment entry', { kind: 'primary', icon: 'plus', needs: needBooks, cmd: 'capxul org doc create payment-entry --input payment.json', onClick: () => newPaymentEntry() })],
    banner: cx.banner('A payment through Capxul or Bridge is booked here from the chain as it settles, with its proof, and cannot be edited, only classified. Payments in and out of the Barclays account are ordinary entries.', { tone: 'info' }),
    body: list,
  });
}, { workspace: 'books', title: 'Payment entries' });

function classify(v, line) {
  const i = peInfo(v);
  const target = line || i.lines.find((l) => ['4999', '6999'].includes(l.account)) || (v.paymentType === 'Receive' ? i.from : i.to);
  if (!target) { cx.toast('Nothing to classify on this entry.', { tone: 'warning' }); return; }
  const leafs = B.accounts.filter((a) => a.code && !a.isGroup && !BANK_CODES.has(a.code) && !a.archived);
  const model = { account: target.account, costCenter: target.costCenter || 'Main', project: target.project || '', party: target.party || '', note: '' };
  const id = i.p?.id || v.name;
  cx.modal({ title: `Classify ${v.name}`, body: h('div', { style: 'display:grid;gap:12px' },
    h('p.ac-note', `${v.title} · ${fmt.gbp(v.total)} on ${fmt.date(v.date)}. Classifying changes what the money means in the books: its account, cost centre and project. The money and its proof do not change.`),
    h('div.ac-form-grid',
      cx.field({ label: 'Account', key: 'account', model, edit: true, type: 'select', reqd: true, options: leafs.map((a) => [a.code, `${a.code} · ${a.name}`]) }),
      cx.field({ label: 'Cost centre', key: 'costCenter', model, edit: true, type: 'select', options: B.costCenters.filter((c) => !c.isGroup).map((c) => c.name) }),
      cx.field({ label: 'Project', key: 'project', model, edit: true, type: 'select', options: [['', '—'], ...(D.projects?.projects || []).map((p) => [p.name, `${p.name} · ${p.projectName}`])] }),
      cx.field({ label: 'Note', key: 'note', model, edit: true, placeholder: 'Why this account' }))),
    actions: [{ label: 'Cancel' }, { label: 'Classify', primary: true, needs: needBooks, cmd: `capxul activity annotate --id ${id} --account <code> --confirm`, onClick: (close) => {
      const cmd = `capxul activity annotate --id ${id} --account ${model.account}${model.note ? ` --memo "${model.note}"` : ''} --confirm`;
      const was = target.account;
      target.account = model.account; target.costCenter = model.costCenter || null; target.project = model.project || null;
      (v.timelineExtra ||= []).push({ at: NOW(), who: cx.meId(), kind: 'change', text: `classified it: ${accLabel(was)} → ${accLabel(model.account)}${model.note ? ` (${model.note})` : ''}` });
      peCache.delete(v); close(); cx.refresh();
      cx.toast(`Classified to ${accLabel(model.account)}`, { tone: 'success', cmd });
    } }] });
}
function bridgeNode(i) {
  if (i.dep) {
    const d = i.dep;
    return cx.section({ label: 'Bridge deposit', columns: [[
      { label: 'From', value: d.from }, { label: 'Bank amount', value: fmt.money(d.bankAmount, d.currency) }, { label: 'Rail', value: d.rail }, { label: 'Reference', value: d.reference, type: 'mono' },
    ], [
      { label: 'Became', value: d.net != null ? fmt.usdc(d.net, 6) : '—' }, { label: 'Fees', value: d.fees != null ? `${fmt.gbp(d.fees)}${d.feeBreakdown ? ` (Capxul ${fmt.gbp(d.feeBreakdown.capxul)}, exchange ${fmt.gbp(d.feeBreakdown.exchange)})` : ''}` : '—' },
      { label: 'Matched', value: d.match + (d.matchedTo?.length ? `: ${d.matchedTo.join(', ')}` : '') }, { label: 'Credited', value: d.creditedAt ? fmt.datetime(d.creditedAt) : '—' },
      cx.hasRoute('deposit') ? { label: 'Deposit', render: () => cx.link(d.id, 'deposit', d.id) } : { label: 'Deposit', value: d.id, type: 'mono' },
    ]] }, {});
  }
  if (i.po) {
    const po = i.po;
    return cx.section({ label: 'Bridge payout', columns: [[
      { label: 'To', value: `${po.to} · ${po.bank?.bankName} ·· ${po.bank?.last4}` }, { label: 'Bank receives', value: fmt.money(po.bankAmount, po.currency) }, { label: 'Rail', value: po.rail }, { label: 'Status', value: po.status, type: 'status' },
    ], [
      { label: 'The Safe sent', value: fmt.usdc(po.sent, 6) }, { label: 'Bridge fee', value: fmt.usdc(po.fee) }, { label: 'Quote', value: `1 USDC = £${po.quoteRate}` },
      { label: po.deliveredAt ? 'Delivered' : po.returnedAt ? 'Returned' : 'Sent', value: fmt.datetime(po.deliveredAt || po.returnedAt || po.sentAt) },
      cx.hasRoute('payout') ? { label: 'Payout', render: () => cx.link(po.id, 'payout', po.id) } : { label: 'Payout', value: po.id, type: 'mono' },
    ]] }, {});
  }
  return null;
}
function newPaymentEntry() {
  const parties = [...B.customers.map((c) => [`Customer|${c.id}`, `Customer · ${c.name}`]), ...B.suppliers.map((s) => [`Supplier|${s.id}`, `Supplier · ${s.name}`])];
  const model = { type: 'Pay', party: 'Supplier|penrose', date: TODAY, amount: '', reference: '', remark: '' };
  cx.modal({ title: 'New payment entry', wide: true, body: h('div', { style: 'display:grid;gap:12px' },
    cx.banner('For money that moved through the Barclays account. Capxul books its own payments from the chain.', { tone: 'info' }),
    h('div.ac-form-grid',
      cx.field({ label: 'Payment type', key: 'type', model, edit: true, type: 'select', options: ['Receive', 'Pay'], reqd: true }),
      cx.field({ label: 'Posting date', key: 'date', model, edit: true, type: 'date', reqd: true }),
      cx.field({ label: 'Party', key: 'party', model, edit: true, type: 'select', options: parties, reqd: true }),
      cx.field({ label: 'Mode of payment', value: 'Bank transfer' }),
      cx.field({ label: 'Bank account', value: accLabel('1050') }),
      cx.field({ label: 'Paid amount (GBP)', key: 'amount', model, edit: true, type: 'currency', reqd: true }),
      cx.field({ label: 'Payment reference', key: 'reference', model, edit: true }),
      cx.field({ label: 'Remarks', key: 'remark', model, edit: true }))),
    actions: [{ label: 'Cancel' }, { label: 'Save and submit', primary: true, needs: needBooks, cmd: ['capxul org doc create payment-entry --input payment.json', 'capxul org doc submit payment-entry <name>'], onClick: (close) => {
      const amt = r2(+model.amount); if (!(amt > 0)) { cx.toast('Give an amount.', { tone: 'warning' }); return; }
      const [pt, pid] = model.party.split('|');
      const name = nextName(`ACC-PAY-${YEAR}-`);
      const partyAcc = pt === 'Customer' ? '1200' : '2000';
      const lines = model.type === 'Receive' ? [{ account: '1050', debit: amt }, { account: partyAcc, credit: amt, party: pid, partyType: pt }] : [{ account: partyAcc, debit: amt, party: pid, partyType: pt }, { account: '1050', credit: amt }];
      postVoucher({ name, type: 'Payment Entry', entryType: null, paymentType: model.type, date: model.date, title: partyName(pt, pid), total: amt, party: pid, partyType: pt, payment: null, closing: false, reference: model.reference || null, remark: model.remark || null, createdBy: cx.meId(), createdAt: NOW() }, lines);
      close(); cx.go('payment-entry', name);
      cx.toast(`Submitted ${name}: unallocated until you match it to an invoice`, { tone: 'success', cmd: `capxul org doc submit payment-entry ${name}` });
    } }] });
}
async function cancelPe(v) {
  const i = peInfo(v);
  const cmd = `capxul org doc cancel payment-entry ${v.name}`;
  if (i.p) { cx.toast('A payment made through Capxul is booked from the chain and cannot be cancelled in Books. Classify it, or refund it with a new payment.', { tone: 'warning', cmd: `capxul payment get ${i.p.id}` }); return; }
  if (!(await cx.confirm({ title: `Cancel ${v.name}?`, body: `${v.title} · ${fmt.gbp(v.total)}. Its ledger lines are reversed and the invoices it paid are open again.`, cmd, who: 'whoever wears the Books hat, or a Director', confirmLabel: 'Cancel the entry', danger: true }))) return;
  for (const l of linesOf(v.name)) l.isCancelled = 1;
  v.cancelled = true;
  for (const inv of [...B.salesInvoices, ...B.purchaseInvoices]) {
    const hit = (inv.payments || []).filter((p) => p.voucher === v.name);
    if (!hit.length) continue;
    inv.payments = inv.payments.filter((p) => p.voucher !== v.name);
    inv.outstanding = r2(inv.outstanding + sum(hit, 'amount')); inv.paidAmount = r2((inv.paidAmount || 0) - sum(hit, 'amount'));
  }
  peCache.delete(v); cx.refresh(); cx.toast(`Cancelled ${v.name}`, { cmd });
}

function pePage(v) {
  const i = peInfo(v);
  const st = peStatus(v);
  const flight = peFlight(v, i);
  const chain = !!i.p;
  const proof = i.p ? cx.proof(i.p, { booked: v.name }) : null;
  const refRows = i.refs.map((l) => { const d = cx.docByName(l.against)?.doc; return { type: l.againstType, name: l.against, dueDate: d?.dueDate || null, grandTotal: d ? r2((d.baseGrandTotal ?? d.grandTotal)) : null, outstanding: d ? r2(d.outstanding * (d.conversionRate || 1)) : null, allocated: r2(l.debit || l.credit), billNo: d?.billNo || null }; });
  const modeLabel = !chain ? 'Bank transfer' : i.via === 'Bridge' ? 'Bridge' : 'Capxul';
  const ccLine = i.lines.find((l) => l.costCenter && !isDeduction(l));
  const form = cx.formView({
    doc: v, tabKey: 'ac-pe',
    tabs: [{ label: 'Details', sections: [
      { label: 'Type of payment', columns: [[
        { label: 'Series', value: 'ACC-PAY-.YYYY.-', reqd: true },
        { label: 'Payment type', value: v.paymentType, reqd: true },
      ], [
        { label: 'Posting date', value: v.date, type: 'date', reqd: true },
        { label: 'Mode of payment', value: modeLabel },
        { label: 'Company bank account', value: i.from && isBankLine(i.from) ? acc(i.from.account)?.name : i.to && isBankLine(i.to) ? acc(i.to.account)?.name : '—' },
      ]] },
      v.paymentType !== 'Internal Transfer' ? { label: v.paymentType === 'Receive' ? 'Payment from' : 'Payment to', columns: [[
        { label: 'Party type', value: i.partyType || '—' },
        { label: 'Party', render: () => partyNode(i.partyType, i.party, i.party ? null : v.title) },
        { label: 'Party name', value: i.party ? partyName(i.partyType, i.party) : v.title },
      ], [
        { label: 'Party bank account', value: i.po ? `${i.po.bank?.bankName} ·· ${i.po.bank?.last4}` : i.p?.payee?.safe ? `Safe ${fmt.addr(i.p.payee.safe)}` : i.dep ? i.dep.from : '—' },
        { label: 'Contact email', value: i.p?.payee?.email || (i.partyType === 'Supplier' ? SUPP.get(i.party)?.email : i.partyType === 'Customer' ? customerContact(i.party)?.email : null) || '—' },
      ]] } : null,
      { label: chain ? 'Accounts and transaction details' : 'Accounts', collapsible: true, collapsed: false, columns: [[
        { label: 'Account paid from', render: () => (i.from ? cx.link(accLabel(i.from.account), 'account', i.from.account) : '—') },
        { label: 'Account currency (from)', value: i.fromCur },
        { label: 'Payment reference', render: () => (chain ? h('span.mono', { title: i.p.id, style: 'overflow-wrap:anywhere' }, i.p.proof?.paymentId ? fmt.hash(i.p.proof.paymentId) : i.p.id) : h('span', v.reference || i.bt?.reference || i.bt?.description || '—')), help: chain ? 'The payment ID on chain' : null },
      ], [
        { label: 'Account paid to', render: () => (i.to ? cx.link(accLabel(i.to.account), 'account', i.to.account) : '—') },
        { label: 'Account currency (to)', value: i.toCur },
        { label: 'Reference date', value: v.refDate || v.date, type: 'date' },
        { label: 'Clearance date', value: i.clearance, type: 'date', help: chain ? 'Cleared when the chain settled it' : i.clearance ? 'Matched to the Barclays statement' : 'Not yet on the statement' },
      ]] },
      { label: 'Amount', columns: [[
        { label: `Paid amount (${i.fromCur})`, render: () => h('b', fmt.money(i.paidAcc, i.fromCur, i.fromCur === 'USDC' ? 6 : 2)) },
        { label: 'Source exchange rate', value: i.fromCur === 'USDC' && i.paidAcc ? r6(i.paidGbp / i.paidAcc) : 1, type: 'float', dp: 4 },
        { label: 'Paid amount (GBP)', value: i.paidGbp, type: 'currency', currency: 'GBP' },
      ], [
        { label: `Received amount (${i.toCur})`, render: () => h('b', fmt.money(i.recvAcc, i.toCur, i.toCur === 'USDC' ? 6 : 2)) },
        { label: 'Target exchange rate', value: i.toCur === 'USDC' && i.recvAcc ? r6(i.recvGbp / i.recvAcc) : 1, type: 'float', dp: 4 },
        { label: 'Received amount (GBP)', value: i.recvGbp, type: 'currency', currency: 'GBP' },
      ]] },
      chain ? { label: 'Proof', desc: 'This entry is the books’ side of a Capxul payment. The proof is what the payment committed to on chain.', node: proof } : null,
      i.dep || i.po ? { node: bridgeNode(i) } : null,
      v.paymentType !== 'Internal Transfer' ? { label: 'Reference', table: cx.grid({ columns: [
        { key: 'type', label: 'Type' }, { key: 'name', label: 'Name', render: (r) => vLink(r.name, r.type) }, { key: 'dueDate', label: 'Due date', type: 'date', opt: true },
        { key: 'grandTotal', label: 'Grand total', type: 'currency', currency: 'GBP', opt: true }, { key: 'outstanding', label: 'Outstanding', type: 'currency', currency: 'GBP' }, { key: 'allocated', label: 'Allocated', type: 'currency', currency: 'GBP' },
      ], rows: refRows, totals: ['allocated'], empty: 'Not allocated to any invoice', rowForm: [{ key: 'type', label: 'Type' }, { key: 'name', label: 'Name' }, { key: 'billNo', label: 'Supplier invoice no' }, { key: 'dueDate', label: 'Due date', type: 'date' }, { key: 'outstanding', label: 'Outstanding', type: 'currency', currency: 'GBP' }, { key: 'allocated', label: 'Allocated', type: 'currency', currency: 'GBP' }] }) } : null,
      v.paymentType !== 'Internal Transfer' ? { label: 'Writeoff', cols: 3, fields: [{ label: 'Total allocated amount', value: i.allocated, type: 'currency', currency: 'GBP' }, { label: 'Unallocated amount', value: i.unallocated, type: 'currency', currency: 'GBP' }, { label: 'Difference amount (company currency)', value: 0, type: 'currency', currency: 'GBP' }] } : null,
      { label: 'Deductions or loss', collapsible: true, collapsed: !i.deductions.length, table: cx.grid({ columns: [{ key: 'account', label: 'Account', render: (r) => accLabel(r.account) }, { key: 'costCenter', label: 'Cost centre' }, { key: 'amount', label: 'Amount (company currency)', type: 'currency', currency: 'GBP', get: (r) => r2(r.debit - r.credit) }], rows: i.deductions, totals: ['amount'], empty: 'No deductions' }) },
      { label: 'Accounting dimensions', collapsible: true, collapsed: true, columns: [[{ label: 'Project', render: () => projectLink(ccLine?.project) }], [{ label: 'Cost centre', value: ccLine?.costCenter || 'Main' }]] },
      { label: 'More information', collapsible: true, collapsed: true, columns: [[{ label: 'Status', value: st, type: 'status' }, { label: 'Remarks', value: v.remark || `${v.paymentType === 'Receive' ? 'Amount ' + fmt.gbp(v.total) + ' received from ' : v.paymentType === 'Pay' ? 'Amount ' + fmt.gbp(v.total) + ' paid to ' : 'Transfer: '}${v.title}${i.refs.length ? '. Against ' + i.refs.map((l) => l.against).join(', ') : ''}`, type: 'textarea' }], [{ label: 'In words (company currency)', value: inWords(v.total, 'GBP') }, { label: 'Is opening', value: 0, type: 'check' }, chain ? { label: 'Made by', value: 'Capxul, from the chain' } : null].filter(Boolean)] },
    ].filter(Boolean) }],
    connections: [
      { group: 'Invoices', items: [{ label: 'Sales invoice', count: refRows.filter((r) => r.type === 'Sales Invoice').length, route: refRows.find((r) => r.type === 'Sales Invoice') ? 'sales-invoice' : null, id: refRows.find((r) => r.type === 'Sales Invoice')?.name }, { label: 'Purchase invoice', count: refRows.filter((r) => r.type === 'Purchase Invoice').length, route: refRows.find((r) => r.type === 'Purchase Invoice') ? 'purchase-invoice' : null, id: refRows.find((r) => r.type === 'Purchase Invoice')?.name }] },
      { group: 'Bank', items: [{ label: 'Bank transaction', count: i.bt ? 1 : 0, route: i.bt ? 'banking' : null, id: '1050' }, { label: 'Payment', count: i.p ? 1 : 0, route: i.p && cx.hasRoute('payment') ? 'payment' : null, id: i.p?.id }] },
    ],
    side: { id: v.name, title: v.title, cmd: `capxul org doc get payment-entry ${v.name}`, tags: [i.via], attachments: [], created: { by: v.createdBy && v.createdBy !== 'capxul' ? v.createdBy : chain ? null : 'kwame', at: v.createdAt || (i.p?.settledAt) || v.date + 'T12:00:00Z' }, modified: { by: v.createdBy && v.createdBy !== 'capxul' ? v.createdBy : chain ? null : 'kwame', at: v.createdAt || i.p?.settledAt || v.date + 'T12:00:00Z' },
      extra: chain ? h('div.side-sec', h('h4', 'Capxul payment'), h('div', { style: 'display:grid;gap:4px;font-size:12.5px' }, cx.pill(i.p.status), cx.hasRoute('payment') ? cx.link(shortId(i.p.id), 'payment', i.p.id) : h('span.mono', shortId(i.p.id)), i.p.approvedBy ? h('span.muted', `approved by ${cx.name(i.p.approvedBy)}${i.p.approvedHat ? `, wearing ${i.p.approvedHat}` : ''}`) : null)) : null },
    timeline: { items: [
      { at: v.createdAt || i.p?.settledAt || v.date + 'T12:00:00Z', who: chain ? null : v.createdBy || 'kwame', kind: chain ? 'money' : 'submitted', text: chain ? `Capxul booked this from the chain${i.p.proof ? ` (block ${fmt.int(i.p.proof.block)})` : ''}` : 'submitted this' },
      ...(i.bt?.status === 'Reconciled' ? [{ at: i.bt.date + 'T18:00:00Z', who: 'kwame', kind: 'link', text: `matched it to the Barclays statement line ${i.bt.name}` }] : []),
      ...(v.cancelled ? [{ at: NOW(), who: cx.meId(), kind: 'cancelled', text: 'cancelled this' }] : []),
      ...(v.timelineExtra || []),
    ], comment: true },
  });
  const ledger = cx.btn('Ledger', { icon: 'report', cmd: `capxul org report run general-ledger --filter voucher_no=${v.name}`, onClick: () => cx.go('general-ledger', null, { report: { voucher: v.name, from: v.date, to: TODAY, account: '', party: '' } }) });
  const actions = chain
    ? [cx.menu(null, [{ label: 'Print', icon: 'file', cmd: `capxul org doc render payment-entry ${v.name}`, onClick: () => noDownload(`capxul org doc render payment-entry ${v.name}`) }, cx.hasRoute('payment') ? { label: 'Open the payment', icon: 'shield', href: ['payment', i.p.id] } : null]),
      ledger, cx.btn('Classify', { needs: needBooks, cmd: `capxul activity annotate --id ${i.p.id} --account <code> --confirm`, onClick: () => classify(v) }),
      cx.btn('Proof', { kind: 'primary', icon: 'shield', cmd: `capxul payment get ${i.p.id}`, onClick: () => (i.p.proof ? cx.panel.open({ title: `Proof: ${v.name}`, sub: v.title, wide: true, body: h('div', { style: 'padding:4px' }, cx.proof(i.p, { booked: v.name })) }) : cx.toast('No proof yet: the payment has not settled on chain.')) })]
    : v.cancelled ? [ledger, cx.btn('Amend', { kind: 'primary', needs: needBooks, cmd: `capxul org doc amend payment-entry ${v.name}`, onClick: () => newPaymentEntry() })]
      : [cx.menu(null, [{ label: 'Print', icon: 'file', cmd: `capxul org doc render payment-entry ${v.name}`, onClick: () => noDownload(`capxul org doc render payment-entry ${v.name}`) }]), ledger, cx.btn('Cancel', { needs: needBooks, cmd: `capxul org doc cancel payment-entry ${v.name}`, onClick: () => cancelPe(v) })];
  return cx.page({
    title: v.title, crumbs: crumbs({ label: 'Payment entries', route: 'payment-entries' }),
    status: pills(st, flight, true),
    sub: `${v.name} · ${v.paymentType} · ${fmt.date(v.date)} · ${fmt.gbp(v.total)}${i.fromCur === 'USDC' ? ` · ${fmt.usdc(i.paidAcc)}` : i.toCur === 'USDC' ? ` · ${fmt.usdc(i.recvAcc)}` : ''}`,
    cmd: { cli: [`capxul org doc get payment-entry ${v.name}`, ...(chain ? [`capxul payment get ${i.p.id}`] : [])], kind: 'family', sdk: `client.org(orgId).docs.get("payment-entry", "${v.name}")`, who: 'anyone with a seat',
      json: { name: v.name, payment_type: v.paymentType, posting_date: v.date, party: i.party ? partyName(i.partyType, i.party) : null, paid_amount: i.paidAcc, paid_from_account_currency: i.fromCur, base_paid_amount: i.paidGbp, reference_no: chain ? i.p.id : v.reference || null, clearance_date: i.clearance, references: refRows.map((r) => ({ reference_type: r.type, reference_name: r.name, allocated_amount: r.allocated })) } },
    banner: chain ? cx.banner(`Booked by Capxul from the chain: read-only. ${i.unallocated > 0.005 ? 'It is not allocated to an invoice yet: classify it.' : 'Its only edit is Classify.'}`, { tone: i.unallocated > 0.005 ? 'warning' : 'info' }) : v.cancelled ? cx.banner('This entry is cancelled. Its ledger lines are reversed.', { tone: 'warning' }) : null,
    fde: `Payment entry ${v.name}: ${v.title}, ${fmt.gbp(v.total)}`,
    actions, body: form,
  });
}
cx.route('payment-entry', (ctx) => {
  const v = cx.find(B.vouchers, 'name', ctx.id);
  if (!v) return cx.page({ title: 'Not found', crumbs: crumbs({ label: 'Payment entries', route: 'payment-entries' }), body: cx.empty('No such payment entry') });
  if (v.type === 'Journal Entry') return jePage(v);
  if (v.type !== 'Payment Entry') { const r = VROUTE[v.type]; if (r && cx.hasRoute(r)) { queueMicrotask(() => cx.go(r, v.name)); return cx.page({ title: v.name, body: cx.empty('Opening…') }); } }
  return pePage(v);
}, { workspace: 'books', title: 'Payment entry' });

/* =====================================================================================================
   Journal entries
   ===================================================================================================== */

const ENTRY_TYPES = ['Journal Entry', 'Bank Entry', 'Opening Entry', 'Write Off Entry', 'Credit Note', 'Debit Note', 'Depreciation Entry'];
const CAPXUL_ONLY = new Set(['1010', '1020', '1030', '1040']);
function jePostedBy(v) {
  if (v.createdBy) return v.createdBy;
  if (v.payment || /^Payroll accrual/.test(v.title) || ['Exchange Rate Revaluation', 'Depreciation Entry'].includes(v.entryType)) return 'capxul';
  if (v.entryType === 'Opening Entry') return '@harbourline-fde';
  return v.date < '2025-06-02' ? 'maya' : 'kwame';
}
const byLabel = (id) => (id === 'capxul' ? 'Capxul' : cx.name(id));
const jeStatus = (v) => (v.docstatus === 0 ? (v.__new ? 'Not saved' : 'Draft') : v.cancelled ? 'Cancelled' : v.entryType);
const JE_TABS = [
  { label: 'Drafts', filter: (v) => v.docstatus === 0, flag: '--filter docstatus=0' },
  { label: 'Bank and cash', filter: (v) => ['Bank Entry', 'Credit Card Entry', 'Contra Entry', 'Cash Entry'].includes(v.entryType) && v.docstatus !== 0, flag: '--filter "voucher_type in (Bank Entry,Cash Entry,Credit Card Entry,Contra Entry)"' },
  { label: 'Opening entries', filter: (v) => v.entryType === 'Opening Entry', flag: '--filter is_opening=Yes' },
  { label: 'Depreciation', filter: (v) => v.entryType === 'Depreciation Entry', flag: '--filter "voucher_type=Depreciation Entry"' },
  { label: 'All' },
];
const jeRows = () => B.vouchers.filter((v) => v.type === 'Journal Entry');
function jeLines(v) { return v.docstatus === 0 ? v.draftLines || [] : linesOf(v.name).filter((l) => !l.isCancelled || v.cancelled); }

cx.route('journal-entries', () => {
  const filters = [
    { key: 'name', label: 'ID' },
    { key: 'title', label: 'Title', like: true },
    { key: 'entryType', label: 'Entry type', type: 'select', field: 'voucher_type' },
    { key: 'date', label: 'Posting month', type: 'month', field: 'posting_date' },
    { key: 'postedBy', label: 'Posted by', type: 'select', get: (v) => byLabel(jePostedBy(v)), field: 'owner' },
  ];
  const list = cx.listView({
    key: 'ac-je', rows: jeRows, noun: 'journal entry', nouns: 'journal entries', id: (v) => v.name,
    initial: listInit('ac-je'),
    titleCol: { key: 'title', label: 'Title', sub: (v) => (v.payment ? 'With a Capxul payment' : null) },
    status: (v) => { const s = jeStatus(v); return cx.pill(s, s === 'Draft' || s === 'Cancelled' || s === 'Not saved' ? null : 'blue'); },
    columns: [
      { key: 'date', label: 'Posting date', type: 'date' },
      { label: 'Posted by', render: (v) => { const b = jePostedBy(v); return b === 'capxul' ? h('span.ac-via.v-capxul', 'Capxul') : cx.personChip(b, { link: false }); } },
      { label: 'Lines', render: (v) => fmt.int(jeLines(v).length), align: 'right' },
    ],
    right: { key: 'total', label: 'Total debit', type: 'currency', currency: 'GBP' },
    modified: (v) => v.createdAt || v.date,
    filters, tabs: JE_TABS,
    sort: { options: [{ key: 'date', label: 'Posting date' }, { key: 'total', label: 'Total debit' }, { key: 'name', label: 'ID' }], default: { key: 'date', dir: 'desc' } },
    groupBy: [{ key: 'entryType', label: 'Entry type' }, { key: 'postedBy', label: 'Posted by', get: (v) => byLabel(jePostedBy(v)) }],
    href: (v) => ['journal-entry', v.name],
    cmd: lvCmd('journal-entry', JE_TABS, filters),
  });
  return cx.page({
    title: 'Journal entries', crumbs: crumbs(),
    actions: [cx.btn('Quick entry', { needs: needBooks, cmd: 'capxul org doc create journal-entry --input entry.json', onClick: () => quickEntry() }), cx.btn('New journal entry', { kind: 'primary', icon: 'plus', needs: needBooks, cmd: 'capxul org doc create journal-entry --input entry.json', onClick: () => newJournalEntry() })],
    body: list,
  });
}, { workspace: 'books', title: 'Journal entries' });

const leafOptions = () => B.accounts.filter((a) => a.code && !a.isGroup && !a.archived).map((a) => `${a.code} · ${a.name}`);
const codeOf = (s) => String(s || '').split(' · ')[0].trim();
function newJournalEntry(o = {}) {
  const v = { name: `new-journal-entry-${++draftSeq}`, type: 'Journal Entry', entryType: o.entryType || 'Journal Entry', paymentType: null, date: o.date || TODAY, title: o.title || '', total: 0, party: null, partyType: null, payment: null, closing: false, docstatus: 0, __new: true, createdBy: cx.meId(), createdAt: NOW(), reversalOf: o.reversalOf || null,
    draftLines: o.lines || [{ account: '', partyType: '', party: '', debit: 0, credit: 0 }, { account: '', partyType: '', party: '', debit: 0, credit: 0 }] };
  B.vouchers.push(v); VCH.set(v.name, v);
  cx.go('journal-entry', v.name);
}
function quickEntry() {
  const model = { debit: '6900 · Office and sundry', credit: '1050 · Barclays Business · GBP', amount: '', date: TODAY, remark: '' };
  cx.modal({ title: 'Quick entry', body: h('div', { style: 'display:grid;gap:12px' },
    h('div.ac-form-grid',
      cx.field({ label: 'Account to debit', key: 'debit', model, edit: true, type: 'select', options: leafOptions(), reqd: true }),
      cx.field({ label: 'Account to credit', key: 'credit', model, edit: true, type: 'select', options: leafOptions(), reqd: true }),
      cx.field({ label: 'Amount (GBP)', key: 'amount', model, edit: true, type: 'currency', reqd: true }),
      cx.field({ label: 'Posting date', key: 'date', model, edit: true, type: 'date', reqd: true }),
      cx.field({ label: 'Remark', key: 'remark', model, edit: true, wide: true }))),
    actions: [{ label: 'Cancel' }, { label: 'Make the entry', primary: true, needs: needBooks, onClick: (close) => {
      const amt = r2(+model.amount); if (!(amt > 0)) { cx.toast('Give an amount.', { tone: 'warning' }); return; }
      close();
      newJournalEntry({ date: model.date, title: model.remark, lines: [{ account: model.debit, partyType: '', party: '', debit: amt, credit: 0 }, { account: model.credit, partyType: '', party: '', debit: 0, credit: amt }] });
    } }] });
}
async function postJournalEntry(v) {
  const lines = v.draftLines.filter((l) => codeOf(l.account));
  const dr = r2(sum(lines, (l) => +l.debit || 0)), cr = r2(sum(lines, (l) => +l.credit || 0));
  if (lines.length < 2) { cx.toast('A journal entry needs at least two lines.', { tone: 'warning' }); return; }
  if (!near0(dr - cr)) { cx.toast(`Debits ${fmt.gbp(dr)} and credits ${fmt.gbp(cr)} differ by ${fmt.gbp(dr - cr)}.`, { tone: 'warning' }); return; }
  const bad = lines.find((l) => CAPXUL_ONLY.has(codeOf(l.account)));
  if (bad) { cx.toast(`Only the chain posts to ${accLabel(codeOf(bad.account))}. Move money with a payment; it is booked here by itself.`, { tone: 'danger' }); return; }
  const cmd = `capxul org doc submit journal-entry ${v.name}`;
  if (!(await cx.confirm({ title: `Post ${v.name}?`, body: `${v.entryType} · ${fmt.gbp(dr)} · ${lines.length} lines. Posting writes it to the ledger.`, cmd, who: 'whoever wears the Books hat, or a Director', confirmLabel: 'Post' }))) return;
  v.docstatus = 1; v.total = dr; v.submittedAt = NOW();
  for (const l of lines) l.account = codeOf(l.account);
  const posted = lines.map((l) => ({ account: l.account, debit: +l.debit || 0, credit: +l.credit || 0, party: l.party || null, partyType: l.partyType || null, costCenter: l.costCenter || (isPL(l.account) ? 'Main' : null) }));
  for (const r of posted) { const row = { voucher: v.name, type: v.type, date: v.date, account: r.account, debit: r2(r.debit), credit: r2(r.credit), accDebit: 0, accCredit: 0, party: r.party, partyType: r.partyType, costCenter: r.costCenter, project: null, againstType: null, against: null, closing: 0 }; GL.push(row); addTo(glBy, v.name, row); }
  B.journalEntryCount = (B.journalEntryCount || 0) + 1;
  delete v.draftLines;
  cx.refresh(); cx.toast(`Posted ${v.name}`, { tone: 'success', cmd });
}
function saveJournalEntry(v) {
  const old = v.name;
  VCH.delete(v.name);
  v.name = v.amendedFrom ? `${v.amendedFrom}-1` : nextName(`ACC-JV-${YEAR}-`);
  VCH.set(v.name, v);
  delete v.__new;
  cx.toast(`Saved ${v.name} as a draft`, { tone: 'success', cmd: `capxul org doc create journal-entry --input ${old}.json` });
  cx.go('journal-entry', v.name);
}

function jePage(v) {
  const draft = v.docstatus === 0;
  const lines = jeLines(v);
  const by = jePostedBy(v);
  const capxul = by === 'capxul';
  const p = payById(v.payment);
  const run = /HR-PRUN-\d{4}-\d{5}/.exec(v.title || '')?.[0];
  const multi = lines.some((l) => isUsdcAcc(codeOf(l.account)));
  const totBox = h('div', { style: 'min-width:0' });
  const drawTot = () => { const dr = r2(sum(lines, (l) => +l.debit || 0)), cr = r2(sum(lines, (l) => +l.credit || 0)); cx.fill(totBox, cx.section({ cols: 3, fields: [{ label: 'Total debit', value: dr, type: 'currency', currency: 'GBP' }, { label: 'Total credit', value: cr, type: 'currency', currency: 'GBP' }, { label: 'Difference (Dr − Cr)', render: () => h('b', { class: near0(dr - cr) ? null : 'neg' }, fmt.gbp(dr - cr)) }] }, { doc: v })); };
  drawTot();
  const cols = draft ? [
    { key: 'account', label: 'Account', edit: true, type: 'select', options: ['', ...leafOptions()], width: '240px' },
    { key: 'partyType', label: 'Party type', edit: true, type: 'select', options: ['', 'Customer', 'Supplier', 'Employee'], opt: true },
    { key: 'party', label: 'Party', edit: true, opt: true },
    { key: 'debit', label: 'Debit', type: 'currency', currency: 'GBP', edit: true, width: '120px' },
    { key: 'credit', label: 'Credit', type: 'currency', currency: 'GBP', edit: true, width: '120px' },
  ] : [
    { key: 'account', label: 'Account', render: (r) => cx.link(accLabel(r.account), 'account', r.account) },
    { key: 'partyType', label: 'Party type', opt: true },
    { key: 'party', label: 'Party', render: (r) => (r.party ? partyName(r.partyType, r.party) : h('span.faint', '—')) },
    { key: 'costCenter', label: 'Cost centre', opt: true },
    multi ? { key: 'acc', label: 'In USDC', opt: true, render: (r) => (r.accDebit || r.accCredit ? fmt.usdc(r.accDebit || -r.accCredit, 6) : h('span.faint', '—')) } : null,
    { key: 'debit', label: 'Debit', type: 'currency', currency: 'GBP' },
    { key: 'credit', label: 'Credit', type: 'currency', currency: 'GBP' },
  ].filter(Boolean);
  const form = cx.formView({
    doc: v, editable: draft, tabKey: 'ac-je',
    tabs: lockValues([
      { label: 'Details', sections: [
        { columns: [[
          draft ? { label: 'Entry type', key: 'entryType', type: 'select', options: ENTRY_TYPES, reqd: true } : { label: 'Entry type', value: v.entryType, reqd: true },
          { label: 'Series', value: 'ACC-JV-.YYYY.-', reqd: true },
        ], [
          { label: 'Posting date', key: 'date', type: 'date', reqd: true },
          { label: 'Multi currency', value: multi ? 1 : 0, type: 'check' },
          v.reversalOf ? { label: 'Reversal of', value: v.reversalOf, type: 'link', href: ['journal-entry', v.reversalOf] } : null,
          v.amendedFrom ? { label: 'Amends', value: v.amendedFrom, type: 'link', href: ['journal-entry', v.amendedFrom] } : null,
        ].filter(Boolean)] },
        { label: 'Accounting entries', table: cx.grid({ columns: cols, rows: lines, editable: draft, totals: ['debit', 'credit'], title: 'Line', onChange: () => drawTot(),
          rowForm: draft ? null : [{ key: 'account', label: 'Account', render: (r) => accLabel(r.account) }, { key: 'partyType', label: 'Party type' }, { key: 'party', label: 'Party', render: (r) => partyName(r.partyType, r.party) || '—' }, { key: 'costCenter', label: 'Cost centre' }, { key: 'project', label: 'Project' }, { key: 'accountCurrency', label: 'Account currency', render: (r) => acc(r.account)?.currency || 'GBP' }, { key: 'accDebit', label: 'Debit in account currency', render: (r) => (isUsdcAcc(r.account) ? fmt.usdc(r.accDebit, 6) : fmt.gbp(r.debit)) }, { key: 'accCredit', label: 'Credit in account currency', render: (r) => (isUsdcAcc(r.account) ? fmt.usdc(r.accCredit, 6) : fmt.gbp(r.credit)) }, { key: 'debit', label: 'Debit', type: 'currency', currency: 'GBP' }, { key: 'credit', label: 'Credit', type: 'currency', currency: 'GBP' }], empty: 'No lines' }) },
        { node: totBox },
        { label: 'Reference', columns: [[{ label: 'Reference number', value: p ? (p.proof?.paymentId ? fmt.hash(p.proof.paymentId) : p.id) : B.bankTransactions.find((t) => t.voucher === v.name)?.reference || null, type: 'mono' }, { label: 'Reference date', value: v.date, type: 'date' }], [{ label: 'Clearance date', value: p ? (p.settledAt || '').slice(0, 10) : B.bankTransactions.find((t) => t.voucher === v.name && t.status === 'Reconciled')?.date || null, type: 'date' }]] },
        p ? { label: 'Proof', node: cx.proof(p, { booked: v.name }) } : null,
      ].filter(Boolean) },
      { label: 'More info', sections: [
        { label: 'Reference', columns: [[{ label: 'Bill no', value: null }, { label: 'Bill date', value: null, type: 'date' }], [{ label: 'Reversal of', value: v.reversalOf || null }, { label: 'Payroll run', render: () => (run ? (cx.hasRoute('payroll-run') ? cx.link(run, 'payroll-run', run) : run) : h('span.faint', '—')) }]] },
        { label: 'Additional info', columns: [[{ label: 'Is opening', value: v.entryType === 'Opening Entry' ? 'Yes' : 'No' }, { label: 'Mode of payment', value: v.entryType === 'Credit Card Entry' ? 'Company card' : v.entryType === 'Bank Entry' ? (p ? 'Capxul' : 'Bank transfer') : null }], [draft ? { label: 'Remark', key: 'title', type: 'textarea', reqd: true } : { label: 'Remark', value: v.title, type: 'textarea' }]] },
      ] },
    ]),
    side: { id: draft && v.__new ? null : v.name, title: v.title, cmd: `capxul org doc get journal-entry ${v.name}`, tags: [v.entryType], created: { by: by === 'capxul' ? null : by, at: v.createdAt || v.date + 'T17:30:00Z' }, modified: { by: by === 'capxul' ? null : by, at: v.createdAt || v.date + 'T17:30:00Z' } },
    timeline: { items: [{ at: v.createdAt || v.date + 'T17:30:00Z', who: capxul ? null : by, kind: draft ? 'created' : 'submitted', text: capxul ? `Capxul posted this${run ? ' from payroll run ' + run : p ? ' from the chain' : ''}` : draft ? 'created this' : 'submitted this' }, ...(v.cancelled ? [{ at: v.cancelledAt, who: v.cancelledBy, kind: 'cancelled', text: 'cancelled this' }] : []), ...(v.timelineExtra || [])], comment: true },
  });
  const reasonCapxul = `Posted by Capxul from ${run ? 'payroll run ' + run : p ? 'a payment on chain' : 'its own month-end work'}: change the source, not the entry.`;
  let actions;
  if (v.__new) actions = [cx.btn('Save', { kind: 'primary', needs: needBooks, cmd: 'capxul org doc create journal-entry --input entry.json', onClick: () => saveJournalEntry(v) })];
  else if (draft) actions = [cx.btn('Delete', { needs: needBooks, cmd: `capxul org doc remove journal-entry ${v.name}`, onClick: async () => { if (await cx.confirm({ title: `Delete ${v.name}?`, body: 'A draft leaves no trace in the books.', cmd: `capxul org doc remove journal-entry ${v.name}`, danger: true, confirmLabel: 'Delete the draft' })) { B.vouchers.splice(B.vouchers.indexOf(v), 1); VCH.delete(v.name); cx.go('journal-entries'); } } }), cx.btn('Post', { kind: 'primary', icon: 'check', needs: needBooks, cmd: `capxul org doc submit journal-entry ${v.name}`, onClick: () => postJournalEntry(v) })];
  else if (v.cancelled) actions = [cx.btn('Amend', { kind: 'primary', needs: needBooks, cmd: `capxul org doc amend journal-entry ${v.name}`, onClick: () => newJournalEntry({ entryType: v.entryType, title: v.title, lines: lines.map((l) => ({ account: accLabel(l.account), partyType: l.partyType || '', party: l.party || '', debit: l.debit, credit: l.credit })) }) })];
  else actions = [
    cx.menu('View', [{ label: 'Ledger', icon: 'report', cmd: `capxul org report run general-ledger --filter voucher_no=${v.name}`, onClick: () => cx.go('general-ledger', null, { report: { voucher: v.name, from: v.date, to: TODAY, account: '', party: '' } }) }]),
    cx.menu('Actions', [{ label: 'Reverse journal entry', icon: 'swap', needs: needBooks, disabled: capxul, reason: reasonCapxul, cmd: 'capxul org doc create journal-entry --input reversal.json', onClick: () => newJournalEntry({ entryType: v.entryType === 'Opening Entry' ? 'Journal Entry' : v.entryType, title: `Reversal of ${v.name}: ${v.title}`, reversalOf: v.name, lines: lines.map((l) => ({ account: accLabel(l.account), partyType: l.partyType || '', party: l.party || '', debit: l.credit, credit: l.debit })) }) }, { label: 'Duplicate', icon: 'plus', needs: needBooks, disabled: capxul, reason: reasonCapxul, onClick: () => newJournalEntry({ entryType: v.entryType, title: v.title, lines: lines.map((l) => ({ account: accLabel(l.account), partyType: l.partyType || '', party: l.party || '', debit: l.debit, credit: l.credit })) }) }]),
    cx.btn('Cancel', { needs: needBooks, disabled: capxul, reason: reasonCapxul, cmd: `capxul org doc cancel journal-entry ${v.name}`, onClick: async () => { if (await cx.confirm({ title: `Cancel ${v.name}?`, body: 'Its ledger lines are reversed. Amend it to make a corrected copy.', cmd: `capxul org doc cancel journal-entry ${v.name}`, danger: true, confirmLabel: 'Cancel the entry' })) { for (const l of linesOf(v.name)) l.isCancelled = 1; v.cancelled = true; v.cancelledAt = NOW(); v.cancelledBy = cx.meId(); cx.refresh(); cx.toast(`Cancelled ${v.name}`); } } }),
  ];
  return cx.page({
    title: v.__new ? 'New journal entry' : v.title || v.name, crumbs: crumbs({ label: 'Journal entries', route: 'journal-entries' }),
    status: [cx.pill(jeStatus(v), draft || v.cancelled ? null : 'blue', { lg: true })],
    sub: v.__new ? 'Not saved' : `${v.name} · ${fmt.date(v.date)} · ${fmt.gbp(v.total)}`,
    cmd: { cli: v.__new ? 'capxul org doc create journal-entry --input entry.json' : `capxul org doc get journal-entry ${v.name}`, kind: 'family', sdk: `client.org(orgId).docs.get("journal-entry", "${v.name}")`, who: 'anyone with a seat reads it; the Books hat posts one',
      json: v.__new ? undefined : { name: v.name, voucher_type: v.entryType, posting_date: v.date, total_debit: v.total, accounts: lines.slice(0, 6).map((l) => ({ account: accLabel(l.account), debit: l.debit, credit: l.credit })) } },
    banner: capxul && !draft ? cx.banner(h('span', 'Posted by Capxul', run ? [' from payroll run ', cx.hasRoute('payroll-run') ? cx.link(run, 'payroll-run', run) : run] : p ? ' from a payment on chain; its proof is below' : v.entryType === 'Exchange Rate Revaluation' ? ': the month-end revaluation of the USDC accounts at the day’s rate' : v.entryType === 'Depreciation Entry' ? ': the month’s depreciation of the equipment register' : '', '. It is read-only.'), { tone: 'info' }) : draft && !v.__new ? cx.banner('Post this entry to make it final. Lines on a Safe’s account are refused: only the chain posts there.', { tone: 'info' }) : v.__new ? cx.banner('Lines on a Safe’s account are refused: only the chain posts there.', { tone: 'info' }) : null,
    fde: `Journal entry ${v.name}: ${v.title}`,
    actions, body: form,
  });
}
cx.route('journal-entry', (ctx) => {
  const v = cx.find(B.vouchers, 'name', ctx.id);
  if (!v) return cx.page({ title: 'Not found', crumbs: crumbs({ label: 'Journal entries', route: 'journal-entries' }), body: cx.empty('No such journal entry') });
  if (v.type === 'Payment Entry') return pePage(v);
  return jePage(v);
}, { workspace: 'books', title: 'Journal entry' });

/* =====================================================================================================
   Reports: general ledger, trial balance, profit and loss, balance sheet, cash flow
   ===================================================================================================== */

const fyOptions = () => FYS.map((y) => [y.name, `${y.name}${y.closed ? ' (closed)' : ''}`]);
const ccOptions = () => [['', 'All cost centres'], ...B.costCenters.filter((c) => !c.isGroup).map((c) => [c.name, c.name])];
const projOptions = () => [['', 'All projects'], ...(D.projects?.projects || []).map((p) => [p.name, `${p.name} · ${p.projectName}`])];
const accOptions = () => [['', 'All accounts'], ...B.accounts.filter((a) => a.code && !a.isGroup).map((a) => [a.code, `${a.code} · ${a.name}`])];
const gbpCol = (key, label, o = {}) => ({ key, label, type: 'currency', currency: 'GBP', ...o });
const reportCmd = (name, pairs) => ({ cli: `capxul org report run ${name}${pairs.filter(([, v]) => v !== '' && v != null && v !== false).map(([k, v]) => ` --filter ${qv(`${k}=${v}`)}`).join('')}`, sdk: `client.org(orgId).reports.run("${name}", { … })`, kind: 'proposed', who: 'anyone with a seat' });
/** When the fiscal year filter changes, its dates follow, and the page redraws so the inputs show them. */
function followFy(v, memo) {
  if (memo.fy === undefined) { memo.fy = v.fy; return false; }
  if (v.fy === memo.fy) return false;
  memo.fy = v.fy; const y = fyOf(v.fy); v.from = y.start; v.to = minD(y.end, TODAY);
  queueMicrotask(() => cx.refresh());
  return true;
}
const fyMemo = { tb: {}, pl: {}, bs: {}, cf: {} };
function accCell(code, from, to, extra) {
  return h('span.ac-tb-acct', h('a', { href: cx.href('general-ledger'), onclick: (e) => { e.preventDefault(); cx.go('general-ledger', null, ledgerState(code, from, to)); } }, accLabel(code)), extra || null);
}

cx.route('general-ledger', () => cx.page({
  title: 'General ledger', crumbs: crumbs(),
  fde: 'The general ledger',
  body: cx.reportView({
    key: 'ac-gl',
    filters: [
      { key: 'from', label: 'From date', type: 'date', value: TODAY.slice(0, 7) + '-01' },
      { key: 'to', label: 'To date', type: 'date', value: TODAY },
      { key: 'account', label: 'Account', type: 'select', options: accOptions, value: '' },
      { key: 'voucher', label: 'Voucher no', type: 'text', value: '' },
      { key: 'party', label: 'Party', type: 'text', value: '' },
      { key: 'costCenter', label: 'Cost centre', type: 'select', options: ccOptions, value: '' },
      { key: 'project', label: 'Project', type: 'select', options: projOptions, value: '' },
      { key: 'groupBy', label: 'Categorise by', type: 'select', options: [['voucher', 'Voucher (consolidated)'], ['account', 'Account'], ['party', 'Party']], value: 'voucher' },
      { key: 'cancelled', label: 'Show cancelled entries', type: 'check', value: false },
    ],
    related: [cx.btn('Trial balance', { sm: true, href: ['trial-balance'] }), cx.btn('Money facts', { sm: true, href: ['money-facts'] })],
    cmd: (v) => reportCmd('general-ledger', [['from_date', v.from], ['to_date', v.to], ['account', v.account], ['voucher_no', v.voucher], ['party', v.party], ['cost_center', v.costCenter], ['project', v.project], ['group_by', v.groupBy === 'voucher' ? 'Group by Voucher (Consolidated)' : v.groupBy === 'account' ? 'Group by Account' : 'Group by Party'], ['show_cancelled_entries', v.cancelled ? 1 : '']]),
    run: (v) => {
      const pq = String(v.party || '').toLowerCase(), vq = String(v.voucher || '').toLowerCase();
      const base = (r) => (!v.account || r.account === v.account) && (!v.costCenter || r.costCenter === v.costCenter) && (!v.project || r.project === v.project) && (!pq || partyName(r.partyType, r.party).toLowerCase().includes(pq)) && (v.cancelled || !r.isCancelled);
      const inRange = (r) => r.date >= v.from && r.date <= v.to && (!vq || r.voucher.toLowerCase().includes(vq));
      const usdc = v.account && isUsdcAcc(v.account);
      const merged = new Map();
      for (const r of GL) {
        if (!base(r) || !inRange(r)) continue;
        const k = `${r.voucher}|${r.account}|${r.party || ''}|${r.against || ''}|${r.isCancelled ? 1 : 0}`;
        const o = merged.get(k) || { ...r, debit: 0, credit: 0, accDebit: 0, accCredit: 0 };
        o.debit += r.debit; o.credit += r.credit; o.accDebit += r.accDebit || 0; o.accCredit += r.accCredit || 0;
        merged.set(k, o);
      }
      const lines = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date) || a.voucher.localeCompare(b.voucher));
      const openOf = (pred) => { let d = 0, c = 0, ad = 0, ac = 0; for (const r of GL) if (r.date < v.from && base(r) && pred(r)) { d += r.debit; c += r.credit; ad += r.accDebit || 0; ac += r.accCredit || 0; } return { d, c, ad, ac }; };
      const MAX = 400;
      const decorate = (r) => {
        const vch = VCH.get(r.voucher);
        const others = [...new Set(linesOf(r.voucher).map((x) => x.account).filter((a) => a !== r.account))];
        const pay = vch?.payment ? payById(vch.payment) : null;
        return { ...r, id: `${r.voucher}|${r.account}|${r.party || ''}|${r.against || ''}`, voucherType: r.type, subtype: vch?.entryType || vch?.paymentType || r.type, againstAcc: others.slice(0, 2).join(', ') + (others.length > 2 ? ` +${others.length - 2}` : ''), partyLabel: r.party ? partyName(r.partyType, r.party) : '', proof: pay?.proof ? pay.proof.paymentId : null, payId: pay?.id, accBal: null };
      };
      const rows = [];
      const block = (label, list, pred) => {
        const op = openOf(pred);
        let bal = op.d - op.c, abal = op.ad - op.ac, td = 0, tc = 0, tad = 0, tac = 0;
        if (label) rows.push({ id: 'h:' + label, account: label, group: true });
        if (near0(bal)) bal = 0;
        rows.push({ id: 'o:' + label, date: null, account: 'Opening', debit: op.d - op.c > 0 ? op.d - op.c : 0, credit: op.d - op.c < 0 ? op.c - op.d : 0, balance: bal, accBal: usdc ? abal : null, bold: true });
        for (const r of list) { bal += r.debit - r.credit; abal += (r.accDebit || 0) - (r.accCredit || 0); td += r.debit; tc += r.credit; tad += r.accDebit || 0; tac += r.accCredit || 0; if (rows.length < MAX) rows.push({ ...decorate(r), balance: near0(bal) ? 0 : r2(bal), accBal: usdc ? abal : null }); }
        rows.push({ id: 't:' + label, account: 'Total', debit: td, credit: tc, accDebit: usdc ? tad : null, accCredit: usdc ? tac : null, bold: true });
        rows.push({ id: 'c:' + label, account: 'Closing (Opening + Total)', debit: (op.d - op.c > 0 ? op.d - op.c : 0) + td, credit: (op.d - op.c < 0 ? op.c - op.d : 0) + tc, balance: near0(bal) ? 0 : r2(bal), accBal: usdc ? abal : null, bold: true });
      };
      if (v.groupBy === 'account') { const by = new Map(); for (const r of lines) addTo(by, r.account, r); for (const [code, list] of [...by.entries()].sort()) block(accLabel(code), list, (r) => r.account === code); }
      else if (v.groupBy === 'party') { const by = new Map(); for (const r of lines) addTo(by, r.party ? `${r.partyType}|${r.party}` : '|', r); for (const [k, list] of [...by.entries()].sort()) { const [t, id] = k.split('|'); block(id ? `${t}: ${partyName(t, id)}` : 'No party', list, (r) => (r.party || '') === id); } }
      else block(null, lines, () => true);
      const columns = [
        { key: 'date', label: 'Posting date', type: 'date' },
        { key: 'account', label: 'Account', width: '200px', render: (r) => (r.voucher ? accCell(r.account, v.from, v.to) : h('b', r.account)) },
        gbpCol('debit', 'Debit (GBP)'), gbpCol('credit', 'Credit (GBP)'), gbpCol('balance', 'Balance (GBP)'),
        ...(usdc ? [{ key: 'accDebit', label: 'Debit (USDC)', type: 'usdc', dp: 6 }, { key: 'accCredit', label: 'Credit (USDC)', type: 'usdc', dp: 6 }, { key: 'accBal', label: 'Balance (USDC)', type: 'usdc', dp: 6 }] : []),
        { key: 'voucherType', label: 'Voucher type' },
        { key: 'subtype', label: 'Voucher subtype' },
        { key: 'voucher', label: 'Voucher no', render: (r) => (r.voucher ? vLink(r.voucher, r.type) : '') },
        { key: 'againstAcc', label: 'Against account' },
        { key: 'partyType', label: 'Party type' },
        { key: 'partyLabel', label: 'Party' },
        { key: 'project', label: 'Project' },
        { key: 'costCenter', label: 'Cost centre' },
        { key: 'against', label: 'Against voucher', render: (r) => (r.against && r.against !== r.voucher ? vLink(r.against, r.againstType) : '') },
        { key: 'proof', label: 'Proof', render: (r) => (r.proof ? h('a.mono', { href: cx.href(VROUTE[r.type] || 'payment-entry', r.voucher), title: `Payment ${r.payId}: open its proof`, style: 'font-size:12px' }, fmt.hash(r.proof)) : '') },
      ];
      return { columns, rows, totals: false, message: lines.length > MAX ? `Showing the first ${MAX} of ${fmt.int(lines.length)} lines. Narrow the dates or pick an account.` : null, messageTone: 'warning', empty: 'No ledger lines for these filters.' };
    },
  }),
}), { workspace: 'books', title: 'General ledger' });

cx.route('trial-balance', () => cx.page({
  title: 'Trial balance', crumbs: crumbs(), fde: 'The trial balance',
  body: cx.reportView({
    key: 'ac-tb',
    filters: [
      { key: 'fy', label: 'Fiscal year', type: 'select', options: fyOptions, value: CUR_FY.name },
      { key: 'from', label: 'From date', type: 'date', value: CUR_FY.start },
      { key: 'to', label: 'To date', type: 'date', value: monthEnd(monthsBetween(CUR_FY.start, TODAY).filter((m) => monthEnd(m) < TODAY).pop()) },
      { key: 'costCenter', label: 'Cost centre', type: 'select', options: ccOptions, value: '' },
      { key: 'zero', label: 'Show zero values', type: 'check', value: false },
      { key: 'groups', label: 'Show group accounts', type: 'check', value: true },
    ],
    related: [cx.btn('General ledger', { sm: true, href: ['general-ledger'] }), cx.btn('Balance sheet', { sm: true, href: ['balance-sheet'] })],
    cmd: (v) => ({ cli: `capxul org books reports trial-balance --as-of ${v.to}`, sdk: `client.org(orgId).books.reports.trialBalance({ asOf: "${v.to}" })`, who: 'anyone with a seat' }),
    run: (v) => {
      followFy(v, fyMemo.tb);
      const before = sumGl({ to: addDays(v.from, -1), cc: v.costCenter || null });
      const during = sumGl({ from: v.from, to: v.to, exclClosing: true, cc: v.costCenter || null });
      const keys = ['openingDr', 'openingCr', 'debit', 'credit', 'closingDr', 'closingCr'];
      const leaf = (a) => {
        const op = netOf(before, a.code); const m = during.get(a.code) || { debit: 0, credit: 0 };
        const cl = op + m.debit - m.credit;
        if (!v.zero && near0(op) && near0(m.debit) && near0(m.credit)) return null;
        const holds = isUsdcAcc(a.code) ? accNetOf(before, a.code) + accNetOf(during, a.code) : null;
        return { openingDr: op > 0 ? op : 0, openingCr: op < 0 ? -op : 0, debit: m.debit, credit: m.credit, closingDr: cl > 0 ? cl : 0, closingCr: cl < 0 ? -cl : 0, holds };
      };
      let rows = treeRows(ROOTS(), 0, leaf, keys, { hideEmpty: true });
      if (!v.groups) rows = rows.filter((r) => !r.group).map((r) => ({ ...r, indent: 0 }));
      const leafs = rows.filter((r) => !r.group);
      const dr = sum(leafs, 'closingDr'), cr = sum(leafs, 'closingCr');
      return {
        columns: [
          { key: 'account', label: 'Account', width: '300px', render: (r) => (r.code && !r.group ? accCell(r.code, v.from, v.to, r.holds != null ? h('span.ac-holds', `holds ${fmt.usdc(r.holds, 6)}`) : null) : r.account) },
          gbpCol('openingDr', 'Opening (Dr)'), gbpCol('openingCr', 'Opening (Cr)'), gbpCol('debit', 'Debit'), gbpCol('credit', 'Credit'), gbpCol('closingDr', 'Closing (Dr)'), gbpCol('closingCr', 'Closing (Cr)'),
        ],
        rows, totals: true,
        message: near0(dr - cr) ? `Debits equal credits: ${fmt.gbp(dr)}. ${v.from <= CLOSED_THROUGH ? `Books are closed through ${fmt.date(CLOSED_THROUGH)}; the year-end close is left out of the movement.` : `The Safes’ rows hold what the chain holds.`}` : `Out of balance by ${fmt.gbp(dr - cr)}`, messageTone: near0(dr - cr) ? 'success' : 'danger',
      };
    },
  }),
}), { workspace: 'books', title: 'Trial balance' });

cx.route('profit-and-loss', () => cx.page({
  title: 'Profit and loss', crumbs: crumbs(), fde: 'The profit and loss statement',
  body: cx.reportView({
    key: 'ac-pl',
    filters: [
      { key: 'fy', label: 'Fiscal year', type: 'select', options: fyOptions, value: CUR_FY.name },
      { key: 'from', label: 'Start date', type: 'date', value: CUR_FY.start },
      { key: 'to', label: 'End date', type: 'date', value: monthEnd(monthsBetween(CUR_FY.start, TODAY).filter((m) => monthEnd(m) < TODAY).pop()) },
      { key: 'periodicity', label: 'Periodicity', type: 'select', options: ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly'], value: 'Monthly' },
      { key: 'costCenter', label: 'Department (cost centre)', type: 'select', options: ccOptions, value: '' },
      { key: 'project', label: 'Project', type: 'select', options: projOptions, value: '' },
      { key: 'accumulated', label: 'Accumulated values', type: 'check', value: false },
      { key: 'zero', label: 'Show zero values', type: 'check', value: false },
    ],
    related: [cx.btn('Balance sheet', { sm: true, href: ['balance-sheet'] }), cx.btn('Cash flow', { sm: true, href: ['cash-flow'] })],
    cmd: (v) => ({ cli: `capxul org books reports profit-and-loss --from ${v.from} --to ${v.to}`, sdk: `client.org(orgId).books.reports.profitAndLoss({ from: "${v.from}", to: "${v.to}" })`, who: 'anyone with a seat' }),
    run: (v) => {
      followFy(v, fyMemo.pl);
      const periods = periodsOf(v.from, v.to, v.periodicity);
      const sums = periods.map((p) => sumGl({ from: p.from, to: p.to, exclClosing: true, cc: v.costCenter || null, project: v.project || null }));
      const keys = [...periods.map((p) => p.key), 'total'];
      const leaf = (a) => {
        let run = 0; const o = {};
        periods.forEach((p, i) => { const x = plVal(sums[i], a.code); run += x; o[p.key] = v.accumulated ? run : x; });
        o.total = run;
        if (!v.zero && periods.every((p) => near0(o[p.key])) && near0(o.total)) return null;
        return o;
      };
      const inc = treeRows([rootOf('Income')], 0, leaf, keys, { hideEmpty: false });
      const exp = treeRows([rootOf('Expense')], 0, leaf, keys, { hideEmpty: false });
      const ti = inc[0] || {}, te = exp[0] || {};
      const net = Object.fromEntries(keys.map((k) => [k, (ti[k] || 0) - (te[k] || 0)]));
      const rows = [...inc, { id: 'ti', account: 'Total income (credit)', total: true, ...Object.fromEntries(keys.map((k) => [k, ti[k] || 0])) }, ...exp, { id: 'te', account: 'Total expense (debit)', total: true, ...Object.fromEntries(keys.map((k) => [k, te[k] || 0])) }, { id: 'np', account: 'Profit for the year', total: true, ...net }];
      const flat = periods.map((p, i) => { let a = 0, b = 0; for (const code of sums[i].keys()) { const r = acc(code)?.rootType; if (r === 'Income') a += plVal(sums[i], code); else if (r === 'Expense') b += plVal(sums[i], code); } return { inc: a, exp: b }; });
      return {
        columns: [{ key: 'account', label: 'Account', width: '260px', render: (r) => (r.code && !r.group ? accCell(r.code, v.from, v.to) : r.account) }, ...periods.map((p) => gbpCol(p.key, p.label)), gbpCol('total', 'Total')],
        rows,
        summary: [
          { label: v.accumulated ? 'Total income this year' : 'Total income', value: fmt.gbp(ti.total || 0), sub: `${fmt.date(v.from)} to ${fmt.date(v.to)}` },
          { label: 'Total expense', value: fmt.gbp(te.total || 0), sub: v.costCenter ? `${v.costCenter} only` : 'every department' },
          { label: 'Net profit', value: fmt.gbp(net.total || 0), delta: { text: (ti.total || 0) ? `${fmt.num(((net.total || 0) / ti.total) * 100, 1)}% margin` : '—', good: (net.total || 0) >= 0 } },
        ],
        chart: periods.length > 1 ? cx.chart.bar({ labels: periods.map((p) => p.label.replace(/ \(to .*\)$/, '').replace(/ \d{4}$/, '')), series: [{ name: 'Income', values: flat.map((x) => x.inc), color: 'pos' }, { name: 'Expense', values: flat.map((x) => x.exp), color: 'neg' }], line: { name: 'Net profit', values: flat.map((x) => x.inc - x.exp) }, format: (x) => fmt.compact(x, 'GBP'), tipFormat: (x) => fmt.gbp(x) }) : null,
        chartTitle: 'Income, expense and net profit',
      };
    },
  }),
}), { workspace: 'books', title: 'Profit and loss' });

cx.route('balance-sheet', () => cx.page({
  title: 'Balance sheet', crumbs: crumbs(), fde: 'The balance sheet',
  body: cx.reportView({
    key: 'ac-bs',
    filters: [
      { key: 'fy', label: 'Fiscal year', type: 'select', options: fyOptions, value: CUR_FY.name },
      { key: 'periodicity', label: 'Periodicity', type: 'select', options: ['Monthly', 'Quarterly', 'Yearly'], value: 'Quarterly' },
      { key: 'zero', label: 'Show zero values', type: 'check', value: false },
    ],
    related: [cx.btn('Profit and loss', { sm: true, href: ['profit-and-loss'] }), cx.btn('Trial balance', { sm: true, href: ['trial-balance'] })],
    cmd: (v) => { const y = fyOf(v.fy); const asOf = minD(y.end, TODAY); return { cli: `capxul org books reports balance-sheet --as-of ${asOf}`, sdk: `client.org(orgId).books.reports.balanceSheet({ asOf: "${asOf}" })`, who: 'anyone with a seat' }; },
    run: (v) => {
      const y = fyOf(v.fy);
      const periods = periodsOf(y.start, minD(y.end, TODAY), v.periodicity).map((p) => ({ ...p, label: p.to === TODAY ? `${fmt.date(TODAY)} (today)` : fmt.date(p.to) }));
      const bals = periods.map((p) => sumGl({ to: p.to }));
      const keys = periods.map((p) => p.key);
      const sign = (a) => (a.rootType === 'Asset' ? 1 : -1);
      const leaf = (a) => { const o = {}; periods.forEach((p, i) => { o[p.key] = sign(a) * netOf(bals[i], a.code); }); if (!v.zero && keys.every((k) => near0(o[k]))) return null; return o; };
      const block = (rt) => treeRows([rootOf(rt)], 0, leaf, keys, { hideEmpty: false });
      const as = block('Asset'), li = block('Liability'), eq = block('Equity');
      const profit = Object.fromEntries(periods.map((p, i) => { let x = 0; for (const code of bals[i].keys()) if (isPL(code)) x -= netOf(bals[i], code); return [p.key, x]; }));
      const tot = (rows) => Object.fromEntries(keys.map((k) => [k, rows[0]?.[k] || 0]));
      const ta = tot(as), tl = tot(li), te = tot(eq);
      const total = Object.fromEntries(keys.map((k) => [k, tl[k] + te[k] + profit[k]]));
      const last = keys[keys.length - 1];
      const diff = ta[last] - total[last];
      return {
        columns: [{ key: 'account', label: 'Account', width: '260px', render: (r) => (r.code && !r.group ? accCell(r.code, y.start, periods[periods.length - 1].to) : r.account) }, ...periods.map((p) => gbpCol(p.key, p.label))],
        rows: [...as, { id: 'ta', account: 'Total asset (debit)', total: true, ...ta }, ...li, { id: 'tl', account: 'Total liability (credit)', total: true, ...tl }, ...eq, { id: 'te', account: 'Total equity (credit)', total: true, ...te },
          { id: 'pp', account: 'Profit this year, not yet closed', bold: true, ...profit }, { id: 'tt', account: 'Total (credit)', total: true, ...total }],
        summary: [
          { label: 'Total asset', value: fmt.gbp(ta[last]), sub: `at ${periods[periods.length - 1].label}` },
          { label: 'Total liability', value: fmt.gbp(tl[last]) },
          { label: 'Total equity', value: fmt.gbp(te[last]) },
          { label: 'Profit this year, not yet closed', value: fmt.gbp(profit[last]), delta: { text: profit[last] >= 0 ? 'credit' : 'debit: a loss so far', good: profit[last] >= 0 } },
        ],
        chart: cx.chart.bar({ labels: periods.map((p) => fmt.day(p.to)), series: [{ name: 'Assets', values: keys.map((k) => ta[k]), color: '1' }, { name: 'Liabilities', values: keys.map((k) => tl[k]), color: '3' }, { name: 'Equity', values: keys.map((k) => te[k]), color: '2' }], format: (x) => fmt.compact(x, 'GBP'), tipFormat: (x) => fmt.gbp(x) }),
        chartTitle: 'Assets, liabilities and equity',
        message: near0(diff) ? 'Assets equal liabilities, equity and this year’s profit.' : `Out of balance by ${fmt.gbp(diff)}`, messageTone: near0(diff) ? 'success' : 'danger',
      };
    },
  }),
}), { workspace: 'books', title: 'Balance sheet' });

const CASH = ['1010', '1020', '1030', '1040', '1050'];
const OTHER_WC = ['1300', '1400', '2101', '2102', '2200', '2300', '2400', '2500', '2600', '2700'];
const EQUITY = ['3000', '3100', '3200', '3300', '3990'];
cx.route('cash-flow', () => cx.page({
  title: 'Cash flow', crumbs: crumbs(), fde: 'The cash flow statement',
  body: cx.reportView({
    key: 'ac-cf',
    filters: [
      { key: 'fy', label: 'Fiscal year', type: 'select', options: fyOptions, value: CUR_FY.name },
      { key: 'periodicity', label: 'Periodicity', type: 'select', options: ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly'], value: 'Monthly' },
      { key: 'opening', label: 'Show opening and closing balance', type: 'check', value: true },
    ],
    related: [cx.btn('Banking', { sm: true, href: ['banking'] })],
    cmd: (v) => { const y = fyOf(v.fy); return reportCmd('cash-flow', [['period_start_date', y.start], ['period_end_date', minD(y.end, TODAY)], ['periodicity', v.periodicity]]); },
    run: (v) => {
      const y = fyOf(v.fy);
      const periods = periodsOf(y.start, minD(y.end, TODAY), v.periodicity);
      const keys = [...periods.map((p) => p.key), 'total'];
      const S = periods.map((p) => sumGl({ from: p.from, to: p.to, exclClosing: true }));
      const neg = (s, codes) => -codes.reduce((a, c) => a + netOf(s, c), 0);
      const line = (f) => { const o = {}; let t = 0; periods.forEach((p, i) => { o[p.key] = f(S[i], p); t += o[p.key]; }); o.total = t; return o; };
      const profit = line((s) => { let x = 0; for (const c of s.keys()) if (isPL(c)) x -= netOf(s, c); return x; });
      const dep = line((s) => neg(s, ['1510']));
      const ar = line((s) => neg(s, ['1200']));
      const ap = line((s) => neg(s, ['2000']));
      const other = line((s) => neg(s, OTHER_WC));
      const add = (...ls) => Object.fromEntries(keys.map((k) => [k, ls.reduce((a, l) => a + (l[k] || 0), 0)]));
      const ops = add(profit, dep, ar, ap, other);
      const fixed = line((s) => neg(s, ['1500']));
      const fin = line((s) => neg(s, EQUITY));
      const change = add(ops, fixed, fin);
      const opening = {}; const closing = {};
      periods.forEach((p) => { const b = sumGl({ to: addDays(p.from, -1) }); opening[p.key] = CASH.reduce((a, c) => a + netOf(b, c), 0); closing[p.key] = opening[p.key] + change[p.key]; });
      opening.total = opening[periods[0].key]; closing.total = closing[periods[periods.length - 1].key];
      const actual = line((s) => CASH.reduce((a, c) => a + netOf(s, c), 0));
      const rows = [
        { id: 'ops', account: 'Cash flow from operations', indent: 0, group: true },
        { id: 'p', account: 'Profit for the period', indent: 1, ...profit },
        { id: 'd', account: 'Depreciation', indent: 1, ...dep },
        { id: 'ar', account: 'Net change in accounts receivable', indent: 1, ...ar },
        { id: 'ap', account: 'Net change in accounts payable', indent: 1, ...ap },
        { id: 'o', account: 'Net change in other balance sheet accounts', indent: 1, ...other },
        { id: 'no', account: 'Net cash from operations', indent: 1, total: true, ...ops },
        { id: 'inv', account: 'Cash flow from investing', indent: 0, group: true },
        { id: 'fa', account: 'Net change in fixed assets', indent: 1, ...fixed },
        { id: 'ni', account: 'Net cash from investing', indent: 1, total: true, ...fixed },
        { id: 'fin', account: 'Cash flow from financing', indent: 0, group: true },
        { id: 'eq', account: 'Net change in equity', indent: 1, ...fin },
        { id: 'nf', account: 'Net cash from financing', indent: 1, total: true, ...fin },
        { id: 'nc', account: 'Net change in cash', indent: 0, total: true, ...change },
        ...(v.opening ? [{ id: 'ob', account: 'Opening balance', indent: 0, bold: true, ...opening }, { id: 'cb', account: 'Closing balance', indent: 0, bold: true, ...closing }] : []),
      ];
      const off = Math.abs(actual.total - change.total);
      return {
        columns: [{ key: 'account', label: 'Section', width: '280px' }, ...periods.map((p) => gbpCol(p.key, p.label)), gbpCol('total', 'Total')],
        rows,
        summary: [
          { label: 'Net cash from operations', value: fmt.gbp(ops.total), delta: { text: ops.total >= 0 ? 'cash in' : 'cash out', good: ops.total >= 0 } },
          { label: 'Net cash from investing', value: fmt.gbp(fixed.total) },
          { label: 'Net cash from financing', value: fmt.gbp(fin.total) },
          { label: 'Cash at the end', value: fmt.gbp(closing.total), sub: 'two Safes, money waiting, payouts in transit, Barclays' },
        ],
        chart: cx.chart.bar({ labels: periods.map((p) => p.label.replace(/ \(to .*\)$/, '').replace(/ \d{4}$/, '')), series: [{ name: 'Operations', values: periods.map((p) => ops[p.key]), color: '1' }, { name: 'Investing', values: periods.map((p) => fixed[p.key]), color: '3' }, { name: 'Financing', values: periods.map((p) => fin[p.key]), color: '2' }], line: { name: 'Net change in cash', values: periods.map((p) => change[p.key]) }, format: (x) => fmt.compact(x, 'GBP'), tipFormat: (x) => fmt.gbp(x) }),
        chartTitle: 'Where the cash came from',
        message: off < 0.01 ? 'Cash is the two Safes, money waiting, payouts in transit and the Barclays account. The net change equals their movement in the ledger.' : `The net change differs from the cash accounts’ movement by ${fmt.gbp(off)}.`, messageTone: off < 0.01 ? 'info' : 'warning',
      };
    },
  }),
}), { workspace: 'books', title: 'Cash flow' });

/* =====================================================================================================
   Receivables and payables, with ageing
   ===================================================================================================== */

function ageingRows(kind, v) {
  const ar = kind === 'ar';
  const ranges = String(v.ranges || '30, 60, 90, 120').split(/[,\s]+/).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
  const labels = ranges.map((r, i) => `${i ? ranges[i - 1] + 1 : 0}-${r}`).concat(`${ranges[ranges.length - 1] + 1}-above`);
  const docs = (ar ? B.salesInvoices : B.purchaseInvoices).filter((d) => d.docstatus !== 0 && d.docstatus !== 2 && !d.isReturn && d.postingDate <= v.date);
  const rows = [];
  for (const d of docs) {
    const party = ar ? d.customerName : d.supplierName;
    if (v.party && party !== v.party) continue;
    if (v.costCenter && d.costCenter !== v.costCenter) continue;
    const paid = sum((d.payments || []).filter((p) => p.date <= v.date), 'amount');
    const credit = sum((ar ? B.salesInvoices : B.purchaseInvoices).filter((x) => x.isReturn && x.returnAgainst === d.name && x.docstatus === 1 && x.postingDate <= v.date), (x) => Math.abs(x.grandTotal));
    const out = r2(d.grandTotal - paid - credit);
    if (out <= 0.005) continue;
    const cr = v.partyCurrency ? 1 : d.conversionRate || 1;
    const age = daysBetween(v.basedOn === 'Posting date' ? d.postingDate : v.basedOn === 'Supplier invoice date' ? d.billDate || d.postingDate : d.dueDate, v.date);
    const row = { id: d.name, doc: d, date: d.postingDate, party, partyType: ar ? 'Customer' : 'Supplier', account: ar ? '1200 · Accounts receivable' : '2000 · Accounts payable', costCenter: d.costCenter, voucherType: ar ? 'Sales Invoice' : 'Purchase Invoice', voucher: d.name, dueDate: d.dueDate, billNo: d.billNo, invoiced: r2(d.grandTotal * cr), paid: r2(paid * cr), credit: r2(credit * cr), outstanding: r2(out * cr), age, currency: v.partyCurrency ? d.currency : 'GBP' };
    row.notDue = age <= 0 && v.basedOn === 'Due date' ? row.outstanding : 0;
    labels.forEach((l, i) => { row['b' + i] = 0; });
    if (!row.notDue) { let i = ranges.findIndex((r) => age <= r); if (i < 0) i = ranges.length; row['b' + i] = row.outstanding; }
    rows.push(row);
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { rows, labels };
}
function ageingBar(rows, labels) {
  const parts = [{ label: 'Not due', value: sum(rows, 'notDue') }, ...labels.map((l, i) => ({ label: l, value: sum(rows, 'b' + i) }))];
  const total = sum(parts, 'value') || 1;
  const colors = ['var(--chart-2)', 'var(--chart-1)', 'var(--chart-5)', 'var(--chart-3)', 'var(--chart-4)', 'var(--t-red)', 'var(--chart-6)'];
  return h('div.ac-age',
    h('div.ac-age-bar', parts.map((p, i) => (p.value > 0 ? h('i', { style: { width: `${(p.value / total) * 100}%`, background: colors[i % colors.length] }, title: `${p.label}: ${fmt.gbp(p.value)}` }) : null))),
    h('div.ac-age-legend', parts.map((p, i) => h('span', h('i', { style: { background: colors[i % colors.length] } }), `${p.label} `, h('b', fmt.gbp(p.value))))));
}
function ageingReport(kind) {
  const ar = kind === 'ar';
  const record = ar ? 'accounts-receivable' : 'accounts-payable';
  const parties = () => [['', ar ? 'All customers' : 'All suppliers'], ...[...new Set((ar ? B.salesInvoices.map((i) => i.customerName) : B.purchaseInvoices.map((i) => i.supplierName)))].sort().map((x) => [x, x])];
  return cx.page({
    title: ar ? 'Accounts receivable' : 'Accounts payable', crumbs: crumbs(), fde: ar ? 'Accounts receivable with ageing' : 'Accounts payable with ageing',
    body: cx.reportView({
      key: 'ac-' + kind,
      filters: [
        { key: 'date', label: 'Report date', type: 'date', value: TODAY },
        { key: 'basedOn', label: 'Ageing based on', type: 'select', options: ar ? ['Due date', 'Posting date'] : ['Due date', 'Posting date', 'Supplier invoice date'], value: 'Due date' },
        { key: 'ranges', label: 'Ageing range', type: 'text', value: '30, 60, 90, 120' },
        { key: 'party', label: ar ? 'Customer' : 'Supplier', type: 'select', options: parties, value: '' },
        { key: 'costCenter', label: 'Cost centre', type: 'select', options: ccOptions, value: '' },
        { key: 'partyCurrency', label: 'In party currency', type: 'check', value: false },
        { key: 'group', label: ar ? 'Group by customer' : 'Group by supplier', type: 'check', value: false },
      ],
      related: [cx.btn(ar ? 'Accounts receivable summary' : 'Accounts payable summary', { sm: true, href: [record + '-summary'] }), ar ? cx.btn('Requests sent', { sm: true, cmd: 'capxul request list', onClick: () => cx.toast('Capxul’s own view of what it is owed: the requests it has sent.', { cmd: 'capxul request list' }) }) : cx.btn('Inbox', { sm: true, cmd: 'capxul inbox list', onClick: () => cx.toast('What other Capxul companies have asked Harbourline to pay.', { cmd: 'capxul inbox list' }) })],
      cmd: (v) => reportCmd(record, [['report_date', v.date], ['ageing_based_on', v.basedOn === 'Due date' ? 'Due Date' : v.basedOn === 'Posting date' ? 'Posting Date' : 'Supplier Invoice Date'], ['range', v.ranges], [ar ? 'customer' : 'supplier', v.party], ['cost_center', v.costCenter], ['in_party_currency', v.partyCurrency ? 1 : '']]),
      run: (v) => {
        const { rows, labels } = ageingRows(kind, v);
        let out = rows;
        if (v.group) {
          out = [];
          const by = new Map(); for (const r of rows) addTo(by, r.party, r);
          for (const [party, list] of [...by.entries()].sort()) {
            const g = { id: 'g:' + party, party, group: true, date: null };
            for (const k of ['invoiced', 'paid', 'credit', 'outstanding', 'notDue', ...labels.map((_, i) => 'b' + i)]) g[k] = sum(list, k);
            out.push(g, ...list);
          }
        }
        const act = (r) => {
          if (!r.doc) return '';
          if (ar) return cx.btn('Request payment', { sm: true, needs: needInvoicing, cmd: requestCmd(r.doc), onClick: () => requestPayment(r.doc) });
          const f = piFlight(r.doc);
          if (f) return cx.pill(f.text, f.tone, { title: f.title });
          return payModeOf(SUPP.get(r.doc.supplier)) === 'outside' ? cx.btn('Record payment', { sm: true, needs: needBooks, onClick: () => recordPiPayment(r.doc) }) : cx.btn('Pay', { sm: true, needs: r.doc.department ? { dept: r.doc.department } : null, onClick: () => payBill([r.doc]) });
        };
        const cur = (key, label, o = {}) => ({ key, label, type: 'currency', ...o });
        return {
          columns: [
            { key: 'date', label: 'Posting date', type: 'date' },
            { key: 'party', label: ar ? 'Customer' : 'Supplier', render: (r) => (r.group ? h('b', r.party) : r.party) },
            { key: 'account', label: ar ? 'Receivable account' : 'Payable account' },
            { key: 'costCenter', label: 'Cost centre' },
            { key: 'voucherType', label: 'Voucher type' },
            { key: 'voucher', label: 'Voucher no', render: (r) => (r.voucher ? vLink(r.voucher, r.voucherType) : '') },
            { key: 'dueDate', label: 'Due date', type: 'date' },
            ...(ar ? [] : [{ key: 'billNo', label: 'Bill no' }]),
            cur('invoiced', 'Invoiced amount'), cur('paid', 'Paid amount'), cur('credit', ar ? 'Credit note' : 'Debit note'), cur('outstanding', 'Outstanding amount'),
            { key: 'age', label: 'Age (days)', type: 'int', total: false },
            cur('notDue', 'Not due'),
            ...labels.map((l, i) => cur('b' + i, l)),
            { key: 'currency', label: 'Currency' },
            { key: 'act', label: '', render: act },
          ],
          rows: out, totals: true,
          chart: ageingBar(rows, labels), chartTitle: `Ageing by ${v.basedOn.toLowerCase()}, at ${fmt.date(v.date)}`,
          empty: ar ? 'Nobody owes Harbourline anything at that date.' : 'Harbourline owes nothing at that date.',
        };
      },
    }),
  });
}
cx.route('accounts-receivable', () => ageingReport('ar'), { workspace: 'books', title: 'Accounts receivable' });
cx.route('accounts-payable', () => ageingReport('ap'), { workspace: 'books', title: 'Accounts payable' });

function ageingSummary(kind) {
  const ar = kind === 'ar';
  const record = ar ? 'accounts-receivable-summary' : 'accounts-payable-summary';
  return cx.page({
    title: ar ? 'Accounts receivable summary' : 'Accounts payable summary', crumbs: crumbs({ label: ar ? 'Accounts receivable' : 'Accounts payable', route: ar ? 'accounts-receivable' : 'accounts-payable' }),
    body: cx.reportView({
      key: 'ac-' + kind + '-sum',
      filters: [
        { key: 'date', label: 'Report date', type: 'date', value: TODAY },
        { key: 'basedOn', label: 'Ageing based on', type: 'select', options: ['Due date', 'Posting date'], value: 'Due date' },
        { key: 'ranges', label: 'Ageing range', type: 'text', value: '30, 60, 90, 120' },
        { key: 'costCenter', label: 'Cost centre', type: 'select', options: ccOptions, value: '' },
      ],
      related: [cx.btn(ar ? 'Accounts receivable' : 'Accounts payable', { sm: true, href: [ar ? 'accounts-receivable' : 'accounts-payable'] })],
      cmd: (v) => reportCmd(record, [['report_date', v.date], ['ageing_based_on', v.basedOn === 'Due date' ? 'Due Date' : 'Posting Date'], ['range', v.ranges], ['cost_center', v.costCenter]]),
      run: (v) => {
        const { rows, labels } = ageingRows(kind, { ...v, party: '', partyCurrency: false });
        const by = new Map(); for (const r of rows) addTo(by, r.party, r);
        const out = [...by.entries()].map(([party, list]) => {
          const o = { id: party, party, partyType: ar ? 'Customer' : 'Supplier', advance: 0, currency: 'GBP' };
          for (const k of ['invoiced', 'paid', 'credit', 'outstanding', 'notDue', ...labels.map((_, i) => 'b' + i)]) o[k] = sum(list, k);
          o.due = o.outstanding; return o;
        }).sort((a, b) => b.outstanding - a.outstanding);
        const cur = (key, label) => ({ key, label, type: 'currency' });
        return {
          columns: [{ key: 'partyType', label: 'Party type' }, { key: 'party', label: 'Party' }, cur('advance', 'Advance amount'), cur('invoiced', 'Invoiced amount'), cur('paid', 'Paid amount'), cur('credit', ar ? 'Credit note' : 'Debit note'), cur('outstanding', 'Outstanding amount'), cur('notDue', 'Not due'), ...labels.map((l, i) => cur('b' + i, l)), cur('due', 'Total amount due'), { key: 'currency', label: 'Currency' }],
          rows: out, totals: true, chart: ageingBar(rows, labels), chartTitle: 'Ageing',
        };
      },
    }),
  });
}
cx.route('accounts-receivable-summary', () => ageingSummary('ar'), { workspace: 'books', title: 'Accounts receivable summary' });
cx.route('accounts-payable-summary', () => ageingSummary('ap'), { workspace: 'books', title: 'Accounts payable summary' });

cx.route('vat-returns', () => {
  const q4 = sumGl({ from: '2026-10-01', to: TODAY });
  const open = { quarter: '2026-Q4', periodEnd: '2026-12-31', paidOn: null, sales: -netOf(q4, '2101'), purchases: netOf(q4, '2102'), status: 'Open' };
  open.net = r2(open.sales - open.purchases);
  const rows = [...B.vatReturns.map((r) => ({ ...r, status: r.paidOn <= TODAY ? 'Filed' : 'Due' })), open].reverse();
  return cx.page({ title: 'VAT returns', crumbs: crumbs(), fde: 'VAT returns',
    body: cx.reportView({ key: 'ac-vat', filters: [],
      cmd: () => reportCmd('vat-return', [['company', 'Harbourline Studio Ltd']]),
      run: () => ({ columns: [{ key: 'quarter', label: 'Quarter' }, { key: 'periodEnd', label: 'Period end', type: 'date' }, { key: 'status', label: 'Status', render: (r) => cx.pill(r.status, r.status === 'Open' ? 'orange' : r.status === 'Filed' ? 'green' : 'blue') }, gbpCol('sales', 'VAT on sales (box 1)'), gbpCol('purchases', 'VAT on purchases (box 4)'), gbpCol('net', 'Net VAT due (box 5)'), { key: 'paidOn', label: 'Paid on', type: 'date' }],
        rows, totals: false, message: `VAT number ${D.company.vatNumber}. Quarterly returns; the current quarter runs to ${fmt.date('2026-12-31')}. The 2026-Q3 payment left Barclays today.`, messageTone: 'info' }) }) });
}, { workspace: 'books', title: 'VAT returns' });

/* =====================================================================================================
   Banking: the Safes, money waiting, payouts in transit and the Barclays account, reconciled
   ===================================================================================================== */

const BARCLAYS = B.bankAccounts[0];
const bankState = { from: TODAY.slice(0, 7) + '-01', to: TODAY, sel: null, q: '', kind: 'All' };
const balAt = (code, d) => { let b = 0; for (const r of GL) if (r.account === code && r.date <= d && !r.isCancelled) b += r.debit - r.credit; return r2(b); };
const accBalAt = (code, d) => { let b = 0; for (const r of GL) if (r.account === code && r.date <= d && !r.isCancelled) b += (r.accDebit || 0) - (r.accCredit || 0); return r6(b); };
const amtOf = (t) => r2((t.deposit || 0) - (t.withdrawal || 0));
const BANK_CARDS = [
  { code: '1010', name: 'Treasury · USDC', mark: ['Safe', 'teal'], no: () => `${fmt.addr(M.safes.treasury.address)} · Base`, bal: () => fmt.usdc(M.safes.treasury.balance) },
  { code: '1020', name: 'Reserve Safe · USDC', mark: ['Safe', 'teal'], no: () => `${fmt.addr(M.safes.reserve.address)} · Base`, bal: () => fmt.usdc(M.safes.reserve.balance) },
  { code: '1030', name: 'Money waiting · USDC', mark: ['Escrow', 'escrow'], no: () => fmt.plural(M.escrows.filter((e) => e.status === 'Open').length, 'open escrow'), bal: () => fmt.usdc(M.safes.moneyWaiting.balance) },
  { code: '1040', name: 'Payouts in transit · GBP', mark: ['Bridge', 'blue'], no: () => fmt.plural(M.payouts.filter((p) => p.status === 'In transit').length, 'payout') + ' on the way', bal: () => fmt.gbp(balAt('1040', TODAY)) },
  { code: '1050', name: 'Barclays Business · GBP', mark: ['Bank', 'gray'], no: () => `${BARCLAYS.sortCode} · ····${BARCLAYS.last4}`, bal: () => fmt.gbp(balAt('1050', TODAY)) },
];
function balanceRows(rows) {
  return h('div.ac-balance', rows.filter(Boolean).map((r) => (r instanceof Node ? r : h('div.row', { class: r.cls }, h('span', r.label, r.sub ? h('span.ac-holds', r.sub) : null), h('span.num', r.value)))));
}
function stmtSummary() {
  const sd = BARCLAYS.statementTo;
  const onStmt = B.bankTransactions.filter((t) => t.onStatement);
  const uncleared = B.bankTransactions.filter((t) => t.status !== 'Reconciled' && t.date <= sd);
  const books = balAt('1050', sd);
  const cleared = r2(books - sum(uncleared, amtOf));
  return { sd, onStmt, rec: onStmt.filter((t) => t.status === 'Reconciled').length, cleared, books, diff: r2(BARCLAYS.statementBalance - cleared) };
}
function reconcileLine(t, voucher, how) {
  t.status = 'Reconciled'; t.matchedTo = voucher; t.reconciledBy = cx.meId(); t.reconciledAt = NOW();
  if (voucher && !t.voucher) t.voucher = voucher;
  BARCLAYS.reconciled = (BARCLAYS.reconciled || 0) + 1; BARCLAYS.toReconcile = Math.max(0, (BARCLAYS.toReconcile || 1) - 1);
  bankState.sel = null;
  const v = VCH.get(voucher); if (v) peCache.delete(v);
  const cmd = `capxul org doc change bank-transaction ${t.name} --input match.json`;
  cx.refresh();
  const left = stmtSummary();
  cx.toast(`${how || 'Reconciled'} ${t.name} with ${voucher}.${near0(left.diff) ? ' The difference is £0.00.' : ` Difference now ${fmt.gbp(left.diff)}.`}`, { tone: 'success', cmd });
}
function candidatesFor(t) {
  const amt = Math.abs(amtOf(t));
  const out = [];
  const clearedVouchers = new Set(B.bankTransactions.filter((x) => x.status === 'Reconciled').map((x) => x.matchedTo || x.voucher));
  const seen = new Set();
  for (const r of GL) {
    if (r.account !== '1050' || r.isCancelled || seen.has(r.voucher) || clearedVouchers.has(r.voucher)) continue;
    const net = r.debit - r.credit;
    if (Math.sign(net) !== Math.sign(amtOf(t))) continue;
    if (Math.abs(daysBetween(r.date, t.date)) > 12) continue;
    const exact = near0(Math.abs(net) - amt);
    if (!exact && r.voucher !== t.voucher) continue;
    seen.add(r.voucher);
    const v = VCH.get(r.voucher);
    out.push({ voucher: r.voucher, type: r.type, date: r.date, amount: Math.abs(net), title: v?.title || '', ref: v?.reference || B.bankTransactions.find((x) => x.voucher === r.voucher)?.reference || null, badge: r.voucher === t.voucher && exact ? 'Complete match' : exact ? 'Suggested' : 'Partial match' });
  }
  return out.sort((a, b) => (a.badge === 'Complete match' ? -1 : 0) - (b.badge === 'Complete match' ? -1 : 0));
}
function bankEntryFor(t) {
  const isOut = amtOf(t) < 0;
  const model = { account: isOut ? '6500 · Bank charges' : '4999 · Income, not decided', date: t.date, remark: t.description };
  cx.modal({ title: 'Bank entry', body: h('div', { style: 'display:grid;gap:12px' },
    h('p.ac-note', `${fmt.date(t.date)} · ${t.description} · ${fmt.gbp(amtOf(t))}. Record it as a bank journal entry: an expense, income or a split with no invoice behind it.`),
    h('div.ac-form-grid',
      cx.field({ label: isOut ? 'Expense account' : 'Income account', key: 'account', model, edit: true, type: 'select', options: leafOptions().filter((o) => !CAPXUL_ONLY.has(codeOf(o)) && codeOf(o) !== '1050'), reqd: true }),
      cx.field({ label: 'Posting date', key: 'date', model, edit: true, type: 'date' }),
      cx.field({ label: 'Remark', key: 'remark', model, edit: true, wide: true }))),
    actions: [{ label: 'Cancel' }, { label: 'Post and reconcile', primary: true, needs: needBooks, cmd: ['capxul org doc create journal-entry --input bank-entry.json', `capxul org doc change bank-transaction ${t.name} --input match.json`], onClick: (close) => {
      const name = nextName(`ACC-JV-${YEAR}-`); const amt = Math.abs(amtOf(t)); const code = codeOf(model.account);
      postVoucher({ name, type: 'Journal Entry', entryType: 'Bank Entry', paymentType: isOut ? 'Pay' : 'Receive', date: model.date, title: model.remark || t.description, total: amt, party: null, partyType: null, payment: null, closing: false, createdBy: cx.meId(), createdAt: NOW() },
        isOut ? [{ account: code, debit: amt, costCenter: isPL(code) ? 'Main' : null }, { account: '1050', credit: amt }] : [{ account: '1050', debit: amt }, { account: code, credit: amt, costCenter: isPL(code) ? 'Main' : null }]);
      close(); reconcileLine(t, name, 'Booked and reconciled');
    } }] });
}
function safePanel(code, card) {
  const safe = code === '1010' ? M.safes.treasury : M.safes.reserve;
  const usdcBooks = accBalAt(code, TODAY);
  const stmtRows = cx.rows(`money.statements.${code === '1010' ? 'treasury' : 'reserve'}`);
  const inRange = stmtRows.filter((r) => String(r.time).slice(0, 10) >= bankState.from && String(r.time).slice(0, 10) <= bankState.to);
  const block = cx.blockAt(NOW());
  const checkBtn = cx.btn('Check against the chain', { icon: 'chain', cmd: 'capxul org books reports reconcile', onClick: () => {
    checkBtn.setAttribute('aria-disabled', 'true');
    setTimeout(() => { checkBtn.removeAttribute('aria-disabled'); cx.toast(`${card.name} matches the chain: ${fmt.usdc(safe.balance, 6)} at block ${fmt.int(cx.blockAt(NOW()))}`, { tone: 'success', cmd: 'capxul org books reports reconcile' }); }, 700);
  } });
  const panel = cx.card({ title: card.name, body: h('div', { style: 'display:grid;gap:10px' },
    balanceRows([
      { label: `Opening (books), ${fmt.day(bankState.from)}`, value: fmt.usdc(accBalAt(code, addDays(bankState.from, -1)), 6), sub: fmt.gbp(balAt(code, addDays(bankState.from, -1))) },
      { label: `Closing (books), ${fmt.day(bankState.to)}`, value: fmt.usdc(usdcBooks, 6), sub: fmt.gbp(balAt(code, TODAY)) },
      { label: 'Closing (chain)', value: fmt.usdc(safe.balance, 6), sub: `balanceOf at block ${fmt.int(block)}` },
      { label: 'Difference', value: fmt.usdc(r6(safe.balance - usdcBooks), 6), cls: ['big', near0(safe.balance - usdcBooks) ? 'ok' : 'bad'] },
    ]),
    h('div', h('div.ac-mini', `Reconciled ${inRange.length} of ${inRange.length} lines in the range`), h('div.ac-progress', h('i', { style: { width: '100%' } }))),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, checkBtn, cx.hasRoute('treasury') && code === '1010' ? cx.btn('Open the Treasury', { href: ['treasury'] }) : cx.hasRoute('reserve') && code === '1020' ? cx.btn('Open the Reserve', { href: ['reserve'] }) : null),
    h('p.ac-note', 'A Safe is cleared when it is posted: Capxul books each line from the chain as it arrives, with its payment ID, so its books always equal what the chain holds.')) });
  const list = inRange.slice().reverse().slice(0, 40).map((r) => {
    const p = payById(r.reference);
    const voucher = p?.voucher || p?.books || p?.fundingVoucher || null;
    return h('div.ac-line', { role: 'listitem', style: 'cursor:default' },
      h('div.top', h('span.desc', r.description), h('span.amt', { class: r.direction === 'in' ? 'pos' : 'neg' }, `${r.direction === 'in' ? '+' : '−'}${fmt.usdc(r.amount, 6)}`)),
      h('div.meta', h('span', fmt.datetime(r.time)), h('span', `block ${fmt.int(r.block)}`), cx.tx(r.tx), voucher ? vLink(voucher) : null, p?.proof ? h('span', cx.icon('shield', { size: 12 }), ' proof') : null, h('span', `balance ${fmt.usdc(r.balanceAfter)}`)));
  });
  return h('div.ac-bank',
    h('div', { style: 'display:grid;gap:10px;min-width:0' }, cx.banner('Every line is booked from the chain as it arrives. Nothing here waits to be matched.', { tone: 'success', icon: 'chain' }), h('h3', { style: 'font:600 14px/1.3 var(--font-ui)' }, `Chain statement, ${fmt.date(bankState.from)} to ${fmt.date(bankState.to)} (${inRange.length} lines)`), list.length ? h('div.ac-lines', { role: 'list' }, list) : cx.empty('No movements in this range.')),
    panel);
}
function heldPanel(code, card) {
  const books = code === '1030' ? accBalAt(code, TODAY) : balAt(code, TODAY);
  const items = code === '1030' ? M.escrows.slice().reverse() : M.payouts.filter((p) => p.sentAt).slice(-25).reverse();
  const open = code === '1030' ? M.escrows.filter((e) => e.status === 'Open') : M.payouts.filter((p) => p.status === 'In transit');
  const held = code === '1030' ? sum(open, 'amount') : sum(open, 'bankAmount');
  const cur = code === '1030' ? 'USDC' : 'GBP';
  const panel = cx.card({ title: card.name, body: h('div', { style: 'display:grid;gap:10px' },
    balanceRows([
      { label: 'Closing (books)', value: fmt.money(books, cur, cur === 'USDC' ? 6 : 2) },
      { label: code === '1030' ? `Open escrows (${open.length})` : `Payouts in transit (${open.length})`, value: fmt.money(held, cur, cur === 'USDC' ? 6 : 2) },
      { label: 'Difference', value: fmt.money(r6(books - held), cur, cur === 'USDC' ? 6 : 2), cls: ['big', near0(books - held) ? 'ok' : 'bad'] },
    ]),
    h('p.ac-note', code === '1030' ? 'Money that left the Treasury for someone with no Capxul account. It leaves this account when they claim it, or when the sender takes it back.' : 'USDC that left the Treasury for a bank through Bridge. It leaves this account when Bridge delivers the pounds.'),
    code === '1030' && cx.hasRoute('money-waiting') ? cx.btn('Open money waiting', { href: ['money-waiting'] }) : null) });
  const list = items.map((x) => code === '1030'
    ? h('div.ac-line', { style: 'cursor:default' }, h('div.top', h('span.desc', `${x.email} · ${x.what}`), h('span.amt', fmt.usdc(x.amount))), h('div.meta', cx.pill(x.status), h('span', `funded ${fmt.datetime(x.fundedAt)} by ${cx.name(x.sentBy)}`), x.claimedAt ? h('span', `claimed ${fmt.datetime(x.claimedAt)}`) : null, x.takenBackAt ? h('span', `taken back ${fmt.datetime(x.takenBackAt)}`) : null, cx.addr(x.escrowAddress)))
    : h('div.ac-line', { style: 'cursor:default' }, h('div.top', h('span.desc', `${x.to} · ${x.bank?.bankName} ·· ${x.bank?.last4}`), h('span.amt', fmt.gbp(x.bankAmount))), h('div.meta', cx.pill(x.status), h('span', `sent ${fmt.datetime(x.sentAt)}`), x.deliveredAt ? h('span', `delivered ${fmt.datetime(x.deliveredAt)}`) : null, x.reason ? h('span', x.reason) : null, h('span', `${fmt.usdc(x.sent)} from the Treasury`))));
  return h('div.ac-bank', h('div', { style: 'display:grid;gap:10px;min-width:0' }, h('h3', { style: 'font:600 14px/1.3 var(--font-ui)' }, code === '1030' ? 'Escrows Harbourline funded' : 'Latest Bridge payouts'), h('div.ac-lines', list)), panel);
}
function barclaysView() {
  const s = stmtSummary();
  const open = B.bankTransactions.filter((t) => t.onStatement && t.status === 'Unreconciled');
  const notYet = B.bankTransactions.filter((t) => !t.onStatement && t.status !== 'Reconciled');
  const shown = open.filter((t) => (bankState.kind === 'All' || (bankState.kind === 'Debits' ? amtOf(t) < 0 : amtOf(t) > 0)) && (!bankState.q || `${t.description} ${t.reference || ''}`.toLowerCase().includes(bankState.q.toLowerCase())));
  const sel = open.find((t) => t.name === bankState.sel) || shown[0] || null;
  const panel = cx.card({ title: 'Barclays Business · GBP', body: h('div', { style: 'display:grid;gap:10px' },
    balanceRows([
      { label: `Opening balance, ${fmt.day(bankState.from)}`, value: fmt.gbp(balAt('1050', addDays(bankState.from, -1))) },
      { label: `Closing (books), ${fmt.day(bankState.to)}`, value: fmt.gbp(balAt('1050', bankState.to)), sub: 'What the books expect the statement to show' },
      { label: 'Closing (statement)', value: fmt.gbp(BARCLAYS.statementBalance), sub: `As of ${fmt.date(s.sd)}` },
      { label: `Cleared in books, to ${fmt.day(s.sd)}`, value: fmt.gbp(s.cleared), sub: 'Entries matched to a statement line' },
      { label: 'Difference', value: fmt.gbp(s.diff), cls: ['big', near0(s.diff) ? 'ok' : 'bad'] },
    ]),
    h('div', h('div.ac-mini', `Reconciled ${s.rec} of ${s.onStmt.length}`), h('div.ac-progress', h('i', { style: { width: `${(s.rec / Math.max(1, s.onStmt.length)) * 100}%` } }))),
    h('p.ac-note', BARCLAYS.note)) });
  const search = h('input.ctl', { type: 'search', placeholder: 'Search description or reference', 'aria-label': 'Search unreconciled transactions', value: bankState.q, onchange: (e) => { bankState.q = e.target.value; cx.refresh(); } });
  const kind = h('div.btn-group', ['All', 'Debits', 'Credits'].map((k) => h('button.btn.sm', { type: 'button', class: { primary: bankState.kind === k }, onclick: () => { bankState.kind = k; cx.refresh(); } }, k)));
  const left = h('div', { style: 'display:grid;gap:10px;min-width:0' },
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, h('h3', { style: 'font:600 14px/1.3 var(--font-ui);margin-right:auto' }, `Unreconciled transactions (${open.length})`), kind),
    search,
    shown.length ? h('div.ac-lines', shown.map((t) => h('button.ac-line', { type: 'button', 'aria-pressed': String(sel === t), onclick: () => { bankState.sel = t.name; cx.refresh(); } },
      h('div.top', h('span.desc', t.description), h('span.amt', { class: amtOf(t) < 0 ? 'neg' : 'pos' }, fmt.gbp(amtOf(t)))),
      h('div.meta', h('span', fmt.date(t.date)), t.reference ? h('span', `Ref: ${t.reference}`) : null, h('span', `${fmt.gbp(Math.abs(amtOf(t)))} unallocated`), h('span.mono', t.name))))) : cx.empty(open.length ? 'Nothing matches the search.' : `No unreconciled transactions. Every statement line to ${fmt.date(s.sd)} is matched.`),
    notYet.length ? cx.banner(`${fmt.plural(notYet.length, 'entry', 'entries')} in the books ${notYet.length === 1 ? 'is' : 'are'} not on the statement yet: ${notYet.map((t) => `${t.description.slice(0, 32)} ${fmt.gbp(amtOf(t))}`).join('; ')}. They clear when the next statement arrives.`, { tone: 'info' }) : null);
  const right = h('div', { style: 'display:grid;gap:10px;min-width:0' }, h('h3', { style: 'font:600 14px/1.3 var(--font-ui)' }, 'Match or create'),
    sel ? h('div', { style: 'display:grid;gap:10px' },
      h('div.ac-mini', `${fmt.date(sel.date)} · ${sel.description} · ${fmt.gbp(amtOf(sel))}`),
      ...candidatesFor(sel).map((c) => h('div.ac-cand', h('div.top', h('span', vLink(c.voucher, c.type), ' ', h('span.muted', c.title)), cx.pill(c.badge, c.badge === 'Complete match' ? 'green' : c.badge === 'Suggested' ? 'blue' : 'orange')),
        cx.kv([['Amount', fmt.gbp(c.amount)], ['Posted on', fmt.date(c.date)], ['Reference date', fmt.date(c.date)], c.ref ? ['Reference', c.ref] : null]),
        h('div', cx.btn('Reconcile', { kind: c.badge === 'Complete match' ? 'primary' : null, sm: true, needs: needBooks, cmd: `capxul org doc change bank-transaction ${sel.name} --input match.json`, onClick: () => reconcileLine(sel, c.voucher) })))),
      h('div.ac-create',
        h('button', { type: 'button', onclick: () => (cx.allowed(needBooks).ok ? bankEntryFor(sel) : cx.toast(cx.allowed(needBooks).reason, { tone: 'warning' })) }, h('b', 'Bank entry'), h('span', 'Record a bank journal entry for expenses, income or split transactions')),
        h('button', { type: 'button', onclick: () => (cx.allowed(needBooks).ok ? newPaymentEntry() : cx.toast(cx.allowed(needBooks).reason, { tone: 'warning' })) }, h('b', 'Record payment'), h('span', 'Record a payment entry against a customer or supplier')),
        h('button', { type: 'button', onclick: () => cx.toast('A transfer to a Safe goes through Bridge, which books itself from the chain. Use Money › Bank to move money to the Treasury.', { tone: 'info', cmd: 'capxul bank pay self 5000 --org harbourline' }) }, h('b', 'Transfer'), h('span', 'Record an internal transfer to another bank account')))) : cx.empty('Pick a transaction on the left to match it.'));
  const statement = () => {
    const unc = B.bankTransactions.filter((t) => t.status !== 'Reconciled' && t.date <= bankState.to);
    const books = balAt('1050', bankState.to);
    return h('div', { style: 'display:grid;gap:12px;padding:4px 0' },
      cx.grid({ columns: [{ key: 'date', label: 'Posting date', type: 'date' }, { key: 'type', label: 'Payment document type', get: (t) => recordTypeOf(t.voucher) }, { key: 'voucher', label: 'Payment entry', render: (t) => vLink(t.voucher) }, { key: 'debit', label: 'Debit', type: 'currency', currency: 'GBP', get: (t) => t.deposit || 0 }, { key: 'credit', label: 'Credit', type: 'currency', currency: 'GBP', get: (t) => t.withdrawal || 0 }, { key: 'reference', label: 'Reference no', opt: true }, { key: 'status', label: 'Status', render: (t) => cx.pill(t.status === 'Not on statement yet' ? 'Pending' : t.status) }], rows: unc, totals: ['debit', 'credit'], empty: 'Everything is cleared.' }),
      h('div.ac-sum',
        h('div.row', h('span', `Bank statement balance as per general ledger, ${fmt.date(bankState.to)}`), h('span.num', fmt.gbp(books))),
        h('div.row', h('span', 'Outstanding payments and deposits to clear'), h('span.num', fmt.gbp(-sum(unc, amtOf)))),
        h('div.row', h('span', 'Payments and deposits incorrectly cleared'), h('span.num', fmt.gbp(0))),
        h('div.row.big', h('span', 'Calculated bank statement balance'), h('span.num', fmt.gbp(r2(books - sum(unc, amtOf)))))));
  };
  const txList = () => cx.listView({
    key: 'ac-btn', rows: () => B.bankTransactions.slice(), noun: 'bank transaction', id: (t) => t.name, selectable: false,
    titleCol: { key: 'description', label: 'Description', sub: (t) => t.note },
    status: (t) => cx.pill(t.status === 'Not on statement yet' ? 'Pending' : t.status),
    columns: [{ key: 'date', label: 'Date', type: 'date', keep: true }, { key: 'reference', label: 'Reference' }, { key: 'deposit', label: 'Deposit', type: 'currency', currency: 'GBP' }, { key: 'withdrawal', label: 'Withdrawal', type: 'currency', currency: 'GBP' }, { label: 'Payment entries', render: (t) => vLink(t.matchedTo || t.voucher) }],
    right: { key: 'balance', label: 'Balance', type: 'currency', currency: 'GBP' },
    filters: [{ key: 'name', label: 'ID' }, { key: 'status', label: 'Status', type: 'select' }, { key: 'date', label: 'Month', type: 'month' }],
    tabs: [{ label: 'All' }, { label: 'Unreconciled', filter: (t) => t.status !== 'Reconciled' }, { label: 'Reconciled', filter: (t) => t.status === 'Reconciled' }],
    sort: { options: [{ key: 'date', label: 'Date' }, { key: 'name', label: 'ID' }], default: { key: 'name', dir: 'desc' } },
    onOpen: (t) => { if (t.voucher) cx.go(VROUTE[recordTypeOf(t.voucher)] || 'payment-entry', t.voucher); },
    setsCommand: false,
  });
  const clearance = () => {
    const by = new Map();
    for (const t of B.bankTransactions.filter((x) => x.status === 'Reconciled')) { const m = t.date.slice(0, 7); const o = by.get(m) || { month: m, n: 0, dep: 0, wd: 0 }; o.n++; o.dep += t.deposit || 0; o.wd += t.withdrawal || 0; by.set(m, o); }
    return cx.grid({ columns: [{ key: 'month', label: 'Month', render: (r) => fmt.month(r.month) }, { key: 'n', label: 'Lines cleared', type: 'int' }, { key: 'dep', label: 'Deposits', type: 'currency', currency: 'GBP' }, { key: 'wd', label: 'Withdrawals', type: 'currency', currency: 'GBP' }], rows: [...by.values()].reverse(), totals: ['n', 'dep', 'wd'] });
  };
  return h('div.ac-wrap', { style: 'min-width:0' }, cx.tabs([
    { label: 'Match and reconcile', count: open.length || null, render: () => h('div.ac-bank', h('div.ac-match', left, right), panel) },
    { label: 'Reconciliation statement', render: statement },
    { label: 'Transactions', count: B.bankTransactions.length, render: txList },
    { label: 'Clearance summary', render: clearance },
  ], { key: 'ac-banking' }));
}
cx.route('banking', (ctx) => {
  const code = BANK_CARDS.some((c) => c.code === ctx.id) ? ctx.id : '1050';
  const card = BANK_CARDS.find((c) => c.code === code);
  const strip = h('div.ac-strip', { role: 'toolbar', 'aria-label': 'Bank accounts' }, BANK_CARDS.map((c) => h('button.ac-acct', { type: 'button', 'aria-pressed': String(c.code === code), onclick: () => cx.go('banking', c.code) },
    h('span.nm', h('span', c.name), cx.pill(c.mark[0], c.mark[1])), h('span.no', c.no()), h('span.bal.num', c.bal()))));
  const dates = h('div', { style: 'display:flex;gap:8px;align-items:end;flex-wrap:wrap' },
    h('label', { style: 'display:grid;gap:2px;font-size:11.5px;color:var(--muted)' }, 'From', h('input.ctl', { type: 'date', value: bankState.from, onchange: (e) => { bankState.from = e.target.value || bankState.from; cx.refresh(); } })),
    h('label', { style: 'display:grid;gap:2px;font-size:11.5px;color:var(--muted)' }, 'To', h('input.ctl', { type: 'date', value: bankState.to, onchange: (e) => { bankState.to = e.target.value || bankState.to; cx.refresh(); } })));
  setTimeout(() => { const el = strip.querySelector('[aria-pressed="true"]'); if (el && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = Math.max(0, el.offsetLeft - strip.offsetLeft - 8); }, 0);
  const body = code === '1050' ? barclaysView() : SAFE_CODES.has(code) ? safePanel(code, card) : heldPanel(code, card);
  const s = stmtSummary();
  const cmd = code === '1050'
    ? { cli: [`capxul org doc list bank-transaction --filter ${qv('bank_account=Barclays Business · GBP')} --filter status=Unreconciled`], sdk: 'client.org(orgId).docs.list("bank-transaction", { filter: { bank_account: "Barclays Business · GBP", status: "Unreconciled" } })', kind: 'family', who: 'whoever wears the Books hat matches; anyone with a seat reads', json: { bank_account: 'Barclays Business · GBP', statement_to: s.sd, statement_balance: BARCLAYS.statementBalance, cleared_balance: s.cleared, difference: s.diff, unreconciled: B.bankTransactions.filter((t) => t.onStatement && t.status === 'Unreconciled').map((t) => t.name) } }
    : code === '1030' ? { cli: 'capxul payment list --status escrowed --org harbourline', who: 'anyone with a seat' }
      : code === '1040' ? { cli: 'capxul payment list --rail bridge --org harbourline', who: 'anyone with a seat' }
        : { cli: 'capxul org books reports reconcile', sdk: 'client.org(orgId).books.reports.reconcile()', who: 'anyone with a seat', json: { safes: [{ account: '1010', books: accBalAt('1010', TODAY), chain: M.safes.treasury.balance, difference: 0 }, { account: '1020', books: accBalAt('1020', TODAY), chain: M.safes.reserve.balance, difference: 0 }] } };
  return cx.page({
    title: 'Banking', crumbs: crumbs(), cmd, fde: `Banking: ${card.name}`,
    actions: [
      cx.menu(null, [{ label: 'Bank accounts', href: ['bank-accounts'], icon: 'bank' }, { label: 'Bridge deposits to match', icon: 'in', cmd: 'capxul bank deposits --unmatched', onClick: () => cx.toast(`${M.deposits.filter((d) => d.match === 'Unmatched').length} Bridge deposit waiting to be matched (PAYPAL *HARBOURLN, £640.00). Match it to a request, or classify its payment entry.`, { cmd: 'capxul bank deposits --unmatched' }) }]),
      code === '1050' ? cx.btn('Upload statement', { icon: 'file', needs: needBooks, cmd: 'capxul org doc create bank-transaction --input barclays-2026-11.json', onClick: () => cx.toast('Statements arrive from Barclays each morning; the next one covers 7 to 9 November.', { cmd: 'capxul org doc create bank-transaction --input barclays-2026-11.json' }) }) : null,
      code === '1050' ? cx.btn('Auto reconcile', { kind: 'primary', needs: needBooks, cmd: 'capxul org doc apply bank-transaction --rule match-by-reference', onClick: () => {
        const open = B.bankTransactions.filter((t) => t.onStatement && t.status === 'Unreconciled');
        const done = open.map((t) => [t, candidatesFor(t).find((c) => c.badge === 'Complete match')]).filter(([, c]) => c);
        if (!done.length) { cx.toast('Nothing matches exactly. Match the rest by hand.', { tone: 'info' }); return; }
        for (const [t, c] of done) { t.status = 'Reconciled'; t.matchedTo = c.voucher; t.reconciledBy = cx.meId(); BARCLAYS.reconciled++; BARCLAYS.toReconcile = Math.max(0, BARCLAYS.toReconcile - 1); }
        bankState.sel = null; cx.refresh(); const left = stmtSummary();
        cx.toast(`Reconciled ${fmt.plural(done.length, 'line')} by amount and reference. Difference ${fmt.gbp(left.diff)}.`, { tone: 'success', cmd: 'capxul org doc apply bank-transaction --rule match-by-reference' });
      } }) : null,
    ].filter(Boolean),
    body: [strip, dates, body],
  });
}, { workspace: 'books', title: 'Banking' });

/* ---- bank accounts ---- */

function bankAccountList() {
  const own = [
    { name: 'Treasury · USDC', ledger: '1010', bank: 'Capxul', kind: 'Safe', no: M.safes.treasury.address, currency: 'USDC', company: true, isDefault: true, statement: 'The chain' },
    { name: 'Reserve Safe · USDC', ledger: '1020', bank: 'Capxul', kind: 'Safe', no: M.safes.reserve.address, currency: 'USDC', company: true, statement: 'The chain' },
    { name: BARCLAYS.name, ledger: '1050', bank: 'Barclays', kind: 'Current', no: `****${BARCLAYS.last4}`, sortCode: BARCLAYS.sortCode, iban: BARCLAYS.iban, currency: 'GBP', company: true, statement: `Barclays statement, to ${fmt.date(BARCLAYS.statementTo)}` },
    ...M.bankDetails.map((bd) => ({ name: `Bridge deposit details · ${bd.currency}`, ledger: '1010', bank: bd.bank, kind: 'Deposit details', no: bd.account, currency: bd.currency, company: true, statement: `Becomes ${bd.becomes}`, rails: bd.rails.join(', '), fee: bd.fee })),
  ];
  const saved = M.savedBankAccounts.filter((x) => x.for !== 'Yourself').map((x) => ({ name: `${x.holder} · ${x.bank} ··${x.last4}`, ledger: null, bank: x.bank, kind: 'Saved', no: `****${x.last4}`, currency: x.currency, company: false, partyType: /Supplier/.test(x.for) ? 'Supplier' : 'Employee', party: x.holder, state: x.state, savedBy: x.savedBy, id: x.id }));
  return [...own, ...saved];
}
cx.route('bank-accounts', () => {
  const list = cx.listView({
    key: 'ac-bacc', rows: bankAccountList, noun: 'bank account', id: (r) => r.name, selectable: false,
    titleCol: { key: 'name', label: 'Account name', sub: (r) => (r.company ? `${r.kind} · ${r.statement}` : `${r.partyType} · saved by ${cx.name(r.savedBy)}`) },
    status: (r) => (r.company ? cx.pill(r.kind === 'Safe' ? 'Safe' : r.kind === 'Current' ? 'Bank' : 'Bridge', r.kind === 'Safe' ? 'teal' : r.kind === 'Current' ? 'gray' : 'blue') : cx.pill(r.state.startsWith('Active') ? 'Enabled' : 'Disabled', null, { title: r.state })),
    columns: [{ label: 'Company account', render: (r) => (r.ledger ? accLabel(r.ledger) : h('span.faint', '—')) }, { key: 'bank', label: 'Bank' }, { key: 'no', label: 'Bank account no', render: (r) => (/^0x/.test(r.no) ? cx.addr(r.no) : h('span.mono', { style: 'font-size:12px' }, r.no)) }],
    right: { key: 'currency', label: 'Currency' },
    tabs: [{ label: 'Company accounts', filter: (r) => r.company }, { label: 'Party accounts', filter: (r) => !r.company }, { label: 'All' }],
    filters: [{ key: 'name', label: 'Account name' }, { key: 'bank', label: 'Bank', type: 'select' }, { key: 'currency', label: 'Currency', type: 'select' }],
    href: (r) => ['bank-account', r.name], showId: false,
    cmd: { cli: 'capxul bank accounts --org harbourline', who: 'anyone with a seat', filters: false },
  });
  return cx.page({ title: 'Bank accounts', crumbs: crumbs(), body: list,
    actions: [cx.btn('Add a bank account', { kind: 'primary', icon: 'plus', needs: needBooks, cmd: 'capxul bank accounts add --org harbourline --currency GBP --input account.json', onClick: () => cx.toast('A supplier’s bank account is saved when you first pay them by bank; the company’s own accounts are added by the Books hat.', { cmd: 'capxul bank accounts add --org harbourline --currency GBP --input account.json' }) })] });
}, { workspace: 'books', title: 'Bank accounts' });

if (!cx.hasRoute('bank-account')) cx.route('bank-account', (ctx) => {
  const a = cx.find(bankAccountList(), 'name', ctx.id);
  if (!a) return cx.page({ title: 'Not found', crumbs: crumbs({ label: 'Bank accounts', route: 'bank-accounts' }), body: cx.empty('No such bank account') });
  const form = cx.formView({ doc: a, tabs: [{ label: 'Details', sections: [
    { columns: [[{ label: 'Account name', value: a.name, reqd: true }, { label: 'Company account', render: () => (a.ledger ? cx.link(accLabel(a.ledger), 'account', a.ledger) : h('span.faint', '—')) }, { label: 'Bank', value: a.bank, reqd: true }, { label: 'Account type', value: a.kind }], [{ label: 'Disabled', value: a.state && !a.state.startsWith('Active') ? 1 : 0, type: 'check' }, { label: 'Is default account', value: a.isDefault ? 1 : 0, type: 'check' }, { label: 'Is company account', value: a.company ? 1 : 0, type: 'check' }, { label: 'Currency', value: a.currency }]] },
    !a.company ? { label: 'Party details', columns: [[{ label: 'Party type', value: a.partyType }], [{ label: 'Party', value: a.party }]] } : null,
    { label: 'Account details', columns: [[a.iban ? { label: 'IBAN', value: a.iban, type: 'mono' } : null, { label: 'Branch code', value: a.sortCode || (a.rails ? `Rails: ${a.rails}` : null) }].filter(Boolean), [{ label: a.kind === 'Safe' ? 'Safe address' : 'Bank account no', render: () => (/^0x/.test(a.no) ? cx.addr(a.no) : h('span.mono', a.no)) }, { label: 'Statement', value: a.statement || (a.company ? null : 'Payouts to this account go through Bridge') }]] },
    a.ledger === '1050' ? { label: 'Reconciliation', fields: [{ label: 'Statement to', value: BARCLAYS.statementTo, type: 'date' }, { label: 'Statement balance', value: BARCLAYS.statementBalance, type: 'currency', currency: 'GBP' }, { label: 'Lines to reconcile', value: B.bankTransactions.filter((t) => t.onStatement && t.status === 'Unreconciled').length, type: 'int' }, { label: 'Note', value: BARCLAYS.note }] } : null,
  ].filter(Boolean) }],
  connections: a.ledger ? [{ group: 'Transactions', items: [{ label: 'Bank transaction', count: a.ledger === '1050' ? B.bankTransactions.length : 0, route: 'banking', id: a.ledger }] }, { group: 'Accounting', items: [{ label: 'Payment entry', count: B.vouchers.filter((v) => v.type === 'Payment Entry' && linesOf(v.name).some((l) => l.account === a.ledger)).length, route: 'payment-entries' }, { label: 'Journal entry', count: B.vouchers.filter((v) => v.type === 'Journal Entry' && linesOf(v.name).some((l) => l.account === a.ledger)).length, route: 'journal-entries' }] }] : null,
  side: { id: a.name, title: a.bank, cmd: 'capxul bank accounts --org harbourline' } });
  return cx.page({ title: a.name, crumbs: crumbs({ label: 'Bank accounts', route: 'bank-accounts' }), status: [a.company ? 'Enabled' : a.state?.startsWith('Active') ? 'Enabled' : 'Disabled'],
    cmd: { cli: 'capxul bank accounts --org harbourline', who: 'anyone with a seat', json: { name: a.name, bank: a.bank, currency: a.currency, account: a.no, ledger: a.ledger } },
    actions: a.ledger && BANK_CARDS.some((c) => c.code === a.ledger) ? [cx.btn('Reconcile', { kind: 'primary', href: ['banking', a.ledger], icon: 'bank' })] : [],
    body: form });
}, { workspace: 'books', title: 'Bank account' });

/* =====================================================================================================
   Cost centres, fiscal years, the year-end close
   ===================================================================================================== */

cx.route('cost-centres', () => {
  const qStart = `${TODAY.slice(0, 4)}-${String(Math.floor((+TODAY.slice(5, 7) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
  const byCc = new Map();
  for (const r of GL) { if (r.date < qStart || r.closing || r.isCancelled || !r.costCenter) continue; if (acc(r.account)?.rootType !== 'Expense') continue; byCc.set(r.costCenter, (byCc.get(r.costCenter) || 0) + r.debit - r.credit); }
  const node = (c) => {
    const kids = B.costCenters.filter((x) => x.parent === c.name);
    const dept = c.department ? D.departments.find((d) => d.id === c.department) : null;
    const b = c.department ? cx.budgetOn(c.department) : null;
    const holders = c.department ? cx.holders(c.department).map(cx.name).join(', ') : '';
    const used = b && b.amount ? (b.spent + (b.committed || 0)) / b.amount : 0;
    return { id: c.name, cc: c, label: c.name, group: !!kids.length, sub: dept ? `${dept.name} · ${holders} wears the hat` : 'The company as a whole', badges: b ? [h('span.ac-meter', { class: { warn: used > 0.85 }, title: `${fmt.usdc(b.spent)} spent, ${fmt.usdc(b.committed || 0)} committed of ${fmt.usdc(b.amount)} in ${b.quarter}` }, h('i', { style: { width: `${Math.min(100, used * 100)}%` } })), h('span.ac-mini', `${fmt.usdc(b.left, 0)} left in ${b.quarter}`)] : [], value: `${fmt.gbp(byCc.get(c.name) || (kids.length ? sum(kids, (k) => byCc.get(k.name) || 0) : 0))} booked this quarter`, children: kids.map(node) };
  };
  const roots = B.costCenters.filter((c) => !c.parent).map(node);
  return cx.page({
    title: 'Chart of cost centres', crumbs: crumbs(),
    cmd: { cli: 'capxul org doc list cost-center', sdk: 'client.org(orgId).docs.list("cost-center")', kind: 'family', who: 'anyone with a seat' },
    actions: [cx.btn('Chart of accounts', { href: ['chart-of-accounts'], icon: 'tree' }), cx.btn('Department budgets', { href: ['departments'], icon: 'departments' })],
    banner: cx.banner('One cost centre per department. Budgets are not set here: they belong to the departments, and whoever wears a department’s hat spends from its budget.', { tone: 'info' }),
    body: cx.treeView({ key: 'ac-cc', depth: 1, roots, toolbar: (n) => [
      cx.btn('View ledger', { sm: true, icon: 'report', cmd: `capxul org report run general-ledger --filter ${qv(`cost_center=${n.id}`)}`, onClick: () => cx.go('general-ledger', null, { report: { costCenter: n.id === 'Harbourline' ? '' : n.id, from: qStart, to: TODAY, account: '', voucher: '', party: '' } }) }),
      cx.btn('Profit and loss', { sm: true, icon: 'report', cmd: `capxul org books reports profit-and-loss --from ${CUR_FY.start} --to ${TODAY}`, onClick: () => cx.go('profit-and-loss', null, { report: { costCenter: n.id === 'Harbourline' ? '' : n.id } }) }),
      n.cc?.department && cx.hasRoute('department') ? cx.btn('Open the department', { sm: true, icon: 'departments', cmd: `capxul org department show ${n.cc.department}`, href: ['department', n.cc.department] }) : null,
    ].filter(Boolean) }),
  });
}, { workspace: 'books', title: 'Chart of cost centres' });

cx.route('fiscal-years', () => {
  const pcv = B.periodClosing;
  return cx.page({
    title: 'Fiscal years', crumbs: crumbs(),
    cmd: { cli: 'capxul org doc list fiscal-year', kind: 'family', who: 'anyone with a seat' },
    banner: cx.banner(`Harbourline’s year starts on 1 April. Fiscal years follow from it, so this list is read-only. Books are closed through ${fmt.date(CLOSED_THROUGH)}.`, { tone: 'info' }),
    body: [
      cx.card({ title: 'Fiscal years', flush: true, body: cx.grid({ columns: [{ key: 'name', label: 'Year name' }, { key: 'start', label: 'Year start date', type: 'date' }, { key: 'end', label: 'Year end date', type: 'date' }, { key: 'status', label: 'Status', render: (y) => cx.pill(y.closed ? 'Closed' : 'Open', y.closed ? 'gray' : 'green') }, { key: 'pcv', label: 'Period closing voucher', render: (y) => (y.closed ? cx.link(pcv.name, 'period-closing-voucher', pcv.name) : h('span.faint', `Closes after ${fmt.date(y.end)}`)) }], rows: FYS.slice().reverse() }) }),
      cx.draft({ for: 'kwame', by: '@harbourline-fde', at: '2026-11-02T09:10:00Z', title: 'Close fiscal year 2026-2027 after 31 March 2027', why: 'Drafted early so the steps are ready. Run it once the accountants sign off: the year’s profit moves to 3100 · Retained earnings and nothing can post on or before 31 March 2027.', steps: ['Check the trial balance at 31 March 2027', 'Post the period closing voucher to 3100 · Retained earnings', 'Book the corporation tax for the year'], cmd: ['capxul org books reports trial-balance --as-of 2027-03-31', 'capxul org doc create period-closing-voucher --input close-2026-2027.json'], needs: needBooks, onRun: () => cx.toast('The year has not ended yet: this runs after 31 March 2027.', { tone: 'info', cmd: 'capxul org doc create period-closing-voucher --input close-2026-2027.json' }) }),
    ],
  });
}, { workspace: 'books', title: 'Fiscal years' });

cx.route('period-closing-voucher', (ctx) => {
  const pcv = B.periodClosing;
  if (ctx.id && cx.slug(ctx.id) !== cx.slug(pcv.name)) return cx.page({ title: 'Not found', crumbs: crumbs({ label: 'Fiscal years', route: 'fiscal-years' }), body: cx.empty('No such period closing voucher') });
  const lines = linesOf(pcv.name);
  const form = cx.formView({ doc: pcv, tabs: [{ label: 'Details', sections: [
    { columns: [[{ label: 'Transaction date', value: pcv.submittedAt, type: 'datetime' }, { label: 'Fiscal year', value: pcv.fiscalYear, reqd: true }, { label: 'Period start date', value: pcv.periodStart, type: 'date', reqd: true }, { label: 'Period end date', value: pcv.periodEnd, type: 'date', reqd: true }], [{ label: 'Closing account', value: accLabel(pcv.closingAccount), type: 'link', href: ['account', pcv.closingAccount], reqd: true }, { label: 'Ledger entry processing status', value: 'Completed', type: 'status' }, { label: 'Remarks', value: pcv.remarks, type: 'textarea', reqd: true }]] },
    { label: 'The year in one line', cols: 3, fields: [{ label: 'Profit for the year', value: pcv.profit, type: 'currency', currency: 'GBP' }, { label: 'Corporation tax (25%)', value: pcv.corporationTax, type: 'currency', currency: 'GBP' }, { label: 'Lines closed', value: lines.length, type: 'int' }] },
    { label: 'Closing entries', table: cx.grid({ columns: [{ key: 'account', label: 'Account', render: (r) => accLabel(r.account) }, { key: 'debit', label: 'Debit', type: 'currency', currency: 'GBP' }, { key: 'credit', label: 'Credit', type: 'currency', currency: 'GBP' }], rows: lines, totals: ['debit', 'credit'] }) },
  ] }], side: { id: pcv.name, title: pcv.fiscalYear, cmd: `capxul org doc get period-closing-voucher ${pcv.name}`, created: { by: 'kwame', at: pcv.submittedAt }, modified: { by: 'kwame', at: pcv.submittedAt } },
  timeline: { items: [{ at: pcv.submittedAt, who: 'kwame', kind: 'submitted', text: 'submitted this' }, { at: pcv.submittedAt.replace('15:30', '15:31'), kind: 'status', text: `Books closed through ${fmt.date(pcv.periodEnd)}` }], comment: true } });
  return cx.page({ title: `Year-end close ${pcv.fiscalYear}`, crumbs: crumbs({ label: 'Fiscal years', route: 'fiscal-years' }), status: ['Submitted'], sub: `${pcv.name} · ${fmt.date(pcv.periodStart)} to ${fmt.date(pcv.periodEnd)}`,
    cmd: { cli: `capxul org doc get period-closing-voucher ${pcv.name}`, kind: 'family', who: 'anyone with a seat', json: { name: pcv.name, fiscal_year: pcv.fiscalYear, closing_account_head: accLabel(pcv.closingAccount), remarks: pcv.remarks } },
    actions: [cx.btn('Ledger', { icon: 'report', onClick: () => cx.go('general-ledger', null, { report: { voucher: pcv.name, from: pcv.periodEnd, to: pcv.periodEnd, account: '', party: '' } }) }), cx.btn('Cancel', { needs: needBooks, disabled: true, reason: 'The 2025-2026 accounts are filed: the close stays.' })],
    body: form });
}, { workspace: 'books', title: 'Period closing voucher' });

/* =====================================================================================================
   Capxul's own inside Books: the review queue and money facts
   ===================================================================================================== */

function suggestionFor(r) {
  const v = VCH.get(r.voucher); const dep = depositOf(payById(v?.payment));
  if (dep && /PAYPAL/.test(dep.from)) return { name: 'Template sales (marketplace)', under: '4000', why: `${dep.from} paid by Faster Payments with reference ${dep.reference}: the studio sells design templates on a marketplace that pays out through PayPal.` };
  return { name: r.account === '4999' ? 'Other income' : 'Sundry', under: r.account === '4999' ? '4000' : '6900', why: 'No payer suggestion came with it.' };
}
cx.route('review-queue', () => {
  const rows = reviewRows().map((r) => { const v = VCH.get(r.voucher); const p = payById(v?.payment); return { ...r, gl: r, dir: r.credit > 0 ? 'In' : 'Out', amount: r.credit || r.debit, title: v?.title, source: depositOf(p) ? 'Bridge deposit' : p ? 'Payment' : 'Outside movement', sug: suggestionFor(r), v }; });
  const accept = (r) => {
    const cmd = `capxul org books accounts review --accept ${r.voucher} --under ${r.sug.under} --name "${r.sug.name}"`;
    const parent = acc(r.sug.under);
    const code = nextCode(parent?.parent || 'Income');
    B.accounts.push({ code, name: r.sug.name, rootType: parent?.rootType || 'Income', accountType: 'Income Account', isGroup: false, currency: 'GBP', parent: parent?.parent || 'Income', role: null, createdBy: cx.meId(), createdAt: NOW() }); reindexAccounts();
    r.gl.account = code; if (r.v) peCache.delete(r.v);
    cx.refresh(); cx.toast(`Accepted: ${code} · ${r.sug.name}. The entry moved out of the queue.`, { tone: 'success', cmd });
  };
  return cx.page({
    title: 'Review queue', crumbs: crumbs(),
    cmd: { cli: 'capxul org books accounts review', sdk: 'client.org(orgId).books.accounts.review()', who: 'whoever wears the Books hat, or a Director', json: { rows: rows.map((r) => ({ row: r.voucher, account: r.account, amount: r.amount, direction: r.dir.toLowerCase(), suggested: r.sug.name })) } },
    banner: cx.banner('Money that arrived or left with no meaning posts to 4999 · Income, not decided or 6999 · Expense, not decided, and waits here until someone gives it an account. The money itself has already settled.', { tone: 'info' }),
    actions: [cx.btn('Move all to…', { needs: needBooks, cmd: `capxul org books accounts reclassify --from-account 4999 --to-account 4000 --from ${TODAY.slice(0, 7)}-01 --to ${TODAY}`, onClick: () => { if (!rows.length) { cx.toast('The queue is empty.'); return; } classify(rows[0].v, rows[0].gl); } })],
    body: rows.length ? cx.card({ flush: true, body: cx.grid({ numbered: false, columns: [
      { key: 'date', label: 'Date', type: 'date' }, { key: 'dir', label: 'Direction', render: (r) => cx.dir(r.dir) }, { key: 'amount', label: 'Amount', type: 'currency', currency: 'GBP' },
      { key: 'title', label: 'Counterparty', render: (r) => vLink(r.voucher) }, { key: 'account', label: 'Now in', render: (r) => accLabel(r.account) },
      { key: 'sug', label: 'Suggested account', render: (r) => h('span', { title: r.sug.why }, `${r.sug.name} (under ${accLabel(r.sug.under)})`) }, { key: 'source', label: 'Source', opt: true },
      { key: 'act', label: '', render: (r) => h('span', { style: 'display:inline-flex;gap:6px' }, cx.btn('Accept', { sm: true, kind: 'primary', needs: needBooks, cmd: `capxul org books accounts review --accept ${r.voucher} --under ${r.sug.under} --name "${r.sug.name}"`, onClick: () => accept(r) }), cx.btn('Classify', { sm: true, needs: needBooks, cmd: `capxul activity annotate --id ${r.v?.payment || r.voucher} --account <code> --confirm`, onClick: () => classify(r.v, r.gl) })) },
    ], rows }) }) : cx.empty('Nothing to review. Every payment has an account.'),
  });
}, { workspace: 'books', title: 'Review queue' });

function factKind(p) {
  if (p.status === 'Cancelled') return 'reversed';
  if (p.direction === 'in') return depositOf(p) ? 'deposit_received' : 'payment_received';
  if (p.route === 'money-waiting') return p.status === 'Money waiting' ? 'escrow_funded' : 'escrow_settled';
  if (payoutOf(p)) return 'payout_sent';
  if (p.purpose === 'payroll') return 'payroll_paid';
  return 'payment_settled';
}
cx.route('money-facts', () => {
  const facts = () => {
    const list = M.payments.filter((p) => p.settledAt && ['Settled', 'Money waiting', 'Cancelled'].includes(p.status)).slice().sort((a, b) => String(a.settledAt).localeCompare(String(b.settledAt)));
    return list.map((p, i) => ({ seq: i + 1, id: p.id, p, kind: factKind(p), at: p.settledAt, safe: p.payer?.label === 'Reserve' || p.payee?.label === 'Reserve' ? 'Reserve' : 'Treasury', amount: (p.direction === 'in' ? 1 : -1) * p.amount, usd: p.amount, gbp: p.gbp, rate: p.rate, party: p.counterparty, fee: p.fee || 0, voucher: p.voucher || p.books || p.fundingVoucher || null, tx: p.proof?.tx || depositOf(p)?.tx || null }));
  };
  const list = cx.listView({
    key: 'ac-facts', rows: facts, noun: 'fact', id: (r) => r.id, selectable: false, idLabel: 'Payment',
    titleCol: { key: 'party', label: 'Party', render: (r) => h('div.lv-cell-title', h('span.ttl', r.party), h('span.sub', `#${fmt.int(r.seq)} · ${r.kind}`)) },
    columns: [
      { key: 'seq', label: 'Seq', type: 'int' },
      { key: 'at', label: 'Occurred', type: 'datetime' },
      { key: 'safe', label: 'Safe' },
      { key: 'usd', label: 'USD value', render: (r) => `${fmt.usd(r.usd)} at ${fmt.num(1, 4)}` },
      { key: 'gbp', label: 'In pounds', type: 'currency', currency: 'GBP' },
      { key: 'fee', label: 'Fee', render: (r) => (r.fee ? fmt.usdc(r.fee) : '0') },
      { key: 'voucher', label: 'Voucher', render: (r) => (r.voucher ? vLink(r.voucher) : h('span.faint', '—')) },
      { key: 'tx', label: 'Transaction', render: (r) => (r.tx ? cx.tx(r.tx) : h('span.faint', '—')) },
    ],
    right: { key: 'amount', label: 'Amount', render: (r) => cx.amount(r.amount, 'USDC', { sign: true, color: true, dp: 6 }) },
    filters: [{ key: 'kind', label: 'Kind', type: 'select' }, { key: 'party', label: 'Party' }, { key: 'at', label: 'Month', type: 'month', flag: '--since' }],
    sort: { options: [{ key: 'seq', label: 'Seq' }, { key: 'usd', label: 'Amount' }], default: { key: 'seq', dir: 'desc' } },
    groupBy: [{ key: 'kind', label: 'Kind' }],
    onOpen: (r) => (r.voucher ? cx.go(VROUTE[recordTypeOf(r.voucher)] || 'payment-entry', r.voucher) : cx.hasRoute('payment') ? cx.go('payment', r.id) : null),
    cmd: (st) => ({ cli: `capxul org books facts list${st.filters.kind ? ` --kind ${st.filters.kind}` : ''} --since ${st.filters.at ? st.filters.at + '-01' : TODAY.slice(0, 7) + '-01'}`, sdk: 'client.org(orgId).books.facts.list({ since })', who: 'anyone with a seat' }),
    showId: false,
  });
  return cx.page({ title: 'Money facts', crumbs: crumbs(), body: [cx.banner('Every movement of money is a numbered fact, in order and without gaps: the books’ proof that each voucher came from the chain.', { tone: 'info', icon: 'chain' }), list] });
}, { workspace: 'books', title: 'Money facts' });

// @@END@@
