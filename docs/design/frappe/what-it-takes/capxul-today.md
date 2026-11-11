# What Capxul does today, need by need

Written 9 November 2026. This page checks the Capxul system that was built against what a
real 25-person UK company needs. The company has employees on PAYE and one contractor
abroad. Each need gets one of three answers:

- **done**: running code covers the need, and the page names the operation or file.
- **partly**: some code exists. The row says what is there and what is missing.
- **not there**: no code covers the need.

A design, a book record or a plan never counts as done. That includes the Frappe designs in
`docs/design/frappe/` and the target book.

## Sources

- The original repository, `/home/user/infrastructure`, on branch
  `claude/infrastructure-refactor-plan-v41iue`, which is based on `integration/factory`. I read
  `apps/cli`, `packages/backend`, `packages/sdk`, `packages/protocol` and `packages/contracts`.
  Paths below start with `infra:`.
- The frozen list of its 215 operations, `books/frozen/operations.ts`, with their acceptance
  claims, and `books/frozen/flags.ts`. Operations are named by id, for example
  `org.agreement.offer`.
- `docs/mission/findings.md`, the audit of the old system. There is no
  `docs/original/findings.md`.

I searched the code for PAYE, HMRC, National Insurance, tax code, RTI, P45, P60, P11D, student
loan, SSP, holiday, leave, right to work, emergency contact, VAT, Making Tax Digital, timesheet,
project, lead, deal, pipeline and mileage. Outside fixtures and tests, the only hits were these:

- the identity-verification question "National Insurance number";
- a country code list;
- the word "holiday" in a scenario note.

## Before the rows: four facts that apply everywhere

1. **The payroll and books features are switched off in production.** The feature catalogue
   allows these gates on devnet and staging and never in production:
   - `payment-departments`
   - `payment-agreements`
   - `payroll-runs`
   - `payslip-preview`
   - `scheduled-payments`
   - `books`

   See `infra:packages/protocol/src/features/catalog.ts` lines 54–56 (`OFF_UNTIL_AUDIT`) and
   the `ceiling:` entries at lines 84–210. The only gates that are on everywhere are Safe
   proposals, bank payouts, beta access and production access.
2. **The money path runs on a test network.** The payment execution, evidence and request
   schemas admit only chain 84532, which is Base Sepolia (`BaseSepoliaChainIdSchema`,
   `infra:packages/protocol/src/evm/schema.ts` lines 6–10). The audit recorded Protocol v4 as
   deployed on devnet only (`docs/mission/findings.md`, Contracts).
3. **The payroll run is hidden.** `org payroll run` is a one-off batch that writes payslips.
   It is not among the 215 operations, and the CLI marks it `Command.unlisted` behind the
   `payroll-runs` gate
   (`infra:apps/cli/src/commands/org/subcommands/payroll/command.ts`). The listed payroll
   commands are the payment agreements: `org.agreement.*` and `agreement.*`.
4. **Pay is a stablecoin rate with nothing withheld.** An agreement accrues a token rate by
   the UTC calendar and pays the payee everything released
   (`infra:packages/contracts/v4/src/money/Agreements.sol`,
   `infra:packages/contracts/src/PayrollCalendar.sol`). Nothing works out tax, National
   Insurance or pension. The payroll run takes `gross`, `net` and labelled `adjustments` that
   the caller types in. It only checks that net equals gross plus the adjustments
   (`infra:packages/backend/src/payroll/model.ts` lines 24–40,
   `infra:packages/backend/src/payroll/tables.ts` line 189).

## People records

| Need | Finding | Evidence |
|---|---|---|
| The employee record itself | **partly**: A Seat holds email, name, role, status, invited and accepted dates, Seat permissions and an AI flag. A Party holds the person's identity. A payroll run adds an `employed` link with type `fixed`. There is no employee number, address, date of birth, department or status (for example probation or leaver). An `employed` link's `endedAt` is never written, so a leaver is never recorded. | `org.member.list`, `org.member.get`, `org.member.invite`; `infra:packages/backend/src/organizations/tables/members.ts` lines 10–40; `infra:packages/backend/src/parties/writes/edges.ts` lines 26–55 (the only writer of `employed`) |
| Contract | **partly**: Each payment agreement has a terms document: JSON with the employer, department, payee, kind (`salary`, `stream`, `retainer`, `fixed_term`), rate, token, start and end. The payee signs its hash to accept. These are pay terms only. There are no hours, notice period, holiday entitlement, place of work or probation, and no uploaded contract. | `org.agreement.offer`, `agreement.accept`, `agreement.show`; `termsDocument` in `infra:packages/backend/src/payroll/agreements/rules.ts` line 235 |
| Job | **partly**: The only job information is the department an agreement draws on. The `employed` link has a `title` field, but no code writes it. | `org.department.*`; `infra:packages/backend/src/parties/tables.ts` line 179 |
| Manager | **not there**: Department holders can offer and manage the agreements in their department, but they are budget holders, not line managers. | `org.department.holder.add` |
| Start date | **partly**: An agreement has `startsAt`, when pay starts, and a Seat has `acceptedAt`. There is no employment start date and no continuous-service date. | `agreementFields.startsAt` in `infra:packages/backend/src/payroll/tables.ts`; `orgMembers.acceptedAt` |
| Right-to-work evidence and expiry | **not there**: The ID documents uploaded for identity verification (`id_front`, `id_back`, `proof_of_address`) are KYC for Bridge banking. Nothing records a right-to-work check, its type or when it expires. | `verify.start`; `verificationDocuments` in `infra:packages/backend/src/parties/tables.ts` line 106 |
| Emergency contacts | **not there** | none |
| Bank details | **partly**: Private bank accounts are stored encrypted, in GBP, EUR or USD, for yourself or for a contact. Payroll does not use them. Agreements and runs pay into the person's Safe in a stablecoin, and the person then cashes out with `bank pay self`. | `bank.accounts.add`, `contact.bank.add`, `bank.pay`; `partyAccounts` in `infra:packages/backend/src/parties/tables.ts` line 9 |
| NI number | **not there**: The UK identity-verification flow asks for it as the `tax_id` answer and passes it to Bridge. Capxul keeps only name, date of birth and address in its encrypted copy of the answers, so payroll never sees the NI number. | `infra:packages/backend/src/parties/verifications/rules/prefill.ts` lines 5–15; `infra:apps/cli/src/commands/verify/tests/run.fixture.ts` line 43 |
| Tax code and starter declaration | **not there** | none |
| Documents (HR file) | **not there**: The documents concept stores payment documents only: Memo, Invoice, Payslip and Receipt. | `infra:packages/backend/src/documents/README.md` |

## Leave and absence

| Need | Finding | Evidence |
|---|---|---|
| Holiday allowance and accrual | **not there** | none |
| Bank holidays for England | **not there**: The only calendar is the UTC calendar that pay accrues by. | `infra:packages/contracts/src/PayrollCalendar.sol` |
| Leave requests and approvals | **not there**: The nearest thing is a department holder pausing an agreement. The book suggests pause for unpaid leave. Pause stops pay building up, but it records no absence and the employee cannot ask for it. The only approvals in the system are for money and permission changes: Director proposals and payment approvals. | `org.agreement.pause`, `org.agreement.resume`, `org.proposal.*` |
| Carry-over | **not there** | none |
| Sickness and SSP | **not there** | none |
| Parental leave and SMP/SPP | **not there** | none |
| Return to work | **not there**: `org.agreement.resume` restarts pay and reports how many days the pause lasted. That is all. | `org.agreement.resume` |

## Payroll (UK)

| Need | Finding | Evidence |
|---|---|---|
| Salary structures | **partly**: An agreement is a single rate per year, month or week, with a release step (monthly for a salary). There are no salary components such as basic pay and allowances, no structures, no pay grades and no assignment of a structure to a person. The `engagementTerms` table is read by `payroll.terms.list`, but nothing outside tests writes to it. | `org.agreement.offer`, `org.agreement.change`; `infra:packages/backend/src/parties/tables.ts` line 190 |
| PAYE income tax by tax code, including emergency and Scottish codes | **not there** | none |
| Employee and employer NI by category | **not there** | none |
| Student and postgraduate loans | **not there** | none |
| Pension auto-enrolment, contributions and the provider submission | **not there** | none |
| Salary sacrifice | **not there** | none |
| Overtime and deductions | **partly**: The hidden payroll run accepts signed adjustments with labels, typed by the caller, and checks that net equals gross plus the adjustments. Nothing works out overtime or a deduction. Agreements have no deductions at all. | `infra:packages/protocol/src/payroll/schema.ts` (`PayrollRunItemInputSchema`); `infra:packages/backend/src/payroll/model.ts` lines 24–40 |
| Payslips with year to date | **partly**: The hidden payroll run writes one signed Payslip document per person. It holds employer, employee, period, gross, net and a hash of the adjustments, and `document render` saves it as a PDF. There are no year-to-date figures and no tax code, NI number, tax, NI or pension lines. Agreements give only an unsaved preview of gross at collection, and that preview is gated off in production. | `document.render` (claim: "A payslip names its employer and employee"); `infra:packages/protocol/src/documents/schema.ts` lines 119–142; `PayslipPreviewSchema` in `infra:packages/protocol/src/payroll/agreement-payee-schema.ts` lines 104–121 |
| RTI: the FPS on or before each payday | **not there**: There is no HMRC connection of any kind. | none |
| RTI: the EPS | **not there** | none |
| P45 for leavers | **not there**: Leavers are not recorded either. `org.agreement.end` only stops pay. | `org.agreement.end` |
| P60 each April | **not there** | none |
| P11D for benefits | **not there** | none |
| Payroll journal into the books | **partly**: Each settled payroll payment, and each collection on an agreement, becomes one cash money fact. It goes to the account the row is given, or to 6999 Uncategorized expense. There is no gross-to-net journal and no PAYE, NI or pension liability accounts. | `infra:packages/backend/src/books/README.md` (money facts and commitment claims) |
| Paying net pay | **partly**: A run pays a batch to each person's Safe, and an agreement lets each payee collect what has been released. Both pay in USDC or EURC. A person reaches their bank by `bank pay self`, in GBP, EUR or USD through Bridge. Pay is the gross rate, because nothing is withheld. Agreements are gated off in production and the run is hidden. | `org.agreement.offer`, `agreement.collect`, `bank.pay` |
| Paying the contractor abroad | **partly**: The contractor can be paid by `payment send`, by paying their invoice from the Organization's inbox with `inbox pay`, or by a retainer agreement. All of these pay in USDC or EURC. Cashing out to a bank works only for USD, EUR and GBP accounts. | `payment.send`, `inbox.pay`, `org.agreement.offer --amount`, `bank.pay` |
| Paying HMRC | **not there**: `bank pay` can pay a GBP account, but the Bridge transfer body has no payment-reference field, so the Accounts Office reference cannot be sent. There is no HMRC liability to pay from either. | `payoutTransferRequest` in `infra:packages/backend/src/banking/payouts/external.ts` lines 28–38 |

## Expenses

| Need | Finding | Evidence |
|---|---|---|
| Claims | **partly**: An employee can issue a general payment request to the Organization, which a Director or allowance holder pays from the inbox. That is a payment request, not an expense claim. It has no categories, no approval chain and no per-line claim. | `request.issue`, `inbox.list`, `inbox.pay`, `inbox.decline` |
| Receipts | **partly**: The payer can attach supporting receipts (PDF, PNG, JPEG or JSON) to a payment it sends. The employee cannot attach a receipt to the request they issue. | `SupportingReceiptInputSchema` in `infra:packages/protocol/src/documents/input-schema.ts` lines 50–58 |
| Policy | **not there**: There are no expense categories and no per-category limits. A spending allowance caps what a holder may pay per payment and per period, which is a spending control, not an expense policy. | `org.allowance.create` |
| Mileage | **not there** | none |
| Advances | **not there**: A spending allowance given to a member works like a refilling float, but nothing settles an advance against claims. | `org.allowance.assign` |
| Reimbursement | **partly**: A payment that carries a supporting receipt is typed `reimbursement` and paid in a stablecoin. There is no claim to settle against and no report of who is owed what. | `infra:packages/backend/src/payments/rules/purposes.ts` lines 58–70 |

## Books

| Need | Finding | Evidence |
|---|---|---|
| Double entry | **partly**: Versioned cash posting rules (`cash-v1`) turn each money fact into balanced debit and credit lines when a report is read, and the trial balance balances. There is no manual journal entry, no accrual and no adjustment, so only money that moved through the Safe is booked. | `org.books.reports.trial-balance`; `infra:packages/backend/src/books/postings/rules.ts`; `BOOK_FACT_KINDS` in `infra:packages/protocol/src/books/model.ts` |
| Chart of accounts | **partly**: There is one template, `us-services`, with 40 accounts, plus Capxul's 4999, 6999 and 3990. Accounts can be added, renamed, archived and put under a parent. There is no UK chart and no VAT control accounts. | `org.books.accounts.*`; `BOOK_TEMPLATES` in `infra:packages/protocol/src/books/model.ts` line 57 |
| Sales invoices | **partly**: An Invoice request carries an invoice number, up to 100 line items, a due date, a discount and a note. It is signed, renders to PDF and has a checkout link and an escrow for payers not on Capxul. A fiat Money Invoice can name a receiving bank account. There are no VAT lines and no receivables ledger: the books are cash basis, so an unpaid invoice books nothing. | `request.issue`, `request.get`, `document.render`; `InvoiceDraftSchema` in `infra:packages/protocol/src/documents/input-schema.ts` lines 18–29 |
| Purchase invoices | **partly**: Invoices that other Capxul users send arrive in the inbox to be paid or declined. A supplier's bill from outside Capxul cannot be entered, and there is no payables ledger. | `inbox.list`, `inbox.get`, `inbox.pay`, `inbox.decline` |
| Credit notes | **not there** | none |
| Payments and allocation | **partly**: A payment settles exactly one request for its exact amount, and a bank deposit is matched to one request. There are no part-payments, no single payment across several invoices and no allocation in the ledger. | `inbox.pay` claims, `bank.match` |
| Bank feeds and reconciliation | **partly**: Deposits arrive only through Bridge receiving accounts, and `bank match` ties them to requests. `org books reports reconcile` checks the books against what the Safe holds on chain. There is no feed or statement import from the company's existing bank. | `bank.deposits`, `bank.match`, `org.books.reports.reconcile` |
| VAT and Making Tax Digital | **not there** | none |
| Fixed assets | **not there** | none |
| Month end and year end | **not there**: The books README says the month-end lock and revaluation "come in later slices". | `infra:packages/backend/src/books/README.md` line 8 |
| Management reports | **partly**: Profit and loss, balance sheet and trial balance, all on the cash basis and in USD. There is also an activity summary per asset and a QuickBooks export. There are no comparisons, no budget against actual, no accrual basis and no cash-flow forecast. All of it is gated off in production. | `org.books.reports.*`, `activity.summary`, `org.books.export.quickbooks` |
| Multi-currency | **partly**: Each fact keeps its token amount and a USD value, from Chainlink on staging and from fixed rates on devnet. Reports are in USD only. There is no GBP base currency and no revaluation. GBP and EUR exist only at the bank edges. | `org.books.facts.list`; `infra:packages/backend/src/books/README.md` (prices) |

## CRM

| Need | Finding | Evidence |
|---|---|---|
| Leads | **not there** | none |
| Deals | **not there** | none |
| Pipeline | **not there** | none |
| Contacts and organisations | **partly**: The address book has one entry per counterparty, a person or an Organization. Each entry has a label, a hidden flag, saved bank accounts and how you know them (paid, invoiced, member, manual). There are no company records with addresses, phone numbers, roles or notes. A contact is a payment counterparty, not a customer record. | `contact.add`, `contact.list`, `contact.get`, `contact.label`, `contact.hide`, `contact.bank.add` |
| Email and call logging | **not there** | none |
| Tasks | **not there** | none |

## Projects

| Need | Finding | Evidence |
|---|---|---|
| Projects | **not there** | none |
| Tasks | **not there** | none |
| Timesheets | **not there** | none |
| Billing from timesheets | **not there**: Billing exists only as invoice line items typed by hand and fixed-price services with a checkout. | `request.issue`, `service.create` |
| Budgets and costing | **not there**: Department budgets limit payroll and payouts per token per period on chain. They are spending budgets, not project costing, and nothing compares a budget with actual spending. | `org.department.budget.set`, `org.department.show` |
| Resourcing | **not there** | none |

## Tally

None of the 65 needs is done. That is true even before the production gates and the test
network are counted.

| Area | Done | Partly | Not there |
|---|---|---|---|
| People records | 0 | 5 | 6 |
| Leave and absence | 0 | 0 | 7 |
| Payroll (UK) | 0 | 6 | 11 |
| Expenses | 0 | 3 | 3 |
| Books | 0 | 8 | 4 |
| CRM | 0 | 1 | 5 |
| Projects | 0 | 0 | 6 |
| **All** | **0** | **23** | **42** |

## What is real, so the comparison is fair

These parts are built in depth, and an ERP such as Frappe HR or ERPNext does not have them:

- **Company money controls.** A company Safe with Director proposals and thresholds.
- **On-chain spending limits.** Departments and budgets, payout ceilings, freezes, and
  spending allowances with caps and refills (`org.department.*`, `org.allowance.*`,
  `org.proposal.*`).
- **Recurring pay that holds money aside.** Payment agreements that reserve budget and that
  the payee collects without anyone signing on payday (`org.agreement.*`, `agreement.*`).
- **Signed, verifiable documents.** Invoices, payslips and receipts with hash checks
  (`document.*`).
- **Books built from verified money.** Every fact comes from money the chain settled, and
  reorganisations are reversed exactly (`org.books.facts.list`).
- **Bank rails through Bridge.** Bank details, deposits and payouts in USD, EUR and GBP
  (`bank.*`).

The gap is everything a UK employer must do around the money. Capxul has no HR file, no leave,
no statutory pay, no tax, NI or pension calculation, no HMRC filing (RTI, P45, P60, P11D), no
VAT and no accrual accounting. It has no CRM and no projects at all.
