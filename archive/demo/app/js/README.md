# The shell's API, for module builders

`core.js` is Capxul's shell: the frame (sidebar, top bar, assistant panel), the router, and the shared components
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
[Commands are data](#commands-are-data) · [Data helpers](#data-helpers) · [Who is signed in](#who-is-signed-in) ·
[Formatting](#formatting) · [Small parts](#small-parts) · [Workspace page](#workspace-page) ·
[List view](#list-view) · [Form view](#form-view) · [Report view](#report-view) · [Tree view](#tree-view) ·
[Kanban](#kanban) · [Charts](#charts) · [Confirmation, modal, panel, toast](#confirmation-modal-panel-toast) ·
[Money: approval, proof](#money-approval-proof) · [Agent work and the assistant](#agent-work-and-the-assistant) ·
[The FDE](#the-fde) · [Search](#search) ·
[Events](#events) · [Hooks between modules](#hooks-between-modules-cxnative) · [Walkthroughs](#walkthroughs) ·
[CSS classes](#css-classes) · [Checking your module](#checking-your-module)

## Rules

- **Words.** No screen, label, toast, empty state or tooltip says Frappe, ERPNext, head, DocType or Desk. Keep
  them out of your code comments too: the source ships with the page. Use the research pages' Capxul labels.
- **No commands on screen.** No user is expected to run a command; commands are the AI's side. Never draw a
  `$ capxul …` line, a command block, "Copy the command", an SDK or `--json` button, or "Who may run it". You may still
  pass `cmd` to `cx.page`, `cx.btn`, menus, lists and reports: the shell keeps it as data (see
  [Commands are data](#commands-are-data)) and draws nothing. A toast says what happened or would happen, with the
  mock-up's caveat: "Sent to Georgia Spencer (mock-up: nothing is sent)".
- **No agent call-outs on a page.** What an agent did or proposes lives in one place, the assistant panel
  ([Agent work and the assistant](#agent-work-and-the-assistant)). A page shows agent work only where it is part of
  the record itself: a timeline entry "Logged by the sales agent", a lead's score and its reason, a status "Matched
  automatically". Never a dashed "Drafted by …" box or a banner.
- **Structure.** Keep each record's real tabs, sections, field order, list columns, filters, statuses and actions,
  as the research pages describe them, under Capxul's names.
- **Money moves only through an approval.** A write that moves money or authority ends in `cx.approval` (the
  signer's passkey, or Directors for a Board proposal), never in a plain toast. Every settled on-chain payment shows
  `cx.proof`.
- **Authority by hat.** Gate actions with `needs` (a hat, or `{ dept }` for a department's hat or one above it).
  A control the viewer may not use stays visible, locked, with the reason.
- **No browser dialogs, no print, no downloads.** Use `cx.confirm`, `cx.modal`, `cx.toast`. Export, Print and PDF
  show a toast saying what would happen ("Exported as a spreadsheet (mock-up: nothing is downloaded)").
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

- The sidebar groups workspaces as Company (`home`, `approvals`, `money`, `departments`), You (`yours`: your money and
  your notices, seatless), Business (`books`, `hr`, `payroll`, `crm`, `projects`), Governance (`board`, `seats`) and
  Help (`fde`, `activity`). Use these ids; a new id goes at the end of Help. The workspace whose route (or
  `meta.workspace`) matches the screen expands its `nav`. Home lists every workspace and its nav pages, so a page
  reachable from the sidebar is reachable from Home too.
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
  to a viewer without one, unless the route itself is registered with `{ seatless: true }` in its meta (a person's
  own record inside a workspace that otherwise needs a seat).
- `cx.go(route, id, { tab: 'Payment' })` opens a form view on that tab (any `cx.formView` page, by tab label).
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
  cmd: { cli: 'capxul org doc get sales-invoice ACC-SINV-2026-00050' },  // kept as data, never drawn
  banner: cx.banner('Post this invoice to make it final', { tone: 'info' }),
  fde: 'Sales invoice ACC-SINV-2026-00050 to Larkspur Coffee Co.',  // what the FDE is told you are looking at
  hero: null,          // a Node that replaces the standard head (Home uses it)
  body: [ /* Nodes */ ],
});
cx.setStatus(cx.pill('Paid', null, { lg: true }));   // replace the status pills after an action
```

The page is: crumbs, title with status pills and actions, the banner, the body (a grid with 14px gaps). Use one page
per route.

## Commands are data

Nothing draws a command. The shell keeps the screen's command and the last action's as data, for the AI's side of the
story (a later step may show it there), and `cx.command()` reads it. These calls stay so modules keep working; none of
them draws anything:

- `cx.setCommand(spec)` keeps the screen's command (`cx.page({ cmd })` does it for you; a list or report view with
  `cmd` keeps it with the filters as flags).
- `cx.showAction(spec, label, { pin })`, `cx.clearAction()`, `cx.unpreview()` keep or clear an action's command.
- `cx.btn`, menu items, `cx.card`, number cards, `cx.confirm`, `cx.approval`, `cx.modal` actions and `cx.toast`
  accept `cmd` (and `who`, `next`) and ignore them on screen.
- `cx.sdkOf(cli)` still derives the SDK call by the G7 rule, for that later story.

A command spec is a string, a list of strings, or `{ cli, sdk, json, who, kind, note }`.

The page's stylesheet hides `.strip`, `.card-cmd`, `.confirm-cmd`, `.looked code` and `.draft` everywhere, as a
safety net. Do not rely on it: draw no command at all.

## Data helpers

| Call | Returns |
|---|---|
| `cx.data` | the whole of `data.json` |
| `cx.today`, `cx.now` | `'2026-11-09'`, a `Date` for 10:45 UTC that day |
| `cx.rows('books.gl')` | a compact `{cols, rows}` table as objects (cached); works for any path or table |
| `cx.rows.push(path, obj, { front })` | add a row to a compact table and to its cached objects at once |
| `cx.rows.invalidate(path)` | forget a table's cached objects after changing its compact rows directly |
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

A select field's `options` may be values, `[value, label]` pairs, or a function of the record returning either.

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

- `defaultTab` (an index or a tab's label) is the tab the list opens on the first time, and when a link carries
  filters but no tab. Navigation state (`cx.go(route, id, { list: { filters, tab } })`) wins over `initial`.
- `strip: false` keeps a secondary list (inside a card or a tab) from replacing the page's command (kept as data).

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
  side: { id: 'ACC-SINV-2026-00050', title: 'Larkspur Coffee Co.',
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
Column `edit: true` makes a cell an input when the grid is editable; a `select` column's `options` take values or
`[value, label]` pairs (or a function of the row). A cell's change redraws the table once focus has moved on and puts
focus back on the same cell, so Tab walks through a row. `cx.section(spec, { doc, editable, onChange })` draws one
section.

A section (in `cx.section` or a form view's `sections`) may carry header actions: `{ label: 'Items', actions:
cx.btn('Add from timesheets', { sm: true, … }), fields | table | node }`. They sit at the right of the section's
title (not on collapsible sections). `collapsible: true, collapsed: true` makes the title a toggle.

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
Actions menu has Pick columns, Export (a toast: nothing is downloaded) and Refresh. `run` may return a
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
                       confirmLabel: 'Cancel the invoice', cancelLabel: 'Back', danger: true })) { … }

const m = cx.modal({ title, body, wide, onClose, actions: [{ label: 'Save', primary: true, cmd, needs, onClick: (close) => close() }] });
m.close();

const p = cx.panel.open({ title, sub, body, wide, actions, onClose, key });  // one panel at a time, on the right
p.setBody(node); cx.panel.close(); cx.panel.isOpen('fde');

cx.toast('Posted ACC-SINV-2026-00084', { tone: 'success'|'info'|'warning'|'danger', action: { label: 'Undo', onClick }, ms });
```

The confirmation is a card at the top of the page body; Escape or Back answers false. A toast says what happened, or
what would happen in the real product with the caveat in brackets: "Sent to Georgia Spencer (mock-up: nothing is
sent)". The shell rewrites older toasts that pointed at a command, but write new ones plainly. Escape closes the top modal, then a popover, then the drawer, then the panel.

## Money: approval, proof

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
  board: { proposal: 'sp_0195', nonce: 31, have: 0, need: 2, approvedBy: [] },   // instead of signer, for the Board
});
// r.status: 'done' (with tx, block, at), 'approved' (a Board proposal still short of approvals, with remaining), 'declined'
```

The sheet shows "Approve with passkey", then "Touch your passkey", "Sending…" and "Done · on chain in block …"
with the transaction. Update `cx.data` with the result (a new payment with `cx.newId('payment')`, its status, the
invoice's outstanding) and `cx.refresh()`. When one approval leads straight into another (a budget change, then a
Board proposal), pass `autoClose: 1200` to the first: its sheet closes itself after showing Done and the promise
resolves once it has, so two sheets never stack. The result's `at` is the story's clock (`cx.now`).

**Drafts.** `cx.draft(spec)` no longer draws the dashed "Drafted by" box: it registers the spec in the assistant
panel as a proposal for `spec.for` and returns an empty node, so older calls keep working
(`{ for, by, at, title, why, steps, needs, runLabel, onRun }` map to `who, agent, at, title, detail, steps, needs,
approveLabel, onApprove`). New code calls `cx.agentWork.add` directly, at load time.

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
version, and the allocations' sums; **Raw** shows the advice; **Save as PDF** shows a toast. A payment with no
proof (a bank deposit, an unsettled payment) shows a muted line instead.

## Agent work and the assistant

The top bar's **Assistant** button (a sparkle and a count of what waits for the viewer) opens one right-hand panel with
three tabs:

- **For you**: proposals waiting for the signed-in person, newest first, each with **Approve** (or its own label),
  **Open** (the record) and **Not now**. Proposals for other people sit under "waiting for others".
- **Done by agents**: what the agents did, grouped Today, This week and Earlier; seat holders see everyone's, with a
  "Yours" filter; a viewer with no seat sees only their own.
- **Ask the FDE**: the conversation (see [The FDE](#the-fde)).

Modules feed it through one registry. Add at your module's top level (so the panel is full before anyone opens a
page), or when something happens:

```js
cx.agentWork.add({
  kind: 'proposal',                 // or 'done'
  who: 'leo',                       // the person it is for (an id, an HR-EMP-… or a list); leave out for every seat holder
  agent: 'Sales agent',             // a plain name, or a handle such as '@harbourline-fde'
  title: 'Reply to Amelia Grant at Wexford Museums Trust',
  detail: 'Score 82: a named budget and a date. Drafted for Leo to approve.',
  steps: ['To amelia.grant@wexfordmuseums.org', 'Subject: Re: accessibility audit'],   // optional lines
  route: 'lead', id: 'CRM-LEAD-2025-00001',  // or route: ['lead', id], '#lead--…', or a data ref { type, id }
  at: '2026-11-09T08:40:00Z',
  // proposals only:
  approveLabel: 'Send it',          // default 'Approve'
  result: 'Sent the reply to Amelia Grant',   // the toast and the Done entry ("… (mock-up: nothing is sent)")
  onApprove: (item) => …,           // optional: do it for real in the mock-up; return false (or { status: 'declined' }) to keep it open
  needs: 'People',                  // optional: a cx.allowed need on top of being `who`
  key: 'crm-reply-CRM-LEAD-2025-00001',  // optional: adding the same key again replaces the item and keeps its state
});
```

- Approving needs the viewer to be `who` (and to pass `needs`). It marks the item approved, adds a Done entry
  "Approved by …", and, when there is no `onApprove`, shows the `result` toast.
- `cx.agentWork.list({ kind, who, state })`, `.forYou(id)`, `.count(id)`, `.approve(item)`, `.dismiss(item)`,
  `.open('for'|'done'|'ask')` and `.card(item)` (a proposal's card, for a conversation of your own).
- An Open link only appears when its route exists. The panel redraws itself when items change.

**What the agents do, realistically.** People pay bills, chase payment and run payroll; agents do not. Register work
like this:

- CRM (the sales agent): qualify inbound leads with a score and its reason, enrich the organisation, route to an owner,
  draft first replies and follow-ups for the owner to approve, book meetings, flag deals that have gone quiet, and log
  every touchpoint (emails, WhatsApp, calls with summaries, meetings) on the record's timeline.
- HR (routine, not skilled): onboarding checklists, right-to-work checks and document expiry, leave requests checked
  against policy and balances, policy questions, probation and return-to-work reminders, offboarding, expense receipts
  checked against policy, collecting payroll changes before the run.
- Books (quiet chores): match bank lines, attach receipts, draft the VAT return for a person to file.
- The FDE: setting Capxul up and getting the most out of it (imports from Xero and spreadsheets, connecting the bank and
  Bridge, payroll and HMRC setup, departments and budgets, inviting people, importing the CRM, what is not used yet,
  training), not day-to-day operations.

## The FDE

The FDE, Harbourline's forward deployed engineer, sets Capxul up with the company and helps it get the most out of it.
The assistant's **Ask the FDE** tab is its conversation; Home's box and `cx.fde.open()` open that tab, told what the
viewer is looking at (`cx.page({ fde })`, else the crumbs and title). The shell draws the conversation; `fde.js`
supplies the brain:

```js
cx.fde.answer = async (question, { context, me, history }) => ({
  text: 'You import from Xero in three steps …',
  lookedAt: [{ result: 'Xero: 1,204 contacts, 18 months of invoices' }],   // shown as plain results, never commands
  draft: { for: me.id, title: '…', why: '…', steps: ['…'], onRun: () => … },   // optional: a proposal (cx.draft spec)
  links: [{ label: 'Open Engineering', route: 'department', id: 'engineering' }],
});
cx.fde.suggestions = ['…', '…', '…'];
cx.fde.mount = (panel, { context, ask }) => { panel.setBody(myOwnChat) };   // optional: take the tab over
cx.fde.open({ ask: 'What are we not using yet?', context });               // open it from anywhere
```

The FDE acts only with the asker's permissions. A draft in an answer shows as a proposal card in the conversation and
is also registered under **For you** for its `for` person; an answer may carry several, `drafts: [specA, specB]`, for
instance one for the asker and one for whoever must do the other half.

## Search

The top bar searches workspaces, nav pages, people, customers, suppliers and departments; the modules add invoices,
payment and journal entries, accounts, leads, deals, contacts, companies, CRM tasks, projects, project tasks and
timesheets. Results group by `kind` in this order: pages, people, customers, CRM deals, leads, contacts and companies,
projects, sales and purchase invoices, suppliers, departments, then every other kind. Each kind lists its closest
matches first (six of the first kinds, three of the rest), and a record two providers find (the same route and id)
shows once. Use those kind names for your records. Add yours:

```js
cx.search.add((q, limit) => D.books.salesInvoices
  .filter((i) => i.name.toLowerCase().includes(q.toLowerCase()) || i.customerName.toLowerCase().includes(q.toLowerCase()))
  .slice(0, limit).map((i) => ({ kind: 'Sales invoices', label: `${i.name} · ${i.customerName}`, sub: fmt.gbp(i.grandTotal), route: 'sales-invoice', id: i.name, icon: 'file' })));
```

`/` or Ctrl+K focuses the search.

## Events

`cx.on(event, fn)` returns an unsubscribe function. Events: `ready` (after the first render), `route` (ctx),
`persona` (the new viewer), `acting` (`'org'`/`'personal'`). `cx.emit(name, payload)` sends your own.

## Hooks between modules (`cx.native`)

Modules share behaviour through `cx.native`, read at call time (`cx.native?.payFromBudget?.(…)`), so load order does
not matter. Add yours with `cx.native = Object.assign(cx.native || {}, { … })`.

| From | Hook | Does |
|---|---|---|
| money.js | `payFromBudget({ title, to, payee, amount, budget, memo, purpose, cmd, allocations })` | the approval, the payment with its hashed proof, the Treasury, the budget and the feed |
| money.js | `boardAsk({ title, calls, note, cmd })`, `proposeToBoard(…)` | a Board proposal (the viewer approves first) |
| money.js | `approvePrepared(p)`, `takeBack(p)`, `cancelScheduled(s)`, `findPayment(id)` | act on a payment |
| money.js | `creditDeposit(d)`, `watchArrival(d)` | Bridge lands an arriving deposit (USDC in, matched, booked); the page's timer |
| money.js | `payableBudgets()`, `mayAct(budget)`, `hatFor(budget)`, `whoMay(budget)`, `leftOf(budget)` | who may spend what |
| money.js | `addEvent`, `addNotice`, `dropWaiting`, `pushTable`, `stamp`, `gbpOf`, `RATE`, `ORG` | the feed and helpers |
| governance.js | `approveProposal(sp)`, `castVote(…)`, `buySeats(n)`, `standing()` | Board and equity actions |
| accounting.js | `postSalesInvoice(inv)` | post a sales invoice with no questions (ledger, RF reference, content hash, billed hours) |
| accounting.js | `bookBridgeDeposit(dep, payment, inv)` | the payment entry for a Bridge deposit against its invoice |
| crm.js | `crmLogCall(kind, rec, { minutes, note, other })`, `crmMove(kind, rec, status)` | write to a lead or deal (People hat) |
| projects.js | `billTimesheets(names, project)`, `logWeekFor(employee, project, entries)` | bill time; log a week into a draft timesheet |

## Walkthroughs

Home starts four walkthroughs (`cx.tours.start('bridge' | 'payroll' | 'hire' | 'swap')`). Each step names the person
to view as, the route (or a `resolve()` that finds it from the data as it now stands), an optional `state`, and an
optional question to ask the FDE. A bar above the page gives the step, Back, Next and End; `cx.tours.current()` says
where the viewer is.

## CSS classes

Use these before writing your own: `.grid` with `.c2`, `.c3`, `.c4`, `.side` (main and a 350px column); `.card`,
`.card-head`, `.card-body`, `.card-foot`; `.kv`; `.ncards`, `.ncard`; `.tbl` inside `.tbl-scroll` (cells `.num`,
`.opt` hides under 700px, `.wrap` lets a cell wrap); `.btn` (`.primary`, `.danger`, `.ghost`, `.sm`), `.btn-group`;
`.pill` with `.t-gray|blue|green|orange|yellow|red|purple|teal|escrow|muted`; `.dot`; `.tag`; `.hat`; `.chips`;
`.muted`, `.faint`, `.pos`, `.neg`, `.mono`, `.num`; `.fields` (`--cols`) with `.field` and `.fval`; `.finput`,
`.ctl`; `.empty`; `.banner`; `.kb-title`, `.kb-meta` inside kanban cards; `.raw` for preformatted JSON;
the assistant's `.ap-item` (a proposal card) and `.ap-feed` / `.ap-done` (a feed row). `[hidden]` always hides (it beats the display of `.btn`, `.pill`, grids and flex
boxes); `.chart-card.wide` spans its grid (a workspace chart with `wide: true`).

Tokens: `--bg`, `--surface`, `--surface-2`, `--sunk`, `--hover`, `--line`, `--line-2`, `--fg`, `--fg-2`, `--muted`,
`--faint`, `--accent`, `--accent-2`, `--accent-soft`, `--accent-fg`, `--link`, `--pos`, `--neg`, `--t-<tone>` and
`--t-<tone>-bg`, `--chart-1`…`--chart-6`, `--chart-grid`, `--chart-axis`, `--cmd-bg`, `--cmd-fg`, `--cmd-muted`,
`--cmd-accent`; fonts `--font-ui` (Archivo; `font-stretch: var(--wide)` for display) and `--font-mono` (JetBrains
Mono); radii `--r`, `--r-lg`.

## Checking your module

Serve the app from `localhost` (`cd demo/app && python3 -m http.server 8765 --bind 127.0.0.1`), never from another
host over plain http: `cx.hashOf` uses `crypto.subtle`, which exists only in a secure context (https or localhost), so
Verify, posting and paying throw anywhere else. Drive it with Playwright from Chromium at 1280×900
and 400×860, light and dark (`colorScheme`). For each of your routes: no console errors, and
`document.documentElement.scrollWidth <= clientWidth`. The page is published inside a wrapper that adds
`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`; when testing locally,
serve `index.html` wrapped the same way (Playwright's `page.route` can fulfil it) or use a plain desktop context.
