// Payroll: salary components, structures and assignments, payroll runs month by month (paid in one batch, each
// payslip with its proof), payslips and their printed view, the salary register, and the employee's own payslips.
import { cx, h } from './core.js';
import { repView, emp, empName, empNo, empLink, round2, sum, addDays, eachDay, monthEnd, leaveDetails, makePayment, paymentOf, paidToLong, hatHolders, wearersOf, namesList, nextName, seatGate, appFrame, nowIso } from './hr.js';

const D = cx.data;
const fmt = cx.fmt;
const P = D.payroll;

/* =====================================================================================================
   Helpers
   ===================================================================================================== */

const RUN_TONE = { Draft: 'red', Submitted: 'blue', Paying: 'blue', Paid: 'green', Cancelled: 'red' };
const SLIP_TONE = { Draft: 'red', Submitted: 'blue', Withheld: 'orange', Paying: 'blue', Escrowed: 'escrow', Paid: 'green', Cancelled: 'red' };
const T = (s, map) => ({ text: s, tone: map[s] || cx.toneOf(s) });
const slipByName = (n) => P.slips.find((s) => s.name === n) || null;
const runByName = (n) => P.runs.find((r) => r.name === n) || null;
const slipsOf = (run) => run.slips.map(slipByName).filter(Boolean);
const monthOf = (run) => fmt.dateLong(run.startDate).split(' ').slice(2).join(' ');
const periodText = (s) => (s.startDate.slice(0, 7) === s.endDate.slice(0, 7) && s.startDate.endsWith('-01') && s.endDate === monthEnd(s.startDate.slice(0, 7)) ? fmt.month(s.startDate) : `${fmt.day(s.startDate)} to ${fmt.date(s.endDate)}`);
const peopleHat = () => namesList(wearersOf('People'));
const payerOf = (run) => hatHolders(run.department)[0] || 'maya';
const money = (n, cur) => fmt.money(n, cur || 'GBP');
const field = (label, key, extra = {}) => ({ label, key, ...extra });
const payOutcome = (s) => (s.status === 'Withheld' ? 'Withheld' : s.paymentInfo?.escrow?.status === 'Open' ? 'Escrowed' : s.paymentInfo ? 'Paid' : s.status === 'Paying' ? 'Paying' : s.status);
const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function words(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' And ' + words(n % 100) : '');
  if (n < 1e6) return words(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? (n % 1000 < 100 ? ' And ' : ', ') + words(n % 1000) : '');
  return words(Math.floor(n / 1e6)) + ' Million' + (n % 1e6 ? ', ' + words(n % 1e6) : '');
}
const inWords = (v) => { const p = Math.round(v * 100); const pounds = Math.floor(p / 100), pence = p % 100; return `${words(pounds)} Pounds${pence ? ' and ' + words(pence) + ' Pence' : ''} only.`; };
const component = (abbr) => P.components.find((c) => c.abbr === abbr);
const acctName = (code) => { const a = D.books.accounts.find((x) => x.code === code); return a ? `${a.code} · ${a.name}` : code || ''; };

/* =====================================================================================================
   Workspace and navigation
   ===================================================================================================== */

function registerPayroll() {
  const nav = cx.hasSeat() ? [
    { label: 'Home', route: 'payroll' },
    { label: 'Payroll runs', route: 'payroll-runs', match: ['payroll-run', 'payroll-run-new'] },
    { label: 'Payslips', route: 'payslips', match: ['payslip', 'payslip-print'] },
    { label: 'Salary structure assignments', route: 'structure-assignments', match: ['structure-assignment'] },
    { section: 'Reports', items: [{ label: 'Salary register', route: 'salary-register' }] },
    { section: 'Setup', collapsed: true, items: [
      { label: 'Salary components', route: 'salary-components', match: ['salary-component'] },
      { label: 'Salary structures', route: 'salary-structures', match: ['salary-structure'] },
      { label: 'Payroll configuration', route: 'payroll-config' },
    ] },
  ] : [{ label: 'My payslips', route: 'me-payslips', match: ['me-payslip'] }];
  cx.workspace({ id: 'payroll', label: 'Payroll', icon: 'payroll', route: 'payroll', seatless: true, nav, badge: () => (cx.hasSeat() ? P.runs.filter((r) => ['Draft', 'Submitted'].includes(r.status)).length || null : null) });
}
registerPayroll();
cx.on('persona', registerPayroll);

cx.style('payroll', `
.pr-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--surface); overflow: hidden; }
.pr-step { padding: 12px 14px; display: grid; gap: 6px; align-content: start; border-left: 1px solid var(--line); min-width: 0; position: relative; }
.pr-step:first-child { border-left: 0; }
.pr-step .no { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font: 600 12px/1 var(--font-mono); background: var(--surface-2); color: var(--muted); border: 1px solid var(--line-2); }
.pr-step.done .no { background: var(--t-green-bg); color: var(--t-green); border-color: transparent; }
.pr-step.now { background: var(--accent-soft); }
.pr-step.now .no { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
.pr-step .tt { font: 600 13.5px/1.3 var(--font-ui); }
.pr-step .who { font-size: 12px; color: var(--muted); }
.pr-step .cmd { font: 11px/1.45 var(--font-mono); color: var(--muted); overflow-wrap: anywhere; }
.pr-step .act { margin-top: 2px; }
@media (max-width: 900px) { .pr-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); } .pr-step:nth-child(3) { border-left: 0; } .pr-step:nth-child(n+3) { border-top: 1px solid var(--line); } }
@media (max-width: 520px) { .pr-steps { grid-template-columns: minmax(0, 1fr); } .pr-step { border-left: 0; border-top: 1px solid var(--line); } .pr-step:first-child { border-top: 0; } }
.slip-paper { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 28px; display: grid; gap: 18px; max-width: 860px; width: 100%; margin: 0 auto; box-shadow: var(--shadow-sm); min-width: 0; }
.slip-top { display: flex; gap: 16px; justify-content: space-between; flex-wrap: wrap; border-bottom: 2px solid var(--fg); padding-bottom: 14px; }
.slip-top h2 { font: 700 20px/1.2 var(--font-ui); font-stretch: var(--wide); margin: 0; letter-spacing: .01em; }
.slip-co { font-size: 12.5px; color: var(--muted); line-height: 1.5; }
.slip-meta { text-align: right; font-size: 12.5px; line-height: 1.6; }
.slip-meta b { font: 600 12.5px/1.4 var(--font-mono); }
.slip-kv { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 28px; font-size: 13px; }
.slip-kv div { display: flex; justify-content: space-between; gap: 10px; border-bottom: 1px dotted var(--line-2); padding: 4px 0; min-width: 0; }
.slip-kv span:first-child { color: var(--muted); }
.slip-kv span:last-child { text-align: right; overflow-wrap: anywhere; }
.slip-att { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; }
.slip-att div { padding: 8px 10px; border-left: 1px solid var(--line); display: grid; gap: 2px; }
.slip-att div:first-child { border-left: 0; }
.slip-att small { font-size: 11px; color: var(--muted); }
.slip-att b { font: 600 15px/1.2 var(--font-ui); font-variant-numeric: tabular-nums; }
.slip-ledgers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.slip-ledger table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.slip-ledger th { text-align: left; font-size: 11.5px; color: var(--muted); font-weight: 600; padding: 6px 0; border-bottom: 1px solid var(--line-2); }
.slip-ledger th.n, .slip-ledger td.n { text-align: right; }
.slip-ledger td { padding: 6px 0; border-bottom: 1px solid var(--line); }
.slip-ledger tr.tot td { font-weight: 700; border-bottom: 0; border-top: 1px solid var(--fg); }
.slip-ledger h3 { font: 600 13px/1.3 var(--font-ui); margin: 0 0 4px; }
.slip-net { display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: baseline; justify-content: space-between; padding: 14px 16px; border-radius: var(--r); background: var(--accent-soft); }
.slip-net .amt { font: 700 26px/1.1 var(--font-ui); font-variant-numeric: tabular-nums; }
.slip-net .w { font-size: 12.5px; color: var(--fg-2); }
.slip-foot { font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 12px; display: grid; gap: 4px; overflow-wrap: anywhere; }
.slip-foot .mono { color: var(--fg-2); }
@media (max-width: 640px) { .slip-paper { padding: 16px; } .slip-kv, .slip-ledgers { grid-template-columns: minmax(0, 1fr); } .slip-att { grid-template-columns: repeat(3, minmax(0, 1fr)); } .slip-att div:nth-child(4) { border-left: 0; } .slip-att div:nth-child(n+4) { border-top: 1px solid var(--line); } .slip-meta { text-align: left; } }
.pr-pay-row { cursor: pointer; }
.pr-pay-row.on td { background: var(--accent-soft); }
`);

/* =====================================================================================================
   Payroll workspace
   ===================================================================================================== */

cx.route('payroll', () => {
  if (!cx.hasSeat()) return mySlipsPage();
  const runs = P.runs.filter((r) => r.status !== 'Cancelled');
  const paid = runs.filter((r) => r.status === 'Paid');
  const last = paid.at(-1);
  const prev = paid.at(-2);
  const escrowOpen = P.slips.filter((s) => s.paymentInfo?.escrow?.status === 'Open');
  const lastClaim = P.slips.filter((s) => s.paymentInfo?.escrow?.claimedAt).sort((a, b) => a.paymentInfo.escrow.claimedAt.localeCompare(b.paymentInfo.escrow.claimedAt)).at(-1);
  const nextStart = addDays(last.endDate, 1);
  const nextRun = P.runs.find((r) => r.startDate === nextStart);
  const t = last.totals;
  return cx.workspacePage({
    title: 'Payroll', workspace: 'payroll',
    cmd: { cli: 'capxul org payroll run list', sdk: 'client.org(orgId).payroll.runs.list()', who: 'anyone with a seat reads; People runs it; the Harbourline hat pays it', json: { runs: runs.length, last: { name: last.name, net: t.net, employees: t.employees, status: last.status.toLowerCase() } } },
    actions: [nextRun ? cx.btn(`Open ${monthOf(nextRun)}'s run`, { kind: 'primary', href: ['payroll-run', nextRun.name] }) : cx.btn(`New payroll run: ${fmt.month(nextStart)}`, { kind: 'primary', icon: 'plus', href: ['payroll-run-new'], cmd: `capxul org payroll run create harbourline --start ${nextStart} --end ${monthEnd(nextStart.slice(0, 7))}` })],
    cards: [
      { label: 'Total outgoing salary (last month)', value: fmt.gbp(t.net), sub: `${monthOf(last)} · ${t.employees} payslips`, delta: prev ? { text: `${t.net >= prev.totals.net ? '+' : ''}${fmt.pct((t.net - prev.totals.net) / prev.totals.net)} on ${monthOf(prev)}`, good: null } : null, href: ['payroll-run', last.name], spark: paid.map((r) => r.totals.net) },
      { label: 'Total salary structures', value: fmt.int(P.structures.length), sub: `${P.structures.filter((s) => s.isActive === 'Yes').length} active`, href: ['salary-structures'] },
      { label: 'Waiting to be claimed', value: fmt.gbp(sum(escrowOpen, (s) => s.netPay)), sub: escrowOpen.length ? `${fmt.plural(escrowOpen.length, 'payslip')} in money waiting` : lastClaim ? `Nobody: ${empName(lastClaim.employee)} claimed the last on ${fmt.day(lastClaim.paymentInfo.escrow.claimedAt)}` : 'Nobody', href: ['payslips'] },
      { label: 'Owed to HMRC for October', value: fmt.gbp(t.hmrc), sub: `PAYE ${fmt.gbp(t.paye)} · NI ${fmt.gbp(t.ni + t.erni)} · due 22 Nov`, cmd: `capxul org payroll run get ${last.name}` },
    ],
    charts: [
      { title: 'Outgoing salary', cmd: 'capxul org payroll run list --json', node: cx.chart.bar({ labels: paid.map((r) => fmt.monthShort(r.startDate)), series: [{ name: 'Net pay', values: paid.map((r) => r.totals.net), color: '1' }, { name: 'Deductions', values: paid.map((r) => r.totals.deductions), color: '3' }], stacked: true, line: { name: 'Employer cost', values: paid.map((r) => round2(r.totals.gross + r.totals.employerContributions)) }, height: 230, format: (v) => fmt.compact(v, 'GBP'), tipFormat: (v) => fmt.gbp(v) }) },
      { title: `Where ${monthOf(last)}'s pay went`, node: cx.chart.donut({ items: [{ label: 'Net pay to employees', value: t.net, color: '1' }, { label: 'HM Revenue and Customs', value: t.hmrc, color: '3' }, { label: 'Nest Pensions', value: t.pensions, color: '4' }], center: fmt.compact(t.net + t.hmrc + t.pensions, 'GBP'), format: (v) => fmt.gbp(v, 0) }) },
    ],
    shortcuts: [
      { label: 'Payroll runs', route: 'payroll-runs', count: runs.length, icon: 'payroll' },
      { label: 'Payslips', route: 'payslips', count: P.slips.length, icon: 'file' },
      { label: 'Salary register', route: 'salary-register', icon: 'report' },
      { label: 'Salary structure assignments', route: 'structure-assignments', count: P.assignments.length, icon: 'list' },
    ],
    quick: [
      { title: 'Recent payroll runs', items: [...P.runs].reverse().slice(0, 6).map((r) => ({ label: `${monthOf(r)} · ${r.name}`, sub: `${r.slips.length} payslips · ${r.status}${r.paidAt ? ' ' + fmt.date(r.paidAt) : ''}`, right: fmt.gbp(r.totals.net), route: 'payroll-run', id: r.name })) },
      { title: 'Pay agreements', items: P.agreements.map((a) => ({ label: `${empName(a.payee)} · ${fmt.usdc(a.amount)} a ${a.period}`, sub: `${a.status} · ${a.collections.length} collections, each a payslip born paid`, route: 'payslips', id: emp(a.payee)?.employee })) },
    ],
    links: [
      { title: 'Payroll', items: [{ label: 'Payroll run', route: 'payroll-runs', count: P.runs.length }, { label: 'Salary structure assignment', route: 'structure-assignments' }, { label: 'Payslip', route: 'payslips' }] },
      { title: 'Reports', items: [{ label: 'Salary register', route: 'salary-register', kind: 'report' }] },
      { title: 'Setup', items: [{ label: 'Salary component', route: 'salary-components', count: P.components.length }, { label: 'Salary structure', route: 'salary-structures', count: P.structures.length }, { label: 'Payroll configuration', route: 'payroll-config' }] },
    ],
  });
}, { workspace: 'payroll', title: 'Payroll' });

/* =====================================================================================================
   Salary components, structures, assignments
   ===================================================================================================== */

cx.route('salary-components', () => {
  const g = seatGate('Salary components', 'payroll'); if (g) return g;
  return cx.page({ title: 'Salary components', crumbs: [{ label: 'Payroll', route: 'payroll' }],
    actions: [cx.btn('Add salary component', { kind: 'primary', icon: 'plus', needs: 'People', cmd: 'capxul org payroll component add "<name>" --abbr <ABBR> --type earning --formula "…" --account <code>', onClick: () => cx.toast('A component takes its formula and account on creation.', { cmd: 'capxul org payroll component add "Cycle to Work" --abbr C2W --type deduction --formula "83.33" --account 2400' }) })],
    body: cx.listView({ key: 'salary-components', rows: P.components, id: (r) => r.name, noun: 'salary component', showId: false,
      titleCol: { key: 'name', label: 'Name', sub: (r) => r.description }, status: (r) => ({ text: r.type, tone: r.type === 'Earning' ? 'green' : r.type === 'Deduction' ? 'orange' : 'blue' }), statusLabel: 'Type',
      columns: [{ key: 'abbr', label: 'Abbr', keep: true, render: (r) => h('span.mono', r.abbr) }, { key: 'account', label: 'Account', get: (r) => acctName(r.account) }, { key: 'owedTo', label: 'Owed to' }],
      filters: [{ key: 'name', label: 'Name' }, { key: 'type', label: 'Type', type: 'select', options: ['Earning', 'Deduction', 'Employer Contribution'] }],
      groupBy: [{ key: 'type', label: 'Type' }],
      href: (r) => ['salary-component', r.name], cmd: { cli: 'capxul org payroll component list', sdk: 'client.org(orgId).payroll.components.list()' } }) });
}, { workspace: 'payroll', title: 'Salary components' });

cx.route('salary-component', (ctx) => {
  const g = seatGate('Salary component', 'payroll'); if (g) return g;
  const c = cx.find(P.components, 'name', ctx.id);
  if (!c) return cx.page({ title: 'Not found', body: cx.empty('No such component') });
  const ded = c.type !== 'Earning';
  const doc = { ...c, dependsOnPaymentDays: c.dependsOnPaymentDays ? 1 : 0, taxApplicable: c.type === 'Earning' && c.abbr !== 'AGP' ? 1 : 0, incomeTax: c.abbr === 'PAYE' ? 1 : 0, removeIfZero: 1, statistical: 0, doNotInclude: 0, disabled: 0, amountBasedOnFormula: c.abbr === 'ADVR' || c.abbr === 'AGP' ? 0 : 1, condition: c.abbr === 'ADVR' ? 'advance_recovery > 0' : '' };
  const used = P.slips.filter((s) => [...s.earnings, ...s.deductions, ...(s.employerContributions || [])].some((x) => x.abbr === c.abbr));
  return cx.page({ title: c.name, crumbs: [{ label: 'Payroll', route: 'payroll' }, { label: 'Salary components', route: 'salary-components' }], status: ['Enabled'], sub: `${c.abbr} · ${c.type}`,
    actions: [cx.menu(null, [{ label: 'Disable', needs: 'People', cmd: `capxul org payroll component disable "${c.name}"`, onClick: () => cx.toast('Disabling it leaves it off new structures; slips keep it.', { cmd: `capxul org payroll component disable "${c.name}"` }) }]), cx.btn('Save', { kind: 'primary', needs: 'People', cmd: `capxul org payroll component change "${c.name}" --formula "${c.formula}"`, onClick: () => cx.toast('Saved', { cmd: `capxul org payroll component change "${c.name}" --formula "${c.formula}"` }) })],
    cmd: { cli: `capxul org payroll component add "${c.name}" --abbr ${c.abbr} --type ${c.type.toLowerCase().replace(/ /g, '-')} --formula "${c.formula}" --account ${c.account}${c.owedTo ? ` --payee ${c.owedTo === 'HM Revenue and Customs' ? 'hmrc' : 'nest'}` : ''}`, note: 'How this component was made.', json: { name: c.name, abbr: c.abbr, type: c.type, formula: c.formula, account: c.account, owedTo: c.owedTo || null } },
    body: cx.formView({ doc, tabKey: 'salary-component', tabs: [
      { label: 'Overview', sections: [
        { columns: [[field('Name', 'name', { reqd: true }), field('Abbr', 'abbr', { reqd: true, type: 'mono' }), field('Type', 'type', { reqd: true }), field('Description', 'description', { type: 'textarea' })], [field('Depends on payment days', 'dependsOnPaymentDays', { type: 'check' }), !ded ? field('Is tax applicable', 'taxApplicable', { type: 'check' }) : field('Is income tax component', 'incomeTax', { type: 'check' }), field('Remove if zero valued', 'removeIfZero', { type: 'check' }), field('Statistical component', 'statistical', { type: 'check' }), field('Do not include in total', 'doNotInclude', { type: 'check' }), field('Disabled', 'disabled', { type: 'check' })]] },
        ded ? { label: 'Owed to', desc: 'Who a deduction or employer contribution is remitted to after each run.', fields: [field('Owed to', 'owedTo', { value: c.owedTo || 'Kept by Harbourline (recovers an advance)' })] } : null,
        { label: 'Accounts', table: { columns: [{ key: 'company', label: 'Company' }, { key: 'account', label: 'Account', get: (r) => acctName(r.account) }, { key: 'liability', label: 'Liability account', get: (r) => acctName(r.liability) }], rows: [{ company: D.company.name, account: c.account, liability: c.liability || (c.type === 'Earning' ? '2200' : c.account) }] } },
      ].filter(Boolean) },
      { label: 'Condition and formula', sections: [
        { cols: 1, fields: [field('Condition', 'condition', { type: 'mono' }), field('Amount based on formula', 'amountBasedOnFormula', { type: 'check' }), field('Formula', 'formula', { type: 'mono', wide: true })] },
        { label: 'Help', collapsible: true, node: h('div', { style: 'font-size:13px;display:grid;gap:6px;color:var(--fg-2)' }, h('p', 'Use the field base for the employee\'s base salary. Use component abbreviations in conditions and formulas: BS is Basic Salary, PEN the employee pension.'), h('pre.raw', `BS = base\nPEN = BS * 0.05\nPAYE = max(0, min(BS - PEN - 1047.5, 3141.67)) * 0.2\n     + max(0, BS - PEN - 1047.5 - 3141.67) * 0.4\nNI = max(0, min(BS, 4189) - 1048) * 0.08 + max(0, BS - 4189) * 0.02`)) },
      ] },
    ], connections: [{ group: 'Payroll', items: [{ label: 'Salary structure', count: P.structures.filter((s) => [...s.earnings, ...s.deductions, ...s.employerContributions].includes(c.abbr)).length, route: 'salary-structures' }, { label: 'Payslip', count: used.length, route: 'payslips' }] }] }) });
}, { workspace: 'payroll', title: 'Salary component' });

cx.route('salary-structures', () => {
  const g = seatGate('Salary structures', 'payroll'); if (g) return g;
  return cx.page({ title: 'Salary structures', crumbs: [{ label: 'Payroll', route: 'payroll' }],
    actions: [cx.btn('Add salary structure', { kind: 'primary', icon: 'plus', needs: 'People', cmd: 'capxul org payroll structure create "UK Monthly 2027/28" --frequency monthly --token GBP --earning BS --deduction PEN --deduction PAYE --deduction NI --contribution ERNI --contribution ERPEN --amends "UK Monthly 2026/27"', onClick: () => cx.toast('Next April\'s structure amends this year\'s.', { cmd: 'capxul org payroll structure create "UK Monthly 2027/28" --frequency monthly --token GBP --amends "UK Monthly 2026/27"' }) })],
    body: cx.listView({ key: 'salary-structures', rows: P.structures, id: (r) => r.name, noun: 'salary structure', showId: false,
      titleCol: { key: 'name', label: 'Name', sub: (r) => r.note || r.paidFrom }, status: (r) => (r.docstatus === 'Cancelled' ? { text: 'Cancelled', tone: 'red' } : r.isActive === 'Yes' ? { text: 'Active', tone: 'green' } : { text: 'Inactive', tone: 'gray' }),
      columns: [{ key: 'isActive', label: 'Is active', keep: true }, { key: 'payrollFrequency', label: 'Payroll frequency' }, { key: 'currency', label: 'Currency' }, { key: 'fromDate', label: 'From', type: 'date' }, { key: 'assigned', label: 'Assigned', type: 'int', get: (r) => P.assignments.filter((a) => a.salaryStructure === r.name).length }],
      filters: [{ key: 'name', label: 'Name' }, { key: 'isActive', label: 'Is active', type: 'select', options: ['Yes', 'No'] }],
      href: (r) => ['salary-structure', r.name], cmd: { cli: 'capxul org payroll structure list', sdk: 'client.org(orgId).payroll.structures.list()' } }) });
}, { workspace: 'payroll', title: 'Salary structures' });

/** Work out a payslip for an employee and a period, by the components' formulas. */
function workSlip(e, start, end, o = {}) {
  const a = [...P.assignments].filter((x) => x.employee === e.id && x.fromDate <= end).sort((x, y) => y.fromDate.localeCompare(x.fromDate))[0];
  if (!a) return null;
  const days = eachDay(start, end).length;
  const from = e.dateOfJoining > start ? e.dateOfJoining : start;
  const to = e.relievingDate && e.relievingDate < end ? e.relievingDate : end;
  const lwp = sum(D.hr.leaveApplications.filter((l) => l.employee === e.id && l.status === 'Approved' && l.leaveType === 'Unpaid Leave' && l.fromDate <= end && l.toDate >= start), (l) => l.totalLeaveDays);
  const paymentDays = Math.max(0, eachDay(from, to).length - lwp);
  const BS = round2(a.base * paymentDays / days);
  const PEN = round2(BS * 0.05);
  const PAYE = round2(Math.max(0, Math.min(BS - PEN - 1047.5, 3141.67)) * 0.2 + Math.max(0, BS - PEN - 1047.5 - 3141.67) * 0.4);
  const NI = round2(Math.max(0, Math.min(BS, 4189) - 1048) * 0.08 + Math.max(0, BS - 4189) * 0.02);
  const adv = D.hr.advances.filter((x) => x.employee === e.id && x.settleBySalary && x.settleBySalary.month === start.slice(0, 7) && x.status === 'Paid');
  const ADVR = round2(sum(adv, (x) => x.settleBySalary.amount));
  const ERNI = round2(Math.max(0, BS - 416.67) * 0.15);
  const ERPEN = round2(BS * 0.03);
  const prior = P.slips.filter((s) => s.employee === e.id && s.startDate >= '2026-04-01' && s.startDate < start && s.salaryStructure !== 'Pay agreement');
  const ytd = (abbr) => round2(sum(prior, (s) => [...s.earnings, ...s.deductions].find((x) => x.abbr === abbr)?.amount || 0));
  const deductions = [['PEN', PEN], ['PAYE', PAYE], ['NI', NI], ['ADVR', ADVR]].filter(([, v]) => v > 0).map(([abbr, amount]) => ({ component: component(abbr).name, abbr, amount, ytd: round2(ytd(abbr) + amount) }));
  const gross = BS, total = round2(sum(deductions, (x) => x.amount)), net = round2(gross - total);
  const n = String(P.slips.filter((s) => s.employee === e.id).length + 1).padStart(5, '0');
  return {
    name: `Sal Slip/${e.employee}/${n}`, employee: e.id, department: e.department, designation: e.designation, postingDate: o.posting, startDate: start, endDate: end, salaryStructure: a.salaryStructure, payrollEntry: o.run || null,
    currency: 'GBP', payrollFrequency: 'Monthly', status: 'Draft', workingDays: days, paymentDays, leaveWithoutPay: lwp, absentDays: 0,
    earnings: [{ component: 'Basic Salary', abbr: 'BS', amount: BS, ytd: round2(ytd('BS') + BS) }], deductions,
    employerContributions: [{ component: 'Employer National Insurance', abbr: 'ERNI', amount: ERNI }, { component: 'Pension (Employer 3%)', abbr: 'ERPEN', amount: ERPEN }],
    grossPay: gross, grossYTD: round2(sum(prior, (s) => s.grossPay) + gross), totalDeduction: total, netPay: net, netYTD: round2(sum(prior, (s) => s.netPay) + net), totalInWords: inWords(net),
    leaveDetails: leaveDetails(e.id, end).map(({ alloc, ...x }) => x), paidTo: e.salaryMode === 'Bank' ? 'bank' : 'safe', base: a.base, contentHash: null, paymentInfo: null,
  };
}

function previewSlip(s0) {
  const m = { employee: active().find((p) => P.assignments.some((a) => a.employee === p.id && a.salaryStructure === s0.name))?.id || 'ellis' };
  const box = h('div');
  const draw = () => {
    const e = emp(m.employee); const ym = cx.today.slice(0, 7);
    const s = workSlip(e, ym + '-01', monthEnd(ym), { posting: monthEnd(ym) });
    cx.fill(box, s ? slipPaper(s, { preview: true }) : cx.empty(`${e.name} has no assignment of ${s0.name}.`));
  };
  draw();
  cx.modal({ title: `Preview payslip · ${s0.name}`, wide: true, body: h('div', { style: 'display:grid;gap:12px' }, cx.field({ label: 'Employee', key: 'employee', model: m, edit: true, type: 'select', options: active().filter((p) => P.assignments.some((a) => a.employee === p.id && a.salaryStructure === s0.name)).map((p) => [p.id, p.name]), onChange: draw }), box), actions: [{ label: 'Close', primary: true }] });
}
const active = () => D.people.filter((p) => p.status === 'Active');

function assignModal(structure) {
  const m = { employee: 'hannah', start: addDays(monthEnd(cx.today.slice(0, 7)), 1), base: 2800 };
  cx.modal({ title: `Assign ${structure}`, body: h('div.fields', { style: '--cols:2' }, cx.field({ label: 'Employee', key: 'employee', model: m, edit: true, type: 'select', options: active().filter((p) => p.employmentType !== 'Contract').map((p) => [p.id, p.name]) }), cx.field({ label: 'From date', key: 'start', model: m, edit: true, type: 'date' }), cx.field({ label: 'Base (a month)', key: 'base', model: m, edit: true, type: 'currency' })),
    actions: [{ label: 'Cancel' }, { label: 'Assign', primary: true, needs: 'People', onClick: (close) => {
      const e = emp(m.employee);
      const name = nextName(`HR-SSA-${m.start.slice(2, 4)}-${m.start.slice(5, 7)}-`, P.assignments.map((a) => a.name));
      const base = +m.base;
      P.assignments.push({ employee: e.id, salaryStructure: structure, fromDate: m.start, base, currency: 'GBP', paidBy: 'harbourline', annualGross: base * 12, ctc: round2(base * 12 + Math.max(0, base - 416.67) * 0.15 * 12 + base * 0.03 * 12), department: e.department, costCenter: cx.dept(e.department)?.costCenter, name });
      close(); cx.toast(`${e.name} is on ${structure} at ${fmt.gbp(base)} a month from ${fmt.date(m.start)}`, { cmd: `capxul org payroll structure assign "${structure}" ${e.employee} --start ${m.start} --base ${base}` }); cx.go('structure-assignment', name);
    } }] });
}

cx.route('salary-structure', (ctx) => {
  const g = seatGate('Salary structure', 'payroll'); if (g) return g;
  const s = cx.find(P.structures, 'name', ctx.id);
  if (!s) return cx.page({ title: 'Not found', body: cx.empty('No such structure') });
  const grid = (abbrs) => ({ columns: [{ key: 'component', label: 'Component', render: (r) => cx.link(r.component, 'salary-component', r.component) }, { key: 'abbr', label: 'Abbr', render: (r) => h('span.mono', r.abbr) }, { key: 'formula', label: 'Formula', render: (r) => h('span.mono', { style: 'font-size:12px' }, r.formula), opt: true }, { key: 'dependsOnPaymentDays', label: 'Depends on payment days', type: 'check', opt: true }], rows: abbrs.map((a) => { const c = component(a); return { component: c.name, abbr: a, formula: c.formula, dependsOnPaymentDays: c.dependsOnPaymentDays }; }) });
  const assigns = P.assignments.filter((a) => a.salaryStructure === s.name);
  const status = s.docstatus === 'Cancelled' ? { text: 'Cancelled', tone: 'red' } : { text: 'Submitted', tone: 'blue' };
  return cx.page({ title: s.name, crumbs: [{ label: 'Payroll', route: 'payroll' }, { label: 'Salary structures', route: 'salary-structures' }], status: [status, s.isActive === 'Yes' ? { text: 'Active', tone: 'green' } : { text: 'Inactive', tone: 'gray' }],
    actions: [cx.btn('Preview payslip', { icon: 'eye', onClick: () => previewSlip(s) }), cx.menu('Create', [{ label: 'Single assignment', needs: 'People', cmd: `capxul org payroll structure assign "${s.name}" <employee> --start <date> --base <amount>`, onClick: () => assignModal(s.name) }], { kind: 'primary' })],
    cmd: { cli: `capxul org payroll structure create "${s.name}" --frequency ${s.payrollFrequency.toLowerCase()} --token ${s.currency} ${s.earnings.map((x) => '--earning ' + x).join(' ')} ${s.deductions.map((x) => '--deduction ' + x).join(' ')} ${s.employerContributions.map((x) => '--contribution ' + x).join(' ')}${s.amends ? ` --amends "${s.amends}"` : ''}`.replace(/\s+/g, ' ').trim(), note: 'How this structure was made. Assign it with org payroll structure assign.' },
    body: cx.formView({ doc: { ...s, company: D.company.name }, tabKey: 'salary-structure', tabs: [
      { label: 'Details', sections: [{ columns: [[field('Company', 'company', { readOnly: true }), field('Is active', 'isActive', { reqd: true }), field('Currency', 'currency', { reqd: true })], [field('Payroll frequency', 'payrollFrequency'), field('From', 'fromDate', { type: 'date' }), field('Amends', 'amends', { type: 'link', href: s.amends ? ['salary-structure', s.amends] : null })]] }, s.note ? { label: 'Note', fields: [field('Note', 'note', { type: 'textarea', wide: true })] } : null].filter(Boolean) },
      { label: 'Earnings and deductions', sections: [{ label: 'Earnings', table: grid(s.earnings) }, { label: 'Deductions', table: grid(s.deductions) }, s.employerContributions.length ? { label: 'Employer contributions', table: grid(s.employerContributions) } : null].filter(Boolean) },
      { label: 'Account', sections: [{ fields: [field('Paid from', 'paidFrom', { wide: true }), field('Payroll payable account', 'x', { value: acctName('2200') })] }] },
    ], connections: [{ group: 'Assignments', items: [{ label: 'Salary structure assignment', count: assigns.length, route: 'structure-assignments' }] }, { group: 'Payroll', items: [{ label: 'Payslip', count: P.slips.filter((x) => x.salaryStructure === s.name).length, route: 'payslips' }] }],
    side: { id: s.name, title: s.name, cmd: 'capxul org payroll structure list', created: { by: s.name.includes('2025') ? 'samw' : 'kwame', at: s.fromDate }, modified: { by: 'kwame', at: s.fromDate } } }) });
}, { workspace: 'payroll', title: 'Salary structure' });

cx.route('structure-assignments', (ctx) => {
  const g = seatGate('Salary structure assignments', 'payroll'); if (g) return g;
  const e = ctx.id ? emp(ctx.id) : null;
  return cx.page({ title: 'Salary structure assignments', crumbs: [{ label: 'Payroll', route: 'payroll' }],
    actions: [cx.btn('Add assignment', { kind: 'primary', icon: 'plus', needs: 'People', cmd: 'capxul org payroll structure assign "UK Monthly 2026/27" <employee> --start <date> --base <amount>', onClick: () => assignModal('UK Monthly 2026/27') })],
    body: cx.listView({ key: 'structure-assignments', reset: !!e, initial: e ? { filters: { employee: e.employee } } : null, rows: () => P.assignments, noun: 'assignment',
      titleCol: { key: 'employee', label: 'Employee name', get: (r) => empName(r.employee), sub: (r) => r.salaryStructure }, status: () => ({ text: 'Submitted', tone: 'blue' }),
      columns: [{ key: 'emp', label: 'Employee', get: (r) => empNo(r.employee) }, { key: 'salaryStructure', label: 'Salary structure' }, { key: 'fromDate', label: 'From date', type: 'date', keep: true }, { key: 'dept', label: 'Department', get: (r) => cx.deptName(r.department) }],
      right: { key: 'base', label: 'Base', type: 'currency' },
      filters: [{ key: 'name', label: 'ID' }, { key: 'employee', label: 'Employee', type: 'select', options: () => D.people.map((p) => [p.employee, p.name]), get: (r) => empNo(r.employee), flag: '--employee' }, { key: 'salaryStructure', label: 'Salary structure', type: 'select' }, { key: 'dept', label: 'Department', type: 'select', get: (r) => cx.deptName(r.department) }],
      tabs: [{ label: 'All' }, { label: '2026/27', filter: (r) => r.salaryStructure === 'UK Monthly 2026/27' }, { label: '2025/26', filter: (r) => r.salaryStructure === 'UK Monthly 2025/26' }],
      sort: { options: [{ key: 'fromDate', label: 'From date' }, { key: 'base', label: 'Base' }], default: { key: 'fromDate', dir: 'desc' } },
      groupBy: [{ key: 'salaryStructure', label: 'Salary structure' }, { key: 'dept', label: 'Department', get: (r) => cx.deptName(r.department) }],
      href: (r) => ['structure-assignment', r.name], cmd: { cli: 'capxul org payroll structure list --assignments' } }) });
}, { workspace: 'payroll', title: 'Salary structure assignments' });

cx.route('structure-assignment', (ctx) => {
  const g = seatGate('Salary structure assignment', 'payroll'); if (g) return g;
  const a = cx.find(P.assignments, 'name', ctx.id);
  if (!a) return cx.page({ title: 'Not found', body: cx.empty('No such assignment') });
  const e = emp(a.employee);
  return cx.page({ title: e.name, crumbs: [{ label: 'Payroll', route: 'payroll' }, { label: 'Salary structure assignments', route: 'structure-assignments' }], status: [{ text: 'Submitted', tone: 'blue' }], sub: `${a.name} · ${a.salaryStructure} from ${fmt.date(a.fromDate)}`,
    actions: [cx.btn('Unassign', { kind: 'danger', needs: 'People', cmd: `capxul org payroll structure unassign ${a.name}`, onClick: async () => { if (await cx.confirm({ title: `Unassign ${a.name}?`, body: `${e.firstName} drops out of runs after ${fmt.date(cx.today)} until a new assignment.`, cmd: `capxul org payroll structure unassign ${a.name}`, danger: true, confirmLabel: 'Unassign' })) cx.toast('Unassigned', { cmd: `capxul org payroll structure unassign ${a.name}` }); } })],
    cmd: { cli: `capxul org payroll structure assign "${a.salaryStructure}" ${e.employee} --start ${a.fromDate} --base ${a.base}`, sdk: `client.org(orgId).payroll.structures.assign("${a.salaryStructure}", "${e.employee}", { start: "${a.fromDate}", base: ${a.base} })`, note: 'How this assignment was made.' },
    body: cx.formView({ doc: { ...a, emp: e.employee, employeeName: e.name, deptName: cx.deptName(a.department), designation: e.designation, company: D.company.name, payable: acctName('2200'), variable: 0, paidByName: `${cx.deptName(a.paidBy)} budget (${namesList(hatHolders(a.paidBy))})` }, tabs: [{ label: 'Details', sections: [
      { columns: [[field('Employee', 'emp', { type: 'link', href: ['employee', e.employee], reqd: true }), field('Employee name', 'employeeName'), field('Department', 'deptName'), field('Designation', 'designation')], [field('Salary structure', 'salaryStructure', { type: 'link', href: ['salary-structure', a.salaryStructure], reqd: true }), field('From date', 'fromDate', { type: 'date', reqd: true }), field('Company', 'company', { readOnly: true }), field('Payroll payable account', 'payable'), field('Currency', 'currency')]] },
      { label: 'Base and variable', columns: [[field('Base', 'base', { type: 'currency' }), field('Annual gross earning', 'annualGross', { type: 'currency', readOnly: true })], [field('Variable', 'variable', { type: 'currency' }), field('Total cost to company (CTC)', 'ctc', { type: 'currency', readOnly: true })]] },
      { label: 'Paid by', desc: 'The department budget whose hat pays the runs that include this employee.', fields: [field('Paid by', 'paidByName', { wide: true })] },
      { label: 'Payroll cost centres', collapsible: true, table: { columns: [{ key: 'cc', label: 'Cost centre' }, { key: 'pct', label: 'Percentage', type: 'percent' }], rows: [{ cc: a.costCenter, pct: 100 }] } },
    ] }] }) });
}, { workspace: 'payroll', title: 'Salary structure assignment' });

/* =====================================================================================================
   Payroll runs: the list, the run with its four steps, a new run
   ===================================================================================================== */

cx.route('payroll-runs', () => {
  const g = seatGate('Payroll runs', 'payroll'); if (g) return g;
  const nextStart = addDays(P.runs.filter((r) => r.status !== 'Cancelled').at(-1).endDate, 1);
  return cx.page({ title: 'Payroll runs', crumbs: [{ label: 'Payroll', route: 'payroll' }],
    actions: [cx.btn('New payroll run', { kind: 'primary', icon: 'plus', href: ['payroll-run-new'], cmd: `capxul org payroll run create harbourline --start ${nextStart} --end ${monthEnd(nextStart.slice(0, 7))}` })],
    body: cx.listView({ key: 'payroll-runs', rows: () => P.runs, noun: 'payroll run',
      titleCol: { label: 'Period', get: (r) => monthOf(r), render: (r) => cx.link(monthOf(r), 'payroll-run', r.name), sub: (r) => `${fmt.date(r.startDate)} to ${fmt.date(r.endDate)}` },
      status: (r) => T(r.status, RUN_TONE),
      columns: [{ key: 'postingDate', label: 'Posting date', type: 'date' }, { key: 'dept', label: 'Department', get: (r) => cx.deptName(r.department) }, { key: 'employees', label: 'Employees', type: 'int', get: (r) => r.slips.length }, { key: 'currency', label: 'Currency' }, { key: 'paidBy', label: 'Paid by', get: (r) => (r.paidBy ? cx.name(r.paidBy) : '') }],
      right: { key: 'net', label: 'Net pay', type: 'currency', get: (r) => r.totals.net },
      modified: (r) => r.paidAt || r.submittedAt || r.createdAt,
      filters: [{ key: 'name', label: 'ID' }, { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Submitted', 'Paid', 'Cancelled'], flag: '--status' }, { key: 'postingDate', label: 'Posting month', type: 'month' }],
      tabs: [{ label: 'All' }, { label: 'This tax year', filter: (r) => r.startDate >= '2026-04-01' }, { label: 'Last tax year', filter: (r) => r.startDate < '2026-04-01' }],
      sort: { options: [{ key: 'postingDate', label: 'Posting date' }, { key: 'net', label: 'Net pay', get: (r) => r.totals.net }], default: { key: 'postingDate', dir: 'desc' } },
      groupBy: [{ key: 'status', label: 'Status' }, { key: 'createdBy', label: 'Created by', type: 'person' }],
      href: (r) => ['payroll-run', r.name], cmd: { cli: 'capxul org payroll run list', sdk: 'client.org(orgId).payroll.runs.list()' } }) });
}, { workspace: 'payroll', title: 'Payroll runs' });

function stepStrip(steps) {
  return h('div.pr-steps', steps.map((s, i) => h('div.pr-step', { class: { done: s.state === 'done', now: s.state === 'now' } },
    h('div', { style: 'display:flex;gap:8px;align-items:center' }, h('span.no', s.state === 'done' ? cx.icon('check', { size: 13 }) : String(i + 1)), h('span.tt', s.title)),
    h('div.who', s.who), s.when ? h('div.who', s.when) : null,
    h('div.cmd', '$ ' + s.cmd),
    s.action ? h('div.act', s.action) : null)));
}
const viewAs = (id, why) => (cx.meId() === id ? null : cx.btn(`View as ${cx.name(id)}`, { sm: true, icon: 'user', title: why, onClick: () => cx.setMe(id) }));

/** Create a run: get the employees and work out a draft payslip each. */
async function createRun(o) {
  const name = nextName(`HR-PRUN-${o.posting.slice(0, 4)}-`, P.runs.map((r) => r.name));
  const people = D.people.filter((p) => p.status === 'Active' && p.employmentType !== 'Contract' && p.dateOfJoining <= o.end && (!o.dept || o.dept === 'harbourline' || p.department === o.dept));
  const slips = people.map((e) => workSlip(e, o.start, o.end, { posting: o.posting, run: name })).filter(Boolean);
  for (const s of slips) P.slips.push(s);
  const t = { employees: slips.length, gross: round2(sum(slips, (s) => s.grossPay)), deductions: round2(sum(slips, (s) => s.totalDeduction)), net: round2(sum(slips, (s) => s.netPay)), employerContributions: round2(sum(slips, (s) => sum(s.employerContributions, (x) => x.amount))) };
  const pick = (abbr, list = 'deductions') => round2(sum(slips, (s) => s[list].find((x) => x.abbr === abbr)?.amount || 0));
  Object.assign(t, { paye: pick('PAYE'), ni: pick('NI'), erni: pick('ERNI', 'employerContributions'), pension: pick('PEN'), erpen: pick('ERPEN', 'employerContributions') });
  t.hmrc = round2(t.paye + t.ni + t.erni); t.pensions = round2(t.pension + t.erpen);
  const run = { name, postingDate: o.posting, startDate: o.start, endDate: o.end, department: o.dept || 'harbourline', currency: 'GBP', payrollFrequency: 'Monthly', payrollPayable: '2200', createdBy: cx.meId(), createdAt: nowIso(), submittedAt: null, status: 'Draft', slips: slips.map((s) => s.name), costCenter: 'Main', accrual: null, totals: t, paidBy: null, paidAt: null, batch: `batch_${name}`, payment: null, validateAttendance: !!o.validate };
  P.runs.push(run);
  D.events.unshift({ at: run.createdAt, kind: 'People', text: `${cx.name(cx.meId())} created the payroll run for ${monthOf(run)}: ${slips.length} draft payslips`, ref: { type: 'run', id: name }, who: cx.meId() });
  return run;
}
async function submitRun(run) {
  if (!(await cx.confirm({ title: `Submit ${run.slips.length} payslips for ${monthOf(run)}?`, body: `Each payslip is fixed and stored with its hash, and the accrual is posted: ${fmt.gbp(run.totals.gross)} of pay, ${fmt.gbp(run.totals.deductions)} of deductions, ${fmt.gbp(run.totals.net)} net to pay.`, cmd: `capxul org payroll run submit ${run.name}`, who: `whoever wears People (${peopleHat()})`, confirmLabel: 'Submit the payslips' }))) return;
  for (const s of slipsOf(run)) {
    if (s.status === 'Draft') s.status = 'Submitted';
    s.contentHash = await cx.hashOf({ name: s.name, employee: empNo(s.employee), period: [s.startDate, s.endDate], earnings: s.earnings, deductions: s.deductions, employerContributions: s.employerContributions, netPay: s.netPay });
  }
  for (const s of slipsOf(run)) for (const d of s.deductions.filter((x) => x.abbr === 'ADVR')) {
    const adv = D.hr.advances.find((a) => a.employee === s.employee && a.settleBySalary?.month === s.startDate.slice(0, 7) && a.status === 'Paid');
    if (adv) { adv.returnedAmount = round2((adv.returnedAmount || 0) + d.amount); adv.pendingAmount = round2(Math.max(0, adv.pendingAmount - d.amount)); adv.status = adv.claimedAmount ? 'Partly Claimed and Returned' : 'Returned'; }
  }
  run.status = 'Submitted'; run.submittedAt = nowIso();
  run.accrual = nextName('ACC-JV-2026-', D.books.vouchers.map((v) => v.name));
  D.events.unshift({ at: run.submittedAt, kind: 'People', text: `${cx.name(cx.meId())} submitted ${run.slips.length} payslips for ${monthOf(run)}`, ref: { type: 'run', id: run.name }, who: cx.meId() });
  D.approvals?.waiting?.push({ kind: 'Money', what: `Pay ${monthOf(run)}'s payroll: ${run.slips.length} payslips, ${fmt.gbp(run.totals.net)}`, openedBy: cx.meId(), openedAt: run.submittedAt, waitsFor: hatHolders(run.department), because: `wears the ${cx.deptName(run.department)} hat`, ref: { type: 'run', id: run.name }, command: `capxul org payroll run pay ${run.name}` });
  cx.toast(`Submitted. ${namesList(hatHolders(run.department))} can pay it now.`, { cmd: `capxul org payroll run submit ${run.name}` });
  cx.refresh();
}
/** Pay a run (or its released slips): one batch, one approval, one payment per payslip, each with its proof. */
async function payRun(run, only) {
  const slips = (only || slipsOf(run)).filter((s) => s.status === 'Submitted' && !s.paymentInfo);
  if (!slips.length) { cx.toast('Nothing left to pay in this run.', { tone: 'info' }); return; }
  const rate = cx.rate(cx.today);
  const rowOf = (s) => { const e = emp(s.employee); const bank = e.salaryMode === 'Bank'; const waiting = e.noAccountUntil && e.noAccountUntil > cx.today; return { to: e.name, amount: round2(s.netPay / rate), rail: waiting ? 'Money waiting (claim by email)' : bank ? 'Bank through Bridge' : 'Capxul Safe' }; };
  const rows = slips.map(rowOf);
  const total = round2(sum(rows, (r) => r.amount));
  const net = round2(sum(slips, (s) => s.netPay));
  const warnings = [];
  if (run.postingDate > cx.today) warnings.push(`The posting date is ${fmt.date(run.postingDate)}: paying now sends ${monthOf(run)}'s pay early.`);
  const withheld = slipsOf(run).filter((s) => s.status === 'Withheld');
  if (withheld.length) warnings.push(`${withheld.length} payslip${withheld.length > 1 ? 's are' : ' is'} withheld and not in this batch: ${withheld.map((s) => empName(s.employee)).join(', ')}.`);
  const bankN = rows.filter((r) => r.rail.startsWith('Bank')).length;
  if (bankN) warnings.push(`${bankN} go to banks through Bridge at its quote; Bridge's fees come from the Safe.`);
  const b = cx.budgetOn(run.department);
  if (b && b.left < total) warnings.push(`${cx.deptName(run.department)} has ${fmt.usdc(b.left)} left this quarter.`);
  const r = await cx.approval({
    title: `Pay ${slips.length} payslip${slips.length > 1 ? 's' : ''}: ${monthOf(run)}`, from: `Harbourline Treasury · ${fmt.addr(D.company.treasury)} · ${cx.deptName(run.department)} budget`, to: `${slips.length} employee${slips.length > 1 ? 's' : ''}, one payment each`,
    amount: total, gbp: net, rate, rows, warnings, signer: payerOf(run), hat: cx.deptName(run.department),
    cmd: only ? slips.map((s) => `capxul org payroll run pay ${run.name} --slip "${s.name}"`) : `capxul org payroll run pay ${run.name}`, next: `capxul org payroll run get ${run.name}`,
  });
  if (r.status !== 'done') return;
  run.status = 'Paying';
  const approval = cx.newId('approval');
  const count = run.slips.length;
  for (const [i, s] of slips.entries()) {
    const e = emp(s.employee);
    if (!s.contentHash) s.contentHash = await cx.hashOf({ name: s.name, employee: e.employee, netPay: s.netPay });
    const at = new Date(Date.parse(r.at) + i * 37000).toISOString();
    const p = await makePayment({ empId: e.id, gbp: s.netPay, purpose: 'payroll', budget: run.department, doctype: 'Salary Slip', doc: s.name, date: s.postingDate, content: s.contentHash, lines: [{ idx: 1, description: `Net pay ${s.startDate} to ${s.endDate}`, amount: Math.round(s.netPay * 100), taxes: [] }], approval, at, tx: i === 0 ? r.tx : cx.randHex(32), block: r.block + i * 18, hat: cx.deptName(run.department), batch: { id: run.batch, label: `Payroll ${monthOf(run)}`, index: run.slips.indexOf(s.name) + 1, count } });
    const waiting = e.noAccountUntil && e.noAccountUntil > cx.today;
    s.paymentInfo = { payment: p.id, status: 'Settled', outcome: waiting ? 'Waiting' : null, amountSent: p.amount, fee: p.fee, rate: p.rate, paidTo: waiting ? `Money waiting for ${e.payMailbox}` : e.salaryMode === 'Bank' ? `Bank through Bridge (${e.bank.name} ·· ${e.bank.account.slice(-4)})` : 'Capxul Safe', documentHash: p.proof.documentHash, tx: p.proof.tx, block: p.proof.block, settledAt: p.settledAt, escrow: waiting ? { status: 'Open', fundedAt: p.settledAt, claimedAt: null } : null, batchIndex: run.slips.indexOf(s.name) + 1, batchCount: count };
    s.status = waiting ? 'Escrowed' : 'Paid';
  }
  const all = slipsOf(run);
  run.status = all.every((s) => s.paymentInfo || s.status === 'Withheld') && !all.some((s) => s.status === 'Withheld') ? 'Paid' : 'Submitted';
  if (all.every((s) => s.paymentInfo)) run.status = 'Paid';
  run.paidBy = cx.meId(); run.paidAt = r.at;
  run.payment = { approvedBy: cx.meId(), approvedAt: r.at, batch: run.batch, approval, paid: all.filter((s) => s.paymentInfo && !s.paymentInfo.escrow).length, escrowed: all.filter((s) => s.paymentInfo?.escrow).length, withheld: all.filter((s) => s.status === 'Withheld').length };
  if (D.approvals?.waiting) D.approvals.waiting = D.approvals.waiting.filter((a) => a.ref?.id !== run.name);
  for (const s of slips) (D.notices ||= []).unshift({ to: s.employee, at: r.at, kind: 'HR', text: `Your payslip for ${monthOf(run)} is ready: ${fmt.gbp(s.netPay)} net`, ref: { type: 'payslip', id: s.name }, read: false });
  D.events.unshift({ at: r.at, kind: 'Money', text: `${cx.name(cx.meId())} paid ${monthOf(run)}'s payroll: ${slips.length} payslips, ${fmt.usdc(total)}`, ref: { type: 'run', id: run.name }, who: cx.meId() });
  cx.toast(`Paid ${slips.length} payslip${slips.length > 1 ? 's' : ''}. Each payment carries its payslip's hash.`, { cmd: `capxul org payroll run pay ${run.name}` });
  cx.refresh();
}

function runPaymentSection(run) {
  const slips = slipsOf(run).filter((s) => s.paymentInfo);
  if (!slips.length) return cx.empty('Nothing is paid yet. Paying is one approval for the whole run.');
  const first = paymentOf(slips[0].paymentInfo.payment);
  const proofBox = h('div');
  let sel = slips[0].name;
  const tbody = h('tbody');
  const drawRows = () => cx.fill(tbody, slips.map((s) => {
    const e = emp(s.employee); const pi = s.paymentInfo;
    return h('tr.pr-pay-row', { class: { on: s.name === sel }, onclick: () => { sel = s.name; drawRows(); showProof(); } },
      h('td', h('div', { style: 'font-weight:600' }, e.name), h('div.muted', { style: 'font-size:12px' }, cx.link(s.name, 'payslip', s.name))),
      h('td.num', fmt.gbp(s.netPay)), h('td.num.opt', fmt.usdc(pi.amountSent)), h('td.opt', h('span', { style: 'font-size:12.5px' }, pi.paidTo)),
      h('td.opt', cx.tx(pi.tx)), h('td', cx.pill(pi.escrow ? (pi.escrow.status === 'Claimed' ? 'Claimed' : 'Money waiting') : s.withheld ? 'Paid after release' : 'Settled', pi.escrow?.status === 'Open' ? 'escrow' : 'green')));
  }));
  const showProof = () => { const s = slipByName(sel); const p = paymentOf(s.paymentInfo.payment); cx.fill(proofBox, p ? cx.proof(p, { title: `Proof · ${empName(s.employee)}`, subtitle: `Payslip ${s.name}, committed on chain` }) : cx.empty('No payment record')); };
  drawRows(); showProof();
  const pay = run.payment || {};
  const escrowed = slips.filter((s) => s.paymentInfo.escrow);
  return h('div', { style: 'display:grid;gap:12px' },
    cx.kv([
      ['Approved by', h('span', cx.personChip(pay.approvedBy || run.paidBy), h('span.muted', ` from their Safe, as ${cx.deptName(run.department)} · ${fmt.datetime(pay.approvedAt || run.paidAt)}`))],
      ['Batch', h('span.mono', run.batch)],
      ['Approval', first?.approval ? h('span.mono', first.approval) : '—'],
      ['Paid', `${slips.length} of ${run.slips.length} payslips · ${fmt.usdc(sum(slips, (s) => s.paymentInfo.amountSent))} from the Treasury for ${fmt.gbp(sum(slips, (s) => s.netPay))}`],
      ['Bridge fees', fmt.usdc(sum(slips, (s) => s.paymentInfo.fee || 0))],
      escrowed.length ? ['Money waiting', h('div', { style: 'display:grid;gap:4px' }, escrowed.map((s) => { const e = emp(s.employee); const es = s.paymentInfo.escrow; return h('span', `${e.name}: ${fmt.gbp(s.netPay)} sent to ${e.payMailbox} on ${fmt.datetime(es.fundedAt)}. `, es.status === 'Claimed' ? h('b', `Claimed ${fmt.datetime(es.claimedAt)}.`) : h('span', 'Waiting to be claimed; you can take it back with ', h('code', `capxul payment cancel ${s.paymentInfo.payment}`), ' until it is.')); }))] : null,
    ]),
    h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Payslip'), h('th.num', 'Net pay'), h('th.num.opt', 'Sent'), h('th.opt', 'Paid to'), h('th.opt', 'Transaction'), h('th', 'Status'))), tbody)),
    h('div.muted', { style: 'font-size:12.5px' }, 'One approval paid the batch; each payslip is its own payment with its own proof. Pick a row to see it.'),
    proofBox);
}

function runForm(run) {
  const slips = slipsOf(run);
  const t = run.totals;
  const payer = payerOf(run);
  const created = run.status !== 'New';
  const submitted = !!run.submittedAt;
  const paid = run.status === 'Paid';
  const paidSome = slips.some((s) => s.paymentInfo);
  const toPay = slips.filter((s) => s.status === 'Submitted' && !s.paymentInfo);
  const withheld = slips.filter((s) => s.status === 'Withheld');
  const steps = [
    { title: 'Get employees and create payslips', who: `People · ${created ? `${cx.name(run.createdBy)}, ${fmt.datetime(run.createdAt)}` : peopleHat()}`, cmd: `capxul org payroll run create ${run.department} --start ${run.startDate} --end ${run.endDate} --posting ${run.postingDate}`, state: created ? 'done' : 'now' },
    { title: 'Submit payslips', who: `People · ${submitted ? `${cx.name(run.createdBy)}, ${fmt.datetime(run.submittedAt)}` : peopleHat()}`, cmd: `capxul org payroll run submit ${run.name}`, state: submitted ? 'done' : created ? 'now' : 'todo',
      action: !submitted && created ? h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, cx.btn('Submit payslips', { kind: 'primary', sm: true, needs: 'People', cmd: `capxul org payroll run submit ${run.name}`, onClick: () => submitRun(run) }), cx.wears('People') ? null : viewAs(wearersOf('People').includes('isla') ? 'isla' : wearersOf('People')[0], 'People submits the run')) : null },
    { title: toPay.length && paidSome ? `Pay ${toPay.length} released` : `Pay ${slips.length} payslips`, who: `${cx.deptName(run.department)} hat · ${paid || paidSome ? `${cx.name(run.paidBy)}, ${fmt.datetime(run.paidAt)}` : cx.name(payer)}`, cmd: `capxul org payroll run pay ${run.name}`, state: paid ? 'done' : submitted ? 'now' : 'todo',
      action: submitted && toPay.length ? h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, cx.btn(`Pay ${toPay.length}`, { kind: 'primary', sm: true, icon: 'passkey', needs: { dept: run.department }, cmd: `capxul org payroll run pay ${run.name}`, onClick: () => payRun(run, paidSome ? toPay : null) }), cx.holds(run.department) ? null : viewAs(payer, `${cx.deptName(run.department)} pays the run`)) : null },
    { title: 'Settled, with proof', who: paid || paidSome ? `${slips.filter((s) => s.paymentInfo).length} payments on Base${slips.some((s) => s.paymentInfo?.escrow) ? ` · ${slips.filter((s) => s.paymentInfo?.escrow).length} through money waiting` : ''}${withheld.length ? ` · ${withheld.length} withheld` : ''}` : 'Each payslip settles as its own payment, carrying its hash', when: paid ? `Last settled ${fmt.datetime(slips.map((s) => s.paymentInfo?.settledAt).filter(Boolean).sort().at(-1))}` : null, cmd: `capxul org payroll run get ${run.name}`, state: paid ? 'done' : 'todo' },
  ];
  const doc = { ...run, company: D.company.name, paidFrom: 'Harbourline Treasury · USDC; bank-paid slips through Bridge at its quote', payable: acctName(run.payrollPayable), deptName: cx.deptName(run.department), n: slips.length, validate: run.validateAttendance === false ? 0 : 1, costCenterName: run.costCenter, paymentAccount: `Harbourline Treasury · ${fmt.addr(D.company.treasury)} · USDC`, timesheet: 0 };
  const unmarked = run.endDate > cx.today ? eachDay(addDays(cx.today, 1), run.endDate).filter((d) => ![0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay())).length : 0;
  const form = cx.formView({ doc, tabKey: 'payroll-run', tabs: [
    { label: 'Overview', sections: [
      { columns: [[field('Posting date', 'postingDate', { type: 'date', reqd: true }), field('Company', 'company', { readOnly: true })], [field('Currency', 'currency', { reqd: true }), field('Paid from', 'paidFrom'), field('Payroll payable account', 'payable', { reqd: true }), field('Status', 'status', { type: 'status' })]] },
      { columns: [[field('Salary slip based on timesheet', 'timesheet', { type: 'check' }), field('Payroll frequency', 'payrollFrequency')], [field('Start date', 'startDate', { type: 'date', reqd: true }), field('End date', 'endDate', { type: 'date', reqd: true })]] },
      { label: 'Totals', cols: 3, fields: [field('Gross pay', 'x1', { type: 'currency', value: t.gross }), field('Total deductions', 'x2', { type: 'currency', value: t.deductions }), field('Net pay', 'x3', { type: 'currency', value: t.net, render: () => h('b', fmt.gbp(t.net)) }), field('Employer contributions', 'x4', { type: 'currency', value: t.employerContributions }), field('Owed to HM Revenue and Customs', 'x5', { type: 'currency', value: t.hmrc, help: 'PAYE, employee and employer NI; due by the 22nd of the next month' }), field('Owed to Nest Pensions', 'x6', { type: 'currency', value: t.pensions })] },
    ] },
    { label: 'Employees', count: slips.length, sections: [
      { label: 'Filter employees', cols: 2, fields: [field('Department', 'deptName', { help: 'The run names a department, whose budget pays it. Harbourline is the top one: everyone.' }), field('Number of employees', 'n', { type: 'int', readOnly: true })] },
      { label: 'Employee details', table: { columns: [{ key: 'emp', label: 'Employee', render: (r) => empLink(r.employee, empNo(r.employee)) }, { key: 'name', label: 'Employee name', get: (r) => empName(r.employee) }, { key: 'department', label: 'Department', get: (r) => cx.deptName(r.department), opt: true }, { key: 'slip', label: 'Payslip', render: (r) => cx.link(r.name.split('/').slice(1).join('/'), 'payslip', r.name), opt: true }, { key: 'netPay', label: 'Net pay', type: 'currency' }, { key: 'paidTo', label: 'Paid to', get: (r) => (emp(r.employee).noAccountUntil > cx.today ? 'Money waiting' : r.paidTo === 'bank' ? 'Bank' : 'Safe'), opt: true }, { key: 'pay', label: 'Payment', render: (r) => { const o = payOutcome(r); return cx.pill(o, SLIP_TONE[o]); } }], rows: slips, totals: ['netPay'], rowHref: (r) => ['payslip', r.name] } },
      { label: 'Validate attendance', fields: [field('Validate attendance', 'validate', { type: 'check' }), field('Unmarked days', 'x7', { value: unmarked ? `${unmarked} working days after today are not marked yet. Pay is worked from leave, so they count as present.` : 'None: every working day in the period is marked.' })] },
    ] },
    { label: 'Accounting and payment', sections: [
      { label: 'Accounting dimensions', cols: 2, fields: [field('Cost centre', 'costCenterName', { reqd: true }), field('Accrual', 'accrual', { type: 'link', href: run.accrual && cx.hasRoute('journal-entry') ? ['journal-entry', run.accrual] : null })] },
      { label: 'Payment entry', cols: 2, fields: [field('Payment account', 'paymentAccount'), field('Bank account', 'x8', { value: 'None: paid from the Safe; Bridge pays banks' })] },
      { label: 'Payment', node: runPaymentSection(run) },
    ] },
  ], connections: [{ group: 'Payslips', items: [{ label: 'Payslip', count: slips.length, route: 'payslips' }] }, { group: 'Accounting', items: [{ label: 'Accrual (journal entry)', count: run.accrual ? 1 : 0, route: run.accrual && cx.hasRoute('journal-entry') ? 'journal-entry' : null, id: run.accrual }, { label: 'Payments', count: slips.filter((s) => s.paymentInfo).length, route: cx.hasRoute('payments') ? 'payments' : null }] }],
  side: { id: run.name, title: monthOf(run), cmd: `capxul org payroll run get ${run.name}`, created: { by: run.createdBy, at: run.createdAt }, modified: { by: run.paidBy || run.createdBy, at: run.paidAt || run.submittedAt || run.createdAt } },
  timeline: { items: [
    { at: run.createdAt, who: run.createdBy, kind: 'created', text: `created the run with ${slips.length} draft payslips` },
    run.submittedAt ? { at: run.submittedAt, who: run.createdBy, kind: 'submitted', text: `submitted ${slips.length} payslips; accrual ${run.accrual || 'posted'}` } : null,
    run.paidAt ? { at: run.paidAt, who: run.paidBy, kind: 'approval', text: `approved the batch with a passkey as ${cx.deptName(run.department)}` } : null,
    ...slips.filter((s) => s.paymentInfo?.escrow?.claimedAt).map((s) => ({ at: s.paymentInfo.escrow.claimedAt, kind: 'money', text: `${empName(s.employee)} claimed ${fmt.gbp(s.netPay)} from money waiting` })),
    ...slips.filter((s) => s.withheld).map((s) => ({ at: s.withheld.at, who: s.withheld.by, kind: 'status', text: `withheld ${empName(s.employee)}'s payslip`, body: s.withheld.reason })),
    ...slips.filter((s) => s.withheld?.releasedAt).map((s) => ({ at: s.withheld.releasedAt, who: s.withheld.releasedBy, kind: 'money', text: `released ${empName(s.employee)}'s payslip; paid on its own` })),
  ].filter(Boolean) } });
  return h('div', { style: 'display:grid;gap:14px;min-width:0' }, stepStrip(steps), form);
}

cx.route('payroll-run', (ctx) => {
  const g = seatGate('Payroll run', 'payroll'); if (g) return g;
  const run = cx.find(P.runs, 'name', ctx.id);
  if (!run) return cx.page({ title: 'Not found', body: cx.empty('No such payroll run') });
  const i = P.runs.indexOf(run);
  const toPay = slipsOf(run).filter((s) => s.status === 'Submitted' && !s.paymentInfo);
  const actions = [
    P.runs[i - 1] ? cx.btn(null, { icon: 'left', sm: true, title: monthOf(P.runs[i - 1]), href: ['payroll-run', P.runs[i - 1].name] }) : null,
    P.runs[i + 1] ? cx.btn(null, { icon: 'right', sm: true, title: monthOf(P.runs[i + 1]), href: ['payroll-run', P.runs[i + 1].name] }) : null,
    cx.menu('View', [{ label: 'Salary register', href: ['salary-register'], icon: 'report', onClick: () => cx.go('salary-register', null, { report: { run: run.name } }) }, { label: 'Payslips', href: ['payslips'], icon: 'file' }]),
  ];
  if (run.status === 'Draft') actions.push(cx.btn('Cancel', { kind: 'danger', needs: 'People', cmd: `capxul org payroll run cancel ${run.name}`, onClick: async () => { if (await cx.confirm({ title: `Cancel ${run.name}?`, body: 'Its draft payslips are deleted. Nothing was paid.', cmd: `capxul org payroll run cancel ${run.name}`, danger: true, confirmLabel: 'Cancel the run' })) { run.status = 'Cancelled'; for (const s of slipsOf(run)) s.status = 'Cancelled'; cx.toast('Cancelled', { cmd: `capxul org payroll run cancel ${run.name}` }); cx.refresh(); } } }), cx.btn('Submit payslips', { kind: 'primary', needs: 'People', cmd: `capxul org payroll run submit ${run.name}`, onClick: () => submitRun(run) }));
  if (run.status === 'Submitted' && toPay.length) actions.push(cx.btn(`Pay ${toPay.length} payslip${toPay.length > 1 ? 's' : ''}`, { kind: 'primary', icon: 'passkey', needs: { dept: run.department }, cmd: `capxul org payroll run pay ${run.name}`, onClick: () => payRun(run, slipsOf(run).some((s) => s.paymentInfo) ? toPay : null) }));
  const banner = run.status === 'Draft' ? cx.banner(cx.wears('People') ? 'Check the payslips, then submit them. Submitting fixes each payslip and posts the accrual.' : `People submits the run (${peopleHat()}).`, { tone: 'warning', action: cx.wears('People') ? null : viewAs('isla', 'People submits the run') })
    : run.status === 'Submitted' && toPay.length ? cx.banner(cx.holds(run.department) ? `Ready to pay: ${toPay.length} payslips, ${fmt.gbp(sum(toPay, (s) => s.netPay))}, one approval with your passkey.` : `Waiting for ${cx.name(payerOf(run))}, who wears the ${cx.deptName(run.department)} hat, to pay it.`, { tone: 'warning', action: cx.holds(run.department) ? null : viewAs(payerOf(run), `${cx.deptName(run.department)} pays the run`) })
      : run.status === 'Cancelled' ? cx.banner('Cancelled. Nothing was paid.', { tone: 'danger' }) : null;
  return cx.page({
    title: `${monthOf(run)} payroll`, crumbs: [{ label: 'Payroll', route: 'payroll' }, { label: 'Payroll runs', route: 'payroll-runs' }], status: [T(run.status, RUN_TONE)],
    sub: `${run.name} · ${cx.deptName(run.department)} · ${run.slips.length} employees · posting ${fmt.date(run.postingDate)}`,
    actions, banner,
    cmd: { cli: `capxul org payroll run get ${run.name}`, sdk: `client.org(orgId).payroll.runs.get("${run.name}")`, who: 'anyone with a seat', json: { name: run.name, status: run.status.toLowerCase(), start: run.startDate, end: run.endDate, department: run.department, slips: run.slips.length, gross: run.totals.gross, net: run.totals.net, batch: run.batch, paid: run.payment?.paid ?? 0, escrowed: run.payment?.escrowed ?? 0 } },
    fde: `Payroll run ${run.name}, ${monthOf(run)}`,
    body: runForm(run),
  });
}, { workspace: 'payroll', title: 'Payroll run' });

cx.route('payroll-run-new', () => {
  const g = seatGate('New payroll run', 'payroll'); if (g) return g;
  const lastRun = P.runs.filter((r) => r.status !== 'Cancelled').at(-1);
  const start = addDays(lastRun.endDate, 1);
  const end = monthEnd(start.slice(0, 7));
  const existing = P.runs.find((r) => r.startDate === start && r.status !== 'Cancelled');
  if (existing) return cx.page({ title: 'New payroll run', crumbs: [{ label: 'Payroll', route: 'payroll' }, { label: 'Payroll runs', route: 'payroll-runs' }], body: cx.card({ body: h('div', { style: 'display:grid;gap:10px' }, h('p', `${fmt.month(start)} already has a run: ${existing.name} (${existing.status}).`), cx.btn(`Open ${existing.name}`, { kind: 'primary', href: ['payroll-run', existing.name] })) }) });
  let posting = addDays(end, -3); while ([0, 6].includes(new Date(posting + 'T00:00:00Z').getUTCDay())) posting = addDays(posting, -1);
  const m = { postingDate: posting, startDate: start, endDate: end, department: 'harbourline', currency: 'GBP', payrollFrequency: 'Monthly', validate: 1 };
  const preview = h('div');
  const count = () => D.people.filter((p) => p.status === 'Active' && p.employmentType !== 'Contract' && p.dateOfJoining <= m.endDate && (m.department === 'harbourline' || p.department === m.department)).length;
  const drawPreview = () => cx.fill(preview, h('p.muted', { style: 'font-size:13px' }, `${count()} employees will be in the run: everyone on a UK salary structure${m.department === 'harbourline' ? '' : ' in ' + cx.deptName(m.department)}. Sofia Lindqvist is paid by her pay agreement, never by a run.`));
  drawPreview();
  const cmdOf = () => `capxul org payroll run create ${m.department} --start ${m.startDate} --end ${m.endDate} --posting ${m.postingDate}`;
  const create = async () => {
    const run = await createRun({ posting: m.postingDate, start: m.startDate, end: m.endDate, dept: m.department, validate: !!m.validate });
    cx.toast(`Created ${run.name} with ${run.slips.length} draft payslips`, { cmd: cmdOf() });
    cx.go('payroll-run', run.name);
  };
  const steps = stepStrip([
    { title: 'Get employees and create payslips', who: `People · ${peopleHat()}`, cmd: 'capxul org payroll run create harbourline --start … --end …', state: 'now', action: h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, cx.btn('Create run', { kind: 'primary', sm: true, needs: 'People', cmd: cmdOf(), onClick: create }), cx.wears('People') ? null : viewAs('isla', 'People creates the run')) },
    { title: 'Submit payslips', who: 'People', cmd: 'capxul org payroll run submit <run>', state: 'todo' },
    { title: 'Pay the payslips', who: `${cx.deptName('harbourline')} hat · ${namesList(hatHolders('harbourline'))}`, cmd: 'capxul org payroll run pay <run>', state: 'todo' },
    { title: 'Settled, with proof', who: 'Each payslip settles as its own payment, carrying its hash', cmd: 'capxul org payroll run get <run>', state: 'todo' },
  ]);
  return cx.page({ title: `New payroll run · ${fmt.month(start)}`, crumbs: [{ label: 'Payroll', route: 'payroll' }, { label: 'Payroll runs', route: 'payroll-runs' }], status: [{ text: 'Not saved', tone: 'orange' }],
    actions: [cx.btn('Create run', { kind: 'primary', needs: 'People', cmd: cmdOf(), onClick: create })],
    cmd: { cli: cmdOf(), sdk: `client.org(orgId).payroll.runs.create("${m.department}", { start: "${m.startDate}", end: "${m.endDate}", posting: "${m.postingDate}" })`, who: `whoever wears People (${peopleHat()})`, note: 'Creating gets the employees and works out a draft payslip each, in one step.' },
    banner: cx.wears('People') ? null : cx.banner(`Creating a run is People's: ${peopleHat()}. You are viewing as ${cx.me().name}.`, { tone: 'info', action: viewAs('isla', 'People creates the run') }),
    body: h('div', { style: 'display:grid;gap:14px;min-width:0' }, steps, cx.formView({ doc: m, editable: true, tabs: [
      { label: 'Overview', sections: [
        { columns: [[field('Posting date', 'postingDate', { type: 'date', reqd: true }), field('Company', 'x1', { value: D.company.name, readOnly: true })], [field('Currency', 'currency', { readOnly: true }), field('Paid from', 'x2', { value: 'Harbourline Treasury · USDC', readOnly: true }), field('Payroll payable account', 'x3', { value: acctName('2200'), readOnly: true })]] },
        { columns: [[field('Payroll frequency', 'payrollFrequency', { readOnly: true })], [field('Start date', 'startDate', { type: 'date', reqd: true }), field('End date', 'endDate', { type: 'date', reqd: true })]] },
      ] },
      { label: 'Employees', sections: [{ label: 'Filter employees', fields: [field('Department', 'department', { type: 'select', options: D.departments.map((d) => [d.id, d.name + (d.id === 'harbourline' ? ' (everyone)' : '')]) }), field('Validate attendance', 'validate', { type: 'check' })] }, { node: preview }] },
    ], onChange: () => { drawPreview(); cx.setCommand({ cli: cmdOf() }); } })) });
}, { workspace: 'payroll', title: 'New payroll run' });

/* =====================================================================================================
   Payslips: list, form, printed view
   ===================================================================================================== */

cx.route('payslips', (ctx) => {
  const e = ctx.id ? emp(ctx.id) : null;
  if (!cx.hasSeat()) { if (e && e.id === cx.meId()) return mySlipsPage(); return seatGate('Payslips', 'payroll'); }
  return cx.page({ title: 'Payslips', crumbs: [{ label: 'Payroll', route: 'payroll' }],
    body: cx.listView({ key: 'payslips', reset: !!e, initial: e ? { filters: { employee: e.employee } } : null, rows: () => P.slips, noun: 'payslip',
      titleCol: { key: 'employee', label: 'Employee name', get: (r) => empName(r.employee), sub: (r) => periodText(r) },
      status: (r) => { const o = payOutcome(r); return T(o, SLIP_TONE); },
      columns: [{ key: 'postingDate', label: 'Posting date', type: 'date' }, { key: 'emp', label: 'Employee', get: (r) => empNo(r.employee) }, { key: 'salaryStructure', label: 'Salary structure' }, { key: 'payrollEntry', label: 'Payroll run' }, { key: 'paid', label: 'Paid to', get: (r) => (r.paymentInfo?.paidTo || '').replace(/ \(.*\)$/, '') }],
      right: { key: 'netPay', label: 'Net pay', type: 'currency' },
      modified: (r) => r.paymentInfo?.settledAt || r.postingDate,
      filters: [{ key: 'name', label: 'ID' }, { key: 'employee', label: 'Employee', type: 'select', options: () => D.people.map((p) => [p.employee, p.name]), get: (r) => empNo(r.employee), flag: '--employee' }, { key: 'dept', label: 'Department', type: 'select', get: (r) => cx.deptName(r.department) }, { key: 'salaryStructure', label: 'Salary structure', type: 'select' }, { key: 'postingDate', label: 'Month', type: 'month' }],
      tabs: [{ label: 'All' }, { label: 'October 2026', filter: (r) => r.startDate.startsWith('2026-10') }, { label: 'Pay agreements', filter: (r) => !!r.agreement }, { label: 'Withheld or waiting', filter: (r) => !!r.withheld || !!r.paymentInfo?.escrow || r.status === 'Withheld' }],
      sort: { options: [{ key: 'postingDate', label: 'Posting date' }, { key: 'netPay', label: 'Net pay' }], default: { key: 'postingDate', dir: 'desc' } },
      groupBy: [{ key: 'dept', label: 'Department', get: (r) => cx.deptName(r.department) }, { key: 'salaryStructure', label: 'Salary structure' }, { key: 'payrollEntry', label: 'Payroll run' }],
      href: (r) => ['payslip', r.name], bulk: [{ label: 'Export', cmd: 'capxul org payroll run get <run> --json', onClick: (rows) => cx.toast(`${rows.length} payslips: this is the command Capxul would run. The mock-up makes no downloads.`) }],
      cmd: { cli: 'capxul org payroll run get HR-PRUN-2026-00010', note: 'The organisation reads payslips through their run; each employee reads their own with payroll payslip list.' } }) });
}, { workspace: 'payroll', title: 'Payslips' });

function withholdSlip(s) {
  const m = { reason: '' };
  cx.modal({ title: `Withhold ${empName(s.employee)}'s payslip`, body: h('div', { style: 'display:grid;gap:10px' }, h('p', 'A withheld payslip stays out of the run\'s batch until it is released.'), cx.field({ label: 'Reason', key: 'reason', model: m, edit: true, type: 'textarea', reqd: true, placeholder: 'Final pay held until equipment is returned' })),
    actions: [{ label: 'Back' }, { label: 'Withhold', danger: true, cmd: `capxul org payroll payslip withhold "${s.name}" --reason "…"`, onClick: (close) => {
      if (!m.reason.trim()) { cx.toast('Give a reason', { tone: 'warning' }); return; }
      s.status = 'Withheld'; s.withheld = { reason: m.reason.trim(), by: cx.meId(), at: nowIso() };
      close(); cx.toast('Withheld', { cmd: `capxul org payroll payslip withhold "${s.name}" --reason "${m.reason.trim()}"` }); cx.refresh();
    } }] });
}

export function slipPaper(s, o = {}) {
  const e = emp(s.employee);
  const cur = s.currency || 'GBP';
  const p = paymentOf(s.paymentInfo?.payment);
  const pi = s.paymentInfo;
  const ledger = (title, rows, total, ytdOn = true) => h('div.slip-ledger', h('h3', title), h('table', h('thead', h('tr', h('th', 'Component'), h('th.n', 'This period'), ytdOn ? h('th.n', 'Year to date') : null)),
    h('tbody', rows.map((r) => h('tr', h('td', r.component), h('td.n', money(r.amount, cur)), ytdOn ? h('td.n', r.ytd != null ? money(r.ytd, cur) : '') : null)), total ? h('tr.tot', h('td', total[0]), h('td.n', money(total[1], cur)), ytdOn ? h('td.n', total[2] != null ? money(total[2], cur) : '') : null) : null)));
  const kv = (pairs) => h('div.slip-kv', pairs.filter(Boolean).map(([k, v]) => h('div', h('span', k), h('span', v ?? '—'))));
  const bankLine = pi ? (pi.escrow ? `Sent to money waiting for ${e.payMailbox} on ${fmt.datetime(pi.escrow.fundedAt)}${pi.escrow.claimedAt ? `; claimed ${fmt.datetime(pi.escrow.claimedAt)}` : '; not claimed yet'}.` : `Paid ${fmt.datetime(pi.settledAt)} to ${pi.paidTo.replace('Bank through Bridge ', '').replace(/[()]/g, '')}${pi.paidTo.startsWith('Bank') ? ' through Bridge' : ''}.`) : s.status === 'Withheld' ? `Withheld: ${s.withheld?.reason}.` : o.preview ? 'A preview: nothing is stored or paid.' : 'Not paid yet.';
  return h('article.slip-paper', { 'aria-label': `Payslip ${s.name}` },
    h('header.slip-top', h('div', h('h2', 'Salary Statement'), h('div', { style: 'font-weight:600;margin-top:4px' }, periodText(s) === fmt.month(s.startDate) ? `${fmt.date(s.startDate)} to ${fmt.date(s.endDate)}` : periodText(s)), h('div.slip-co', h('b', D.company.name), h('br'), D.company.address, h('br'), `Company no. ${D.company.companyNumber}`)),
      h('div.slip-meta', h('div', h('b', o.preview ? 'Preview' : s.name)), h('div', `Issued ${fmt.date(s.postingDate)}`), h('div', s.salaryStructure), h('div', { style: 'margin-top:6px' }, cx.pill(payOutcome(s), SLIP_TONE[payOutcome(s)])))),
    kv([['Employee name', e.name], ['Employee ID', e.employee], ['Designation', s.designation], ['Department', cx.deptName(s.department)], ['Salary structure', s.salaryStructure], ['Payroll frequency', s.payrollFrequency], ['Pay mailbox', e.payMailbox], cur !== 'GBP' ? ['Currency', cur] : ['Tax code', '1257L · NI category A']]),
    s.workingDays != null ? h('div.slip-att', [['Working days', s.workingDays], ['Payment days', s.paymentDays], ['Leave without pay', s.leaveWithoutPay], ['Absent days', s.absentDays], ['Unmarked days', 0]].map(([k, v]) => h('div', h('small', k), h('b', fmt.num(v, v % 1 ? 1 : 0))))) : h('div.muted', { style: 'font-size:13px' }, `Collected under pay agreement ${s.agreement}: no working days are counted.`),
    h('div.slip-ledgers',
      ledger('Earnings', s.earnings, ['Gross pay', s.grossPay, s.grossYTD]),
      ledger('Deductions', s.deductions.length ? s.deductions : [{ component: 'None', amount: 0 }], ['Total deduction', s.totalDeduction, s.deductions.length ? round2(sum(s.deductions, (x) => x.ytd || 0)) : null])),
    s.employerContributions?.length ? ledger('Employer contributions (not deducted from pay)', s.employerContributions, null, false) : null,
    h('div.slip-net', h('div', h('div', { style: 'font-size:12px;color:var(--muted)' }, 'Net pay'), h('div.amt', money(s.netPay, cur))), h('div', { style: 'display:grid;gap:2px;min-width:0' }, h('div.w', s.totalInWords), h('div.w', `Net paid year to date ${money(s.netYTD, cur)}`))),
    s.leaveDetails?.length ? h('div.slip-ledger', h('h3', 'Leave balances'), h('table', h('thead', h('tr', h('th', 'Leave type'), h('th.n', 'Used'), h('th.n', 'Available'))), h('tbody', s.leaveDetails.map((x) => h('tr', h('td', x.leaveType), h('td.n', fmt.num(x.used, 1)), h('td.n', fmt.num(x.available, 1))))))) : null,
    h('footer.slip-foot',
      h('div', bankLine),
      pi ? h('div', 'Document hash ', h('span.mono', pi.documentHash), '; transaction ', h('span.mono', pi.tx), pi.block ? ` in block ${fmt.int(pi.block)} on Base.` : '.') : null,
      s.contentHash ? h('div', 'This payslip\'s own hash ', h('span.mono', s.contentHash), p ? ' is what the payment commits to.' : '.') : null,
      h('div', 'This is a computer generated document and does not require a signature.')));
}

cx.route('payslip', (ctx) => {
  const s = cx.find(P.slips, 'name', ctx.id);
  if (!s) return cx.page({ title: 'Not found', body: cx.empty('No such payslip') });
  if (!cx.hasSeat() && s.employee !== cx.meId()) return seatGate('Payslip', 'payroll');
  const e = emp(s.employee);
  const run = runByName(s.payrollEntry);
  const p = paymentOf(s.paymentInfo?.payment);
  const pi = s.paymentInfo;
  const outcome = payOutcome(s);
  const cur = s.currency || 'GBP';
  const agr = s.agreement ? P.agreements.find((a) => a.id === s.agreement) : null;
  const doc = { ...s, emp: e.employee, employeeName: e.name, company: D.company.name, deptName: cx.deptName(s.department), withholding: s.withheld ? `${s.withheld.reason} (${cx.name(s.withheld.by)}, ${fmt.date(s.withheld.at)}${s.withheld.releasedAt ? `; released ${fmt.date(s.withheld.releasedAt)}` : ''})` : null, paidToText: pi?.paidTo || paidToLong(e), monthToDate: s.netPay, timesheet: 0 };
  const earnGrid = (rows) => ({ columns: [{ key: 'component', label: 'Component', render: (r) => cx.link(r.component, 'salary-component', r.component) }, { key: 'abbr', label: 'Abbr', render: (r) => h('span.mono', r.abbr), opt: true }, { key: 'amount', label: 'Amount', type: 'currency', currency: cur }, { key: 'ytd', label: 'Year to date', type: 'currency', currency: cur, opt: true }], rows, totals: ['amount'], empty: 'None' });
  const actions = [cx.btn('View payslip', { icon: 'eye', href: ['payslip-print', s.name], cmd: `capxul document render --content-hash ${s.contentHash || '…'}` })];
  if (['Draft', 'Submitted'].includes(s.status) && !pi) actions.push(cx.btn('Withhold', { needs: 'People', cmd: `capxul org payroll payslip withhold "${s.name}" --reason "…"`, onClick: () => withholdSlip(s) }));
  if (s.status === 'Withheld') actions.push(cx.btn('Release', { kind: 'primary', needs: 'People', cmd: `capxul org payroll payslip release "${s.name}"`, onClick: () => { s.status = 'Submitted'; s.withheld.releasedAt = nowIso(); s.withheld.releasedBy = cx.meId(); cx.toast(`Released. ${cx.name(run ? payerOf(run) : 'maya')} pays it from the run.`, { cmd: [`capxul org payroll payslip release "${s.name}"`, `capxul org payroll run pay ${s.payrollEntry} --slip "${s.name}"`] }); cx.refresh(); } }));
  if (s.status === 'Submitted' && !pi && run && run.slips.some((n) => slipByName(n)?.paymentInfo)) actions.push(cx.btn('Pay this payslip', { kind: 'primary', icon: 'passkey', needs: { dept: run.department }, cmd: `capxul org payroll run pay ${run.name} --slip "${s.name}"`, onClick: () => payRun(run, [s]) }));
  if (pi?.escrow?.status === 'Open') actions.push(cx.btn('Take it back', { kind: 'danger', needs: { dept: run?.department || 'harbourline' }, cmd: `capxul payment cancel ${pi.payment}`, onClick: async () => { if (await cx.confirm({ title: 'Take back this pay from money waiting?', body: `${fmt.gbp(s.netPay)} goes back to ${cx.deptName(run?.department || 'harbourline')}'s budget and the payslip waits to be paid again.`, cmd: `capxul payment cancel ${pi.payment}`, danger: true, confirmLabel: 'Take it back' })) { pi.escrow.status = 'Taken back'; s.status = 'Submitted'; cx.toast('Taken back', { cmd: `capxul payment cancel ${pi.payment}` }); cx.refresh(); } } }));
  const tl = [
    run ? { at: run.createdAt, who: run.createdBy, kind: 'created', text: `created this payslip in ${run.name}` } : { at: pi?.settledAt || s.postingDate, kind: 'created', text: `Born paid: ${empName(s.employee)} collected it under the pay agreement` },
    run?.submittedAt ? { at: run.submittedAt, who: run.createdBy, kind: 'submitted', text: 'submitted it with the run' } : null,
    s.withheld ? { at: s.withheld.at, who: s.withheld.by, kind: 'status', text: 'withheld it', body: s.withheld.reason } : null,
    s.withheld?.releasedAt ? { at: s.withheld.releasedAt, who: s.withheld.releasedBy, kind: 'change', text: 'released it' } : null,
    pi?.escrow ? { at: pi.escrow.fundedAt, kind: 'money', text: `Sent to money waiting for ${e.payMailbox}: ${e.firstName} had no Capxul account yet` } : null,
    pi ? { at: pi.escrow?.claimedAt || pi.settledAt, kind: 'money', text: pi.escrow?.claimedAt ? `${e.firstName} claimed it · proof ${fmt.hash(pi.documentHash)}` : `Paid ${fmt.usdc(pi.amountSent)} · proof ${fmt.hash(pi.documentHash)}`, href: cx.hasRoute('payment') ? ['payment', pi.payment] : null } : null,
  ].filter(Boolean);
  return cx.page({
    title: e.name, crumbs: [{ label: 'Payroll', route: 'payroll' }, { label: 'Payslips', route: 'payslips' }], status: [T(outcome, SLIP_TONE)],
    sub: `${s.name} · ${periodText(s)} · net ${money(s.netPay, cur)}`,
    actions,
    cmd: s.employee === cx.meId() ? { cli: `capxul payroll payslip get "${s.name}"`, sdk: `client.me.payroll.payslips.get("${s.name}")`, who: 'the employee, for their own' } : { cli: s.payrollEntry ? `capxul org payroll run get ${s.payrollEntry}` : `capxul org payroll agreement list`, note: `${e.firstName} reads it with payroll payslip get "${s.name}".`, json: { name: s.name, employee: e.employee, period: [s.startDate, s.endDate], gross: s.grossPay, deductions: s.totalDeduction, net: s.netPay, status: outcome.toLowerCase(), payment: pi?.payment || null, documentHash: pi?.documentHash || null, contentHash: s.contentHash } },
    banner: s.status === 'Withheld' ? cx.banner(`Withheld: ${s.withheld.reason}`, { tone: 'warning' }) : pi?.escrow?.status === 'Open' ? cx.banner(`Waiting for ${e.firstName} to claim it at ${e.payMailbox}. The payer can take it back until then.`, { tone: 'escrow' }) : pi?.escrow?.status === 'Claimed' ? cx.banner(`${e.firstName} had no Capxul account when this was paid, so it waited in money waiting from ${fmt.datetime(pi.escrow.fundedAt)} until ${e.firstName} claimed it on ${fmt.datetime(pi.escrow.claimedAt)}.`, { tone: 'escrow' }) : null,
    fde: `Payslip ${s.name} for ${e.name}`,
    body: cx.formView({ doc, tabKey: 'payslip', tabs: [
      { label: 'Details', sections: [
        { label: 'Employee info', columns: [[field('Employee', 'emp', { type: 'link', href: ['employee', e.employee], reqd: true }), field('Employee name', 'employeeName'), field('Company', 'company', { readOnly: true }), field('Department', 'deptName'), field('Designation', 'designation')], [field('Posting date', 'postingDate', { type: 'date', reqd: true }), field('Status', 'status', { render: () => cx.pill(outcome, SLIP_TONE[outcome]) }), field('Salary withholding', 'withholding'), field('Currency', 'currency')]] },
        { label: 'Payroll info', columns: [[field('Payroll frequency', 'payrollFrequency'), field('Start date', 'startDate', { type: 'date' }), field('End date', 'endDate', { type: 'date' })], [field('Salary structure', 'salaryStructure', { type: 'link', href: ['salary-structure', s.salaryStructure] }), field(agr ? 'Pay agreement' : 'Payroll run', agr ? 'agreement' : 'payrollEntry', { type: agr ? 'mono' : 'link', href: run ? ['payroll-run', run.name] : null }), field('Paid to', 'paidToText'), field('Salary slip based on timesheet', 'timesheet', { type: 'check' })]] },
      ] },
      { label: 'Payment days', sections: [{ columns: [[field('Working days', 'workingDays', { type: 'float', dp: 1 }), field('Leave without pay', 'leaveWithoutPay', { type: 'float', dp: 1 })], [field('Absent days', 'absentDays', { type: 'float', dp: 1 }), field('Payment days', 'paymentDays', { type: 'float', dp: 1 })]] },
        { label: 'Payment days calculation help', collapsible: true, collapsed: true, node: h('p', { style: 'font-size:13px;color:var(--fg-2);margin:0' }, 'Working days are the calendar days in the period: holidays are included. Payment days start at the joining date and end at the relieving date, less leave without pay and absent days. Basic Salary depends on payment days; PAYE and NI are worked from the prorated rows.') }] },
      { label: 'Earnings and deductions', sections: [
        { node: h('div.grid.c2', h('div', { style: 'display:grid;gap:6px;min-width:0' }, h('h3', { style: 'font:600 13px/1.3 var(--font-ui);margin:0' }, 'Earnings'), cx.grid(earnGrid(s.earnings))), h('div', { style: 'display:grid;gap:6px;min-width:0' }, h('h3', { style: 'font:600 13px/1.3 var(--font-ui);margin:0' }, 'Deductions'), cx.grid(earnGrid(s.deductions)))) },
        s.employerContributions?.length ? { label: 'Employer contributions', collapsible: true, table: { columns: [{ key: 'component', label: 'Component' }, { key: 'abbr', label: 'Abbr', render: (r) => h('span.mono', r.abbr) }, { key: 'amount', label: 'Amount', type: 'currency', currency: cur }, { key: 'owed', label: 'Owed to', get: (r) => component(r.abbr)?.owedTo, opt: true }], rows: s.employerContributions, totals: ['amount'] } } : null,
        { label: 'Totals', cols: 3, fields: [field('Gross pay', 'grossPay', { type: 'currency', currency: cur }), field('Gross year to date', 'grossYTD', { type: 'currency', currency: cur }), field('Total deduction', 'totalDeduction', { type: 'currency', currency: cur })] },
      ].filter(Boolean) },
      { label: 'Net pay info', sections: [{ cols: 2, fields: [field('Net pay', 'netPay', { type: 'currency', currency: cur, render: () => h('b', { style: 'font-size:16px' }, money(s.netPay, cur)) }), field('Year to date', 'netYTD', { type: 'currency', currency: cur }), field('Month to date', 'monthToDate', { type: 'currency', currency: cur }), field('Total in words', 'totalInWords', { wide: true })] }] },
      { label: 'Payment', sections: [
        { cols: 2, fields: [
          field('Status', 'x1', { render: () => cx.pill(outcome, SLIP_TONE[outcome]) }), field('Paid to', 'paidToText'),
          field('Amount sent', 'x2', { render: () => (pi ? h('span', cur === 'USDC' ? `${fmt.usdc(pi.amountSent)} from ${cx.deptName(agr?.budget || s.department)}'s budget` : pi.paidTo.startsWith('Bank') ? `The bank received ${fmt.gbp(s.netPay)}; the Safe sent ${fmt.usdc(pi.amountSent)} at Bridge's quote (1 USDC = £${pi.rate}); Bridge's fee ${fmt.usdc(pi.fee)}` : `${fmt.usdc(pi.amountSent)} at 1 USDC = £${pi.rate}`) : h('span.faint', 'Not paid yet')) }),
          field('Payment', 'x3', { render: () => (pi ? h('span', cx.hasRoute('payment') ? cx.link(pi.payment, 'payment', pi.payment) : h('span.mono', pi.payment), pi.batchCount ? h('span.muted', ` · item ${pi.batchIndex} of ${pi.batchCount} in ${s.payrollEntry}`) : agr ? h('span.muted', ' · a collection under the pay agreement') : s.withheld ? h('span.muted', ' · paid on its own after release') : null) : h('span.faint', '—')) }),
          pi?.escrow ? field('Money waiting', 'x4', { wide: true, render: () => h('span', `Sent to ${e.payMailbox} on ${fmt.datetime(pi.escrow.fundedAt)}. `, pi.escrow.claimedAt ? h('b', `Claimed ${fmt.datetime(pi.escrow.claimedAt)}.`) : h('span', 'Waiting; take it back with ', h('code', `capxul payment cancel ${pi.payment}`))) }) : null,
        ].filter(Boolean) },
        { label: 'Proof', node: p ? cx.proof(p, { subtitle: 'This payslip\'s hash, carried on chain by its payment' }) : cx.proof({ proof: null }, { none: s.status === 'Withheld' ? 'No proof: the payslip is withheld and unpaid.' : 'No proof yet: the payslip is not paid.' }) },
      ] },
      { label: 'Leaves', sections: [{ table: { columns: [{ key: 'leaveType', label: 'Leave type' }, { key: 'totalAllocated', label: 'Total allocated leave(s)', type: 'float', dp: 1 }, { key: 'expired', label: 'Expired leave(s)', type: 'float', dp: 1, opt: true }, { key: 'used', label: 'Used leave(s)', type: 'float', dp: 1 }, { key: 'pending', label: 'Leave(s) pending approval', type: 'float', dp: 1, opt: true }, { key: 'available', label: 'Available leave(s)', type: 'float', dp: 1 }], rows: s.leaveDetails || [], empty: 'No leave on a pay agreement' } }] },
    ], connections: [{ group: 'Payroll', items: [{ label: 'Payroll run', count: run ? 1 : 0, route: run ? 'payroll-run' : null, id: run?.name }] }, { group: 'Payment', items: [{ label: 'Payment', count: pi ? 1 : 0, route: pi && cx.hasRoute('payment') ? 'payment' : null, id: pi?.payment }, { label: 'Journal entry (accrual)', count: run?.accrual ? 1 : 0, route: run?.accrual && cx.hasRoute('journal-entry') ? 'journal-entry' : null, id: run?.accrual }] }],
    side: { id: s.name, title: e.name, cmd: `capxul payroll payslip get "${s.name}"`, attachments: [], created: { by: run?.createdBy || s.employee, at: run?.createdAt || s.postingDate }, modified: { by: run?.paidBy || s.employee, at: pi?.settledAt || s.postingDate } },
    timeline: { items: tl } }),
  });
}, { workspace: 'payroll', title: 'Payslip' });

cx.route('payslip-print', (ctx) => {
  const s = cx.find(P.slips, 'name', ctx.id);
  if (!s) return cx.page({ title: 'Not found', body: cx.empty('No such payslip') });
  if (!cx.hasSeat() && s.employee !== cx.meId()) return seatGate('Payslip', 'payroll');
  const renderCmd = `capxul document render --content-hash ${s.contentHash}${s.paymentInfo ? ` --document-hash ${s.paymentInfo.documentHash}` : ''}`;
  return cx.page({ title: `Payslip · ${empName(s.employee)}`, crumbs: [{ label: 'Payroll', route: 'payroll' }, { label: 'Payslips', route: 'payslips' }, { label: s.name, route: 'payslip', id: s.name }],
    actions: [cx.btn('Back to the payslip', { icon: 'left', href: ['payslip', s.name] }), cx.btn('Save as PDF', { icon: 'file', cmd: renderCmd, onClick: () => cx.toast('This is the command Capxul would run. The mock-up makes no downloads.', { cmd: renderCmd }) })],
    cmd: { cli: renderCmd, sdk: `client.paymentDocuments.render({ contentHash: "${s.contentHash}" })`, who: 'the employee, and anyone with a seat', note: 'A payslip names its employer and its employee.' },
    body: slipPaper(s) });
}, { workspace: 'payroll', title: 'Payslip' });

/* =====================================================================================================
   Salary register
   ===================================================================================================== */

cx.route('salary-register', (ctx) => {
  const g = seatGate('Salary register', 'payroll'); if (g) return g;
  const months = [...new Set(P.slips.map((s) => s.startDate.slice(0, 7)))].sort().reverse();
  const init = ctx.state?.report?.run ? runByName(ctx.state.report.run)?.startDate.slice(0, 7) : null;
  return cx.page({ title: 'Salary register', crumbs: [{ label: 'Payroll', route: 'payroll' }],
    body: repView({ key: 'salary-register',
      filters: [{ key: 'month', label: 'Month', type: 'select', options: months.map((m) => [m, fmt.month(m)]), value: init || '2026-10' }, { key: 'dept', label: 'Department', type: 'select', options: [['', 'All departments'], ...D.departments.filter((d) => d.parent).map((d) => [d.id, d.name])], value: '' }, { key: 'status', label: 'Document status', type: 'select', options: ['Submitted', 'Draft', 'All'], value: 'Submitted' }, { key: 'currency', label: 'Currency', type: 'select', options: ['GBP', 'USDC'], value: 'GBP' }, { key: 'employer', label: 'Show employer contributions', type: 'check', value: false }],
      cmd: (v) => { const run = P.runs.find((r) => r.startDate.startsWith(v.month) && r.status !== 'Cancelled'); return run ? { cli: `capxul org payroll run get ${run.name}`, sdk: `client.org(orgId).payroll.runs.get("${run.name}")`, note: 'One run with its slips: its net pay total is the run\'s payments.' } : { cli: 'capxul org payroll agreement list' }; },
      run: (v) => {
        const slips = P.slips.filter((s) => s.startDate.startsWith(v.month) && s.currency === v.currency && (!v.dept || s.department === v.dept) && (v.status === 'All' || (v.status === 'Draft' ? s.status === 'Draft' : s.status !== 'Draft' && s.status !== 'Cancelled')));
        const ded = ['PEN', 'PAYE', 'NI', 'ADVR'].filter((a) => slips.some((s) => s.deductions.some((x) => x.abbr === a)));
        const earn = [...new Set(slips.flatMap((s) => s.earnings.map((x) => x.abbr)))];
        const er = ['ERNI', 'ERPEN'];
        const amt = (s, list, a) => s[list]?.find((x) => x.abbr === a)?.amount ?? 0;
        const cur = v.currency;
        const rows = slips.map((s) => {
          const e = emp(s.employee); const o = payOutcome(s);
          const r = { id: s.name, slip: s.name, employee: e.employee, employeeName: e.name, joined: e.dateOfJoining, department: cx.deptName(s.department), designation: s.designation, start: s.startDate, end: s.endDate, lwp: s.leaveWithoutPay, absent: s.absentDays, days: s.paymentDays, gross: s.grossPay, totalDed: s.totalDeduction, net: s.netPay, currency: cur, payment: o, proof: s.paymentInfo?.documentHash || '', payId: s.paymentInfo?.payment };
          for (const a of earn) r['e_' + a] = amt(s, 'earnings', a);
          for (const a of ded) r['d_' + a] = amt(s, 'deductions', a);
          for (const a of er) r['c_' + a] = amt(s, 'employerContributions', a);
          r.totalEr = round2(sum(er, (a) => r['c_' + a]));
          return r;
        });
        const type = cur === 'USDC' ? 'usdc' : 'currency';
        const columns = [
          { key: 'slip', label: 'Salary slip ID', width: '200px', href: (r) => ['payslip', r.slip] }, { key: 'employee', label: 'Employee', href: (r) => ['employee', r.employee] }, { key: 'employeeName', label: 'Employee name', width: '130px' }, { key: 'joined', label: 'Date of joining', type: 'date' }, { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation', width: '160px' },
          { key: 'start', label: 'Start date', type: 'date' }, { key: 'end', label: 'End date', type: 'date' }, { key: 'lwp', label: 'Leave without pay', type: 'float', dp: 1 }, { key: 'absent', label: 'Absent days', type: 'float', dp: 1 }, { key: 'days', label: 'Payment days', type: 'float', dp: 1, total: false },
          ...earn.map((a) => ({ key: 'e_' + a, label: component(a).name, type, currency: cur })), { key: 'gross', label: 'Gross pay', type, currency: cur },
          ...ded.map((a) => ({ key: 'd_' + a, label: component(a).name, type, currency: cur })), { key: 'totalDed', label: 'Total deduction', type, currency: cur }, { key: 'net', label: 'Net pay', type, currency: cur },
          ...(v.employer ? [...er.map((a) => ({ key: 'c_' + a, label: component(a).name, type, currency: cur })), { key: 'totalEr', label: 'Total employer contribution', type, currency: cur }] : []),
          { key: 'currency', label: 'Currency' }, { key: 'payment', label: 'Payment', render: (r) => cx.pill(r.payment, SLIP_TONE[r.payment]) }, { key: 'proof', label: 'Proof', render: (r) => (r.proof ? (cx.hasRoute('payment') ? cx.link(fmt.hash(r.proof), 'payment', r.payId, { class: 'mono' }) : h('span.mono', fmt.hash(r.proof))) : '') },
        ];
        const tot = { gross: sum(rows, (r) => r.gross), net: sum(rows, (r) => r.net), ded: sum(rows, (r) => r.totalDed) };
        return {
          columns, rows, totals: true,
          summary: [{ label: 'Payslips', value: fmt.int(rows.length), sub: fmt.month(v.month) }, { label: 'Gross pay', value: money(tot.gross, cur) }, { label: 'Total deduction', value: money(tot.ded, cur) }, { label: 'Net pay', value: money(tot.net, cur), sub: rows.every((r) => r.proof) && rows.length ? 'Every net paid, each with its proof' : `${rows.filter((r) => !r.proof).length} not paid` }],
          empty: 'No payslips for these filters.',
        };
      },
    }) });
}, { workspace: 'payroll', title: 'Salary register' });

/* =====================================================================================================
   Payroll configuration
   ===================================================================================================== */

cx.route('payroll-config', () => {
  const g = seatGate('Payroll configuration', 'payroll'); if (g) return g;
  const doc = { basedOn: 'Leave', unmarked: 'Present', includeHolidays: 1, disableRounded: 1, emailSlip: 0, showLeave: 1, perEmployee: 1, payable: acctName('2200'), maxHours: 0, lwpDays: 'Working days only', payFrom: 'Harbourline Treasury · USDC', bankRoute: 'Bridge, at its quote, by Faster Payments', escrow: 'Money waiting, claimed by email; the payer can take it back until claimed' };
  return cx.page({ title: 'Payroll configuration', crumbs: [{ label: 'Payroll', route: 'payroll' }], actions: [cx.btn('Save', { kind: 'primary', needs: 'People', onClick: () => cx.toast('Saved') })],
    cmd: { cli: 'capxul org payroll run list', note: 'These rules are fixed by Capxul or set on each structure and run; there is no separate settings command.' },
    body: cx.formView({ doc, tabs: [
      { label: 'Payroll', sections: [{ cols: 2, fields: [field('Payroll based on', 'basedOn', { help: 'Leave without pay reduces payment days; unmarked days count as present.' }), field('Consider unmarked attendance as', 'unmarked'), field('Include holidays in total no. of working days', 'includeHolidays', { type: 'check' }), field('Disable rounded total', 'disableRounded', { type: 'check' }), field('Show leave balances in payslip', 'showLeave', { type: 'check' }), field('Process payroll accounting entry based on employee', 'perEmployee', { type: 'check' }), field('Email payslip to employee', 'emailSlip', { type: 'check', help: 'Capxul tells each employee when their payslip is paid.' }), field('Payroll payable account', 'payable')] }] },
      { label: 'Paying', sections: [{ cols: 1, fields: [field('Paid from', 'payFrom'), field('To a bank', 'bankRoute'), field('To someone with no account', 'escrow'), field('Who pays', 'x', { value: 'Whoever wears the hat of the department the run names; one approval for the batch' })] }] },
    ] }) });
}, { workspace: 'payroll', title: 'Payroll configuration' });

/* =====================================================================================================
   The employee's own payslips (Salary tab of My HR)
   ===================================================================================================== */

function mySlipsPage() {
  const me = cx.me();
  const mine = P.slips.filter((s) => s.employee === me.id && s.status !== 'Draft' && s.status !== 'Cancelled').sort((a, b) => b.startDate.localeCompare(a.startDate));
  const periods = [['2026-04-01', 'Apr 2026 - Mar 2027'], ['2025-04-01', 'Apr 2025 - Mar 2026']];
  let per = periods[0][0];
  const box = h('div', { style: 'display:grid;gap:14px' });
  const draw = () => {
    const end = addDays(per, 365);
    const list = mine.filter((s) => s.startDate >= per && s.startDate < end);
    const latest = list[0];
    const cur = latest?.currency || 'GBP';
    cx.fill(box,
      h('section.hr-panel', h('h3', h('span.grow', 'Year to date'), h('select.ctl', { style: 'width:auto', 'aria-label': 'Payroll period', onchange: (e) => { per = e.target.value; draw(); } }, periods.map(([v, l]) => h('option', { value: v, selected: v === per }, l)))),
        latest ? h('div.hr-gauges', h('div.hr-gauge', h('b', money(cur === 'USDC' ? sum(list, (s) => s.grossPay) : latest.grossYTD, cur)), h('small', 'Gross pay')), h('div.hr-gauge', h('b', money(cur === 'USDC' ? sum(list, (s) => s.netPay) : latest.netYTD, cur)), h('small', 'Net pay')), h('div.hr-gauge', h('b', String(list.length)), h('small', 'Payslips'))) : h('div.muted', 'No payslips in this period')),
      h('section.hr-panel', h('h3', 'Payslips'), list.length ? list.map((s) => h('a.hr-row.click', { href: cx.href('me-payslip', s.name), style: 'text-decoration:none;color:inherit' }, h('div.grow', h('div.t', periodText(s)), h('div.s', `Gross pay: ${money(s.grossPay, s.currency)}${s.paymentInfo?.escrow ? ' · waited for you to claim it' : ''}`)), h('b.num', money(s.netPay, s.currency)), cx.icon('right'))) : h('div.muted', 'Nothing yet')));
  };
  draw();
  return cx.page({ title: 'My payslips', crumbs: [{ label: 'HR', route: 'hr' }, { label: 'My HR', route: 'me' }], workspace: 'hr',
    cmd: { cli: 'capxul payroll payslip list', sdk: 'client.me.payroll.payslips.list()', who: `${me.name}, from every employer; no seat needed` },
    body: appFrame('me-payslips', box) });
}
cx.route('me-payslips', () => mySlipsPage(), { workspace: 'hr', title: 'My payslips' });
cx.route('me-payslip', (ctx) => {
  const s = cx.find(P.slips, 'name', ctx.id);
  if (!s || s.employee !== cx.meId()) return cx.page({ title: 'Payslip', crumbs: [{ label: 'My HR', route: 'me' }], body: cx.empty(s ? 'This is not your payslip. You see your own from My HR.' : 'No such payslip') });
  return cx.page({ title: `Payslip · ${periodText(s)}`, crumbs: [{ label: 'My HR', route: 'me' }, { label: 'My payslips', route: 'me-payslips' }], workspace: 'hr',
    cmd: { cli: `capxul payroll payslip get "${s.name}"`, sdk: `client.me.payroll.payslips.get("${s.name}")`, who: 'you, for your own' },
    actions: [s.paymentInfo ? cx.btn('Verify the proof', { icon: 'shield', cmd: `capxul document verify --document-hash ${s.paymentInfo.documentHash} --content-hash ${s.contentHash}`, onClick: async () => { const p = paymentOf(s.paymentInfo.payment); const res = p ? await cx.verify(p) : []; cx.toast(res.length && res.every((c) => c.ok) ? 'Proof verified: the payment carries this payslip\'s hash' : 'Could not verify', { tone: res.every((c) => c.ok) ? 'success' : 'danger', cmd: `capxul document verify --document-hash ${s.paymentInfo.documentHash}` }); } }) : null],
    body: appFrame('me-payslips', slipPaper(s)) });
}, { workspace: 'hr', title: 'My payslip' });

/* =====================================================================================================
   Search
   ===================================================================================================== */

cx.search.add((q, limit) => {
  if (!cx.hasSeat()) return [];
  const s = q.toLowerCase();
  const out = [];
  for (const r of P.runs) if (r.name.toLowerCase().includes(s) || monthOf(r).toLowerCase().includes(s)) out.push({ kind: 'Payroll runs', label: `${monthOf(r)} · ${r.name}`, sub: `${r.slips.length} payslips · ${fmt.gbp(r.totals.net)}`, route: 'payroll-run', id: r.name, icon: 'payroll' });
  for (const sl of P.slips) if (out.length < limit * 2 && sl.name.toLowerCase().includes(s)) out.push({ kind: 'Payslips', label: `${sl.name} · ${empName(sl.employee)}`, sub: periodText(sl), route: 'payslip', id: sl.name, icon: 'file' });
  return out;
});
