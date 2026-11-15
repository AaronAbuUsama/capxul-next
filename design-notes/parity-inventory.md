# Feature-parity inventory: old Capxul stack against the rebuild (`master`)

Research of 14 November 2026. Read-only. Paths are given per source:

- `infra:` is `/home/user/infrastructure`, the xelmar-tech/infrastructure repository. Its checkout is `claude/epic-allen-0n48sq`, at `a5ad1855` (a merge of PR #3249). It is a Convex backend with 17 concepts (`CONTEXT-MAP.md`), a Core SDK, a React SDK, a CLI, an MCP server, a Claude plugin, an indexer, the contracts and a devnet. This is the old production stack. Its own scenario runner, the Acme saga in `infra:packages/scenarios/src/acme/s1..s8`, marks all 201 of its steps `runs-today` on a devnet. Production was never provisioned: steps s1.22 and s1.23 assert that `--env production` is refused.
- `main:` is `origin/main` of capxul-next, read with `git show`. It is the Frappe-direction line of 9 to 13 November. It holds the old blueprint records (`main:blueprint/`), the frozen old book (`main:blueprint/baseline/operations.ts`, 215 operations), the cut (`main:blueprint/shared/cut.ts`), Aaron's rulings (`main:blueprint/shared/rulings.ts`) and the plan (`main:plan/`). It also holds code: a Postgres/Effect Core (`main:packages/backend`), a Frappe app (`main:packages/frappe-app`) and a thin-line spike that passes 10 of 12 tests (`main:evals/thin-line.md`, `main:START-HERE.md`).
- `wave0:` are the 56 open pull requests into `integration/wave-0` (listed with `gh api .../pulls?base=integration/wave-0`). They are reference ports, frozen by the roadmap decision "The Amp wave".
- `rebuild:` is the checked-out branch, `master` plus one rules commit (`b484f8d1`): `packages/blueprint` (12 operations, 10 starting worlds, 53 claims) and `packages/scenarios` (3 journeys).

Status codes used below:

- **L**: live code in infra. The code exists on infra's release trunk, and the Acme saga step or the capability matrix named alongside it runs today. It is proven on a devnet or staging, never in production.
- **M**: code on main: the Frappe/Core spike or a main package.
- **B**: a blueprint record only: an operation or journey record on main, or the frozen old book.
- **P**: a plan, ADR or ruling only.
- **W**: a wave-0 reference PR exists.
- **R**: the rebuild covers it today.

## 1. Capabilities by domain

### 1.1 Worlds, clock, record (the platform)

| Capability | What it does | Status | Evidence |
|---|---|---|---|
| Create, show and destroy a world | A private world (chain, index, bundler, database, Core, sites) is one unit with an owner, a lifetime and a quota | R, M, L (devnet only) | rebuild `packages/blueprint/src/world/operations.ts`; `main:blueprint/devnet/world-ops.ts`; infra `apps/cli/src/commands/dev/world.ts` |
| Clock warp | Moves the chain, Core and every site forward together, and runs due jobs | R, M, L | rebuild `world.clock.warp`; infra Acme `warpTo` (`packages/scenarios/src/acme/support.ts`) |
| Snapshot save and restore | Branches a world (database, chain, sites) into another world | R, M, L | rebuild `world.snapshot.*`; infra `restoreWorld("after-s3")` in the Acme files |
| Record export | Reads every event of a world in order, with its lineage | R, M | rebuild `src/record/operations.ts`; `main:evals/thin-line.md` row 9 |
| World list, register, snapshot list, record list and show | Further world reads and admin | B | `main:blueprint/devnet/world-ops.ts` (10 operations) |
| Devnet tools | Fund with test money, set USD prices, set feature gates, approve as someone, run jobs, read the mail sink and fail the next mail, get a dev key | L, B | infra `apps/cli/src/commands/dev/{fund,prices,gates,mail,key}.ts`; `main:blueprint/devnet/operations.ts` (7 operations) |
| Cohorts and seats in a world, learner environment, park and wake | An organiser runs a cohort; an agent plays a seat; an RL-style reset, step and close; an idle world is parked | B, P | `main:blueprint/devnet/platform-journeys.ts` (6 journeys) |
| Operator tools | Diagnostics, receipt holds, proof identities, faucet, tenancy probes | L | infra `packages/backend/src/operator/README.md`; `packages/protocol/src/operator/operations.ts` |

### 1.2 Sign-in and identity

| Capability | What it does | Status | Evidence |
|---|---|---|---|
| Email OTP sign-in, verify, logout, list, switch person | A person signs in with a code from their email; several people can be signed in on one machine | L | infra `apps/cli/src/commands/auth/*`; matrix "Email OTP" (`apps/docs/content/docs/capability-status.mdx`); Acme s1.2, s1.3, s1.11 |
| whoami, `use personal`, `use org`, `use env` | Chooses who to act as and which environment to use | L | infra `apps/cli/src/commands/{whoami,use}` |
| Native client and agent authorization | The CLI's device flow; OAuth for MCP clients | L | infra `packages/backend/src/access/README.md` |
| Feature gates | Turns a feature on or off per Organization (for example `payment-departments`) | L, M, B | infra `access.features.set`; Acme s2.14 and s2.15; `main:packages/frappe-app/capxul/features.py`; `main:blueprint/sites/operations.ts` (`org.feature.on/off/list`) |
| Profile and onboarding | Display name, country, photo, handle availability, onboarding complete | L | infra `packages/protocol/src/profiles/operations.ts`; `apps/cli/src/commands/home` |
| Media | Upload a profile image or an Organization logo | L | infra `packages/backend/src/media/README.md` |
| Waitlist, referral and invites grant | Beta admission and referrals | B (parked) | `main:blueprint/shared/cut.ts` (`cut.individuals`, 6 operations) |
| Real sign-in for people in the rebuild | Real people, not the seeded cast | P | rebuild `docs/roadmap.md`, risk "Real sign-in and signing for people: Open"; ruling `aaron.sign-in-is-core` |

### 1.3 Accounts and Safes

| Capability | What it does | Status | Evidence |
|---|---|---|---|
| Personal Safe and Account | One Safe per person per chain; the claim installs their signer; `account show` and `account retry` | L, M | infra `packages/backend/src/accounts/README.md`; `main:packages/backend/src/accounts`. The rebuild's cast gets claimed Safes inside `world.create` (rebuild `starting-worlds.ts`, `fresh`), but no operation does it |
| Balance and address | Live balance read; deposit instructions | L | infra `accounts.balances.read`, `accounts.summaries.depositInstructions`; CLI `balance`, `address` |
| Approvals (sign on the approval page) | A prepared money action waits for the person's own signature | L, M, R, W | infra `accounts.approvals.*`; rebuild `approval.sign`; wave0 #120, #127, #132, #136, #140, #150, #166 |
| Sponsored UserOperations (bundler and paymaster) | Capxul pays the gas | L, R | rebuild roadmap step 1.11; infra `packages/aa-gateway` |

### 1.4 Company founding and governance (owners, Board, hats)

| Capability | What it does | Status | Evidence |
|---|---|---|---|
| Found an Organization | Safe deployed with its founders; durable setup that can be resumed (`org create/retry/wait/show/list/me`) | L, M, R | infra `organizations.setups.*`, Acme s1.4 and s8.5; rebuild `org.create` (2-of-2 Directors, capital, site) |
| Safe owners and threshold | Add, remove or replace an owner; change the threshold | L | infra CLI `org owner add/remove/replace/threshold/list`; Acme s1.15 and s1.16 |
| Proposals | Propose, approve, reject, wait, list, get; a replaced proposal is detected at its nonce | L, M, W | infra `organizations.proposals.*`, Acme s1.17, s1.18 and s7.18 to s7.22; wave0 #106 `board/carry`, #115 `core/board-readers` |
| Board, Directors and hats | Directors as hats, Board handover and claim, refresh | B, M | `main:blueprint/board/operations.ts` (19 operations); `main:packages/backend/src/board` |
| Grant and revoke permission hats | Manage books, issue invoices, manage people; roles follow on the Frappe site | R (grant), L (`org member grant/revoke`), M | rebuild `org.member.grant` (`values.ts` `Permission`); `main:packages/frappe-app/capxul/hats.py` |
| Hat and role drift, event delivery | `org roles show/drift`, `org events status/retry/resend`, `org site link` | B, M | `main:blueprint/plugs/operations.ts` (8 operations) |
| Votes | Create, cast, delegate, execute | B (parked with equity) | frozen book, area `governance` (`org vote *`, `vote *`) |
| Audit log | Organization audit log | L (stub: always `NOT_IMPLEMENTED`) | infra matrix row "Organization audit log" |

### 1.5 People and roles

| Capability | What it does | Status | Evidence |
|---|---|---|---|
| Invitations | Invite to a Seat; the invitee lists invitations and accepts with the offer digest, or declines; resend, cancel, retry, preview | L, B | infra `organizations.invitations.*`, CLI `org-invite/*`; Acme s1.9 to s1.13 and s2.2 to s2.9 |
| Members and Seats | Member list and get; Seats; ten seats per company, and buying more | L (list), B, P (seats) | infra `organizations.members.list`; `main:blueprint/payments/operations.ts` `org.seats.buy`; rulings `aaron.seats`, `aaron.buy-seats` |
| Founding members | People seated at founding with no permission | R | rebuild `src/organizations/operations.ts` line 90 |

### 1.6 Budgets and departments (permissions on chain)

| Capability | What it does | Status | Evidence |
|---|---|---|---|
| Spending budgets ("allowances", later "permissions") | Create a budget with a cap and refill, assign it to a member, change, revoke, replace the Roles module; budget left | L, B | infra `permissions.*` and CLI `org permission *`; Acme s2.10 to s2.12, s8.9 and s8.14; frozen `org allowance *` |
| Departments | Create, list, show; add and remove holders; set budget; set, freeze and unfreeze the payout ceiling; close and reopen | L, B | infra `payroll.departments.*`, CLI `org department *`; Acme s2.16 to s2.21, s6.2, s6.3, s7.4 to s7.11 and s7.26 to s7.29 |
| Pay from a department or budget | A holder pays within the department or budget, with no Owner signature | L, B, W | infra `payments.commands.prepareOrganization`; Acme s8.9; `main:` `org.department.pay`; wave0 #98, #128 |

### 1.7 Payroll

| Capability | What it does | Status | Evidence |
|---|---|---|---|
| Agreements (employer side) | Offer a salary, daily early access, a stream or a weekly retainer; withdraw; change the rate (raises; one lowering at a time); pause, resume, end; list | L, B | infra `payroll.agreements.*`, CLI `org agreement *`; Acme S3, S5, S6 |
| Agreements (payee side) | Read the terms hash, accept, collect released pay, list and show; an Organization can be the payee | L, B | infra CLI `agreement accept/collect/list/show`; Acme s3.12 to s3.23, S4, s8.20, s8.21 and s8.28 |
| Offer lapse and fixed terms | An offer expires after 14 days; a fixed term reserves only what it will pay | L | Acme s3.20, s3.21 and S6 |
| Pay runs and saved groups | A one-off pay run (bonuses) approved once; saved rosters; rate in force | L | infra `payroll.runs.*`, `payroll.groups.*`, `payroll.terms.list`; CLI `org payroll run/groups/terms`; Acme s8.15 |
| Local payroll depth (tax, statutory deductions, filings) | Payroll calculated in Frappe HR | P | `main:GROUNDING.md`; rulings `aaron.frappe-shape`, `aaron.jurisdiction-open` (no jurisdiction chosen) |

### 1.8 Payments and recipients

| Capability | What it does | Status | Evidence |
|---|---|---|---|
| Send a payment | Personal or Organization; `payment send/get/list/wait/retry`; one signed payment that Capxul sends once (ADR-0036) | L (personal), Partial (an Organization actor is `NOT_IMPLEMENTED` per the matrix), B | infra `payments.*`, CLI `payment *`; matrix "Partial branches" |
| Pay a supplier from Frappe | Purchase Invoice, then Payment Entry, held for the Safe signer, signed, posted once | R, M, W | rebuild journey `pay-and-branch.ts`; `main:evals/thin-line.md` rows 4 to 7; wave0 #77, #80 |
| Contacts and address book | Add, label, hide, unhide, list, get; save a contact's bank account | L, B | infra `parties.contacts.*`, CLI `contact *`; `main:blueprint/contacts/operations.ts` (CRM shape, ruling `aaron.crm-frappe-shape`) |
| Recipients and handles | Resolve a handle, email, address or Party to a recipient; destinations (bank, mobile money, wallet metadata) | L, Partial | infra `parties.recipients.*`, `parties.destinations.*`; matrix "Handles and saved payees: Partial" |
| Escrow for people with no account | Pay someone with no account; they claim it later, or the sender reclaims | P, B, W | ADR `infra:docs/adr/0035-capxul-escrow-owned-by-the-sender.md`; ruling `aaron.escrow-general`; `main:` `payment.claim`; wave0 #145, #146 |
| Scheduled and streamed payments | Pre-signed scheduled payments; streams as payee-held allowances | P (refused today), W | ADR-0034 and ADR-0037; infra `packages/backend/src/payments/README.md` line 132 ("refuses `scheduled` and `stream`"); wave0 #128 |
| Quotes and fees | A signed deal with an on-chain fee leg | L (partial) | infra `payments.quotes.quote`; ADR-0026 |
| Nonce lanes | Parallel payment nonce lanes | L | ADR-0032 |

### 1.9 Getting paid (receivables)

| Capability | What it does | Status | Evidence |
|---|---|---|---|
| Requests and invoices | Issue, list, get, cancel; the payer's inbox: list, get, pay, decline | L, B | infra `requests.receivables.*`, `requests.inboxes.*`, CLI `request *`; Acme s8.7 to s8.9 |
| Offers (fixed-price products) | Create, revise (immutable revisions), deactivate, list | L, B (parked as `service`) | infra `requests.offers.*`, CLI `offer *`; `main:` cut `cut.requests` |
| Pay by link (checkout) | Anyone holding a link pays an Offer, Invoice or request from their own wallet; verified on chain | L | infra `requests.checkouts.*`; `infra:docs/planning/invoice-payments/` |
| Money-waiting email and reminders | Tells both sides that escrowed money is waiting | P | rulings `aaron.money-waiting`, `aaron.money-waiting-reminders` |

### 1.10 Banking and treasury (Bridge)

| Capability | What it does | Status | Evidence |
|---|---|---|---|
| Identity and business verification (KYC/KYB) | `verify start/status`, through Bridge | L (devnet stand-in) | infra `parties.verifications.*`; Acme s8.22 |
| Bank details and deposits (on-ramp) | Issued bank details per currency; deposits listed, matched to a request, settled | L (stand-in) | infra `banking.*` (`packages/backend/src/banking/README.md`); CLI `bank details/deposits/match/settle` |
| Bank accounts and payouts (off-ramp) | Save a bank account; `bank pay` USDC to a bank at a quoted rate; a webhook marks it delivered | L (devnet, stand-in) | infra CLI `bank accounts add/remove`, `bank pay`; Acme s8.23 to s8.25. The matrix (dated 10 August) still says "Missing", so it is older than this code |
| Treasury read and a reserve Safe | The Organization's treasury; moving funds to a second Safe | L | infra `organizations.treasuries.read`; Acme s7.13 |
| Real Bridge in the rebuild | Real money | P | rebuild `docs/roadmap.md` phase 4, risk "Bridge banking: Open" |

### 1.11 Books and accounting

| Capability | What it does | Status | Evidence |
|---|---|---|---|
| Activity feed | List, get and summarize Payments and Movements; follow events | L | infra `activity.items.*`, CLI `activity *`; Acme s4.7 and s8.26 |
| Annotate a row with its account | A member gives each activity row an account | L, W | infra `activity.annotations.save`; wave0 #94 |
| Chart of accounts, review queue, Manage books, assets, facts | Import and edit the chart, review, keepers (grant and revoke), tokens to record, the fact log, set a price | L, B | infra `books.*`, CLI `org books *`; ADR-0042 |
| Reports (trial balance, P&L, balance sheet, reconcile against the Safe) | Old Capxul reports; on main the cut sends them to ERPNext through the door | B ("reached" by Frappe), R (`report.run`) | `main:blueprint/shared/cut.ts` (`cut.books`); rebuild `src/reports/operations.ts` |
| QuickBooks export | Export the books | Dropped | `main:` cut (`org.books.export.quickbooks`) |
| Movements (outside money) and drift | Chain transfers indexed into Movements; drift corrected against the indexer | L, W | infra `packages/backend/src/indexing/README.md`; wave0 #124 |
| Books agree with the chain | After a payment, the site's ledger matches the chain | R, M | rebuild `pay-and-branch.ts` step 6 |

### 1.12 Documents and the Frappe door

| Capability | What it does | Status | Evidence |
|---|---|---|---|
| Payment documents | Exact invoice content and its hash; get, verify, render to PDF, export; Memos on Movements | L, B, W | infra `packages/backend/src/documents/README.md`; wave0 #172 |
| Generic Frappe door | `doc types/schema/list/get/create/update/delete/submit/cancel/amend/next/call`; `report list/run` | R (create, submit, report), B (the rest), M | rebuild `doc.create`, `doc.submit`, `report.run`; `main:blueprint/sites/operations.ts` (doorOp list) |
| Company site lifecycle | Open, show and retry a site; features on and off | R (inside `org.create`), B, M | `main:blueprint/sites/operations.ts`; rebuild roadmap 1.4 and 1.17 |
| CRM, Projects, HR and the rest of ERPNext | Leads, pipelines, projects; "every organization starts with Projects" | P | rulings `aaron.projects`, `aaron.crm-frappe-shape`, `aaron.frappe-shape`; `main:GROUNDING.md` ("our CRM, enrichment, agents") |
| Stays true when broken | A revert, a repeated event and Frappe being down all end consistent | B, M (spike B4) | `main:blueprint/sites/journeys.ts`; `main:evals/thin-line.md` |

### 1.13 Agents and developers

| Capability | What it does | Status | Evidence |
|---|---|---|---|
| Agents with their own Safe | Create, show, list, rotate key, freeze, unfreeze, sweep, remove | B | `main:blueprint/agents/operations.ts` (8 operations); frozen book. There is no `agent` command in infra's CLI today |
| Agents through MCP and the plugin | MCP tools (auth, account, Organization reads, dev tools); Claude Code plugin skills | L | infra `apps/mcp`, `apps/plugin`; matrix (MCP is development-gated) |
| Hosted FDE agent | Every Organization's forward-deployed engineer agent | P (parked) | rulings `aaron.fde-*`; wave0 #61 |
| Vending Bench | An agent runs a business with Capxul money | L | infra `packages/vending-bench/README.md` |
| Applications and keys | Register an app; mint, rotate and revoke publishable keys; browser bootstrap | L | infra `applications.*`, CLI `doctor`, `schema`, `config telemetry *` |
| SDK, React SDK, CLI | Typed clients | L; rebuild has SDK and CLI for its 12 operations | infra `packages/sdk`, `packages/sdk-react`; rebuild `packages/sdk`, `packages/cli` |

### 1.14 Parked or dropped

- Equity: 30 frozen operations (SAFE rounds, priced rounds, cap table, options, shares, exits, votes), parked by `cut.equity`, which covers 38 entries in `main:blueprint/shared/cut.ts`.
- Individuals (waitlist and referral): parked.
- Services: parked into ERPNext Item.
- QuickBooks export: dropped.
- Cards and a components package: missing everywhere (infra matrix).

## 2. Proposed journeys

Each journey has 5 to 10 operations, named in the rebuild's style. Operation names not yet in the rebuild are proposed and marked *(new)*. A starting world not yet declared is marked *(new)*. "Source" names where the old behaviour is.

| # | Journey | Operations in order | Starting world | Source | Rebuild |
|---|---|---|---|---|---|
| J0a | two operators and their worlds | world.create, world.show, record.export, world.clock.warp, world.snapshot.save, world.snapshot.restore | quota-full | — | **Covered** |
| J0b | found Northwind and give sam the books | org.create, approval.sign, world.show, org.member.grant, approval.sign, doc.create, report.run | fresh | Acme S1 (part) | **Covered** |
| J0c | pay Brightside and branch the books | doc.create, doc.submit, snapshot save/restore, approval.sign, report.run, world.clock.warp, record.export | payment-drafted | `main:` thin line | **Covered** |
| J1 | sign up and get a Safe | person.signup *(new)*, person.verify *(new)*, whoami *(new)*, account.show *(new)*, account.ready *(new)*, balance.read *(new)*, test.fund *(new)* | an empty world with no cast *(new)* | Acme s1.2 and s1.3; `main:` `get_started` | No |
| J2 | invite the team | org.member.invite *(new)*, invite.list *(new)*, invite.accept *(new)*, invite.decline *(new)*, org.invite.cancel *(new)*, org.member.list *(new)*, org.member.grant | founded | Acme s1.9 to s1.13 and s2.2 to s2.9; `main:` `run_company` | No |
| J3 | govern the Board | org.owner.add *(new)*, approval.sign, org.threshold.set *(new)*, org.proposal.list *(new)*, org.payment.propose *(new)*, org.proposal.reject *(new)*, org.member.revoke *(new)* | founded | Acme s1.14 to s1.18 and s7.18 to s7.22; `main:` `govern_company` | Partly (founding sets 2-of-2) |
| J4 | give a budget and spend from it | org.budget.create *(new)*, approval.sign, org.budget.show *(new)*, budget.pay *(new)*, org.budget.change *(new)*, org.budget.revoke *(new)* | founded (funded) | Acme s2.10 to s2.12, s8.9 and s8.14 | No |
| J5 | get paid by a customer | doc.create (Sales Invoice) or request.issue *(new)*, inbox.list *(new)*, inbox.pay *(new)*, inbox.decline *(new)*, request.cancel *(new)*, report.run | founded plus a second company *(new)* | Acme s8.4 to s8.9; `main:` `get_paid` | No (`issue-invoices` hat exists) |
| J6 | close the month | activity.list *(new)*, activity.annotate *(new)*, books.review *(new)*, report.run (TB, P&L, BS), document.verify *(new)*, record.export | paid | `main:` `close_the_books`; Acme s8.26 | Partly (`report.run`) |
| J7 | pay someone with no account | contact.add *(new)*, payment.send *(new)*, approval.sign, payment.claim *(new)*, payment.cancel *(new)*, activity.list | paid | ADR-0035; `aaron.escrow-general`; `main:` `pay_someone` | No |
| J8 | set up a department | org.department.create *(new)*, approval.sign, org.department.show *(new)*, org.department.holder.add *(new)*, org.department.budget.set *(new)*, org.department.list *(new)* | founded (gate on) | Acme s2.13 to s2.21 and s6.2, s6.3 | No |
| J9 | hire: offers and acceptance | agreement.offer *(new)*, agreement.withdraw *(new)*, agreement.terms *(new)*, agreement.accept *(new)*, world.clock.warp (lapse), org.agreement.list *(new)* | department *(new)* | Acme S3 | No |
| J10 | the first month of pay | world.clock.warp, agreement.show *(new)*, agreement.collect *(new)*, activity.list *(new)*, org.department.show *(new)* | hired *(new)* | Acme S4 | No |
| J11 | changes during the year | agreement.change *(new)*, agreement.pause *(new)*, agreement.resume *(new)*, agreement.end *(new)*, org.department.holder.remove *(new)*, agreement.collect | hired | Acme S5 and S6 | No |
| J12 | when money controls say no | org.department.budget.set, org.department.ceiling.freeze *(new)*, agreement.collect (refused), ceiling.unfreeze *(new)*, org.proposal.reject, payment replaced at its nonce | hired | Acme S7 | No |
| J13 | a pay run | payroll.group.save *(new)*, payroll.run *(new)*, approval.sign, payroll.show *(new)*, activity.list | hired | Acme s8.14 and s8.15 | No |
| J14 | money in by bank | verify.start *(new)*, verify.status *(new)*, bank.details *(new)*, bank.deposits *(new)*, bank.match *(new)*, bank.settle *(new)* | founded plus a Bridge stand-in *(new)* | `main:` `money_in`, `get_verified`; infra banking | No |
| J15 | cash out to a bank | bank.account.add *(new)*, bank.pay *(new)*, approval.sign, bank.payout.show *(new)*, bank.account.remove *(new)* | paid plus a Bridge stand-in | Acme s8.22 to s8.25 | No |
| J16 | two companies trade | org.create (second), agreement.offer to an Organization, agreement.accept (an Owner proposal), approval.sign, agreement.collect | hired | Acme s8.4, s8.5, s8.20, s8.21 and s8.28 | No |
| J17 | outside money lands | (a chain transfer into the Safe), activity.get *(new)*, memo.read *(new)*, activity.annotate, report.run | paid | wave0 #124; infra indexing | No |
| J18 | delegate to an agent | agent.create *(new)*, agent.show *(new)*, agent.pay *(new)*, agent.key.rotate *(new)*, agent.freeze *(new)*, agent.sweep *(new)*, agent.remove *(new)* | founded | `main:` `delegate_to_agent` (blueprint only) | No |
| J19 | work the CRM and projects through the door | doc.create (Lead), doc.update *(new)*, doc.list *(new)*, doc.submit, doc.get *(new)*, report.run | office-holder | rulings `aaron.projects`, `aaron.crm-frappe-shape` (plan only) | Partly (`doc.create`, `report.run`) |
| J20 | features and hats stay in step | org.feature.on *(new)*, org.feature.list *(new)*, org.roles.show *(new)*, org.roles.drift *(new)*, org.events.status *(new)*, org.events.retry *(new)* | office-holder | `main:blueprint/{sites,plugs}`; `main:` `grant_hat_in_frappe` | No |
| J21 | stays true when broken | doc.submit, approval.sign (revert), approval.sign (repeat), (site down), org.events.retry, report.run | payment-held | `main:` `stays_true_when_broken` | No |
| J22 | build on Capxul | app.register *(new)*, key.create *(new)*, key.rotate *(new)*, key.revoke *(new)*, doctor *(new)*, schema *(new)* | nothing | `main:` `build_on_capxul`; infra applications | No |
| J23 | scheduled and recurring payments | payment.schedule *(new)*, world.clock.warp, payment.show, payment.reschedule *(new)*, payment.cancel | paid | ADR-0034 and ADR-0037; wave0 #128 | No (plan only everywhere) |
| J24 | sell by link | offer.create *(new)*, offer.revise *(new)*, checkout.create *(new)*, checkout.pay *(new)*, checkout.reconcile *(new)*, offer.deactivate *(new)* | founded | infra requests offers and checkouts | No |
| J25 | seats and the profile | profile.update *(new)*, handle.check *(new)*, image.upload *(new)*, org.seats.show *(new)*, org.seats.buy *(new)* | founded | infra profiles and media; rulings `aaron.seats`, `aaron.buy-seats` | No |
| J26 | an agent plays a seat in a cohort | world.invite *(new)*, world.join *(new)*, (seat work through the CLI), record.export, world.park *(new)*, world.wake *(new)* | fresh | `main:blueprint/devnet/platform-journeys.ts` | No |

Not proposed: equity (parked), waitlist and referral (parked), QuickBooks export (dropped), cards (missing).

## 3. Dependencies between journeys

- J0a comes before everything (worlds). J0b comes before every company journey. J0c comes before J6, J7, J15, J17, J21 and J23 (they need `paid` or `payment-held`).
- J1 (sign up) comes before J2: an invitee must become a person. Today the cast is made inside `world.create`, so J2 could start from the seeded cast and J1 could come later. That depends on a design choice (see section 6).
- J2 comes before J3 (a co-owner must be a member) and J4 (a budget holder must be a member).
- J3 comes before J12 (reject and nonce replacement).
- J4 comes before J5's pay-from-budget variant, and before J13 (a bonus run is paid from a budget in Acme s8.14).
- J8 → J9 → J10 → J11 → J12 is the payroll chain (Acme S2 → S3 → S4/S5/S6 → S7). J13 and J16 need J9.
- J5 needs a second company, which is cheap once J0b exists: org.create run again.
- J14 and J15 need a Bridge stand-in in the world (a new part of the world). Real money is phase 4.
- J6 needs J0c. It is richer after J5 and J17 add revenue and outside money.
- J18 needs J4: an agent spends "within its limits", which are budgets.
- J19 and J20 need only `office-holder`. J21 needs `payment-held`.
- J26 needs J1, or an agent sign-in, and a world-invite design.

## 4. Proposed order for Capxul's own company to run on Capxul

My judgement: the goal is "Capxul's own company runs on Capxul" (rebuild `docs/roadmap.md`), and `main:GROUNDING.md` names "our CRM, enrichment, agents and banking". This order is a guess shaped by those two sources, not a decided order.

1. **J2 invite the team.** Capxul's staff must be members before anything else is theirs.
2. **J3 govern the Board.** Real money needs owners and a threshold that the founders control, plus the ability to reject a bad payment.
3. **J1 sign up and get a Safe.** Real staff are not the seeded cast. It can be built while real sign-in (phase 4) waits, with the OTP sent to the world's mail sink.
4. **J5 get paid by a customer.** Revenue first. The `issue-invoices` hat already exists in the rebuild (`values.ts`).
5. **J6 close the month.** Builds on `report.run`. It is the monthly proof that the books agree with the chain, which phase 4's "runs a month" needs.
6. **J4 give a budget and spend from it.** Staff pay small costs without both founders signing every time.
7. **J7 pay someone with no account.** Contractors and suppliers outside Capxul. It needs the escrow contract (wave0 #145 and #146).
8. **J8 set up a department, then J9 hire.** These are the base of payroll.
9. **J10 the first month of pay.** Paying Capxul's own people is the core of "runs on Capxul".
10. **J11 changes during the year and J12 when controls say no.** Raises, leavers and freezes happen within months.
11. **J13 a pay run.** Bonuses and one-off pay.
12. **J14 money in by bank and J15 cash out.** Real banking is phase 4, and it waits on Bridge (risk open). It is ordered here because it cannot be used for real earlier, though a stand-in can be ported sooner.
13. **J19 CRM and projects through the door.** The dogfood promise (finding customers). It is mostly Frappe through `doc.*`, so it costs little Core work.
14. **J18 delegate to an agent.** Agents working leads: the GROUNDING bet. It needs budgets (J4).
15. **J20 features and hats in step, and J21 stays true when broken.** These are the hardening a real company needs before trusting it for a month.
16. **J17 outside money lands.** It is needed once customers pay to the Safe directly.
17. **J16 two companies trade.** It comes with the first outside customer company.
18. **J22, J24, J25, J23, J26.** Developer surface, links, seats, scheduled payments and cohorts are not needed for Capxul's own operation.

## 5. Size

| Measure | Count | Source |
|---|---|---|
| Old frozen book operations | 215 (accounts 36, activity 5, banking 8, books 16, departments 12, devnet 15, equity 30, governance 43, organizations 6, payments 33, payroll 11) | `main:blueprint/baseline/operations.ts` |
| Of these, cut | 72 entries: 20 reached, 2 dropped, 50 parked (my grep). By decision: `cut.equity` 38, `cut.books` 12, `cut.individuals` 6, `cut.requests` 5, devnet-to-world 6, `cut.documents` 2 | `main:blueprint/shared/cut.ts` |
| main blueprint operation records | about 233 exported `operation_*` (my grep count; it may include aliases) | `main:blueprint/**/operations.ts` |
| infra protocol operation rows | 228, many of them internal prepare and submit halves | `infra:packages/protocol/src/operation-names.ts` |
| infra CLI leaf commands | about 142 | `infra:apps/cli/src/commands/**/execute.ts` |
| Old journeys | 11 product journeys (13 in the older book), 6 site journeys, 6 platform journeys; Acme saga: 8 stories, 201 steps | `main:blueprint/journeys.ts`, `main:blueprint/sites/journeys.ts`, `main:blueprint/devnet/platform-journeys.ts`, `infra:packages/scenarios/src/acme` |
| User-facing capabilities in section 1 | about 75 rows, about 60 of them live in infra | this file |
| Proposed journeys | 26 new (J1 to J26) plus 3 covered | section 2 |
| Rebuild operations to add (estimate) | about 90 to 110 new operations for J1 to J22, against today's 12 (a guess: section 2 names about 100, and several journeys share operations) | section 2 |
| Rebuild today | 12 operations, 3 journeys, 10 starting worlds, 53 claims | `packages/blueprint/README.md`, `packages/scenarios/README.md` |

## 6. What I could not determine

- **Whether infra is live in production.** The capability matrix was last verified on 10 August 2026. The Acme saga asserts that production is refused (s1.22 and s1.23). I found no record of a real-money company on infra. "Live" here means devnet or staging only.
- **Whether the Acme saga is green now.** The steps are marked `runs-today`, but I did not find or run a recent report (`packages/scenarios/reports/` is not committed, as far as I saw).
- **The capability matrix is stale.** It lists bank settlement as "Missing", but `bank pay` and s8.24 and s8.25 exist. I did not check which is current beyond the code's presence.
- **Which old features Aaron still wants in the Frappe world.** The cut sends the books, reports and documents to ERPNext. Infra's books concept (chart, review queue, facts, keepers) may be superseded by ERPNext Accounts. Payroll calculation is meant to move to Frappe HR (`aaron.frappe-shape`), so whether J8 to J13 port as on-chain agreements (infra) or as Frappe salary slips plus chain payments is a design choice I cannot settle.
- **Whether people are created by an operation or by the world.** The rebuild seeds the cast in `world.create`. Whether J1 (sign-up) is a journey or a world setup step is open (`aaron.sign-in-is-core`: "later; worlds are for agents first").
- **What each wave-0 PR actually delivers.** I read titles only (56 PRs). The mapping of PRs to journeys is from titles.
- **What is fully built behind main's blueprint records.** Board, budgets, agents, plugs and notices: which are code in `main:packages/backend` and which are records only was not read file by file. `main:packages/backend/src` has folders for most concepts (board 12 files, approvals 11, plugs 8) but no agents code beyond 3 files.
- **CRM, Projects, HR and enrichment** appear only as rulings and GROUNDING text. I found no operation records or code for them beyond the generic `doc.*` door.
- **Equity's real size.** The frozen book has 30 equity operations, but `cut.equity` classifies 38 entries; the extra entries are probably votes and governance operations. Not reconciled.
- **Counts are grep counts.** They are approximate where noted.
