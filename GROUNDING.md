# What we are building, and why

**A grounding document for internal alignment. Written 9 November 2026 from Aaron's words, restated and steelmanned (second version).** If a plan, a ticket or a design drifts from this, this document wins until the team agrees to change it.

## The honest starting point

What we built was not working. The technology is not the problem: wallets, Safes, on-chain authority, Bridge and agents all work.

The problem is where we put it. We had an idea and built it against a Figma. Nobody who drew that Figma knew a whole class of software already exists, ERPs, the systems small and mid-sized companies run their business on. The reality of what a company needs turned out to be very different from the screens we were building.

A company will not move its business onto a product that lacks the basics it expects: payroll, HR, books, invoicing, a CRM, projects, and for many companies stock and manufacturing. Asking a company to bring all its stuff over is a big ask. It is an impossible ask if the basics are missing.

So the move is not to throw the technology away. **The move is to put our technology inside a thing that already exists and already makes sense.**

## What we are building

**Capxul is the on-chain company.** It is a complete business system, with Capxul's money and authority built in.

- **The business system** is the ERP class of software that companies already know and expect: HR and payroll (real tax codes, NI, pensions, filings), books and invoicing, CRM and lead generation, projects and timesheets, stock and manufacturing for companies that need it. It is built on ERPNext and the Frappe stack, which tens of thousands of businesses already run. We re-skin it and extend it into one product, Capxul. The user never sees the name Frappe.
- **Capxul Core, built in:**
  - identity and sign-in, with the user never seeing crypto;
  - the organisation and its authority (hats), which the business system's permissions mirror;
  - budgets;
  - payments;
  - governance;
  - **banking through our Bridge accounts.**

  Once your whole company runs on chain, your banking might as well be on chain too. You simply have an on-chain company.
- **Agents as first-class users.** Every part of the business is a function agents can call, under the same authority a person has. Agents earn their keep where the work is repetitive and the upside is real: finding and qualifying leads, working the pipeline and logging every touchpoint, coordinating projects, and routine HR admin. Agents do not pay bills; people decide money.

## Who we sell to

Small and mid-sized companies, around 15 to 25 people, that run real payroll, real HR and real customers, **including companies that have nothing to do with crypto.** For them Capxul is a drop-in: their business system, with banking, money and permissions that just work. On-chain is how it works underneath, not something they have to understand.

## How we get paid

- **Bridge accounts.** We push customers towards our Bridge banking because we earn from it. This is why Core and banking are central, not dropped: banking is part of the product, and it is our revenue.
- **The product itself:** the hosted company system.
- **The upsell: a real FDE (forward deployed engineer) in your company.** We are the FDE: a person, working with agents, who learns your business and builds workflows, automations and factories on top of the system for you, for example your top of funnel and your inbound pipeline. It is part of the pitch and the premium tier. It is not the base product.
- **Customers pay for the tokens their agents use.** That also funds the agent experiments we would otherwise pay for ourselves.

## Why ERPNext and Frappe

- **Proven class, proven market.** Tens of thousands of businesses run ERPNext. There is an official partner programme, with gold and silver partners paid to set it up for companies. Setup and hosting is a paid market today, so even free for 90 days, or on a deal, we are entering a market where money already changes hands.
- **The depth we need, already built.** HR, payroll calculation, double-entry books, CRM, projects, stock, manufacturing, permissions and workflows, all open source. We close the gaps that matter (for example, HMRC payroll filing in the UK). We do not rebuild the class.
- **In front of customers now.** Re-skinning and extending puts us in real companies now, not after years of building.

## The strategy: dogfood first

**Launching means one thing.** We run our own Capxul company on Capxul, with our CRM, our enrichment, our agents and our banking, finding customers and selling Capxul. We are ground zero: the first customer and the first test of everything.

That does three jobs at once:

1. **It validates that people will buy from us.** The market exists; the question is whether they buy this from us.
2. **It gets us the data.** Real workflows, real pipelines, real agent runs, ours and every customer's.
3. **Other people pay for the tokens we experiment with.**

## The deeper bet

Capxul has been designed from the start as an environment for people and agents:
- shared simulations with real users and agents, semi-real;
- full agent simulations;
- the same evals on all of them.

What we are really building is **the harness for the drop-in worker.** The day an AI agent is good enough to replace a worker in a 20-person company, we will already have three things:
- the companies, running on a system agents can fully operate;
- the environments in which to train and test those agents on real workflows;
- the data, the evals and the method (the hill-climbing kit) to make them better.

The customers, the banking, the dogfooding and the FDE work are how we earn the right, the revenue and the data to be ready on that day.

## Steelman: why this is the right call

1. **The technology works. The container was wrong.** We are not abandoning what we built. We are moving it into the form factor companies already buy.
2. **Basics are the entry ticket.** Nobody switches to a system that cannot run their payroll or their stock. Built on Frappe, we have the basics on day one.
3. **Banking is the business model, and the system is the distribution.** A company that runs its whole business on Capxul banks through Capxul. The ERP brings the customer in, and the Bridge account is where we earn.
4. **We enter a market that already pays.** ERP setup and hosting is bought today, with partners and price points. We compete in an existing market with a better offer: the system, on-chain banking, agents and an FDE.
5. **Agents need real systems to act on.** A real business system with an API and permissions on every record is what makes agents useful. A demo app is not.
6. **Dogfooding is the fastest loop.** We feel every gap ourselves, every day, before a customer does.
7. **The FDE upsell compounds.** Each engagement leaves templates, workflows and evals behind, so the next one is cheaper, and the premium tier gets better as it scales.
8. **The long bet compounds.** Every customer workflow becomes an environment, every setup becomes data, and every agent run becomes an eval.

## The honest objections, and our answers

- **"We are throwing away what we built."** No. Core, the wallets, the authority, Bridge and the agents are all kept, and banking becomes the revenue line. What changes is the container: an ERP instead of a set of screens drawn from a Figma.
- **"Non-crypto companies will not want on-chain."** They never see it. They see a business system with banking and permissions that work. On-chain is how it works and why it is trustworthy, not what they must learn.
- **"We are becoming an ERPNext partner or consultancy."** We sell a product (the system plus banking), with the FDE as an upsell. The partner market proves companies pay for setup. We go further with Core, banking and agents.
- **"Equity was the direction."** It was an exploration of what to do next when what we were doing was not working. It is not the direction. This is.
- **"We depend on Frappe."** We build a custom app on upstream Frappe, not a fork, so upgrades still flow. Licensing must be checked properly. It is a known, managed dependency on open source.
- **"Why not keep building our own business system?"** We could not run a real UK payroll, stock or manufacturing with it, and building the whole class would take years we do not need to spend.

## Guardrails against drift

- **Not building an ERP from scratch.** We build on the existing class and make it ours.
- **Not dropping Core or banking.** They are the product's trust layer and our revenue.
- **Not selling "crypto" to non-crypto companies.** We sell their business system, with banking that works.
- **Not leading with the FDE.** It is the upsell, not the product.
- **Not chasing new directions** (equity and the like) that do not serve our own Capxul company or a paying customer.

## What "launched" means

- **Launched:** our own Capxul company runs on Capxul (CRM, enrichment, agents and banking) and is actively finding and talking to customers.
- **Next:** the first outside company moves onto Capxul, free or on a deal if that gets us in the door, banking through our Bridge account.
- **Proof:** the first paying company and the first Bridge revenue, with customers paying for the tokens their agents use.
- **Throughout:** we capture the data and the evals from every run.
