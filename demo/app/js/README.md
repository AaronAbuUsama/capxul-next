# The shell's API, for module builders

`core.js` is Capxul's shell: the frame (sidebar, top bar, command strip), the router, and the shared components
every module uses. A module is one ES module in this folder. It imports the shell and registers its workspaces and
routes at its top level:

```js
import { cx, h } from './core.js';
const D = cx.data; // data.json, already loaded when your module runs (see demo/data/README.md for its shape)
```

The shell loads `data.json`, then imports every module in `MODULES` (`money`, `governance`, `fde`, `accounting`,
`hr`, `payroll`, `crm`, `projects`), then renders the hash. Each module file starts as a stub that registers its
workspace and one stub route; replace the whole file. Never edit `core.js`, `index.html` or another module's file:
ask for a shell change in your report.

To see every component drawn from Harbourline's data, open the page and run this in the browser console:
`await import('./js/gallery.js'); location.hash = 'gallery'`. `gallery.js` is not loaded by the app; its source is a
working example of every call below.

Contents: [Rules](#rules) · [Workspaces and routes](#workspaces-and-routes) · [Page](#the-page) ·
[Command strip](#the-command-strip) · [Data helpers](#data-helpers) · [Who is signed in](#who-is-signed-in) ·
[Formatting](#formatting) · [Small parts](#small-parts) · [Workspace page](#workspace-page) ·
[List view](#list-view) · [Form view](#form-view) · [Report view](#report-view) · [Tree view](#tree-view) ·
[Kanban](#kanban) · [Charts](#charts) · [Confirmation, modal, panel, toast](#confirmation-modal-panel-toast) ·
[Money: approval, draft, proof](#money-approval-draft-proof) · [The FDE](#the-fde) · [Search](#search) ·
[Events](#events) · [CSS classes](#css-classes) · [Checking your module](#checking-your-module)

## Rules

- **Words.** No screen, label, toast, empty state or tooltip says Frappe, ERPNext, head, DocType or Desk. Keep
  them out of your code comments too: the source ships with the page. Use the research pages' Capxul labels.
- **Structure.** Keep each record's real tabs, sections, field order, list columns, filters, statuses and actions,
  as the research pages describe them, under Capxul's names.
- **Every screen and action shows its command.** Pass `cmd` to `cx.page` (or to the list or report view), and
  `cmd` to every `cx.btn` and menu item that does something. Spellings come from `docs/design/command-surface.md` and
  the research pages (`org doc …` for records, `org report run …` for reports with no native command).
- **Money moves only through an approval.** A write that moves money or authority ends in `cx.approval` (the
  signer's passkey, or Directors for a Board proposal), never in a plain toast. Every settled on-chain payment shows
  `cx.proof`.
- **Authority by hat.** Gate actions with `needs` (a hat, or `{ dept }` for a department's hat or one above it).
  A control the viewer may not use stays visible, locked, with the reason.
- **No browser dialogs, no print, no downloads.** Use `cx.confirm`, `cx.modal`, `cx.toast`. Export, Print and PDF
  show their command and a toast.
- **Colours.** Only the tokens in `index.html` (`var(--accent)`, `var(--t-green)`, …). If your module needs CSS,
  add it with `cx.style('your-module', css)` and use tokens only. Dark mode then follows.
- **Width.** Everything must work at 400px wide with no horizontal page scroll. Wide tables go inside
  `div.tbl-scroll` (the list, report and grid components already do). Give grid and flex children `min-width: 0`.

## Workspaces and routes

```js
cx.workspace({
  id: 'books', label: 'Books', icon: 'books', route: 'books',
  badge: () => 3,                    // optional count on the sidebar item
  seatless: false,                   // true: shown to people with no seat (HR self-service, FDE)
  nav: [
    { label: 'Home', route: 'books' },
    { label: 'Chart of accounts', route: 'chart-of-accounts' },
    { label: 'Sales invoices', route: 'sales-invoices', match: ['sales-invoice'] }, // match: also highlight on these routes
    { section: 'Reports', collapsed: false, items: [{ label: 'General ledger', route: 'general-ledger' }] },
  ],
});

cx.route('sales-invoice', (ctx) => {
  const inv = cx.find(D.books.salesInvoices, 'name', ctx.id);   // ctx.id is the slugged id from the hash
  if (!inv) return cx.page({ title: 'Not found', body: cx.empty('No such invoice') });
  return cx.page({ /* … */ });
}, { workspace: 'books', title: 'Sales invoice' });
```

- The sidebar groups workspaces as Company (`home`, `approvals`, `money`, `departments`), Business (`books`, `hr`,
  `payroll`, `crm`, `projects`), Governance (`board`, `seats`) and Help (`fde`, `activity`). Use these ids; a new id
  goes at the end of Help. The workspace whose route (or `meta.workspace`) matches the screen expands its `nav`.
- **Route names**: lower-case letters, digits and single hyphens. Never `settings`, `sidebar`, `customize`,
  `upgrade`, `downloads` or anything starting `comment-` (`cx.route` throws).
- **Hashes** are `#name` or `#name--ID`. `cx.href('payslip', 'Sal Slip/HR-EMP-00003/00018')` gives
  `#payslip--Sal-Slip-HR-EMP-00003-00018`: the id is slugged to letters, digits and hyphens, so find the record with
  `cx.find(list, key, ctx.id)` (it compares slugs). `cx.link(text, route, id)` makes an anchor.
- `cx.go(route, id, state)` navigates; `state` reaches the handler once as `ctx.state` (for example
  `cx.go('sales-invoices', null, { list: { filters: { status: 'Unpaid' } } })` opens the list filtered).
- A handler returns a Node (normally `cx.page(...)`) or a Promise of one. If it throws, the shell shows the error
  on the page and logs it to the console. `cx.refresh()` redraws the current screen (after you change data).
- A route with no handler shows "This screen is not built yet". A workspace not marked `seatless` shows "no seat"
  to a viewer without one.
- **Routes other modules link to.** Data references (`{ type, id }` on approvals, events, notices) open through
  `cx.refRoute(ref)` → these route names. Register them with these names so links land:

  | ref type | route | | ref type | route |
  |---|---|---|---|---|
  | `payment`, `escrow` | `payment` | | `run` | `payroll-run` |
  | `proposal` | `proposal` | | `payslip` | `payslip` |
  | `vote` | `vote` | | `deposit` | `deposit` |
  | `round` | `round` | | `payout` | `payout` |
  | `department` | `department` | | `project`, `task`, `timesheet` | same name |
  | `allowance` | `allowance` | | `deal`, `lead`, `contact`, `company` | same name |
  | `leave` | `leave` | | `agent` | `agent` |
  | `expense-claim` | `expense-claim` | | `seats`, `invitation` | `seats` |
  | `advance` | `advance` | | `fde`, `conversation` | `fde` |
  | `employee` (id `HR-EMP-…`) | `employee` | | `sales-invoice`, `purchase-invoice`, `payment-entry`, `journal-entry`, `account` | same name |

  Also used by the shell if they exist: `approvals`, `notices`, `activity`, `treasury`, `reserve`,
  `money-waiting`, `bank-account` (id: the bank account's name), `accounts-receivable`, `departments`, `money`,
  `payroll`. `cx.personChip` links to `employee` (by `HR-EMP-…`) and `agent` (by handle) when those routes exist;
  the proof links its allocations to `sales-invoice`, `purchase-invoice`, `payslip`, `expense-claim`, `advance` and
  its voucher to `payment-entry`.

## The page

```js
cx.page({
  title: 'Larkspur Coffee Co.',
  crumbs: [{ label: 'Books', route: 'books' }, { label: 'Sales invoices', route: 'sales-invoices' }], // default: the workspace
  status: ['Unpaid', cx.pill('Payment in transit', 'info')],   // words become pills; Nodes pass through
  sub: 'ACC-SINV-2026-00050 · 30 Oct 2026',                    // a line under the title (text or Node)
  actions: [cx.menu('View', [...]), cx.menu('Create', [...], { kind: 'primary' }), cx.btn('Cancel', {...})],
  cmd: { cli: 'capxul org doc get sales-invoice ACC-SINV-2026-00050', kind: 'family' },
  banner: cx.banner('Post this invoice to make it final', { tone: 'info' }),
  fde: 'Sales invoice ACC-SINV-2026-00050 to Larkspur Coffee Co.',  // what the FDE is told you are looking at
  hero: null,          // a Node that replaces the standard head (Home uses it)
  body: [ /* Nodes */ ],
});
cx.setStatus(cx.pill('Paid', null, { lg: true }));   // replace the status pills after an action
```

The page is: crumbs, title with status pills and actions, the command strip, the banner, the body (a grid with
14px gaps). Use one page per route.

## The command strip

A dark band under every page head. It shows the screen's command, a Copy button, an SDK toggle and a `--json`
toggle when you give `json`. Hovering an action shows its command there ("Action · Post"); clicking pins it until
the next screen or the ×.

A command spec is a string, a list of strings, or:

```js
{
  cli: 'capxul org doc list sales-invoice --filter status=Unpaid',   // or a list of lines; 'capxul ' is added if missing
  sdk: 'client.org(orgId).docs.list("sales-invoice", { filter: "status=Unpaid" })', // optional; derived if omitted
  json: { status: 'awaiting_approval', approvalId: '…' },   // optional: the --json answer, filled with the screen's values
  who: 'whoever wears the Invoicing hat',                    // optional: "Who may run it"
  kind: 'proposed',                                          // optional: 'proposed' marks a command the book only proposes
  note: 'Home has no single command; each card shows its own.',
}
```

- `cx.setCommand(spec)` sets the screen's command (`cx.page({ cmd })` does it for you).
- `cx.showAction(spec, label, { pin })` shows an action's command; `cx.clearAction()` returns to the screen's.
- `cx.sdkOf(cli)` derives the SDK call by the G7 rule (`org` → `client.org(orgId)`, groups are namespaces, nouns
  plural camelCase, the verb last, flags become an options object, `--org` is dropped). It knows the frozen names
  (`payment send` → `client.payments.pay`, `balance` → `client.accounts.read`, `bank pay` →
  `client.approvals.prepare`, …). Pass `sdk` yourself whenever the research page names the method.
- A list or report view that has `cmd` sets the strip itself, with the filters as flags; leave `cmd` off its page.

## Data helpers

| Call | Returns |
|---|---|
| `cx.data` | the whole of `data.json` |
| `cx.today`, `cx.now` | `'2026-11-09'`, a `Date` for 10:45 UTC that day |
| `cx.rows('books.gl')` | a compact `{cols, rows}` table as objects (cached); works for any path or table |
| `cx.find(list, key, slug)` | the record whose `key` (or `key(r)`) slugs to `slug` |
| `cx.slug(id)` | the hash-safe form of a name |
| `cx.rate(day)` | GBP per USDC on a day (nearest earlier day if missing) |
| `cx.person(id)` | an employee (by `maya` or `HR-EMP-00001`), a guest (`ruth`), or an agent (`@kwame-ops`, `@harbourline-fde`), with `kind` `employee`/`other`/`agent` |
| `cx.name(id)`, `cx.firstName(id)` | display names; `'board'` is "the Board" |
| `cx.dept(id)`, `cx.deptName(id)` | a department or allowance (`kind`), "Travel allowance" |
| `cx.holders(id, day)` | who wears that hat on a day (default today) |
| `cx.ancestors(id)` | the departments above |
| `cx.budgetOn(id, day)` | the quarter's budget line `{quarter, amount, spent, committed, left, …}` |
| `cx.docByName(name)` | `{type, doc}` for an invoice, payslip, expense claim or advance |
| `cx.newId('payment')`, `cx.randHex(32)`, `cx.blockAt(iso)` | a fresh ULID-like id, a random 0x-hash, Base's block at a time |
| `cx.store.get(k, d)`, `cx.store.set(k, v)` | per-viewer conveniences in localStorage (wrapped in try/catch) |

Changes a viewer makes (posting, approving, moving a card) mutate `cx.data` in memory; call `cx.refresh()` to
redraw. They last until the page reloads.

## Who is signed in

The top bar's person menu switches **who you are viewing as** (any seat holder, or an employee with no seat). The
default is Maya Okafor. The company chip switches **acting as** the company or yourself (`use org harbourline` /
`use personal`).

| Call | Returns |
|---|---|
| `cx.me()`, `cx.meId()` | the viewer (a person record with `hats`) and their id |
| `cx.hasSeat(id?)` | whether they hold a seat |
| `cx.wears('Books')` | whether they wear a hat today (`Director`, `People`, `Books`, `Invoicing`, a department's name, `Travel allowance`, …) |
| `cx.holds('design')` | whether they wear the Design hat or one above it now |
| `cx.allowed(need)` | `{ ok, reason }`; `need` is a hat name, `{ dept }`, `{ any: [...] }`, `{ seat: true }` or a function |
| `cx.acting()` | `'org'` or `'personal'` |

Changing the viewer re-renders the screen and emits `persona`.

## Formatting

`cx.fmt` (also exported as `fmt`):

| Call | Example |
|---|---|
| `gbp(n)` | `£1,234.56`, `−£12.00` (a true minus) |
| `usdc(n, dp = 2)` | `1,234.56 USDC` (`dp` 6 in proofs) |
| `money(n, cur, dp)` | GBP, USD, EUR with a symbol; USDC, EURC, SEK after the number |
| `both(usdc, gbp)` | `229,404.21 USDC · £181,068.75` |
| `signed(n, cur)` | `+15,716.61 USDC` |
| `num(n, dp)`, `int(n)`, `pct(x, dp)`, `compact(n, cur)` | `1,234.5`, `12.5%`, `£12.3k` |
| `date(d)`, `day(d)`, `dateLong(d)`, `month('2026-10')`, `monthShort`, `weekday` | `9 Nov 2026`, `9 Nov`, `Monday 9 November 2026`, `Oct 2026` |
| `datetime(iso)`, `time(iso)`, `utc(iso)` | `5 Nov 2026, 14:03` (London), `14:03`, `2026-11-05 14:03:09 UTC` |
| `ago(iso)`, `agoLong(iso)` | `3 d`, `3 days ago` (against today's clock) |
| `addr(a)`, `hash(x)` | `0x4A1f…9c2E`, `0x5663f7bc…3fb9` |
| `hours(n)`, `plural(n, 'escrow')` | `7.5 h`, `2 escrows` |

## Small parts

```js
cx.btn('Post', { kind: 'primary', icon: 'check', cmd: '…', needs: 'Books', onClick, sm: true, href: ['route', id] })
cx.menu('Create', [{ label: 'Payment', cmd, needs, onClick, href, icon, sub, hint, danger }, { divider: true }, { heading: 'More' }], { kind: 'primary' })
cx.menu(null, items)                        // the "…" menu
cx.pill('Unpaid')                           // tone from the status word; or cx.pill('Text', 'success'|'warning'|'danger'|'info'|'neutral'|'muted'|'escrow'|'green'|…)
cx.dot('Nurture', 'blue')                   // CRM-style coloured dot and word
cx.toneOf('Partly Paid')                    // 'yellow'
cx.avatar('maya', { size: 'sm' | 'lg' })    // initials; square for an agent
cx.personChip('maya', { link: false })      // avatar and name, linked to the employee
cx.hat('Engineering')                       // a hat badge
cx.tag('timesheets')
cx.amount(-2051, 'USDC', { gbp: -1618.8, sign: true, color: true, stack: true, dp: 2 })
cx.dir('In' | 'Out' | 'Between your Safes')
cx.addr(address), cx.tx(hash), cx.hashChip(value, { kind, full })   // short, copy, Basescan link
cx.kv([['From', node], ['To', 'text']])      // label/value pairs
cx.card({ title, actions, cmd, body, foot, flush })
cx.banner(text, { tone: 'info'|'warning'|'danger'|'success'|'escrow', action })
cx.empty('Nothing yet', actionNode)
cx.icon('books', { size: 16 })              // see cx.icons for the names
cx.tabs([{ label, count, render: () => node }], { key, active })
cx.field({ label, value, type, … })          // see the form view
cx.copy(text)                               // clipboard with a select-to-copy fallback
cx.fill(el, ...kids)                        // empty an element and add children (null-safe)
```

`h(tag, props, ...children)` makes elements: `h('div.card#id', { class, style, onClick, dataset, html }, …)`;
children may be strings, Nodes, arrays, `null` or `false`. `s(tag, attrs, …)` makes SVG elements. In SVG use
`style: 'fill:var(--chart-1)'`, never a `fill="var(…)"` attribute (it does not work).

`needs` keeps the button visible and locked: it shows a lock, the reason as its tooltip, and a toast on click.

## Workspace page

```js
cx.workspacePage({
  title: 'Books', cmd, workspace: 'books', actions, banner,
  cards: [{ label: 'Sales invoiced', value: '£318,450.00', sub: 'this fiscal year', delta: { text: '+6.2% on last month', good: true }, href: ['sales-invoices'], spark: [..], cmd }],
  charts: [{ title: 'Profit and loss', cmd, node: cx.chart.bar({...}), actions }],
  shortcuts: [{ label: 'Unpaid invoices', route: 'sales-invoices', count: 7, tone: 'orange', icon: 'file' }],
  quick: [{ title: 'Recent', items: [{ label, sub, right, route, id }] }],
  links: [{ title: 'Financial statements', items: [{ label: 'Trial balance', route: 'trial-balance', kind: 'report', count }] }],
  body: extraNodes,
  order: ['cards', 'charts', 'shortcuts', 'quick', 'links', 'body'],   // the default
});
```

`cx.numberCard(spec)` draws one card on its own. A link with no `route` shows a toast that it is not part of the
mock-up.

## List view

```js
cx.listView({
  key: 'sales-invoices',                    // keeps filters, tab and sort when the viewer comes back
  rows: D.books.salesInvoices,              // or a function returning them (for data that changes)
  id: (r) => r.name,
  titleCol: { key: 'customerName', label: 'Customer', sub: (r) => r.items[0].description }, // or render(r)
  status: (r) => r.status,                  // a word, { text, tone } or a Node
  columns: [
    { key: 'postingDate', label: 'Posting date', type: 'date' },
    { key: 'outstanding', label: 'Outstanding', type: 'currency', keep: true },  // keep: also shown under 700px
    { key: 'owner', label: 'Owner', type: 'person' },
    { label: 'Stage', render: (r) => cx.dot(r.status, 'blue') },
  ],
  right: { key: 'grandTotal', label: 'Grand total', type: 'currency' },  // always shown, right-aligned
  modified: (r) => r.modifiedAt,            // the "3 d" column
  filters: [                                // the standard filter row
    { key: 'name', label: 'ID' },           // text: contains
    { key: 'status', label: 'Status', type: 'select', options: ['Unpaid', 'Paid'] }, // options default to the values present
    { key: 'owner', label: 'Owner', type: 'person' },
    { key: 'postingDate', label: 'Month', type: 'month' },   // also 'date', 'check'
    { key: 'project', label: 'Project', flag: '--project' }, // flag: how it shows on the command
  ],
  tabs: [{ label: 'All' }, { label: 'Unpaid', filter: (r) => r.outstanding > 0 }],   // saved filters with counts
  sort: { options: [{ key: 'postingDate', label: 'Posting date' }], default: { key: 'postingDate', dir: 'desc' } },
  groupBy: [{ key: 'status', label: 'Status' }, { key: 'createdBy', label: 'Created by', type: 'person' }], // the side counts (wide screens)
  href: (r) => ['sales-invoice', r.name],   // or onOpen: (r) => …
  bulk: [{ label: 'Request payment', cmd, needs, onClick: (rows) => … }],
  views: [{ label: 'List', route: 'sales-invoices', active: true, icon: 'list' }, { label: 'Kanban', route: 'deals-kanban', icon: 'kanban' }],
  cmd: { cli: 'capxul org doc list sales-invoice' },  // filters are appended as --filter field=value (or the filter's flag); or cmd: (state, rows) => spec
  noun: 'sales invoice', empty: 'No sales invoices match.', pageSize: 20, selectable: true, showId: true,
});
```

Column `type`: `currency` (with `currency`, else the row's `currency`, else GBP), `usdc`, `int`, `float`, `number`,
`percent`, `date`, `datetime`, `status`, `dot` (with `color(r)`), `person`, `check`, `ago`, or text. `get(r)`
computes a value; `render(r)` draws the cell. The Filter button builds conditions (equals, like, >, <, is set) on
any column. Paging is 20 · 100 · 500 with Load more. Under 700px only the title, status and right column show
(plus columns with `keep`), and the ID moves under the title. The returned node has `.refresh()` and `.state`.

## Form view

```js
const form = cx.formView({
  doc: invoice,                    // the record; edits write into it
  editable: false,                 // true for a draft or a new record: fields become inputs
  tabKey: 'sales-invoice',         // remembers the open tab
  tabs: [
    { label: 'Details', sections: [
      { fields: [ { label: 'Customer', key: 'customerName', type: 'link', href: ['company', 'larkspur'], reqd: true }, … ] },  // flows into 2 columns
      { label: 'Items', table: { columns: [...], rows: invoice.items, totals: ['amount'] } },
      { label: 'Totals', cols: 3, fields: [...] },
      { label: 'Accounting', collapsible: true, collapsed: true, columns: [[fieldA, fieldB], [fieldC]] }, // explicit column breaks
      { label: 'Proof', node: cx.proof(payment) },
    ] },
    { label: 'Payments', render: () => node },
  ],
  connections: [{ group: 'Payment', items: [{ label: 'Payment entry', count: 1, route: 'payment-entry', id }] }], // adds the Connections tab
  side: { id: 'ACC-SINV-2026-00050', title: 'Larkspur Coffee Co.', cmd: 'capxul org doc get sales-invoice …',
          assigned: ['maya'], attachments: ['po-4471.pdf'], tags: ['retainer'],
          created: { by: 'maya', at: iso }, modified: { by: 'kwame', at: iso }, extra: node },
  timeline: { items: [{ at, who, kind, text, body, sub, href }], comment: true },   // "Activity" under the sheet
  onChange: (doc, key, value) => …,   // the first change also turns the page's status into "Not saved"
});
```

Field spec: `{ label, key, value, type, options, reqd, readOnly, help, wide, href, currency, dp, render, placeholder,
hidden, checkLabel }`. Types: text (default), `textarea`, `select`, `check`, `date`, `datetime`, `int`, `float`,
`currency`, `usdc`, `percent`, `link`, `status`, `person`, `hash`, `address`, `mono`. Read-only fields draw as grey
value boxes; editable ones as inputs bound to `doc[key]`. Put the form view as the page body; the page's actions
carry Save, Post, Cancel, Amend ("Submit" reads **Post**; Cancel goes through `cx.confirm`).

`cx.grid({ columns, rows, editable, onChange, totals, addLabel, empty, rowHref, numbered, rowForm, title })` is the
child table on its own: No. column, totals row, and when editable Add row, Delete and a pencil that opens the row.
Column `edit: true` makes a cell an input when the grid is editable. `cx.section(spec, { doc, editable, onChange })`
draws one section.

`cx.timeline(items, { comment, sort })`: newest first. `kind` picks the icon: `created`, `change`, `comment`,
`email`, `whatsapp`, `call`, `note`, `task`, `money`, `link`, `approval`, `status`, `submitted`, `cancelled`,
`attachment`. `who` is a person id; `sub` is a bold first line inside `body`.

## Report view

```js
cx.reportView({
  key: 'trial-balance',
  filters: [{ key: 'month', label: 'Month', type: 'select', options: [['2026-10', 'Oct 2026']], value: '2026-10' },
            { key: 'from', label: 'From', type: 'date', value: '2026-04-01' }],
  run: (values) => ({
    columns: [{ key: 'account', label: 'Account', width: '220px' }, { key: 'debit', label: 'Debit', type: 'currency', href: (r) => ['general-ledger', r.code] }],
    rows: [{ account: 'Assets', indent: 0, group: true }, { id: '1010', account: '1010 · Treasury', indent: 1, debit: 97056.8 }],
    totals: true,              // sums the leaf rows' numeric columns; or a row object { label: 'Total', debit: … }
    summary: [{ label: 'Total assets', value: '£2,089,099.24' }],   // number cards above
    chart: cx.chart.bar({...}), chartTitle: 'By month',
    message: 'Books are closed through 31 Mar 2026', messageTone: 'info',
  }),
  cmd: (values) => ({ cli: `capxul org books reports trial-balance --as-of ${values.to}` }),
  related: [cx.btn('Accounts receivable summary', { href: ['ar-summary'] })],
  columnFilters: true,          // the filter row under the headers (flat reports): >5, <10, =324, 5:10, or text
  footnote: 'For comparison, use >5, <10 or =324. For ranges, use 5:10.',
});
```

Rows with `indent` make a tree with chevrons and Collapse all; `group`, `bold` and `total` rows are bold. The
Actions menu has Pick columns, Export (shows the command with `--format csv`) and Refresh. `run` may return a
Promise. The node has `.rerun()`.

## Tree view

```js
cx.treeView({
  key: 'chart-of-accounts', depth: 1,        // levels open at first
  roots: [{ id: 'Assets', label: 'Assets', sub, badges: ['USDC', cx.pill('Chain', 'teal')], value: '£2,089,099.24 Dr', href, group: true, children: [...] }],
  toolbar: (node) => [cx.btn('View ledger', { sm: true, cmd }), cx.btn('Rename', { sm: true, needs: 'Books' })], // shown under a clicked node
  tools: extraHeadNodes,
});
```

Expand all and Collapse all are built in.

## Kanban

```js
cx.kanban({
  key: 'deals',
  columns: D.crm.statuses.deal.map((s) => ({ key: s.name, label: s.name, color: s.color, items: deals.filter((d) => d.status === s.name) })),
  card: (deal, col) => [h('div.kb-title', deal.title), h('div.kb-meta', fmt.gbp(deal.dealValue, 0), cx.personChip(deal.owner))],
  onMove: (deal, toKey, fromKey) => { if (!cx.wears('People')) { cx.toast('Moving a deal needs the People hat', { tone: 'warning' }); return false; } deal.status = toKey; return true; },
  onOpen: (deal) => cx.go('deal', deal.name),
  colMenu: (col) => [{ label: 'Hide column', onClick }],
  limit: 20,
});
```

Cards drag between columns, and each has a Move menu for touch and keyboard. Returning `false` from `onMove` (or a
Promise of false) keeps the card where it was. The board scrolls sideways inside itself.

## Charts

All charts are SVG, drawn to scale at the container's width (they redraw when it changes), coloured from tokens,
with a tooltip on hover. Series colours: `'1'`…`'6'` (the chart palette), `'pos'`, `'neg'`, `'warn'`, `'danger'`,
`'muted'`, a tone name (`'green'`, `'escrow'`…) or any CSS colour.

```js
cx.chart.bar({ labels, series: [{ name: 'Income', values, color: 'pos' }, { name: 'Expense', values, color: 'neg' }],
               line: { name: 'Net profit', values }, stacked: false, height: 220, format: (v) => fmt.compact(v, 'GBP'),
               tipFormat: (v) => fmt.gbp(v), onClick: (i, j) => … })
cx.chart.line({ labels, series: [{ name, values, color }], area: true, height: 200, format, tipFormat })
cx.chart.donut({ items: [{ label: '0-30 days', value, color: '1' }], center: '£151k', format, tipFormat })
cx.chart.spark(values, { color, height })
cx.chart.hbar({ items: [{ label, value, color, href }], format })
cx.chart.meter({ total: 65000, parts: [{ label: 'Spent', value }, { label: 'Committed', value, color: '3' }], warnAt: 0.85, format, legend })
cx.chart.gantt({ rows: [{ id, label, sub, start, end, progress: 0.4, color, href: ['task', id], deps: [ids] }], from, to, today })
```

Every label names a value the chart reaches; negative values draw below a zero line. The meter turns its first part
amber above `warnAt` (a department above 85% of its budget).

## Confirmation, modal, panel, toast

```js
if (await cx.confirm({ title: 'Cancel ACC-SINV-2026-00050?', body: 'It stays in the books as cancelled.',
                       cmd: 'capxul org doc cancel sales-invoice ACC-SINV-2026-00050', who: 'whoever wears the Invoicing hat',
                       confirmLabel: 'Cancel the invoice', cancelLabel: 'Back', danger: true })) { … }

const m = cx.modal({ title, body, wide, onClose, actions: [{ label: 'Save', primary: true, cmd, needs, onClick: (close) => close() }] });
m.close();

const p = cx.panel.open({ title, sub, body, wide, actions, onClose, key });  // one panel at a time, on the right
p.setBody(node); cx.panel.close(); cx.panel.isOpen('fde');

cx.toast('Posted ACC-SINV-2026-00084', { tone: 'success'|'info'|'warning'|'danger', cmd: 'capxul org doc submit …', action: { label: 'Undo', onClick }, ms });
```

The confirmation is a card at the top of the page body with the command and who may run it; Escape or Back
answers false. Escape closes the top modal, then a popover, then the drawer, then the panel.

## Money: approval, draft, proof

**The hand-over.** Every write that moves money or authority ends here:

```js
const r = await cx.approval({
  title: 'Pay Kestrel Cloud Ltd',
  from: 'Harbourline Treasury · 0x4A1f…9c2E · Engineering budget', to: 'Kestrel Cloud Ltd · 0x91c2…44Be',
  amount: 2051, asset: 'USDC', gbp: 1618.8, rate: 0.7893,
  rows: [{ to: 'Ellis Hart', amount: 4120.51, rail: 'Bank through Bridge' }],   // a batch (payroll)
  warnings: ['The address is new to you'],
  signer: 'tom', hat: 'Engineering',      // only the signer can approve; anyone else is told who must
  deadline: 'Expires in 14:52',
  cmd: 'capxul org department pay engineering --to accounts@kestrelcloud.co.uk --amount 2051',
  next: 'capxul payment wait approval_01JC…',
  board: { proposal: 'sp_0195', nonce: 31, have: 0, need: 2, approvedBy: [] },   // instead of signer, for the Board
});
// r.status: 'done' (with tx, block, at), 'approved' (a Board proposal still short of approvals, with remaining), 'declined'
```

The sheet shows "Approve with passkey", then "Touch your passkey", "Sending…" and "Done · on chain in block …"
with the transaction. Update `cx.data` with the result (a new payment with `cx.newId('payment')`, its status, the
invoice's outstanding) and `cx.refresh()`.

**The FDE's draft.** A risky action the FDE prepared for one person:

```js
cx.draft({ for: 'maya', by: '@harbourline-fde', at: iso, title: 'Add Owen Grady as an employee from 4 January 2027',
           why: '…', steps: ['…'], cmd: ['capxul org hr employee create --input owen.json', '…'], needs, runLabel: 'Run',
           onRun: () => cx.approval({...}), extra: node })
```

Only `for` can press Run; anyone else sees "Only Maya Okafor can run this".

**The proof.** On every record that moved money:

```js
cx.proof(payment, { booked: 'ACC-PAY-2026-00317', title: 'Proof', subtitle: '…', none: 'text when there is no proof' })
const checks = await cx.verify(payment);   // [{ ok, label, detail }]
await cx.hashOf(obj); cx.canonical(obj);   // the document-hash recipe
```

`payment` is a `money.payments[]` record (find a payslip's with `slip.paymentInfo.payment`). The block shows network,
payment ID, document hash, transaction and block, log, settled through, finality, the pounds, the batch line, the
voucher, and "What it pays" (each allocation with its lines and VAT, linked to its record). **Verify** really
re-hashes the advice with SubtleCrypto and checks it names this payment, the token and amount, each document's
version, and the allocations' sums; **Raw** shows the advice; **Save as PDF** shows its command. A payment with no
proof (a bank deposit, an unsettled payment) shows a muted line instead.

## The FDE

The top bar's "Ask the FDE" (and Home's box) opens the FDE in the side panel, told what the viewer is looking at
(`cx.page({ fde })`, else the crumbs and title). The shell draws the conversation; `fde.js` supplies the brain:

```js
cx.fde.answer = async (question, { context, me, history }) => ({
  text: 'Engineering has spent 23,578.44 …',
  lookedAt: [{ command: 'capxul org department show engineering --org harbourline', result: '65,000.00 USDC this quarter …' }],
  draft: { for: me.id, title: '…', cmd: '…', onRun: () => … },     // optional: a cx.draft spec
  links: [{ label: 'Open Engineering', route: 'department', id: 'engineering' }],
});
cx.fde.suggestions = ['…', '…', '…'];
cx.fde.mount = (panel, { context, ask }) => { panel.setBody(myOwnChat) };   // optional: take the whole panel over
cx.fde.open({ ask: 'How much runway do we have?', context });          // open it from anywhere
```

The FDE acts only with the asker's permissions: answer within `cx.me()`'s hats and draft anything risky.

## Search

The top bar searches workspaces, nav pages, people and departments. Add your records:

```js
cx.search.add((q, limit) => D.books.salesInvoices
  .filter((i) => i.name.toLowerCase().includes(q.toLowerCase()) || i.customerName.toLowerCase().includes(q.toLowerCase()))
  .slice(0, limit).map((i) => ({ kind: 'Sales invoices', label: `${i.name} · ${i.customerName}`, sub: fmt.gbp(i.grandTotal), route: 'sales-invoice', id: i.name, icon: 'file' })));
```

Results group by `kind`, six each. `/` or Ctrl+K focuses the search.

## Events

`cx.on(event, fn)` returns an unsubscribe function. Events: `ready` (after the first render), `route` (ctx),
`persona` (the new viewer), `acting` (`'org'`/`'personal'`). `cx.emit(name, payload)` sends your own.

## CSS classes

Use these before writing your own: `.grid` with `.c2`, `.c3`, `.c4`, `.side` (main and a 350px column); `.card`,
`.card-head`, `.card-body`, `.card-foot`; `.kv`; `.ncards`, `.ncard`; `.tbl` inside `.tbl-scroll` (cells `.num`,
`.opt` hides under 700px, `.wrap` lets a cell wrap); `.btn` (`.primary`, `.danger`, `.ghost`, `.sm`), `.btn-group`;
`.pill` with `.t-gray|blue|green|orange|yellow|red|purple|teal|escrow|muted`; `.dot`; `.tag`; `.hat`; `.chips`;
`.muted`, `.faint`, `.pos`, `.neg`, `.mono`, `.num`; `.fields` (`--cols`) with `.field` and `.fval`; `.finput`,
`.ctl`; `.empty`; `.banner`; `.kb-title`, `.kb-meta` inside kanban cards; `.raw` for preformatted JSON;
`.confirm-cmd` for a command block.

Tokens: `--bg`, `--surface`, `--surface-2`, `--sunk`, `--hover`, `--line`, `--line-2`, `--fg`, `--fg-2`, `--muted`,
`--faint`, `--accent`, `--accent-2`, `--accent-soft`, `--accent-fg`, `--link`, `--pos`, `--neg`, `--t-<tone>` and
`--t-<tone>-bg`, `--chart-1`…`--chart-6`, `--chart-grid`, `--chart-axis`, `--cmd-bg`, `--cmd-fg`, `--cmd-muted`,
`--cmd-accent`; fonts `--font-ui` (Archivo; `font-stretch: var(--wide)` for display) and `--font-mono` (JetBrains
Mono); radii `--r`, `--r-lg`.

## Checking your module

Serve the app (`cd demo/app && python3 -m http.server 8765`) and drive it with Playwright from Chromium at 1280×900
and 400×860, light and dark (`colorScheme`). For each of your routes: no console errors, and
`document.documentElement.scrollWidth <= clientWidth`. The page is published inside a wrapper that adds
`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`; when testing locally,
serve `index.html` wrapped the same way (Playwright's `page.route` can fulfil it) or use a plain desktop context.
