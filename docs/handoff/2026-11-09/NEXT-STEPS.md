# The 50,000-foot view and the next steps (9 November 2026)

## Where it stands

- **The decision is made, in principle.** Capxul is Frappe plus Capxul's own layer. Frappe (ERPNext, HRMS, CRM, projects) is every company's real business system: Capxul hosts it and the user never sees the name. Capxul's own layer is:
  - money: USDC Safes, Bridge, and the v4 contracts whose payments commit a documentHash;
  - identity and authority: hats, budgets and approvals;
  - the agents;
  - one product surface: the CLI, the SDK and the app.

  The rulings are in `books/target/shared/rulings.ts`: `aaron.frappe-native`, `aaron.one-product` and `aaron.other-accounts`.
- **The design book** (`books/target`) holds the 215 operations plus the new ones. It was written before the Frappe-native ruling, so it describes a Capxul that rebuilds the business system itself. It needs a re-cut.
- **The mock-up** (`demo/`) shows the target product, but it is not real code and is not built on Frappe.
- **The research** is done. The conclusions are not drawn yet.
  - `docs/design/frappe/bridge-work/`: how a payment syncs. Five files, no synthesis.
  - `docs/design/frappe/what-it-takes/`: what Capxul does today and what Frappe gives a UK company.

## What is NOT validated yet

1. **The payment seam.** Nothing has run a Frappe invoice, a Capxul payment on chain with its documentHash, and a Payment Entry back in Frappe's ledger together. Open questions:
   - Which side is the truth for a payment?
   - What happens when a transaction reverts after the ledger posted?
   - How are duplicate events handled?
   - What about partial payments?
   - How does reconciliation work?
2. **Fork or app.** "Fork Frappe" carries a real upgrade risk. Frappe's own guidance is a custom app on top of upstream ERPNext and HRMS, never edits to core, so that upgrades still apply. The recommendation is to run upstream and put Capxul in a custom Frappe app plus outside services. Fork only if a spike proves an app cannot do it.
3. **Identity and permissions.** Nothing maps hats, budgets and approvals to Frappe roles, user permissions and workflows yet. Also open: one login across both, and an agent acting only with a person's permissions.
4. **UK payroll compliance.** Frappe has no RTI. Nothing sends the FPS or EPS to HMRC, and its tax is not HMRC's cumulative method (see `frappe-reality.md`). We must choose: a payroll bureau, a provider's API, or building RTI ourselves.
5. **Hosting.** Running a Frappe site per company (multi-site bench) needs pricing for cost, backups, upgrades and isolation.
6. **The developer experience.** No one has yet driven Capxul's CLI or SDK against a real Frappe.

## The next five steps (manual, you in the loop)

1. **Write the architecture page.** One page saying:
   - what Frappe owns and what Capxul owns;
   - the four seams: payments, identity and permissions, hosting, agents;
   - for each object, which side is the source of truth.

   Inputs: this folder, `bridge-work/` and `what-it-takes/`. Then do a pre-mortem: "a year from now this failed; why?"
2. **Stand up real Frappe.** Run ERPNext, HRMS and CRM in Docker (`frappe_docker`) and create the Harbourline site. Load a slice of the mock-up's data through the REST API (the generator in `demo/data` can write it). This proves the data model fits.
3. **The walking skeleton for money.** On a devnet, take one thin journey through every layer and back:
   1. a sales invoice in Frappe;
   2. a Capxul payment carrying its documentHash;
   3. the chain event;
   4. a Payment Entry in Frappe, reconciled;
   5. the same journey in reverse, for a purchase invoice approved and paid from a Safe.

   Then break it on purpose: a reverted transaction, a duplicate event, a partial payment, Frappe down while money moves. The step passes when the ledger and the chain still agree.
4. **The identity spike.**
   - Map a hat and a budget to Frappe roles and an approval workflow.
   - One person signs in once.
   - An agent drafts something that only the right person can approve.
5. **The DX stress test.**
   - Write the CLI and SDK for five real journeys, as thin wrappers over Frappe's API and the contracts:
     - pay an invoice;
     - run payroll;
     - onboard a hire;
     - qualify a lead;
     - turn a won deal into a project and invoice it.
   - Then give a fresh agent and yourself only the docs, and note every point of friction.
   - Settle the RTI choice.

**Only then** re-cut the design book around the seams, and start building with the kit's evals (`kit/hillclimb-kit.bundle`). The skeleton's checks become the first evals: the books balance, and the chain matches the ledger.

## How to know the whole fits

- The walking skeleton passes, including its failure cases.
- The kit's evals run against a real Frappe and a devnet, not against stand-ins.
- A fresh agent completes the five journeys from the docs alone.
- The pre-mortem's top three risks each have a test or a decision.
