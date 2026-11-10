# START HERE

> **This is a historical record: the owner's direction as dictated on 9 November 2026.** The book cites it as
> evidence, so its text below is left as written. It is not the current state. What is current: `pnpm plan show`
> (the plan) and the rulings in the book (`books/target/shared/rulings.ts`, shown in the portal).
>
> What has changed since:
> - **The first jurisdiction is open, not the United Kingdom** (ruling `aaron.jurisdiction-open`, 10 November). The
>   UK payroll sections below are research, not the target.
> - **Equity, the hosted FDE and individuals are parked** (`docs/cut-archive/parked/`).
> - **Work is coordinated through the plan and the loop** (`pnpm plan`, `pnpm loop`), not by reading this file or
>   `HANDOFF.md`, and not through swarmD.
> - **Paths have moved.** `demo/`, `kit/`, `docs/handoff/`, `HANDOFF.md` and the old `tools/` scripts named below are
>   under `archive/` at the same path (`archive/README.md`); the live checks moved into `packages/`
>   (`docs/repository-map.md`, "Where `tools/` went"). The map of the repository is `README.md`.

> Read [GROUNDING.md](GROUNDING.md) first: what we are building and why (the strategy, Aaron 9 Nov). This file is how.


Written on 9 November 2026 at the end of a long session. It captures what was decided in conversation with Aaron that is **not yet anywhere else in this repository**. Where this file disagrees with `HANDOFF.md`, `CLAUDE.md`, `docs/mission/*` or the book, **this file wins** until the book is re-cut to match it.

## 1. The goal

capxul-next **becomes** the rebuild of **Capxul Core**, Frappe-native from day one, built with the hill-climbing method this repository already uses: book first, then evals, then code.

- **Capxul Core** is the on-chain authority and money layer.
- **Frappe** (ERPNext, HRMS, CRM, projects) is each company's business system. Capxul hosts it and the user never sees the name.
- **The two are native in both directions.**

This is not a fresh start. Keep the machinery:
- the book (`packages/book`, `books/target`, `books/frozen`);
- the ledger portal and explorer (`tools/explorer`, `tools/export-explorer.ts`, `tools/portal-prototype.ts`, and the kit's `packages/portal` in `kit/hillclimb-kit.bundle`);
- the checks (`tools/check-frozen.ts`, `report-judgments`, `report-surface`, `plan-tasks`);
- the research;
- the mock-up.

What changes is the **content and scope**, plus a few rules (section 6).

## 2. What Capxul Core is (Aaron, 9 November)

**Core is on chain and is the source of truth for:**
- **Identity:** a person's account and Safe.
  - Sign-in is Capxul's own auth: the OpenFort wallet in the Capxul iframe, with passkeys and sponsored gas.
  - The user never sees crypto.
  - Frappe never holds keys or signs.
- **The organisation:** its tree of departments.
- **Authority as hats:** admin, a department's budget holder, the payroll approver, member, and so on. Agents wear hats too, so their permissions are on chain as well. Hats should fit; build something custom only if a spike proves hats cannot express a need.
- **Budgets:** the money envelopes, owned by departments.
- **Payments:** in, out, escrow and claims, each stamped with the hash of the document it pays.
- **Bridge:** fiat in and out.
- **Governance:** the Board and proposals. Kept.

**Dropped for now:** equity (cap table, options) and anything else outside Core.

**Not Core:** books, HR records, payroll calculation, CRM, projects and timesheets. Frappe owns them. Do not force them into Core. Core only does what makes sense on chain.

The hard-won Core code already exists in `Xelmar-tech/infrastructure` (branch `integration/factory`): the v4 contracts, the auth and OpenFort iframe flow, `packages/aa-gateway`, the SDK, the CLI and the indexer. Pull those pieces in with their tests, as tasks need them. Do not rewrite them blind, and do not fork the whole monorepo.

## 3. How Core and Frappe sync: the rule

**Authority and money flow down from the chain. Facts flow up from Frappe as hashes.**

**Down: the projection.**
- A hat granted or removed on chain updates the person's Frappe roles and user permissions automatically.
- A mapping in our Capxul Frappe app says, for example, "hat X means Frappe roles A and B, limited to department D".
- Frappe's permissions are a projection of the chain. Frappe never grants authority on its own.

**Money is enforced on chain regardless.** A payment fails unless the hat and the budget allow it, even if the projection were wrong.

**Two-way, through the action bridge.** Inside Frappe, an authorised person clicks, for example, "give Hannah the payroll hat" or "pay this invoice":
1. The Capxul app asks Core (the CLI or SDK) to prepare the transaction.
2. The Capxul pop-up appears and the person signs in the iframe.
3. Frappe shows the action as pending until the chain event lands.
4. The projection or the books then follow.

Aaron: "you should be able to grant the hat inside Frappe, but only a person who's authorized to do so … they get the Capxul pop-up and just sign in the iframe … that is the core part of it."

**Up: facts as hashes.**
- When a Frappe document is paid, its hash, cost centre and account code go into the on-chain payment.
- The chain event then posts a Payment Entry back into Frappe's books, matched to the document.

**Approvals that do not move money** (leave, a CRM change) can stay as Frappe workflows driven by the projected roles.

**Frappe's habits need chain equivalents.** A cancelled or amended paid document becomes a reversal transaction, never a deletion. Chain events that arrive after a fiscal period has closed post into the open period.

## 4. Contract shape: to decide, but the current lean is

**Do not put the chart of accounts on chain, and do not use nested Safes for it.** An account is a label. The chain cares about custody and who may move money.

**One Safe holds the money.** Budgets inside it are nested envelopes shaped like Frappe's cost-centre tree, with the same periods as Frappe's fiscal year. Moving between envelopes moves no money. Use separate Safes only where custody really is separate: the reserve, a client's escrow, a subsidiary.

**Every on-chain spend carries the document hash, the cost centre and the account code**, so posting to Frappe is mechanical. The Budgets contract (today: hats plus `authorised()`) and the payment router (today: `documentHash`) probably need reshaping for this. That is a decision for the book, made before any code.

Aaron's question to keep open: which on-chain primitive best fits the expectations behind how Frappe works. Nobody has thought this through for the on-chain side yet.

## 5. Frappe facts the design relies on

**Permissions:**
- **Users carry roles.** Each role grants per document type: read, write, create, delete, submit, cancel, amend, report, export, share, print.
- **Field-level permission levels** hide or lock groups of fields.
- **"If owner"** limits a person to their own records.
- **User permissions** limit a person to specific records (a company, a department, their own Employee record).
- **Sharing** opens one document to one person.
- **Documents are drafted, submitted, then cancelled or amended.** Submitting locks a document and posts it to the ledger.
- **Workflows** are state machines with transitions per role.
- **Our app can replace the permission check** through the `has_permission` and `permission_query_conditions` hooks, and react to documents through `doc_events`.
- **Login can come from an OAuth provider:** Capxul.

**Budgets:** Budget against a Cost Center or Project per fiscal year, with an action of stop, warn or ignore.

**Hosting:**
- One **bench**, the installed codebase (Frappe, ERPNext, HRMS, CRM and our Capxul app), serves many **sites**.
- Each site is one company, with its own database, files and config, routed by hostname. A new company is "create a site", which takes about a minute.
- Frappe's open-source control plane, **Press**, manages benches and sites.
- On AWS (Aaron has credits): the official `frappe_docker` images on ECS or EKS (web, workers, scheduler, socketio), Redis, MariaDB on RDS (the supported database), files on S3 or EFS, per-site backups to S3, region London.
- A big customer can get its own bench.
- Upgrades roll per bench, through a staging bench.

**Fork or app:** build Capxul as a **custom Frappe app on upstream** ERPNext, HRMS and CRM, not a fork. A fork turns every upgrade into a merge. Fork only if a spike proves an app cannot do it.

**The UK payroll gap:** Frappe has no RTI, so nothing sends the FPS or EPS to HMRC, and its PAYE is not HMRC's cumulative method. Choose a payroll bureau, a provider's API, or build it. See `docs/design/frappe/what-it-takes/frappe-reality.md`.

**Invisible to users:** the Capxul app and the agents talk to each company's site through Frappe's API. Frappe's own screens are hidden, or reskinned for power users.

## 6. The delta: from what is here to what it must become

1. **Re-cut the book's scope.** Today it models the whole old product: books, HR, payroll, CRM, projects and equity as Capxul concepts. Re-cut each concept as one of:
   - **Core**;
   - **Frappe-owned**, kept as a seam record saying how it mirrors;
   - **dropped**, with a decision record. Nothing is silently lost.
2. **Rewrite the frozen rule.** `system.frozen-behaviour` and `tools/check-frozen.ts` say all 215 old operations stay. They must change to: each old operation is classified Core, Frappe-owned or dropped by a recorded decision. Otherwise the checks block the re-cut.
3. **Make the ledger portal real.** The explorer's design is good (overview, decisions, review with weighting and options, surface, commands, concepts, gaps). Verify whether a choice made in review lands back in the book as a ruling (`books/target/shared/rulings.ts`) after a rebuild. Likely it does not yet: the published explorer is a read-only artifact. If so, closing that loop is task one. The portal must also show the work (tasks from `plan-tasks`, who holds them, what is done), because it replaces swarmD as the ledger.
4. **Retire the stale direction:**
   - `HANDOFF.md`, `CLAUDE.md` and `docs/mission/initializer.md` describe the swarm-built, full-product plan. Update them to point here, or archive them.
   - The scoreboard and `docs/mission/progress.md` note in `CLAUDE.md` assumes a swarmD ledger. The portal is the ledger now.
5. **Add new records:**
   - the Core boundary;
   - the hat-to-role projection;
   - the action bridge;
   - document hashing;
   - budgets as envelopes against cost centres;
   - payment fields (hash, cost centre, account code);
   - site-per-company hosting and the control plane;
   - pulling Core code in from `Xelmar-tech/infrastructure`.

## 7. How we work now

- **Setup:** a Claude project, with Aaron in the loop. No swarmD for now.
- **The main thread coordinates through the ledger portal.** Sub-threads (subagents) do bounded tasks.
- **Aaron decides in the portal's review section.** Each choice becomes a ruling in the book.
- **Then:** rebuild to zero problems. The gaps become tasks, and the evals come from the claims. Code follows the book.
- **Every session ends** by rebuilding the book and exporting the portal. **Every session starts** by opening the portal. State lives in the book and the portal, not in chat or handoff folders.
- **Show work early:** publish previews and screenshots as you go. Aaron explicitly asked for this after a long build he could not see.

## 8. The first steps of the new session

1. **Prove the portal loop.** Run the checks in `CLAUDE.md`, export the explorer, open it, choose an option on one decision, and confirm it becomes a ruling and shows after a rebuild. If it does not, make it so. Bring the kit's newer `packages/portal` in if it is better.
2. **Rewrite the frozen rule** (delta 2), then walk the concepts with Aaron in the portal, marking each Core, Frappe-owned or dropped.
3. **Write the Core boundary and the seam records** (sections 2 to 5) as book records and decisions. The open questions go to Aaron as decision packs in the portal.
4. **Rebuild to zero problems, and generate the tasks.** The first evals are the spikes, all red at first:
   - on a local multi-site Frappe, grant a hat from inside Frappe and see the roles follow;
   - pay an invoice from Frappe and see it land back in the books;
   - create a new company's site automatically;
   - break a payment on purpose (a revert, a duplicate event, Frappe down) and see the ledger and chain still agree.
5. **Climb**, pulling Core code in from the infrastructure repository as each task needs it.

## 9. What Aaron said about the product (from the mock-up review)

- **The primary use cases for agents are:**
  - CRM;
  - lead generation and building the lead funnel;
  - projects;
  - acting as HR for routine, not highly skilled work: onboarding, leave against policy, right to work, staff questions, letters for a person to sign.
- **Agents do not pay bills or nudge people to pay them.** People do money.
- **The FDE (forward deployed engineer) exists to set Capxul up** and help the company get the most out of it. It does not run day-to-day operations.
- **No commands in the user's screens**: commands are for the AI. **No agent call-out boxes** embedded in pages either: agent work lives in one assistant panel, or naturally on records ("logged by the sales agent").
- **Depth matters.** A real 25-person UK company needs real HR and payroll (tax codes, NI, pension, year to date, HMRC). The old Capxul could not do that, and Frappe can. That is why we build on it.

## 10. Where everything else is

| What | Where |
|---|---|
| The 9 November sitrep, next steps, every workflow script, the swarmD deploy runbook, all screenshots | `docs/handoff/2026-11-09/` (evidence; not required reading) |
| The mock-up (the target product's look) | `demo/app`, served by any static server. Preview at https://claude.ai/artifact/9VCi4xKK5U9ZnXV8F7jPsH. Feedback rounds A and B are done; C is partial and D is not started (`demo/PROGRESS.md`, `tools/workflows/erp-demo-feedback.js`) |
| The book explorer | https://claude.ai/artifact/NMedAdjczBUadTvFNsmCzw |
| Research: what a UK company needs, Capxul today, Frappe's reality | `docs/design/frappe/what-it-takes/` |
| Research: how a payment syncs (no synthesis written yet) | `docs/design/frappe/bridge-work/` |
| The hill-climbing kit | `kit/hillclimb-kit.bundle` |
| Original Capxul and Core's code | `Xelmar-tech/infrastructure`, `integration/factory`. Swarm CLI: draft PR #3935, CI green |
| swarmD | `AaronAbuUsama/swarmd`. PR #133 merged as 144fb78, not deployed (the runbook is in the handoff folder) |

## 11. Only Aaron

- Deploy swarmD, or leave it, since swarmD is out of the loop for now.
- Install the swarmD GitHub App on Xelmar-tech (only if swarmD comes back).
- Rotate the CLIProxy key he pasted on 8 November. The new account needs its own credentials.
- Decide whether to use hats as-is or build something custom, after the spike.
- Choose how to file UK payroll: a payroll bureau, a provider's API, or build RTI.
