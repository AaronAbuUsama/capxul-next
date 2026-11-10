# The plan

## Where we are going

Capxul is the on-chain company. A company gets one system to run on: accounts, staff, payroll, projects and customers, which is Frappe renamed to Capxul, with Capxul Core built in. Core is on chain and owns who the company's people are, who may do what (hats), the budgets, the payments, the banking and the board. A person works in the screens the normal way. When money moves or authority changes, they sign with Capxul and the chain decides.

Everything is reachable through one CLI and SDK, Frappe included, so people and agents can run a company with the same commands. Companies live in worlds. A world is one chain with every company on it, one clock and one record of everything that happens. A world is created by one command, can be saved and restored, and its record is training data.

## What this goal is

Two things, and both must be true.

1. **The book fully specifies it.** Every operation and everything behind it, the worlds, the Frappe side, what runs on AWS, and any code that already exists. The book is checked by a build, so it cannot quietly go stale.
2. **One shared world runs a thin line through the whole stack, on a machine and not a laptop.** One company, one of each thing, end to end: the real contracts, a small service, a Frappe site, a hat and the role that follows it, a document through the CLI, a payment held and signed with a key, the record, the clock, and a snapshot restored as a separate world.

It is thin on purpose. It proves the shape. Breadth comes in the milestones after.

## How we get there

Six milestones. The first is the current one and carries this goal's exit conditions. The others are listed so the route is visible, and two of them (the real chain, and the door and clock) are already feeding it.

1. **Foundation.** The book cut to the new shape, written in full, and proved against the spikes.
2. **Real chain under the test sites.** The real contracts in place of the stand-in.
3. **The door, the recorder and the clock.** The CLI reaches Frappe; everything is recorded; time can be moved.
4. **The cloud.** Worlds on a machine.
5. **The compatibility climb.** How much of today's Capxul works on the new stack, operation by operation.
6. **Company life.** Months of a company's life run by agents on the real stack.

The order is a judgment, not arithmetic. What the spikes prove goes into the book before the bulk work, because proof changes what the book should say. The machine is asked for early because it is the one step only Aaron can unblock.

## How the work runs

- One coordinator holds the direction and writes this plan. Bounded pieces of work go to threads (subagents or separate sessions), each named on its task.
- The book changes first, then the code. A spike is allowed to run ahead, but only to learn; what it learns is written back into the book.
- Every claim in the book is a test. Where a test has run, the plan and the portal show the result.
- Anything that needs Aaron goes to the Questions page, with the context to answer it. His answer is saved, and the coordinator applies it.
- Every session starts by reading this plan and ends by updating it.

## What is not in this goal

OpenFort sign-in for people, a real Bridge account, UK payroll filing, a production environment that takes real money, the full compatibility climb and the multi-month company run. Each is a later milestone or waits on Aaron. Agents and plain code sign with keys until then.
