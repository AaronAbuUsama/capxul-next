// The shell's component gallery: every shared component drawn from Harbourline's data. It is not loaded by the app.
// Load it from the browser console to see the components and copy their use:
//   await import('./js/gallery.js'); location.hash = 'gallery';
import { cx, h } from './core.js';

const D = cx.data;
const fmt = cx.fmt;
const acct = (code) => D.books.accounts.find((a) => a.code === code);

cx.workspace({
  id: 'gallery', label: 'Component gallery', icon: 'report', route: 'gallery', seatless: true,
  nav: [
    { label: 'Workspace and charts', route: 'gallery' },
    { label: 'List view', route: 'gallery-list' },
    { label: 'Form view', route: 'gallery-form' },
    { section: 'More', items: [
      { label: 'Report view', route: 'gallery-report' },
      { label: 'Tree view', route: 'gallery-tree' },
      { label: 'Kanban', route: 'gallery-kanban' },
      { label: 'Actions and money', route: 'gallery-actions' },
    ] },
  ],
});

cx.route('gallery', () => {
  const pl = D.books.reports.profitAndLoss.filter((m) => m.month >= '2026-04');
  const tre = cx.rows('money.statements.treasury');
  const monthEnd = new Map();
  for (const r of tre) monthEnd.set(String(r.time).slice(0, 7), r.balanceAfter);
  const months = [...monthEnd.keys()].sort();
  const open = D.books.salesInvoices.filter((i) => i.outstanding > 0);
  const age = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const i of open) { const d = (Date.parse(cx.today) - Date.parse(i.dueDate)) / 864e5; age[d <= 30 ? '0-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+'] += i.outstanding; }
  const p = D.projects.projects.find((x) => x.name === 'PROJ-0010') || D.projects.projects.at(-1);
  const tasks = D.projects.tasks.filter((t) => t.project === p.name && !t.isGroup).slice(0, 10);
  return cx.workspacePage({
    title: 'Component gallery', workspace: 'gallery',
    cmd: { cli: 'capxul org books reports profit-and-loss --from 2026-04-01 --to 2026-10-31', who: 'anyone with a seat', json: { from: '2026-04-01', to: '2026-10-31', income: pl.reduce((a, m) => a + m.income, 0) } },
    cards: [
      { label: 'Sales invoiced', value: fmt.gbp(pl.reduce((a, m) => a + m.income, 0)), sub: 'this fiscal year', delta: { text: '+6.2% on last month', good: true }, href: ['gallery-list'], spark: pl.map((m) => m.income) },
      { label: 'In the Treasury', value: fmt.usdc(D.money.safes.treasury.balance), sub: fmt.gbp(D.money.safes.treasury.gbp), cmd: 'capxul balance --org harbourline' },
      { label: 'Money waiting', value: fmt.usdc(D.money.safes.moneyWaiting.balance), sub: `${D.money.safes.moneyWaiting.open} open escrows` },
      { label: 'Receivables', value: fmt.gbp(open.reduce((a, i) => a + i.outstanding, 0)), sub: `${open.length} invoices open`, delta: { text: '2 overdue', good: false } },
    ],
    charts: [
      { title: 'Profit and loss, this fiscal year', cmd: 'capxul org books reports profit-and-loss --from 2026-04-01 --to 2026-10-31', node: cx.chart.bar({ labels: pl.map((m) => fmt.monthShort(m.month)), series: [{ name: 'Income', values: pl.map((m) => m.income), color: 'pos' }, { name: 'Expense', values: pl.map((m) => m.expense), color: 'neg' }], line: { name: 'Net profit', values: pl.map((m) => m.profit) }, format: (v) => fmt.compact(v, 'GBP'), tipFormat: (v) => fmt.gbp(v) }) },
      { title: 'Treasury balance at month end', node: cx.chart.line({ labels: months.map((m) => fmt.monthShort(m)), series: [{ name: 'Treasury', values: months.map((m) => monthEnd.get(m)) }], area: true, format: (v) => fmt.compact(v), tipFormat: (v) => fmt.usdc(v) }) },
      { title: 'Receivables ageing', node: cx.chart.donut({ items: Object.entries(age).map(([k, v], i) => ({ label: k + ' days', value: v, color: String(i + 1) })), format: (v) => fmt.gbp(v, 0), center: fmt.compact(open.reduce((a, i) => a + i.outstanding, 0), 'GBP') }) },
      { title: 'Budgets this quarter', node: h('div', { style: 'display:grid;gap:12px' }, D.departments.slice(1).map((d) => { const b = cx.budgetOn(d.id); return h('div', { style: 'display:grid;gap:4px' }, h('b', d.name), cx.chart.meter({ total: b.amount, parts: [{ label: 'Spent', value: b.spent }, { label: 'Committed', value: b.committed, color: '3' }], warnAt: 0.85, format: (v) => fmt.usdc(v, 0) })); })) },
      { title: `${p.projectName}: tasks`, wide: true, node: cx.chart.gantt({ rows: tasks.map((t) => ({ id: t.name, label: t.subject, start: t.expStart, end: t.expEnd, progress: (t.progress || 0) / 100, deps: t.dependsOn, href: ['task', t.name] })) }) },
      { title: 'Top customers by billing', node: cx.chart.hbar({ items: Object.entries(D.books.salesInvoices.reduce((m, i) => { m[i.customerName] = (m[i.customerName] || 0) + i.baseGrandTotal; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value })), format: (v) => fmt.gbp(v, 0) }) },
    ],
    shortcuts: [
      { label: 'Unpaid sales invoices', route: 'gallery-list', count: open.length, tone: 'orange', icon: 'file' },
      { label: 'Chart of accounts', route: 'gallery-tree', icon: 'tree' },
      { label: 'Trial balance', route: 'gallery-report', icon: 'report' },
      { label: 'Deals board', route: 'gallery-kanban', icon: 'kanban' },
    ],
    links: [
      { title: 'Financial statements', items: [{ label: 'Profit and loss', route: 'gallery-report', kind: 'report' }, { label: 'Balance sheet', kind: 'report' }, { label: 'Trial balance', route: 'gallery-report', kind: 'report' }] },
      { title: 'Records', items: [{ label: 'Sales invoices', route: 'gallery-list', count: D.books.salesInvoices.length }, { label: 'A sales invoice', route: 'gallery-form' }] },
    ],
  });
}, { workspace: 'gallery' });

cx.route('gallery-list', () => {
  const list = cx.listView({
    key: 'gallery-sinv', rows: D.books.salesInvoices, noun: 'sales invoice',
    titleCol: { key: 'customerName', label: 'Customer', sub: (r) => r.items?.[0]?.description },
    status: (r) => r.status,
    columns: [
      { key: 'postingDate', label: 'Posting date', type: 'date' },
      { key: 'dueDate', label: 'Due date', type: 'date' },
      { key: 'project', label: 'Project' },
      { key: 'outstanding', label: 'Outstanding', type: 'currency' },
    ],
    right: { key: 'grandTotal', label: 'Grand total', type: 'currency' },
    modified: (r) => r.payments?.at(-1)?.date || r.postingDate,
    filters: [
      { key: 'name', label: 'ID' },
      { key: 'customerName', label: 'Customer', type: 'select' },
      { key: 'status', label: 'Status', type: 'select' },
      { key: 'postingDate', label: 'Posting month', type: 'month' },
    ],
    tabs: [{ label: 'All' }, { label: 'Unpaid', filter: (r) => r.outstanding > 0 }, { label: 'Overdue', filter: (r) => r.status === 'Overdue' }, { label: 'This month', filter: (r) => r.postingDate >= '2026-11-01' }],
    sort: { options: [{ key: 'postingDate', label: 'Posting date' }, { key: 'grandTotal', label: 'Grand total' }, { key: 'customerName', label: 'Customer' }], default: { key: 'postingDate', dir: 'desc' } },
    groupBy: [{ key: 'customerName', label: 'Customer' }, { key: 'status', label: 'Status' }, { key: 'createdBy', label: 'Created by', type: 'person' }],
    href: (r) => ['gallery-form', r.name],
    bulk: [{ label: 'Request payment', cmd: 'capxul request issue …', onClick: (rows) => cx.toast(`Would request payment on ${rows.length} invoices`) }],
    cmd: { cli: 'capxul org doc list sales-invoice', kind: 'family' },
    views: [{ label: 'List', route: 'gallery-list', active: true, icon: 'list' }, { label: 'Report', route: 'gallery-report', icon: 'report' }],
  });
  return cx.page({ title: 'Sales invoices', actions: [cx.menu(null, [{ label: 'Export', cmd: 'capxul org doc list sales-invoice --json' }]), cx.btn('Add sales invoice', { kind: 'primary', icon: 'plus', needs: 'Invoicing', cmd: 'capxul org doc create sales-invoice --input invoice.json' })], body: list });
}, { workspace: 'gallery' });

cx.route('gallery-form', (ctx) => {
  const inv = cx.find(D.books.salesInvoices, 'name', ctx.id) || D.books.salesInvoices.find((i) => i.status === 'Unpaid') || D.books.salesInvoices.at(-1);
  const pay = inv.payments?.[0] && D.money.payments.find((p) => p.id === inv.payments[0].payment);
  const form = cx.formView({
    doc: inv,
    tabs: [
      { label: 'Details', sections: [
        { fields: [
          { label: 'Customer', key: 'customerName', type: 'link', href: ['company', inv.customer], reqd: true },
          { label: 'Project', key: 'project', type: 'link', href: ['project', inv.project] },
          { label: 'Posting date', key: 'postingDate', type: 'date', reqd: true },
          { label: 'Payment due date', key: 'dueDate', type: 'date' },
          { label: 'Currency', key: 'currency' },
          { label: 'Payment reference', key: 'rfReference', type: 'mono' },
        ] },
        { label: 'Items', table: { columns: [{ key: 'item', label: 'Item' }, { key: 'description', label: 'Description' }, { key: 'qty', label: 'Quantity', type: 'float', dp: 1 }, { key: 'rate', label: 'Rate', type: 'currency' }, { key: 'amount', label: 'Amount', type: 'currency' }], rows: inv.items, totals: ['amount'] } },
        { label: 'Totals', cols: 3, fields: [{ label: 'Net total', key: 'netTotal', type: 'currency' }, { label: 'Total taxes', key: 'totalTaxes', type: 'currency' }, { label: 'Grand total', key: 'grandTotal', type: 'currency' }, { label: 'In words', key: 'inWords', wide: true }] },
        { label: 'More information', collapsible: true, collapsed: true, fields: [{ label: 'Debit to', key: 'debitTo' }, { label: 'Cost centre', key: 'costCenter' }, { label: 'Is opening', key: 'isOpening', type: 'check' }] },
      ] },
      { label: 'Payments', render: () => h('div', { style: 'padding:16px;display:grid;gap:12px' }, pay ? cx.proof(pay) : cx.empty('No payment yet')) },
    ],
    connections: [{ group: 'Payment', items: [{ label: 'Payment entry', count: inv.payments?.length || 0, route: 'payment-entry', id: inv.payments?.[0]?.voucher }] }, { group: 'Reference', items: [{ label: 'Timesheet', count: inv.timesheets?.length || 0 }] }],
    side: { id: inv.name, title: inv.customerName, cmd: `capxul org doc get sales-invoice ${inv.name}`, assigned: [inv.createdBy], attachments: [], tags: [inv.kind], created: { by: inv.createdBy, at: inv.postingDate }, modified: { by: inv.createdBy, at: inv.payments?.at(-1)?.date || inv.postingDate } },
    timeline: [
      { at: inv.postingDate + 'T09:30:00Z', who: inv.createdBy, kind: 'submitted', text: 'posted this invoice' },
      ...(inv.payments || []).map((p) => ({ at: p.date + 'T15:00:00Z', kind: 'money', text: `Payment ${fmt.gbp(p.amount)} by ${p.channel}`, href: ['payment', p.payment] })),
    ],
  });
  return cx.page({
    title: inv.customerName, crumbs: [{ label: 'Component gallery', route: 'gallery' }, { label: 'Sales invoices', route: 'gallery-list' }], status: [inv.status],
    actions: [cx.menu('View', [{ label: 'Ledger', cmd: `capxul org report run general-ledger --filter voucher_no=${inv.name}` }]), cx.menu('Create', [{ label: 'Payment request', cmd: 'capxul request issue …' }], { kind: 'primary' }), cx.btn('Cancel', { kind: 'danger', needs: 'Invoicing', cmd: `capxul org doc cancel sales-invoice ${inv.name}`, onClick: async () => { if (await cx.confirm({ title: `Cancel ${inv.name}?`, body: 'A cancelled invoice stays in the books as cancelled.', cmd: `capxul org doc cancel sales-invoice ${inv.name}`, danger: true, confirmLabel: 'Cancel the invoice' })) cx.toast('Cancelled'); } })],
    cmd: { cli: `capxul org doc get sales-invoice ${inv.name}`, kind: 'family' },
    body: form,
  });
}, { workspace: 'gallery' });

cx.route('gallery-report', () => cx.page({
  title: 'Trial balance',
  body: cx.reportView({
    key: 'gallery-tb',
    filters: [{ key: 'month', label: 'Month', type: 'select', options: D.books.reports.trialBalance.map((m) => [m.month, fmt.month(m.month)]), value: D.books.reports.trialBalance.at(-2).month }],
    cmd: (v) => ({ cli: `capxul org books reports trial-balance --as-of ${D.books.reports.trialBalance.find((m) => m.month === v.month)?.to}` }),
    run: (v) => {
      const tb = D.books.reports.trialBalance.find((m) => m.month === v.month);
      const rows = [];
      for (const root of D.books.accounts.filter((a) => !a.parent)) {
        rows.push({ id: root.name, account: root.name, indent: 0, group: true });
        for (const a of D.books.accounts.filter((x) => x.parent === root.name)) {
          const r = tb.rows.find((x) => x.account === a.code);
          if (r) rows.push({ id: a.code, account: `${a.code} · ${a.name}`, indent: 1, ...r });
        }
      }
      return { columns: [{ key: 'account', label: 'Account', width: '220px' }, { key: 'openingDr', label: 'Opening (Dr)', type: 'currency' }, { key: 'openingCr', label: 'Opening (Cr)', type: 'currency' }, { key: 'debit', label: 'Debit', type: 'currency' }, { key: 'credit', label: 'Credit', type: 'currency' }, { key: 'closingDr', label: 'Closing (Dr)', type: 'currency' }, { key: 'closingCr', label: 'Closing (Cr)', type: 'currency' }], rows, totals: true };
    },
  }),
}), { workspace: 'gallery' });

cx.route('gallery-tree', () => {
  const tb = D.books.reports.trialBalance.at(-1);
  const bal = (code) => { const r = tb.rows.find((x) => x.account === code); return r ? r.closingDr - r.closingCr : 0; };
  const node = (a) => {
    const kids = D.books.accounts.filter((x) => x.parent === a.name);
    return { id: a.name, label: a.code ? `${a.code} · ${a.name}` : a.name, badges: [a.currency && a.currency !== 'GBP' ? a.currency : null, a.role === 'safe' ? h('span.pill.t-teal', 'Chain') : null].filter(Boolean), value: a.isGroup ? null : fmt.gbp(Math.abs(bal(a.code))) + (bal(a.code) >= 0 ? ' Dr' : ' Cr'), children: kids.map(node) };
  };
  return cx.page({ title: 'Chart of accounts', cmd: 'capxul org books accounts list', actions: [cx.btn('New account', { kind: 'primary', needs: 'Books', cmd: 'capxul org books accounts add "Events and conferences" --under 6400' })],
    body: cx.treeView({ key: 'gallery-coa', roots: D.books.accounts.filter((a) => !a.parent).map(node), toolbar: (n) => [cx.btn('View ledger', { sm: true, cmd: `capxul org report run general-ledger --filter account=${n.id}` }), cx.btn('Rename', { sm: true, needs: 'Books' })] }) });
}, { workspace: 'gallery' });

cx.route('gallery-kanban', () => {
  const cols = D.crm.statuses.deal.map((s0) => ({ key: s0.name, label: s0.name, color: s0.color, items: D.crm.deals.filter((d) => d.status === s0.name) }));
  return cx.page({ title: 'Deals', cmd: { cli: 'capxul org crm deal list --stage ongoing' },
    body: cx.kanban({ key: 'gallery-deals', columns: cols, limit: 6, onOpen: (d) => cx.toast(d.name),
      onMove: (d, to) => { if (!cx.wears('People')) { cx.toast('Moving a deal needs the People hat.', { tone: 'warning' }); return false; } d.status = to; cx.toast(`${d.name} moved to ${to}`, { cmd: `capxul org crm deal move ${d.name} "${to}"` }); return true; },
      card: (d) => [h('div.kb-title', d.title), h('div.kb-meta', h('span', fmt.gbp(d.dealValue, 0)), cx.personChip(d.owner, { link: false }), h('span', fmt.date(d.closedDate || d.expectedClosureDate)))] }) });
}, { workspace: 'gallery' });

cx.route('gallery-actions', () => {
  const pay = D.money.payments.find((p) => p.proof && p.purpose === 'receipt') || D.money.payments.find((p) => p.proof);
  const slip = D.payroll.slips.find((x) => x.paymentInfo?.payment);
  const slipPay = D.money.payments.find((p) => p.id === slip?.paymentInfo?.payment);
  return cx.page({
    title: 'Actions and money', status: [cx.pill('Money waiting'), cx.pill('Settled'), cx.pill('Overdue'), cx.dot('Nurture', 'blue')],
    sub: h('span', 'Hats: ', cx.hat('Engineering'), ' ', cx.hat('People'), ' · ', cx.personChip('tom'), ' · ', cx.addr(D.company.treasury), ' · ', cx.amount(-2051, 'USDC', { gbp: -1618.8 }), ' · ', cx.dir('In')),
    cmd: { cli: `capxul payment get ${pay.id} --org harbourline`, json: { id: pay.id, status: pay.status, amount: pay.amount, asset: pay.asset } },
    actions: [
      cx.btn('Confirm step', { onClick: async () => cx.toast((await cx.confirm({ title: 'Cancel this scheduled payment?', body: '3,200.00 USDC to Studio Varga on 15 Nov goes back to Design\'s budget.', cmd: 'capxul payment cancel payment_499AB943B470D21CE4B9AB9105', who: 'whoever wears the Design hat or one above it' })) ? 'Confirmed' : 'Kept') }),
      cx.btn('Approval', { kind: 'primary', icon: 'passkey', onClick: async () => { const r = await cx.approval({ title: 'Pay Kestrel Cloud Ltd', from: `Harbourline Treasury · ${fmt.addr(D.company.treasury)} · Engineering budget`, to: 'Kestrel Cloud Ltd', amount: 2051, gbp: 1618.8, rate: 0.7893, signer: cx.meId(), hat: 'Engineering', warnings: ['The address is new to you'], cmd: 'capxul org department pay engineering --to accounts@kestrelcloud.co.uk --amount 2051', next: 'capxul payment wait approval_…' }); cx.toast('Approval: ' + r.status); } }),
      cx.btn('Board approval', { onClick: () => cx.approval({ title: 'Board proposal sp_0193: Grant Books to Nadia Farouk', board: { proposal: 'sp_0193', nonce: 30, have: 1, need: 2, approvedBy: ['maya'] }, cmd: 'capxul org proposal approve sp_0193 --org harbourline' }) }),
      cx.btn('Modal', { onClick: () => cx.modal({ title: 'A modal', body: h('p', 'Modal body'), actions: [{ label: 'Close', primary: true }] }) }),
      cx.btn('Side panel', { onClick: () => cx.panel.open({ title: 'Side panel', sub: 'Anything', body: cx.kv([['Payment', pay.id], ['Amount', fmt.usdc(pay.amount)]]) }) }),
      cx.btn('Toast', { onClick: () => cx.toast('Posted ACC-SINV-2026-00084', { cmd: 'capxul org doc submit sales-invoice ACC-SINV-2026-00084' }) }),
      cx.btn('Needs People', { needs: 'People' }),
      cx.btn('Ask the FDE', { icon: 'fde', onClick: () => cx.fde.open({ ask: "What's due this week?" }) }),
    ],
    body: [
      cx.draft({ for: 'maya', title: 'Add Owen Grady as an employee from 4 January 2027', why: 'Owen accepted his offer. These are the steps for the founder to run.', steps: ['Create the employee record', 'Assign the Engineering salary structure', 'Offer a seat'], cmd: ['capxul org hr employee create --input owen.json', 'capxul org member invite owen.grady@gmail.com'], onRun: () => cx.toast('Running') }),
      h('div.grid.c2', cx.proof(pay), slipPay ? cx.proof(slipPay, { title: 'Payslip proof' }) : null),
      cx.card({ title: 'Fields', body: h('div.fields', { style: { '--cols': 3 } }, cx.field({ label: 'Editable text', edit: true, model: {}, key: 'a', placeholder: 'Type' }), cx.field({ label: 'Select', edit: true, type: 'select', options: ['One', 'Two'], model: { b: 'Two' }, key: 'b' }), cx.field({ label: 'Amount', type: 'currency', value: 1234.5 }), cx.field({ label: 'Check', type: 'check', value: 1 }), cx.field({ label: 'Status', type: 'status', value: 'Partly Paid' }), cx.field({ label: 'Hash', type: 'hash', value: pay.proof.documentHash })) }),
      cx.banner('Money waiting for jules.marchetti@proton.me: 2,400.00 USDC, 7 days.', { tone: 'escrow' }),
      cx.timeline([{ at: '2026-11-05T14:01:00Z', who: 'tom', kind: 'created', text: 'prepared this payment' }, { at: '2026-11-05T14:03:09Z', kind: 'money', text: 'Settled at block 53,108,442' }, { at: '2026-11-06T09:00:00Z', who: 'kwame', kind: 'email', text: 'sent an email', sub: 'Re: October hosting', body: 'Thanks, paid today.' }]),
    ],
  });
}, { workspace: 'gallery' });
