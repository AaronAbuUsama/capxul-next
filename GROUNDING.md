# What we are building, and why

**A grounding document for internal alignment. Written 9 November 2026 from Aaron's words, restated and steelmanned.** If a plan, a ticket or a design drifts from this, this document wins until the team agrees to change it.

## In one paragraph

Capxul sets up and runs a custom, programmable company system for small businesses that do real work. These are 15 to 25 people, with real payroll, real HR and real customers. It is built on ERPNext and the rest of the Frappe stack, re-skinned and extended, so every part of the business (CRM, projects, HR, books) is a first-class function that agents can use. We do not sell technology. We sell each company its own software factory: its top of funnel, its inbound pipeline, its way of working, built and kept running by a forward deployed engineer (FDE), a person backed by agents. We prove it by running our own company on Capxul, selling Capxul. Underneath, the whole thing is built as an environment where people and agents work together, semi-real or fully simulated. That is the harness that will be ready on the day an AI agent can be dropped in as a worker.

## Who it is for

**A company of 15 to 25 people that runs:**
- payroll with tax codes, National Insurance, pensions and filings;
- HR with contracts, leave, right to work, onboarding and leavers;
- customers it invoices and chases;
- projects it delivers and bills.

For that company, nothing else matters if we cannot do those things properly. **Nobody cares that we can stream payments if we cannot run their payroll.** The proof of what "properly" means is in the mock-up's detail screens: a UK payslip with tax code 1257L, NI category A, PAYE, NI, pension and year-to-date figures; an employee record; a payroll run; invoices; the ledger. See `docs/handoff/2026-11-09/screenshots/pvU` and `pvD`. That depth is the entry ticket, not the differentiator.

## What Capxul is

- **A programmable company, built for each customer.** Every surface (CRM, lead generation, projects, HR, books, payroll) is exposed as functions that agents can call, with the same authority checks a person has.
- **Money is one more surface, not the headline.** Agents can move money exactly as they do anything else; the on-chain rails (Capxul Core) do that well. But money is not where customers feel the value, and it is not where agents earn their keep. Agents do not need to pay bills: a bill that is two weeks overdue is not overdue because nobody knew.
- **The value is the software factory.** Agents earn their keep where the work is repetitive and the upside is real:
  - finding and qualifying leads, and building the funnel;
  - working the pipeline, and logging every touchpoint;
  - coordinating projects;
  - acting as HR for routine admin.

  Whatever a company's top of funnel looks like, we turn it into a factory that runs, set up in whatever way suits that company.
- **The forward deployed engineer is how the factory gets built.** The FDE sets Capxul up for the company (imports, connections, payroll, the pipeline) and keeps helping it get more out of the system. It is a person working with agents, and every setup it does becomes templates and evals that make the next one cheaper.
- **Capxul Core stays, underneath.** The hard-won on-chain layer remains the source of truth for authority and money: identity and sign-in through the Capxul iframe, the organisation, hats as roles, budgets, payments and governance. Frappe's permissions mirror it. Non-crypto users never see it. See `START-HERE.md`.

## Why ERPNext and Frappe

- **It is real software that real businesses run today.** Tens of thousands of businesses use ERPNext.
- **The market already pays for setup.** There is an official partner programme, with gold and silver partners paid to implement ERPNext for companies. We do not have to invent demand for "set up my business system": it exists and is priced. Even if we start free for 90 days, or with deals, we are entering a market where money already changes hands.
- **It gives us the depth we could not build in time.** It has HR, payroll calculation, double-entry books, CRM, projects, permissions and workflows, all open source. Our own system could not run a real UK payroll. Frappe nearly can, and we close the gaps (for example, HMRC filing).
- **It puts us in front of customers.** Re-skinning ERPNext and building our layer on top means we are selling and implementing for real companies now, not after a long build.

## The strategy: dogfood first

**Launching means one thing.** We run our own Capxul company on Capxul, with our own CRM, our own enrichment and our own agents, looking for customers and selling Capxul setups to businesses. We are ground zero. Our company is the first customer, the first factory and the first test.

That one move does three jobs at once:

1. **It validates that people will buy from us.** Not "is there a market for ERPs": there is. The question is whether they will buy this from us.
2. **It gets us the data.** Real workflows, real pipelines, real agent runs, from our own company and from every company we set up.
3. **Other people pay for the tokens we experiment with.** Customers fund the agent work we would otherwise pay for out of pocket, and the experiments happen on real work.

## The deeper bet

Capxul has been designed from the start as an environment for people and agents, not just an app:
- shared simulations with real users and agents, run in a semi-real way;
- full agent simulations;
- the same evals on all of them.

That is deliberate. The thing we are really building is **the harness for the drop-in worker**. The day an AI agent is good enough to replace a worker in a 20-person company, we will already have three things:

- the companies, running on a system agents can fully operate;
- the environments in which to train and test those agents on real workflows;
- the data, the evals and the method (the hill-climbing kit) to make them better.

Everything above (the customers, the setups, the factory, the dogfooding) is how we earn the right, the data and the revenue to be ready on that day.

## Steelman: why this is the right call

1. **Distribution beats technology.** A better payment rail had no pull with small businesses. Small businesses buy outcomes: payroll that works, more leads, projects that ship. We now lead with the outcome and keep the rail.
2. **We enter a market that already spends money.** ERPNext implementation is a paid service today, with partners and price points. We are not educating a market. We are competing in one, with a better offer: setup plus agents plus a factory.
3. **We stand on solid ground instead of rebuilding it.** The boring 80% of a business system (HR, payroll calculation, ledgers, CRM) exists, open source and battle-tested. Our time goes into the 20% that is new: agents, the factory, Core's authority and money, and the FDE.
4. **Agents need real surfaces.** An agent is only as useful as the systems it can act on. A real business system with an API and permissions on every record is exactly what agents need. A demo app is not.
5. **Dogfooding is the fastest loop there is.** We feel every gap ourselves, every day, before a customer does, and our own sales pipeline is the first proof of the factory.
6. **Services first is a feature, not a flaw.** The FDE's work turns into templates, playbooks and evals, so each setup is cheaper than the last. That is how a services start becomes a product: we climb, one setup at a time.
7. **The long bet compounds.** Every customer workflow becomes an environment, every setup becomes data, and every agent run becomes an eval. When the drop-in worker arrives, we have the harness, the customers and the history.
8. **Nothing hard-won is thrown away.** Capxul Core (authentication, wallets, on-chain authority and money) becomes the trust layer underneath every customer's system: what agents are allowed to do, provably, and money that moves under those rules.

## The honest objections, and our answers

- **"We are becoming an ERPNext consultancy."** At first, partly, and on purpose. Consulting proves the price, puts us in front of customers and funds the product. The product is the factory, the agents and Core, which a plain consultancy does not have.
- **"Services do not scale."** Unassisted services do not. FDE work done with agents, captured as templates and evals and improved with every setup, is how it scales.
- **"We are dropping the crypto vision."** We are dropping it as the pitch, not as the foundation. Core stays the source of truth for identity, authority and money. Programmable money and provable agent permissions become a quiet advantage rather than the headline.
- **"We are dropping features we built: equity, streaming and the rest."** Yes, for now. They do not help a 20-person company run payroll or find customers. Anything that does not serve our own Capxul company or a paying customer waits.
- **"We depend on Frappe."** We build a custom app on upstream Frappe, not a fork, so upgrades still flow. Licensing must be checked properly, since parts of the stack are under copyleft licences. It is a known, managed dependency on open source.
- **"Why not keep building our own business system?"** We tried. We could not run a real UK payroll with it, and building that depth would take years we do not need to spend.

## What we are not doing (guardrails against drift)

- Not building an ERP from scratch.
- Not leading with payments or crypto.
- Not building equity, streaming or other features no current customer needs.
- Not building a general agent platform before we have customers using it.
- Not shipping anything our own Capxul company or a paying customer does not use.

## What "launched" means

- **Launched:** our own Capxul company runs on Capxul: our CRM, our enrichment, our agents, our pipeline. It is actively finding and talking to customers.
- **Next:** the first outside company is set up by our FDE, free or on a deal if that gets us in the door.
- **Proof:** the first paying company, with customers paying for the tokens their agents use.
- **Throughout:** we capture the data and the evals from every run, ours and theirs.
