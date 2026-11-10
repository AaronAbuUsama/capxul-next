# New commands: one grammar for the capabilities beyond the 215

Status: designed 8 November 2026, book first, at Aaron's request: "What new commands do we need? Can we make
some sort of pack for this? Ideally this should be on the book; we shouldn't have these ad hoc decision packs."

This page is the one list of every new CLI command, in one grammar. The records are the authority. Each command
is booked as an operation record under `rules.new-operations` (CONVENTIONS rule 4a) by the concept that owns it,
on its pack's recommendation. All 179 are booked, each once and each listed here once (the commands pass's build,
8 November 2026; the world pass's build, the seasons design and the surface pass's build, 9 November 2026); section 8
lists every place the booking refined a row below, each with its decision. The pack decisions recommend exactly the commands listed here:

- the commands pass: `projects.commands`, `contacts.crm-capabilities`, `payroll.hr-surface`,
  `organizations.commands` and `organizations.buy-seats`, with `requests.bill-time` and `accounts.collect-any-time`
  (section 6);
- the world pass (Aaron's eighth batch): `organizations.fde-guests`, `organizations.doc-family`,
  `contacts.conversation-commands`, `payroll.hr-commands`, `devnet.clock-rate` and `payments.claim-command`;
- Aaron's ninth batch: `devnet.seasons` (`aaron.seasons`), and the surface pass's `payroll.hr-self-rules`.

**Grouped, 9 November 2026** (`surface.tree`, on Aaron's answer to question 48: "It's the logical groupings"). Every
command, the 215's and these, now sits in one tree of thirteen logical groups:
[`command-surface.md`](command-surface.md). Section 2 below is that tree's grammar. Every owner applied it the same
day, book first, so sections 1, 2, 5, 6 and 8 give each command, id and SDK method as the tree spells it; sections 3,
4 and 7 keep the packs' own words, as history.

Nothing here changes the 215. A new operation never stands in for one of them, and the grammar is checked
against them: no id, export name or command below collides with a frozen operation or its old command
(`packages/blueprint-engine/scripts/check-frozen.ts`, 9 November 2026: 179 new operations, 0 collisions, 0 breaches).

The rulings these commands serve, all in `blueprint/shared/rulings.ts`:

- `aaron.projects`, `aaron.frappe-shape` and `aaron.crm-frappe-shape`: CRM, Projects and Frappe HR payroll are in
  every Organization.
- `aaron.frappe-head`: a head connects as a separate step.
- `aaron.fde-agent` and `aaron.fde-hosted`: every Organization has an FDE, hosted by Capxul and paid for.
- `aaron.buy-seats` and `aaron.test-prices`: a company buys seats; the prices are 10 USDC a seat and 20 USDC a
  month for the FDE.
- `aaron.escrow-general`: the recipient claims whenever they want; `aaron.payment-claim`: with `payment claim`,
  while the sender's take-back stays `payment cancel`.
- `aaron.departments`: who may spend.
- `aaron.fde-anyone`: anyone of the Organization, and anyone its management names, may ask the FDE, which acts
  only as its asker.
- `aaron.sdk-reaches-everything`: the Core SDK and the CLI reach everything, a head's own documents included; the
  React SDK does not mirror them.
- `aaron.world-clock`: every world's clock may run at a rate, and every channel (mail, WhatsApp, the head, the
  FDE's host) is its world's.
- `aaron.seasons`: a shared world runs in seasons, like a game: it starts from a known world, runs at a rate, jumps
  time on a schedule and ends in a reset.

## 1. The packs at a glance

| Pack (decision) | Booked by | Commands | Rulings it cites |
|---|---|---|---|
| `projects.commands` | projects | 35 | `aaron.projects`, `aaron.frappe-shape` |
| `contacts.crm-capabilities` | contacts | 14 | `aaron.crm-frappe-shape`, `aaron.frappe-shape` |
| `payroll.hr-surface` | payroll | 28 | `aaron.frappe-shape` |
| `organizations.commands` | organizations | 8 | `aaron.frappe-shape`, `aaron.frappe-head`, `aaron.fde-agent`, `aaron.fde-hosted` |
| `organizations.fde-guests` | organizations (section 5.4: `org fde turn get`, `org fde guest add\|remove\|list`) | 4 | `aaron.fde-anyone` |
| `organizations.doc-family` | organizations (section 5.7) | 12 | `aaron.sdk-reaches-everything` |
| `contacts.conversation-commands` | contacts (section 5.8) | 13 | `aaron.crm-frappe-shape`, `aaron.sdk-reaches-everything`, `aaron.world-clock` |
| `payroll.hr-commands` | payroll (section 5.9: holidays, leave, shifts and attendance, expense claims, advances) | 45 | `aaron.frappe-shape`, `aaron.sdk-reaches-everything`, `aaron.departments`, `aaron.world-clock` |
| `organizations.buy-seats` | organizations (`org seats show`); payments (`org seats buy`, `org fde pay`) | 3 | `aaron.buy-seats`, `aaron.fde-hosted`, `aaron.test-prices` |
| `devnet.clock-rate` | devnet (section 5.6: `dev time set`) | 1 | `aaron.world-clock` |
| `devnet.seasons` | devnet (section 5.10: `dev season …`) | 11 | `aaron.seasons` |
| `payroll.hr-self-rules` | payroll (section 5.9: `hr holiday\|leave-type\|expense-type list`) | 3 | `aaron.frappe-shape`, `aaron.sdk-reaches-everything` |
| None of the five (section 6) | requests (`org projects timesheet bill`, pack `requests.bill-time`); payments (`payment claim`, packs `accounts.collect-any-time` and `payments.claim-command`) | 2 | `aaron.projects`; `aaron.escrow-general`, `aaron.payment-claim` |
| **Total** | | **179** | |

## 2. The grammar

The 215 already have a grammar, applied unevenly. These rules take the form most of them use. Every new command
follows them, with no exception.

**G1. Scope.**

- A command on an Organization's records only begins with `org`. It acts for the Organization named by
  `--org <handle>`, or else the one `use org` chose, as every `org` command of the 215 does. Projects, the CRM's
  leads and deals, HR's and payroll's Organization side, the head (its apps and documents), seats and the FDE are only
  an Organization's, so their commands begin with `org`.
- A command on the caller's own records, across every Organization, has no `org`: `payroll payslip list`, as
  `payroll agreement list`. Where the records are a group's (G2), it begins with the group's word.
- A command on a book that is either a person's or an Organization's has no prefix and takes `--org` for the
  Organization's: `contact create`, as `contact add`.
- `--org` always means "act for this Organization". It is never a filter. A filter by Organization is its own
  flag: `payroll payslip list --employer <handle>`.
- An Employee's own HR records (5.9) are the caller's own, so their commands begin with `hr`, the group's word without
  `org`, and never take `--org`: a list holds every employer's and `--employer` filters, as `payroll payslip list`; a
  command on one record takes the employer from its id; and a write or a balance with no record yet (`hr leave apply`,
  `hr leave balance`, `hr attendance checkin`, `hr expense-claim create`, `hr advance request`) acts at the employer
  `--employer` names, absent their only one (`payroll.hr-self`). The Organization's side of the same records is
  `org hr` (`org hr leave approve`): the same noun, with `org` the only difference (`surface.hr-group`).

**G2. Groups and nouns** (`surface.tree`; [`command-surface.md`](command-surface.md)).

- Where a Frappe app holds the records, a command names the app's group first, one word, as the 215's `org books`
  does: `org books` (ERPNext's Accounting), `org hr` (Frappe HR's HR module), `org payroll` (its Payroll module, with
  pay agreements), `org crm` (Frappe CRM), `org projects` (ERPNext's Projects) and `org head` (the Frappe site: its
  apps, DocTypes, documents and call log). A person's own side of a group takes the same word without `org`: `hr`,
  `payroll`.
- Capxul's native areas keep the 215's nouns, directly under `org` or at the top (`org department`, `org member`,
  `org round`, `payment`, `bank`), which already say what they are. `capxul --help` groups them in sections.
- Under a group, a record kind is one singular, kebab-case noun, named as Frappe names the DocType:
  `org projects task`, `org projects timesheet`, `org projects activity-type`, `org hr employee`, `org hr leave-type`,
  `org hr expense-claim`, `org head doctype`; or a common word where G2 allows one: `payslip` (Salary Slip), `leave`,
  `advance`, `doc`.
- A group whose first record is the module's own takes that record's verbs directly, as `org` takes the
  Organization's (`org create`, `org list`, `org show`): `org projects create` makes a Project, so no command reads
  "projects project" (`surface.projects-group`).
- A record that belongs to another is a second noun, as `org department holder add` is: `org projects member`
  (Project User), `org fde guest`.
- A singleton the Organization has exactly one of keeps its own name, plural if that is its name, as `org books`
  is: `org head`, `org fde`, `org seats`, `org projects settings`.
- No command has more than four words before its arguments, the 215's longest (`org books accounts add`).

**G3. Verbs.** Verbs come from a closed set, each with one meaning, and each is a verb the 215 already use.
`update` and `show <id>` are not used by a new command; the 215's own `show <id>` (`payroll agreement show`, `invest
show`) keep theirs (`surface.fit-calls`).

| Verb | Means | As in the 215 | New uses |
|---|---|---|---|
| `create` | Makes a new working document that has a lifecycle of its own | `org department create`, `service create` | project, task, timesheet, CRM lead and deal, payroll structure and run, a book entry (`contact create`), a head document (`org head doc create`) |
| `add` / `remove` | Puts a person, an app or a named setting into a list the Organization keeps, or takes it out | `contact add`, `org department holder add\|remove` | employee, project member, activity type, project type, salary component, app, FDE guest, holiday, leave type, shift type, expense type, CRM note (`org crm note add`); and `org head doc remove` (below) |
| `change` | Edits a record's fields, never its status | `org payroll agreement change`, `org allowance change` | every record with fields |
| `set` | Sets a singleton's values | `org department budget set` | `org projects settings set`, `dev time set` (the clock's rate) |
| `list` | Lists, paged with `--after`, newest change first unless stated | `payment list`, `org member list` | every record kind |
| `get <id>` | Reads one record of a list | `payment get`, `contact get`, `org member get` | every record kind |
| `show` | Reads a singleton, with no id | `org show`, `org board show` | head, FDE, seats, project settings |
| A lifecycle verb | One transition of the record's state machine that a person takes, named as the machine names it | `org payroll agreement pause\|resume`, `org department close\|reopen`, `org proposal approve\|reject`, `request issue` | project `hold\|resume\|complete\|reopen\|cancel`; task `start\|review\|complete\|reopen\|cancel`; timesheet `submit\|cancel`; employee `suspend\|deactivate\|reinstate\|leave`; structure `cancel`; head document `submit\|cancel` (Frappe's docstatus); leave `apply` (its birth), `approve\|reject\|cancel`; expense claim `approve\|reject\|cancel`; advance `request` (its birth), `reject\|cancel`; attendance `cancel`; a season `start\|end\|cancel` (`devnet.seasons`) |
| A view read by its noun | Reads a figure the noun names, computed, never stored as a record | `balance`, `org cap-table`, `activity summary` | `hr leave balance`, `org hr leave balance <employee>` (`payroll.hr-commands`), `org crm timeline <record>` (`contacts.conversation-spelling`) |
| A domain verb | A step with no simpler name | `bank match`, `payroll agreement collect`, `org round allocate` | `timesheet log`, `crm lead move\|convert`, `crm deal move`, `structure assign\|unassign`, `run submit\|pay`, `payslip withhold\|release`, `contact link`, `head connect\|disconnect`, `seats buy`, `fde pay\|ask`, `payment claim` (`aaron.payment-claim`), `timesheet bill`, `doc amend` (a cancelled document's correction) and `doc apply` (a Workflow's action: `apply` has two meanings, each Frappe's own word, a Leave Application's birth and `apply_workflow`, `surface.fit-calls`); the CRM's `email\|whatsapp send`, `whatsapp connect\|disconnect`, `task move` and `call log`; HR's `leave allocate\|unallocate`, `shift-type assign\|unassign`, `attendance checkin\|mark`, `expense-claim pay`, `advance pay\|settle`; the devnet's `season warp add\|remove` and `season player add\|remove`, and `dev time warp` scheduled as a season's warp (G3 has no `jump`) |

- An undoing verb is the 215's pair: `hide|unhide`, `freeze|unfreeze`, `add|remove`. So the new pairs are
  `hold|resume`, `complete|reopen`, `assign|unassign`, `disable|enable`, `withhold|release`, `suspend|reinstate`
  and `connect|disconnect`.
- `claim` takes up what is held for you: a Board seat (`org board claim`), a Safe at setup, or the money waiting in
  its claim escrow (`payment claim`, `aaron.payment-claim`). `collect` is a payee taking money released to them
  (`payroll agreement collect`), and stays the escrow's own function, so `payment claim` still answers `collected`.
- A command whose rpc both creates and changes gets one command per verb. Each is its own SDK method over the one
  rpc, as `contact hide` and `contact unhide` are.
- `org head doc remove` is Frappe's Delete of a head document. The 215 have no `delete`: `remove` is their word for taking
  a record away (`bank accounts remove`; `agent remove`, which has no undo), and since this cannot be undone from
  Capxul it previews (G5).

**G4. Who.** Who may run a command is always a hat, a Seat or the Board, never a named person
(`aaron.departments`). The terms used in section 5:

| Term | Means |
|---|---|
| Member | Any member of the Organization: an active Seat, a person's or an agent's; the hosted FDE only as the member who asked it (`organizations.head-fit`, `projects.surface-fit`). |
| People | A member whose Safe wears the Organization's People hat (`manage-people`). The founder wears it from setup. |
| People or Director | People, or a Director of the Organization (`projects.permissions`). |
| Invoicing | A member whose Safe wears the Invoicing hat (`issue-invoices`). |
| Director | A Director of the Organization, an owner of the company Safe. Never an agent (`board.no-agent-directors`). |
| Director or FDE | A Director, or the Organization's own agent acting as itself, the Seat whose use is `organization` (only a self-run one acts as itself). The hosted FDE acts as its asker (below), so for it this is a Director who asks. |
| Asker | Any member, or a guest the management (People or Director) named with `org fde guest add` (`aaron.fde-anyone`, `organizations.fde-guests`). |
| Head User | A person member, acting on a connected head as their own User there, matched by mailbox and member id, with the roles their hats give at that moment; the head's own permissions decide (`organizations.doc-authority`). An agent has no head User. |
| Budget | Whoever `Budgets.authorised` admits on the budget the command spends: a wearer in good standing of its department's hat or of an ancestor's, as the chain reads it at that moment. The company Safe acts only through the Board. Authority follows the hat, so a person swapped out of a department loses it. |
| Self | The signed-in person or agent, for its own records only. |
| Worker | A timesheet's own worker, for their own time; People or Director, for anyone else's. |
| World owner | A devnet command's: on a local devnet, anyone on the machine that runs it; in a shared world, the holder of its owner grant (`devnet.season-players`). A joiner's grant is refused `ROLE_PERMISSION_DENIED`. |
| Anyone in the world | On a local devnet, anyone on the machine; in a shared world, any grant, between seasons too (`dev season show\|list`, `devnet.season-players`). |

- An agent is a member like any other and acts with the hats its Safe wears.
- The FDE starts with no hat (`agents.fde-authority`), and hosted it needs none: it acts only as the asker of its turn,
  with the asker's Seat and hats, and every signature it prepares is the asker's to make
  (`organizations.fde-for-the-asker`). A command that previews and asks is the asker's own to answer: its rpc refuses
  the FDE's call.
- No agent buys seats or pays for hosting: `org seats buy` and `org fde pay` need a person. The hosted FDE prepares one
  only as a person who asks, whose own Safe signs it.

**G5. Arguments and flags.**

- The record a command acts on is a positional argument: its Capxul id, as `list` prints it. A head document, of
  which Capxul keeps no copy, is `<DocType> <name>`, Frappe's names, as `org head doc list` prints them (5.7).
- A member is an email, or an agent's `@handle`, as in `org member grant`.
- A Party is an email, an `@handle`, a `0x` address or a Party id, as in `contact add`. Examples are a customer,
  a person to employ, or the Party a contact links to.
- A book entry is its contact id, as `contact list` prints it.
- `--from <budget>` names the budget a new command spends, and nothing else: a department's key or id, or an
  allowance's name or id, as in `payment send --from` and `org department pay`. The 215's dated `--from`
  (`dev prices set --from <date>`, `org payroll agreement change --from <date>`) keep theirs (`surface.fit-calls`); a
  season's starting world is `--snapshot <world>` (`devnet.seasons`).
- Times:
  - A day is `--on <YYYY-MM-DD>`, a day in the Organization's time zone.
  - A period's bounds are `--start` and `--end`: days for a document's dates, ISO 8601 instants for a time log,
    and `HH:MM` in the Organization's time zone for a shift's daily hours (`org hr shift-type add`, `payroll.shift-types`).
  - A review date is `--by <day>`. A forecast close is `--close-by <day>`. A CRM task's due time is `--due <time|day>`
    (CRM Task's `due_date`, `contacts.conversation-spelling`).
- Amounts are decimal strings: in the Company's currency for projects and the CRM, and in the structure's token
  for payroll.
- A repeatable flag takes one value each time (`--depends-on <task> --depends-on <task>`), as the 215's
  repeatable flags do.
- A `change` command's flags set fields. `--clear <field>` empties one.
- Lists take `--after <cursor>` and `--limit <n>`.
- Money commands (`org payroll run pay`, `org seats buy`, `org fde pay`) take `--request-key`,
  `--timeout-seconds` and `--no-wait`; `--no-wait` alone answers the hand-over, and `--json` only chooses how the
  answer prints (`payments.seat-hand-over`; `payment send`'s own `--json` hands over, as the 215 have it).
  `payment claim` takes `--json` and `--timeout-seconds` and no `--request-key`, since it births no command. The
  approval page is their confirmation.
- A command that cannot be undone, or that hands records to an outside system, previews what it will do and asks:
  `contact link`, `org hr employee leave`, `org head connect`, `org head disconnect`, `org head doc remove`,
  `dev season start|end` (each replaces the world) and `org hr advance settle` (a salary deduction no command takes back, `payroll.advance-recovery`). `--confirm` answers yes in a script
  (`vocabulary.declined-preview-cancelled`).
- A secret is never a flag. `org head connect` reads the head user's API key and secret, and on Frappe Cloud the
  team's token, from a prompt or from `--key-file` and `--team-token-file`.

**G6. Refusals.** The same code is used for the same case as in the 215. There is no not-found code: an unknown
id is `INVALID_INPUT`, as in `payment get`.

| Code | When |
|---|---|
| `NOT_AUTHENTICATED` | Signed out. |
| `ROLE_PERMISSION_DENIED` | `--org` names an Organization the caller is not a member of, or the caller lacks the hat or role G4 names. |
| `INVALID_INPUT` | An id or locator that names nothing the caller may read, a bad value naming the field, a `--limit` out of range or a cursor the list did not give, or a `change` or `set` that gives nothing. Nothing is written. |
| `WRONG_STATE` | The record's status does not allow the step: a transition's `from` or its guard. The refusal names the status. |
| `CLI_USAGE` | A malformed id or an id of the wrong kind (a `deal_` id for a lead, as `payment get` refuses), a missing argument, or a script without `--confirm` or `--request-key` where the command needs one. |
| `CANCELLED` | The person answers no at a preview (exit 130). Nothing is written. |
| `FEATURE_NOT_AVAILABLE` | A price the deployment has not set (`SEAT_PRICE`, `FDE_HOSTING_PRICE`), or a token it does not sell in. |
| Money codes | As `payment send` and `org department pay` refuse: `INSUFFICIENT_BALANCE`, `PAYROLL_BUDGET_EXCEEDED` (over a budget's room or the payout ceiling; `AUTHORISED_EXCEEDED` is equity's shares code), `TOKEN_NOT_BUDGETED`. |
| `PROVIDER_ERROR`, `PROVIDER_RESPONSE_INVALID`, `RATE_LIMITED` | The head's site or the FDE's host fails, or the chain cannot answer a hat projects reads live (`projects.hat-guard`). |

**G7. SDK method and implementation.**

- The SDK method is the command's words:
  - `org` becomes `client.org(orgId)`;
  - a group's word is a namespace, as written (`crm`, `hr`, `payroll`, `projects`, `head`, `books`);
  - each noun becomes its plural, in camelCase;
  - the verb comes last, in camelCase.

  So `org crm lead create` is `client.org(orgId).crm.leads.create`, `org projects activity-type add` is
  `client.org(orgId).projects.activityTypes.add`, `org projects create` is `client.org(orgId).projects.create`,
  `org hr leave approve` is `client.org(orgId).hr.leaves.approve` and `org head doc get` is
  `client.org(orgId).head.docs.get`.
- A caller's own records sit under `client.me` (`client.me.payroll.payslips.list`, `client.me.hr.leaves.apply`).
- A book is `client.account.addressBook`, as the 215's contact commands are.
- Payments are `client.payments`.
- The flow id is the method, kebab-cased, without `(orgId)`.
- Each command calls one SDK method, and each SDK method serves one command (A4, `components.cli`).
- A method that is one rpc call is implemented by that rpc. Otherwise it is one flow in the owning concept's
  `flows.ts`. Where a concept already had a one-call SDK-only flow (the CRM's move, convert, list and get), or keeps
  every command a flow for its React twin (payroll, `payroll.command-flows`), that flow serves the command.
- An existing SDK-only flow that a command now calls adds `cli` to its `surfaces` and keeps its other surfaces
  (rule 4a).

**G8. Budget and priority.**

| Class | Used for |
|---|---|
| `read` | A list, a get or a show, which reads rows only. |
| `write` | One off-chain transaction. |
| `chain-read` | A command whose rpc reads the chain before it answers: projects' 19 commands that read the People or Director hat live (`projects.hat-guard`). |
| `chain-submit` | A command that signs an approval and follows the chain: `org payroll run pay`, `org seats buy`, `org fde pay`, `payment claim`. |
| `vendor` | A command that calls an outside system before it answers: `org head connect` reads the site; `org fde ask` and `org fde turn get` wait on the host; every `org head doc` and `org head doctype` command calls the head. |
| `background` | A devnet command that waits on the supervisor's barrier: `dev season start` and `end` (each restores a world), as `dev snapshot restore`. `dev season create\|change\|cancel` and `warp\|player add\|remove` are `write`; `dev season show\|list` are `read`. |

A new command is `normal` priority unless its pack's decision marks it `critical`, the loop a pilot or a start-up
runs first: 11 of projects' (`projects.critical-commands`), 6 of the CRM's (`contacts.critical-commands`), 10 of
payroll's (`payroll.critical-commands`), 7 of HR's (`payroll.hr-critical`) and 2 of organizations' (`org head app list|add`; not the FDE's, which "is not on
the critical path", `aaron.fde-anyone`; `organizations.command-priorities`). No B3 pilot runs one, and `org create` finishes without any.

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
  book `org member invite` in budgets. So `org projects timesheet bill` is requests', and `org seats buy`, `org fde pay`
  and `payment claim` are payments' (`payment claim`'s flow calls accounts' rpc `accounts.setup.collect`).

## 3. Overlaps and spellings resolved across the packs

History: the packs' spellings at the commands pass. The tree has since moved several of them (`org project …` is
`org projects …`, `org employee …` is `org hr employee …`; command-surface.md section 5).

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

History: what each pack asked for when booked. Since the tree, every HR method is under `.hr`
(`client.org(orgId).hr.employees.add`, `client.me.hr.leaves.apply`; flows `client.org.hr.employees.*`,
`client.org.hr.expense-claims.pay`, `client.org.hr.advances.pay|settle`), the payslips and agreements under
`.payroll` (`client.me.payroll.payslips.list`, `client.me.payroll.agreements.collect`), the head's under `.head`
(`client.org(orgId).head.docs.get`, flow `client.org.head.docs.remove`) and projects' records under `.projects`
(flow `client.org.projects.timesheets.bill`); command-surface.md section 5.2.

| Concept | Books | SDK and rpc changes |
|---|---|---|
| projects | 35 operations, each implemented by one new rpc | The rpcs named in 5.1. No flow is needed. |
| contacts | 14 | Split `client.account.address-book.record` into `.create`, `.change` and `.link`, all over `contacts.book.record`. Split `client.org.crm.leads.save` into `.create` and `.change`, and `client.org.crm.deals.save` the same way. Add `cli` to every CRM flow. For 5.8 (13 more): flows `client.org.crm.emails.send`, `.whatsapp.connect\|disconnect\|send`, `.notes.add\|change` and `.tasks.create\|change` (previews, or two methods over one save rpc), and `.timeline`, `.whatsapp.show`, `.tasks.move\|list` and `.calls.log` each implemented by its one rpc (G7), over new rpcs `contacts.timeline.list`, `contacts.mail.send`, `contacts.whatsapp.connect\|disconnect\|show\|send`, `contacts.notes.save`, `contacts.tasks.save\|move\|list` and `contacts.calls.log`; the webhooks `contacts.mail.receive` and `contacts.whatsapp.receive`; the processes `contacts.mail.thread` and `contacts.whatsapp.account`. |
| payroll | 28, and 45 HR commands in 5.9 | See the list below. Every payroll flow adds `cli` and keeps `react`. The HR commands are each their own new rpc (`payroll.hr-rpc-methods`), but `org expense-claim pay`, `org advance pay` and `org advance settle`, flows `client.org.expense-claims.pay`, `client.org.advances.pay` and `client.org.advances.settle` (a preview); their payments are followed by the processes `payroll.expense-claims.payment` and `payroll.advances.payment`, and each shift assignment marks attendance by `payroll.attendance.auto`. |
| organizations | 25 (8 in `organizations.commands`, `org seats show`, 4 in `organizations.fde-guests`, 12 in `organizations.doc-family`) | Rpcs `organizations.apps.list\|add\|remove`, `organizations.heads.connect\|show\|disconnect`, `organizations.fde.show\|ask\|turn` and `organizations.seats.show`. Flows `client.org.head.connect`, `client.org.head.disconnect` and `client.org.fde.ask`. The hosting doors `organizations.extend-fde-hosting` and `organizations.return-fde-hosting`, which `org fde pay`'s settlement and its reorg invoke. For the world pass: rpcs `organizations.fde-guests.add\|remove\|list`, `organizations.docs.list\|get\|create\|change\|submit\|cancel\|amend\|apply\|remove`, `organizations.doctypes.list\|get` and `organizations.doc-calls.list`; flow `client.org.docs.remove`; `org fde turn get` over `organizations.fde.turn`. |
| payments | 3 (`org seats buy`, `org fde pay`, `payment claim`) | Flows `client.org.seats.buy` and `client.org.fde.pay`, over payments' own rpcs `payments.commands.buy-seats` and `payments.commands.pay-fde-hosting`, which birth one command by `payments.prepare-command`'s rules and open one approval (`payments.seat-purchase`, `payments.fde-hosting-purchase`). Flow `client.payments.claim`, over accounts' rpc `accounts.setup.collect` (`payments.claim-command`). |
| accounts | 0 | Its rpc `accounts.setup.collect` serves `payment claim` (`accounts.collect-any-time`); `account collect` and `client.account.collect` are gone (`aaron.payment-claim`). |
| devnet | 1 (`dev time set`) | Flow `devnet.time.set` in the Core SDK's devnet entry, over the supervisor's protocol call `timeRate` (`POST /v1/time/rate`, new in `devnet-control`); no backend rpc (`devnet.clock-rate`). |
| requests | 1 (`org timesheet bill`) | Flow `client.org.timesheets.bill`, over its own rpc `requests.issuing.bill-time`, which issues as `requests.issuing.issue` does and invokes `projects.bill-time` (`requests.bill-time`). |

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

These tables give each command as booked, in the tree's spelling (`surface.tree`, applied by every owner);
[`command-surface.md`](command-surface.md) section 6 lists all 394 by group, checked against the book.

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
| `org.projects.create` | `org projects create <name> [--type] [--priority low\|medium\|high] [--start <day>] [--end <day>] [--customer <party\|name>] [--progress manual\|task-completion\|task-progress\|task-weight] [--department] [--cost-center] [--estimated-cost] [--notes]` | `.projects.create` | rpc `projects.projects.create` (new) | People or Director | write | Creates an open project. Its totals and actual dates are derived, never typed. A customer not on Capxul is kept by name. |
| `org.projects.list` | `org projects list [--status] [--type] [--customer] [--member] [--after] [--limit]` | `.projects.list` | rpc `projects.projects.list` (new) | Member | read | The Organization's projects, newest first. |
| `org.projects.get` | `org projects get <project>` | `.projects.get` | rpc `projects.projects.get` (new) | Member | read | One project, with its members, totals and percent complete. |
| `org.projects.change` | `org projects change <project> [create's flags] [--clear <field>]` | `.projects.change` | rpc `projects.projects.change` (new) | People or Director | write | Changes a project's fields. Its status and its derived totals are never set here. |
| `org.projects.hold` | `org projects hold <project>` | `.projects.hold` | rpc `projects.projects.hold` (new) | People or Director | write | Open becomes on hold. Its percent complete no longer moves its status. |
| `org.projects.resume` | `org projects resume <project>` | `.projects.resume` | rpc `projects.projects.resume` (new) | People or Director | write | On hold becomes open. |
| `org.projects.complete` | `org projects complete <project>` | `.projects.complete` | rpc `projects.projects.complete` (new) | People or Director | write | Open becomes completed when every task is completed or cancelled, or it has none. Otherwise `WRONG_STATE`, naming the open tasks. |
| `org.projects.reopen` | `org projects reopen <project>` | `.projects.reopen` | rpc `projects.projects.reopen` (new) | People or Director | write | Completed or cancelled becomes open. |
| `org.projects.cancel` | `org projects cancel <project>` | `.projects.cancel` | rpc `projects.projects.cancel` (new) | People or Director | write | Open or on hold becomes cancelled. The project is kept. |
| `org.projects.member.add` | `org projects member add <project> <member>` | `.projects.members.add` | rpc `projects.members.add` (new) | People or Director | write | Shares the project with a member (Frappe's Project User). |
| `org.projects.member.remove` | `org projects member remove <project> <member>` | `.projects.members.remove` | rpc `projects.members.remove` (new) | People or Director | write | Stops sharing it with that member. |
| `org.projects.settings.show` | `org projects settings show` | `.projects.settings.show` | rpc `projects.settings.show` (new) | Member | read | Projects Settings: whether time logs may overlap for one user and for one employee, and whether an invoice fetches timesheets. |
| `org.projects.settings.set` | `org projects settings set [--allow-user-overlap] [--allow-employee-overlap] [--fetch-timesheets]` (each with its `--no-` form) | `.projects.settings.set` | rpc `projects.settings.set` (new) | People or Director | write | Sets the values given and keeps the rest. |
| `org.projects.task.create` | `org projects task create <subject> [--project] [--parent <task>] [--group] [--depends-on <task>]… [--start <day>] [--end <day>] [--hours <expected>] [--weight] [--priority low\|medium\|high\|urgent] [--milestone] [--type]` | `.projects.tasks.create` | rpc `projects.tasks.create` (new) | Member | write | Creates an open task. A parent or dependency must be in this Organization and make no cycle. |
| `org.projects.task.list` | `org projects task list [--project] [--status] [--parent] [--after] [--limit]` | `.projects.tasks.list` | rpc `projects.tasks.list` (new) | Member | read | Tasks, by expected end. |
| `org.projects.task.get` | `org projects task get <task>` | `.projects.tasks.get` | rpc `projects.tasks.get` (new) | Member | read | One task, with its dependencies, children and logged time. |
| `org.projects.task.change` | `org projects task change <task> [create's flags] [--clear <field>]` | `.projects.tasks.change` | rpc `projects.tasks.change` (new) | Member | write | Changes a task's fields. Moving the expected end later takes an overdue task back to open or working. |
| `org.projects.task.start` | `org projects task start <task>` | `.projects.tasks.start` | rpc `projects.tasks.start` (new) | Member | write | Open or pending review becomes working. |
| `org.projects.task.review` | `org projects task review <task> --by <day>` | `.projects.tasks.review` | rpc `projects.tasks.review` (new) | Member | write | Sends it for review by that day. It falls overdue after that day. |
| `org.projects.task.complete` | `org projects task complete <task>` | `.projects.tasks.complete` | rpc `projects.tasks.complete` (new) | Member | write | Completed, recording who completed it and when. `WRONG_STATE` while a dependency or a child is still open. |
| `org.projects.task.reopen` | `org projects task reopen <task>` | `.projects.tasks.reopen` | rpc `projects.tasks.reopen` (new) | Member | write | Completed or cancelled becomes open. A completed project above it reopens. |
| `org.projects.task.cancel` | `org projects task cancel <task>` | `.projects.tasks.cancel` | rpc `projects.tasks.cancel` (new) | Member | write | Cancelled. It counts as done for its project and for the tasks that depend on it. |
| `org.projects.timesheet.create` | `org projects timesheet create [--for <party>] [--employee <employee>] [--project <project>] [--title] [--note]` | `.projects.timesheets.create` | rpc `projects.timesheets.create` (new) | Worker | write | A draft timesheet for the caller, or for another worker (any Party: an employee needs no Seat). |
| `org.projects.timesheet.log` | `org projects timesheet log <timesheet> --activity <type> --start <time> (--end <time> \| --hours <h>) [--task] [--project] [--billable] [--completed] [--note]` | `.projects.timesheets.log` | rpc `projects.timesheets.log` (new) | Worker | write | Adds one time log to a draft. An overlap the settings forbid, or a disabled activity type, is `INVALID_INPUT`. |
| `org.projects.timesheet.get` | `org projects timesheet get <timesheet>` | `.projects.timesheets.get` | rpc `projects.timesheets.get` (new) | Member | read | One timesheet, with its logs and totals. |
| `org.projects.timesheet.list` | `org projects timesheet list [--for <party>] [--project] [--status] [--after] [--limit]` | `.projects.timesheets.list` | rpc `projects.timesheets.list` (new) | Member | read | Timesheets by start day. |
| `org.projects.timesheet.submit` | `org projects timesheet submit <timesheet>` | `.projects.timesheets.submit` | rpc `projects.timesheets.submit` (new) | Worker | write | Draft becomes submitted, and its hours roll into its tasks and project. A log without times, or naming an employee without an activity type, is `INVALID_INPUT`. |
| `org.projects.timesheet.cancel` | `org projects timesheet cancel <timesheet>` | `.projects.timesheets.cancel` | rpc `projects.timesheets.cancel` (new) | Worker | write | Draft or submitted becomes cancelled, and its hours leave its tasks and project. `WRONG_STATE` once anything of it is billed or paid. |
| `org.projects.activity-type.add` | `org projects activity-type add <name> [--costing-rate] [--billing-rate]` | `.projects.activityTypes.add` | rpc `projects.activity-types.add` (new) | People or Director | write | Adds a kind of work that time is logged against, with default hourly rates. |
| `org.projects.activity-type.change` | `org projects activity-type change <name> [--costing-rate] [--billing-rate]` | `.projects.activityTypes.change` | rpc `projects.activity-types.change` (new) | People or Director | write | Changes its default rates. Logs already made keep their own. |
| `org.projects.activity-type.list` | `org projects activity-type list` | `.projects.activityTypes.list` | rpc `projects.activity-types.list` (new) | Member | read | The activity types, enabled first. |
| `org.projects.activity-type.disable` | `org projects activity-type disable <name>` | `.projects.activityTypes.disable` | rpc `projects.activity-types.disable` (new) | People or Director | write | It takes no new logs. |
| `org.projects.activity-type.enable` | `org projects activity-type enable <name>` | `.projects.activityTypes.enable` | rpc `projects.activity-types.enable` (new) | People or Director | write | It takes logs again. |
| `org.projects.project-type.add` | `org projects project-type add <name> [--description]` | `.projects.projectTypes.add` | rpc `projects.project-types.add` (new) | People or Director | write | Adds a project type. |
| `org.projects.project-type.list` | `org projects project-type list` | `.projects.projectTypes.list` | rpc `projects.project-types.list` (new) | Member | read | The project types. |

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
| `org.hr.employee.add` | `org hr employee add <person> --first-name --last-name --joined <day> [--department <department>] [--designation] [--type full-time\|part-time\|contract\|intern\|apprentice\|probation\|commission\|piecework]` | `.hr.employees.add` | flow `client.org.hr.employees.add` (renamed) over rpc `payroll.employees.add` | People | write | Adds a person as an active Employee, paid at the mailbox they keep and never at a work address. A person has at most one live Employee. |
| `org.hr.employee.change` | `org hr employee change <employee> [--department] [--designation] [--type]` | `.hr.employees.change` | flow `client.org.hr.employees.change` (renamed) over rpc `payroll.employees.change` | People | write | Changes an Employee's department, designation or type, never their Party or pay mailbox. |
| `org.hr.employee.get` | `org hr employee get <employee>` | `.hr.employees.get` | rpc `payroll.employees.get` (new) | People | read | One Employee, with their status and current structure assignment. |
| `org.hr.employee.list` | `org hr employee list [--department] [--status]` | `.hr.employees.list` | flow `client.org.hr.employees.list` (renamed) over rpc `payroll.employees.list` | People | read | The Organization's Employees. |
| `org.hr.employee.suspend` | `org hr employee suspend <employee>` | `.hr.employees.suspend` | flow (new) over rpc `payroll.employees.change` | People | write | Active becomes suspended. A suspended Employee is left out of new runs. |
| `org.hr.employee.deactivate` | `org hr employee deactivate <employee>` | `.hr.employees.deactivate` | flow (new) over rpc `payroll.employees.change` | People | write | Active or suspended becomes inactive. |
| `org.hr.employee.reinstate` | `org hr employee reinstate <employee>` | `.hr.employees.reinstate` | flow (new) over rpc `payroll.employees.change` | People | write | Inactive or suspended becomes active. |
| `org.hr.employee.leave` | `org hr employee leave <employee> --on <day> [--confirm]` | `.hr.employees.leave` | flow (new) over rpc `payroll.employees.change` | People | write | After a preview, the Employee leaves on that day, and this is final. A person who comes back is a new Employee. |
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
| `org.payroll.run.create` | `org payroll run create <department> --start <day> --end <day> [--posting <day>] [--frequency] [--employee <employee>]…` | `.payroll.runs.create` | flow `client.org.payroll.runs.create` over rpc `payroll.runs.create` | People | write | Drafts the department's run for the period, each slip worked out from the Employee's assignment. |
| `org.payroll.run.submit` | `org payroll run submit <run>` | `.payroll.runs.submit` | flow `client.org.payroll.runs.submit` over rpc `payroll.runs.submit` | People | write | Draft becomes submitted: its slips are fixed and owed, each payslip is stored and the accrual is posted. |
| `org.payroll.run.pay` | `org payroll run pay <run> [--slip <slip>]… [--request-key] [--timeout-seconds] [--no-wait]` | `.payroll.runs.pay` | flow `client.org.payroll.runs.pay` | Budget (the run's department budget) | chain-submit | Pays every unpaid submitted slip as one payment command with one approval. A lapsed approval resumes the same command. |
| `org.payroll.run.cancel` | `org payroll run cancel <run>` | `.payroll.runs.cancel` | flow `client.org.payroll.runs.cancel` over rpc `payroll.runs.cancel` | People | write | Cancels a run. `WRONG_STATE` once anything of it is paid. |
| `org.payroll.run.list` | `org payroll run list [--department] [--status]` | `.payroll.runs.list` | flow `client.org.payroll.runs.list` over rpc `payroll.runs.list` | People | read | The Organization's runs. |
| `org.payroll.run.get` | `org payroll run get <run>` | `.payroll.runs.get` | flow `client.org.payroll.runs.get` (renamed from `.show`) over rpc `payroll.runs.show` | People | read | One run, with its slips. |
| `org.payroll.payslip.withhold` | `org payroll payslip withhold <slip> --reason <text>` | `.payroll.payslips.withhold` | flow `client.org.payroll.payslips.withhold` (renamed from `payroll.runs.withhold`) over rpc `payroll.runs.withhold` | People | write | Holds a submitted slip out of its run's payment. |
| `org.payroll.payslip.release` | `org payroll payslip release <slip>` | `.payroll.payslips.release` | flow (new) over rpc `payroll.runs.withhold` | People | write | Releases a withheld slip, to be paid with the run's next payment. |
| `payroll.payslip.list` | `payroll payslip list [--employer <handle>] [--after] [--limit]` | `client.me.payroll.payslips.list` | flow `client.me.payroll.payslips.list` (renamed) over rpc `payroll.slips.mine` | Self (the payee) | read | Your payslips, from every Organization that pays you. |
| `payroll.payslip.get` | `payroll payslip get <slip>` | `client.me.payroll.payslips.get` | flow (new) over rpc `payroll.slips.mine` | Self (the payee) | read | One of your payslips, with its rows and its payment. |

### 5.4 Apps, the head and the FDE (`organizations.commands`), owned by organizations, area `organizations`

| Id | Command | SDK method | Calls | Who | Budget | Behaviour |
|---|---|---|---|---|---|---|
| `org.head.app.list` | `org head app list [--after] [--limit]` | `client.org(orgId).head.apps.list` | rpc `organizations.apps.list` (new) | Member | read | The Organization's Frappe apps, paged: native or on its head; wanted, installed or removed; and their versions. |
| `org.head.app.add` | `org head app add <app>` | `client.org(orgId).head.apps.add` | rpc `organizations.apps.add` (new) | Director or FDE | write | Wants a Frappe app beyond the fundamental ones. A connected head's host is asked to install it, and it is installed once the head shows it. An unknown app is `INVALID_INPUT`. |
| `org.head.app.remove` | `org head app remove <app>` | `client.org(orgId).head.apps.remove` | rpc `organizations.apps.remove` (new) | Director or FDE | write | No longer wants an app. A fundamental app is `WRONG_STATE`. |
| `org.head.connect` | `org head connect <site-url> --host frappe-cloud\|self-hosted [--key-file <path>] [--team-token-file <path>] [--confirm] [--no-wait] [--timeout-seconds]` | `client.org(orgId).head.connect` | flow `client.org.head.connect` (new) over rpc `organizations.heads.connect` (new) | Director | vendor | Connects a Frappe site as the Organization's head. It reads the secrets from a prompt or a file, previews what will be shared, and follows the check until the head is connected or failing. A live head is `WRONG_STATE`. |
| `org.head.show` | `org head show` | `client.org(orgId).head.show` | rpc `organizations.heads.show` (new) | Member | read | The head's status, site, versions, time zone and issue; never a secret, and no app's sync position, which is each app concept's (`organizations.head-commands`). Null when there is no head. |
| `org.head.disconnect` | `org head disconnect [--confirm]` | `client.org(orgId).head.disconnect` | flow `client.org.head.disconnect` (new: read, preview, write) over rpc `organizations.heads.disconnect` (new) | Director | write | After a preview, disconnects the live head. Every sync stops, and Capxul keeps every record. |
| `org.fde.show` | `org fde show` | `client.org(orgId).fde.show` | rpc `organizations.fde.show` (new) | Member | read | The Organization's hosted FDE: its handle, its state on the host, the hats it wears, the day its hosting is paid through, and `FDE_HOSTING_PRICE`. |
| `org.fde.ask` | `org fde ask <message> [--timeout-seconds]` | `client.org(orgId).fde.ask` | flow `client.org.fde.ask` (new) over rpc `organizations.fde.ask` (new) | Asker | vendor | Sends a message to the hosted FDE and prints its reply when its turn ends. Whatever it does in return, it does through its own commands, each traced. A paused FDE is `WRONG_STATE`. The FDE acts as the asker: it does for them only what their own Seat and hats allow, and hands any signature to them (`organizations.fde-for-the-asker`). |
| `org.fde.turn.get` | `org fde turn get <turn>` | `client.org(orgId).fde.turns.get` | rpc `organizations.fde.turn` | The turn's asker | vendor | A turn the asker sent: working, ended with its reply, or failed. Any other turn is `INVALID_INPUT`. Reading it ended ends what the ask lets the FDE do. |
| `org.fde.guest.add` | `org fde guest add <email\|@handle> [--note <text>]` | `client.org(orgId).fde.guests.add` | rpc `organizations.fde-guests.add` (new) | People or Director | write | Names an outside person the Organization works with as a guest who may ask its FDE; admits them to the beta. A member, an agent or an Organization is `INVALID_INPUT`. Naming twice is one guest. |
| `org.fde.guest.remove` | `org fde guest remove <email\|@handle\|guest>` | `client.org(orgId).fde.guests.remove` | rpc `organizations.fde-guests.remove` (new) | People or Director | write | The guest may not ask again, and their open asks act for them no more. |
| `org.fde.guest.list` | `org fde guest list [--status active\|removed] [--after] [--limit]` | `client.org(orgId).fde.guests.list` | rpc `organizations.fde-guests.list` (new) | Member | read | The guests, active first, with who named them. |

### 5.5 What an Organization buys from Capxul (`organizations.buy-seats`)

The prices are the deployment settings `SEAT_PRICE` and `FDE_HOSTING_PRICE`: 10 USDC a seat, paid once, and
20 USDC a month, on the test USDC (`aaron.test-prices`).

Each purchase is paid like this:

1. Payments births one command by `payments.prepare-command`'s rules, through its own rpc
   (`payments.commands.buy-seats`, `payments.commands.pay-fde-hosting`), from the `--from` budget to Capxul's
   receiving Safe (`CAPXUL_RECEIVING_SAFE`), with the Organization as the command's owner and an Invoice from Capxul
   as its document (`payments.seat-invoice`).
2. The settlement invokes an organizations door in the same transaction: `organizations.add-bought-seats` for
   seats, or `organizations.extend-fde-hosting` for the FDE. So what was bought counts exactly when the payment
   settles, and only for the company that paid.
3. A reorg's reversal invokes the matching return door.

| Id | Command | Owner | SDK method | Calls | Who | Budget | Behaviour |
|---|---|---|---|---|---|---|---|
| `org.seats.show` | `org seats show` | organizations | `client.org(orgId).seats.show` | rpc `organizations.seats.show` (new) | Member | read | The seat limit, what counts against it, the seats bought and `SEAT_PRICE`. |
| `org.seats.buy` | `org seats buy <n> --from <budget> [--request-key] [--timeout-seconds] [--no-wait]` | payments | `client.org(orgId).seats.buy` | flow `client.org.seats.buy` (new) over rpc `payments.commands.buy-seats` (new) | People, and Budget on `--from`; never an agent or the Board | chain-submit | Pays n times `SEAT_PRICE` in one payment and approval. The limit rises when the payment settles, and a bought seat is kept for good. An unset price is `FEATURE_NOT_AVAILABLE`. |
| `org.fde.pay` | `org fde pay [<months>] --from <budget> [--request-key] [--timeout-seconds] [--no-wait]` | payments | `client.org(orgId).fde.pay` | flow `client.org.fde.pay` (new) over rpc `payments.commands.pay-fde-hosting` (new) | Budget on `--from`; a person, never an agent (so never the FDE) or the Board | chain-submit | Pays the given number of months (one by default) times `FDE_HOSTING_PRICE`. The hosting's paid-through instant moves on by that many calendar months when the payment settles, from the later of it and the settlement, so a paused FDE is woken and its pause is not charged. No hosted FDE, or a retired one, is `WRONG_STATE`. |

### 5.6 The devnet's clock rate (`devnet.clock-rate`), owned by devnet, area `devnet`

For `aaron.world-clock`: a world's clock may run faster than real time, so it gains a rate beside frozen and running
(`docs/design/time.md` section 7). The command follows the 215's devnet spelling (`dev prices set`, `dev gates
set`): G3's `set` on a singleton, the clock, which `dev time` already shows, with the value as a flag (G5), as
`org department budget set --budget` takes its own. The SDK method is the devnet entry's, as `dev time warp` is
`devnet.time.warp` (G7). The supervisor's own thin client spells it the same way, `capxul-devnet time set --rate <n>`,
and its other controls (`capxul-devnet whatsapp …`, `mail receive`, `world grant`) are eval and hosting tools, not
operations, as its fault switches are (`devnet.fault-switches`).

| Id | Command | SDK method | Calls | Who | Budget | Behaviour |
|---|---|---|---|---|---|---|
| `dev.time.set` | `dev time set --rate <n>` | `devnet.time.set` | flow `devnet.time.set` (new) over devnet-control's `timeRate` (`POST /v1/time/rate`, new) | World owner | write | Sets the seconds of world time in each real second while the clock runs, a whole number from 1 to 60, from now on, for every follower. A frozen clock stays frozen and keeps the rate for when it resumes. Warps are unchanged. A missing `--rate`, or one outside the range, is `INVALID_INPUT` (G6); off a devnet or a shared world, `WRONG_ENVIRONMENT`; a joiner's grant in a shared world, `ROLE_PERMISSION_DENIED` (world `shared-world-joiner`). A move already running is `WRONG_STATE`, a race no saved world holds, so, as for the frozen `dev time` commands, it is not a booked refusal. |

### 5.7 The document family (`organizations.doc-family`), owned by organizations, area `organizations`

For `aaron.sdk-reaches-everything`: what lives only on a connected head (recruitment, appraisal, training,
onboarding, any other app's documents) is reached through one generic family over the Core SDK and the CLI, not the
React SDK. Each command is one SDK method over one rpc, which Capxul's backend sends to the head's Capxul app
(`frappe-head`'s `docRead` and `docWrite`, idempotent by the call id the SDK method makes once per invocation). It runs
there as the member's own head User, with the roles the member's hats give at that call, so the head's permissions
decide (`organizations.doc-authority`); it never
reaches a DocType a native concept owns (refused with the commands that reach it), money (any DocType the head's apps'
ledger hooks list, the few that post though no hook lists them, such as ERPNext's Repost Item Valuation, and Frappe
Lending's Loan Management whole) or the head's machinery (`organizations.doc-reach`); and every call, read or write,
done or refused, is logged on the world's clock (`organizations.doc-log`). `<DocType>` is Frappe's name (`"Job Opening"`), and
a document is named by its head name, since Capxul keeps no copy. `--set <field>=<value>` (repeatable, the value sent
as text for the head to read as its field's type) and `--file <path>` (a JSON object of typed fields, child tables as
arrays of rows) give fields; each `--set` overrides the file's field of that name. The refusals of every row follow G6: no
connected head `WRONG_STATE`; a native, money or machinery DocType, or a name, field or value the head refuses,
`INVALID_INPUT`; what the head's permissions refuse `ROLE_PERMISSION_DENIED`; a step its docstatus or Workflow
forbids `WRONG_STATE`; the head down `PROVIDER_ERROR`.

| Id | Command | SDK method | Calls | Who | Budget | Behaviour |
|---|---|---|---|---|---|---|
| `org.head.doc.list` | `org head doc list <DocType> [--filter <field><op><value>]… [--field <field>]… [--order-by <field>] [--asc] [--after] [--limit]` | `client.org(orgId).head.docs.list` | rpc `organizations.docs.list` (new) | Head User | vendor | One page of the DocType's documents the User may see, newest change first; filters apply together, the operator the longest of `=`, `!=`, `>`, `>=`, `<`, `<=`, `~` (like) and `!~` (not like) after the field's name. |
| `org.head.doc.get` | `org head doc get <DocType> <name> [--field <field>]…` | `client.org(orgId).head.docs.get` | rpc `organizations.docs.get` (new) | Head User | vendor | One document: its fields and child rows, docstatus, Workflow state and the actions the User may take, and what they may do to it. |
| `org.head.doc.create` | `org head doc create <DocType> [--set <field>=<value>]… [--file <path>]` | `client.org(orgId).head.docs.create` | rpc `organizations.docs.create` (new) | Head User | vendor | Inserts a document (a draft when submittable), named by the head; Frappe's validations run. |
| `org.head.doc.change` | `org head doc change <DocType> <name> [--set …]… [--file <path>] [--clear <field>]… [--modified <stamp>]` | `client.org(orgId).head.docs.change` | rpc `organizations.docs.change` (new) | Head User | vendor | Sets fields and keeps the rest, never the docstatus; a submitted document takes only its allow-on-submit fields; `--modified` refuses a change based on an older read. |
| `org.head.doc.submit` | `org head doc submit <DocType> <name>` | `client.org(orgId).head.docs.submit` | rpc `organizations.docs.submit` (new) | Head User | vendor | A draft of a submittable DocType becomes submitted. Under an active Workflow, `WRONG_STATE`: use `apply` (Capxul's refusal; Frappe's server would let it skip the Workflow). |
| `org.head.doc.cancel` | `org head doc cancel <DocType> <name>` | `client.org(orgId).head.docs.cancel` | rpc `organizations.docs.cancel` (new) | Head User | vendor | A submitted document becomes cancelled, and is kept. |
| `org.head.doc.amend` | `org head doc amend <DocType> <name>` | `client.org(orgId).head.docs.amend` | rpc `organizations.docs.amend` (new) | Head User | vendor | A cancelled document's correction: a new draft (by Frappe's default `<name>-1`) whose `amended_from` names it. |
| `org.head.doc.apply` | `org head doc apply <DocType> <name> <action>` | `client.org(orgId).head.docs.apply` | rpc `organizations.docs.apply` (new) | Head User | vendor | One Workflow action: the next state, submitting or cancelling where it says so. |
| `org.head.doc.remove` | `org head doc remove <DocType> <name> [--confirm]` | `client.org(orgId).head.docs.remove` | flow `client.org.head.docs.remove` (new: read, preview, delete) over rpcs `organizations.docs.get` and `organizations.docs.remove` (new) | Head User; never the FDE for them | vendor | Deletes a document that is not submitted, after a preview. A submitted one is `WRONG_STATE`. |
| `org.head.doctype.list` | `org head doctype list [--app] [--module] [--all] [--after] [--limit]` | `client.org(orgId).head.doctypes.list` | rpc `organizations.doctypes.list` (new) | Head User | vendor | The head's DocTypes the family reaches; `--all` adds the rest, each with why not (native, naming its commands; money; machinery). |
| `org.head.doctype.get` | `org head doctype get <DocType>` | `client.org(orgId).head.doctypes.get` | rpc `organizations.doctypes.get` (new) | Head User | vendor | One DocType's fields, child tables, Workflow, the User's rights on it, and whether the family reaches it. |
| `org.head.doc-call.list` | `org head doc-call list [--doctype] [--name] [--member] [--after] [--limit]` | `client.org(orgId).head.docCalls.list` | rpc `organizations.doc-calls.list` (new) | Member: a Director every call, anyone else their own | read | The family's log, newest first: whose authority (the FDE's calls under its asker), the head User, the verb, the document, the outcome; never a value. |

Left out on purpose (`organizations.doc-family`): a count (a list pages), copy (create and amend cover it), bulk
writes (each document is its own authorised, logged call), whitelisted methods (they write any DocType around the
guard; a head capability that needs one gets its own command), and files and comments (Frappe's core module is native).

### 5.8 The CRM's conversations (`contacts.conversation-commands`), owned by contacts, area `contacts`

For Aaron's evening answer (the CRM tracks every conversation), `aaron.crm-frappe-shape`, `aaron.sdk-reaches-everything`
and `aaron.world-clock`: email, WhatsApp, calls, notes and tasks on one timeline per contact, lead and deal, in Frappe
CRM's shapes (Communication, the WhatsApp app's WA Account and WA Message, CRM Call Log, FCRM Note, CRM Task), threaded
onto the right record, on the world's clock with each channel the world's. A `<record>` is a contact entry's id
(`party_`, `contact_`), a `lead_` or a `deal_` id; a converted lead takes no new conversation (`WRONG_STATE` naming its
deal). Email goes in and out through the Organization's CRM mailbox, `<handle>@<CRM_MAIL_DOMAIN>`
(`contacts.crm-mailbox`), on the `mail` integration notices uses, with its inbound half added: a reply threads back by
Message-ID, and mail from someone unknown makes a lead (`contacts.mail-threading`). WhatsApp goes through Meta's
WhatsApp Business Cloud API on the Organization's own number (`contacts.whatsapp-connect`); a free-form text only in
the 24-hour window, counted on the world's clock (`contacts.whatsapp-window`). The timeline also shows the money the
chain proves between the Organization and the record's Party (`contacts.timeline-money`, for Aaron). SDK methods are
under `client.org(orgId).crm`. The refusals follow G6; a send to the provider that fails is `PROVIDER_ERROR` or
`RATE_LIMITED`, and the sends and WhatsApp's connect and disconnect preview and take `--confirm`, so their rpcs refuse
the hosted FDE's call for its asker (G4, `contacts.sends-preview`).

| Id | Command | SDK method | Calls | Who | Budget | Behaviour |
|---|---|---|---|---|---|---|
| `org.crm.timeline` | `org crm timeline <record> [--kind email\|whatsapp\|call\|note\|task\|money\|record]… [--after] [--limit]` | `.timeline` | rpc `contacts.timeline.list` (new) | Member | read | The record's emails, messages, calls, notes and tasks, its birth and the chain's money with its Party, newest first; a deal's includes its lead's. A view, so read by its noun, as `org cap-table` is (`contacts.conversation-commands`). |
| `org.crm.email.send` | `org crm email send <record> (--subject <text> \| --in-reply-to <communication>) (--body <text> \| --body-file <path>) [--to <mailbox>]… [--cc <mailbox>]… [--bcc <mailbox>]… [--confirm]` | `.emails.send` | flow (new: key, preview, send) over rpc `contacts.mail.send` (new) | People; never the FDE for them | vendor | From `<member> at <Organization>` at the CRM mailbox to the record's own mailbox unless `--to`; once Resend took it, on the timeline. A retry under the same send key sends once. |
| `org.crm.whatsapp.connect` | `org crm whatsapp connect [--key-file <path>] [--confirm]` | `.whatsapp.connect` | flow (new: secrets, preview, connect) over rpc `contacts.whatsapp.connect` (new) | People; never the FDE for them | vendor | Checks the number with Meta, subscribes the Meta app to the number's WhatsApp Business Account (else Meta sends it no webhook), seals its secrets and prints the webhook URL and verify token to set as the app's callback. A live number is `WRONG_STATE`. |
| `org.crm.whatsapp.disconnect` | `org crm whatsapp disconnect [--confirm]` | `.whatsapp.disconnect` | flow (new: read, preview, write) over rpc `contacts.whatsapp.disconnect` (new) | People; never the FDE for them | write | Stops every send and delivery; keeps every message. None live is `WRONG_STATE`. |
| `org.crm.whatsapp.show` | `org crm whatsapp show` | `.whatsapp.show` | rpc `contacts.whatsapp.show` (new) | Member | read | The number, its status, webhook URL and last check; never a secret. Null when none. |
| `org.crm.whatsapp.send` | `org crm whatsapp send <record> (--text <message> \| --template <name> [--language <code>] [--param <value>]…) [--to <E.164>] [--in-reply-to <message>] [--confirm]` | `.whatsapp.send` | flow (new: key, preview, send) over rpc `contacts.whatsapp.send` (new) | People; never the FDE for them | vendor | To the record's own number unless `--to`; a text outside the window is `WRONG_STATE`, a template goes. No number connected, or one failing, is `WRONG_STATE`. |
| `org.crm.note.add` | `org crm note add <record> <title> [--content <text>]` | `.notes.add` | flow (new) over rpc `contacts.notes.save` (new) | People | write | An FCRM Note on the record's timeline. |
| `org.crm.note.change` | `org crm note change <note> [--title] [--content] [--clear content]` | `.notes.change` | flow (new) over rpc `contacts.notes.save` | People | write | Changes a note; it keeps its place. A note is never removed (`contacts.notes-kept`). |
| `org.crm.task.create` | `org crm task create <record> <title> [--assigned-to <member>] [--due <time\|day>] [--start <day>] [--priority low\|medium\|high] [--status backlog\|todo] [--description <text>]` | `.tasks.create` | flow (new) over rpc `contacts.tasks.save` (new) | People | write | A CRM Task, Backlog unless Todo. |
| `org.crm.task.change` | `org crm task change <task> [--title <text>] [create's other flags but --status] [--clear <field>]` | `.tasks.change` | flow (new) over rpc `contacts.tasks.save` | People | write | Changes its fields; its status moves only by `move`. |
| `org.crm.task.move` | `org crm task move <task> <Backlog\|Todo\|"In Progress"\|Done\|Canceled>` | `.tasks.move` | rpc `contacts.tasks.move` (new) | People, or the task's assignee for their own (`contacts.task-assignee`) | write | Any status from any, as `org crm lead move` moves a lead; Done records when (`contacts.task-verbs`). |
| `org.crm.task.list` | `org crm task list [--stage open\|working\|done\|cancelled]… [--assigned-to <member>] [--record <record>] [--after] [--limit]` | `.tasks.list` | rpc `contacts.tasks.list` (new) | Member | read | Open and working tasks, soonest due first; filters together. |
| `org.crm.call.log` | `org crm call log <record> --type incoming\|outgoing --status completed\|no-answer\|busy\|failed\|canceled [--number <E.164>] [--start <time>] [--duration <seconds> \| --end <time>] [--note <text>]` | `.calls.log` | rpc `contacts.calls.log` (new) | People | write | A manual CRM Call Log of a call that is over (it ends no later than now; with no `--start`, just now), on the timeline when logged, with its note as an FCRM Note (`contacts.call-logs`). |

Not booked: attachments (named, not kept: `contacts.attachments-later`, for Aaron), pinning a note, telephony, and
field-change history on the timeline (`contacts.timeline`). Inbound email and WhatsApp have no command: they are the
providers' signed webhooks, and on a devnet the world's controls (`capxul-devnet mail receive`, `whatsapp receive`).

### 5.9 HR (`payroll.hr-commands`), owned by payroll, area `payroll`

For Aaron's evening answer (payroll means HR): the HR that changes pay or moves money is native, in Frappe HR's shapes
(Holiday List, Leave Type, Leave Allocation, Leave Application, Shift Type, Shift Assignment, Employee Checkin,
Attendance, Expense Claim Type, Expense Claim, Employee Advance, an advance's Additional Salary, HR Settings;
`payroll.hr-scope`), part of the payroll concept (`payroll.hr-in-payroll`); recruitment, appraisal, training,
onboarding and the leave machinery off the path to a slip stay on the head, reached through 5.7. Payroll is based on
attendance with unmarked days present (`payroll.attendance-based`): an approved leave marks its days, so an unpaid
type's days and every absent day dock the slip that covers them, and `org payroll run create` loses `--unpaid`.

- **Who** (`payroll.hr-approvers`): People keeps the records. The Employee's own commands begin with `hr`, never `org`, and take
  `--employer <handle>`: a write or a balance acts at that employer (absent: their one employer), a list holds every
  employer's and `--employer` filters, as `payroll payslip list`, and a command on one record takes its employer from its id
  (G1); an Employee needs no Seat (`payroll.hr-self`). Leave is decided by a wearer of the Employee's department's hat or one above it, or People.
  Claims and advances are decided and paid by Budget on the department's budget, read on chain. Nobody decides their
  own. Lists of claims and advances: People all, a department's hat its own and below.
- **Money** (`payroll.hr-money`): approving a claim posts its accrual through `books.record-payroll-accrual`; paying a
  claim or an advance is one command through `payments.prepare-command` from the department's budget, one approval,
  resumed when lapsed, followed to paid. An unclaimed advance is recovered from the next slip
  (`payroll.advance-recovery`).
- **Time** (`payroll.hr-world-clock`): a check-in is stamped by the world's clock (a head device's, pulled by the head
  sync, keeps the head's time and is refused when later than the world's now); each shift assignment's process marks
  its days on it, from its start day.

SDK methods are under `client.org(orgId)`, except the Employee's own, under `client.me`. Each command is its rpc,
except the two that pay and `org hr advance settle`, which previews (`payroll.hr-rpc-methods`).

| Id | Command | SDK method | Calls | Who | Budget | Behaviour |
|---|---|---|---|---|---|---|
| `org.hr.holiday.add` | `org hr holiday add (<day> --description <text> \| --weekly <weekday> [--year <yyyy>]) [--half-day]` | `.hr.holidays.add` | rpc `payroll.holidays.add` | People | write | A holiday, or every such weekday of a year as weekly offs, in that year's Holiday List, born with its first. A day already a holiday is `WRONG_STATE`. |
| `org.hr.holiday.remove` | `org hr holiday remove <day>` | `.hr.holidays.remove` | rpc `payroll.holidays.remove` | People | write | The day is a working day again; decided leave keeps its days. |
| `org.hr.holiday.list` | `org hr holiday list [--year <yyyy>]` | `.hr.holidays.list` | rpc `payroll.holidays.list` | Member | read | One year's holidays, weekly offs marked. |
| `hr.holiday.list` | `hr holiday list [--year <yyyy>] [--employer <handle>]` | `client.me.hr.holidays.list` | rpc `payroll.holidays.mine` (new) | Self (the Employee) | read | Your employer's holidays, as a member reads them, with no Seat needed (`payroll.hr-self-rules`). |
| `org.hr.leave-type.add` | `org hr leave-type add <name> [--max-days <n>] [--applicable-after <days>] [--max-continuous <days>] [--carry-forward [--max-carry <n>]] [--without-pay \| --partly-paid <fraction>] [--include-holidays] [--allow-negative]` | `.hr.leaveTypes.add` | rpc `payroll.leave-types.add` | People | write | A Leave Type; every rule off unless given. Earned, compensatory, optional and encashable leave are the head's. |
| `org.hr.leave-type.change` | `org hr leave-type change <type> [add's flags] [--clear <field>]…` | `.hr.leaveTypes.change` | rpc `payroll.leave-types.change` | People | write | Sets the rules given. Turning a type with approved leave paid or unpaid is `WRONG_STATE`. |
| `org.hr.leave-type.list` | `org hr leave-type list [--after] [--limit]` | `.hr.leaveTypes.list` | rpc `payroll.leave-types.list` | Member | read | The leave types and their rules. |
| `hr.leave-type.list` | `hr leave-type list [--employer <handle>] [--after] [--limit]` | `client.me.hr.leaveTypes.list` | rpc `payroll.leave-types.mine` (new) | Self (the Employee) | read | Your employer's leave types and their rules, to choose one for `hr leave apply` (`payroll.hr-self-rules`). |
| `org.hr.leave.allocate` | `org hr leave allocate <employee> --type <type> --days <n> --start <day> --end <day> [--carry-forward] [--description <text>]` | `.hr.leaves.allocate` | rpc `payroll.leave.allocate` | People | write | A Leave Allocation; carried days up to the type's maximum. An overlapping one of the type is `WRONG_STATE`; an unpaid type needs none (`INVALID_INPUT`). |
| `org.hr.leave.unallocate` | `org hr leave unallocate <allocation>` | `.hr.leaves.unallocate` | rpc `payroll.leave.unallocate` | People | write | Cancels an allocation no approved leave draws on. |
| `org.hr.leave.balance` | `org hr leave balance <employee> [--on <day>]` | `.hr.leaves.balance` | rpc `payroll.leave.balance` | People | read | Each type's allocated, taken, pending and left. |
| `org.hr.leave.approve` | `org hr leave approve <application>` | `.hr.leaves.approve` | rpc `payroll.leave.approve` | The Employee's department's hat or one above, or People; never oneself | write | The checks again, then approved, each leave day marked `on_leave` (a half day `half_day`). |
| `org.hr.leave.reject` | `org hr leave reject <application> [--reason <text>]` | `.hr.leaves.reject` | rpc `payroll.leave.reject` | As approve | write | Rejected; nothing taken or marked. |
| `org.hr.leave.list` | `org hr leave list [--employee] [--department] [--status open\|approved\|rejected\|cancelled] [--start] [--end] [--after] [--limit]` | `.hr.leaves.list` | rpc `payroll.leave.list` | People, or a department's hat for its own and below | read | Applications, newest first. |
| `hr.leave.apply` | `hr leave apply --type <type> --start <day> --end <day> [--half-day [--half-day-on <day>]] [--reason <text>] [--employer <handle>]` | `client.me.hr.leaves.apply` | rpc `payroll.leave.apply` | Self (the Employee) | write | An open application; days less holidays unless the type counts them; a paid type within its balance; no overlap. |
| `hr.leave.list` | `hr leave list [--employer] [--status] [--after] [--limit]` | `client.me.hr.leaves.list` | rpc `payroll.leave.mine` | Self | read | Your applications from every employer (`--employer` filters), with who decided and the balance after. |
| `hr.leave.cancel` | `hr leave cancel <application> [--employer]` | `client.me.hr.leaves.cancel` | rpc `payroll.leave.cancel` | Self | write | Open or approved to cancelled, its marks cancelled; unpaid leave a submitted slip counted is `WRONG_STATE`. |
| `hr.leave.balance` | `hr leave balance [--employer] [--on <day>]` | `client.me.hr.leaves.balance` | rpc `payroll.leave.my-balance` | Self | read | Your balances. |
| `org.hr.shift-type.add` | `org hr shift-type add <name> --start <HH:MM> --end <HH:MM> [--auto-attendance] [--half-day-below <hours>] [--absent-below <hours>] [--late-grace <minutes>] [--early-grace <minutes>]` | `.hr.shiftTypes.add` | rpc `payroll.shift-types.add` | People | write | A day Shift Type; added, never changed (`payroll.shift-types`). |
| `org.hr.shift-type.list` | `org hr shift-type list [--after] [--limit]` | `.hr.shiftTypes.list` | rpc `payroll.shift-types.list` | Member | read | Shift types and who works each now. |
| `org.hr.shift-type.assign` | `org hr shift-type assign <type> <employee> --start <day> [--end <day>]` | `.hr.shiftTypes.assign` | rpc `payroll.shift-types.assign` | People | write | A Shift Assignment, whose process marks each day from check-ins when its shift ends. One a day. |
| `org.hr.shift-type.unassign` | `org hr shift-type unassign <assignment>` | `.hr.shiftTypes.unassign` | rpc `payroll.shift-types.unassign` | People | write | No later day is marked by it. |
| `hr.attendance.checkin` | `hr attendance checkin [--log in\|out] [--employer]` | `client.me.hr.attendances.checkin` | rpc `payroll.attendance.checkin` | Self | write | A check-in at the world's clock, in the shift whose window holds now. |
| `hr.attendance.list` | `hr attendance list [--employer] [--start] [--end] [--after] [--limit]` | `client.me.hr.attendances.list` | rpc `payroll.attendance.mine` | Self | read | Your marked days and check-ins, from every employer (`--employer` filters). |
| `org.hr.attendance.mark` | `org hr attendance mark <employee> --on <day> --status present\|absent\|half_day\|work_from_home\|on_leave [--leave-type <type>]` | `.hr.attendances.mark` | rpc `payroll.attendance.mark` | People | write | One mark; a day already marked is `WRONG_STATE`. |
| `org.hr.attendance.cancel` | `org hr attendance cancel <attendance>` | `.hr.attendances.cancel` | rpc `payroll.attendance.cancel` | People | write | The day unmarked; a leave's mark goes only with its leave. |
| `org.hr.attendance.list` | `org hr attendance list [--employee] [--department] [--status] [--start] [--end] [--after] [--limit]` | `.hr.attendances.list` | rpc `payroll.attendance.list` | People | read | Marked days, newest first. |
| `org.hr.expense-type.add` | `org hr expense-type add <name> [--account <code>] [--description <text>]` | `.hr.expenseTypes.add` | rpc `payroll.expense-types.add` | People | write | An Expense Claim Type; null account is books' default (`payroll.expense-types`). |
| `org.hr.expense-type.list` | `org hr expense-type list [--after] [--limit]` | `.hr.expenseTypes.list` | rpc `payroll.expense-types.list` | Member | read | The types and their accounts. |
| `hr.expense-type.list` | `hr expense-type list [--employer <handle>] [--after] [--limit]` | `client.me.hr.expenseTypes.list` | rpc `payroll.expense-types.mine` (new) | Self (the Employee) | read | Your employer's expense claim types, to choose one for `hr expense-claim create --type` (`payroll.hr-self-rules`). No `hr shift-type list`: the Organization's list names who works each shift. |
| `hr.expense-claim.create` | `hr expense-claim create (--type <type> --amount <a> [--on <day>] [--description <text>] \| --file <path>) [--receipt <path>]… [--advance <advance>]… [--remark <text>] [--employer]` | `client.me.hr.expenseClaims.create` | rpc `payroll.expense-claims.create` | Self | write | An open claim in the department budget's token, its receipts stored, settling against named paid advances. |
| `hr.expense-claim.list` | `hr expense-claim list [--employer] [--status] [--after] [--limit]` | `client.me.hr.expenseClaims.list` | rpc `payroll.expense-claims.mine` | Self | read | Your claims, from every employer (`--employer` filters). |
| `hr.expense-claim.get` | `hr expense-claim get <claim> [--employer]` | `client.me.hr.expenseClaims.get` | rpc `payroll.expense-claims.mine-get` | Self | read | One of your claims, with its payment. |
| `hr.expense-claim.cancel` | `hr expense-claim cancel <claim> [--employer]` | `client.me.hr.expenseClaims.cancel` | rpc `payroll.expense-claims.withdraw` | Self | write | An open claim cancelled; a decided one is `WRONG_STATE`. |
| `org.hr.expense-claim.approve` | `org hr expense-claim approve <claim> [--sanction <line>=<amount>]…` | `.hr.expenseClaims.approve` | rpc `payroll.expense-claims.approve` | Budget on the department's; never oneself | chain-read | Approved and its accrual posted; paid at once when its advances cover it. |
| `org.hr.expense-claim.reject` | `org hr expense-claim reject <claim> --reason <text>` | `.hr.expenseClaims.reject` | rpc `payroll.expense-claims.reject` | As approve | chain-read | Rejected; nothing owed. |
| `org.hr.expense-claim.pay` | `org hr expense-claim pay <claim> [--request-key] [--timeout-seconds] [--no-wait]` | `.hr.expenseClaims.pay` | flow `client.org.hr.expense-claims.pay` over rpc `payroll.expense-claims.pay` | Budget on the department's; never oneself | chain-submit | The grand total as one payment command and approval; a lapsed approval resumes the same command. |
| `org.hr.expense-claim.cancel` | `org hr expense-claim cancel <claim>` | `.hr.expenseClaims.cancel` | rpc `payroll.expense-claims.cancel` | As approve | chain-read | An approved, unsent claim cancelled, its accrual and advances' claims reversed. |
| `org.hr.expense-claim.list` | `org hr expense-claim list [--employee] [--department] [--status] [--after] [--limit]` | `.hr.expenseClaims.list` | rpc `payroll.expense-claims.list` | People, or a department's hat | read | Claims, newest first. |
| `org.hr.expense-claim.get` | `org hr expense-claim get <claim>` | `.hr.expenseClaims.get` | rpc `payroll.expense-claims.get` | People, or a department's hat | read | One claim with its receipts and payment. |
| `hr.advance.request` | `hr advance request --amount <a> --purpose <text> [--employer]` | `client.me.hr.advances.request` | rpc `payroll.advances.request` | Self | write | A requested Employee Advance. |
| `hr.advance.list` | `hr advance list [--employer] [--status] [--after] [--limit]` | `client.me.hr.advances.list` | rpc `payroll.advances.mine` | Self | read | Your advances and what is left of each, from every employer (`--employer` filters). |
| `hr.advance.cancel` | `hr advance cancel <advance> [--employer]` | `client.me.hr.advances.cancel` | rpc `payroll.advances.withdraw` | Self | write | A requested advance cancelled. |
| `org.hr.advance.pay` | `org hr advance pay <advance> [--request-key] [--timeout-seconds] [--no-wait]` | `.hr.advances.pay` | flow `client.org.hr.advances.pay` over rpc `payroll.advances.pay` | Budget on the department's; never oneself | chain-submit | Approves and pays it as one payment command and approval. |
| `org.hr.advance.reject` | `org hr advance reject <advance> --reason <text>` | `.hr.advances.reject` | rpc `payroll.advances.reject` | As pay | chain-read | Rejected; nothing paid. |
| `org.hr.advance.settle` | `org hr advance settle <advance> [--confirm]` | `.hr.advances.settle` | flow `client.org.hr.advances.settle` (read, preview, settle) over rpc `payroll.advances.settle` | People | write | After a preview (G5: no command takes the deduction back), what no claim took is deducted from the next slip by an Additional Salary; returned when that slip is submitted. |
| `org.hr.advance.list` | `org hr advance list [--employee] [--department] [--status] [--after] [--limit]` | `.hr.advances.list` | rpc `payroll.advances.list` | People, or a department's hat | read | Advances, newest first. |
| `org.hr.advance.get` | `org hr advance get <advance>` | `.hr.advances.get` | rpc `payroll.advances.get` | People, or a department's hat | read | One advance, what settled it and its payment. |

Spelt against the brief (`payroll.hr-commands`): a record kind is its DocType's kebab name (`leave-type`, `shift-type`,
`expense-type` for Expense Claim Type, `expense-claim`), or a common word, as G2 names Salary Slip `payslip`
(`leave`, its allocations under it as assignments are under `org payroll structure`, and `advance`; the 215 use none
of the three); a leave is born by `apply` and an advance by `request`, their machines' births, as `org agreement
offer` and `request issue` are; `balance` reads a view by its noun, as the 215's `balance`; claiming sends at once,
Frappe's Submit being the approver's; paying an advance approves it. Left out on
purpose (`payroll.hr-command-shape`): a `get` where the list prints the whole record, `change` on shift and expense
types, and leave applied for another (the People hat marks such a day instead).

### 5.10 The devnet's seasons (`devnet.seasons`), owned by devnet, area `devnet`

For `aaron.seasons`: a shared world runs in seasons, like a game. A season starts from a saved world, runs its clock at
a rate, warps on a real schedule, admits only the people its owner names, and ends in a reset: its last state is saved
as `<name>-end` and the reset world restored, frozen, until the next season starts (`devnet.season-reset`). A season's
start, end and warps are real times (`<when>`: an ISO 8601 instant with its zone, or `+<span>`), and seasons never
overlap (`time.season-schedule`). Each command is a request of the supervisor's protocol, `devnet-control`'s season
calls (`devnet.season-protocol`). SDK methods are the devnet entry's (`devnet.seasons.*`), as `dev snapshot` is.

| Id | Command | SDK method | Calls | Who | Budget | Behaviour |
|---|---|---|---|---|---|---|
| `dev.season.create` | `dev season create <name> --snapshot <world> --end <when> [--start <when>] [--rate <n>] [--reset <world>] [--player <email>]… [--warp <when>=<span\|date>]…` | `devnet.seasons.create` | flow `devnet.seasons.create` over `seasonCreate` | World owner | write | A planned season; nothing in the world moves. Its reset is its own `--snapshot` unless `--reset` names the next season's. A name ever used, a window that overlaps, or a player with no world grant is refused. |
| `dev.season.change` | `dev season change <name> [--start] [--end] [--rate] [--reset]` | `devnet.seasons.change` | flow over `seasonChange` | World owner | write | Changes a planned season, or a running one's end and reset; a running season takes no new start or rate (`WRONG_STATE`). |
| `dev.season.start` | `dev season start <name> [--confirm]` | `devnet.seasons.start` | flow over `seasonStart` (with `check`, then without) | World owner | background | After a preview, starts a planned season now: restores its world, runs the clock at its rate, arms its warps and end, admits its players. |
| `dev.season.end` | `dev season end <name> [--confirm]` | `devnet.seasons.end` | flow over `seasonEnd` (with `check`, then without) | World owner | background | After a preview, ends a running season now: closes the gateway to its players, cuts a warp in progress, saves `<name>-end`, restores the reset world. A planned one is `WRONG_STATE`, naming `cancel`. |
| `dev.season.cancel` | `dev season cancel <name>` | `devnet.seasons.cancel` | flow over `seasonCancel` | World owner | write | Takes back a planned season before it runs; nothing in the world changes. A running one is `WRONG_STATE`, naming `end`. |
| `dev.season.show` | `dev season show` | `devnet.seasons.show` | flow over `seasonCurrent` | Anyone in the world | read | The current season (running, else the next planned, else the last ended), whether you play it, its next warp and the clock. |
| `dev.season.list` | `dev season list [--after] [--limit]` | `devnet.seasons.list` | flow over `seasonList` | Anyone in the world | read | Every season of the world, a page at a time: running, planned, then ended and cancelled. |
| `dev.season.warp.add` | `dev season warp add <season> (<span> \| --to <date>) --at <when> [--every <span>]` | `devnet.seasons.warps.add` | flow over `seasonWarpAdd` | World owner | write | Schedules a warp of the world's clock at a real instant, as `dev time warp` warps (a barrier through every due instant), or one each `--every` until the season's end, at most 500. |
| `dev.season.warp.remove` | `dev season warp remove <season> <warp>` | `devnet.seasons.warps.remove` | flow over `seasonWarpRemove` | World owner | write | Takes a scheduled warp out before it runs. |
| `dev.season.player.add` | `dev season player add <season> <email>` | `devnet.seasons.players.add` | flow over `seasonPlayerAdd` | World owner | write | Lets a person who holds a world grant play the season; while it runs, the gateway admits them at once. |
| `dev.season.player.remove` | `dev season player remove <season> <email>` | `devnet.seasons.players.remove` | flow over `seasonPlayerRemove` | World owner | write | Stops a person playing; their next call while it runs is `ROLE_PERMISSION_DENIED`. |

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
  | `payment.claim` | `payment claim [--timeout-seconds] [--json]` | payments (area `payments`) | `client.payments.claim` | flow `client.payments.claim` (new) over accounts' rpc `accounts.setup.collect` (new) | Self: the person whose own Safe owns the escrows | chain-submit | Collects, in one approval, every claim escrow your set-up Safe owns that holds its amount, at any time; answers `nothing_waiting`, `awaiting_approval` or `collected`. Money its sender took back is not offered. |

  The escrow pass booked it as `account collect` under its own pack decision, `accounts.collect-any-time`, which
  cites `aaron.escrow-general`, reading `claim` as already `org board claim` and setup's Companies House claim
  (G3). Aaron's answer of 8 November, night (`aaron.payment-claim`, `docs/decisions/open-for-aaron.md` question
  38): the command is `payment claim` (`payment.claim`, area `payments`), "claim" being the word of
  `aaron.escrow-general`; the sender's take-back stays `payment cancel`. The world pass applied it, book first:
  `accounts.collect-any-time` now chooses it, and payments books the command (`payments.claim-command`) with every
  claim, refusal, world and flag of `account collect`, its flow calling accounts' unchanged rpc. The person still
  names no payment id, since a claim escrow's Payment has no payee tenant until it is collected, and the answer
  still reads `collected`, the escrow's own word (G3).
- **Billing hours** (`aaron.projects`, pack `requests.bill-time`, which is not one of the five). It is respelled by
  G1 and booked by requests.

  | Id | Command | Owner | SDK method | Calls | Who | Budget | Behaviour |
  |---|---|---|---|---|---|---|---|
  | `org.projects.timesheet.bill` | `org projects timesheet bill <timesheet>… [--to <payer>] [--request-key]` | requests (area `payments`) | `client.org(orgId).projects.timesheets.bill` | flow `client.org.projects.timesheets.bill` (new) over rpc `requests.issuing.bill-time` (new), invoking `projects.bill-time` | Invoicing | write | Issues one Invoice for the timesheets' unbilled billable logs, one line per activity and billing rate, in the token of the timesheets' currency (`requests.bill-time-currency`), and marks those logs billed in the same write; `request cancel` and `inbox decline` clear the marks. |

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

## 7. For Aaron: answered

Aaron answered all three on 8 November 2026, night (`docs/decisions/open-for-aaron.md`, questions 36 to 38). The
answers are to apply after this pass, book first; until then each record keeps its booked choice.

1. **Who may talk to the hosted FDE** (`org fde ask`; `organizations.fde-commands`)? Booked: a Director. His answer:
   anyone may, and anyone the management is speaking to; the host passes the asker's Seat, so the FDE does for
   them only what their own hats allow. The FDE is not on the critical path. Applied in the world pass
   (`aaron.fde-anyone`): `org fde ask` is any member's or a named guest's, the FDE acts as the asker
   (`organizations.fde-for-the-asker`), and `org fde guest add|remove|list` and `org fde turn get` are booked
   (`organizations.fde-guests`).
2. **How is hosting paid** (`organizations.fde-hosting`)? Accepted as recommended: in advance, by the month, from
   a budget (`org fde pay [<months>]`), the FDE pausing when its paid-through instant passes.
3. **May a recipient collect waiting money later, by command?** Yes. Booked first as `account collect`
   (`accounts.collect-any-time`); his answer spells it `payment claim` (`aaron.payment-claim`). Applied in the world
   pass: payments books `payment claim` over accounts' rpc (`payments.claim-command`).

## 8. As booked: where the records refined a row

Each row above is the grammar's; where the booking refined it, the record and its decision are the authority.

- **Projects** (5.1):
  - The 19 commands that need People or Director, or Worker for someone else's time, are `chain-read`: they read the
    hat live (`projects.hat-guard`), and refuse `PROVIDER_ERROR` while no chain node answers.
  - `org projects create|change` take `--percent <0-100>` for a project worked out by hand; `org projects task create|change`
    take `--percent` for a task's own figure, printed `percentComplete`; `--progress` names only a project's method
    (`projects.percent-by-hand`).
  - A task's `--start` and `--end` take a day or a time (`projects.dates`).
  - `org projects member add` of a member already shared, and `remove` of one not shared, are `WRONG_STATE`, as `org
    department holder add|remove` are (`projects.refusal-codes`).
  - Completing, resuming or reopening follows ERPNext's rollup: a project its tasks make 100 percent completes, and
    reopening one its tasks still complete is `WRONG_STATE`; a task under review falls overdue once its review day
    has begun (`projects.review-day`); `org projects timesheet log` and `submit` check every log of the draft again
    (`projects.draft-rechecks`); cancelling a timesheet moves a task under review back (`projects.cancel-reads-logs`).
- **CRM** (5.2):
  - `org crm lead list` leaves converted leads out; `--stage converted` lists them (`contacts.lead-list-like-frappe`).
  - `org crm deal list`'s filters apply together (`contacts.deal-list-filters`).
  - `--owner` is a member by email or an agent's @handle (`contacts.crm-verbs`).
  - A conversion's person is the entry given, else the book's Contact that keeps the lead's mailbox, else that
    mailbox's Party's entry (`contacts.convert-by-kept-mailbox`).
  - `contact create` with a person whose mailbox's Party is already in the book is `INVALID_INPUT`, never merged;
    `contact link` refuses a Party of the other kind (`contacts.book-verbs`).
  - `contact link`'s rpc refuses the hosted FDE's call for its asker, as every command that previews does (G4,
    `contacts.sends-preview`).
- **CRM conversations** (5.8):
  - `org crm timeline <record>` is a view read by its noun, as `org cap-table` and `activity events` are; its method is
    `client.org(orgId).crm.timeline` (`contacts.conversation-spelling`).
  - A reply is `--in-reply-to <id>` on both sends (Frappe's `in_reply_to`), since G5's `<email>` is a mailbox and
    `--reply-to` is the Reply-To header; a note's title is its second argument, as a task's is; a task's member is
    `--assigned-to` on create, change and list; `org crm task change` takes `--title`; a task's due time is `--due`
    (CRM Task's `due_date`), beside `--by` and `--close-by` (`contacts.conversation-spelling`).
  - A CRM task moves with `move`, as leads and deals do (`contacts.task-verbs`), and its assignee may move their own
    without the People hat (`contacts.task-assignee`).
  - The sends and WhatsApp's connect and disconnect preview, so their rpcs refuse the hosted FDE's call for its asker:
    the FDE drafts and the member sends (`contacts.sends-preview`).
  - Five are one rpc each and have no flow (G7): the timeline, `whatsapp show`, `task move`, `task list` and `call log`.
- **Payroll** (5.3):
  - Every command is a flow, `org hr employee get` included (`payroll.command-flows`).
  - The four org lists take `--after` and `--limit`; `--last-name` is optional; a component is named by its
    abbreviation (`payroll.command-fit`).
  - `org payroll structure unassign` is `WRONG_STATE` while a slip that is not cancelled names the assignment; a
    component change reaches only structures made after it; `--frequency` defaults to monthly
    (`payroll.command-details`).
  - A repeated `disable` or `enable`, and `--amends` on a structure assignments still name, are `WRONG_STATE`.
  - `org payroll run pay` prints `status`, `approvalId`, `approvalUrl`, `expiresAt`, the run and `next`; a run the
    company Safe cannot cover is `INSUFFICIENT_BALANCE` (`payroll.run-pay-codes`); `--request-key` is kept on the run
    (`payroll.run-request-key`); a declined approval returns the run to submitted (`payroll.declined-run-approval`).
  - `org payroll structure assign --department` must be the Employee's own (`payroll.run-employees`).
- **Apps, the head and the FDE** (5.4): `org head app list` pages; `org head disconnect` is a flow; `org head connect`
  reads the head and the apps first and takes its files in the forms `organizations.head-commands` gives; `org fde
  ask` defaults to a 300-second deadline and ends a failed turn with `PROVIDER_ERROR`; the FDE's host is the
  integration `fde-host` (`organizations.fde-host`).
- **Buying from Capxul** (5.5): each purchase is payments' own rpc (`payments.seat-purchase`,
  `payments.fde-hosting-purchase`); `--no-wait` alone hands over (`payments.seat-hand-over`); a lapsed seat
  purchase's `payment retry` needs the People hat, a hosting payment's a person (`payments.seat-authority`).
- **Section 6:** `payment claim`, as Aaron spelled it, takes no payment id and no `--request-key`, and is payments'
  flow over accounts' rpc (`accounts.collect-any-time`, `payments.claim-command`); `org projects timesheet bill` is its own rpc
  (`requests.bill-time`, `requests.bill-time-currency`).
- **The document family** (5.7): every call carries the roles the member's hats give at that call
  (`organizations.doc-authority`); `--filter` takes `=`, `!=`, `>`, `>=`, `<`, `<=`, `~` and `!~`; `--set` values are
  text the head reads as its field's type, and override `--file`'s fields of that name; the money refusal follows the
  ledger hooks, `repost_allowed_doctypes`, Repost Item Valuation and Frappe Lending's Loan Management
  (`organizations.doc-reach`); a retry under the same call id completes a call the head never answered
  (`organizations.doc-log`).
- **HR** (5.9): an Employee's own lists cover every employer and `--employer` filters (`payroll.hr-self`); `org advance
  settle` previews (`payroll.advance-recovery`); a check-in from a head's device keeps the head's time, refused when
  later than the world's now (`payroll.hr-world-clock`).
- **Seasons** (5.10): a season's start and end restore a world, so `snapshotRestore` and `timeStartAt` are
  `WRONG_STATE` while a season runs (`devnet.season-reset`); a stateful follower (a real bench, the FDE namespace)
  saves and restores its own state with every world (`devnet.stateful-followers`); a player's session is unknown after
  a reset, so their next call is `NOT_AUTHENTICATED` and they sign in again from the sink (`time.seasons`).
- **Priority:** 36 commands are `critical` by their packs' decisions (G8): 11 of projects', 6 of the CRM's, 10 of
  payroll's, 7 of HR's and 2 of organizations'.
