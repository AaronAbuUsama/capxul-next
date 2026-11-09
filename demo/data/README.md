# The mock-up's data

`generate.mjs` writes `../app/data.json`: Harbourline Studio Ltd, a design and engineering studio in Hoxton, running on
Capxul from 1 May 2025 to "today", **Monday 9 November 2026, 10:45** (`meta.today`, `meta.now`). It is fictional
sample data (`meta.fictional`). The generator is deterministic (seed `20261109`, no dependencies): the same code writes
the same bytes.

```bash
node demo/data/generate.mjs    # writes demo/app/data.json (about 8 MB) and prints the counts
node demo/data/validate.mjs    # 23 checks; exits 1 on any failure
```

The generator is split by concept under `gen/`: `world.mjs` (the cast, departments, hats, customers, suppliers,
projects: every story judgement), `util.mjs`, `ledger.mjs`, `hr.mjs`, `payroll.mjs`, `projects.mjs`, `sales.mjs`,
`purchases.mjs`, `money.mjs` (the cash book: simulation, top-ups, Capxul records, chain statements, vouchers),
`governance.mjs`, `crm.mjs`, `feed.mjs`. To change the story, change `world.mjs` and re-run both scripts.

## Conventions

- **People** are referred to everywhere by `people[].id` (`"maya"`, `"kwame"`); agents by handle (`"@kwame-ops"`);
  the Board as `"board"`. `others[]` holds non-employees (Ruth Calloway, the FDE guests, Owen Grady).
- **Departments and budgets** by id: `harbourline` (top), `design`, `engineering`, `delivery`, `growth`,
  `operations`; allowances `subscriptions`, `capxul`, `travel`.
- **Records** by their Frappe names: `HR-EMP-00003`, `ACC-SINV-2026-00050`, `ACC-PINV-…`, `ACC-PAY-…`, `ACC-JV-…`,
  `ACC-PCV-2026-00001`, `ACC-BTN-…`, `HR-LAP-…`, `HR-LAL-…`, `HR-ATT-…`, `EMP-CKIN-MM-YYYY-…`, `HR-EXP-…`, `HR-EAD-…`,
  `HR-PRUN-…`, `Sal Slip/HR-EMP-00003/00018`, `HR-SSA-…`, `HR-SHA-…`, `PROJ-0011`, `TASK-2026-…`, `TS-2026-…`,
  `CRM-LEAD-…`, `CRM-DEAL-…`. Capxul's own: `payment_<ULID>`, `approval_<ULID>`, `sp_0194`, `vt_0005`, `rd_0002`,
  `gr_0001`, `bdep_…`, `bpo_…`, `escrow_…`, `agr_…`, `conv_…`, `turn_…`.
- **Money**: GBP amounts are numbers in pounds (2 decimals); USDC amounts are numbers (up to 6 decimals);
  `amountRaw` is the 6-decimal integer string. `rates["YYYY-MM-DD"]` is GBP per USDC (1 USDC = 1 USD) for every day;
  today's is 0.7893.
- **Times** are UTC ISO strings (`2026-11-05T14:03:09Z`); show them in Europe/London. Dates are `YYYY-MM-DD`.
- **Big tables** are compact: `{ cols: [...], rows: [[...], ...] }`. Turn one into objects with
  `t.rows.map(r => Object.fromEntries(t.cols.map((c, i) => [c, r[i]])))`. They are `books.gl`, `hr.attendance`,
  `hr.checkins`, `projects.logs`, `money.statements.*` and `activity`. Booleans in tables are `1`/`0`.
- **Proofs**: `payments[].proof.documentHash` is SHA-256 (`0x`-hex) of the canonical JSON of `proof.advice` (object
  keys sorted, no whitespace, keys with undefined values dropped). A page can re-hash it with SubtleCrypto to make
  **Verify** real. `contentHash` on invoices and payslips is the same hash of the document's content.

## The story in the data

- **People**: 14 on 1 May 2025, 25 today (24 employees on payroll and Sofia Lindqvist, a contractor in Stockholm paid
  4,800 USDC a month by a pay agreement). Two left: Oliver Grant (29 Aug 2025, final pay withheld until his laptop came
  back) and Daniel Price (31 Mar 2026). Hannah Cole joined 12 Oct 2026 with no Capxul account; her October pay waited in
  escrow until she claimed it on 4 Nov at 09:12.
- **Hats** (`departments[].holders`, `allowances[].holders`, `officerHats`, `board.directors`): swaps over time
  (Design: Maya → Priya; Delivery: Isla → Grace; Growth: Maya → Leo; Operations: Maya → Nadia; People: Sam, then Kwame,
  then Isla). Nobody wears People while holding a department. `people[].hats` is what each wears today.
- **Seats**: 10 until 1 Nov 2026, when Kwame bought 10 more for 100 USDC (`seats.purchases`); 14 of 20 in use and
  Owen Grady's invitation pending. Six seat agents plus the company's FDE (`seats.members`, `agents`).
- **Money** (`money`): two Safes (`safes.treasury`, `safes.reserve`), money waiting (`escrows`: one claimed by a new
  contractor, Marta Kowalczyk; one mistyped email taken back; Hannah's claimed; Jules Marchetti's and Ian Pryce's open),
  Bridge deposits (`deposits`, incl. one unmatched, one below minimum, one returned and Saltmarsh's arriving today),
  Bridge payouts (`payouts`: delivered, one in transit, one returned by the bank, one quoted and waiting for Nadia, one
  expired), payments (`payments`: every on-chain movement, with `proof.advice`), `scheduled` (four dated payments that
  reserve 22,051 USDC, plus Sofia's next collection), chain statements per Safe, bank details, saved bank accounts.
- **Books** (`books`): chart of accounts (`accounts`; codes as in `research/accounting.md` §6 plus 1400, 2600, 2700,
  3200, 3300, 6900, 6950), the ledger (`gl`), voucher headers (`vouchers`), sales and purchase invoices with their
  payments, the Barclays statement (`bankTransactions`; to 6 Nov, the last lines unreconciled), VAT returns, the year-end
  close (`periodClosing`, with corporation tax), and monthly `reports.trialBalance`, `reports.profitAndLoss`,
  `reports.balanceSheet` (the last entry of each is today).
- **Payroll** (`payroll`): one run a month on the Harbourline department (`runs`, 18), 347 payslips in runs plus 9
  agreement payslips born paid; each slip's `paymentInfo` carries its payment and proof. PAYE/NI/pensions are worked
  in pounds with the formulas in `components`.
- **HR** (`hr`): holiday lists for England 2025 to 2027, leave types, allocations (with carry-forward), applications
  (past approved, some rejected and cancelled; Christmas requests and Grace's parental leave still open), attendance
  (marked by hand until 30 Jun 2026, from check-ins after), check-ins from 1 Jul 2026, the Studio Day shift, expense
  claims and advances with their decider (`decidedBy`, `decidedHat`) and payment.
- **Projects** (`projects`): 13 projects (one begun before Capxul), tasks with dependencies, weekly timesheets (some
  logged for seatless people by a People-hat wearer, `loggedBy`), time logs with billing and costing; T&M invoices are
  dated the last working day of each month.
- **CRM** (`crm`): companies (Frappe CRM's Organizations, shown as Companies), contacts, 118 leads, 38 deals (20 won,
  13 lost, 5 open; a project deal's value is what the project bills), and one `timeline` of items per lead, deal or
  contact (`recordType`, `recordName`; a deal's timeline starts with its lead's): creation, status changes, emails,
  WhatsApp, calls, notes, tasks and `money` items for parties on Capxul. `notes`, `tasks`, `calls` repeat those items as
  Frappe CRM's own lists.
- **Governance** (`board`, `equity`): 30 Board proposals in nonce order (`sp_0193` grant Books to Nadia and `sp_0194`
  raise Harbourline's budget are waiting for Tom or Ruth); cap table, the pre-seed SAFE and seed rounds (their money sits
  in the Reserve Safe), 14 option grants, 5 shareholder votes (`vt_0005` open until 16 Nov).
- **People-facing** (`fde`, `approvals`, `notices`, `events`, `activity`): nine scripted FDE conversations built from
  the real figures (with "what I looked at" commands and hand-over cards), the asks the book keeps; what waits for whom
  today; notices per person; the company's events, newest first; the money feed.

## Rules the data follows (and choices for the critique)

`meta.rules` lists them. The choices worth flagging:

1. **Two Safes**, as the brief asks, although the book gives an Organization one company Safe
   (`research/capxul-native.md` 9.2). The Reserve Safe holds the rounds' money and moves only by Board proposal.
2. **Payroll currency**: UK pay is worked in GBP and paid from the Treasury in USDC, to a Safe at the day's rate or to
   a bank through Bridge (`research/hr-payroll.md`, conflict 4). One run a month on the top department (conflict 3).
3. **Billing in pounds**: UK invoices are in GBP and paid by bank transfer into the Bridge details (USDC lands in the
   Treasury); US customers on Capxul are invoiced in USD and pay USDC (`research/crm-projects.md`, conflict 7).
4. **CRM writes need the People hat**: Sam Whitfield (People) records the CRM's changes; Leo Brennan, who wears Growth,
   asks the FDE to draft them for Sam (`research/crm-projects.md`, conflict 2).
5. **Budgets are per quarter** (the brief), not per year as the native research's example shows.
