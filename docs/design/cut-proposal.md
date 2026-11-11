# The cut: what stays, what Frappe owns, what goes

A proposal for the owner to correct by exception. Written at commit `7ca75e6`. Every verdict is in `cut-proposal.json`: one line for each of the 23 concepts, 394 operations and 1,050 decisions, each exactly once (checked by script). Nothing in the book or the code was changed.

**Words used here.** A *record* is one thing in the book. An *eval* is a check the code must pass. A *hat* is a role on chain. The *door* is the CLI and SDK. A *plug* is a join between Capxul Core and Frappe. *Reached* means Frappe owns it: Capxul's own records go, and the door reaches the Frappe version.

## 1. The result in numbers

| Of | Total | Stay (core or plug) | Reached (Frappe's) | Dropped | Held for Aaron |
|---|---|---|---|---|---|
| Concepts | 23 | 18 | 4 | 0 | 1 |
| Operations | 394 | 183 | 163 | 3 | 45 |
| Tables | 147 | 71 | 53 | 11 | 12 |
| State machines | 75 | 36 | 27 | 2 | 10 |
| Rpcs (server calls) | 378 | 175 | 150 | 7 | 46 |
| Flows (SDK methods) | 224 | 129 | 65 | 2 | 28 |
| Evals | 8,398 | 4,269 | 3,061 | 169 | 899 |

| Decisions | Total | Keep | Rewrite | Archive | Aaron |
|---|---|---|---|---|---|
| | 1,050 | 638 | 202 | 171 | 39 |

Of the 183 operations that stay, 159 are core and 24 are plugs. The held 45 are 38 equity operations and 7 about the hosted FDE. If equity stays, 4,269 evals become up to 5,168.

## 2. The 23 concepts

| Concept | Verdict | Why | Operations, now to staying | Replaced by |
|---|---|---|---|---|
| access | core | Sign-in, sessions, CLI state. Feeds the sign-in plug. | 10 to 10 | |
| media | core, low | Files Core needs for identity and bank checks. | 0 | |
| parties | core | Maps people and companies to Safe addresses. | 0 | |
| indexing | core | Every chain fact and event comes from here. | 0 | |
| approvals | core | The signer. A held Frappe payment waits on it. | 0 | |
| accounts | core, low | Personal Safe stays. Referrals and waitlist are doubtful. | 11 to 11 | |
| organizations | core, reshaped | Setup also creates the site. The head goes. The FDE goes to Aaron. | 39 to 31 (6 held, 2 dropped) | new `sites` concept |
| board | core | Governance is kept. The handover call touches equity. | 19 to 19 | |
| agents | core | Agents wear hats like people. | 8 to 8 | |
| budgets | core | Money authority. Envelopes follow the cost-centre tree. | 19 to 19 | |
| payments | core | Pays under a hat and a budget. Carries the document hash. | 11 to 10 (1 held) | |
| banking | core | Bridge is the revenue line. Opening accounts is a later need. | 12 to 11 | |
| requests | core, low | Payment requests and the payer's inbox stay. Services go. | 15 to 9 | ERPNext Item and Payment Request |
| applications | core | Developer keys for the door. | 6 to 6 | |
| activity | core | The read model of money. | 6 to 6 | |
| notices | core | Core emails stay. HR, payslip and head notices go. | 0 | Frappe notifications |
| devnet | core, reshaped | The local world must hold a real Frappe site on one clock. | 25 to 25 | |
| documents | plug, low | The hash stamp stays. Printing goes. | 4 to 2 | Frappe Print Format |
| books | reached | The chain reader stays as a plug. | 17 to 5 | ERPNext Accounts: Account, GL Entry, Journal Entry, Payment Entry, Bank Transaction |
| contacts | reached, low | CRM and address book. A wallet field on Frappe parties keeps payees payable. | 32 to 0 | Frappe CRM: CRM Lead, CRM Deal, CRM Task, FCRM Note; Contact, Address |
| payroll | reached | Pay, HR, leave, attendance, claims. The 11 pay-agreement operations stay. | 87 to 11 | Frappe HR: Employee, Salary Structure, Payroll Entry, Salary Slip, Leave Application, Attendance, Expense Claim |
| projects | reached | Projects and timesheets. | 35 to 0 | ERPNext Projects: Project, Task, Timesheet |
| equity | aaron | One ruling keeps it, START-HERE drops it. | 38 to 0 (38 held) | |

Money and authority do not vanish from reached concepts. Paying a payroll run, an advance or an expense claim (3 operations) is a Frappe Payment Entry held by the signer plug, then paid by Core's `org.department.pay`. Approving or releasing HR items that affect pay (12 operations) stays a Frappe action, allowed by a role that follows a hat. Each is marked `carriedBy` in the JSON.

## 3. New records the book needs

The JSON lists 64, each with its reason. In short:

- **Two new concepts:** `sites` (site, features, door) and `plugs` (the four joins). One new component, the site service that creates sites. Rewrite `component:frappe-app`, which today describes a connected head.
- **Sign-in:** an OAuth provider per site, a client table, the rule that only a person a hat created can sign in.
- **Signer and the held payment:** a payment-request table and machine, `payment.prepare-document`, the document hash form (CANON v1), a hash-mismatch error, the rule that cancelling a paid document is a reversal, and payment fields for hash, cost centre and account code.
- **Roles follow hats:** a hat-to-role map, a table of grants, a projection workflow, a drift check, a rule against hand edits, and a decision on where Employee facts come from.
- **Books from the chain:** an ordered event outbox, a delivery workflow, a rule for an event that can never be applied, and a decision on USDC against GBP books.
- **Site lifecycle:** a site table, machine and workflow, and the four skeleton behaviours as journeys.
- **Feature switches:** a features table and three operations (`org feature list`, `on`, `off`) that replace `org head app`.
- **The document door:** `doc` verbs (list, get, create, change, submit, cancel, amend, apply, remove), `doctype`, `report run`, `doc next`, `doc print`, and a call log. Every call runs as the calling person.
- **Later, off the critical path:** bank accounts and identity checks through Bridge, deposits landing in the books, and UK payroll filing.

## 4. What the book lacks for the owner's purpose

- **Events an operation sends.** 195 of 394 operations send events, but none names them. They are derived from the machines their rpcs drive.
- **Spans.** 1 of 602 rpcs and flows names a span. The check for the rest is generic.
- **Wide events and log lines.** No record describes either. Seven files mention them in prose only.
- **Example responses.** 0 of 394. `returns` is a schema.
- **Where each operation stands.** The portal computes a design stage from the records. No record keeps build status or eval results. `progress.md` is by hand and says no product eval has run.
- **What depends on a record.** The book holds 19,469 links. It can answer who points at a record, and a script can walk it: `table:organizations` has 236 direct dependents and 889 in all, decisions included. It cannot say which field is used, sees nothing written in prose, and knows nothing of code, Frappe or evals' results. 1,010 of 1,050 decisions have nothing pointing at them.

## 5. Questions only the owner can answer

1. **Equity.** Drop, park or keep? *Recommend park:* build nothing now, archive nothing hard to undo. Board stays either way.
2. **The hosted FDE.** In the book, or an upsell outside it? *Recommend outside.* GROUNDING calls it the upsell. 7 operations and 12 decisions wait on this.
3. **On-chain pay agreements.** Keep, now that payroll is Frappe's? *Recommend keep, moved into payments.* They are money on chain.
4. **Hats and budgets.** Hats as they are, but budgets enforced per department? *Recommend yes.* The spike's only gap was that a department is not authority.
5. **UK payroll filing.** Provider API, bureau or build? *Recommend provider API.*
6. **Individuals.** Is Capxul still sold to people with no company? *Recommend companies only for now.* Referrals, waitlist, personal contacts and inbox wait on this.

## 6. How to do the cut safely

1. **Aaron corrects the JSON.** Each answer becomes a ruling in `rulings.ts`, as START-HERE section 7 says.
2. **Change the frozen rule first.** `system.frozen-behaviour` and `packages/blueprint-engine/scripts/check-frozen.ts` require all 215 old operations. 25 of them go (12 books, 2 document, 6 contact, 5 service) and 38 more if equity goes. They carry 80 acceptance claims and 82 refusals (53 more claims for equity). Add a record of each old operation's verdict with its decision. The check then wants each one booked or classified. The 141 operations added after the freeze that go are not frozen, so they are free to go.
3. **Add before removing.** Write the plug and door records, and the new operations citing `aaron.one-door`. Rebuild to 0 problems. Their evals start red, and the skeleton behaviours are the first four.
4. **Remove one concept at a time, leaves first.** Decisions, operations, flows, rpcs, machines, tables, then the concept. Order: projects, contacts, payroll, books, the head parts of organizations, documents.
5. **Move, never delete.** `git mv` each removed record to `docs/cut-archive/<concept>/`, as `docs/as-is/archive/` did. Add a generated index of every removed id, its reason and what replaces it, and one `cut.<concept>` decision each.
6. **Regenerate** evals, tasks (668) and the portal. Update `plan-tasks.ts` and `initializer.md`, which say "215".

The four checks during the cut:

- **Packages and tests:** should pass throughout. No test pins 3,352, 394, 1,050 or 215.
- **`tsc -p blueprint`:** fails when a kept record still imports a removed one. That error list is the to-do list.
- **Book build:** reports dangling links whenever a half is removed, so each concept goes in one commit.
- **Frozen check:** fails on the first of the 25 until step 2 lands.

## Low-confidence verdicts

5 concepts (media, accounts, documents, contacts, requests), 67 operations and 43 decisions. The operations, by concept: organizations 18 (6 FDE, 12 old `org head doc` verbs that become the door), requests 14, payroll 11 (pay agreements), contacts 8, accounts 6 (referral and waitlist), documents 4, books 2 (`reconcile`, `annotate`), banking 2, board 1 (`handover`), payments 1 (`org fde pay`). The decisions are those of documents and requests, plus referral and waitlist, plus `aaron.contacts-permissions`. Each carries `"confidence": "low"` in the JSON.
