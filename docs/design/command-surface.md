# The command surface: one tree of logical groups

Status: designed 9 November 2026, book first, on Aaron's answer to question 48 (ninth batch): "The number was not the
issue. We need everything you can do on Frappe to be programmatic and accessible from our tooling. It's the logical
groupings."

This page is the whole command surface: all 380 operations (the 215 and the 165 beyond them), each with its command as
booked and as the tree spells it, in thirteen logical groups. It also answers whether everything Frappe can do is
reachable from Capxul's CLI and Core SDK, and what to do where it is not.

The records are the authority:

- `books/target/shared/surface.ts` holds the tree as data: `SURFACE_GROUPS` (the thirteen groups) and `SURFACE` (every
  operation once: its id and command as booked, its command in the tree, its group), and the nine decisions below.
- `node --experimental-strip-types tools/report-surface.ts` checks the book against `SURFACE`: every operation in exactly
  one row, and each row the book does not yet spell as the tree does listed as "to apply". With `--md` it prints
  section 6 of this page from the book.
- The grammar every command follows is [`new-commands.md`](new-commands.md) section 2, updated to match this page.

| Decision | What it decides | Status |
|---|---|---|
| `surface.tree` | The tree: scope, then group, then record, then verb; thirteen groups; 119 moves | For Aaron |
| `surface.hr-group` | HR is its own group: `hr` for your side, `org hr` for the Organization's | Carries out question 48 |
| `surface.hr-concept` | HR keeps its own group but stays in the payroll concept | For Aaron |
| `surface.payroll-group` | Payroll is its own group, and the 215's eleven agreement commands move into it | Carries out question 48 |
| `surface.projects-group` | `org projects`, a project taking its verbs on the group | Carries out question 48 |
| `surface.head-group` | The Frappe site is `org head`: its apps, DocTypes, documents and call log | Carries out question 48 |
| `surface.frappe-reach` | Native is what Capxul writes, money is what moves money: how every Frappe DocType is reached | For Aaron |
| `surface.head-methods` | Reports, next documents and prints: three additions to the document family | For Aaron |
| `surface.computed-gaps` | What Capxul computes stays native; its missing DocTypes become native commands | For Aaron |

Nothing here changes behaviour. 119 commands change spelling. Each of the 215 keeps its id, its claims and its
refusals (`system.frozen-behaviour`), and the eleven of them that move carry `surface.payroll-group`, which names each
old command, as `tools/check-frozen.ts` requires. A new operation's id is its command's words joined by dots
(`rules.new-operations`), so the 108 new commands that move take new ids (`leave.apply` becomes `hr.leave.apply`). This
page books no rename. Each owner applies its own (section 9).

## 1. The tree at a glance

| # | Group | Mirrors | Your side (no prefix) | The Organization's side (`org …`) | Commands |
|---|---|---|---|---|---|
| 1 | Who you are and sign-in | Capxul | `auth`, `whoami`, `use`, `config`, `account`, `referral`, `waitlist`, `verify` | | 22 |
| 2 | The CLI and the apps you build | Capxul | `schema`, `doctor`, `key` | | 6 |
| 3 | Your money | Capxul | `balance`, `address`, `payment`, `bank`, `request`, `inbox`, `service`, `document`, `activity` | (these act for the Organization you act as) | 40 |
| 4 | The Organization, its people and its departments | Capxul | `invite` | `org create\|list\|show\|me\|wait\|retry`, `org member`, `org invite`, `org seats`, `org department`, `org allowance` | 38 |
| 5 | Governance and equity | Capxul | `vote`, `invest`, `shares` | `org board`, `org director`, `org proposal`, `org vote`, `org equity`, `org round`, `org safe`, `org options`, `org exit`, `org cap-table` | 55 |
| 6 | Agents and the FDE | Capxul | `agent` | `org fde` | 15 |
| 7 | Books | ERPNext's Accounting | | `org books` | 16 |
| 8 | HR | Frappe HR's HR module | `hr` | `org hr` | 53 |
| 9 | Payroll | Frappe HR's Payroll module, and pay agreements | `payroll` | `org payroll` | 31 |
| 10 | CRM, and the contact book | Frappe CRM | `contact` | `org crm` (and `contact … --org`) | 34 |
| 11 | Projects | ERPNext's Projects | | `org projects` | 36 |
| 12 | The Frappe site (the head) | Frappe's framework | | `org head` | 18 |
| 13 | The devnet | Capxul | `dev` | | 16 |
| | **Total** | | | | **380** |

```
capxul
├── auth · whoami · use · config · account · referral · waitlist · verify     who you are and sign-in
├── schema · doctor · key                                                       the CLI and the apps you build
├── balance · address · payment · bank · request · inbox · service · document · activity      your money
├── invite                                                                      your invitations
├── vote · invest · shares                                                      your votes and equity
├── agent                                                                       your agents
├── hr        leave · attendance · expense-claim · advance                      your HR, at every employer
├── payroll   payslip · agreement                                               your pay, from every employer
├── contact                                                                     your book (the Organization's with --org)
├── dev                                                                         the devnet
└── org       (create · list · show · me · wait · retry)
    ├── member · invite · seats · department · allowance                        its people and departments
    ├── board · director · proposal · vote                                      its governance
    ├── equity · round · safe · options · exit · cap-table                      its equity
    ├── fde                                                                     its FDE
    ├── books     accounts · assets · facts · reports · export                  ERPNext Accounting
    ├── hr        employee · holiday · leave-type · leave · shift-type · attendance · expense-type · expense-claim · advance
    ├── payroll   component · structure · run · payslip · agreement             Frappe HR Payroll
    ├── crm       lead · deal · timeline · email · whatsapp · note · task · call            Frappe CRM
    ├── projects  (create · list · get · change · hold · resume · complete · reopen · cancel)
    │             member · settings · task · timesheet · activity-type · project-type       ERPNext Projects
    └── head      (connect · show · disconnect) app · doc · doctype · doc-call              the Frappe site
```

Commands start with 57 different words, down from 79 (each `org` noun counted as one). Each word belongs to exactly one
group. `capxul --help` prints the groups in this order, each as a section, and `capxul org --help` prints the
Organization's side of each.

## 2. How the tree reads

Every command reads `[org] <group or noun> [<noun>] <verb> <arguments>`.

1. **Scope** (G1, unchanged). `org` begins every command only an Organization has, and the command acts for the
   Organization that `--org` or `use org` names. A command without it acts as yourself, or for whoever you act as
   (`payment send` under `use org` pays from the Organization). A person's own records span every Organization and every
   employer (`hr leave list`, `payroll payslip list`); `--employer` filters them and `--org` never does.
2. **Group** (G2). Where a Frappe app holds the records, the group is a word, the app's: `org books`, `org hr`,
   `org payroll`, `org crm`, `org projects`, and `org head` for the Frappe site itself. Where a person has their own side
   of the same records, the same word without `org`: `hr`, `payroll`. Capxul's native areas keep the 215's nouns, which
   already say what they are (`payment`, `bank`, `org department`, `org round`). They are grouped as sections of the help
   and of the reference, not by another word.
3. **Record** (G2). Under a group, each record is its DocType's noun, singular and kebab-case (`leave-type`,
   `expense-claim`, `doc-call`), or the common word G2 already allows (`payslip` for Salary Slip, `leave`, `advance`). A
   group whose first record is the module's own takes that record's verbs directly, as `org` takes the Organization's:
   `org projects create` makes a Project.
4. **Verb** (G3, unchanged). No verb was added and no verb's meaning changed.
5. **Shallow.** No command has more than four words before its arguments, which is the 215's longest
   (`org books accounts add`, `org department holder add`).
6. **SDK** (G7). The SDK method is the command's words: `org` becomes `client.org(orgId)`, a group is a namespace, each
   noun is plural and camelCase, and the verb comes last. Your own side is under `client.me`. So `org hr leave approve` is
   `client.org(orgId).hr.leaves.approve`, `hr leave apply` is `client.me.hr.leaves.apply`, `org projects task create` is
   `client.org(orgId).projects.tasks.create`, `org head doc get` is `client.org(orgId).head.docs.get`, and
   `payroll agreement collect` is `client.me.payroll.agreements.collect`.

## 3. HR: its own group, with both sides placed the same way

`surface.hr-group`. HR is Frappe HR's HR module: the Employee and the records that hang off it. A record's two sides
share its noun, and `org` is the only difference between them.

| Record (Frappe DocType) | Your side: `hr <noun> …` | The Organization's side: `org hr <noun> …` |
|---|---|---|
| `employee` (Employee) | | `add`, `change`, `get`, `list`, `suspend`, `deactivate`, `reinstate`, `leave` |
| `holiday` (Holiday List) | | `add`, `remove`, `list` |
| `leave-type` (Leave Type) | | `add`, `change`, `list` |
| `leave` (Leave Application; Leave Allocation) | `apply`, `cancel`, `list`, `balance` | `approve`, `reject`, `list`, `allocate`, `unallocate`, `balance <employee>` |
| `shift-type` (Shift Type; Shift Assignment) | | `add`, `list`, `assign`, `unassign` |
| `attendance` (Attendance; Employee Checkin) | `checkin`, `list` | `mark`, `cancel`, `list` |
| `expense-type` (Expense Claim Type) | | `add`, `list` |
| `expense-claim` (Expense Claim) | `create`, `cancel`, `get`, `list` | `approve`, `reject`, `pay`, `cancel`, `get`, `list` |
| `advance` (Employee Advance) | `request`, `cancel`, `list` | `pay`, `reject`, `settle`, `get`, `list` |

- **Your side** makes your own record (`hr leave apply`, `hr expense-claim create`, `hr advance request`,
  `hr attendance checkin`), withdraws it while it is open (`cancel`), and reads yours from every employer (`list`, `get`,
  `balance`). A write with no record yet acts at the employer `--employer` names, or your only one. An Employee needs no
  Seat (`payroll.hr-self`).
- **The Organization's side** keeps the rules (`add`, `change`, `remove`), decides (`approve`, `reject`), pays and
  settles (`pay`, `settle`), marks and allocates (`mark`, `allocate`, `unallocate`), runs an Employee's lifecycle, and
  reads everyone's.
- **Who** is unchanged (`payroll.hr-approvers`): People keeps the records; a wearer of the Employee's department's hat,
  or one above it, or People, decides leave; Budget on the department's budget decides and pays claims and advances;
  nobody decides their own.

This is the 215's own pattern for a record with two sides: `agreement accept` and `org agreement offer`, `vote cast` and
`org vote create`, `invite accept` and `org invite list`.

**The concept** (`surface.hr-concept`, for Aaron). HR keeps its own command group but stays in the payroll concept, in
its own files, as `payroll.hr-in-payroll` has it. The concepts are transaction boundaries, and HR and pay share theirs:

- a run reads the period's attendance and leave in its own transaction;
- an advance is recovered by a slip's deduction and returned when that slip is submitted;
- an accepted agreement makes an Employee in its own transaction;
- one head sync pushes every HR and payroll DocType in one order.

Split, each of these would cross a concept through a door, and an agreement's Employee is no money fact, so P4 would
need a third exception. The build would gain nothing: its tasks are planned one operation at a time, and an `hr` concept
would pay claims and advances through payments, so it would sit between payments and payroll and lengthen the path. The
trigger to split is HR gaining native records off the path to a slip (recruitment, appraisal, onboarding).

## 4. Payroll, projects and the Frappe site

**Payroll** (`surface.payroll-group`) is Frappe HR's Payroll module and Capxul's pay agreements, which the book keeps
in that module's shape: an accepted agreement is an Employee with an assignment of the agreement structure, and each
collection is a submitted Salary Slip (`payroll.agreements-in-frappe-shape`, `payroll.collection-slips`). So the payee
reads an agreement's collections in `payroll payslip list` and collects in `payroll agreement collect`, in the same
group.

| Record | Your side: `payroll …` | The Organization's side: `org payroll …` |
|---|---|---|
| `component` (Salary Component) | | `add`, `change`, `list`, `disable`, `enable` |
| `structure` (Salary Structure; its Assignments) | | `create`, `cancel`, `assign`, `unassign`, `list` |
| `run` (Payroll Entry) | | `create`, `submit`, `pay`, `cancel`, `list`, `get` |
| `payslip` (Salary Slip) | `list`, `get` | `withhold`, `release` |
| `agreement` (a v4 Agreement) | `accept`, `collect`, `list`, `show` | `offer`, `change`, `pause`, `resume`, `end`, `withdraw`, `list` |

**Projects** (`surface.projects-group`) is ERPNext's Projects module. The Project takes its verbs on the group, as the
Organization takes its own on `org`, so no command repeats "projects project":

| Record | `org projects …` |
|---|---|
| Project | `create`, `list`, `get`, `change`, `hold`, `resume`, `complete`, `reopen`, `cancel` |
| `member` (Project User) | `add`, `remove` |
| `settings` (Projects Settings) | `show`, `set` |
| `task` (Task) | `create`, `list`, `get`, `change`, `start`, `review`, `complete`, `reopen`, `cancel` |
| `timesheet` (Timesheet) | `create`, `log`, `get`, `list`, `submit`, `cancel`, `bill` (requests') |
| `activity-type` (Activity Type) | `add`, `change`, `list`, `disable`, `enable` |
| `project-type` (Project Type) | `add`, `list` |

**The Frappe site** (`surface.head-group`) is `org head`. Frappe's framework is the site: its installed apps, DocTypes
and documents are the site's, and Capxul's word for the Organization's site is its head.

| Record | `org head …` |
|---|---|
| the head itself | `connect`, `show`, `disconnect` |
| `app` (Installed Applications) | `list`, `add`, `remove` |
| `doc` (any DocType's documents) | `list`, `get`, `create`, `change`, `submit`, `cancel`, `amend`, `apply`, `remove` |
| `doctype` (DocType) | `list`, `get` |
| `doc-call` (the family's log) | `list` |

**CRM and books** keep their groups as booked: `org crm` (Frappe CRM) and `org books` (ERPNext's Accounting). The
contact book stays `contact`, a person's own book or, with `--org`, the Organization's: it is the CRM's Contact
(`aaron.crm-frappe-shape`), but it is also every person's address book for paying people, so it keeps the 215's word
rather than moving under `crm`.

**Capxul's native areas** keep every command of the 215 where it is. Their nouns already name their area, and a word
over them (`org equity round create`, `money payment send`) would lengthen some 150 commands for no new grouping (the
options of `surface.tree`).

## 5. What moves

### 5.1 The eleven commands of the 215

Each keeps its id, its claims and its refusals. `surface.payroll-group` is the decision on each that names its old
command; its owner (payroll) renames it, and its SDK method follows its words.

| Operation (id kept) | Command as booked | Command in the tree | SDK method |
|---|---|---|---|
| `agreement.accept` | `agreement accept` | `payroll agreement accept` | `client.me.payroll.agreements.accept` |
| `agreement.collect` | `agreement collect` | `payroll agreement collect` | `client.me.payroll.agreements.collect` |
| `agreement.list` | `agreement list` | `payroll agreement list` | `client.me.payroll.agreements.list` |
| `agreement.show` | `agreement show` | `payroll agreement show` | `client.me.payroll.agreements.show` |
| `org.agreement.offer` | `org agreement offer` | `org payroll agreement offer` | `client.org(orgId).payroll.agreements.offer` |
| `org.agreement.change` | `org agreement change` | `org payroll agreement change` | `client.org(orgId).payroll.agreements.change` |
| `org.agreement.pause` | `org agreement pause` | `org payroll agreement pause` | `client.org(orgId).payroll.agreements.pause` |
| `org.agreement.resume` | `org agreement resume` | `org payroll agreement resume` | `client.org(orgId).payroll.agreements.resume` |
| `org.agreement.end` | `org agreement end` | `org payroll agreement end` | `client.org(orgId).payroll.agreements.end` |
| `org.agreement.withdraw` | `org agreement withdraw` | `org payroll agreement withdraw` | `client.org(orgId).payroll.agreements.withdraw` |
| `org.agreement.list` | `org agreement list` | `org payroll agreement list` | `client.org(orgId).payroll.agreements.list` |

### 5.2 The 108 new commands

Each takes the words below. Its id is its new words joined by dots, and its export name follows
(`operation_org_hr_leave_approve`).

| Booked as | In the tree | Commands | Owner | Decision |
|---|---|---|---|---|
| `org employee …` | `org hr employee …` | 8 | payroll | `surface.hr-group` |
| `org holiday …` | `org hr holiday …` | 3 | payroll | `surface.hr-group` |
| `org leave-type …` | `org hr leave-type …` | 3 | payroll | `surface.hr-group` |
| `org leave …` | `org hr leave …` | 6 | payroll | `surface.hr-group` |
| `leave …` | `hr leave …` | 4 | payroll | `surface.hr-group` |
| `org shift-type …` | `org hr shift-type …` | 4 | payroll | `surface.hr-group` |
| `attendance …` | `hr attendance …` | 2 | payroll | `surface.hr-group` |
| `org attendance …` | `org hr attendance …` | 3 | payroll | `surface.hr-group` |
| `org expense-type …` | `org hr expense-type …` | 2 | payroll | `surface.hr-group` |
| `expense-claim …` | `hr expense-claim …` | 4 | payroll | `surface.hr-group` |
| `org expense-claim …` | `org hr expense-claim …` | 6 | payroll | `surface.hr-group` |
| `advance …` | `hr advance …` | 3 | payroll | `surface.hr-group` |
| `org advance …` | `org hr advance …` | 5 | payroll | `surface.hr-group` |
| `payslip …` | `payroll payslip …` | 2 | payroll | `surface.payroll-group` |
| `org payslip …` | `org payroll payslip …` | 2 | payroll | `surface.payroll-group` |
| `org project …` | `org projects …` | 9 | projects | `surface.projects-group` |
| `org project member …` | `org projects member …` | 2 | projects | `surface.projects-group` |
| `org project settings …` | `org projects settings …` | 2 | projects | `surface.projects-group` |
| `org task …` | `org projects task …` | 9 | projects | `surface.projects-group` |
| `org timesheet …` | `org projects timesheet …` | 7 | projects (6), requests (`bill`) | `surface.projects-group` |
| `org activity-type …` | `org projects activity-type …` | 5 | projects | `surface.projects-group` |
| `org project-type …` | `org projects project-type …` | 2 | projects | `surface.projects-group` |
| `org app …` | `org head app …` | 3 | organizations | `surface.head-group` |
| `org doc …` | `org head doc …` | 9 | organizations | `surface.head-group` |
| `org doctype …` | `org head doctype …` | 2 | organizations | `surface.head-group` |
| `org doc-call …` | `org head doc-call …` | 1 | organizations | `surface.head-group` |

The rest of the 165 keep their words: `org payroll component|structure|run`, `org crm …`, `contact create|change|link`,
`org head connect|show|disconnect`, `org fde …`, `org seats …`, `payment claim` and `dev time set`.

The SDK methods follow (G7). Every HR method gains `.hr` (`client.org(orgId).hr.employees.add`,
`client.me.hr.leaves.apply`), payslips gain `.payroll` (`client.me.payroll.payslips.list`,
`client.org(orgId).payroll.payslips.withhold`), and the head's gain `.head` (`client.org(orgId).head.apps.list`,
`client.org(orgId).head.docs.get`, `client.org(orgId).head.doctypes.list`, `client.org(orgId).head.docCalls.list`).
Projects' Project, member and settings methods are unchanged (`client.org(orgId).projects.create`,
`client.org(orgId).projects.members.add`); its task, timesheet, activity-type and project-type methods gain `.projects`
(`client.org(orgId).projects.tasks.create`, `client.org(orgId).projects.timesheets.bill`). A flow's id is its method,
kebab-cased, without `(orgId)`, so each renamed flow's id changes with it (`client.org.employees.add` becomes
`client.org.hr.employees.add`).

## 6. Every command, by group

Generated from the book by `tools/report-surface.ts --md`. A command in bold moves. A new operation's id is shown as
it will be.

### Who you are and sign-in (22)

| Operation | Command as booked | Command in the tree | Owner |
|---|---|---|---|
| `account.retry` | `account retry` | `account retry` | accounts |
| `account.show` | `account show` | `account show` | accounts |
| `auth.list` | `auth list` | `auth list` | access |
| `auth.login` | `auth login` | `auth login` | accounts |
| `auth.logout` | `auth logout` | `auth logout` | access |
| `auth.switch` | `auth switch` | `auth switch` | access |
| `auth.verify` | `auth verify` | `auth verify` | accounts |
| `config.telemetry.off` | `config telemetry off` | `config telemetry off` | access |
| `config.telemetry.on` | `config telemetry on` | `config telemetry on` | access |
| `config.telemetry.status` | `config telemetry status` | `config telemetry status` | access |
| `referral.show` | `referral` | `referral` | accounts |
| `referral.invite` | `referral invite` | `referral invite` | accounts |
| `referral.list` | `referral list` | `referral list` | accounts |
| `use.env` | `use env` | `use env` | access |
| `use.org` | `use org` | `use org` | organizations |
| `use.personal` | `use personal` | `use personal` | access |
| `verify.start` | `verify start` | `verify start` | banking |
| `verify.status` | `verify status` | `verify status` | banking |
| `waitlist.invites.grant` | `waitlist invites grant` | `waitlist invites grant` | accounts |
| `waitlist.join` | `waitlist join` | `waitlist join` | accounts |
| `waitlist.status` | `waitlist status` | `waitlist status` | accounts |
| `whoami` | `whoami` | `whoami` | access |

### The CLI and the apps you build (6)

| Operation | Command as booked | Command in the tree | Owner |
|---|---|---|---|
| `doctor` | `doctor` | `doctor` | applications |
| `key.create` | `key create` | `key create` | applications |
| `key.list` | `key list` | `key list` | applications |
| `key.revoke` | `key revoke` | `key revoke` | applications |
| `key.rotate` | `key rotate` | `key rotate` | applications |
| `schema` | `schema` | `schema` | access |

### Your money (40)

| Operation | Command as booked | Command in the tree | Owner |
|---|---|---|---|
| `activity.annotate` | `activity annotate` | `activity annotate` | books |
| `activity.events` | `activity events` | `activity events` | activity |
| `activity.get` | `activity get` | `activity get` | activity |
| `activity.list` | `activity list` | `activity list` | activity |
| `activity.summary` | `activity summary` | `activity summary` | activity |
| `address` | `address` | `address` | activity |
| `balance` | `balance` | `balance` | activity |
| `bank.accounts` | `bank accounts` | `bank accounts` | banking |
| `bank.accounts.add` | `bank accounts add` | `bank accounts add` | banking |
| `bank.accounts.remove` | `bank accounts remove` | `bank accounts remove` | banking |
| `bank.deposits` | `bank deposits` | `bank deposits` | banking |
| `bank.details` | `bank details` | `bank details` | banking |
| `bank.match` | `bank match` | `bank match` | requests |
| `bank.pay` | `bank pay` | `bank pay` | banking |
| `bank.settle` | `bank settle` | `bank settle` | banking |
| `document.export` | `document export` | `document export` | documents |
| `document.get` | `document get` | `document get` | documents |
| `document.render` | `document render` | `document render` | documents |
| `document.verify` | `document verify` | `document verify` | documents |
| `inbox.decline` | `inbox decline` | `inbox decline` | requests |
| `inbox.get` | `inbox get` | `inbox get` | requests |
| `inbox.list` | `inbox list` | `inbox list` | requests |
| `inbox.pay` | `inbox pay` | `inbox pay` | requests |
| `payment.cancel` | `payment cancel` | `payment cancel` | payments |
| `payment.claim` (new) | `payment claim` | `payment claim` | payments |
| `payment.get` | `payment get` | `payment get` | payments |
| `payment.list` | `payment list` | `payment list` | payments |
| `payment.reschedule` | `payment reschedule` | `payment reschedule` | payments |
| `payment.retry` | `payment retry` | `payment retry` | payments |
| `payment.send` | `payment send` | `payment send` | payments |
| `payment.wait` | `payment wait` | `payment wait` | payments |
| `request.cancel` | `request cancel` | `request cancel` | requests |
| `request.get` | `request get` | `request get` | requests |
| `request.issue` | `request issue` | `request issue` | requests |
| `request.list` | `request list` | `request list` | requests |
| `service.create` | `service create` | `service create` | requests |
| `service.deactivate` | `service deactivate` | `service deactivate` | requests |
| `service.get` | `service get` | `service get` | requests |
| `service.list` | `service list` | `service list` | requests |
| `service.revise` | `service revise` | `service revise` | requests |

### The Organization, its people and its departments (38)

| Operation | Command as booked | Command in the tree | Owner |
|---|---|---|---|
| `invite.accept` | `invite accept` | `invite accept` | banking |
| `invite.decline` | `invite decline` | `invite decline` | organizations |
| `invite.list` | `invite list` | `invite list` | organizations |
| `org.allowance.assign` | `org allowance assign` | `org allowance assign` | budgets |
| `org.allowance.change` | `org allowance change` | `org allowance change` | budgets |
| `org.allowance.create` | `org allowance create` | `org allowance create` | budgets |
| `org.allowance.get` | `org allowance get` | `org allowance get` | budgets |
| `org.allowance.list` | `org allowance list` | `org allowance list` | budgets |
| `org.allowance.replace` | `org allowance replace` | `org allowance replace` | budgets |
| `org.allowance.revoke` | `org allowance revoke` | `org allowance revoke` | budgets |
| `org.create` | `org create` | `org create` | organizations |
| `org.department.budget.set` | `org department budget set` | `org department budget set` | budgets |
| `org.department.ceiling.freeze` | `org department ceiling freeze` | `org department ceiling freeze` | budgets |
| `org.department.ceiling.set` | `org department ceiling set` | `org department ceiling set` | budgets |
| `org.department.ceiling.unfreeze` | `org department ceiling unfreeze` | `org department ceiling unfreeze` | budgets |
| `org.department.close` | `org department close` | `org department close` | budgets |
| `org.department.create` | `org department create` | `org department create` | budgets |
| `org.department.holder.add` | `org department holder add` | `org department holder add` | budgets |
| `org.department.holder.remove` | `org department holder remove` | `org department holder remove` | budgets |
| `org.department.list` | `org department list` | `org department list` | budgets |
| `org.department.pay` | `org department pay` | `org department pay` | payments |
| `org.department.reopen` | `org department reopen` | `org department reopen` | budgets |
| `org.department.show` | `org department show` | `org department show` | budgets |
| `org.invite.cancel` | `org invite cancel` | `org invite cancel` | organizations |
| `org.invite.list` | `org invite list` | `org invite list` | organizations |
| `org.invite.resend` | `org invite resend` | `org invite resend` | organizations |
| `org.list` | `org list` | `org list` | organizations |
| `org.me` | `org me` | `org me` | organizations |
| `org.member.get` | `org member get` | `org member get` | organizations |
| `org.member.grant` | `org member grant` | `org member grant` | board |
| `org.member.invite` | `org member invite` | `org member invite` | budgets |
| `org.member.list` | `org member list` | `org member list` | organizations |
| `org.member.revoke` | `org member revoke` | `org member revoke` | board |
| `org.retry` | `org retry` | `org retry` | organizations |
| `org.seats.buy` (new) | `org seats buy` | `org seats buy` | payments |
| `org.seats.show` (new) | `org seats show` | `org seats show` | organizations |
| `org.show` | `org show` | `org show` | organizations |
| `org.wait` | `org wait` | `org wait` | organizations |

### Governance and equity (55)

| Operation | Command as booked | Command in the tree | Owner |
|---|---|---|---|
| `invest` | `invest` | `invest` | equity |
| `invest.commit` | `invest commit` | `invest commit` | equity |
| `invest.pay` | `invest pay` | `invest pay` | equity |
| `invest.show` | `invest show` | `invest show` | equity |
| `invest.sign` | `invest sign` | `invest sign` | equity |
| `org.board.claim` | `org board claim` | `org board claim` | board |
| `org.board.director.add` | `org board director add` | `org board director add` | board |
| `org.board.director.remove` | `org board director remove` | `org board director remove` | board |
| `org.board.handover` | `org board handover` | `org board handover` | board |
| `org.board.refresh` | `org board refresh` | `org board refresh` | board |
| `org.board.show` | `org board show` | `org board show` | board |
| `org.board.threshold` | `org board threshold` | `org board threshold` | board |
| `org.cap-table` | `org cap-table` | `org cap-table` | equity |
| `org.director.add` | `org director add` | `org director add` | board |
| `org.director.list` | `org director list` | `org director list` | board |
| `org.director.remove` | `org director remove` | `org director remove` | board |
| `org.director.replace` | `org director replace` | `org director replace` | board |
| `org.director.threshold` | `org director threshold` | `org director threshold` | board |
| `org.equity.issue` | `org equity issue` | `org equity issue` | equity |
| `org.equity.setup` | `org equity setup` | `org equity setup` | equity |
| `org.equity.transfer.approve` | `org equity transfer approve` | `org equity transfer approve` | equity |
| `org.exit.pay` | `org exit pay` | `org exit pay` | equity |
| `org.exit.preview` | `org exit preview` | `org exit preview` | equity |
| `org.options.end` | `org options end` | `org options end` | equity |
| `org.options.grant` | `org options grant` | `org options grant` | equity |
| `org.options.show` | `org options show` | `org options show` | equity |
| `org.proposal.approve` | `org proposal approve` | `org proposal approve` | board |
| `org.proposal.get` | `org proposal get` | `org proposal get` | board |
| `org.proposal.list` | `org proposal list` | `org proposal list` | board |
| `org.proposal.reject` | `org proposal reject` | `org proposal reject` | board |
| `org.proposal.wait` | `org proposal wait` | `org proposal wait` | board |
| `org.round.allocate` | `org round allocate` | `org round allocate` | equity |
| `org.round.cancel` | `org round cancel` | `org round cancel` | equity |
| `org.round.close` | `org round close` | `org round close` | equity |
| `org.round.create` | `org round create` | `org round create` | equity |
| `org.round.invite` | `org round invite` | `org round invite` | equity |
| `org.round.preview` | `org round preview` | `org round preview` | equity |
| `org.round.show` | `org round show` | `org round show` | equity |
| `org.safe.close` | `org safe close` | `org safe close` | equity |
| `org.safe.create` | `org safe create` | `org safe create` | equity |
| `org.safe.invite` | `org safe invite` | `org safe invite` | equity |
| `org.safe.show` | `org safe show` | `org safe show` | equity |
| `org.vote.create` | `org vote create` | `org vote create` | equity |
| `org.vote.execute` | `org vote execute` | `org vote execute` | equity |
| `org.vote.list` | `org vote list` | `org vote list` | equity |
| `org.vote.show` | `org vote show` | `org vote show` | equity |
| `org.vote.wait` | `org vote wait` | `org vote wait` | equity |
| `shares` | `shares` | `shares` | equity |
| `shares.accept` | `shares accept` | `shares accept` | equity |
| `shares.convert` | `shares convert` | `shares convert` | equity |
| `shares.exercise` | `shares exercise` | `shares exercise` | equity |
| `shares.sell` | `shares sell` | `shares sell` | equity |
| `vote.cast` | `vote cast` | `vote cast` | equity |
| `vote.delegate` | `vote delegate` | `vote delegate` | equity |
| `vote.list` | `vote list` | `vote list` | equity |

### Agents and the FDE (15)

| Operation | Command as booked | Command in the tree | Owner |
|---|---|---|---|
| `agent.create` | `agent create` | `agent create` | agents |
| `agent.freeze` | `agent freeze` | `agent freeze` | agents |
| `agent.key.rotate` | `agent key rotate` | `agent key rotate` | agents |
| `agent.list` | `agent list` | `agent list` | agents |
| `agent.remove` | `agent remove` | `agent remove` | agents |
| `agent.show` | `agent show` | `agent show` | agents |
| `agent.sweep` | `agent sweep` | `agent sweep` | agents |
| `agent.unfreeze` | `agent unfreeze` | `agent unfreeze` | agents |
| `org.fde.ask` (new) | `org fde ask` | `org fde ask` | organizations |
| `org.fde.guest.add` (new) | `org fde guest add` | `org fde guest add` | organizations |
| `org.fde.guest.list` (new) | `org fde guest list` | `org fde guest list` | organizations |
| `org.fde.guest.remove` (new) | `org fde guest remove` | `org fde guest remove` | organizations |
| `org.fde.pay` (new) | `org fde pay` | `org fde pay` | payments |
| `org.fde.show` (new) | `org fde show` | `org fde show` | organizations |
| `org.fde.turn.get` (new) | `org fde turn get` | `org fde turn get` | organizations |

### Books (ERPNext's Accounting) (16)

| Operation | Command as booked | Command in the tree | Owner |
|---|---|---|---|
| `org.books.accounts.add` | `org books accounts add` | `org books accounts add` | books |
| `org.books.accounts.archive` | `org books accounts archive` | `org books accounts archive` | books |
| `org.books.accounts.import` | `org books accounts import` | `org books accounts import` | books |
| `org.books.accounts.list` | `org books accounts list` | `org books accounts list` | books |
| `org.books.accounts.reclassify` | `org books accounts reclassify` | `org books accounts reclassify` | books |
| `org.books.accounts.rename` | `org books accounts rename` | `org books accounts rename` | books |
| `org.books.accounts.review` | `org books accounts review` | `org books accounts review` | books |
| `org.books.assets.add` | `org books assets add` | `org books assets add` | books |
| `org.books.assets.list` | `org books assets list` | `org books assets list` | books |
| `org.books.assets.remove` | `org books assets remove` | `org books assets remove` | books |
| `org.books.export.quickbooks` | `org books export quickbooks` | `org books export quickbooks` | books |
| `org.books.facts.list` | `org books facts list` | `org books facts list` | books |
| `org.books.reports.balance-sheet` | `org books reports balance-sheet` | `org books reports balance-sheet` | books |
| `org.books.reports.profit-and-loss` | `org books reports profit-and-loss` | `org books reports profit-and-loss` | books |
| `org.books.reports.reconcile` | `org books reports reconcile` | `org books reports reconcile` | books |
| `org.books.reports.trial-balance` | `org books reports trial-balance` | `org books reports trial-balance` | books |

### HR (Frappe HR's HR module) (53)

| Operation | Command as booked | Command in the tree | Owner |
|---|---|---|---|
| `hr.advance.cancel` (new) | `advance cancel` | **`hr advance cancel`** | payroll |
| `hr.advance.list` (new) | `advance list` | **`hr advance list`** | payroll |
| `hr.advance.request` (new) | `advance request` | **`hr advance request`** | payroll |
| `hr.attendance.checkin` (new) | `attendance checkin` | **`hr attendance checkin`** | payroll |
| `hr.attendance.list` (new) | `attendance list` | **`hr attendance list`** | payroll |
| `hr.expense-claim.cancel` (new) | `expense-claim cancel` | **`hr expense-claim cancel`** | payroll |
| `hr.expense-claim.create` (new) | `expense-claim create` | **`hr expense-claim create`** | payroll |
| `hr.expense-claim.get` (new) | `expense-claim get` | **`hr expense-claim get`** | payroll |
| `hr.expense-claim.list` (new) | `expense-claim list` | **`hr expense-claim list`** | payroll |
| `hr.leave.apply` (new) | `leave apply` | **`hr leave apply`** | payroll |
| `hr.leave.balance` (new) | `leave balance` | **`hr leave balance`** | payroll |
| `hr.leave.cancel` (new) | `leave cancel` | **`hr leave cancel`** | payroll |
| `hr.leave.list` (new) | `leave list` | **`hr leave list`** | payroll |
| `org.hr.advance.get` (new) | `org advance get` | **`org hr advance get`** | payroll |
| `org.hr.advance.list` (new) | `org advance list` | **`org hr advance list`** | payroll |
| `org.hr.advance.pay` (new) | `org advance pay` | **`org hr advance pay`** | payroll |
| `org.hr.advance.reject` (new) | `org advance reject` | **`org hr advance reject`** | payroll |
| `org.hr.advance.settle` (new) | `org advance settle` | **`org hr advance settle`** | payroll |
| `org.hr.attendance.cancel` (new) | `org attendance cancel` | **`org hr attendance cancel`** | payroll |
| `org.hr.attendance.list` (new) | `org attendance list` | **`org hr attendance list`** | payroll |
| `org.hr.attendance.mark` (new) | `org attendance mark` | **`org hr attendance mark`** | payroll |
| `org.hr.employee.add` (new) | `org employee add` | **`org hr employee add`** | payroll |
| `org.hr.employee.change` (new) | `org employee change` | **`org hr employee change`** | payroll |
| `org.hr.employee.deactivate` (new) | `org employee deactivate` | **`org hr employee deactivate`** | payroll |
| `org.hr.employee.get` (new) | `org employee get` | **`org hr employee get`** | payroll |
| `org.hr.employee.leave` (new) | `org employee leave` | **`org hr employee leave`** | payroll |
| `org.hr.employee.list` (new) | `org employee list` | **`org hr employee list`** | payroll |
| `org.hr.employee.reinstate` (new) | `org employee reinstate` | **`org hr employee reinstate`** | payroll |
| `org.hr.employee.suspend` (new) | `org employee suspend` | **`org hr employee suspend`** | payroll |
| `org.hr.expense-claim.approve` (new) | `org expense-claim approve` | **`org hr expense-claim approve`** | payroll |
| `org.hr.expense-claim.cancel` (new) | `org expense-claim cancel` | **`org hr expense-claim cancel`** | payroll |
| `org.hr.expense-claim.get` (new) | `org expense-claim get` | **`org hr expense-claim get`** | payroll |
| `org.hr.expense-claim.list` (new) | `org expense-claim list` | **`org hr expense-claim list`** | payroll |
| `org.hr.expense-claim.pay` (new) | `org expense-claim pay` | **`org hr expense-claim pay`** | payroll |
| `org.hr.expense-claim.reject` (new) | `org expense-claim reject` | **`org hr expense-claim reject`** | payroll |
| `org.hr.expense-type.add` (new) | `org expense-type add` | **`org hr expense-type add`** | payroll |
| `org.hr.expense-type.list` (new) | `org expense-type list` | **`org hr expense-type list`** | payroll |
| `org.hr.holiday.add` (new) | `org holiday add` | **`org hr holiday add`** | payroll |
| `org.hr.holiday.list` (new) | `org holiday list` | **`org hr holiday list`** | payroll |
| `org.hr.holiday.remove` (new) | `org holiday remove` | **`org hr holiday remove`** | payroll |
| `org.hr.leave.allocate` (new) | `org leave allocate` | **`org hr leave allocate`** | payroll |
| `org.hr.leave.approve` (new) | `org leave approve` | **`org hr leave approve`** | payroll |
| `org.hr.leave.balance` (new) | `org leave balance` | **`org hr leave balance`** | payroll |
| `org.hr.leave.list` (new) | `org leave list` | **`org hr leave list`** | payroll |
| `org.hr.leave.reject` (new) | `org leave reject` | **`org hr leave reject`** | payroll |
| `org.hr.leave.unallocate` (new) | `org leave unallocate` | **`org hr leave unallocate`** | payroll |
| `org.hr.leave-type.add` (new) | `org leave-type add` | **`org hr leave-type add`** | payroll |
| `org.hr.leave-type.change` (new) | `org leave-type change` | **`org hr leave-type change`** | payroll |
| `org.hr.leave-type.list` (new) | `org leave-type list` | **`org hr leave-type list`** | payroll |
| `org.hr.shift-type.add` (new) | `org shift-type add` | **`org hr shift-type add`** | payroll |
| `org.hr.shift-type.assign` (new) | `org shift-type assign` | **`org hr shift-type assign`** | payroll |
| `org.hr.shift-type.list` (new) | `org shift-type list` | **`org hr shift-type list`** | payroll |
| `org.hr.shift-type.unassign` (new) | `org shift-type unassign` | **`org hr shift-type unassign`** | payroll |

### Payroll (Frappe HR's Payroll module, and pay agreements) (31)

| Operation | Command as booked | Command in the tree | Owner |
|---|---|---|---|
| `org.agreement.change` | `org agreement change` | **`org payroll agreement change`** | payroll |
| `org.agreement.end` | `org agreement end` | **`org payroll agreement end`** | payroll |
| `org.agreement.list` | `org agreement list` | **`org payroll agreement list`** | payroll |
| `org.agreement.offer` | `org agreement offer` | **`org payroll agreement offer`** | payroll |
| `org.agreement.pause` | `org agreement pause` | **`org payroll agreement pause`** | payroll |
| `org.agreement.resume` | `org agreement resume` | **`org payroll agreement resume`** | payroll |
| `org.agreement.withdraw` | `org agreement withdraw` | **`org payroll agreement withdraw`** | payroll |
| `org.payroll.component.add` (new) | `org payroll component add` | `org payroll component add` | payroll |
| `org.payroll.component.change` (new) | `org payroll component change` | `org payroll component change` | payroll |
| `org.payroll.component.disable` (new) | `org payroll component disable` | `org payroll component disable` | payroll |
| `org.payroll.component.enable` (new) | `org payroll component enable` | `org payroll component enable` | payroll |
| `org.payroll.component.list` (new) | `org payroll component list` | `org payroll component list` | payroll |
| `org.payroll.payslip.release` (new) | `org payslip release` | **`org payroll payslip release`** | payroll |
| `org.payroll.payslip.withhold` (new) | `org payslip withhold` | **`org payroll payslip withhold`** | payroll |
| `org.payroll.run.cancel` (new) | `org payroll run cancel` | `org payroll run cancel` | payroll |
| `org.payroll.run.create` (new) | `org payroll run create` | `org payroll run create` | payroll |
| `org.payroll.run.get` (new) | `org payroll run get` | `org payroll run get` | payroll |
| `org.payroll.run.list` (new) | `org payroll run list` | `org payroll run list` | payroll |
| `org.payroll.run.pay` (new) | `org payroll run pay` | `org payroll run pay` | payroll |
| `org.payroll.run.submit` (new) | `org payroll run submit` | `org payroll run submit` | payroll |
| `org.payroll.structure.assign` (new) | `org payroll structure assign` | `org payroll structure assign` | payroll |
| `org.payroll.structure.cancel` (new) | `org payroll structure cancel` | `org payroll structure cancel` | payroll |
| `org.payroll.structure.create` (new) | `org payroll structure create` | `org payroll structure create` | payroll |
| `org.payroll.structure.list` (new) | `org payroll structure list` | `org payroll structure list` | payroll |
| `org.payroll.structure.unassign` (new) | `org payroll structure unassign` | `org payroll structure unassign` | payroll |
| `agreement.accept` | `agreement accept` | **`payroll agreement accept`** | payroll |
| `agreement.collect` | `agreement collect` | **`payroll agreement collect`** | payroll |
| `agreement.list` | `agreement list` | **`payroll agreement list`** | payroll |
| `agreement.show` | `agreement show` | **`payroll agreement show`** | payroll |
| `payroll.payslip.get` (new) | `payslip get` | **`payroll payslip get`** | payroll |
| `payroll.payslip.list` (new) | `payslip list` | **`payroll payslip list`** | payroll |

### CRM (Frappe CRM), and the contact book (34)

| Operation | Command as booked | Command in the tree | Owner |
|---|---|---|---|
| `contact.add` | `contact add` | `contact add` | contacts |
| `contact.bank.add` | `contact bank add` | `contact bank add` | banking |
| `contact.change` (new) | `contact change` | `contact change` | contacts |
| `contact.create` (new) | `contact create` | `contact create` | contacts |
| `contact.get` | `contact get` | `contact get` | banking |
| `contact.hide` | `contact hide` | `contact hide` | contacts |
| `contact.label` | `contact label` | `contact label` | contacts |
| `contact.link` (new) | `contact link` | `contact link` | contacts |
| `contact.list` | `contact list` | `contact list` | contacts |
| `contact.unhide` | `contact unhide` | `contact unhide` | contacts |
| `org.crm.call.log` (new) | `org crm call log` | `org crm call log` | contacts |
| `org.crm.deal.change` (new) | `org crm deal change` | `org crm deal change` | contacts |
| `org.crm.deal.create` (new) | `org crm deal create` | `org crm deal create` | contacts |
| `org.crm.deal.get` (new) | `org crm deal get` | `org crm deal get` | contacts |
| `org.crm.deal.list` (new) | `org crm deal list` | `org crm deal list` | contacts |
| `org.crm.deal.move` (new) | `org crm deal move` | `org crm deal move` | contacts |
| `org.crm.email.send` (new) | `org crm email send` | `org crm email send` | contacts |
| `org.crm.lead.change` (new) | `org crm lead change` | `org crm lead change` | contacts |
| `org.crm.lead.convert` (new) | `org crm lead convert` | `org crm lead convert` | contacts |
| `org.crm.lead.create` (new) | `org crm lead create` | `org crm lead create` | contacts |
| `org.crm.lead.get` (new) | `org crm lead get` | `org crm lead get` | contacts |
| `org.crm.lead.list` (new) | `org crm lead list` | `org crm lead list` | contacts |
| `org.crm.lead.move` (new) | `org crm lead move` | `org crm lead move` | contacts |
| `org.crm.note.add` (new) | `org crm note add` | `org crm note add` | contacts |
| `org.crm.note.change` (new) | `org crm note change` | `org crm note change` | contacts |
| `org.crm.task.change` (new) | `org crm task change` | `org crm task change` | contacts |
| `org.crm.task.create` (new) | `org crm task create` | `org crm task create` | contacts |
| `org.crm.task.list` (new) | `org crm task list` | `org crm task list` | contacts |
| `org.crm.task.move` (new) | `org crm task move` | `org crm task move` | contacts |
| `org.crm.timeline` (new) | `org crm timeline` | `org crm timeline` | contacts |
| `org.crm.whatsapp.connect` (new) | `org crm whatsapp connect` | `org crm whatsapp connect` | contacts |
| `org.crm.whatsapp.disconnect` (new) | `org crm whatsapp disconnect` | `org crm whatsapp disconnect` | contacts |
| `org.crm.whatsapp.send` (new) | `org crm whatsapp send` | `org crm whatsapp send` | contacts |
| `org.crm.whatsapp.show` (new) | `org crm whatsapp show` | `org crm whatsapp show` | contacts |

### Projects (ERPNext's Projects) (36)

| Operation | Command as booked | Command in the tree | Owner |
|---|---|---|---|
| `org.projects.activity-type.add` (new) | `org activity-type add` | **`org projects activity-type add`** | projects |
| `org.projects.activity-type.change` (new) | `org activity-type change` | **`org projects activity-type change`** | projects |
| `org.projects.activity-type.disable` (new) | `org activity-type disable` | **`org projects activity-type disable`** | projects |
| `org.projects.activity-type.enable` (new) | `org activity-type enable` | **`org projects activity-type enable`** | projects |
| `org.projects.activity-type.list` (new) | `org activity-type list` | **`org projects activity-type list`** | projects |
| `org.projects.cancel` (new) | `org project cancel` | **`org projects cancel`** | projects |
| `org.projects.change` (new) | `org project change` | **`org projects change`** | projects |
| `org.projects.complete` (new) | `org project complete` | **`org projects complete`** | projects |
| `org.projects.create` (new) | `org project create` | **`org projects create`** | projects |
| `org.projects.get` (new) | `org project get` | **`org projects get`** | projects |
| `org.projects.hold` (new) | `org project hold` | **`org projects hold`** | projects |
| `org.projects.list` (new) | `org project list` | **`org projects list`** | projects |
| `org.projects.member.add` (new) | `org project member add` | **`org projects member add`** | projects |
| `org.projects.member.remove` (new) | `org project member remove` | **`org projects member remove`** | projects |
| `org.projects.project-type.add` (new) | `org project-type add` | **`org projects project-type add`** | projects |
| `org.projects.project-type.list` (new) | `org project-type list` | **`org projects project-type list`** | projects |
| `org.projects.reopen` (new) | `org project reopen` | **`org projects reopen`** | projects |
| `org.projects.resume` (new) | `org project resume` | **`org projects resume`** | projects |
| `org.projects.settings.set` (new) | `org project settings set` | **`org projects settings set`** | projects |
| `org.projects.settings.show` (new) | `org project settings show` | **`org projects settings show`** | projects |
| `org.projects.task.cancel` (new) | `org task cancel` | **`org projects task cancel`** | projects |
| `org.projects.task.change` (new) | `org task change` | **`org projects task change`** | projects |
| `org.projects.task.complete` (new) | `org task complete` | **`org projects task complete`** | projects |
| `org.projects.task.create` (new) | `org task create` | **`org projects task create`** | projects |
| `org.projects.task.get` (new) | `org task get` | **`org projects task get`** | projects |
| `org.projects.task.list` (new) | `org task list` | **`org projects task list`** | projects |
| `org.projects.task.reopen` (new) | `org task reopen` | **`org projects task reopen`** | projects |
| `org.projects.task.review` (new) | `org task review` | **`org projects task review`** | projects |
| `org.projects.task.start` (new) | `org task start` | **`org projects task start`** | projects |
| `org.projects.timesheet.bill` (new) | `org timesheet bill` | **`org projects timesheet bill`** | requests |
| `org.projects.timesheet.cancel` (new) | `org timesheet cancel` | **`org projects timesheet cancel`** | projects |
| `org.projects.timesheet.create` (new) | `org timesheet create` | **`org projects timesheet create`** | projects |
| `org.projects.timesheet.get` (new) | `org timesheet get` | **`org projects timesheet get`** | projects |
| `org.projects.timesheet.list` (new) | `org timesheet list` | **`org projects timesheet list`** | projects |
| `org.projects.timesheet.log` (new) | `org timesheet log` | **`org projects timesheet log`** | projects |
| `org.projects.timesheet.submit` (new) | `org timesheet submit` | **`org projects timesheet submit`** | projects |

### The Frappe site (the head): apps, DocTypes, documents (18)

| Operation | Command as booked | Command in the tree | Owner |
|---|---|---|---|
| `org.head.app.add` (new) | `org app add` | **`org head app add`** | organizations |
| `org.head.app.list` (new) | `org app list` | **`org head app list`** | organizations |
| `org.head.app.remove` (new) | `org app remove` | **`org head app remove`** | organizations |
| `org.head.connect` (new) | `org head connect` | `org head connect` | organizations |
| `org.head.disconnect` (new) | `org head disconnect` | `org head disconnect` | organizations |
| `org.head.doc.amend` (new) | `org doc amend` | **`org head doc amend`** | organizations |
| `org.head.doc.apply` (new) | `org doc apply` | **`org head doc apply`** | organizations |
| `org.head.doc.cancel` (new) | `org doc cancel` | **`org head doc cancel`** | organizations |
| `org.head.doc.change` (new) | `org doc change` | **`org head doc change`** | organizations |
| `org.head.doc.create` (new) | `org doc create` | **`org head doc create`** | organizations |
| `org.head.doc.get` (new) | `org doc get` | **`org head doc get`** | organizations |
| `org.head.doc.list` (new) | `org doc list` | **`org head doc list`** | organizations |
| `org.head.doc.remove` (new) | `org doc remove` | **`org head doc remove`** | organizations |
| `org.head.doc.submit` (new) | `org doc submit` | **`org head doc submit`** | organizations |
| `org.head.doc-call.list` (new) | `org doc-call list` | **`org head doc-call list`** | organizations |
| `org.head.doctype.get` (new) | `org doctype get` | **`org head doctype get`** | organizations |
| `org.head.doctype.list` (new) | `org doctype list` | **`org head doctype list`** | organizations |
| `org.head.show` (new) | `org head show` | `org head show` | organizations |

### The devnet (16)

| Operation | Command as booked | Command in the tree | Owner |
|---|---|---|---|
| `dev.approve` | `dev approve` | `dev approve` | devnet |
| `dev.fund` | `dev fund` | `dev fund` | accounts |
| `dev.gates.set` | `dev gates set` | `dev gates set` | devnet |
| `dev.jobs.run` | `dev jobs run` | `dev jobs run` | devnet |
| `dev.key` | `dev key` | `dev key` | applications |
| `dev.mail.fail` | `dev mail fail` | `dev mail fail` | devnet |
| `dev.mail.list` | `dev mail list` | `dev mail list` | devnet |
| `dev.mail.notices` | `dev mail notices` | `dev mail notices` | devnet |
| `dev.prices.set` | `dev prices set` | `dev prices set` | devnet |
| `dev.snapshot.list` | `dev snapshot list` | `dev snapshot list` | devnet |
| `dev.snapshot.restore` | `dev snapshot restore` | `dev snapshot restore` | devnet |
| `dev.snapshot.save` | `dev snapshot save` | `dev snapshot save` | devnet |
| `dev.time` | `dev time` | `dev time` | devnet |
| `dev.time.set` (new) | `dev time set` | `dev time set` | devnet |
| `dev.time.start-at` | `dev time start-at` | `dev time start-at` | devnet |
| `dev.time.warp` | `dev time warp` | `dev time warp` | devnet |

## 7. Everything on Frappe, programmatically

### 7.1 How it was checked

Every DocType of the three Frappe apps Capxul holds in their shapes was read from the clones the book already cites:
`frappe/erpnext@6b946b0`, `frappe/hrms@8816102` and `frappe/crm@2cecd30`. That is 425 DocTypes, leaving out child
tables, which are reached only through their parents. Each was classed against the document family's guard as booked
(`organizations.doc-reach`: `FUNDAMENTAL_APPS`, `NATIVE_DOCTYPES`, `LEDGER_HOOKS` read from each app's `hooks.py`,
`LEDGER_UNHOOKED`, `HEAD_MACHINERY`). Frappe's framework is covered by module in 7.8, because its clone here is sparse.
The CLI and the Core SDK reach the same things, since each command is one SDK method (A4).

### 7.2 What reaches what today

| App, module | DocTypes | Native command | Through the family | Left out by design | Refused: native, but no command | Refused: money |
|---|---|---|---|---|---|---|
| erpnext Accounts | 92 | 15 | 0 | 8 | 69 | 0 |
| erpnext Projects | 10 | 6 | 0 | 0 | 4 | 0 |
| erpnext Setup | 28 | 4 | 24 | 0 | 0 | 0 |
| erpnext Selling | 12 | 1 | 10 | 0 | 0 | 1 |
| erpnext Buying | 10 | 1 | 7 | 0 | 0 | 2 |
| erpnext Stock | 45 | 0 | 39 | 0 | 0 | 6 |
| erpnext Assets | 14 | 0 | 9 | 0 | 0 | 5 |
| erpnext Subcontracting | 4 | 0 | 2 | 0 | 0 | 2 |
| erpnext Manufacturing | 19 | 0 | 19 | 0 | 0 | 0 |
| erpnext CRM, Support, Quality Management, Maintenance, Regional, Telephony, Utilities, EDI, Bulk Transaction, Communication, ERPNext Integrations | 48 | 0 | 48 | 0 | 0 | 0 |
| hrms HR | 79 | 11 | 67 | 0 | 0 | 1 |
| hrms Payroll | 25 | 6 | 0 | 1 | 18 | 0 |
| crm FCRM | 31 | 9 | 0 | 12 | 10 | 0 |
| crm Lead Syncing, Domain Enrichment | 8 | 0 | 8 | 0 | 0 | 0 |
| **Total** | **425** | **53** | **233** | **21** | **101** | **17** |

So **118 of Frappe's DocTypes are reachable from no Capxul tooling today**, only from the head's own desk. Most of them
(101) are refused not as money but as native: their module is native (ERPNext's Accounts, Payroll, Projects, FCRM), yet
no Capxul command writes them.

- **Native, no command (101).**
  - ERPNext Accounts (69): Sales Invoice and Purchase Invoice; Period Closing Voucher and Process Period Closing
    Voucher; Cost Center and Cost Center Allocation; Accounting Dimension and its filter; Finance Book; Financial Report
    Template; the tax masters (Sales and Purchase Taxes and Charges Template, Item Tax Template, Tax Category, Tax Rule,
    Tax Withholding Category and Group); Payment Term and Payment Terms Template; Pricing Rule, Promotional Scheme and
    Coupon Code; Shipping Rule; Loyalty Program and Loyalty Point Entry; Subscription, Subscription Plan, Subscription
    Settings and Process Subscription; Dunning and Dunning Type; Exchange Rate Revaluation; Opening Invoice Creation
    Tool; Journal Entry Template; Bank Guarantee; Bank, Bank Account Balance, Subtype and Type; Cheque Print Template;
    Monthly Distribution; Party Link; Account Category; POS Invoice, POS Opening Entry, POS Closing Entry, POS Invoice
    Merge Log, POS Profile and POS Settings; Payment Request, Payment Order, Payment Reconciliation, Process Payment
    Reconciliation and its log, Unreconcile Payment and Payment Gateway Account; Cashier Closing; Invoice Discounting;
    Repost Accounting Ledger and Repost Payment Ledger; Ledger Merge; Ledger Health and its monitor; Bisect Accounting
    Statements and Bisect Nodes; Account Closing Balance; Advance Payment Ledger Entry; Process Deferred Accounting;
    Process Statement Of Accounts. A manual Journal Entry is out of reach too: Journal Entry is native, and Capxul writes
    only its own (`books.closed-periods`: "Capxul has no operation that makes a Journal Entry").
  - Frappe HR Payroll (18): Employee Incentive, Retention Bonus, Arrear, Payroll Correction, Salary Withholding, Income
    Tax Slab, Payroll Period, Employee Tax Exemption Category, Sub Category, Declaration and Proof Submission, Employee
    Benefit Application, Claim and Ledger, Employee Other Income, Gratuity, Gratuity Rule, Bulk Salary Structure
    Assignment. Additional Salary is native for an advance's recovery only (`org hr advance settle`), so one-off pay is
    out of reach as well.
  - ERPNext Projects (4): Activity Cost, Project Template, Project Update, Task Type.
  - Frappe CRM (10): CRM Product, CRM Lead Source, CRM Territory, CRM Industry, CRM Service Level Agreement, CRM Holiday
    List, CRM Communication Status, CRM Availability Status, CRM Sales Hierarchy, CRM Event Reminder Log.
- **Money (17).** Sales Order; Purchase Order and Supplier Quotation; Delivery Note, Purchase Receipt, Stock Entry,
  Stock Reconciliation, Landed Cost Voucher and Repost Item Valuation; Asset, Asset Capitalization, Asset Depreciation
  Schedule, Asset Repair and Asset Value Adjustment; Subcontracting Order and Subcontracting Receipt; Leave Encashment.
- **Methods, not DocTypes.** The family reaches documents, not methods (`organizations.doc-family`), so three things
  every app does are out of reach: running a report (General Ledger, Accounts Receivable, Stock Balance, Salary
  Register), making the next document from one (Quotation to Sales Order to Delivery Note to Sales Invoice; Material
  Request to Purchase Order; Work Order to Stock Entry), and printing one.
- **Left out by design (21).** The bank set (Bank Transaction, Bank Clearance, the Reconciliation Tool, Statement
  Import, Transaction Rule: the bank is the chain), Accounting Period (`books.closed-periods`), the settings Capxul
  fixes (Accounts, Payroll, FCRM and CRM settings), Frappe CRM's own UI configuration (Form Script, Fields Layout, View
  Settings, Dashboard), its telephony (not booked) and its invitations and notifications (identity and channels are
  Capxul's).

What breaks as a result is whole chains, not single documents: a Quotation is reachable but its Sales Order is not; a
Work Order is reachable but the Stock Entry that makes its goods is not; a head's Sales Invoice, which a Capxul payment
settles, cannot be made from tooling at all.

### 7.3 The money question

`organizations.doc-reach` refuses stock, selling, buying and asset documents as money because ERPNext's ledger hooks
list them. **That leaves Frappe capabilities unreachable**: the 17 above, and the selling, buying, stock, asset and
subcontracting chains they sit in. The hooks are also a proxy, not a test of money:

- `accounting_dimension_doctypes` lists what carries accounting dimensions, not what posts. So the guard refuses
  documents that post nothing: Supplier Quotation, and Sales and Purchase Order, which only take advances.
- It lists children whose parents it does not: Material Request Item and Request for Quotation Item, under Material
  Request and Request for Quotation. Whether those parents are reached is unclear.
- A head's invoice, delivery or depreciation posts in the head whether a person submits it in the desk or the family
  submits it for them, and books takes its GL lines either way, authored by the head (`books.head-vouchers`). Refusing it
  through the family changes where it is done, not whether it posts.

**Recommendation** (`surface.frappe-reach`, for Aaron): two narrower tests.

1. **Native is what Capxul writes.** That is what its commands write, and every DocType of a module whose figures
   Capxul computes (Payroll, Projects, FCRM). It is not the whole of ERPNext's Accounts: the Accounts DocTypes Capxul
   does not write are the head's to author, and books copies their vouchers, as it already does.
2. **Money is what moves money.**
   - Capxul freezes every Bank and Cash account on the head (`freeze_account`), each Safe's included, and sets the
     Company's `role_allowed_for_frozen_entries` to its own app user's role, which no hat grants. ERPNext's own check
     (`validate_frozen_account`, `gl_entry.py`) then refuses any line on one of those accounts from any other User, in
     the desk or through the family. Today only the Safes' accounts are frozen, so the desk itself is open to other bank and cash
     lines.
   - Payment Entry stays native (`payment`), and the family refuses, by name, the 20 documents whose job is to pay,
     receive, allocate or re-post money: Payment Request, Payment Order, Payment Reconciliation, Process Payment Reconciliation and its log,
     Unreconcile Payment, Payment Gateway Account, POS Invoice, POS Opening Entry, POS Closing Entry, POS Invoice Merge
     Log, Cashier Closing, Invoice Discounting, Repost Accounting Ledger, Repost Payment Ledger, Repost Item Valuation,
     Ledger Merge, Advance Payment Ledger Entry, Account Closing Balance and Transaction Deletion Record. As today,
     Lending's Loan Management is money whole. Leave Encashment and Gratuity stay refused until they are native
     commands (7.5).
   - Everything else is reached as the member's head User, submit and cancel included: invoices, orders, deliveries,
     receipts, stock entries, reconciliations, assets and depreciation, subcontracting, manual journals and closings.
3. **Money still moves only by Capxul's commands**, against the head's documents: `payment send`, `inbox pay`,
   `request issue`, `org department pay`. Capxul stays the one record of money moved.

After it: 351 of the 425 DocTypes are reached (53 natively, 298 through the family), 20 are refused as moving money,
21 are left out by design, and 33 wait for native commands with a plan (7.5).

The alternatives: keep the hook test and let the family keep drafts of money DocTypes, submit staying in the desk
(still not programmatic); make stock, selling, buying and assets native concepts (Capxul becoming the record of stock,
the largest scope, reaching nothing until built); or keep `organizations.doc-reach` as accepted. Because the
recommendation reverses Aaron's acceptance of question 43, `organizations.doc-reach` stays in force until he answers.

### 7.4 Reports, next documents and prints

`surface.head-methods`, for Aaron. Three additions to the family, each one rpc to the head's Capxul app, run as the
member's head User and logged in `org head doc-call list` (`organizations.doc-log`). They are proposed, not booked;
booking them is organizations', with claims, once Aaron agrees.

| Proposed command | Frappe | What it does |
|---|---|---|
| `org head report list [--module]` | Report | The reports the User may run. |
| `org head report run <Report> [--filter <field><op><value>]… [--after] [--limit]` | `frappe.desk.query_report.run` | Runs any report with the User's own permissions, read only, and pages its rows. |
| `org head doc create <DocType> --from <DocType> <name>` | each app's `make_*` mapper | Makes the next document from a source (a Sales Order from a Quotation), by the mapper the source's app declares for that pair, from an allowlist the Capxul app keeps. The draft is then checked by the family's guard like any other. |
| `org head doc render <DocType> <name> [--format <print format>] [--out <path>]` | `frappe.utils.print_format.download_pdf` | A document as a PDF, in a print format, as `document render` saves Capxul's own. |

Their verbs are G3's: `list`, `run` (as `dev jobs run`), `create`, and `render` (as `document render`). Files and
comments wait on `contacts.attachments-later`.

### 7.5 What Capxul computes

`surface.computed-gaps`, for Aaron. Capxul computes every slip, a timesheet's costs and a deal's figures, so those
modules stay native, and their 32 missing DocTypes become native commands, never family calls. A figure the family
wrote on the head would not be in what Capxul computes. The recommended order:

1. Additional Salary, for one-off earnings and deductions, which Frappe's Employee Incentive, Retention Bonus and
   Overtime Slip each make: `org payroll additional-salary create|cancel|list`.
2. Activity Cost, the per-employee rate a timesheet costs at: `--employee` on `org projects activity-type`.
3. CRM Product, on a deal.
4. The period, tax, benefit and gratuity DocTypes a country's payroll needs, as a customer needs them.

Leave Encashment and Gratuity are money and pay, so they are native commands too, in the same pack.

### 7.6 Holes in today's guard

These hold whatever Aaron answers. Each is its owner's (section 9).

- **Transaction Deletion Record** (ERPNext Setup) deletes every transaction of a Company. The family reaches it today:
  it is in no hook and not in `HEAD_MACHINERY`.
- **Sending through the head's own channels.** SMS Center (Selling), Email Digest (Setup), Newsletter and Auto Email
  Report (Frappe's email module) send through the head's own mail or SMS, which `aaron.world-clock` makes the world's.
  The family reaches each of them.
- **Head HR documents that write native records.** On submit, Attendance Request makes Attendance, Shift Request makes a
  Shift Assignment, Compensatory Leave Request, Leave Policy Assignment and Leave Adjustment change Leave Allocations and
  the leave ledger, and Overtime Slip makes an Additional Salary (read in `hrms@8816102`). The family reaches each of
  them, so a head can write a native record that `payroll.hr-head-sync` does not take in. Either the family refuses
  them, or the sync takes in what they write.
- **A hooked child under an unhooked parent** (Material Request Item, Request for Quotation Item). The guard should say
  whether the parent is reached. Under 7.3's recommendation the question goes away.

### 7.7 Frappe's other apps

The apps Capxul can ask a head to install (`HEAD_APPS`: Helpdesk, Insights, LMS, Wiki, Drive, Gameplan, Builder, Print
Designer, Lending, Education, Healthcare, Webshop, eCommerce Integrations) are reached through the family, Lending's Loan
Management excepted (money). Where such an app makes an ERPNext Accounts document (a Sales Invoice, say), that document
is refused as native until 7.3 is answered.

### 7.8 Frappe's framework

| Frappe module | Reached |
|---|---|
| Core (User, Role, File, Comment, Communication, Data Import, Report, Server Script) | Native: identity and channels are Capxul's. Files and comments are reachable from no tooling (`contacts.attachments-later`); reports by 7.4. |
| Desk (ToDo, Event, Note, Kanban Board, Dashboard, Tag) | Through the family. |
| Printing (Print Format, Letter Head) | Definitions through the family; rendering by 7.4. |
| Email (Email Template, Email Group, Newsletter, Auto Email Report) | Through the family, Email Account, Email Domain and Notification excepted (machinery). Newsletter and Auto Email Report are 7.6's channel hole. |
| Website (Web Page, Blog Post) | Through the family, Web Form and Website Script excepted (machinery). |
| Automation (Assignment Rule, Milestone Tracker) | Through the family, Auto Repeat excepted (machinery). |
| Contacts (Contact, Address; Salutation, Gender) | Contact and Address native (`contact`); the rest through the family. |
| Geo (Country, Currency) | Currency native (`org books assets`); Country through the family. |
| Custom, Workflow, Integrations | Machinery, refused by design: they change who may do what or what a DocType is, run code, or hold credentials (`organizations.doc-reach`). A document's Workflow step is `org head doc apply`. |

## 8. For Aaron

Each recommendation stands, and the book follows it, until he answers. The exception is question 52: it reverses his
acceptance of question 43, so `organizations.doc-reach` stays in force until he answers it. They continue the numbering
of `docs/decisions/open-for-aaron.md`.

| # | Question | Recommendation | Records |
|---|---|---|---|
| 50 | The command tree: thirteen groups; Frappe's apps as group words (`org hr`, `org payroll`, `org crm`, `org projects`, `org head`, beside `org books`), your own side as the same word without `org` (`hr`, `payroll`); Capxul's native areas keep the 215's nouns, grouped in the help; 119 commands move, among them the 215's eleven agreement commands into payroll? | Yes | `surface.tree`, `surface.payroll-group`, sections 1 to 6 |
| 51 | HR is its own group. Is it also its own concept? | No: it stays in the payroll concept, in its own files, until HR gains native records off the path to a slip | `surface.hr-concept`, `payroll.hr-in-payroll` |
| 52 | 118 of Frappe's 425 DocTypes are reachable from no Capxul tooling today, 101 of them because a native module is refused whole and 17 as money. Should native mean "what Capxul writes" and money "what moves money", with every Bank and Cash account on the head frozen to Capxul's app user? | Yes: 351 reached, 20 refused as moving money, 33 to native commands. It reverses question 43 | `surface.frappe-reach`, `organizations.doc-reach`, section 7.3 |
| 53 | Reports, next documents and prints: `org head report list\|run`, `org head doc create --from`, `org head doc render`? | Yes | `surface.head-methods`, section 7.4 |
| 54 | What Capxul computes but has no command for (32 DocTypes): which first? | Additional Salary (`org payroll additional-salary create\|cancel\|list`), then Activity Cost, then CRM Product | `surface.computed-gaps`, section 7.5 |

## 9. What each owner applies

The moves are spelling. Each owner applies them in its own folders, book first, and keeps 0 problems and 0 breaches.
`tools/report-surface.ts` lists every row still to apply.

- **payroll** (`books/target/payroll/`): 68 commands.
  - HR's 53 and payslips' 4 take their new words and ids, and the eleven agreement commands take their new words with
    `surface.payroll-group` on them.
  - Each renamed flow's id follows its SDK method (`client.org.employees.add` becomes `client.org.hr.employees.add`;
    `client.me.agreements.collect` becomes `client.me.payroll.agreements.collect`).
  - Each claim, refusal and decision that quotes a moved command, in operations.ts, decisions.ts, hr-decisions.ts,
    hr-data.ts, shapes.ts, hr-shapes.ts, flows.ts and the area files.
- **projects** (`books/target/projects/`): 35 commands, their ids and the text that quotes them. **requests**:
  `org timesheet bill` becomes `org projects timesheet bill` (id `org.projects.timesheet.bill`), and its flow
  `client.org.projects.timesheets.bill`.
- **organizations** (`books/target/organizations/`): 15 commands, their ids and the text that quotes them. Also:
  - `NATIVE_DOCTYPES` and `NATIVE_MODULE_COMMANDS` in data.ts name the commands a refusal points to: `org hr holiday`,
    `org hr leave`, `org projects`, `org projects task`, `org projects timesheet`, `org payroll`, `org hr employee` and
    the rest.
  - 7.6's holes: Transaction Deletion Record; SMS Center, Email Digest, Newsletter and Auto Email Report; the hooked
    children's parents.
  - 7.3 waits for Aaron.
- **devnet, notices and the other folders** that quote a moved command in a world, a notice or a decision (for
  example `devnet/worlds.ts`, `notices/payroll.ts`, `requests/issuing.ts`, `budgets/ceilings.ts`): the quoted words
  only.
- **The builder**:
  - `books/target/journeys.ts` quotes moved commands;
  - `docs/design/new-commands.md` section 5's tables keep the as-booked spellings until the owners apply, then take the
    tree's;
  - `docs/design/frappe/payroll.md`, `projects-and-startup.md`, `docs/mission/initializer.md`, `HANDOFF.md`;
  - questions 50 to 54 into `docs/decisions/open-for-aaron.md`;
  - a final `tools/report-surface.ts` with 0 still to apply.
- **payroll, for 7.6** (whatever Aaron answers): the head HR documents that write native records on submit, refused by
  the family or taken in by `payroll.hr-head-sync`.
- **devnet, for seasons**: a season's commands go under `dev season`. G3 has no `jump`, so a scheduled time jump is a
  warp, as `dev time warp` is, unless the seasons design says why it is not.
