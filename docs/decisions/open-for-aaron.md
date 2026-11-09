# Open for Aaron, 8 November 2026

## His answers (sixth batch, 8 November 2026)

He accepted every recommendation below that he did not mention. He changed two:

- **Departments (question 2, and who can do what everywhere):** "There's a concept of departments. Look at the v4
  contract properly. The whole purpose of the departments is that budgets belong to departments, and you can swap
  people in and out of departments." To record as `aaron.departments`. In v4 a department is a budget in the company
  Safe's tree with its own hat; `Budgets.authorised` admits the Safe and every wearer of the budget's hat or an
  ancestor's. So a budget payment is the department's: whoever wears its hat when it is taken back may take it back.
- **The FDE (question 13):** "The FDE is not hosted on their machine. It's hosted on a durable agent, hosted on a
  durable runtime with sandboxes. We handle that for the users. They pay us for hosting it." To record as
  `aaron.fde-hosted`, superseding `organizations.fde-at-start-up`.

- **Prices (questions 30 and 33):** "You can just make it up. It's fake money, fake USDC." To record as
  `aaron.test-prices`: an extra seat is 10 USDC, paid once; an Organization's hosted FDE is 20 USDC a month; both are
  deployment settings (`SEAT_PRICE`, `FDE_HOSTING_PRICE`) on the test USDC, changed freely.
- **Repositories he cannot reach while out:** work locally to stay unblocked; swarmd-next is a local repository with
  its bundle kept in capxul-next, as the kit is.

`tools/workflows/commands-and-escrow.js` applies both, with an audit of every authority statement in the book against
the v4 contracts.

The open decisions, numbered as they were put to Aaron (in text written for text-to-speech). Each recommendation
stands, and the build follows it, until he answers. His answers go into `books/target/shared/rulings.ts`, book first.

## His direction of 8 November 2026, evening (recorded in the eighth batch; applied in the world pass, 9 November 2026)

- **One world, one clock, for everything** (`aaron.world-clock`): a devnet, a staging network or a shared world is a
  self-contained world whose clock is controlled, and everything in it follows that clock: the chain, the backend,
  Ponder, emails, WhatsApp, the Frappe head and the FDE. A shared world may run faster than real time ("every hour the
  clock moves forward four"), so the clock gains a rate beside frozen and running. Outside channels are the world's:
  a devnet's mail goes to its sink, WhatsApp to a stand-in, and a connected head follows the world clock as a follower.
- **Everything is reachable through the Core SDK and the CLI** (`aaron.sdk-reaches-everything`; corrected: "draw the
  line at the CLI and the SDK"): those two reach every capability, native or on a connected head. The React SDK does
  not mirror everything; whoever needs a React screen builds it on the Core SDK (Frappe's own apps use Vue, not React). Native concepts have their own
  commands; what lives only on the head is reached through a generic document family over the SDK
  (`org doc list|get|create|change|submit|cancel <DocType>`), with the caller's authority, logged, on the world clock.
- **The CRM tracks every conversation** (asked): email, WhatsApp, calls, notes and tasks on one timeline per contact,
  lead and deal, in Frappe CRM's shape. Recommended: native, designed next.
- **Payroll means HR** (asked): leave, holidays, attendance, expense claims and advances native, because they change pay
  or move money; recruitment, appraisal, training and onboarding on the head, reached through the generic family.
  Recommended: designed next.

## His answers, 8 November 2026, night (applied in the world pass, 9 November 2026)

- **The recipient's command is `payment claim`**, not `account collect` (rename `account.collect` to `payment.claim`;
  "claim" is the word of `aaron.escrow-general`). The sender's take-back stays `payment cancel`.
- **Anyone may talk to the FDE** (`organizations.fde-commands`: the any-member option, "or anyone the management is
  speaking to"): the host passes the asker's Seat, so the FDE does for them only what their own hats allow. The FDE is
  not on the critical path.
- **Accepted as recommended:** `organizations.fde-hosting` (monthly in advance from a budget, paused when unpaid),
  `payments.seat-authority` (People hat and authorised on the budget now), `payments.seat-purchase` (its own command).

## The escrow

His ruling of this batch (to be recorded as `aaron.escrow-general`): the escrow is deployed counterfactually; its owner
is the recipient's not-yet-deployed account address, which may claim at any time; the sender may always take the money
back until it is claimed; it is a general-purpose escrow; the escrow changes, not Budgets. It supersedes
`payments.claim-escrow-routes` and `budgets.claim-escrows`, and reopens `payments.claim-escrow-fit`.

| # | Question | Recommendation | Records |
|---|---|---|---|
| 1 | When a budget payment is taken back, the money returns to the company account, but the budget's allowance for that period is not restored, since Budgets is not changed. Is that acceptable? | Yes (accepted). Booked: the general escrow's refund always pays its sender, for a budget's escrow the company Safe, and Budgets' room is untouched | `budgets.claim-escrows`, `payments.general-escrow`, `payments.claim-escrow-routes`, invariant `payments.escrow-budgets-unchanged`; `docs/design/escrow.md` |
| 2 | Who may take a budget payment back? | Answered by `aaron.departments`: whoever wears the budget's hat, or one above it, when it is taken back, or the Board, whoever sent it; the money returns to the company Safe. Booked as the general escrow's authority term (Budgets and the budget id, read at the refund) | `payments.department-authority`, `payments.general-escrow`, `budgets.claim-escrows`, operation `payment.cancel`, invariant `payments.escrow-department-now`; `docs/design/escrow.md`, `docs/design/authority.md` (contradiction 1) |

## Capxul around Frappe

| # | Question | Recommendation | Records |
|---|---|---|---|
| 3 | Does Capxul keep a copy of every voucher a connected head posts, so its books are the whole books? | Yes | `books.head-vouchers` |
| 4 | Is setting up books in a currency with no Chainlink price feed refused until one is listed? | Yes, refuse | `books.capxul-assets` |
| 5 | With a head connected, may payroll runs still be made in Capxul? | Yes; whichever side makes a run computes it, the other never recomputes | `payroll.one-computer-per-run` |
| 6 | Three ownership classes: money and identity are Capxul's; business records are shared and versioned; other apps belong to the head. Is that what you meant? | Yes | `organizations.head-ownership` |
| 7 | Only the fundamental apps live in Capxul; every other Frappe app lives only on a connected head? | Yes | `organizations.apps-native-or-head` |
| 8 | Should the directory name companies that are not on Capxul? | No: they stay private in each CRM until they join or are paid | `parties.outside-companies` |
| 9 | Is a person's mailbox theirs for life? | Yes for now; moving a mailbox is a later capability | `parties.mailbox-for-life` |
| 10 | Do the new capabilities get CLI commands now? | Yes (accepted). Booked: 90 operations beyond the 215 in one grammar, each once: projects 35, the CRM 14, payroll 28, apps, head and FDE 8, buying from Capxul 3, `org timesheet bill` and `account collect` (now `payment claim`); with the world pass, 165 (questions 39 to 49) | `docs/design/new-commands.md`; `projects.commands`, `contacts.crm-capabilities`, `payroll.hr-surface`, `organizations.commands`, `organizations.buy-seats`, `requests.bill-time`, `accounts.collect-any-time` |
| 11 | May a new command be booked on its pack's recommendation before you answer the pack? | Yes; nothing of the 215 changes | `rules.new-operations` |
| 12 | Projects: members work their own tasks and time; the People hat manages projects? | Yes | `projects.permissions` |
| 13 | Where does each organization's FDE run at first? | Made in the founder's install, its key made on the founder's machine; Capxul-hosted FDEs later. Superseded by `aaron.fde-hosted`: Capxul hosts every FDE | `organizations.fde-at-start-up` |
| 14 | Does the FDE start with any hats? | None; the founder grants hats, the People hat included, when needed. Since `aaron.fde-anyone` the hosted FDE needs none: it acts with its asker's hats | `agents.fde-authority`, `agents.fde-people-hat` |
| 15 | Is no agent ever a Director, or only an organization's own agents? | No agent at all | `board.no-agent-directors` |

## The build

| # | Question | Recommendation | Records |
|---|---|---|---|
| 16 | A new staging on a fresh deployment, nothing migrated? | Yes, with the changed escrow | `environments.staging` |
| 17 | Hand-written code at most 100,000 lines, each concept's share set after the pilots? | Yes | `system.size` |
| 18 | Global tables have no tenant and are written only through their own concept? | Yes | `rules.global-tenancy` |
| 19 | Drop the old raw proposal and owner-change plumbing? | Yes | `board.dropped` |
| 20 | A proposal whose execution fails gets its own status, failed? | Yes | `board.failed-proposal` |
| 21 | A payment's birth touches three concepts in one database transaction? | Yes | `payments.birth-width` |
| 22 | The swarm's accounts: a capxul namespace on swarmD, the GitHub App on both repositories, and a room? | Yes | `swarm.accounts` |

## The kit and the swarmD rebuild

| # | Question | Recommendation | Records |
|---|---|---|---|
| 23 | The spending envelope for the swarmD rebuild? | $500 from the same OpenAI credit; the master asks at 75% | `docs/dx.md` Q2 |
| 24 | Where do the agents' skills live? | One shared folder, read by swarmD and Claude Code alike | `docs/dx.md` Q3 |
| 25 | The rebuild's repository, namespace and branch? | A new repository, swarmd-next, beside capxul-next; namespace swarmd-next; branch integration | `docs/dx.md` Q4 |
| 26 | Should ideas and spikes become record kinds in the book? | Yes, later; for now an idea is a file and a spike ends in a decision record | `docs/dx.md` Q5 |
| 27 | Should records generate code skeletons? | Yes: schemas, the RPC group, the SDK client, the CLI wiring and migrations | `docs/dx.md` Q6 |
| 28 | Is the task tree derived from the book by a kit tool? | Yes, Capxul's planner ported to the kit | `docs/dx.md` Q7 |

## What only Aaron can provide

| # | What | Why |
|---|---|---|
| 29 | Credits on the OpenAI organization of the key in this environment, or a key from the funded one | Every completion call returns "no credits remaining"; the 14 agent-judged evals wait for it |
| 30 | The price of an extra seat, and the stablecoin | Answered (`aaron.test-prices`): `SEAT_PRICE` 10 USDC, paid once, on the test USDC; booked as `org seats buy` |
| 31 | A Cloudflare API token and the Access allowlist | The portal's private hosting (`portal.hosting`) |
| 32 | Branch protection on `main` and `integration/build` | `tooling.branch-protection` |
| 33 | The price of hosting an Organization's FDE | Answered (`aaron.test-prices`): `FDE_HOSTING_PRICE` 20 USDC a month; booked as `org fde pay` |
| 34 | The swarmd-next repository on GitHub, added to this session | Question 25, accepted; this session may not create repositories |
| 35 | The swarm's accounts: the capxul namespace on swarmD, the GitHub App on both repositories, a room | Question 22, accepted |

## Raised by the commands pass

The pass's agents raised three questions; Aaron answered all three on 8 November 2026, night (above). Each booked
record keeps its choice until his answers are applied, book first, after this pass.

| # | Question | Recommendation | His answer | Records |
|---|---|---|---|---|
| 36 | Who may talk to the hosted FDE (`org fde ask`)? | A Director: the FDE acts with the hats the Board granted it, so whoever instructs it borrows them | Anyone may, and anyone the management is speaking to: the host passes the asker's Seat, so the FDE does for them only what their own hats allow; the FDE is not on the critical path | `organizations.fde-commands`, `organizations.commands`, `organizations.command-priorities`, operation `org.fde.ask`; applied in the world pass (`organizations.fde-for-the-asker`, `organizations.fde-guests`, `rules.fde-acts-for-asker`) |
| 37 | How is the FDE's hosting paid? | In advance by the month from a budget (`org fde pay [<months>] --from <budget>`, 20 USDC a month), the FDE pausing when its paid-through instant passes and resuming when paid | Accepted as recommended | `organizations.fde-hosting`, `payments.fde-hosting-purchase`, operation `org.fde.pay` |
| 38 | May a recipient collect waiting money later, by command, as well as at setup? | Yes, as `aaron.escrow-general` reads; booked as `account collect` (one approval collects every claim escrow the person's Safe owns) | Yes, spelt `payment claim` (`payment.claim`); the sender's take-back stays `payment cancel` | `accounts.collect-any-time`, operation `payment.claim` (was `account.collect`), `payments.claim-command`; `docs/design/new-commands.md` section 6. Applied in the world pass |

Also accepted that night: `payments.seat-authority` and `payments.seat-purchase`.

## Raised by the world pass (9 November 2026)

The world pass (`tools/workflows/world-pass.js`) carried out the eighth batch: `aaron.world-clock`,
`aaron.sdk-reaches-everything`, `aaron.payment-claim`, `aaron.fde-anyone`, and the evening answers (the CRM tracks
every conversation; payroll means HR). It booked 75 new operations, 165 beyond the 215 in all. Its records raise these
questions; each recommendation stands, and the build follows it, until he answers.

| # | Question | Recommendation | Records |
|---|---|---|---|
| 39 | Is a world's clock rate set by one new command, `dev time set --rate <n>`, a whole number from 1 to 60 world seconds a real second? | Yes. Above 60 the real-time machinery dominates and a warp is the tool; a world where people sign in by emailed code runs at 5 or less, since a five-minute code lasts 5/rate real minutes | `devnet.clock-rate`, operation `dev.time.set` |
| 40 | Who may join a shared world? | Only people its owner grants, each grant file handed over outside the world (never by its mail), carrying the joiner's own dev-signer keys; only the owner moves, follows, saves or restores the clock | `devnet.shared-world`, environment `shared-world` |
| 41 | Your ruling lists "a staging network" among the worlds whose clock is controlled. Does staging's clock move? | No: staging stays on Base Sepolia's real clock at rate 1, never moved, since the sequencer's time is not Capxul's; it stays self-contained by its channels (mail to MAIL_ALLOWED_RECIPIENTS, WhatsApp only from the test numbers WHATSAPP_ALLOWED_NUMBERS lists). A controlled world others share is a shared world | `time.worlds`, `time.world-channels`, `contacts.whatsapp-staging-numbers` |
| 42 | The document family: your six commands, plus `org doc amend` (a cancelled document's correction), `org doc apply <action>` (a Workflow step), `org doc remove` (delete after a preview), `org doctype list\|get` and `org doc-call list` (the log)? | All twelve. Left out on purpose: count, copy, bulk writes, whitelisted methods, files and comments | `organizations.doc-family`, section 5.7 of `docs/design/new-commands.md` |
| 43 | Do stock, selling, buying and asset documents on the head (Stock Entry, Delivery Note, Sales and Purchase Orders, Asset), which ERPNext's ledger hooks list, count as money? | Yes: the family refuses them, and people work them in the head's own desk while books copies their vouchers. The alternatives: read them and keep drafts, refusing only submit; or read them only | `organizations.doc-reach` |
| 44 | Your "anyone may talk to the FDE" is read as: the hosted FDE acts only as the person who asked, with their Seat and hats; every signature goes to the asker; a preview (head connect or disconnect, deleting a head document, contact link, an employee's leaving, the CRM's sends and WhatsApp connect) is the asker's to answer, so the FDE drafts and the member runs it; hats the Board grants the FDE's own Safe go unused while Capxul hosts it. Is that right? | Yes | `organizations.fde-for-the-asker`, `agents.fde-authority`, `rules.fde-acts-for-asker` |
| 45 | The CRM's conversations: `org crm timeline`; `org crm email send`; `org crm whatsapp connect\|disconnect\|show\|send`; `org crm note add\|change`; `org crm task create\|change\|move\|list`; `org crm call log` (13), a task's status moved by `move` as leads and deals are? | As booked | `contacts.conversation-commands`, section 5.8 |
| 46 | Which money does a contact's timeline show? | What the chain proves between the Organization and the record's Party: payments either way, claim escrows and paid invoices, read from indexing; a request not yet paid does not show, since contacts sits below requests. To show unpaid requests the command moves to activity | `contacts.timeline-money` |
| 47 | Email attachments and WhatsApp media? | Named but not kept, and sends carry none, until contacts depends on media in a later pass | `contacts.attachments-later` |
| 48 | HR: the 45 commands of section 5.9 (holidays, leave types, allocations and applications, shifts, check-ins and attendance, expense types, claims and advances)? | As booked; HR is part of payroll, not a concept of its own | `payroll.hr-commands`, `payroll.hr-in-payroll`, section 5.9 |
| 49 | Nobody approves their own expense claim or advance, so a department's only hat wearer waits for someone else to wear that hat or one above it. Should the Board decide those instead? | No: keep refusing; a sole holder who spends for the department pays it as a department payment | `payroll.hr-approvers` |

To record in `books/target/shared/rulings.ts` (its owner's, not the pass's): "payroll means HR" as a ruling of its own
(for example `aaron.payroll-means-hr`), which the `payroll.hr-*` decisions would then cite; and the CARRIES_OUT and
SUPERSEDED entries the pass's records ask for (see its build report).
