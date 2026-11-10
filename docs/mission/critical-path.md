# The critical path

Written 10 November 2026 by the coordinator, on Aaron's ask: "chart a critical path … to getting a working MVP with
the core technologies all hooked up … how much feature compatibility can we get with the current Capxul."
Branch: `integration/build`. This file is the plan until the milestones are records in the book; then the book wins.

## End state

From a clean checkout, one command brings up a whole company on the real stack on one machine, and agents run it
through the CLI alone:

- the real v4 contracts on a local chain (Safe, hats, Zodiac roles, budgets, payments, board);
- agents signing with their own keys under their hats, with no browser pop-up;
- a Capxul-named Frappe site with accounts, staff, payroll, projects and CRM;
- a scripted company life: set up the org, grant hats, set budgets, win a deal, invoice it, pay suppliers, run
  payroll, with the books agreeing with the chain at every month end.

## Priorities (Aaron, 10 November, later the same day)

"I want to optimize for time, for speed, for cost … get as much breadth done as possible."

- **OpenFort is out of this path.** It adds testing friction. Every signature is made with a key by an agent or by
  deterministic code. People's sign-in stays a stand-in until the breadth is there.
- **Breadth first.** Get the CLI reaching as much as possible, Frappe especially, before any one part is polished.
- **Everything is tested by agents and deterministic code,** the clock and the simulation included.
- **Everything is recorded.** Every command, with who ran it under which hat, what it returned, and the world's time,
  is kept. The record is also training data, so it is a product of the system, not a debugging aid.
- **Time can be moved.** A world's clock is set and advanced from the CLI, and the chain and the Frappe site follow it.
- **It must be visible.** Agents drive it, but a person can open the Frappe screens of a running world and see it.
- **The cloud matters.** Where this runs, on the cloud that already exists (`Xelmar-tech/hosting`), must be understood
  and written down before it is needed.

So the door, the recorder and the clock are built now, beside the real contracts, not after them.

## The measure

How much of current Capxul works on the new stack. After the cut the book keeps 183 operations (159 Core, 24
plugs). The score is how many pass their evals on the real stack. The portal shows it.

## What the old code gives us (scouted 10 November, `Xelmar-tech/infrastructure` at `integration/factory`, 62e4947)

| Piece | State when run here | Use |
|---|---|---|
| `packages/contracts/v4`: 15 contracts, about 9,000 lines | builds in 105 s; 965 hermetic tests and 61 fork tests pass; deploys to a local fork in 25 s with public test keys | bring over whole, with its tests |
| Key signers in `packages/sdk/src/signing` (`localPrivateKeyAccountProvider`, `devPrivateKeySigner`) | read, not run | the agent-native signer |
| `AgentOwner.sol`: each agent has its own Safe, its key the single owner | covered by the contract tests | how agents hold authority |
| alto bundler and a mock paymaster | not run | needed for a real agent user operation |
| `packages/scenarios`: company histories of about 22 months (bit-connect, quillmesh, mining, farm) | not run; needs the old world | the script for milestone 5 |
| `packages/backend` (Convex, about 368,000 lines) and `apps/cli` (about 91,000 lines) | not run; need Convex, OpenFort and other secrets | NOT brought over: the book's target is a Node service on Postgres, and the old CLI is tied to the old backend. A reference for behaviour only |

So the contracts and the signing come over nearly as they are. The service layer and the CLI are built to the book.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| 1 | **Foundation.** The cut; the plugs, sites and the door written into the book in full; where each operation stands is recorded | the book builds with 0 problems on the new shape and the portal shows the kept operations with their stand |
| 2 | **Real chain under the skeleton.** The v4 contracts in this repository with their tests; a seeded chain state so nothing needs the network; a key-based agent signer; the skeleton's stand-in chain replaced | the skeleton's checks pass against the real contracts: a hat granted through Hats, a budget set, a payment sent through `Payments` under that hat and budget with the document's hash |
| 3 | **The door, the recorder and the clock** (in parallel with 2). The CLI reaches Frappe's documents, actions and reports as the calling person; every command is recorded; a world's time is moved from the CLI and the site and chain follow | an agent takes a lead to a paid invoice, onboards a staff member and runs a month end through the CLI only, on a clock it moved, and the whole run can be read back from the record |
| 3b | **The cloud.** How a bench of company sites, the service, a chain and the record run on the existing cloud, written down and then stood up | a world running in the cloud that a person can open in a browser while agents drive it |
| 4 | **The compatibility climb.** The Core operations built to the book, group by group (organisations, hats, budgets, payments, board, agents, approvals, activity), with the old code as the reference for behaviour | the score: kept operations passing their evals. No number is promised before milestone 2 is done |
| 5 | **Company life.** A multi-month run on the real stack, from the old scenario histories | the books agree with the chain at every month end |

## Known risks

1. The contracts' outside dependencies (Safe 1.5.0, Hats v1, Hats Signer Gate v2, Zodiac Roles v2) come from a fork of
   Base Sepolia at one pinned block through a public endpoint. Milestone 2 removes this with a seeded state file.
2. How an agent's budget authority flows through hats has not been traced end to end.
3. Docker here has 8 GB; Frappe, a chain, a bundler and an indexer together may need more.
4. Books were in USD on the spike. GBP books with a dollar stablecoin account is untested.

## Needs Aaron, none of it yet

Bridge sandbox credentials and an OpenFort account (after milestone 3); hosting, the licence review, the UK payroll
filing route and the Meta account for WhatsApp (before a real customer). Parked and his to settle: equity, the hosted
FDE, hats versus custom.
