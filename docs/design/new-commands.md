# New commands: one grammar for the capabilities beyond the 215

Status: designed 8 November 2026, book first, at Aaron's request: "What new commands do we need? Can we make
some sort of pack for this? Ideally this should be on the book; we shouldn't have these ad hoc decision packs."

This page is the one list of every new CLI command, in one grammar. The records are the authority. Each command
is booked as an operation record under `rules.new-operations` (CONVENTIONS rule 4a) by the concept that owns it,
on its pack's recommendation. The five pack decisions now recommend exactly the commands listed here:

- `projects.commands`
- `contacts.crm-capabilities`
- `payroll.hr-surface`
- `organizations.commands`
- `organizations.buy-seats`

Nothing here changes the 215. A new operation never stands in for one of them, and the grammar is checked
against them: no id, export name or command below collides with a frozen operation or its old command (checked
with a script on 8 November 2026: 90 commands, 0 collisions).

The rulings these commands serve, all in `books/target/shared/rulings.ts`:

- `aaron.projects`, `aaron.frappe-shape` and `aaron.crm-frappe-shape`: CRM, Projects and Frappe HR payroll are in
  every Organization.
- `aaron.frappe-head`: a head connects as a separate step.
- `aaron.fde-agent` and `aaron.fde-hosted`: every Organization has an FDE, hosted by Capxul and paid for.
- `aaron.buy-seats` and `aaron.test-prices`: a company buys seats; the prices are 10 USDC a seat and 20 USDC a
  month for the FDE.
- `aaron.escrow-general`: the recipient claims whenever they want.
- `aaron.departments`: who may spend.

## 1. The packs at a glance

| Pack (decision) | Booked by | Commands | Rulings it cites |
|---|---|---|---|
| `projects.commands` | projects | 35 | `aaron.projects`, `aaron.frappe-shape` |
| `contacts.crm-capabilities` | contacts | 14 | `aaron.crm-frappe-shape`, `aaron.frappe-shape` |
| `payroll.hr-surface` | payroll | 28 | `aaron.frappe-shape` |
| `organizations.commands` | organizations | 8 | `aaron.frappe-shape`, `aaron.frappe-head`, `aaron.fde-agent`, `aaron.fde-hosted` |
| `organizations.buy-seats` | organizations (`org seats show`); payments (`org seats buy`, `org fde pay`) | 3 | `aaron.buy-seats`, `aaron.fde-hosted`, `aaron.test-prices` |
| None of the five (section 6) | requests (`org timesheet bill`, pack `requests.bill-time`); payments (`payment claim`, a pack to add) | 2 | `aaron.projects`; `aaron.escrow-general` |
| **Total** | | **90** | |

## 2. The grammar

The 215 already have a grammar, applied unevenly. These rules take the form most of them use. Every new command
follows them, with no exception.

**G1. Scope.**

- A command on an Organization's records only begins with `org`. It acts for the Organization named by
  `--org <handle>`, or else the one `use org` chose, as every `org` command of the 215 does. Projects, the CRM's
  leads and deals, payroll, apps, the head, seats and the FDE are only an Organization's, so their commands begin
  with `org`.
- A command on the caller's own records, across every Organization, has no prefix: `payslip list`, as
  `agreement list`.
- A command on a book that is either a person's or an Organization's has no prefix and takes `--org` for the
  Organization's: `contact create`, as `contact add`.
- `--org` always means "act for this Organization". It is never a filter. A filter by Organization is its own
  flag: `payslip list --employer <handle>`.

**G2. Nouns.**

- A record kind is one singular, kebab-case noun, standing directly under `org`, as the 215's do (`org department`,
  `org member`, `org allowance`). It is named as Frappe names the DocType: `org project`, `org task`,
  `org timesheet`, `org activity-type`, `org project-type`, `org employee`, `org payslip` (Salary Slip).
- An app's word goes first only where the bare noun would not say what it is, as the 215's `org books accounts`
  does:
  - `org crm lead` and `org crm deal`: Frappe names these DocTypes "CRM Lead" and "CRM Deal", and "lead" and "deal"
    alone read as verbs.
  - `org payroll component`, `org payroll structure` and `org payroll run`: "component", "structure" and "run"
    alone name nothing.
- A record that belongs to another is a second noun, as `org department holder add` is: `org project member`,
  `org project settings`.
- A singleton the Organization has exactly one of keeps its own name, plural if that is its name, as `org books`
  is: `org head`, `org fde`, `org seats`.

**G3. Verbs.** Verbs come from a closed set, each with one meaning, and each is a verb the 215 already use.
`update` and `show <id>` are not used.

| Verb | Means | As in the 215 | New uses |
|---|---|---|---|
| `create` | Makes a new working document that has a lifecycle of its own | `org department create`, `service create` | project, task, timesheet, CRM lead and deal, payroll structure and run, a book entry (`contact create`) |
| `add` / `remove` | Puts a person, an app or a named setting into a list the Organization keeps, or takes it out | `contact add`, `org department holder add\|remove` | employee, project member, activity type, project type, salary component, app |
| `change` | Edits a record's fields, never its status | `org agreement change`, `org allowance change` | every record with fields |
| `set` | Sets a singleton's values | `org department budget set` | `org project settings set` |
| `list` | Lists, paged with `--after`, newest change first unless stated | `payment list`, `org member list` | every record kind |
| `get <id>` | Reads one record of a list | `payment get`, `contact get`, `org member get` | every record kind |
| `show` | Reads a singleton, with no id | `org show`, `org board show` | head, FDE, seats, project settings |
| A lifecycle verb | One transition of the record's state machine that a person takes, named as the machine names it | `org agreement pause\|resume`, `org department close\|reopen` | project `hold\|resume\|complete\|reopen\|cancel`; task `start\|review\|complete\|reopen\|cancel`; timesheet `submit\|cancel`; employee `suspend\|deactivate\|reinstate\|leave`; structure `cancel` |
| A domain verb | A step with no simpler name | `bank match`, `agreement collect` | `timesheet log`, `crm lead move\|convert`, `crm deal move`, `structure assign\|unassign`, `run submit\|pay`, `payslip withhold\|release`, `contact link`, `head connect\|disconnect`, `seats buy`, `fde pay\|ask`, `payment claim`, `timesheet bill` |

- An undoing verb is the 215's pair: `hide|unhide`, `freeze|unfreeze`, `add|remove`. So the new pairs are
  `hold|resume`, `complete|reopen`, `assign|unassign`, `disable|enable`, `withhold|release`, `suspend|reinstate`
  and `connect|disconnect`.
- A command whose rpc both creates and changes gets one command per verb. Each is its own SDK method over the one
  rpc, as `contact hide` and `contact unhide` are.

**G4. Who.** Who may run a command is always a hat, a Seat or the Board, never a named person
(`aaron.departments`). The terms used in section 5:

| Term | Means |
|---|---|
| Member | Any member of the Organization: an active Seat, a person's or an agent's (the FDE included). |
| People | A member whose Safe wears the Organization's People hat (`manage-people`). The founder wears it from setup. |
| People or Director | People, or a Director of the Organization (`projects.permissions`). |
| Invoicing | A member whose Safe wears the Invoicing hat (`issue-invoices`). |
| Director | A Director of the Organization, an owner of the company Safe. Never an agent (`board.no-agent-directors`). |
| Director or FDE | A Director, or the Organization's own agent: its FDE, the Seat whose use is `organization`. |
| Budget | Whoever `Budgets.authorised` admits on the budget the command spends: a wearer in good standing of its department's hat or of an ancestor's, as the chain reads it at that moment. The company Safe acts only through the Board. Authority follows the hat, so a person swapped out of a department loses it. |
| Self | The signed-in person or agent, for its own records only. |
| Worker | A timesheet's own worker, for their own time; People or Director, for anyone else's. |

- An agent is a member like any other and acts with the hats its Safe wears.
- The FDE starts with no hat (`agents.fde-authority`).
- No agent buys seats or pays for hosting: `org seats buy` and `org fde pay` need a person.

**G5. Arguments and flags.**

- The record a command acts on is a positional argument: its Capxul id, as `list` prints it.
- A member is an email, or an agent's `@handle`, as in `org member grant`.
- A Party is an email, an `@handle`, a `0x` address or a Party id, as in `contact add`. Examples are a customer,
  a person to employ, or the Party a contact links to.
- A book entry is its contact id, as `contact list` prints it.
- `--from <budget>` names the budget a command spends, and nothing else: a department's key or id, or an
  allowance's name or id, as in `payment send --from` and `org department pay`.
- Times:
  - A day is `--on <YYYY-MM-DD>`, a day in the Organization's time zone.
  - A period's bounds are `--start` and `--end`: days for a document's dates, ISO 8601 instants for a time log.
  - A review date is `--by <day>`. A forecast close is `--close-by <day>`.
- Amounts are decimal strings: in the Company's currency for projects and the CRM, and in the structure's token
  for payroll.
- A repeatable flag takes one value each time (`--depends-on <task> --depends-on <task>`), as the 215's
  repeatable flags do.
- A `change` command's flags set fields. `--clear <field>` empties one.
- Lists take `--after <cursor>` and `--limit <n>`.
- Money commands (`org payroll run pay`, `org seats buy`, `org fde pay`, `payment claim`) take `--request-key`,
  `--timeout-seconds` and `--no-wait`, as `payment send` does. The approval page is their confirmation.
- A command that cannot be undone, or that hands records to an outside system, previews what it will do and asks:
  `contact link`, `org employee leave`, `org head connect` and `org head disconnect`. `--confirm` answers yes in a
  script (`vocabulary.declined-preview-cancelled`).
- A secret is never a flag. `org head connect` reads the head user's API key and secret, and on Frappe Cloud the
  team's token, from a prompt or from `--key-file` and `--team-token-file`.

**G6. Refusals.** The same code is used for the same case as in the 215. There is no not-found code: an unknown
id is `INVALID_INPUT`, as in `payment get`.

| Code | When |
|---|---|
| `NOT_AUTHENTICATED` | Signed out. |
| `ROLE_PERMISSION_DENIED` | `--org` names an Organization the caller is not a member of, or the caller lacks the hat or role G4 names. |
| `INVALID_INPUT` | An id or locator that names nothing the caller may read, or a bad value, naming the field. Nothing is written. |
| `WRONG_STATE` | The record's status does not allow the step: a transition's `from` or its guard. The refusal names the status. |
| `CLI_USAGE` | A malformed id, a missing argument, or a script without `--confirm` or `--request-key` where the command needs one. |
| `CANCELLED` | The person answers no at a preview (exit 130). Nothing is written. |
| `FEATURE_NOT_AVAILABLE` | A price the deployment has not set (`SEAT_PRICE`, `FDE_HOSTING_PRICE`), or a token it does not sell in. |
| Money codes | As `payment send` and `org department pay` refuse: `INSUFFICIENT_BALANCE`, `AUTHORISED_EXCEEDED`, `TOKEN_NOT_BUDGETED`. |
| `PROVIDER_ERROR`, `PROVIDER_RESPONSE_INVALID`, `RATE_LIMITED` | The head's site or the FDE's host fails. |

**G7. SDK method and implementation.**

- The SDK method is the command's words:
  - `org` becomes `client.org(orgId)`;
  - each noun becomes its plural, in camelCase;
  - the verb comes last, in camelCase.

  So `org crm lead create` is `client.org(orgId).crm.leads.create` and `org activity-type add` is
  `client.org(orgId).activityTypes.add`.
- A caller's own records sit under `client.me` (`client.me.payslips.list`).
- A book is `client.account.addressBook`, as the 215's contact commands are.
- Payments are `client.payments`.
- The flow id is the method, kebab-cased, without `(orgId)`.
- Each command calls one SDK method, and each SDK method serves one command (A4, `components.cli`).
- A method that is one rpc call is implemented by that rpc. Otherwise it is one flow in the owning concept's
  `flows.ts`.
- An existing SDK-only flow that a command now calls adds `cli` to its `surfaces` and keeps its other surfaces
  (rule 4a).

**G8. Budget and priority.**

| Class | Used for |
|---|---|
| `read` | A list, a get or a show, which reads rows only. |
| `write` | One off-chain transaction. |
| `chain-submit` | A command that signs an approval and follows the chain: `org payroll run pay`, `org seats buy`, `org fde pay`, `payment claim`. |
| `vendor` | A command that calls an outside system before it answers: `org head connect` reads the site; `org fde ask` waits on the host. |

Every new command is `normal` priority. No B3 pilot runs one, and `org create` finishes without any.

**G9. Output.**

- `--json` prints the record as `get` prints it, after the change.
- A list prints a page of records and the cursor for the next page, as the 215's lists do.
- A money command prints its outcome as `payment send` does.

**G10. Booking** (`rules.new-operations`).

- The id is the command's words joined by dots.
- `area` is an old area where the 215 put the noun: `contact` and `payment` are `payments`, and payroll is
  `payroll`. Otherwise it is the owning concept's id: `projects`, `contacts`, `organizations`.
- Each operation is in its pack decision's `affects`, and the pack cites its ruling.
- Each operation has at least one claim observed through the CLI, and a refusal from a world for each code it
  produces.
- The concept whose rpc or flow implements a command books it, even when the noun is another concept's, as the 215
  book `org member invite` in budgets. So `org timesheet bill` is requests', and `org seats buy` and `org fde pay`
  are payments'.

## 3. Overlaps and spellings resolved across the packs

| Pack's earlier spelling | Now | Why |
|---|---|---|
| `project …`, `task …`, `timesheet …`, `activity-type …`, `project-type …` with `--org` | `org project …`, `org task …`, `org timesheet …`, `org activity-type …`, `org project-type …` | G1: these are only an Organization's |
| `crm lead …`, `crm deal …` | `org crm lead …`, `org crm deal …` | G1, G2 |
| `project\|task\|timesheet show`, `org payroll show` | `get <id>` | G3: `show` reads only a singleton |
| `project update`, `task update` | `change` | G3: the 215 never use `update` |
| `project users add\|remove` | `org project member add\|remove` | G2: a member, as `org department holder` |
| `crm lead add`, `crm deal add` | `org crm lead create`, `org crm deal create` | G3: a lead and a deal are documents with a lifecycle; `add` keeps the 215's meaning |
| `contact record` (one rpc that creates, changes and links) | `contact create`, `contact change`, `contact link` | G3: one verb each; linking chooses where money goes, so it is its own command with a preview |
| `crm lead add` changing a lead; `crm deal add` changing a deal (rpc `save`) | `org crm lead change`, `org crm deal change` | G3 |
| `org employee add\|change\|list` | Adds `get`, and `suspend\|deactivate\|reinstate\|leave` from the Employee machine | G3: a status is a lifecycle verb, never a `change` |
| `org payroll component\|structure\|assign\|run\|submit\|withhold\|pay\|cancel\|show\|list` | `org payroll component add\|change\|list\|disable\|enable`; `org payroll structure create\|cancel\|assign\|unassign\|list`; `org payroll run create\|submit\|pay\|cancel\|list\|get`; `org payslip withhold\|release` | G2, G3: nouns, then verbs. A slip is a payslip. |
| `payslip list\|show` | `payslip list\|get`, filtered by `--employer` | G1: `--org` is never a filter |
| `activity-type add\|list\|disable` | Adds `change` (rates) and `enable` | G3: `disable` needs its pair, and rates are fields |
| `org seats` | `org seats show` | G3 |
| `timesheet bill <ts…> --org` (`requests.bill-time`) | `org timesheet bill <ts…>` | G1 |
| `org app add\|remove`: "a Director or the FDE" (`organizations.commands`); "any member may add a Frappe app" (`agents.fde-authority`) | Director or FDE | Adding an app asks a connected head's host to install it, which is the Organization's choice, not any member's. `agents.fde-authority`'s wording follows. |
| `org seats buy`: "the People hat, from a budget they hold" | People, and Budget on `--from`; never an agent | `aaron.departments`: the budget's authority is its department's hat, read on chain |

## 4. Who books what, and the SDK changes it asks for

| Concept | Books | SDK and rpc changes |
|---|---|---|
| projects | 35 operations, each implemented by one new rpc | The rpcs named in 5.1. No flow is needed. |
| contacts | 14 | Split `client.account.address-book.record` into `.create`, `.change` and `.link`, all over `contacts.book.record`. Split `client.org.crm.leads.save` into `.create` and `.change`, and `client.org.crm.deals.save` the same way. Add `cli` to every CRM flow. |
| payroll | 28 | See the list below. Every payroll flow adds `cli` and keeps `react`. |
| organizations | 9 (8 in `organizations.commands`, plus `org seats show`) | Rpcs `organizations.apps.list\|add\|remove`, `organizations.heads.connect\|show\|disconnect`, `organizations.fde.show\|ask` and `organizations.seats.show`. Flows `client.org.head.connect` and `client.org.fde.ask`. The hosting door that `org fde pay`'s settlement invokes. |
| payments | 3 (`org seats buy`, `org fde pay`, `payment claim`) | Flows `client.org.seats.buy`, `client.org.fde.pay` and `client.payments.claim`. Each births one command through `payments.prepare-command` and opens one approval. |
| requests | 1 (`org timesheet bill`) | Flow `client.org.timesheets.bill`, over `requests.issuing.issue`, invoking `projects.bill-time`. |

The payroll changes:

- Rename `client.org.payroll.employees.add|change|list` to `client.org.employees.*`.
- Add `client.org.employees.get`, over a new rpc `payroll.employees.get`.
- Add `client.org.employees.suspend|deactivate|reinstate|leave`, over `payroll.employees.change`.
- Replace `client.org.payroll.structures.component` with `client.org.payroll.components.add|change|disable|enable`.
- Add `client.org.payroll.components.list`, over `payroll.structures.list`.
- `client.org.payroll.structures.cancel` now cancels a structure only. Add `.unassign`, over
  `payroll.structures.cancel`, for an assignment.
- Rename `client.org.payroll.runs.show` to `.get`.
- Rename `client.org.payroll.runs.withhold` to `client.org.payslips.withhold`, and add `.release`, over
  `payroll.runs.withhold`.
- Rename `client.me.payslips` to `client.me.payslips.list`, and add `.get`, over `payroll.slips.mine`.

## 5. The commands

Each table gives:

- the operation id;
- the command and its arguments;
- the SDK method;
- what it calls: an existing rpc or flow, or *new*, to be booked with it;
- who may run it (G4);
- its budget class (G8);
- what it does.

The owning concept is the section's, unless a row says otherwise. Every refusal follows G6. The behaviour names
only the refusals particular to the command.

### 5.1 Projects (`projects.commands`), owned by projects, area `projects`

SDK methods are under `client.org(orgId)`.

| Id | Command | SDK method | Calls | Who | Budget | Behaviour |
|---|---|---|---|---|---|---|
| `org.project.create` | `org project create <name> [--type] [--priority low\|medium\|high] [--start <day>] [--end <day>] [--customer <party\|name>] [--progress manual\|task-completion\|task-progress\|task-weight] [--department] [--cost-center] [--estimated-cost] [--notes]` | `.projects.create` | rpc `projects.projects.create` (new) | People or Director | write | Creates an open project. Its totals and actual dates are derived, never typed. A customer not on Capxul is kept by name. |
| `org.project.list` | `org project list [--status] [--type] [--customer] [--member] [--after] [--limit]` | `.projects.list` | rpc `projects.projects.list` (new) | Member | read | The Organization's projects, newest first. |
| `org.project.get` | `org project get <project>` | `.projects.get` | rpc `projects.projects.get` (new) | Member | read | One project, with its members, totals and percent complete. |
| `org.project.change` | `org project change <project> [create's flags] [--clear <field>]` | `.projects.change` | rpc `projects.projects.change` (new) | People or Director | write | Changes a project's fields. Its status and its derived totals are never set here. |
| `org.project.hold` | `org project hold <project>` | `.projects.hold` | rpc `projects.projects.hold` (new) | People or Director | write | Open becomes on hold. Its percent complete no longer moves its status. |
| `org.project.resume` | `org project resume <project>` | `.projects.resume` | rpc `projects.projects.resume` (new) | People or Director | write | On hold becomes open. |
| `org.project.complete` | `org project complete <project>` | `.projects.complete` | rpc `projects.projects.complete` (new) | People or Director | write | Open becomes completed when every task is completed or cancelled, or it has none. Otherwise `WRONG_STATE`, naming the open tasks. |
| `org.project.reopen` | `org project reopen <project>` | `.projects.reopen` | rpc `projects.projects.reopen` (new) | People or Director | write | Completed or cancelled becomes open. |
| `org.project.cancel` | `org project cancel <project>` | `.projects.cancel` | rpc `projects.projects.cancel` (new) | People or Director | write | Open or on hold becomes cancelled. The project is kept. |
| `org.project.member.add` | `org project member add <project> <member>` | `.projects.members.add` | rpc `projects.members.add` (new) | People or Director | write | Shares the project with a member (Frappe's Project User). |
| `org.project.member.remove` | `org project member remove <project> <member>` | `.projects.members.remove` | rpc `projects.members.remove` (new) | People or Director | write | Stops sharing it with that member. |
| `org.project.settings.show` | `org project settings show` | `.projects.settings.show` | rpc `projects.settings.show` (new) | Member | read | Projects Settings: whether time logs may overlap for one user and for one employee, and whether an invoice fetches timesheets. |
| `org.project.settings.set` | `org project settings set [--allow-user-overlap] [--allow-employee-overlap] [--fetch-timesheets]` (each with its `--no-` form) | `.projects.settings.set` | rpc `projects.settings.set` (new) | People or Director | write | Sets the values given and keeps the rest. |
| `org.task.create` | `org task create <subject> [--project] [--parent <task>] [--group] [--depends-on <task>]… [--start <day>] [--end <day>] [--hours <expected>] [--weight] [--priority low\|medium\|high\|urgent] [--milestone] [--type]` | `.tasks.create` | rpc `projects.tasks.create` (new) | Member | write | Creates an open task. A parent or dependency must be in this Organization and make no cycle. |
| `org.task.list` | `org task list [--project] [--status] [--parent] [--after] [--limit]` | `.tasks.list` | rpc `projects.tasks.list` (new) | Member | read | Tasks, by expected end. |
| `org.task.get` | `org task get <task>` | `.tasks.get` | rpc `projects.tasks.get` (new) | Member | read | One task, with its dependencies, children and logged time. |
| `org.task.change` | `org task change <task> [create's flags] [--clear <field>]` | `.tasks.change` | rpc `projects.tasks.change` (new) | Member | write | Changes a task's fields. Moving the expected end later takes an overdue task back to open or working. |
| `org.task.start` | `org task start <task>` | `.tasks.start` | rpc `projects.tasks.start` (new) | Member | write | Open or pending review becomes working. |
| `org.task.review` | `org task review <task> --by <day>` | `.tasks.review` | rpc `projects.tasks.review` (new) | Member | write | Sends it for review by that day. It falls overdue after that day. |
| `org.task.complete` | `org task complete <task>` | `.tasks.complete` | rpc `projects.tasks.complete` (new) | Member | write | Completed, recording who completed it and when. `WRONG_STATE` while a dependency or a child is still open. |
| `org.task.reopen` | `org task reopen <task>` | `.tasks.reopen` | rpc `projects.tasks.reopen` (new) | Member | write | Completed or cancelled becomes open. A completed project above it reopens. |
| `org.task.cancel` | `org task cancel <task>` | `.tasks.cancel` | rpc `projects.tasks.cancel` (new) | Member | write | Cancelled. It counts as done for its project and for the tasks that depend on it. |
| `org.timesheet.create` | `org timesheet create [--for <party>] [--employee <employee>] [--project <project>] [--title] [--note]` | `.timesheets.create` | rpc `projects.timesheets.create` (new) | Worker | write | A draft timesheet for the caller, or for another worker (any Party: an employee needs no Seat). |
| `org.timesheet.log` | `org timesheet log <timesheet> --activity <type> --start <time> (--end <time> \| --hours <h>) [--task] [--project] [--billable] [--completed] [--note]` | `.timesheets.log` | rpc `projects.timesheets.log` (new) | Worker | write | Adds one time log to a draft. An overlap the settings forbid, or a disabled activity type, is `INVALID_INPUT`. |
| `org.timesheet.get` | `org timesheet get <timesheet>` | `.timesheets.get` | rpc `projects.timesheets.get` (new) | Member | read | One timesheet, with its logs and totals. |
| `org.timesheet.list` | `org timesheet list [--for <party>] [--project] [--status] [--after] [--limit]` | `.timesheets.list` | rpc `projects.timesheets.list` (new) | Member | read | Timesheets by start day. |
| `org.timesheet.submit` | `org timesheet submit <timesheet>` | `.timesheets.submit` | rpc `projects.timesheets.submit` (new) | Worker | write | Draft becomes submitted, and its hours roll into its tasks and project. A log without times, or naming an employee without an activity type, is `INVALID_INPUT`. |
| `org.timesheet.cancel` | `org timesheet cancel <timesheet>` | `.timesheets.cancel` | rpc `projects.timesheets.cancel` (new) | Worker | write | Draft or submitted becomes cancelled, and its hours leave its tasks and project. `WRONG_STATE` once anything of it is billed or paid. |
| `org.activity-type.add` | `org activity-type add <name> [--costing-rate] [--billing-rate]` | `.activityTypes.add` | rpc `projects.activity-types.add` (new) | People or Director | write | Adds a kind of work that time is logged against, with default hourly rates. |
| `org.activity-type.change` | `org activity-type change <name> [--costing-rate] [--billing-rate]` | `.activityTypes.change` | rpc `projects.activity-types.change` (new) | People or Director | write | Changes its default rates. Logs already made keep their own. |
| `org.activity-type.list` | `org activity-type list` | `.activityTypes.list` | rpc `projects.activity-types.list` (new) | Member | read | The activity types, enabled first. |
| `org.activity-type.disable` | `org activity-type disable <name>` | `.activityTypes.disable` | rpc `projects.activity-types.disable` (new) | People or Director | write | It takes no new logs. |
| `org.activity-type.enable` | `org activity-type enable <name>` | `.activityTypes.enable` | rpc `projects.activity-types.enable` (new) | People or Director | write | It takes logs again. |
| `org.project-type.add` | `org project-type add <name> [--description]` | `.projectTypes.add` | rpc `projects.project-types.add` (new) | People or Director | write | Adds a project type. |
| `org.project-type.list` | `org project-type list` | `.projectTypes.list` | rpc `projects.project-types.list` (new) | Member | read | The project types. |

### 5.2 CRM (`contacts.crm-capabilities`), owned by contacts

The `contact` commands are area `payments`, as the frozen contact commands are. The rest are area `contacts`.

| Id | Command | SDK method | Calls | Who | Budget | Behaviour |
|---|---|---|---|---|---|---|
| `contact.create` | `contact create <label> --type person\|company [--email <mailbox>]… [--phone <number>]… [--designation] [--company <contact>] [--website] [--industry] [--territory] [--employees <range>] [--revenue <amount>] [--currency] [--description] [--org]` | `client.account.addressBook.create` | flow `client.account.address-book.create` (new) over rpc `contacts.book.record` | Self; with `--org`, People | write | Records a new person or company in the caller's book, or the Organization's. A person given a primary mailbox (the first `--email`) is named in the directory as `contact add` names them. Any other entry is private, with no Party. |
| `contact.change` | `contact change <contact> [create's detail flags] [--clear <field>] [--org]` | `client.account.addressBook.change` | flow `client.account.address-book.change` (new) over rpc `contacts.book.record` | Self; with `--org`, People | write | Sets the details given and keeps the rest. A field of the other type is `INVALID_INPUT`. The entry's Party never changes. |
| `contact.link` | `contact link <contact> <email\|@handle\|0x…\|party> [--confirm] [--org]` | `client.account.addressBook.link` | flow `client.account.address-book.link` (new) over rpc `contacts.book.record` | Self; with `--org`, People | write | Names a private entry's Party, once, after a preview: money paid to the entry then reaches that Party. An entry that already has a Party, or a Party already in the book, is `INVALID_INPUT`. |
| `org.crm.lead.create` | `org crm lead create [--first-name] [--last-name] [--email] [--mobile] [--phone] [--job-title] [--company <name>] [--website] [--industry] [--territory] [--employees <range>] [--revenue <amount>] [--source] [--owner <member>]` | `client.org(orgId).crm.leads.create` | flow `client.org.crm.leads.create` (new) over rpc `contacts.leads.save` | People | write | Captures a lead with status New. It needs a first name, a company name or a mailbox. Its owner is a member, and never the lead's own mailbox. |
| `org.crm.lead.change` | `org crm lead change <lead> [create's flags] [--clear <field>]` | `client.org(orgId).crm.leads.change` | flow `client.org.crm.leads.change` (new) over rpc `contacts.leads.save` | People | write | Changes a lead's fields. Its status moves only by `move`. |
| `org.crm.lead.move` | `org crm lead move <lead> <status> [--reason <lost reason>] [--notes]` | `client.org(orgId).crm.leads.move` | flow `client.org.crm.leads.move` | People | write | Moves it to one of Frappe CRM's lead statuses. A lost status needs a reason, and Other also needs notes. |
| `org.crm.lead.convert` | `org crm lead convert <lead> [--contact <contact>] [--company <contact>] [--value] [--expected-value] [--currency] [--close-by <day>]` | `client.org(orgId).crm.leads.convert` | flow `client.org.crm.leads.convert` | People | write | Converts it to an open deal, with its person and company: given, matched in the book, or made private. Converting again returns the same deal. A lost lead is `WRONG_STATE`. |
| `org.crm.lead.list` | `org crm lead list [--stage open\|ongoing\|won\|lost\|converted] [--after] [--limit]` | `client.org(orgId).crm.leads.list` | flow `client.org.crm.leads.list` | Member | read | The Organization's leads, most recent change first. |
| `org.crm.lead.get` | `org crm lead get <lead>` | `client.org(orgId).crm.leads.get` | flow `client.org.crm.leads.get` | Member | read | One lead. |
| `org.crm.deal.create` | `org crm deal create --company <contact> [--contact <contact>]… [--primary <contact>] [--owner <member>] [--probability] [--value] [--expected-value] [--currency] [--close-by <day>] [--next-step] [--source]` | `client.org(orgId).crm.deals.create` | flow `client.org.crm.deals.create` (new) over rpc `contacts.deals.save` | People | write | Opens a deal in Qualification. Its probability defaults from its status, and it has at most one primary person. |
| `org.crm.deal.change` | `org crm deal change <deal> [create's flags] [--clear <field>]` | `client.org(orgId).crm.deals.change` | flow `client.org.crm.deals.change` (new) over rpc `contacts.deals.save` | People | write | Changes a deal's fields. Its status moves only by `move`. |
| `org.crm.deal.move` | `org crm deal move <deal> <status> [--reason <lost reason>] [--notes]` | `client.org(orgId).crm.deals.move` | flow `client.org.crm.deals.move` | People | write | Moves it to a deal status. Won records when the deal was won. Lost needs a reason. |
| `org.crm.deal.list` | `org crm deal list [--stage open\|ongoing\|won\|lost] [--company <contact>] [--contact <contact>] [--after] [--limit]` | `client.org(orgId).crm.deals.list` | flow `client.org.crm.deals.list` | Member | read | The Organization's deals, most recent change first. |
| `org.crm.deal.get` | `org crm deal get <deal>` | `client.org(orgId).crm.deals.get` | flow `client.org.crm.deals.get` | Member | read | One deal, with its people. |

### 5.3 Payroll (`payroll.hr-surface`), owned by payroll, area `payroll`

SDK methods are under `client.org(orgId)`, except `payslip`'s, which are under `client.me`.

| Id | Command | SDK method | Calls | Who | Budget | Behaviour |
|---|---|---|---|---|---|---|
| `org.employee.add` | `org employee add <person> --first-name --last-name --joined <day> [--department <department>] [--designation] [--type full-time\|part-time\|contract\|intern\|apprentice\|probation\|commission\|piecework]` | `.employees.add` | flow `client.org.employees.add` (renamed) over rpc `payroll.employees.add` | People | write | Adds a person as an active Employee, paid at the mailbox they keep and never at a work address. A person has at most one live Employee. |
| `org.employee.change` | `org employee change <employee> [--department] [--designation] [--type]` | `.employees.change` | flow `client.org.employees.change` (renamed) over rpc `payroll.employees.change` | People | write | Changes an Employee's department, designation or type, never their Party or pay mailbox. |
| `org.employee.get` | `org employee get <employee>` | `.employees.get` | rpc `payroll.employees.get` (new) | People | read | One Employee, with their status and current structure assignment. |
| `org.employee.list` | `org employee list [--department] [--status]` | `.employees.list` | flow `client.org.employees.list` (renamed) over rpc `payroll.employees.list` | People | read | The Organization's Employees. |
| `org.employee.suspend` | `org employee suspend <employee>` | `.employees.suspend` | flow (new) over rpc `payroll.employees.change` | People | write | Active becomes suspended. A suspended Employee is left out of new runs. |
| `org.employee.deactivate` | `org employee deactivate <employee>` | `.employees.deactivate` | flow (new) over rpc `payroll.employees.change` | People | write | Active or suspended becomes inactive. |
| `org.employee.reinstate` | `org employee reinstate <employee>` | `.employees.reinstate` | flow (new) over rpc `payroll.employees.change` | People | write | Inactive or suspended becomes active. |
| `org.employee.leave` | `org employee leave <employee> --on <day> [--confirm]` | `.employees.leave` | flow (new) over rpc `payroll.employees.change` | People | write | After a preview, the Employee leaves on that day, and this is final. A person who comes back is a new Employee. |
| `org.payroll.component.add` | `org payroll component add <name> --abbr <ABBR> --type earning\|deduction\|employer-contribution (--amount <a> \| --formula <f>) [--condition <c>] [--payment-days] [--statistical] [--not-in-total] [--taxable] [--account <code>] [--liability-account <code>] [--payee <party>] [--description]` | `.payroll.components.add` | flow (new) over rpc `payroll.structures.component` | People | write | Adds a salary component. A formula must be in the portable subset. |
| `org.payroll.component.change` | `org payroll component change <component> [add's flags]` | `.payroll.components.change` | flow (new) over rpc `payroll.structures.component` | People | write | Changes a component. Submitted structures keep their own rows. |
| `org.payroll.component.list` | `org payroll component list` | `.payroll.components.list` | flow (new) over rpc `payroll.structures.list` | People | read | The salary components, enabled first. |
| `org.payroll.component.disable` | `org payroll component disable <component>` | `.payroll.components.disable` | flow (new) over rpc `payroll.structures.component` | People | write | No new structure takes it. |
| `org.payroll.component.enable` | `org payroll component enable <component>` | `.payroll.components.enable` | flow (new) over rpc `payroll.structures.component` | People | write | New structures may take it again. |
| `org.payroll.structure.create` | `org payroll structure create <name> --frequency monthly\|fortnightly\|bimonthly\|weekly\|daily --token <symbol> --earning <component>[=<amount\|formula>]… [--deduction …]… [--contribution …]… [--amends <structure>]` | `.payroll.structures.create` | flow `client.org.payroll.structures.create` over rpc `payroll.structures.create` | People | write | Creates a salary structure, submitted at once. An amendment replaces the structure it amends. |
| `org.payroll.structure.cancel` | `org payroll structure cancel <structure>` | `.payroll.structures.cancel` | flow `client.org.payroll.structures.cancel` over rpc `payroll.structures.cancel` | People | write | Cancels a structure. `WRONG_STATE` while a live assignment uses it. |
| `org.payroll.structure.assign` | `org payroll structure assign <structure> <employee> --start <day> --base <amount> [--variable <amount>] [--department] [--payable-account <code>]` | `.payroll.structures.assign` | flow `client.org.payroll.structures.assign` over rpc `payroll.structures.assign` | People | write | Assigns a structure to an Employee from that day, on a base. |
| `org.payroll.structure.unassign` | `org payroll structure unassign <assignment>` | `.payroll.structures.unassign` | flow (new) over rpc `payroll.structures.cancel` | People | write | Cancels an assignment. Runs already submitted keep their slips. |
| `org.payroll.structure.list` | `org payroll structure list [--employee <employee>]` | `.payroll.structures.list` | flow `client.org.payroll.structures.list` over rpc `payroll.structures.list` | People | read | The structures and their assignments. |
| `org.payroll.run.create` | `org payroll run create <department> --start <day> --end <day> [--posting <day>] [--frequency] [--employee <employee>]… [--unpaid <employee>=<days>]…` | `.payroll.runs.create` | flow `client.org.payroll.runs.create` over rpc `payroll.runs.create` | People | write | Drafts the department's run for the period, each slip worked out from the Employee's assignment. |
| `org.payroll.run.submit` | `org payroll run submit <run>` | `.payroll.runs.submit` | flow `client.org.payroll.runs.submit` over rpc `payroll.runs.submit` | People | write | Draft becomes submitted: its slips are fixed and owed, each payslip is stored and the accrual is posted. |
| `org.payroll.run.pay` | `org payroll run pay <run> [--slip <slip>]… [--request-key] [--timeout-seconds] [--no-wait]` | `.payroll.runs.pay` | flow `client.org.payroll.runs.pay` | Budget (the run's department budget) | chain-submit | Pays every unpaid submitted slip as one payment command with one approval. A lapsed approval resumes the same command. |
| `org.payroll.run.cancel` | `org payroll run cancel <run>` | `.payroll.runs.cancel` | flow `client.org.payroll.runs.cancel` over rpc `payroll.runs.cancel` | People | write | Cancels a run. `WRONG_STATE` once anything of it is paid. |
| `org.payroll.run.list` | `org payroll run list [--department] [--status]` | `.payroll.runs.list` | flow `client.org.payroll.runs.list` over rpc `payroll.runs.list` | People | read | The Organization's runs. |
| `org.payroll.run.get` | `org payroll run get <run>` | `.payroll.runs.get` | flow `client.org.payroll.runs.get` (renamed from `.show`) over rpc `payroll.runs.show` | People | read | One run, with its slips. |
| `org.payslip.withhold` | `org payslip withhold <slip> --reason <text>` | `.payslips.withhold` | flow `client.org.payslips.withhold` (renamed from `payroll.runs.withhold`) over rpc `payroll.runs.withhold` | People | write | Holds a submitted slip out of its run's payment. |
| `org.payslip.release` | `org payslip release <slip>` | `.payslips.release` | flow (new) over rpc `payroll.runs.withhold` | People | write | Releases a withheld slip, to be paid with the run's next payment. |
| `payslip.list` | `payslip list [--employer <handle>] [--after] [--limit]` | `client.me.payslips.list` | flow `client.me.payslips.list` (renamed) over rpc `payroll.slips.mine` | Self (the payee) | read | Your payslips, from every Organization that pays you. |
| `payslip.get` | `payslip get <slip>` | `client.me.payslips.get` | flow (new) over rpc `payroll.slips.mine` | Self (the payee) | read | One of your payslips, with its rows and its payment. |

### 5.4 Apps, the head and the FDE (`organizations.commands`), owned by organizations, area `organizations`

| Id | Command | SDK method | Calls | Who | Budget | Behaviour |
|---|---|---|---|---|---|---|
| `org.app.list` | `org app list` | `client.org(orgId).apps.list` | rpc `organizations.apps.list` (new) | Member | read | The Organization's Frappe apps: native or on its head; wanted, installed or removed; and their versions. |
| `org.app.add` | `org app add <app>` | `client.org(orgId).apps.add` | rpc `organizations.apps.add` (new) | Director or FDE | write | Wants a Frappe app beyond the fundamental ones. A connected head's host is asked to install it, and it is installed once the head shows it. An unknown app is `INVALID_INPUT`. |
| `org.app.remove` | `org app remove <app>` | `client.org(orgId).apps.remove` | rpc `organizations.apps.remove` (new) | Director or FDE | write | No longer wants an app. A fundamental app is `WRONG_STATE`. |
| `org.head.connect` | `org head connect <site-url> --host frappe-cloud\|self-hosted [--key-file <path>] [--team-token-file <path>] [--confirm] [--no-wait] [--timeout-seconds]` | `client.org(orgId).head.connect` | flow `client.org.head.connect` (new) over rpc `organizations.heads.connect` (new) | Director | vendor | Connects a Frappe site as the Organization's head. It reads the secrets from a prompt or a file, previews what will be shared, and follows the check until the head is connected or failing. A live head is `WRONG_STATE`. |
| `org.head.show` | `org head show` | `client.org(orgId).head.show` | rpc `organizations.heads.show` (new) | Member | read | The head's status, site, versions, time zone and issue, and each app's sync position. Null when there is no head. |
| `org.head.disconnect` | `org head disconnect [--confirm]` | `client.org(orgId).head.disconnect` | rpc `organizations.heads.disconnect` (new) | Director | write | After a preview, disconnects the live head. Every sync stops, and Capxul keeps every record. |
| `org.fde.show` | `org fde show` | `client.org(orgId).fde.show` | rpc `organizations.fde.show` (new) | Member | read | The Organization's hosted FDE: its handle, its state on the host, the hats it wears, the day its hosting is paid through, and `FDE_HOSTING_PRICE`. |
| `org.fde.ask` | `org fde ask <message> [--timeout-seconds]` | `client.org(orgId).fde.ask` | flow `client.org.fde.ask` (new) over rpc `organizations.fde.ask` (new) | Director | vendor | Sends a message to the hosted FDE and prints its reply when its turn ends. Whatever it does in return, it does through its own commands, each traced. A paused FDE is `WRONG_STATE`. |

### 5.5 What an Organization buys from Capxul (`organizations.buy-seats`)

The prices are the deployment settings `SEAT_PRICE` and `FDE_HOSTING_PRICE`: 10 USDC a seat, paid once, and
20 USDC a month, on the test USDC (`aaron.test-prices`).

Each purchase is paid like this:

1. Payments births one command through `payments.prepare-command`, from the `--from` budget to Capxul's receiving
   Safe, with the Organization as the command's owner.
2. The settlement invokes an organizations door in the same transaction: `organizations.add-bought-seats` for
   seats, or the hosting door organizations books for the FDE. So what was bought counts exactly when the payment
   settles, and only for the company that paid.
3. A reorg's reversal invokes the matching return door.

| Id | Command | Owner | SDK method | Calls | Who | Budget | Behaviour |
|---|---|---|---|---|---|---|---|
| `org.seats.show` | `org seats show` | organizations | `client.org(orgId).seats.show` | rpc `organizations.seats.show` (new) | Member | read | The seat limit, what counts against it, the seats bought and `SEAT_PRICE`. |
| `org.seats.buy` | `org seats buy <n> --from <budget> [--request-key] [--timeout-seconds] [--no-wait]` | payments | `client.org(orgId).seats.buy` | flow `client.org.seats.buy` (new) over a payments rpc (new) that births the command | People, and Budget on `--from`; never an agent | chain-submit | Pays n times `SEAT_PRICE` in one payment and approval. The limit rises when the payment settles, and a bought seat is kept for good. An unset price is `FEATURE_NOT_AVAILABLE`. |
| `org.fde.pay` | `org fde pay [<months>] --from <budget> [--request-key] [--timeout-seconds] [--no-wait]` | payments | `client.org(orgId).fde.pay` | flow `client.org.fde.pay` (new) over a payments rpc (new) that births the command | Budget on `--from`; a person, never an agent | chain-submit | Pays the given number of months (one by default) times `FDE_HOSTING_PRICE`. The hosting's paid-through day moves on by that many months when the payment settles. |

## 6. Capabilities the rulings need that no pack listed

These were added by this pass:

- **The hosted FDE** (`aaron.fde-hosted`, `aaron.test-prices`). Before, the FDE ran beside the founder's CLI, so
  the founder talked to it there, and nothing was paid for it. Hosted by Capxul and paid for by the Organization,
  it needs three commands:
  - `org fde show`, to see its state and what is paid;
  - `org fde ask`, to talk to it through Capxul's own sign-in, since its key and sandbox are on the host;
  - `org fde pay`, to pay for it.

  The first two are added to `organizations.commands`. `org fde pay` is added to `organizations.buy-seats`,
  because it is paid exactly as seats are, and payments books both. When `org fde pay` is not run, the FDE pauses
  once its paid-through day passes, and paying again resumes it. The designer of `aaron.fde-hosted` settles the
  host's states, the reminders before a lapse and how the first month is paid.
- **Claiming waiting money later** (`aaron.escrow-general`: "they can claim that money whenever they want"). Today
  the personal Safe's setup collects the waiting claim escrows once. One declined at setup, or whose collection
  approval expired, can then never be collected, although the sender can still take it back.

  | Id | Command | Owner | SDK method | Calls | Who | Budget | Behaviour |
  |---|---|---|---|---|---|---|---|
  | `payment.claim` | `payment claim [<payment>] [--request-key] [--timeout-seconds] [--no-wait]` | payments | `client.payments.claim` | flow `client.payments.claim` (new) over the escrow's claim rpc (new, named by the escrow design) | Self: the recipient whose account the escrow names as its owner | chain-submit | Collects money waiting for you in claim escrows, one or all, at any time once your account is set up. One the sender already took back is `WRONG_STATE`. |

  It needs its own pack decision in payments that cites `aaron.escrow-general`. That is for the escrow pass, or
  for the builder if the escrow pass does not book it.
- **Billing hours** (`aaron.projects`, pack `requests.bill-time`, which is not one of the five). It is respelled by
  G1 and booked by requests.

  | Id | Command | Owner | SDK method | Calls | Who | Budget | Behaviour |
  |---|---|---|---|---|---|---|---|
  | `org.timesheet.bill` | `org timesheet bill <timesheet>… [--to <payer>] [--request-key]` | requests (area `payments`) | `client.org(orgId).timesheets.bill` | flow `client.org.timesheets.bill` (new) over rpc `requests.issuing.issue`, invoking `projects.bill-time` | Invoicing | write | Issues one Invoice for the timesheets' unbilled billable logs, one line per activity, and marks those logs billed in the same write. |

These rulings were checked and need no new command:

| Ruling | Why no new command |
|---|---|
| `aaron.departments` | `org department holder add\|remove` already swap people in and out of a department. |
| `aaron.budget-pay-unclaimed` | `org department pay` and `payment send --on` already pay someone with no account. |
| `aaron.money-waiting`, `aaron.money-waiting-reminders` | Notices, with no command. |
| `aaron.machine-login` | `client.auth.keySession` in the SDK. |
| `aaron.seats` | `agent create`. |
| `aaron.books-first-principles` | A head's vouchers arrive by the sync, and books' operations are among the 215. |

The operator's seat raise stays the operator's SDK tool.

## 7. For Aaron

Each recommendation stands until he answers.

1. **Who may talk to the hosted FDE** (`org fde ask`)?
   - Recommended: a Director. The FDE acts with the hats the Board granted it, so whoever instructs it borrows
     them.
   - The alternative: any member, with the host passing the asker's Seat so that the FDE does for them only what
     they may do themselves.
2. **How is hosting paid?**
   - Recommended: in advance, by the month, from a budget (`org fde pay <months>`). The FDE pauses when its
     paid-through day passes.
   - The alternative: an automatic monthly charge. That needs a standing allowance from a company budget to
     Capxul's receiving Safe.
3. **May a recipient claim waiting money later, by command** (`payment claim`), as well as at setup? Recommended:
   yes, as `aaron.escrow-general` reads.
