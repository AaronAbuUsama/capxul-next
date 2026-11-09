# Projects, start-up, the FDE agent and the Frappe head

Status: designed book first on 8 November 2026, on the main line, under Aaron's rulings
`aaron.erp-on-capxul`, `aaron.frappe-shape`, `aaron.projects`, `aaron.fde-agent`,
`aaron.frappe-head` and `aaron.seats` (`books/target/shared/rulings.ts`). The starting point is
the mapping in [`docs/vision/erp.md`](../../vision/erp.md), now read as main-line design. The
records are the authority; this page explains them.

| What | Records |
|---|---|
| The projects concept | `books/target/projects/` (data, processes, decisions); `concept_projects` in `shared/foundation.ts` |
| Start-up and the head connection | `books/target/organizations/` (data, setups, heads, processes, flows, decisions) |
| The FDE | `books/target/agents/` (data, processes, decisions) and the organizations setup |
| The head integration and the Capxul app for Frappe | `integration_frappe_head` in `shared/external.ts`; `component_frappe_app` in `shared/foundation.ts` |

Nothing here adds an operation. The new commands are two decision packs for Aaron
(`projects.commands`, `organizations.commands`); the 215 frozen operations keep their behaviour.

## 1. Start-up: what an Organization begins with

`org create` begins the Organization in one transaction, as before, and now also begins its
fundamental apps. Organizations may write only its own tables (P4), and every app sits above it,
so each app starts itself from the setup's `begin` transition.

| Created | By | When | Records |
|---|---|---|---|
| The Company's facts: `abbr`, `default_currency`, `time_zone`, `fiscal_year_start` | organizations | `begin` | `organizations` (`organizations.company-shape`) |
| The app list: `frappe`, `erpnext` (accounts, projects), `hrms` (payroll), `crm`, installed and native; other asked-for apps wanted | organizations | `begin` | `org-apps` (`organizations.startup`) |
| The FDE's Party, pending | organizations | `begin` | `parties.register` (`organizations.fde-handle`) |
| Projects Settings, five Activity Types, three Project Types | projects | after `begin` | `projects.startup.open` (`projects.startup`) |
| The account tree, fiscal years, main cost centre | books | at `org books accounts import`, not at `begin` | books keeps "no chart until one is made"; a Books-hat wearer runs the import in the first sitting |
| Payroll Settings, salary components | payroll | after `begin` | for the payroll designer |
| The CRM's statuses and the Organization's own CRM Organization | contacts or parties | after `begin` | for the CRM designer |
| The FDE on chain, with the install | organizations (install batch) | founder's one signature | `AgentOwner.create(fdeKey, companySafe)` |
| The founder's and the FDE's Seats; the FDE's Party live | organizations | setup `complete` | `org-members` (`organizations.fde-seat`) |
| The FDE's agent row | agents | `begin`, then `complete` or `fail` | `agents.fde.follow-setup` (`agents.fde`) |

The Company's facts follow ERPNext's setup wizard: the currency and first time zone from Frappe's
`country_info.json`, the fiscal year from ERPNext's table by country (else `01-01`), the
abbreviation from the name's initials. The founder may give any of them. The currency must be one
Capxul can value (USD, or one whose USD price pair the deployment lists), because the books value
every voucher in it; a country currency with no pair falls back to USD, and a chosen one is
refused. The time zone is what every app dates a day in, and a head's System Settings and
Company must share the zone and the currency.

```mermaid
sequenceDiagram
  participant F as Founder's CLI
  participant O as organizations
  participant P as projects, books, payroll, CRM
  participant A as agents
  participant C as Chain
  F->>F: make the FDE key, keep it locally
  F->>O: begin (name, handle, country, apps, FDE key address)
  O->>O: Organization + Company facts + apps + setup + Parties (Org, FDE)
  O-->>P: org_setup begin (outbox): each app starts itself
  O-->>A: org_setup begin: the FDE's agent row, creating
  O->>C: mint the company Safe; deployMoney
  O->>F: install approval: buildMoney batch + officer hats + AgentOwner.create(FDE)
  F->>C: one signature
  C-->>O: install final, AgentCreated
  O->>O: complete: seat the founder and the FDE; FDE Party active
  O-->>A: org_setup complete: the FDE active
```

## 2. The projects concept

`concept_projects` depends on access, parties and organizations and sits after agents, before
budgets, so books (a project dimension on entries), requests (invoices from hours) and payroll
(salary slips from timesheets) can each depend on it (`projects.dependencies`). It holds nine of
ERPNext's fifteen Projects DocTypes, read from `erpnext/projects/doctype` (`projects.doctypes`).
Timesheet is in Frappe HR's shape (its `EmployeeTimesheet` and `salary_slip` Custom Field),
because every head runs Frappe HR.

| ERPNext DocType | Capxul table | Notes |
|---|---|---|
| Projects Settings (single) | `project-settings` | Also the Organization's change counter |
| Activity Type | `activity-types` | Five at start-up |
| Project Type | `project-types` | Three at start-up |
| Project | `projects` | Machine `project`: open, on_hold, completed, cancelled. Totals that come from invoices and orders are not held |
| Project User (child) | `project-users` | A member by Party |
| Task, Task Depends On (child) | `tasks` | Machine `task`: open, working, pending_review, overdue, template, completed, cancelled; dependencies as ids in order; `stop` back to open when its last timesheet is cancelled |
| Timesheet | `timesheets` | Machine `timesheet`: Frappe HR's `set_status` (payslip once a salary slip names it, `unpay` when the slip is cancelled), a draft cancelled rather than deleted. The worker is any Party: employees need no Seat |
| Timesheet Detail (child) | `timesheet-logs` | One time log each |
| (none) | `project-changes`, `project-head-syncs` | The gap-free change log and each head's cursors |

Left out for now: Project Template and its tasks, Project Update, Activity Cost, Task Type, the
legacy Dependent Task, and Project's sales-order link and reminder fields. Project's totals worked
out from documents above projects are not held either: `total_billed_amount` is ERPNext's sum of
submitted Sales Invoice items (`ProjectCostQueries.billed_amount`), like the sales, purchase and
material totals and the gross margin. Projects cannot read those documents, and a copy taken from
a head would be a second record of money asked.

The rules carried over from ERPNext's controllers:

- **Derived fields** (`projects.derived`): a submitted or cancelled timesheet updates its tasks'
  actual time and its project's totals, and their status by ERPNext's `get_task_status` (working
  from open or pending review, completed by a log marked completed, open again when the last
  timesheet is cancelled); a task's status updates its project's percent complete,
  which completes the project at 100 and opens it again below, unless it is on hold or cancelled.
- **Guards** (`projects.machines`): a task completes only when its dependencies and children
  have; a project only at 100 percent.
- **Overdue** (`projects.overdue-timer`): each task's own process waits until the end of its
  expected end's day in the Organization's time zone (under review, its review date's day too).
  ERPNext's daily `set_tasks_as_overdue` sweep is not kept (P3), and a warp stops at the right
  instant. A completed or cancelled task disarms the timer without ending it, so a reopened task
  falls overdue again.
- **Values** (`projects.amounts`, `projects.dates`): amounts, rates, hours and percentages are
  exact decimal strings in the Company's currency; a Frappe Date is a day in the Organization's
  zone, and a Datetime is an instant.
- **Ids** (`projects.ids-and-names`): Capxul ids, with the head's naming-series name beside them.
- **Order** (`projects.change-log`): every write appends to `project-changes` with the next `seq`
  from the Organization's counter, taken under its lock, so a reader skips nothing.

Billing hours (a Sales Invoice, which is a request here) and paying them (a salary slip) belong
to requests and payroll. When they are designed, they will mark the timesheet through a
projects procedure in their own transaction: an invoice and the hours it bills are one money
fact (`projects.billing-and-payslips`). Until then a head's own invoices and slips set the marks
through the sync. Either way a log is billed once and a timesheet paid once: the guards sit on
the timesheet's own transitions (`bill_part`, `bill`, `pay`), as ERPNext refuses a log that
already names an invoice, so a head's invoice and a later Capxul request can never bill the same
hours.

## 3. The Forward Deployed Engineer

The Organization's own agent, the one `agents.org-own-agent` allows, is its FDE (`agents.fde`).

**How it is born** (`organizations.fde-at-start-up`, for Aaron). Before the install, the founder's
Safe is the company Safe's only owner. So the founder's install batch can call
`AgentOwner.create(fdeKey, companySafe)` from the company Safe, and AgentOwner requires exactly
that caller. This means:

- one signature installs the company and creates its FDE;
- no Board proposal is needed, so the `owner-safe-proposals` gate does not apply;
- no proposal holds the company Safe's next nonce, which would block every proposal after it.

The key is made by `org create`'s flow on the founder's machine, the same way `agent create` makes
one, and only its address reaches Capxul. The FDE therefore first runs where the key is: the FDE
plugin over the CLI. Moving it to a Capxul-hosted runtime later is a key rotation by the Board.
If Aaron wants a hosted FDE from day one, that needs an `fde-host` component and integration.

**Its Seat** (`organizations.fde-seat`). The FDE is seated with the founder when the setup
completes, with `seat_use` set to `organization`, so it never counts against the ten seats.
Its `principal_id` stays null, because nothing writes the Seat when it first signs in; every
concept's tenant guard matches an agent's session to its Seat by its Safe. It serves only its own Organization: another Organization's FDE is never
offered a Seat.

**What it may do** (`agents.fde-authority`, for Aaron). The FDE acts only through the CLI and
SDK, with its own key, as a member. Every action is an ordinary command, with its own trace,
refusals and evals.

| May | May not |
|---|---|
| Read what any member reads | Be a Director or wear the Shareholders' top hat |
| Run any member's commands: projects, adding a Frappe app (once those commands exist) | Approve or execute a Board proposal, or sign the company Safe |
| Use whatever hats and allowances the Board grants it: Books for the chart, People for the contact book, an allowance to pay within its limit | Change its own key, or freeze, sweep or remove itself (its owner is the Board) |
| Prepare a head connection for a Director to run | Connect or disconnect a head, raise or buy seats, or sit in another Organization |

It starts with no hat. The open question for Aaron is whether the install should also mint the
officer hats to it. The cost of no hat is concrete: the books' chart comes only from
`org books accounts import`, which needs the Books hat, so in its first sitting the FDE asks the
founder to run the import or to grant it Books.

**Since the world pass (9 November 2026)** the table above describes a self-run own agent only.
Under `aaron.fde-hosted` Capxul hosts the FDE (`fde-host`), and under `aaron.fde-anyone` any member,
or a guest the People hat or a Director names (`org fde guest add|remove|list`), may ask it
(`org fde ask`, `org fde turn get`). The hosted FDE acts only as its asker: each ask mints an
act-for token, every tenant guard resolves the FDE's call to the asker's Seat and hats, a call with
no live token is refused, every signature it prepares is handed to the asker, and a command that
previews is the asker's own to answer (`organizations.fde-for-the-asker`, `agents.fde-authority`,
`rules.fde-acts-for-asker`). So it needs no hat: the import above is the asker's, done by the FDE
when a Books-hat wearer asks it. On a connected head it reaches what lives only there through the
document family (`org head doc …`, `org head doctype …`, `org head doc-call list`), as the asker's own head User
(`organizations.doc-family`, `organizations.doc-authority`).

**Worlds** (`organizations.startup-worlds`). Every existing world starts Acme with `--no-fde`, so
each world still holds what it says it holds. For example, `org-with-proposals-gate-off` keeps no
agent of Acme's own. In `org-with-agent`, @acme-bot is made with `agent create --org`, which by
the ruling makes it Acme's FDE. A new world, `org-with-fde`, serves the FDE's own claims.

## 4. The Frappe head

**The connection** (`organizations.head-connection`). `org-heads` holds at most one live
connection per Organization: the site URL, the host (Frappe Cloud or self-hosted), the head user's
API key, on Frappe Cloud the team's API token (a site's own key cannot install apps), and the
doorbell secret, each sealed under record-bound encryption (a ring's HMAC is checked with the
secret, so a hash would not do), and what the site last reported.
Its machine is `org-head`, which moves from connecting to connected, to failing and back, and to
disconnected. Its process, `organizations.heads.watch`, does three things:

- reads the site and confirms the connection only when the site has the Capxul app, its Custom
  Fields, ERPNext, Frappe HR, Frappe CRM, the Organization's time zone and a Company in its
  currency;
- asks the head's host to install each wanted app;
- checks the site again daily, and at once when an app is wanted.

Each app concept syncs its own records with the head, starting from the connection's `confirm`.

**The integration** (`integration_frappe_head`). Capxul calls the Capxul app for Frappe's
whitelisted methods, so it depends on one versioned contract, not on ERPNext's internals.

| Call | Does | Fails with |
|---|---|---|
| `readSite` | Frappe's version, installed apps, time zone, the Capxul app and its Custom Fields, the Company | PROVIDER_ERROR (down); ROLE_PERMISSION_DENIED (key refused); WRONG_STATE (no Capxul app); RATE_LIMITED; PROVIDER_RESPONSE_INVALID |
| `upsertDocs` | Writes Capxul's documents in change order by `capxul_id` (insert, update, submit, cancel, amend), each naming the last head change Capxul read, over which it writes; answers each one written, unchanged, in conflict (a head change Capxul has not read) or refused | down, key, 429, bad answer. A conflict or refusal is an answer, not a failure |
| `listChanges` | The head's own changes after a cursor, with the version each was based on | down, key, 429, bad answer |
| `installApp` | Frappe Cloud's site API installs an app the site's bench group has, with the team's token | down, key; WRONG_STATE (a self-hosted bench: its owner runs `bench install-app`); INVALID_INPUT (unknown app, or not in the bench group) |

**The devnet fake** is a stand-in head served by the supervisor. It keeps documents by DocType
and `capxul_id`, records its scripted user's edits as changes, installs apps at once, follows the
clock, and has a fault switch for each failure. It runs none of Frappe's validations. A head eval
that needs real Frappe boots a bench with the Capxul app.

**The doorbell** (`organizations.head-doorbell`). After a change commits, the Capxul app posts a
signed ping that carries no data (`organizations.heads.ring`). A ring for an unknown or
disconnected head, or with a bad signature, is refused alike, so it reveals no head. The ping stamps the connection,
which wakes every app's sync; the sync then pulls with Capxul's own key. A daily pull catches a
lost ping. Polling every minute would be a timer the one clock stops at, about half a million
stops in a simulated year.

**Who owns what** (`organizations.head-ownership`, for Aaron to confirm):

| Class | Examples | Rule |
|---|---|---|
| Capxul's: money and identity | payments and the vouchers posted from book facts; Parties' names, handles and Safes; Seats, hats, budgets; agreements' terms | Pushed one way; read-only on the head; overwritten if it drifts |
| Shared business records | projects, tasks, timesheets; CRM relationship fields; the non-money parts of books and payroll | Either side may change them, each change based on a version. Capxul applies a head change through its own checks. A change on an older base, or one the checks refuse, loses and is pushed back |
| The head's | every other app's documents; the head's customizations | Never copied. They may name Capxul's records by `capxul_id` and ask for money only through Capxul's commands |

**Projects' sync** (`projects.head-sync`). One process runs per connection:

- **Push.** It pages `project-changes` in `seq` order and writes each record as it stands. The
  first push of a new connection clears the last head's names, then sends the whole history.
  Each document names the last head change Capxul has read, so the head yields to a change
  Capxul has seen and reports only an unread one: a document edited on both sides never loops.
- **Pull.** It applies the head's changes with the head user's rights, through the same checks
  and transitions a command would use. A user who is a member (matched by mailbox) has that
  member's rights under `projects.permissions`; anyone else has only what any member may do, so
  the head never grants a manager's rights. Derived fields are recomputed and never taken from
  the head.
- **Docstatus.** Frappe never un-submits a document. A head cancel Capxul refuses is pushed back
  as an amendment (a new head document `amended_from` the cancelled one, carrying the same
  `capxul_id`), and a refused head submit by cancelling and amending a draft.

**The one clock** (`organizations.head-clock`). When money moved is always Capxul's time: a
voucher is dated at its fact's block. A head's own document dates are Frappe's. Instants cross as
UTC, and days cross in the Organization's time zone. On a devnet, the Capxul app follows the clock:

- it sets `frappe.utils.now_datetime` to the devnet's now;
- it runs Frappe's due jobs at each stop;
- it reports only daily-or-slower jobs as its next due, following the barrier's own rule.

## 5. For Aaron: answered

Aaron accepted every recommendation of this section with the sixth batch (8 November 2026), and the commands pass
booked them in the one grammar of `docs/design/new-commands.md`:

| Decision | Where it stands |
|---|---|
| `projects.commands` (decision pack) | Accepted. Booked as the 35 commands of `new-commands.md` section 5.1, spelt since in the command tree as `org projects …` with its `member`, `settings`, `task`, `timesheet`, `activity-type` and `project-type` (`surface.projects-group`, `projects.surface-moves`), each one rpc |
| `projects.permissions` | Accepted. Member, People or Director, and Worker, read from the hat when the command runs (`docs/design/authority.md`) |
| `organizations.commands` (decision pack) | Accepted for the app and head commands, booked as `org head app list\|add\|remove` (first `org app`, `surface.head-group`) and `org head connect\|show\|disconnect`; `org fde show\|ask` were added for `aaron.fde-hosted` |
| `organizations.apps-native-or-head` | Accepted |
| `organizations.fde-at-start-up` | Superseded by `aaron.fde-hosted`: Capxul hosts the FDE and its key is the host's |
| `agents.fde-authority` | Accepted, then rewritten for `aaron.fde-anyone` in the world pass: the hosted FDE acts as its asker (`as-the-asker`); adding a Frappe app is a Director's, or the FDE's for a Director who asks |
| `organizations.fde-commands` | Rewritten for `aaron.fde-anyone`: any member or a named guest may ask (`organizations.fde-guests`); the FDE's commands are not critical (`organizations.command-priorities`) |
| `organizations.head-ownership` | Accepted |

Billing hours is requests' `org projects timesheet bill` (`requests.bill-time`, `requests.bill-time-in-projects`, booked). Buying seats is `org seats buy`, and
paying the FDE's hosting `org fde pay` (`organizations.buy-seats`, booked by payments).

## 6. To reconcile with other lanes

- **Books' sync direction.** Here Capxul calls the head and the head only rings
  (`integration_frappe_head`; `component_frappe_app` holds no Capxul key). The accounting design
  has the head's Capxul app follow `books.sync.feed` itself, as an agent with a Seat wearing the
  Books hat. The CRM lane follows the projects pattern. One direction should hold for every app,
  or the component must also hold a Capxul agent key.
- **Books at start-up.** Books makes no chart at `begin` (its frozen "no chart until one is
  made"); the import needs the Books hat, which the FDE does not start with
  (`agents.fde-authority`).
- **Requests and payroll.** A request or payslip for hours must be refused when a head already
  invoiced or paid them: the timesheet's own guards decide (`projects.billing-and-payslips`).

## After the assembly

The assembly of the four Frappe lanes (`assembly-items.md`) settled these points. The records win
where this page differs.

- **The map.** The map has 23 concepts, and `dependencies.of-projects` records projects' edges.
  Books and requests depend on projects.
- **Billing.** `projects.bill-time` marks the hours an Invoice bills. Requests books the command
  (`requests.bill-time`, a pack for Aaron).
- **Paying hours** through a slip is deferred (`payroll.timesheet-pay`).
- **Customers.** A customer with no Party is kept by name (`projects.customer-name`).
- **Start-up.** Books makes no chart when the setup begins (`books.startup`). Payroll writes its
  Settings (`payroll.startup`). The CRM writes nothing (`contacts.startup`).
- **The FDE.** The `-fde` and `fde-` handles are reserved per owner (`parties.fde-handles`). An agent
  is never a Director (`board.no-agent-directors`). The founder grants the FDE the People hat
  (`agents.fde-people-hat`).
- **Notices.** A stalled head and a ready FDE each send a notice (`notices.head-and-fde`).
- **Devnet.** Every Organization world is created with `--no-fde`, and there is an `org-with-fde`
  world. A stand-in head lives in devnet's tables (`devnet.head-stand-in`), and its warp stops are
  in `devnet.head-warp-stops`.
- **Commands.** The commands pass books the new commands (`rules.new-operations`).
