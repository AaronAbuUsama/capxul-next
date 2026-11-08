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

`tools/workflows/commands-and-escrow.js` applies both, with an audit of every authority statement in the book against
the v4 contracts.

The open decisions, numbered as they were put to Aaron (in text written for text-to-speech). Each recommendation
stands, and the build follows it, until he answers. His answers go into `books/target/shared/rulings.ts`, book first.

## The escrow

His ruling of this batch (to be recorded as `aaron.escrow-general`): the escrow is deployed counterfactually; its owner
is the recipient's not-yet-deployed account address, which may claim at any time; the sender may always take the money
back until it is claimed; it is a general-purpose escrow; the escrow changes, not Budgets. It supersedes
`payments.claim-escrow-routes` and `budgets.claim-escrows`, and reopens `payments.claim-escrow-fit`.

| # | Question | Recommendation | Records |
|---|---|---|---|
| 1 | When a budget payment is taken back, the money returns to the company account, but the budget's allowance for that period is not restored, since Budgets is not changed. Is that acceptable? | Yes | `budgets.claim-escrows` |
| 2 | Who may take a budget payment back? | The person who sent it, with the Board as a backstop; the money always returns to where it came from | `payments.claim-escrow-routes` |

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
| 10 | Do the new capabilities get CLI commands now? | Yes, all three: projects' working set of about thirty, the app and head commands, and the CRM's contact, lead and deal commands; the CLI is how every capability is proven | `projects.commands`, `organizations.commands`, `contacts.crm-capabilities` |
| 11 | May a new command be booked on its pack's recommendation before you answer the pack? | Yes; nothing of the 215 changes | `rules.new-operations` |
| 12 | Projects: members work their own tasks and time; the People hat manages projects? | Yes | `projects.permissions` |
| 13 | Where does each organization's FDE run at first? | Made in the founder's install, its key made on the founder's machine; Capxul-hosted FDEs later | `organizations.fde-at-start-up` |
| 14 | Does the FDE start with any hats? | None; the founder grants hats, the People hat included, when needed | `agents.fde-authority`, `agents.fde-people-hat` |
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
| 30 | The price of an extra seat, and the stablecoin | `aaron.buy-seats`; until then buying a seat is refused |
| 31 | A Cloudflare API token and the Access allowlist | The portal's private hosting (`portal.hosting`) |
| 32 | Branch protection on `main` and `integration/build` | `tooling.branch-protection` |
| 33 | The price of hosting an Organization's FDE | `aaron.fde-hosted`; a deployment setting, as the seat price |
| 34 | The swarmd-next repository on GitHub, added to this session | Question 25, accepted; this session may not create repositories |
| 35 | The swarm's accounts: the capxul namespace on swarmD, the GitHub App on both repositories, a room | Question 22, accepted |
