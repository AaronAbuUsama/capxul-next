# CRM and projects: Frappe CRM's and ERPNext Projects' screens as a user sees them, and how Capxul shows them

Research for the Capxul mock-up, step **Research**, key `crm-projects`. Written 9 November 2026.

This page describes every screen of Frappe CRM (its own Vue app, not the desk) and of ERPNext's Projects module (the
desk) as a user sees them today: the sidebar, the list and its views, the record page with its tabs, panels and
sections in order, each field or column with an example value, the actions and the states they move through. Under each
screen, **Capxul** says how the re-skin presents it: the same structure, under Capxul's names and identity, with the
matching `capxul` command (spelt as in `docs/design/command-surface.md` and `docs/design/new-commands.md`) and its SDK
method.

Example values come from the same fictional company as the HR research (`demo/research/hr-payroll.md`): Harbourline
Studio Ltd, a London design and engineering studio, on 9 November 2026, 18 months after it began (see
[the cast](#the-example-cast)). They are illustrations; the data step's generator decides the real values, and where
they differ the generator wins.

## Contents

- [Sources](#sources)
- [Rules the re-skin follows in CRM and projects](#rules-the-re-skin-follows-in-crm-and-projects)
- [The example cast](#the-example-cast)
- CRM: [the CRM's own shell](#the-crms-own-shell), [statuses and colours](#crm-statuses-and-their-colours),
  [Dashboard](#crm-dashboard), [Leads list and its views](#leads-list-kanban-and-group-by),
  [Lead page](#lead-page), [Convert to Deal](#convert-to-deal), [Deals list and its views](#deals-list-kanban-and-group-by),
  [Deal page](#deal-page), [the activity timeline](#the-activity-timeline-and-its-tabs),
  [Contacts](#contacts), [Organizations (Companies)](#organizations-shown-as-companies),
  [Notes](#notes-page), [Tasks](#crm-tasks-page), [Call Logs](#call-logs-page)
- Projects: [Projects workspace](#projects-workspace), [Project list](#project-list),
  [Project form](#project-form), [Task list, kanban, Gantt and tree](#task-list-kanban-gantt-and-tree),
  [Task form](#task-form), [Timesheet list](#timesheet-list), [Timesheet form](#timesheet-form),
  [Billing hours and the money that follows](#billing-hours-and-the-money-that-follows),
  [Activity Type](#activity-type), [Activity Cost](#activity-cost), [Project Type](#project-type),
  [Projects Settings](#projects-settings), reports ([Project Summary](#report-project-summary),
  [Timesheet Billing Summary, which is the Project Billing Summary](#report-timesheet-billing-summary-the-project-billing-summary),
  [Daily Timesheet Summary](#report-daily-timesheet-summary), [Delayed Tasks Summary](#report-delayed-tasks-summary))
- [The FDE in CRM and projects](#the-fde-in-crm-and-projects)
- [Routes and commands for the two modules](#routes-and-commands-for-the-two-modules)
- [Left out, and conflicts to flag](#left-out-and-conflicts-to-flag)

## Sources

| Source | What was read |
|---|---|
| Frappe CRM, `frappe/crm` at `2cecd30` (8 Nov 2026), cloned to `/tmp/crm` | The Vue app (`frontend/src`): the sidebar (`components/Layouts/AppSidebar.vue`, `utils/navigation.js`), the list pages (`pages/Leads.vue`, `Deals.vue`, `Contacts.vue`, `Organizations.vue`, `Notes.vue`, `Tasks.vue`, `CallLogs.vue`), the view controls (`components/ViewControls.vue`), list rows (`components/ListViews/*`), bulk actions (`components/ListBulkActions.vue`), the kanban (`components/Kanban/*`), the record pages (`pages/Lead.vue`, `Deal.vue`, `Contact.vue`, `Organization.vue`), the timeline (`components/Activities/*`), the composer (`components/CommunicationArea.vue`), the modals (`components/Modals/ConvertToDealModal.vue`, `LostReasonModal.vue`), the dashboard (`pages/Dashboard.vue`). The doctypes (`crm/fcrm/doctype/*/*.json`), each list's default columns and kanban (`default_list_data`, `default_kanban_settings` in `crm_lead.py`, `crm_deal.py`, `crm_organization.py`, `crm_task.py`, `crm_call_log.py`, `crm/overrides/contact.py`), the install defaults (`crm/install.py`: statuses and colours, quick-entry, side-panel and data-field layouts, industries, sources, lost reasons, quick filters), the timeline builder (`crm/api/activities.py`), the dashboard's charts (`crm/api/dashboard.py`, `crm_dashboard/crm_dashboard.py`), forecasting (`fcrm_settings/fcrm_settings.py`) |
| ERPNext, `frappe/erpnext` at `6b946b0` (8 Nov 2026), `/tmp/erpnext` | Projects module (`erpnext/projects`): the doctypes Project, Task, Task Depends On, Timesheet, Timesheet Detail, Activity Type, Activity Cost, Project Type, Project User, Projects Settings; the form and list scripts (`project.js`, `project_list.js`, `task.js`, `task_list.js`, `task_tree.js`, `task_kanban.js`, `task_calendar.js`, `timesheet.js`, `timesheet_list.js`); the Project Overview tab (`project_overview*.py`, `erpnext/public/js/project_overview.js`) and costing (`project/costing/project_costing.py`); the connections (`*_dashboard.py`); the Task Status kanban board (`task/kanban_board/task_status.json`); the workspace (`workspace/projects/projects.json`), its sidebar (`sidebar/projects/projects.json`), number cards and charts; the reports (`report/*`); `config/projects.py` |
| Frappe, `frappe/frappe` at `1a7ea57`, `/tmp/frappe` | A sparse clone with no desk JavaScript; the desk Gantt view was read from `frappe/public/js/frappe/views/gantt/gantt_view.js` on the `develop` branch (fetched 9 Nov 2026) |
| Frappe CRM docs | https://docs.frappe.io/crm/lead, https://docs.frappe.io/crm/deal, https://docs.frappe.io/crm/view, https://docs.frappe.io/crm/introduction |
| ERPNext docs | https://docs.frappe.io/erpnext/user/manual/en/project, https://docs.frappe.io/erpnext/user/manual/en/tasks, https://docs.frappe.io/erpnext/user/manual/en/timesheets |
| capxul-next | `docs/design/command-surface.md` (sections 1 to 4, 6, 7.4, 7.5), `docs/design/new-commands.md` (5.1 Projects, 5.2 CRM, 5.4 FDE, 5.8 the CRM's conversations, section 6's `org projects timesheet bill`), `docs/design/frappe/crm.md`, `docs/design/frappe/projects-and-startup.md`, `docs/design/frappe/bridge-work/design-bank.md` (P4, the advice), `docs/design/authority.md` (officer hats, seats, the FDE), `docs/design/escrow.md`, `docs/vision/erp.md` (sections 1 and 2), `books/target/shared/rulings.ts` (`aaron.one-product`, `aaron.frappe-native`, `aaron.crm-frappe-shape`, `aaron.projects`, `aaron.contacts-permissions`, `aaron.departments`, `aaron.fde-anyone`, `aaron.fde-hosted`, `aaron.payment-claim`, `aaron.other-accounts`), `books/target/contacts/decisions.ts` (`contacts.timeline`, `contacts.timeline-money`, `contacts.attachments-later`), `books/target/projects/decisions.ts` (`projects.startup`, `projects.permissions`), `books/target/requests/decisions.ts` (`requests.bill-time-currency`), `books/frozen/flags.ts` (`payment send`, `payment cancel`, `org department pay`) |

Paths below are short: `crm:` is `/tmp/crm/crm/fcrm/doctype/`, `fe:` is `/tmp/crm/frontend/src/`, `api:` is
`/tmp/crm/crm/api/`, `pj:` is `/tmp/erpnext/erpnext/projects/`.

## Rules the re-skin follows in CRM and projects

These come from Aaron's rulings and apply to every screen below.

1. **It is all Capxul** (`aaron.one-product`). No screen, label, empty state, toast, page title or error says Frappe,
   Frappe CRM, ERPNext, head or DocType. Frappe CRM's own brand (its logo, "CRM Dashboard" page title from
   `fe:pages/Dashboard.vue:312`, the "Frappe CRM" app name) becomes Capxul's. Frappe CRM's doc text "open the Desk view,
   search for CRM Lead Status" has no Capxul equivalent and is not shown. Hidden everywhere: **Edit Fields Layout**
   (`fe:components/Activities/DataFields.vue:18`), **Customize Quick Filters** (`fe:components/ViewControls.vue:267`),
   the deal's "Edit deal's mandatory fields layout" (`fe:components/Modals/ConvertToDealModal.vue:11`), **Clear Demo
   Data**, **Import** (no import command), and every desk "Customize" or "Edit DocType" item.
2. **Frappe's structure stays.** Same sidebar order, list columns, quick filters, views, tabs, side-panel sections,
   field order, statuses, colours, reports and steps. The record names Frappe makes are plain and stay:
   `CRM-LEAD-2026-00131`, `CRM-DEAL-2026-00031`, `PROJ-0011`, `TASK-2026-00420`, `TS-2026-00877`, `PROJ-ACC-00004`.
3. **One company.** Harbourline is the only Organization in view: every Company field is hidden (Project, Task,
   Timesheet), the company suffix ERPNext adds to cost centres (`Delivery - HL`) is dropped, and the Timesheet's
   currency is shown only where it differs from GBP (Meridian Labs' timesheets are in USD).
4. **Two words would collide, so the label changes and the structure does not.**
   - Frappe CRM's **Organization** (`CRM Organization`) is a client company. In Capxul an Organization is the company
     using Capxul (Harbourline itself). So the CRM's sidebar item, list and page are labelled **Companies**, and its
     fields "Organization" read **Company**. The command already says so: `contact create <label> --type company`.
   - Frappe CRM's **Tasks** (CRM Task: Backlog, Todo, In Progress, Done, Canceled) and ERPNext's **Tasks** (Task:
     Open, Working, …) are two records. Each keeps the label "Tasks" inside its own module; search results and the
     command strip tell them apart (`org crm task …` and `org projects task …`).
5. **Capxul owns money and identity.**
   - A contact with a mailbox is a person in Capxul's directory: the side panel shows whether they are on Capxul (their
     handle and Safe) or known only by mailbox (money sent to them waits in an escrow they claim). A company is on Capxul
     only when it is a Capxul Organization (Meridian Labs, `@meridianlabs`); any other company is a private entry,
     which cannot be paid until it is linked (`contact link`) (`parties.outside-companies`, `contacts.private-entries`).
   - A record's timeline also shows **the money the chain proves** between Harbourline and the record's Party: each
     payment either way with its amount, token, payment id and document hash, each claim escrow Harbourline sent them,
     and each invoice escrow they paid into (`contacts.timeline-money`).
   - Billing hours makes an **Invoice** (Capxul's request, which is the Sales Invoice, `aaron.frappe-native`); when it is
     paid the payment carries a document hash committing to the invoice's lines and VAT, shown as its **proof**
     (`design-bank.md` P4).
   - A project's **Department** is a Capxul department: a budget with a hat, whose people are whoever wears the hat now
     (`aaron.departments`). Costs land on that department's budget.
6. **Who may do what** (`aaron.contacts-permissions`, `contacts.crm-permission`, `projects.permissions`):
   - every member (a Seat) reads the whole CRM and every project;
   - only a member wearing the **People** hat records, changes, moves or converts anything in the CRM, and sends email
     or WhatsApp from it; a CRM task's assignee may move their own task (`contacts.task-assignee`);
   - any member creates and works project tasks; a worker keeps their own timesheets; the People hat or a Director
     manages projects, their members, types, rates, settings and anyone else's time;
   - billing hours needs the **Invoicing** hat (`requests.bill-time`).
   A control the viewer may not use stays visible but disabled, with the reason ("Needs the People hat") and the FDE's
   offer to draft the command for someone who has it.
7. **Every screen and action shows its command** on the command strip, with the SDK call that is the command's words
   (G7: `org crm deal move` is `client.org(orgId).crm.deals.move`; `org projects task create` is
   `client.org(orgId).projects.tasks.create`; `contact create` is `client.account.addressBook.create`).
8. **The FDE** can be asked anything on any screen, acts only with the asker's Seat and hats, and drafts a risky action
   (an email or WhatsApp send, a bill, a payment) as a command for the person to run (`aaron.fde-anyone`,
   `organizations.fde-for-the-asker`; the sends "refuse the hosted FDE's call for its asker", `new-commands.md` 5.8).

### Names: Frappe's word, Capxul's label, the record word

| Frappe | Capxul label | Command record | Notes |
|---|---|---|---|
| CRM Lead | Lead | `org crm lead` | Converted leads leave the list, as in Frappe (`contacts.lead-list-like-frappe`) |
| CRM Deal | Deal | `org crm deal` | |
| Contact | Contact | `contact … --org harbourline` | The contact book is also everyone's address book for paying people, so it keeps the 215's word |
| CRM Organization | **Company** | `contact … --type company --org harbourline` | Label changed to avoid "Organization" (rule 4) |
| CRM Contacts (deal's child table) | Contacts (on the deal) | `--contact`, `--primary` on `org crm deal create\|change` | |
| Communication (email) | Email | `org crm email send` | From the CRM mailbox, `harbourline@<CRM_MAIL_DOMAIN>` (`contacts.crm-mailbox`) |
| WA Message | WhatsApp | `org crm whatsapp send\|show\|connect\|disconnect` | Harbourline's own number |
| CRM Call Log | Call log | `org crm call log` | Manual logs only; no telephony |
| FCRM Note | Note | `org crm note add\|change` | A note is never removed (`contacts.notes-kept`) |
| CRM Task | Task (in the CRM) | `org crm task create\|change\|move\|list` | |
| Comment | (not shown) | none | See [conflicts](#left-out-and-conflicts-to-flag) |
| File (attachment) | Attachment name | none | Named, not kept (`contacts.attachments-later`) |
| CRM Lead Status, CRM Deal Status | Status | `org crm lead move`, `org crm deal move` | Frappe CRM's install defaults, by type |
| CRM Lost Reason | Lost reason | `--reason` on `move` | Frappe's nine |
| Project | Project | `org projects` (its verbs on the group) | |
| Project User | Project member | `org projects member add\|remove` | |
| Task, Task Depends On | Task, dependencies | `org projects task`, `--depends-on` | |
| Timesheet, Timesheet Detail | Timesheet, time log | `org projects timesheet create\|log\|submit\|cancel\|bill` | |
| Activity Type | Activity type | `org projects activity-type` | |
| Activity Cost | (not shown; see below) | none booked | `surface.computed-gaps` item 2, for Aaron |
| Project Type | Project type | `org projects project-type` | |
| Projects Settings | Projects options | `org projects settings show\|set` | The route avoids the word "settings" |
| Sales Invoice (from timesheets) | Invoice | `org projects timesheet bill` | Requests' command; Invoicing hat |
| Customer | Customer (the company) | `--customer` | A customer with no Party is kept by name (`projects.customer-name`) |

## The example cast

Illustrative only; the data step's generator decides. It extends the HR research's cast (`hr-payroll.md`, "The example
cast") and reuses its people and departments: Design, Engineering, Delivery, Growth and Operations, under the top
department Harbourline. The company's currency is GBP; money moves in USDC through its Safes, and in fiat through Bridge.

**The people who work the CRM and the projects.** Ten of the 25 people hold Seats (`aaron.seats`).

| Person | Role | Department | Seat | Hats that matter here |
|---|---|---|---|---|
| Maya Okafor | Founder and Managing Director | Operations | yes | Director; the Harbourline (top) department hat; Invoicing (since setup) |
| Kwame Mensah | Operations and People Lead | Operations | yes | People, Books |
| Nadia Brooks | Growth Lead | Growth | yes | the Growth hat; People (granted by the Board on 15 Sep 2025, so she can work the CRM) |
| Sam Whitfield | Business Development Manager | Growth | yes | none: he reads the CRM and owns leads, but moves nothing (see [conflict 2](#left-out-and-conflicts-to-flag)) |
| Grace Adeyemi | Delivery Lead | Delivery | yes | the Delivery hat; People (granted 2 Feb 2026, to manage projects) |
| Tom Ashworth | Engineering Lead | Engineering | yes | the Engineering hat |
| Priya Raman | Design Director | Design | yes | the Design hat |
| Ellis Hart | Senior Software Engineer | Engineering | yes | none; logs his own time |
| Lena Fischer | Senior Product Designer | Design | yes | none |
| Jamal Osei | Software Engineer | Engineering | yes | none |
| Hannah Cole | Junior Designer | Design | no | none; her time is logged for her by Grace (`--for`) |

**The companies, contacts and pipeline.** 118 leads and 38 deals in 18 months: 36 leads were converted into deals (two
more deals were opened directly for existing customers); 20 deals won, 13 lost, 5 open today. Lead sources follow
Frappe's defaults: Website 38%, Reference 24%, Existing Customer 12%, Exhibition 10%, Email 9%, Campaign 7%.

| Company (CRM Organization) | Industry | Territory | On Capxul | Contacts | Deals |
|---|---|---|---|---|---|
| Larkspur Coffee Co. (14 coffee shops, London and Bristol) | Food | United Kingdom | no (private entry) | Owen Tate, Head of Digital | CRM-DEAL-2026-00012 Won (184,000.00 GBP, 20 Mar 2026) |
| Meridian Labs Inc. (Boston) | Software | United States | yes, `@meridianlabs` | Dana Whitaker, VP Product (on Capxul); Luis Ortega, Engineering Manager | CRM-DEAL-2026-00019 Won (64,000.00 USD, 11 May 2026); CRM-DEAL-2026-00029 Negotiation (142,000.00 USD) |
| Kestrel Health (Manchester) | Health Care | United Kingdom | no | Dr Aisha Rahman, Head of Digital | CRM-DEAL-2026-00031 Proposal/Quotation (86,000.00 GBP) |
| Fernhill Energy | Energy | United Kingdom | no | Priyanka Shah, Product Director | CRM-DEAL-2025-00008 Won (148,000.00 GBP, 4 Jul 2025); CRM-DEAL-2026-00036 Ready to Close (60,000.00 GBP, the v3 retainer) |
| Copperleaf Studios (Copenhagen) | Advertising | Denmark | no | Freja Holm, Managing Partner (paid an invoice at a link) | CRM-DEAL-2025-00014 Won (32,000.00 GBP) |
| Oakvale Housing Association | Real Estate | United Kingdom | no | Martin Cole, Digital Services Manager | CRM-DEAL-2026-00034 Demo/Making (42,000.00 GBP) |
| Brightwater Schools Trust | Education | United Kingdom | no | Helen Marsh, Operations Director | CRM-DEAL-2026-00037 Qualification (24,000.00 GBP) |
| Quayside Credit Union | Financial Services | United Kingdom | no | Marcus Lee | CRM-DEAL-2026-00022 Lost (Budget Constraints) |
| Saltmarsh Distillery | Food | United Kingdom | no | Tobias Wren | CRM-DEAL-2026-00032 Won (18,500.00 GBP, 28 Oct 2026) |

Ian Pryce, a freelance consultant who referred Kestrel Health, is a contact with no company and no Capxul account. On
3 November Nadia paid him a referral fee of 1,900.00 USDC from the Growth budget; it waits in escrow until he claims it.

**The projects.** Twelve projects in 18 months; three open and one on hold today. Six of them:

| Project | Name | Customer | Type | Status | Department |
|---|---|---|---|---|---|
| PROJ-0003 | Copperleaf brand identity | Copperleaf Studios | External | Completed (13 Feb 2026) | Design |
| PROJ-0005 | Fernhill app v2 | Fernhill Energy | External | Completed (30 Jun 2026) | Delivery |
| PROJ-0008 | Harbourline website refresh | | Internal | On hold | Growth |
| PROJ-0011 | Larkspur ordering app | Larkspur Coffee Co. | External | Open, 41% | Delivery |
| PROJ-0012 | Meridian design system | Meridian Labs Inc. | External | Open, 64% | Design |
| PROJ-0013 | Studio tooling and templates | | Other | Open, 20% | Engineering |

Activity types: ERPNext's five from start-up (Planning, Research, Proposal Writing, Execution, Communication;
`projects.startup`) plus Design and Engineering, added in May 2025.

## The CRM's own shell

Frappe CRM is not a desk module. It is its own single-page app with its own look (`fe:components/Layouts/`), and that
look is what the re-skin keeps for the CRM: Capxul shows it inside its own frame, with Capxul's identity.

**Sidebar** (`fe:components/Layouts/AppSidebar.vue`, `fe:utils/navigation.js`). Top: the brand and the user menu, then
**Search** (opens the command palette) and **Notifications** (with an unread count). Then the views, in this order:
Dashboard, Leads, Deals, Contacts, Organizations, Notes, Tasks, Call Logs. Below them, two collapsible groups appear when
they have entries: **Public Views** (saved views made public) and **Pinned Views**. At the bottom: Help and
Collapse/Expand.

**Page header** (`fe:components/LayoutHeader.vue`). Left: breadcrumbs, whose last crumb is the current view and opens
a menu of saved views (`fe:components/ViewBreadcrumbs.vue`). Right: the page's actions; on a list, the solid
**+ Create** button.

**List controls** (`fe:components/ViewControls.vue`), one row under the header:

- left, the **quick filters**: inline inputs for the doctype's quick-filter fields (install defaults:
  Lead: Full Name, Email, Organization, Status, Source; Deal: Organization, Status, Probability, Email; Contact: Status,
  Email, Phone; Organization: Organization Name, No. of Employees, Territory, Industry; Task: Title, Priority, Assigned
  To, Status, Due Date; Call Log: Telephony Medium, Type, Status, From, To; `/tmp/crm/crm/install.py:504`);
- right, in order: Refresh; **Group By** (in the group-by view); **Group Summary** (a grouped table with counts and
  sums, on Leads); **Filter** (a builder of field, operator, value rows, with a count badge); **Sort** (field and
  direction rows); **Kanban Settings** (in the kanban view) or **Columns** (add, remove, reorder, resize); and a **⋯**
  menu with Import, Export and Customize Quick Filters.

When a view is changed, a bar offers **Cancel** and **Save Changes**; the view menu offers **Create View**, and each saved
view's menu has Duplicate, Set As Default, Edit (name and icon), Pin View, Make Public and Delete
(https://docs.frappe.io/crm/view).

**Views.** Leads and Deals allow List, Group By and Kanban (`fe:pages/Leads.vue:28`, `Deals.vue:27`); Tasks allows List
and Kanban; Notes has one card view ("Notes View"); Contacts, Organizations and Call Logs are lists.

**List rows** (`fe:components/ListViews/*.vue`): a checkbox, then the columns; a status shows as a coloured dot and its
name; a person as an avatar and name; Assigned To as overlapping avatars; a time as "2 hours ago" with the exact time
on hover. Selecting rows shows a banner with bulk actions (`fe:components/ListBulkActions.vue`): Edit, Delete, Assign
To, Clear Assignment, and on leads **Convert to Deal**. The footer pages the list: a page-length choice (20, 50, 100)
and "20 of 82".

**Kanban** (`fe:components/Kanban/KanbanView.vue`): one column per status, each headed by its coloured dot, its name and
its count, with a ⋯ menu (colour, hide) and a + to create in that column; cards show the title field, then the card
fields, then the activity counts (emails, notes, tasks, comments; `KanbanActivityCounts.vue`); **Load More** at the
foot of a long column; **Add Column** at the right. Dragging a card between columns changes its status.

**Record page.** Two panes split by a resizable border. On a lead or deal: the tabs on the left (Activity, Emails,
Comments, Data, Calls, Tasks, Notes, Attachments, WhatsApp; a deal adds Quotations), the side panel on the right (the
record's id, a header block with image and quick actions, then collapsible field sections). On a contact or
organization the other way round: the side panel on the left, a tab list of linked records on the right.

**Capxul.** The same shell. The sidebar's brand is Capxul's, the Organizations item reads **Companies**, and Import,
Export, Customize Quick Filters and Clear Demo Data are not shown. The command palette is the shell's own search.
Notifications are Capxul's notices. Every list's command strip shows its list command with the view's filters as
flags, and every saved view is a saved command line (for example the public view "Pipeline" is
`capxul org crm deal list --stage ongoing`).

## CRM statuses and their colours

From `/tmp/crm/crm/install.py:46-152` (Capxul keeps them as Frappe CRM's install defaults, `contacts.crm-statuses`).

| Lead status | Colour | Type (Capxul stage) | Deal status | Colour | Type | Probability |
|---|---|---|---|---|---|---|
| New | gray | Open (`open`) | Qualification | gray | Open | 10 |
| Contacted | orange | Ongoing | Demo/Making | orange | Ongoing | 25 |
| Nurture | blue | Ongoing | Proposal/Quotation | blue | Ongoing | 50 |
| Qualified | green | Won | Negotiation | yellow | Ongoing | 70 |
| Converted | teal | Won | Ready to Close | purple | Ongoing | 90 |
| Unqualified | red | Lost | Won | green | Won | 100 |
| Junk | purple | Lost | Lost | red | Lost | 0 |

- A converted lead is status Qualified with its Converted check set; it leaves the Leads list (`Leads.vue:26`,
  `filters: { converted: 0 }`).
- A lost status needs a Lost Reason; "Other" also needs Lost Notes (`LostReasonModal.vue:85-89`). The nine reasons:
  Pricing, Competition, Budget Constraints, Missing Features, Long Sales Cycle, No Decision-Maker, Unresponsive
  Prospect, Poor Fit, Other (`install.py:466`).
- CRM Task statuses: Backlog, Todo, In Progress, Done, Canceled, each with its own icon (dashed circle, circle, half
  circle, check, cross); priorities Low, Medium, High, each with a bar icon (`crm:crm_task/crm_task.json`).
- Call statuses: Completed, No Answer (a red missed-call icon), Busy (a declined icon), Failed, Canceled, and the
  telephony states Initiated, Ringing, In Progress, Queued (`crm:crm_call_log/crm_call_log.json`).
- SLA statuses (First Response Due, Rolling Response Due, Failed, Fulfilled) are not shown in Capxul: SLAs are not
  taken (`crm.md`, "Not taken").

**Capxul.** The same names and colours, drawn from Capxul's palette (a gray, an orange, a blue, a green, a teal, a red, a
purple, a yellow), each as a dot beside its name. The command strip for a status change is
`capxul org crm lead move <lead> <status>` or `org crm deal move <deal> <status> [--reason <lost reason>] [--notes]`.

## CRM Dashboard

Source: `fe:pages/Dashboard.vue`, `api:dashboard.py`, `crm:crm_dashboard/crm_dashboard.py:16` (the default manager
layout).

**Layout.** Header: "Dashboard", with Refresh, Edit (rearrange and resize the cards; **+ Chart**, **Reset to Default**,
Cancel, Save). Filters: a range (Last 7 Days, **Last 30 Days** by default, Last 60 Days, Last 90 Days, Custom Range) and,
for managers, a **Sales User** picker. Then a grid, in the default order:

The number cards compare the range with the one before it. The examples give the cards for the default range and the
charts for a Custom Range of the whole 18 months (1 May 2025 to 9 Nov 2026), which is what a founder looks at.

| Row | Card | What it shows | Example |
|---|---|---|---|
| 1 | Total leads | leads created in the range, with the change | 11 in the last 30 days, up 22% |
| 1 | Avg. time to close a lead | lead creation to deal closure | 9 days |
| 1 | Ongoing deals | non-won, non-lost deals | 5 |
| 1 | Won deals | won by closure date | 1 (Saltmarsh Distillery), up from 0 |
| 1 | Avg. won deal value | | 18,500.00 GBP |
| 2 | Avg. deal value | ongoing and won | 58,900.00 GBP |
| 2 | Avg. time to close a deal | deal creation to closure | 54 days |
| 3 | Sales trend: "Daily performance of leads, deals, and wins" | three lines by day: leads, deals, won deals | 0 to 3 a day |
| 3 | Forecasted revenue: "Projected vs actual revenue based on deal probability" | two lines by month: forecasted (expected value × probability, by expected closure month) and actual (won) | Nov 2026 forecast 129,700.00 GBP (Meridian at 70%, Fernhill at 90%); Dec 2026 43,000.00 GBP (Kestrel at 50%) |
| 4 | Funnel conversion: "Lead to deal conversion pipeline" | bars by stage | 118 leads, 38 deals, 20 won |
| 4 | Deals by stage: "Current pipeline distribution" | donut of open deals | Qualification 1, Demo/Making 1, Proposal/Quotation 1, Negotiation 1, Ready to Close 1 |
| 5 | Leads by source | donut | Website 45, Reference 28, Existing Customer 14, Exhibition 12, Email 11, Campaign 8 |
| 5 | Deals by source | donut | Website 13, Reference 11, Existing Customer 8, Exhibition 4, Email 2 |
| 6 | Deals by territory | bars | United Kingdom 31, United States 4, Denmark 3 |
| 6 | Deals by salesperson | bars by deal owner | Nadia Brooks 21, Sam Whitfield 12, Maya Okafor 5 |
| 7 | Lost deal reasons: "Common reasons for losing deals" | bars | Budget Constraints 5, Competition 4, Pricing 2, Unresponsive Prospect 1, Poor Fit 1 |

Amounts are in the CRM's currency (FCRM Settings Currency: GBP); a USD deal counts at its exchange rate.

**Capxul.** The same grid and cards, drawn in Capxul's chart style, with the Sales User picker naming members. Edit
is not shown (a layout change has no command). The CRM has no dashboard command: the strip shows the lists the cards
count, `capxul org crm deal list --stage ongoing` and `org crm lead list --stage open`, and the FDE answers "what will
close this month?" from them. One Capxul card is added at the end of row 2: **Paid this month**, the money the chain
proves from customers on Capxul (38,400.00 USDC from Meridian Labs on 21 Oct falls in the range).

## Leads: list, kanban and group by

Source: `fe:pages/Leads.vue`, `fe:components/ListViews/LeadsListView.vue`, `crm:crm_lead/crm_lead.py:470-542`.

**List** ("Leads", breadcrumb "Leads / List"). Default columns, in order:

| Full Name | Organization | Status | Email | Mobile No. | Assigned To | Last Modified |
|---|---|---|---|---|---|---|
| Rohan Mehta | Parcelpoint | ● New | rohan@parcelpoint.io | +44 7700 900634 | Nadia Brooks | 25 minutes ago |
| Amelia Grant | Wexford Museums Trust | ● Contacted | amelia.grant@wexfordmuseums.org.uk | +44 7700 900412 | Sam Whitfield | 2 hours ago |
| Tobias Wren | Saltmarsh Distillery | ● Qualified | tobias@saltmarshdistillery.co.uk | +44 7700 900781 | Nadia Brooks | 12 days ago |
| Chloe Bramwell | Halden & Co Architects | ● Nurture | chloe@haldenco.com | +44 7700 900155 | Sam Whitfield | 3 weeks ago |
| Marcus Lee | Quayside Credit Union | ● Unqualified | marcus.lee@quaysidecu.co.uk | | Sam Whitfield | 1 month ago |
| (web form) | Rankfast SEO | ● Junk | sales@rankfast.example | | | 2 months ago |

The name column shows the lead's image or initials. Each row opens the lead. Sort: Last Modified, newest first. The
list holds only unconverted leads, 82 of them, most of them Unqualified or Junk; the 36 converted leads live on as
deals.

**Kanban** (column field Status; title Full Name; card fields Organization, Email, Mobile No., Assigned To, Last
Modified; `default_kanban_settings`). Seven columns in status order, New to Junk, with their counts (New 6, Contacted 9,
Nurture 14, Qualified 1, Converted 0, Unqualified 31, Junk 21). A card dragged to Unqualified or Junk with no
reason is refused: "Please specify a reason for losing the lead." (`crm:crm_lead/crm_lead.py:173`); the lead page's
status menu asks for it first. A lost lead also gains a Lost Details section in its side panel.

**Group By.** A table grouped by a chosen field (Status by default; Source, Lead Owner, Territory, Industry are the
useful ones), each group headed by its value and count, collapsible; Group Summary turns on counts and sums per group.

**Actions.** **+ Create** opens the new-lead dialog (the Quick Entry layout, `install.py:171`): Person: Salutation,
First Name, Last Name, Email, Mobile No., Gender; Organization: Organization, Website, Annual Revenue, Company
Description, Territory, No. of Employees (1-10, 11-50, 51-200, 201-500, 501-1000, 1000+), Industry, LinkedIn, X
(Twitter), Facebook; then Status and Lead Owner. Bulk: Edit, Delete, Assign To, Clear Assignment, Convert to Deal.

**Capxul.** The same list, kanban and group-by. The Organization column reads Company. The strip:
`capxul org crm lead list --stage open` for the default list (`client.org(orgId).crm.leads.list`), and for each column
filter the matching flag where one exists (`--stage`). **+ Create** runs
`capxul org crm lead create --first-name Rohan --last-name Mehta --email rohan@parcelpoint.io --mobile "+44 7700 900634" --job-title CTO --company Parcelpoint --website parcelpoint.io --industry Technology --territory "United Kingdom" --employees 51-200 --source Reference --owner nadia@harbourline.studio`.
The Salutation, Gender and social-link fields are not shown (the command takes none of them). Delete is not shown
(Capxul never deletes a CRM record, `contacts.head-sync`). Assign To maps to the owner (`--owner`). A drag between
columns runs `org crm lead move`, and a drag to a lost status opens the Lost Reason dialog first (`--reason`,
`--notes`), so the move is never refused; a viewer without the People hat cannot drag, and the cards say so on hover.

## Lead page

Source: `fe:pages/Lead.vue`, the side-panel layout `install.py:203` ("CRM Lead-Side Panel"), the data-field layout
`install.py:219`, https://docs.frappe.io/crm/lead. Example: CRM-LEAD-2026-00131, Amelia Grant of Wexford Museums Trust.

**Header.** Breadcrumbs "Leads / Amelia Grant". Right, in order: Assign To (avatars and a picker), the **status
button** (its dot and "Contacted", opening a menu of all seven statuses), and the solid **Convert to Deal** button,
disabled on a lost lead with the tooltip "Cannot convert a lost lead to deal". (Frappe also shows "Enrich from website",
which Capxul does not take.)

**Left: the tabs**, in order, each with an icon and, where it has items, a count: Activity, Emails, Comments, Data,
Calls, Tasks, Notes, Attachments, WhatsApp. Under the tab content sits the composer (on Activity, Emails and Comments:
**Reply** and **Comment** buttons that open an email editor or a comment box; on WhatsApp: a message box). The tab
header has a **New** menu: Email, Comment, Log a Call, Make a Call (with telephony), Note, Task, Upload Attachment,
WhatsApp Message (`fe:components/Activities/ActivityHeader.vue:104-140`). See
[the activity timeline](#the-activity-timeline-and-its-tabs) for what each tab shows.

**Right: the side panel.**

1. The lead's id, `CRM-LEAD-2026-00131`, copied on click.
2. A header block: the image or initials, the full name ("Amelia Grant"), and quick buttons: Make a Call (with
   telephony), Send an Email, Go to Website, Attach a File, Delete.
3. The SLA section (only with an SLA; not in Capxul).
4. **Details** (collapsible, open): Organization "Wexford Museums Trust", Company Description "Charitable trust running
   four museums in the south-east", Website "wexfordmuseums.org.uk", Territory "United Kingdom", Industry "Service", No.
   of Employees "201-500", Job Title "Head of Digital", Source "Website", Lead Owner "Sam Whitfield", LinkedIn, X
   (Twitter), Facebook.
5. **Person** (collapsible, open): Salutation, First Name "Amelia", Last Name "Grant", Email
   "amelia.grant@wexfordmuseums.org.uk", Mobile No. "+44 7700 900412".

Every field edits in place; a change saves at once and shows on the Activity tab.

**The Data tab** shows the same fields as a form in three columns (Details: Organization, Company Description,
Industry, No. of Employees | Website, LinkedIn, X, Facebook, Job Title | Territory, Source, Lead Owner; then Person:
Salutation, Email | First Name, Mobile No. | Last Name), with **Save** once changed ("Not Saved" badge).

**Status change to a lost status** opens the **Lost Reason** dialog: "Please provide a reason for marking this lead as
lost", Lost Reason (a select of the nine), Lost Notes, Cancel and Save.

**Capxul.** The same header, tabs and side panel, with these changes:

- The status button runs `capxul org crm lead move CRM-LEAD-2026-00131 Nurture` (`client.org(orgId).crm.leads.move`);
  the Lost Reason dialog adds `--reason "Budget Constraints" --notes "…"`.
- Side-panel edits run `capxul org crm lead change CRM-LEAD-2026-00131 --job-title "Head of Digital"`.
- The Person section adds a **Capxul** row under Email: "Not on Capxul yet. Known by mailbox." Before conversion a
  lead's mailbox names nobody in the directory (`crm.md`, Conversion), so this row reads only "Lead" until converted.
- The tabs keep their order minus Comments and Attachments (see [conflicts](#left-out-and-conflicts-to-flag)); an email's
  attachments still show by name on the email itself.
- Make a Call is not shown (no telephony); **Log a Call** stays, as `org crm call log`.
- Delete is not shown. Assign To becomes the Lead Owner field (`--owner`), a picker of members.
- The page's strip: `capxul org crm lead get CRM-LEAD-2026-00131` and `capxul org crm timeline CRM-LEAD-2026-00131`.

## Convert to Deal

Source: `fe:components/Modals/ConvertToDealModal.vue`, `crm:crm_lead/crm_lead.py:545` (`convert_to_deal`),
https://docs.frappe.io/crm/lead ("Converting to a Deal").

**Dialog** "Convert to Deal". Two blocks, each with a **Choose Existing** switch:

- **Organization**: off, a new organization is made from the lead's Organization and company fields; on, a picker of
  existing organizations.
- **Contact**: off, a new contact from the lead's person fields; on, a picker of existing contacts.

Then the deal's own fields the layout marks mandatory (with forecasting on: Expected Deal Value and Expected Closure
Date), and **Convert**. Errors: "Please select an existing contact", "Please select an existing organization". The new
deal opens at status Qualification; its Activity tab starts with the lead's whole history and the line "converted the
lead to this deal" (`api:activities.py:51`).

**Capxul.** The same dialog, with **Company** in place of Organization. Convert runs
`capxul org crm lead convert CRM-LEAD-2026-00118 --company <contact> --contact <contact> --expected-value 86000 --currency GBP --close-by 2026-12-12`
(`client.org(orgId).crm.leads.convert`); without Choose Existing it gives no `--company` or `--contact`, and Capxul
matches the book's company by name and the person by mailbox, as Frappe does (`contacts.lead-conversion`). Converting
again returns the same deal. After conversion the person is named in Capxul's directory by their mailbox, so the
contact's panel says "Known by mailbox; can be paid, and claims with `payment claim`".

## Deals: list, kanban and group by

Source: `fe:pages/Deals.vue`, `fe:components/ListViews/DealsListView.vue`, `crm:crm_deal/crm_deal.py:304-376`.

**List** ("Deals"). Default columns, in order. Note that Frappe's default second column is the organization's
**Annual Revenue**, not the deal's value:

| Organization | Annual Revenue | Status | Email | Mobile No. | Assigned To | Last Modified |
|---|---|---|---|---|---|---|
| Meridian Labs Inc. | $64,000,000.00 | ● Negotiation | dana@meridianlabs.com | +1 617 555 0142 | Nadia Brooks | 3 hours ago |
| Kestrel Health | £38,000,000.00 | ● Proposal/Quotation | aisha.rahman@kestrelhealth.co.uk | +44 7700 900218 | Nadia Brooks | 1 day ago |
| Fernhill Energy | £410,000,000.00 | ● Ready to Close | priyanka.shah@fernhillenergy.co.uk | +44 7700 900930 | Maya Okafor | 2 days ago |
| Oakvale Housing Association | £96,000,000.00 | ● Demo/Making | martin.cole@oakvale.org.uk | +44 7700 900377 | Sam Whitfield | 6 days ago |
| Brightwater Schools Trust | £12,500,000.00 | ● Qualification | helen.marsh@brightwatertrust.org.uk | | Sam Whitfield | 1 week ago |
| Saltmarsh Distillery | £3,200,000.00 | ● Won | tobias@saltmarshdistillery.co.uk | +44 7700 900781 | Nadia Brooks | 12 days ago |

The organization column shows its logo or initials. 38 deals in all.

**Kanban** (column Status; title Organization; card fields Annual Revenue, Email, Mobile No., Assigned To, Last
Modified). Seven columns, Qualification to Lost. Dragging to Lost with no reason is refused, as for leads; dragging to
Won records the closed date.

**Group By**, as for leads; Deal Owner and Status are the useful groupings.

**Actions.** **+ Create** opens the new-deal dialog (`install.py:175`): an Organization block (choose existing, or
Organization Name, Website, Annual Revenue, Company Description, Territory, No. of Employees, Industry, LinkedIn, X,
Facebook), a Contact block (choose existing, or Salutation, First Name, Last Name, Email, Mobile No., Gender), then
Status and Deal Owner; with forecasting on, also Expected Deal Value, Expected Closure Date and Probability.

**Capxul.** The same list, kanban and group-by, with Company for Organization. Capxul adds one public saved view,
**Pipeline**, with the columns a sales lead actually reads: Company, Deal Value, Status, Probability, Expected Closure
Date, Deal Owner, Last Modified. Strip: `capxul org crm deal list --stage ongoing`
(`client.org(orgId).crm.deals.list`). **+ Create** runs
`capxul org crm deal create --company <contact> --contact <contact> --primary <contact> --owner nadia@harbourline.studio --value 42000 --expected-value 42000 --currency GBP --close-by 2027-01-31 --source Website`.
Dragging runs `org crm deal move <deal> <status>`.

## Deal page

Source: `fe:pages/Deal.vue`, the side panel `install.py:207` ("CRM Deal-Side Panel"), forecasting
(`crm:fcrm_settings/fcrm_settings.py:115`), the data fields `install.py:226`, https://docs.frappe.io/crm/deal. Example:
CRM-DEAL-2026-00031, Kestrel Health.

**Header.** Breadcrumbs "Deals / Kestrel Health". Right: Assign To, and the status button ("● Proposal/Quotation" with
the seven statuses). No convert button.

**Left: the tabs**, as on a lead, plus **Quotations** after WhatsApp (when the CRM is linked to selling).

**Right: the side panel.**

1. The deal's id `CRM-DEAL-2026-00031`.
2. A header block: the organization's logo, its name "Kestrel Health", and Send an Email, Go to Website, Attach a File,
   Delete.
3. **Contacts** (open, with a **+** that searches contacts, grouped "Contacts at Kestrel Health" then "Other
   contacts", or creates one): one collapsible block per person, primary first. Each: avatar, name, a green
   **Primary** badge on the primary, a ⋯ menu (Make a Call, Remove, Set as Primary Contact), an open-contact arrow;
   expanded, the person's email and mobile. Kestrel: Dr Aisha Rahman (Primary), Ben Okoye (Clinical Safety Officer).
4. **Forecasted Sales** (with forecasting on): Expected Closure Date "12 Dec 2026", Probability "50%", Expected Deal
   Value "£86,000.00".
5. **Organization Details**: Organization "Kestrel Health", Company Description "Digital health provider for NHS
   community clinics", Industry "Health Care", No. of Employees "201-500", Website "kestrelhealth.co.uk", Territory
   "United Kingdom", Annual Revenue "£38,000,000.00", Closed Date (empty until won), Next Step "Proposal review call,
   18 Nov", Deal Owner "Nadia Brooks", LinkedIn, X, Facebook.

**The Data tab**: Details in three columns (Organization, Company Description, Industry, No. of Employees, Annual
Revenue | Website, LinkedIn, X, Facebook, Closed Date, Next Step | Territory, Probability, Deal Owner), then the
**Products** table (Product, Quantity, Rate, Discount %, Amount, Net Amount) and Total and Net Total. Deal Value, Lost
Reason and Lost Notes also live on the record.

**Statuses.** Probability follows the status unless set. Won sets Closed Date. Lost asks for the reason.

**Capxul.**

- The status button runs `capxul org crm deal move CRM-DEAL-2026-00031 Negotiation`; Lost adds
  `--reason Competition --notes "…"` (`client.org(orgId).crm.deals.move`).
- Forecasted Sales and Organization Details edits run `org crm deal change CRM-DEAL-2026-00031 --probability 60`,
  `--value`, `--expected-value`, `--close-by`, `--next-step`, `--owner`. Company fields (description, industry,
  employees, website, territory, revenue) are the company's own and edit through `contact change <company> --org`.
- Contacts' **+** runs `org crm deal change CRM-DEAL-2026-00031 --contact <contact>`; Set as Primary runs
  `--primary <contact>`.
- Each person in Contacts shows a Capxul line: Dana Whitaker "On Capxul, @dana-whitaker"; Dr Aisha Rahman "Known by
  mailbox". The company header shows Meridian Labs' handle and Safe on its deals ("@meridianlabs · Safe 0x4a1F…c93B"),
  and nothing for a private company.
- **Products** and **Quotations** are not shown (no command; `surface.computed-gaps` lists CRM Product third), so the
  Data tab shows Deal Value directly. Quotations, if the selling module is shown elsewhere, link from there.
- A won deal makes the Customer that projects and invoices use, as Frappe CRM does when linked to selling
  (`create_customer_on_status_change`), and keeps the company's Party where it has one (`crm.md`, "For other lanes").
- The strip: `capxul org crm deal get CRM-DEAL-2026-00031`, `org crm timeline CRM-DEAL-2026-00031`.

## The activity timeline and its tabs

Source: `fe:components/Activities/Activities.vue` and its parts (`EmailArea.vue`, `CallArea.vue`, `NoteArea.vue`,
`TaskArea.vue`, `AttachmentArea.vue`, `ActivityHeader.vue`, `DataFields.vue`), the composer
`fe:components/CommunicationArea.vue`, the builder `api:activities.py`. FCRM Settings decide the order (**Oldest First**
by default) and the timestamp format (**Relative** by default, exact on hover).

**The Activity tab** is one vertical line with an icon per item. A deal's starts with its lead's items. Item kinds, as
Frappe draws them:

| Kind (`activity_type`) | Icon | How it reads | Example on CRM-DEAL-2026-00031 |
|---|---|---|---|
| `creation` | the lead or deal icon | "Sam Whitfield created this lead" · "converted the lead to this deal" | Sam Whitfield created this lead · 14 Aug |
| `added` | a small dot (gray) | "Sam Whitfield added Job Title as Head of Digital" | 14 Aug |
| `changed` | a small dot (gray) | "Nadia Brooks changed Status from Demo/Making to Proposal/Quotation" | 21 Oct |
| `removed` | a small dot | "Nadia Brooks removed value Next Step" | |
| grouped changes | a small dot | "Show +3 changes from Nadia Brooks" with a toggle that lists each (`handle_multiple_versions`) | 21 Oct: Status, Deal Value £86,000.00, Probability 50 |
| `communication` (email) | the sender's avatar | a card: sender, "to" recipients, time, subject, the body (quoted reply folded), attachments by name; **Reply** and **Reply All**; a scheduled email shows Send now, Edit, Delete; an automated one a green **Notification** badge | "Patient portal: looking for a design partner", from Dr Aisha Rahman · 14 Aug; Nadia's reply with the proposal, `Kestrel-proposal-v2.pdf` (2.1 MB) · 20 Oct |
| `comment` | a speech bubble | the author, "added a comment", the text with @mentions and reactions | |
| `incoming_call`, `outgoing_call` | an inbound or outbound phone, red if missed | "Sam Whitfield has made a call" then a card: Outbound Call, both avatars, the date badge "Aug 19, Tuesday", the duration "23m 10s", Listen (a recording) | Outbound Call, 23 min · 19 Aug |
| `note` | a note icon | "Sam Whitfield added a note **Discovery call**"; back-to-back notes fold into "Show +2 note updates from …"; pinned notes say "Pinned by …" | Discovery call · 19 Aug |
| `attachment_log` | a paperclip | "Nadia Brooks added Kestrel-proposal-v2.pdf" (a lock for private) | |
| WhatsApp messages | (own tab) | a chat thread; incoming on the left with the contact's avatar | |

**The other tabs**, each filtered to one kind, with its own empty state ("No Emails Found", "No Call History", "No
Notes Found", "No Tasks Found", "No Attachments Found", "No WhatsApp Messages Found" or "No Mobile Number"):

- **Emails**: the email cards on the same line, with the composer. The composer (Reply) is a rich editor with To, Cc,
  Bcc, Subject, an email template picker, attachments, and **Send** or **Schedule** (a later time); Comment is a box with
  @mentions.
- **Comments**: the comment cards.
- **Data**: the record's fields as a form (see each page).
- **Calls**: the call cards; clicking one opens its detail (type, status, duration, caller, receiver, note).
- **Tasks**: rows of title, assignee's avatar and name, due date ("12 Nov, 05:00 pm", full on hover), priority icon and
  name, and a status menu at the right (Backlog, Todo, In Progress, Done, Canceled) and ⋯ Delete. Clicking opens the task
  dialog (Title, Description, then Status, Assigned To, Due Date, Priority; `install.py:199`).
- **Notes**: a grid of cards (title, the start of the content, the author's avatar, "2 d ago"), with a ⋯ menu (Edit, Pin
  to top, Copy link, Delete); clicking opens the note dialog (Title, Content).
- **Attachments**: rows of file name, size, time, with Make Public or Private and Delete.
- **WhatsApp**: the chat and a message box (with document, image and video attachments and a template button); "Add a
  mobile number to send WhatsApp messages." when there is none.

**Example timeline of CRM-DEAL-2026-00031 (Kestrel Health), oldest first.** 14 Aug, 09:12: Sam Whitfield created this
lead (Website). 14 Aug: email in from Dr Aisha Rahman, "Patient portal: looking for a design partner". 14 Aug: Sam
changed Status from New to Contacted. 19 Aug: Outbound Call, 23 min, note "Discovery call: NHS DSP Toolkit, WCAG 2.2
AA, three pilot clinics in Salford". 2 Sep: Nadia Brooks converted the lead to this deal. 2 Sep: task "Send capability
deck" (Nadia, Done). 9 Sep: WhatsApp from Aisha, "Thursday works, see you at 2". 11 Sep: Nadia changed Status from
Qualification to Demo/Making. 20 Oct: email out, "Kestrel patient portal: our proposal", with `Kestrel-proposal-v2.pdf`.
21 Oct: Show +3 changes from Nadia Brooks (Status to Proposal/Quotation, Deal Value £86,000.00, Probability 50). 4 Nov:
task "Chase proposal feedback" (Nadia, Todo, due 12 Nov). 6 Nov: email in, "A few questions on the timeline".

**Capxul.** The same line and the same cards, in Capxul's identity, with these differences:

- **Money** is a new kind, drawn like a call card with a coin icon and a **Proof** block (`contacts.timeline-money`).
  It appears only where the record's Party moved money with Harbourline on chain. On CRM-DEAL-2026-00019 (Meridian
  Labs, won): "Meridian Labs paid 38,400.00 USDC · invoice ACC-SINV-2026-00068 · 21 Oct 2026", Proof: payment id
  `0x3c71…e2a4`, document hash `0x5b1e…c07a` (it commits to the invoice's lines: Design 250.0 h at $120.00, Engineering
  60.0 h at $140.00, no tax, as a US customer), transaction `0x8d2f…41b9`, block 28,914,302, 21 Oct 2026 15:42:07 UTC. On Ian Pryce's
  contact: "1,900.00 USDC sent from Growth · waiting to be claimed since 3 Nov", which he takes with `payment claim`
  and Harbourline can take back with `payment cancel 0x9a04…7d1e --org harbourline` until he does. On Freja Holm's
  contact (Copperleaf): "Invoice escrow from freja@copperleaf.dk · 9,840.00 of 9,840.00 USDC · paid out 12 Jan 2026".
- **Field changes** keep Frappe's lines, since Frappe keeps its versions on the record (`aaron.frappe-native`). Note
  that the booked `org crm timeline` leaves field changes out (`contacts.timeline`); see
  [conflicts](#left-out-and-conflicts-to-flag).
- **Comments** and **Attachments** tabs are not shown, nor the comment box and upload; an email lists its attachments
  by name, type and size (`contacts.attachments-later`).
- The **New** menu: Email, Log a Call, Note, Task, WhatsApp Message. Each item's command:

| Action | Command | SDK |
|---|---|---|
| Read the timeline | `capxul org crm timeline CRM-DEAL-2026-00031 [--kind email\|whatsapp\|call\|note\|task\|money\|record]…` | `client.org(orgId).crm.timeline` |
| Send an email, or Reply | `capxul org crm email send CRM-DEAL-2026-00031 --subject "Kestrel patient portal: our proposal" --body-file reply.md --confirm` (a reply: `--in-reply-to <communication>`) | `.crm.emails.send` |
| Send a WhatsApp message | `capxul org crm whatsapp send CRM-DEAL-2026-00031 --text "Thursday works, see you at 2" --confirm` (outside the 24-hour window, `--template <name>`) | `.crm.whatsapp.send` |
| Log a call | `capxul org crm call log CRM-DEAL-2026-00031 --type outgoing --status completed --start 2026-08-19T10:30 --duration 1390 --note "Discovery call: …"` | `.crm.calls.log` |
| Add or edit a note | `capxul org crm note add CRM-DEAL-2026-00031 "Discovery call" --content "…"`; `org crm note change <note> --content "…"` | `.crm.notes.add`, `.crm.notes.change` |
| Add a task | `capxul org crm task create CRM-DEAL-2026-00031 "Chase proposal feedback" --assigned-to nadia@harbourline.studio --due 2026-11-12T17:00 --priority high --status todo` | `.crm.tasks.create` |
| Move a task | `capxul org crm task move <task> Done` | `.crm.tasks.move` |

The sends preview, and their command strips always end in `--confirm`: the person answers the preview. The order on
screen stays Frappe's oldest first; the command lists newest first.

## Contacts

Source: `fe:pages/Contacts.vue`, `fe:pages/Contact.vue`, `/tmp/crm/crm/overrides/contact.py` (default columns), the
side panel `install.py:211` ("Contact-Side Panel").

**List** ("Contacts"). Columns: Name, Email, Phone, Organization, Last Modified.

| Name | Email | Phone | Organization | Last Modified |
|---|---|---|---|---|
| Dana Whitaker | dana@meridianlabs.com | +1 617 555 0142 | Meridian Labs Inc. | 3 hours ago |
| Dr Aisha Rahman | aisha.rahman@kestrelhealth.co.uk | +44 7700 900218 | Kestrel Health | 1 day ago |
| Ian Pryce | ian@pryce.consulting | +44 7700 900566 | | 6 days ago |
| Owen Tate | owen.tate@larkspurcoffee.co.uk | +44 7700 900290 | Larkspur Coffee Co. | 2 weeks ago |
| Freja Holm | freja@copperleaf.dk | +45 20 12 34 56 | Copperleaf Studios | 10 months ago |

**+ Create** opens the contact dialog (Salutation; First Name, Last Name; Email; Mobile No., Gender; Organization;
Designation; Address; `install.py:179`).

**Page** (Contact "Dana Whitaker"). Header: breadcrumbs "Contacts / Dana Whitaker", and **New Deal**. Left, the side
panel: the photo, the name (with salutation), the company under it, buttons Make Call (with telephony) and Delete; then
**Details**: Salutation, First Name "Dana", Last Name "Whitaker", Email (a menu of the contact's addresses, the primary
marked, add or set primary), Mobile No. (the same for numbers), Gender, Organization "Meridian Labs Inc.", Designation
"VP Product", Address. Right, one tab: **Deals** with a count, listing the deals this contact is on, with columns
Organization, Amount, Status, Email, Mobile Number, Deal Owner, Last Modified.

**Capxul.** The list adds one column after Phone, **Capxul**: "@dana-whitaker" (on Capxul), "By mailbox" (named in the
directory, not yet joined: money waits for them in escrow), or "Private" (no mailbox; cannot be paid until linked). The
page's side panel adds a **Capxul** section at the top of Details:

- Dana Whitaker: "On Capxul as @dana-whitaker. Pays to her Safe 0xB21d…07Fe."
- Ian Pryce: "Known by mailbox. 1,900.00 USDC waiting for him since 3 Nov (escrow)", with **Cancel payment**
  (`capxul payment cancel 0x9a04…7d1e --org harbourline`, for whoever wears the Growth hat now).
- A private entry: "Not linked. Link to pay", running `capxul contact link <contact> <email|@handle|0x…> --confirm --org harbourline`.

Commands: list `capxul contact list --org harbourline` (`client.account.addressBook.list`); open
`capxul contact get <contact> --org harbourline`; create
`capxul contact create "Ian Pryce" --type person --email ian@pryce.consulting --phone "+44 7700 900566" --designation "Independent consultant" --org harbourline`
(`client.account.addressBook.create`); edit `capxul contact change <contact> --designation "…" --org harbourline`;
hide `contact hide <contact>`. **New Deal** runs `org crm deal create --company <company> --contact <contact>`. Delete,
Gender, Salutation and Address are not shown (the commands take none of them); Make Call is not shown.

## Organizations, shown as Companies

Source: `fe:pages/Organizations.vue`, `fe:pages/Organization.vue`, `crm:crm_organization/crm_organization.py:53`
(default columns), the side panel `install.py:215`.

**List** ("Organizations"). Columns: Organization, Website, Industry, Annual Revenue, Last Modified.

| Organization | Website | Industry | Annual Revenue | Last Modified |
|---|---|---|---|---|
| Fernhill Energy | fernhillenergy.co.uk | Energy | £410,000,000.00 | 2 days ago |
| Kestrel Health | kestrelhealth.co.uk | Health Care | £38,000,000.00 | 1 day ago |
| Larkspur Coffee Co. | larkspurcoffee.co.uk | Food | £21,500,000.00 | 2 weeks ago |
| Meridian Labs Inc. | meridianlabs.com | Software | $64,000,000.00 | 3 hours ago |
| Oakvale Housing Association | oakvale.org.uk | Real Estate | £96,000,000.00 | 6 days ago |

**+ Create** opens the organization dialog: Organization Name; Website, Company Description, Annual Revenue; Territory;
No. of Employees, LinkedIn, X, Industry, Facebook; Address (`install.py:183`).

**Page** ("Kestrel Health"). Header: breadcrumbs, then **New Deal** (on the Deals tab) or **Add Contact** (on the
Contacts tab). Left, the side panel: logo, name, website, buttons Delete and Open Website; then **Details**: Organization
Name, Company Description, Website, Territory, Industry, No. of Employees, Address, LinkedIn, X, Facebook. Right, two
tabs with counts: **Deals** (Organization, Amount, Status, Email, Mobile Number, Deal Owner, Last Modified) and
**Contacts** (Name, Email, Phone, Organization, Last Modified). Empty Deals: "Use New Deal to create a deal for this
organization."

**Capxul.** Labelled **Companies** and **Company** throughout, including the breadcrumbs. The side panel adds **Capxul**:
Meridian Labs "A Capxul Organization, @meridianlabs. Pays to its company Safe 0x4a1F…c93B", with its paid invoices
summed ("Paid since May: 102,400.00 USDC, 3 invoices"); any other company "Private: not on Capxul. Its people can be
paid by mailbox." Commands: list `capxul contact list --org harbourline` (companies shown; the record's `doctype` is
`organization`); create
`capxul contact create "Kestrel Health" --type company --website kestrelhealth.co.uk --industry "Health Care" --territory "United Kingdom" --employees 201-500 --revenue 38000000 --currency GBP --description "Digital health provider for NHS community clinics" --org harbourline`;
Add Contact runs `contact change <person> --company <company> --org harbourline`; New Deal runs
`org crm deal create --company <company>`; the Deals tab is `org crm deal list --company <company>`. A company's
**Activity** is not a Frappe tab and is not added.

## Notes page

Source: `fe:pages/Notes.vue`, `crm:fcrm_note/fcrm_note.json`. "Notes" lists every note in one card grid ("Notes View"):
each card has the title, the start of the content, the author's avatar and name, the time, and a ⋯ menu (Edit, Copy
link, Delete). **+ Create** opens the note dialog. Empty: "No notes yet". A note belongs to a lead or deal (Reference
Doc) and can be pinned.

**Capxul.** The same grid. Each card names its record ("on Kestrel Health"). Create needs a record:
`capxul org crm note add <record> "<title>" --content "…"`. There is no list command for notes alone; the strip reads
`capxul org crm timeline <record> --kind note`. Delete is not shown (`contacts.notes-kept`).

## CRM Tasks page

Source: `fe:pages/Tasks.vue`, `crm:crm_task/crm_task.py:58-117`. Views: List and Kanban.

**List** columns: Title, Status, Priority, Due Date, Assigned To, Last Modified.

| Title | Status | Priority | Due Date | Assigned To | Last Modified |
|---|---|---|---|---|---|
| Chase proposal feedback | Todo | High | 12 Nov 2026, 5:00 pm | Nadia Brooks | 5 days ago |
| Book demo with Oakvale's board | In Progress | Medium | 18 Nov 2026, 10:00 am | Sam Whitfield | 6 days ago |
| Send Brightwater the case study | Backlog | Low | | Sam Whitfield | 1 week ago |
| Draft Meridian SOW v3 | Done | High | 4 Nov 2026, 12:00 pm | Nadia Brooks | 5 days ago |

**Kanban**: columns Backlog, Todo, In Progress, Done, Canceled; cards titled by Title, with Description, Priority and
the time created.

**Capxul.** The same list and kanban, headed "Tasks" in the CRM's sidebar. Strip:
`capxul org crm task list --stage open --stage working` (`client.org(orgId).crm.tasks.list`); with the assignee filter,
`--assigned-to sam@harbourline.studio`. A drag runs `org crm task move <task> "In Progress"`; Sam may move his own
tasks without the People hat (`contacts.task-assignee`).

## Call Logs page

Source: `fe:pages/CallLogs.vue`, `crm:crm_call_log/crm_call_log.py:58`. Columns: Caller, Receiver, Type, Status,
Duration, From (number), To (number), Created On. Clicking opens the call's detail, with its note and, with telephony,
its recording.

| Caller | Receiver | Type | Status | Duration | From (number) | To (number) | Created On |
|---|---|---|---|---|---|---|---|
| Sam Whitfield | Martin Cole | Outgoing | Completed | 18m 40s | +44 20 7946 0321 | +44 7700 900377 | 3 Nov 2026 |
| Amelia Grant | Sam Whitfield | Incoming | No Answer | | +44 7700 900412 | +44 20 7946 0321 | 9 Nov 2026 |

**Capxul.** Capxul has no telephony, so every log is manual (Telephony Medium "Manual"); the list stays, filtered by
type and status. Strip: `capxul org crm timeline <record> --kind call`; logging:
`capxul org crm call log <record> --type incoming --status no-answer --number "+44 7700 900412" --start 2026-11-09T11:05`.

## Projects workspace

Source: `pj:workspace/projects/projects.json`, `pj:sidebar/projects/projects.json`, `pj:number_card/*`,
`pj:dashboard_chart/*`.

| Region | Frappe | Example on 9 Nov 2026 |
|---|---|---|
| Sidebar | Home · Dashboard · Project · Task · Timesheet · Reports (Project Summary, Timesheet Billing Summary, Daily Timesheet Summary, Delayed Tasks Summary, Project wise Stock Tracking) · Setup (Activity Type, Activity Cost, Project Type, Task Type, Project Template, Project Update, Settings) | |
| Onboarding | "Projects Onboarding" block | (finished long ago) |
| Chart | Project Summary: the report of that name for open projects, as bars per project: Overdue, Completed, Total Tasks (`dashboard_chart/project_summary`) | Larkspur ordering app 1, 9, 22 · Meridian design system 0, 20, 31 · Studio tooling and templates 0, 2, 10 |
| Number card | Open Projects: count, status Open | 3 |
| Number card | Non Completed Tasks: count, status Open, Working or Overdue | 34 |
| Number card | Timesheet Working Hours: sum of `total_hours` of submitted timesheets starting this quarter | 2,318.5 |
| Card | Project Reports: links to the five reports | |

The Dashboard link opens the Project dashboard: the same cards and the Completed Projects line chart (count by month,
last year).

**Capxul.** One group, **Projects**, matching `org projects`. Sidebar: Home · Projects · Tasks · Timesheets · Reports
(Project summary, Timesheet billing summary, Daily timesheet summary, Delayed tasks summary) · Setup (Activity types,
Project types, Projects options). Project wise Stock Tracking (stock), Task Type, Project Template, Project Update and
Activity Cost are not shown (see [left out](#left-out-and-conflicts-to-flag)). No onboarding block. The chart and three
cards as they are. Command strip: `capxul org projects list --status open`.

## Project list

Source: `pj:doctype/project/project.json` (`in_list_view`), `pj:doctype/project/project_list.js`.

Default filter Status = Open. Each row: the title (Project Name), the indicator, then the list columns. The indicator:
an open project with progress shows its percent in orange ("41%"); On hold is blue; Completed is green; Cancelled red;
an open project at 0% shows "Open".

| Project Name | Status | Project Type | % Completed | Expected Start date | Expected End date | Estimated Cost | Customer | ID |
|---|---|---|---|---|---|---|---|---|
| Larkspur ordering app | 41% | External | 41 | 06-04-2026 | 29-01-2027 | £118,000.00 | Larkspur Coffee Co. | PROJ-0011 |
| Meridian design system | 64% | External | 64 | 18-05-2026 | 18-12-2026 | £78,000.00 | Meridian Labs Inc. | PROJ-0012 |
| Studio tooling and templates | 20% | Other | 20 | 01-09-2026 | 31-03-2027 | £12,000.00 | | PROJ-0013 |

Standard filters: ID, Status, Project Type, Priority, Customer. Views: List, Report and Kanban (desk defaults).

**Capxul.** The same list, its percent shown as a bar with the number. Strip:
`capxul org projects list --status open` (`client.org(orgId).projects.list`); the filters map to `--status`, `--type`,
`--customer`, `--member`. **+ Add Project** runs
`capxul org projects create "Larkspur ordering app" --type External --priority high --start 2026-04-06 --end 2027-01-29 --customer "Larkspur Coffee Co." --progress task-completion --department delivery --estimated-cost 118000`
(`client.org(orgId).projects.create`), for a People-hat wearer or a Director.

## Project form

Source: `pj:doctype/project/project.json` (field order), `project.js` (buttons, the Tasks tab), `project_overview.py`
and `erpnext/public/js/project_overview.js` (the Overview tab), `project/costing/project_costing.py` (the Costing
dashboard), `project_dashboard.py` (Connections), https://docs.frappe.io/erpnext/user/manual/en/project. Example:
PROJ-0011, Larkspur ordering app.

**Page head.** Title "Larkspur ordering app", the indicator ("41%", orange), **Save**, an **Actions** menu (Duplicate
Project with Tasks, Update Costing and Billing, Set Project Status: a dialog choosing Completed or Cancelled), a **View**
menu (Gantt Chart, which opens the Task Gantt filtered to this project; Kanban Board, which makes and opens a board of
this project's tasks), the ⋯ menu, previous and next.

**Tab 1, Overview** (new in ERPNext, read-only, built from the project's tasks):

- A header line: the next milestone ("Next Milestone: Beta launch in 3 shops · 15 Dec 2026 · in 36 days"), or "All
  milestones met"; and the date range ("6 Apr 2026 – 29 Jan 2027"). A closed project shows how it ended instead
  ("Completed 30 Jun 2026 · On time · planned 30 Jun 2026").
- Three stat cards: **Open Tasks** "13", "3 due in the next 7 days"; **Overdue** "1", "Oldest 3 days late"; **Hours
  Logged** "1,486.5 h", "62% of 2,400 h expected"; and, when billable time is not yet invoiced, **Unbilled** "104.5 h of
  billable time not invoiced" (November's hours so far).
- **Planned vs Completed**: a line chart, planned share of task weight against completed share, by date, with a marker
  at today.
- **Tasks by Status**: a bar (Open 7, Working 4, Pending Review 1, Overdue 1, Completed 9).
- **Needs Attention**: up to ten open tasks under their most pressing reason, in order Overdue, Blocked, Unassigned, Due
  Soon (7 days): "Overdue · API integration with Square POS · Ellis Hart · 3 days late"; "Blocked · Loyalty stamps ·
  Lena Fischer · waits on Checkout and Apple Pay"; "Unassigned · Android app shell"; "Due Soon · Accessibility review ·
  Priya Raman · 12 Nov".
- **Open Tasks by Assignee**: bars (Ellis Hart 4, Lena Fischer 3, Jamal Osei 3, Priya Raman 1, Grace Adeyemi 1,
  unassigned 1).
- **Profitability**: Billed £139,860.00 · Cost £91,080.00 · Margin £48,780.00 (34.9%).
- With no tasks: "No tasks yet" and **New Task**; all cancelled: "All tasks were cancelled" and **View Tasks**.

**Tab 2, Details.**

| Section | Field | Example |
|---|---|---|
| (top) | Series (PROJ-.####, hidden after save), Project Name\*, Status (Open, On hold, Completed, Cancelled), Project Type, % Complete Method (Manual, Task Completion, Task Progress, Task Weight) | PROJ-0011, Larkspur ordering app, Open, External, Task Completion |
| | From Template, Priority (Low, Medium, High), Department, Is Active (Yes, No), % Completed | , High, Delivery, Yes, 41% |
| Timeline | Expected Start date, Expected End date | 06-04-2026, 29-01-2027 |
| | Actual Start date (via Timesheet), Actual End date (via Timesheet), Actual Time in hours (via Timesheet) | 07-04-2026, 06-11-2026, 1,486.5 |
| Accounting | Company\*, Estimated Cost | Harbourline Studio Ltd, £118,000.00 |
| | Default Cost Center | Delivery - HL |

**Tab 3, Tasks**: an embedded list of the project's tasks with **Add Task**; columns Task Name, Status (a coloured
badge, editable in place), Priority (editable), Start Date, End Date, Progress, Assigned To (avatars, with Assign), and
Created On and Last Updated On on demand. Clicking a task opens a quick dialog (Subject, Status, Priority, Assigned to,
Expected start "Started 7 Apr 2026", Expected end, Expected hours "62.5 h logged", Description) with **Save** and
**Open full form**. Empty: "No Tasks in this Project yet."

**Tab 4, Customer**: Customer "Larkspur Coffee Co.", Sales Order "SAL-ORD-2026-00004"; **Notes** (collapsible): a text
editor ("Fixed rate card; invoices monthly in arrears for logged hours. Beta in 3 shops before Christmas.").

**Tab 5, Costing**: the Costing Dashboard (cost so far against the estimate, used percent, forecast, variance and a
health mark; the contract and billed share; the margin; monthly labour, purchases and materials), then **Costing and
Billing**:

| Field | Example |
|---|---|
| Total Costing Amount (via Timesheet) | £88,940.00 |
| Total Purchase Cost (via Purchase Invoice) | £2,140.00 |
| Total Sales amount (via Sales Order) | £184,000.00 |
| Total Billable amount (via Timesheet) | £153,160.00 |
| Total Billed amount (via Sales Invoice) | £139,860.00 |
| Total Consumed Material Cost | £0.00 |

and **Margin**: Gross Margin £48,780.00, Gross Margin % 34.88 (billed less costing, expense claims, purchases and
materials, over billed).

**Tab 6, Budgets**: an embedded list of accounting budgets for the project (Account, Budget, Status, Amount, Fiscal
year, Distribution frequency), **Add budget**; empty "No budgets for this project".

**Tab 7, Progress updates**: Email users for progress updates (check), Holiday List, Frequency (Hourly, Twice Daily,
Daily, Weekly) and its times, Subject, Message.

**Tab 8, More Info**: Users (Project User rows: User, Full Name, Email, Welcome email sent, View attachments, Hide
timesheets): Grace Adeyemi, Ellis Hart, Lena Fischer, Jamal Osei, Priya Raman, and Owen Tate of Larkspur as a website
user.

**Tab 9, Connections**: a heatmap of timesheet activity ("This is based on the Time Sheets created against this
project"), then linked counts: Project (Task 22, Timesheet 96, Issue, Project Update), Material (Material Request, BOM,
Stock Entry), Sales (Sales Order 1, Delivery Note, Sales Invoice 7), Purchase (Purchase Order, Purchase Receipt,
Purchase Invoice 2), Manufacture (Work Order); Reports: Timesheet Billing Summary.

**Rules.** % Completed follows the method: Task Completion is completed over all tasks; Task Progress the mean of
tasks' % Progress; Task Weight the weighted sum. A project completes at 100% and reopens below it unless on hold or
cancelled (`projects.derived`).

**Capxul.** The same head and tabs, with these changes:

- **Department** is the Capxul department (a budget with a hat): "Delivery · worn by Grace Adeyemi". Default Cost
  Center shows the department's name, no suffix. Company is hidden.
- **Budgets** shows the department's Capxul budget instead of accounting budgets: "Delivery budget · 61,200.00 USDC
  left of 180,000.00 this year · spent by whoever wears the Delivery hat". The project spends nothing itself; its
  purchases are paid from that budget.
- **Costing**: the billed amount comes from Harbourline's invoices; each invoice in Connections opens with its payment
  and proof. The Costing Dashboard stays.
- **Progress updates** and **From Template** are not shown (Project Update and Project Template are not kept), nor
  **Is Active**. **Duplicate Project with Tasks** and **Update Costing and Billing** are not shown (no command; Capxul
  keeps the totals current as timesheets and invoices change).
- **Connections** shows Task, Timesheet, Sales Order, Sales Invoice (Invoices) and Purchase Invoice (Bills); the stock,
  manufacturing and Issue rows are not shown.
- **More Info / Users**: members only, by Seat; no website users, no welcome email.
- Commands:

| Action | Command | SDK |
|---|---|---|
| Open | `capxul org projects get PROJ-0011` | `client.org(orgId).projects.get` |
| Save a change | `capxul org projects change PROJ-0011 --end 2027-02-12 --estimated-cost 124000` | `.projects.change` |
| Put on hold, resume | `capxul org projects hold PROJ-0008`, `org projects resume PROJ-0008` | `.projects.hold`, `.projects.resume` |
| Set Project Status: Completed | `capxul org projects complete PROJ-0011` (refused while tasks are open, naming them) | `.projects.complete` |
| Set Project Status: Cancelled | `capxul org projects cancel PROJ-0011` | `.projects.cancel` |
| Reopen | `capxul org projects reopen PROJ-0005` | `.projects.reopen` |
| Add a member | `capxul org projects member add PROJ-0011 jamal@harbourline.studio` | `.projects.members.add` |
| Add Task | `capxul org projects task create "Order history screen" --project PROJ-0011 --end 2026-11-27 --hours 16 --priority medium` | `.projects.tasks.create` |
| Gantt Chart, Kanban Board | `capxul org projects task list --project PROJ-0011` | `.projects.tasks.list` |

Only a People-hat wearer or a Director sees Save, Actions and member changes enabled; any member adds tasks.

## Task list, kanban, Gantt and tree

Source: `pj:doctype/task/task.json`, `task_list.js`, `task_kanban.js`, `kanban_board/task_status.json`,
`task_calendar.js`, `task_tree.js`, Frappe's `gantt_view.js`, https://docs.frappe.io/erpnext/user/manual/en/tasks.

**List.** Default filter Status = Open. Title Subject; indicator by status (Open orange, Working orange, Pending Review
orange, Overdue red, Completed green, Cancelled dark grey, Template blue); columns Project, Is Group, Priority, Is
Milestone. Menu: **Set as Open**, **Set as Completed** for the selected rows.

| Subject | Status | Project | Is Group | Priority | Is Milestone | ID |
|---|---|---|---|---|---|---|
| API integration with Square POS | Overdue | PROJ-0011 | | High | | TASK-2026-00420 |
| Checkout and Apple Pay | Working | PROJ-0011 | | High | | TASK-2026-00411 |
| Accessibility review | Pending Review | PROJ-0011 | | Medium | | TASK-2026-00426 |
| Loyalty stamps | Open | PROJ-0011 | | Medium | | TASK-2026-00412 |
| Beta launch in 3 shops | Open | PROJ-0011 | | Urgent | ✓ | TASK-2026-00405 |
| Token pipeline to Figma | Working | PROJ-0012 | | Medium | | TASK-2026-00377 |

**Kanban** (the "Task Status" board, column field Status): Open (orange), Working (blue), Pending Review (purple),
Overdue (red), Completed (green), Cancelled (gray), Template (gray). A card shows the subject and the board's chosen
fields. Dropping a card on Overdue is refused: "A task becomes Overdue on its own once its Expected End Date passes"
(`task_kanban.js`). The project's own board (View, Kanban Board) is the same board filtered to it.

**Gantt** (List / Task / Gantt): a bar per task from Expected Start Date to Expected End Date, labelled by Subject, its
progress filled from % Progress; milestones drawn as milestones. View modes as tab buttons: Quarter Day, Half Day, Day
(default), Week, Month, and a Today button. Dragging a bar moves its dates; dragging its handle changes its progress;
double-click opens the task; a click shows a popup (the task, Project, Progress, Assigned to). Filter: Project. The
docs say dependencies show in the Gantt chart; draw them as arrows from each task to those depending on it.

**Tree** (Task Tree): root "All Tasks", filters Project and Task, group tasks expand to their children, **Add Child**
and **Add Multiple** (several subjects at once). PROJ-0011's tree:

```
All Tasks
├── Discovery (group, Completed)
├── Ordering flow design (group, Working)
│   ├── Menu and basket screens (Completed)
│   ├── Checkout and Apple Pay (Working, 60%)
│   └── Loyalty stamps (Open, depends on Checkout and Apple Pay)
├── Build (group, Working)
│   ├── API integration with Square POS (Overdue, due 6 Nov)
│   ├── iOS app shell (Working)
│   └── Android app shell (Open, unassigned)
├── Accessibility review (Pending Review, review by 12 Nov)
└── Beta launch in 3 shops (milestone, Open, 15 Dec; depends on the three Build tasks)
```

**Capxul.** The four views, in Capxul's identity. Strip: `capxul org projects task list --project PROJ-0011 --status open`
(`client.org(orgId).projects.tasks.list`). Moving a card runs the task's verb:

| Drop on | Command |
|---|---|
| Working | `capxul org projects task start TASK-2026-00412` |
| Pending Review | `capxul org projects task review TASK-2026-00426 --by 2026-11-12` (asks for the day) |
| Completed | `capxul org projects task complete TASK-2026-00411` (refused while a dependency or child is open) |
| Open (from Completed or Cancelled) | `capxul org projects task reopen TASK-2026-00402` |
| Cancelled | `capxul org projects task cancel TASK-2026-00422` |
| Overdue | refused, with Frappe's message |

Set as Completed and Set as Open run the same verbs for each selected task. A Gantt drag runs
`capxul org projects task change TASK-2026-00420 --start 2026-10-19 --end 2026-11-13`; the progress handle is not
offered (no flag sets % Progress). Add Child runs `org projects task create "<subject>" --project PROJ-0011 --parent TASK-2026-00404`.
The Template status and the Is Template check are not shown.

## Task form

Source: `pj:doctype/task/task.json`, `task.js`, `task_dashboard.py`. Example: TASK-2026-00420.

**Page head.** "API integration with Square POS", indicator Overdue (red), Save, a **Create** menu with **Timesheet**
(a draft timesheet for this task), ⋯, previous and next.

**Tab 1, Details.**

| Section | Field | Example |
|---|---|---|
| (top) | Subject\*, Project, Issue, Type, Color, Is Group | API integration with Square POS, PROJ-0011, , , #2F6F62, no |
| | Status (Open, Working, Pending Review, Overdue, Template, Completed, Cancelled), Priority (Low, Medium, High, Urgent), Weight, Parent Task | Overdue, High, 3, Build |
| | Completed By, Completed On (when Completed) | |
| (template) | Is Template; Begin On (Days), Duration (Days) when it is | no |
| Timeline (collapsible) | Expected Start Date, Expected Time (in hours) | 19-10-2026 09:00, 60 |
| | Expected End Date, % Progress, Is Milestone | 06-11-2026 17:30, 80, no |
| Details | Task Description | "Sync menu, prices and stock from Square; push orders back. Webhooks for sold-out items." |

**Tab 2, Dependencies.** Dependent Tasks (Task, Subject): none on this task; on TASK-2026-00405 (Beta launch) the
three Build tasks. Then Actual Start Date (via Timesheet) 19-10-2026, Actual Time in Hours (via Timesheet) 62.5, Actual
End Date (via Timesheet); **Costing** (collapsible): Total Costing Amount (via Timesheet) £3,875.00, Total Billable
Amount (via Timesheet) £8,125.00.

**Tab 3, More Info.** Additional Info: Company, Review Date (when Pending Review or Completed), Closing Date (when
Completed), Department.

**Connections.** Activity: Timesheet (4).

**Rules.** A task cannot complete before the tasks it depends on, nor a group before its children. Its actual dates,
time and amounts come from submitted timesheets. It falls Overdue after its Expected End Date (under review, after its
Review Date) (`projects.overdue-timer`). Weight feeds the project's Task Weight method.

**Capxul.** The same tabs. Issue, Color, Is Template, Begin On and Duration are not shown; Company is hidden;
Department is the Capxul department. The head's status buttons are the verbs (Start, Send for review, Complete, Reopen,
Cancel). Commands: open `capxul org projects task get TASK-2026-00420` (`client.org(orgId).projects.tasks.get`); save
`capxul org projects task change TASK-2026-00420 --end 2026-11-13 --hours 72 --priority urgent --depends-on TASK-2026-00403`;
Create Timesheet `capxul org projects timesheet create --project PROJ-0011` then
`org projects timesheet log <timesheet> --activity Engineering --start … --hours … --task TASK-2026-00420 --billable`.

## Timesheet list

Source: `pj:doctype/timesheet/timesheet.json`, `timesheet_list.js`.

Title Employee Name; indicator Draft (red), Submitted (blue), Partially Billed (orange), Billed (green), Payslip
(green), Completed (green), Cancelled (red); columns Start Date and % Amount Billed. Filters: ID, Status, Employee.

| Employee Name | Status | Start Date | % Amount Billed | ID |
|---|---|---|---|---|
| Ellis Hart | Submitted | 02-11-2026 | 0 | TS-2026-00877 |
| Hannah Cole | Draft | 02-11-2026 | 0 | TS-2026-00879 |
| Lena Fischer | Submitted | 02-11-2026 | 0 | TS-2026-00878 |
| Ellis Hart | Billed | 26-10-2026 | 100 | TS-2026-00851 |
| Jamal Osei | Billed | 05-10-2026 | 100 | TS-2026-00826 |

**Capxul.** The same list. Strip: `capxul org projects timesheet list --status submitted`
(`client.org(orgId).projects.timesheets.list`), with `--for <person>` and `--project`. A timesheet logged for someone
with no Seat says so in the row ("for Hannah Cole, by Grace Adeyemi").

## Timesheet form

Source: `pj:doctype/timesheet/timesheet.json`, `pj:doctype/timesheet_detail/timesheet_detail.json`, `timesheet.js`,
`timesheet.py` (`set_status`), `timesheet_dashboard.py`, https://docs.frappe.io/erpnext/user/manual/en/timesheets.
Example: TS-2026-00877, Ellis Hart, 2 to 6 November.

**Page head.** "Ellis Hart", indicator Submitted. In Draft: **Start Timer** (or **Resume Timer** when a log has begun
and is not completed), Save, Submit. Submitted with unbilled billable hours: **Create Sales Invoice** (a dialog: Item
Code, Customer), Cancel. Cancelled: Amend.

**Tab 1, Timesheet.**

| Section | Field | Example |
|---|---|---|
| (top) | Series (TS-.YYYY.-), Company, Customer, Currency, Exchange Rate, Sales Invoice (read-only) | TS-2026-00877, , Larkspur Coffee Co., GBP, 1, |
| | Status (read-only: Draft, Submitted, Partially Billed, Billed, Payslip, Completed, Cancelled), Project, User (read-only), Start Date, End Date (read-only, from the logs) | Submitted, PROJ-0011, ellis@harbourline.studio, 02-11-2026, 06-11-2026 |
| Employee Detail | Employee, Department (read-only), Employee Name | HR-EMP-00007, Engineering, Ellis Hart |
| Time Sheets\* | the time logs table (below) | 7 rows |
| (foot) | Total Working Hours | 37.5 |

The **time logs** grid shows Activity Type, From Time, Hrs, Project, Is Billable; each row opens to Activity Type, From
Time, Description | Expected Hrs, To Time, Hrs, Completed; Project, Project Name | Task; Is Billable, Sales Invoice |
Billing Hours; Billing Rate, Billing Amount, Costing Rate, Costing Amount.

| # | Activity Type | From Time | Hrs | Project | Bill | Task | Billing Rate | Billing Amount | Costing Rate | Costing Amount |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Engineering | 02-11-2026 09:00 | 7.5 | PROJ-0011 | ✓ | API integration with Square POS | 130.00 | 975.00 | 62.00 | 465.00 |
| 2 | Engineering | 03-11-2026 09:00 | 7.0 | PROJ-0011 | ✓ | API integration with Square POS | 130.00 | 910.00 | 62.00 | 434.00 |
| 3 | Communication | 03-11-2026 16:30 | 0.5 | PROJ-0011 | ✓ | (weekly client call) | 95.00 | 47.50 | 50.00 | 25.00 |
| 4 | Engineering | 04-11-2026 09:00 | 7.5 | PROJ-0011 | ✓ | iOS app shell | 130.00 | 975.00 | 62.00 | 465.00 |
| 5 | Planning | 05-11-2026 09:00 | 3.0 | PROJ-0008 | | (website refresh) | 0.00 | 0.00 | 60.00 | 180.00 |
| 6 | Engineering | 05-11-2026 13:00 | 4.5 | PROJ-0011 | ✓ | API integration with Square POS | 130.00 | 585.00 | 62.00 | 279.00 |
| 7 | Engineering | 06-11-2026 09:00 | 7.5 | PROJ-0011 | ✓ | API integration with Square POS (Completed ✓) | 130.00 | 975.00 | 62.00 | 465.00 |

**Tab 2, Billing.** Billing Details: Total Billable Hours 34.5, Total Billable Amount £4,467.50, Total Costing Amount
£2,313.00 | Total Billed Hours 0, Total Billed Amount £0.00, % Amount Billed 0. Then Note.

**Connections.** References: Sales Invoice.

**Rules.** Rates come from the employee's Activity Cost, else the Activity Type's defaults; they lock on submit. A log
may not overlap another of the same user or employee unless Projects Settings allow it. Submitting rolls the hours into
the tasks and the project. Status: Draft, then Submitted; Partially Billed or Billed as invoices take its hours; Payslip
once a salary slip names it; Cancelled. A cancelled timesheet can be amended. The **Start Timer** dialog asks Activity
Type, Project, Task and Expected Hrs; **Complete** writes the log with its times.

**Capxul.** The same head, tabs and grid. Company and Exchange Rate are hidden unless the currency is not GBP (a
Meridian timesheet: Currency USD). Employee Detail adds "logged by" when someone logs for another. Commands:

| Action | Command | SDK |
|---|---|---|
| New timesheet (own) | `capxul org projects timesheet create --project PROJ-0011 --title "Ellis Hart, 2 to 6 Nov"` | `.projects.timesheets.create` |
| New timesheet (for someone with no Seat) | `capxul org projects timesheet create --for hannah.cole@harbourline.studio --employee HR-EMP-00024 --project PROJ-0012` (People or Director) | same |
| Add a row, or the timer's Complete | `capxul org projects timesheet log TS-2026-00877 --activity Engineering --start 2026-11-02T09:00 --hours 7.5 --task TASK-2026-00420 --project PROJ-0011 --billable` (the last row also `--completed`) | `.projects.timesheets.log` |
| Submit | `capxul org projects timesheet submit TS-2026-00877` | `.projects.timesheets.submit` |
| Cancel | `capxul org projects timesheet cancel TS-2026-00877` (refused once any of it is billed) | `.projects.timesheets.cancel` |
| Open | `capxul org projects timesheet get TS-2026-00877` | `.projects.timesheets.get` |
| Create Sales Invoice | `capxul org projects timesheet bill TS-2026-00851 TS-2026-00852 TS-2026-00853 --to accounts@larkspurcoffee.co.uk` (Invoicing) | `.projects.timesheets.bill` |

The button is labelled **Create Invoice**. Its dialog asks only who pays (`--to`); the lines come from the activities
and rates. Amend is not shown (`timesheet create` makes a new one). The Payslip status stays in the list of states but
no timesheet reaches it: paying hours through a payslip is deferred (`payroll.timesheet-pay`).

## Billing hours and the money that follows

This is the one place where projects meets Capxul's money, so the mock-up should show it end to end.

1. **Bill.** On 2 November Maya Okafor, who wears Invoicing, bills October's hours on the Larkspur ordering app (she
   asked the FDE, which drafted the command for her to run): `org projects timesheet bill` over each worker's October
   timesheets. One Invoice, ACC-SINV-2026-00071, one line per activity and billing rate: Engineering 168.0 h at
   £130.00 = £21,840.00; Design 72.0 h at £120.00 = £8,640.00; Communication 8.0 h at £95.00 = £760.00. Net £31,240.00,
   VAT 20% £6,248.00, total £37,488.00, due in 30 days. The logs are marked billed in the same write; the timesheets
   turn Billed (green), and PROJ-0011's Total Billed amount rises by £31,240.00.
2. **Pay.** On 6 November Larkspur pays from its bank by transfer into Harbourline's Bridge account. Bridge turns the
   pounds into USDC in the Treasury Safe. The deposit matches the
   invoice by its reference, and the invoice turns Paid.
3. **Proof.** The payment carries the document hash of a payment advice that commits to the invoice: its Capxul id and
   number, the hash of its exact content, the three lines with the VAT at 20%, the amount in GBP and the rate applied,
   and the Bridge route (`design-bank.md`, "What the document hash commits to"). The invoice's page shows the Proof
   block: payment id, document hash, transaction, block, time, and "Deposit through Bridge: £37,488.00 received,
   49,235.06 USDC to Treasury at 1.3134".
4. **Meridian** pays differently: it is on Capxul, so its invoice (ACC-SINV-2026-00068, $38,400.00, billed from USD
   timesheets into USDC) is paid from its own Safe, and the payment shows on its deal's and company's CRM timeline as
   well (see [the timeline](#the-activity-timeline-and-its-tabs)).

The invoice's own screens belong to the accounting module; projects links to them from Connections and the Costing tab.

## Activity Type

Source: `pj:doctype/activity_type/activity_type.json`. Named by its title. List and form: Activity Type\*, Default
Costing Rate | Default Billing Rate, Disabled.

| Activity Type | Default Costing Rate | Default Billing Rate | Disabled |
|---|---|---|---|
| Design | 58.00 | 120.00 | |
| Engineering | 62.00 | 130.00 | |
| Planning | 60.00 | 110.00 | |
| Research | 55.00 | 110.00 | |
| Communication | 50.00 | 95.00 | |
| Proposal Writing | 50.00 | 0.00 | |
| Execution | 55.00 | 115.00 | ✓ (unused since June 2025) |

**Capxul.** The same. Commands: `capxul org projects activity-type list` (`.projects.activityTypes.list`);
`org projects activity-type add Design --costing-rate 58 --billing-rate 120`; `org projects activity-type change
Engineering --billing-rate 135` (logs already made keep their rates); `org projects activity-type disable Execution`,
`enable`.

## Activity Cost

Source: `pj:doctype/activity_cost/activity_cost.json`. Named `PROJ-ACC-.#####`, titled "Engineering for Ellis Hart".
Form: Activity Type\*, Employee | Employee Name, Department; Billing Rate | Costing Rate. List filters: Activity Type,
Employee. A timesheet log takes the employee's Activity Cost for its activity first, else the Activity Type's defaults.

| ID | Activity Type | Employee | Billing Rate | Costing Rate |
|---|---|---|---|---|
| PROJ-ACC-00004 | Engineering | Ellis Hart | 130.00 | 68.00 |
| PROJ-ACC-00006 | Design | Lena Fischer | 120.00 | 64.00 |

**Capxul.** Not booked: Activity Cost is the second of the computed gaps (`--employee` on `org projects activity-type`,
`surface.computed-gaps`, for Aaron). The mock-up leaves it out of the sidebar and costs every log at the activity
type's default rate, as the examples above do. If Aaron books it, the screen is as Frappe's, with the command
`org projects activity-type change Engineering --employee HR-EMP-00007 --costing-rate 68`.

## Project Type

Source: `pj:doctype/project_type/project_type.json`. Named by its title: Project Type\*, Description. Start-up makes
Internal, External and Other (`projects.startup`).

**Capxul.** The same list and form. `capxul org projects project-type list`; `org projects project-type add Retainer
--description "Monthly support after launch"`.

## Projects Settings

Source: `pj:doctype/projects_settings/projects_settings.json`. A single form with one section, Timesheets: Ignore User
Time Overlap, Ignore Employee Time Overlap, Fetch Timesheet in Sales Invoice (all off).

**Capxul.** Labelled **Projects options**, route `projects-config`. `capxul org projects settings show`; `org projects
settings set --allow-user-overlap --no-allow-employee-overlap --fetch-timesheets` (each check maps to its flag;
"Ignore … Overlap" is "allow … overlap").

## Report: Project Summary

Source: `pj:report/project_summary/*`. Filters: Company, Is Active, Status, Project Type. A stacked bar chart per
project (Overdue in red, Completed in light blue, Total Tasks in blue), four summary figures (Average Completion, Total
Tasks, Completed Tasks, Overdue Tasks), then the grid:

| Project | Project Name | Type | Status | Total Tasks | Tasks Completed | Tasks Overdue | Completion | Start Date | End Date |
|---|---|---|---|---|---|---|---|---|---|
| PROJ-0011 | Larkspur ordering app | External | Open | 22 | 9 | 1 | 41 | 06-04-2026 | 29-01-2027 |
| PROJ-0012 | Meridian design system | External | Open | 31 | 20 | 0 | 64 | 18-05-2026 | 18-12-2026 |
| PROJ-0013 | Studio tooling and templates | Other | Open | 10 | 2 | 0 | 20 | 01-09-2026 | 31-03-2027 |

Summary (status Open): Average Completion 41.7%, Total Tasks 63, Completed Tasks 31, Overdue Tasks 1.

**Capxul.** The same report, Company and Is Active filters dropped. Strip: `capxul org projects list --status open`
(each project's totals and percent come with it).

## Report: Timesheet Billing Summary (the Project Billing Summary)

Source: `pj:report/timesheet_billing_summary/*`. ERPNext's older "Project Billing Summary" and "Employee Billing
Summary" are this one report grouped by Project or by Employee (`erpnext/config/projects.py:94` still lists the old
name). A tree report. Filters: Employee, Project, From Date (default the first of last month), To Date (the last of last
month), Group By (Employee, Project, Start Date), Include Timesheets in Draft Status. Columns: Date, Project, Employee
ID, Employee Name, Timesheet, Working Hours, Billing Hours, Billing Amount. Summary: Total Working Hours, Total Billing
Hours, Total Billing Amount.

October 2026, grouped by Project:

| Project | Employee Name | Timesheet | Working Hours | Billing Hours | Billing Amount |
|---|---|---|---|---|---|
| **PROJ-0011** | | | **262.0** | **248.0** | **£31,240.00** |
| | Ellis Hart | TS-2026-00851 … | 150.0 | 142.0 | £18,250.00 |
| | Lena Fischer | TS-2026-00848 … | 76.0 | 72.0 | £8,640.00 |
| | Jamal Osei | TS-2026-00850 … | 36.0 | 34.0 | £4,350.00 |
| **PROJ-0012** | | | **318.0** | **310.0** | **$38,400.00** |
| **PROJ-0013** | | | **44.0** | **0.0** | **£0.00** |

**Capxul.** The same report and filters. Strip: `capxul org projects timesheet list --project PROJ-0011 --status
billed` (the report's rows are the logs of those timesheets). Amounts in a USD project show in USD.

## Report: Daily Timesheet Summary

Source: `pj:report/daily_timesheet_summary/*`. Filters: From Date and To Date (both today by default). Columns:
Timesheet, Employee, Employee Name, From Datetime, To Datetime, Hours, Activity Type, Task, Project, Status. Example for
6 November: TS-2026-00877, HR-EMP-00007, Ellis Hart, 06-11-2026 09:00, 06-11-2026 16:30, 7.5, Engineering, API
integration with Square POS, PROJ-0011, Submitted.

**Capxul.** The same. Strip: `capxul org projects timesheet list --status submitted`, with the day's logs read from
each timesheet (`timesheet list` has no date filter; its `--after` is a page cursor).

## Report: Delayed Tasks Summary

Source: `pj:report/delayed_tasks_summary/*`. Filters: Project, From Date, To Date, Priority (Low, Medium, High, Urgent),
Status (Open, Working, Pending Review, Overdue, Completed). A percentage bar: On Track (green, #84D5BA) against Delayed
(red, #CB4B5F). Columns: Task, Subject, Project, Status, Priority, Progress (%), Expected Start Date, Expected End
Date, Actual End Date, Delay (In Days), the delay coloured red.

| Task | Subject | Project | Status | Priority | Progress (%) | Expected End Date | Actual End Date | Delay (In Days) |
|---|---|---|---|---|---|---|---|---|
| TASK-2026-00420 | API integration with Square POS | PROJ-0011 | Overdue | High | 80 | 06-11-2026 | | 3 |
| TASK-2026-00366 | Component audit | PROJ-0012 | Completed | Medium | 100 | 12-06-2026 | 19-06-2026 | 7 |

**Capxul.** The same. Strip: `capxul org projects task list --status overdue`.

## The FDE in CRM and projects

Anyone can ask the FDE; it acts with the asker's Seat and hats, and drafts what it may not run for them
(`aaron.fde-anyone`, `organizations.fde-for-the-asker`). Examples for the modules' FDE panel (answers scripted in the
mock-up):

| Asker | Ask | The FDE does | It drafts for the person |
|---|---|---|---|
| Sam Whitfield (Seat, no hat) | "I just called Rohan at Parcelpoint, 20 minutes, he wants a proposal. Update the lead." | Reads the lead; says Sam may not write to the CRM without the People hat, and that Nadia Brooks or Kwame Mensah can | `capxul org crm call log CRM-LEAD-2026-00134 --type outgoing --status completed --start 2026-11-09T09:40 --duration 1200 --note "Wants a proposal for the courier app redesign"` and `capxul org crm lead move CRM-LEAD-2026-00134 Contacted`, for Nadia to run |
| Nadia Brooks (People) | "Convert Parcelpoint and open a deal at 55k, closing end of January" | Runs `org crm lead convert CRM-LEAD-2026-00134 --value 55000 --expected-value 55000 --currency GBP --close-by 2027-01-29` as Nadia; reports CRM-DEAL-2026-00038 | nothing |
| Nadia Brooks | "Nudge Aisha about the proposal" | Reads the deal's timeline and writes the reply | `capxul org crm email send CRM-DEAL-2026-00031 --in-reply-to <communication> --body-file nudge.md --confirm`, for Nadia to answer the preview (a send refuses the FDE's own call) |
| Maya Okafor (Director) | "What will close this month?" | Reads `org crm deal list --stage ongoing` | nothing; answers "Fernhill v3 retainer £60,000 at 90%, closing 20 Nov; Meridian $142,000 at 70%, closing 28 Nov; weighted £129,700" |
| Maya Okafor (Invoicing) | "Bill Larkspur for October" | Reads the billable, unbilled logs of PROJ-0011's October timesheets (248.0 h, £31,240.00 net) | `capxul org projects timesheet bill TS-2026-00848 TS-2026-00850 TS-2026-00851 … --to accounts@larkspurcoffee.co.uk`, for Maya to run |
| Ellis Hart (Seat, no hat) | "Log my week on Larkspur: Square integration Monday to Wednesday, iOS shell Thursday" | Runs `org projects timesheet create --project PROJ-0011` and seven `org projects timesheet log …` as Ellis, his own time | `capxul org projects timesheet submit TS-2026-00877`, for Ellis to check and run |
| Grace Adeyemi (People) | "Is Larkspur on track for the beta?" | Reads PROJ-0011's tasks and timesheets | nothing; answers "One task overdue (Square integration, 3 days); Loyalty stamps blocked by Checkout; Android shell unassigned; 62% of expected hours used at 41% complete" |
| Nadia Brooks (Growth hat) | "Pay Ian his referral fee for Kestrel, 1,900" | Prepares the department payment from the Growth budget | `capxul org department pay growth --to ian@pryce.consulting --amount 1900 --document referral-kestrel.pdf --kind one-off`, for Nadia to approve; Ian has no account, so it waits in escrow for him to claim with `payment claim` |

The FDE's own commands: `capxul org fde ask "…"`, `org fde show`, `org fde turn get <turn>`.

## Routes and commands for the two modules

Suggested hash routes for `app/js/crm.js` and `app/js/projects.js` (plain names; a record's id follows as the shell's
router decides). None uses a forbidden word: Projects Settings is `projects-config`, and no route starts with
`comment-`.

| Route | Screen | Command on the strip |
|---|---|---|
| `crm` | CRM dashboard | `capxul org crm deal list --stage ongoing` |
| `leads`, `leads-kanban`, `leads-grouped` | Leads: list, kanban, group by | `org crm lead list --stage open` |
| `lead` | Lead page (tabs and side panel) | `org crm lead get <lead>`, `org crm timeline <lead>` |
| `deals`, `deals-kanban`, `deals-grouped` | Deals: list, kanban, group by | `org crm deal list --stage ongoing` |
| `deal` | Deal page | `org crm deal get <deal>`, `org crm timeline <deal>` |
| `contacts`, `contact` | Contacts list and page | `contact list --org harbourline`, `contact get <contact> --org harbourline` |
| `companies`, `company` | Companies (CRM Organizations) list and page | `contact list --org harbourline`, `org crm deal list --company <company>` |
| `crm-notes` | Notes | `org crm timeline <record> --kind note` |
| `crm-tasks`, `crm-tasks-kanban` | CRM tasks | `org crm task list --stage open --stage working` |
| `call-logs` | Call logs | `org crm timeline <record> --kind call` |
| `projects-home` | Projects workspace | `org projects list --status open` |
| `projects`, `project` | Project list and form (with its nine tabs) | `org projects list`, `org projects get <project>` |
| `tasks`, `tasks-kanban`, `tasks-gantt`, `tasks-tree`, `task` | Project tasks: list, kanban, Gantt, tree, form | `org projects task list --project <project>`, `org projects task get <task>` |
| `timesheets`, `timesheet` | Timesheets | `org projects timesheet list`, `org projects timesheet get <timesheet>` |
| `activity-types`, `activity-type` | Activity types | `org projects activity-type list` |
| `project-types` | Project types | `org projects project-type list` |
| `projects-config` | Projects options | `org projects settings show` |
| `project-summary` | Report: Project Summary | `org projects list --status open` |
| `timesheet-billing` | Report: Timesheet Billing Summary | `org projects timesheet list --project <project> --status billed` |
| `daily-timesheets` | Report: Daily Timesheet Summary | `org projects timesheet list --status submitted` |
| `delayed-tasks` | Report: Delayed Tasks Summary | `org projects task list --status overdue` |

## Left out, and conflicts to flag

**Left out of the mock-up, because Capxul does not keep them or has no command for them:**

- CRM: SLAs and their section, columns and statuses; Communication Status; lead score and temperature; domain
  enrichment ("Enrich from website") and social-link fields (LinkedIn, X, Facebook); Products and Quotations on the
  deal (CRM Product is `surface.computed-gaps` item 3); telephony (Make a Call, recordings; Twilio, Exotel); Import,
  Export, Clear Demo Data, Customize Quick Filters, Edit Fields Layout; Delete on any CRM record; Salutation, Gender and
  Address on contacts; the Lead Syncing (Facebook) and Sales Hierarchy features; Email Templates; the calendar.
- Projects: Project Template, Project Update and Progress updates, Task Type, Issue, Is Template and the Template
  status, Color, Is Active, Activity Cost (`surface.computed-gaps` item 2), Duplicate Project with Tasks, Update Costing
  and Billing, website users and welcome emails, Project wise Stock Tracking, the Material, Manufacture and Issue
  connections, Amend on timesheets, and Create Salary Slip from timesheets (`payroll.timesheet-pay`, deferred).

**Conflicts for the orchestrator.**

1. **Comments and Attachments.** Frappe CRM's Comments tab and its Comment composer have no Capxul command (only notes
   are booked), and attachments are named, not kept (`contacts.attachments-later`, accepted). The mock-up drops both tabs
   and shows an email's attachments by name. If Aaron wants comments, they need `org crm comment add`.
2. **Selling needs the People hat.** CRM writes, sends and conversions need the People hat
   (`aaron.contacts-permissions`, `contacts.crm-permission`), which also governs seats, invitations and HR records. So a
   business-development manager without it (Sam Whitfield) can read and own leads but move none, and the Growth Lead
   wears People to do her job. `crm.md` leaves "a sales permission apart from the People hat" undecided; the mock-up
   shows the rule as booked and lets the FDE draft for a People-hat wearer.
3. **Managing projects also needs People or a Director** (`projects.permissions`), so the Delivery Lead wears People
   too. Three People wearers (Kwame, Nadia, Grace) is the cost; the data step may choose another cast, but must keep the
   rule. Note that a founder who wears a department hat may not also wear People (`authority.md`, contradiction 9), so
   Maya does not.
4. **Time for people with no Seat.** Fifteen of 25 people have no Seat, and Capxul has no self-side timesheet command
   (HR has `hr attendance checkin`; projects has nothing like `hr timesheet log`). Their time is logged for them with
   `--for`, which only People or a Director may do. The mock-up shows Hannah Cole's timesheets "by Grace Adeyemi".
   Aaron may want a self-side timesheet command.
5. **Project task assignment has no command.** ERPNext assigns tasks with Assign To (ToDo), and the Overview's
   "Unassigned" and "Open Tasks by Assignee" depend on it, but `org projects task create|change` has no assignee flag,
   nor flags for % Progress, Color or Task Description. The mock-up shows assignees and progress as data and offers no
   Assign or progress-drag action; booking `--assign <member>`, `--progress` and `--description` would close it.
6. **Field changes on the timeline.** Frappe keeps every field change and shows it ("changed Status from … to …"), and
   the brief asks for status changes on the timeline, but the booked `org crm timeline` leaves field changes out
   (`contacts.timeline`, written before `aaron.frappe-native` put the real Frappe site under the CRM). The mock-up
   shows Frappe's lines; the timeline command's `--kind record` would need to include them.
7. **Billing in pounds.** `org projects timesheet bill` asks in the token of the timesheets' currency, and refuses a
   currency with no admitted token (`requests.bill-time-currency`). Harbourline's company currency is GBP and its UK
   customers are invoiced in GBP and pay through Bridge. The mock-up shows GBP invoices paid by bank transfer through
   Bridge into USDC, as the accounting design's P4 and P10 describe; the data step and the accounting research must say
   which rule they follow (a GBP token admitted by the deployment, or the invoice in GBP with the request in USDC at the
   rate on the advice) and keep it everywhere.
8. **Reports and the dashboard have no command.** Running Frappe's reports from the CLI is only the proposed
   `org head report run` (`command-surface.md` 7.4), which is not booked and carries the word "head". The mock-up's
   report and dashboard strips show the list commands their rows come from, never `org head`.
9. **Kanban moves with no verb.** Frappe lets a task card move from Working back to Open, and a CRM deal or lead to any
   status. Capxul's task verbs have no "stop" (a task goes back to Open only when its last timesheet is cancelled), so
   that drop is refused in the mock-up with a toast naming the verbs.
10. **One word, two things.** The CRM's Organization is relabelled Company, and both modules keep a "Tasks" list. The
    shell research should confirm that the global search and breadcrumbs say "CRM task" and "Project task" where both
    could appear.
11. **Desk sources.** The Frappe clone at `/tmp/frappe` holds no desk JavaScript; the desk Gantt view was read from
    `develop` on GitHub. The CRM is fully covered by `/tmp/crm`'s frontend.
