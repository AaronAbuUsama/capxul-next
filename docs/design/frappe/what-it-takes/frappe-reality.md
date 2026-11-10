# What Frappe gives a UK company, and what it does not

Research for "what it takes", written 9 November 2026. It answers one question: if a 25-person UK
company (employees on PAYE, plus one contractor working abroad) ran on Frappe's open-source apps,
what would work on the first day, what needs configuring, what a community app covers, and what we
would have to build.

The apps checked are ERPNext v15, Frappe HR (HRMS) v15, Frappe CRM (v1.x, which runs on Frappe v15
and v16) and the Projects module inside ERPNext. Version 16 of ERPNext and Frappe HR is out. The
`version-15` branches still receive fixes: the last commits were on 4 November 2026. Where v16
changes an answer, the row says so.

Each need gets one of four verdicts:

- **Out of the box**: a standard DocType or report does it once the company exists.
- **With setup**: Frappe can do it, but someone must configure it first, for example with Custom
  Fields, formulas, templates, Notifications or Workflows. No new app is needed.
- **Community app**: an app outside Frappe's own repositories covers it. The row says who maintains it
  and how active it is.
- **Gap**: nothing usable exists. The row says what we would build.

## The answers in short

1. **Frappe HR does not calculate UK PAYE by tax code, or NI by category, out of the box.** It has no
   tax code field and no NI category field. Its only built-in tax engine is the Income Tax Slab. That
   is an annual band table with a flat "standard exemption" and an optional condition per row. The
   Salary Slip works out the tax for the projected year, takes off the tax already paid in the payroll
   period, and divides the rest by the periods left
   (`hrms/payroll/doctype/salary_slip/salary_slip.py:1585-1625` on `version-15` at `186900a`). That is
   not HMRC's cumulative method:
   - It has no K codes and no Week 1/Month 1 or X basis.
   - It has no allowance for each employee.
   - It cannot take a code change from HMRC.
   - Each band adds one unit to its width (`(to - from + 1)`, `salary_slip.py:2265-2272`), so even a
     simple case misses HMRC's figure by pence.

   The docs' only worked example is Indian (Health and Education Cess). The working route is the one
   our own research took: a person writes PAYE and NI as **formula salary components**
   (`archive/demo/research/hr-payroll.md:835-840`). That gives a Month 1 calculation for one tax code and one
   NI category. It is not cumulative and it does not follow code changes. It is fine for a picture, but
   not for running payroll.
2. **Nothing sends the FPS or EPS to HMRC.** Frappe core has no RTI code. The feature request for it,
   [frappe/erpnext#21723](https://github.com/frappe/erpnext/issues/21723) (May 2020), was closed by the
   stale bot in February 2022 with no maintainer reply. Case Solved, a UK Frappe hosting firm, says on
   its feature page and its Marketplace listing (for Version 14) that an RTI module is "in progress" and
   "coming soon", and that it will be for "hosted customers". Neither page gives a date. Its marketplace app names `github.com/CaseSolvedUK/uk` as its source, but that repository is not
   public. GitHub searches for Frappe or ERPNext with HMRC, RTI, PAYE, "national insurance" and
   "uk payroll" found no RTI app. The only UK HR app found, `walkinlogic/uk_hrms`, has five commits from
   one day in April 2024 and no payroll code. The nearest reusable code is outside Frappe:
   [craigfrancis/hmrc-rti](https://github.com/craigfrancis/hmrc-rti). It is a PHP library under a
   BSD-style licence for FPS, EPS, EAS, NVR and EYU over the Government Gateway, and it was updated for
   2026/27 in May 2026.
3. **Pension auto-enrolment is a gap.** Nothing assesses workers (age 22 to State Pension age,
   £10,000 trigger, qualifying earnings £6,240 to £50,270 in 2026/27). Nothing enrols them, handles
   opt-outs and postponement, re-enrols every three years or sends the provider's file. Contributions
   can only be formula components.
4. **P45 and P60 are a gap.** Frappe HR has leavers (`relieving_date`, Employee Separation, Full and
   Final Statement) and year-to-date totals on each slip. It has no P45, no P60 and no P11D, and none of
   the HMRC figures those forms carry, such as NI-able pay by category.
5. **MTD VAT needs a community app.** Core ERPNext has no UK VAT return report and no HMRC connection.
   Five community apps exist, in very different states (see below). The two that look current and
   maintained are Zikpro UK VAT and iMORPHr's Making Tax Digital. Both send the filing through the
   vendor's own OAuth broker, and iMORPHr charges a subscription for it. Neither appeared in a public
   HMRC list we could check. Zikpro said in January 2026 that it had "initial approval from HMRC".

So the base exists and it is real: the employee file, leave, expenses, double-entry books, CRM and
projects. The UK statutory layer does not exist. That layer is the PAYE and NI engine, statutory pay,
pensions, RTI and the year-end forms. It is the main thing we would build. MTD VAT can be taken from a
community app or built.

## Community apps for the UK

| App | What it does | Maintained by, and how active | State |
|---|---|---|---|
| [Zikpro/zikpro-uk-vat](https://github.com/Zikpro/zikpro-uk-vat) | MTD VAT. Builds the nine-box return from Sales and Purchase Invoices, supports standard, cash and flat-rate schemes, sends fraud-prevention headers, and handles obligations, submission and receipts | ZikPro, a UK Frappe partner. 50 commits on the default branch, 24 Aug to 5 Oct 2026 (last push 17 Oct); MIT; Frappe and ERPNext `>=15,<17` | The base edition is free. Filing goes through "ZikPro's OAuth broker", and live filing is supported on the Frappe Cloud copy. A Pro edition adds partial exemption, the Capital Goods Scheme and domestic reverse charge. The vendor claimed "initial approval from HMRC" in January 2026 ([forum](https://discuss.frappe.io/t/erpnext-uk-vat-mtd-app/159246)) |
| [imorphr/making-tax-digital](https://github.com/imorphr/making-tax-digital) (Marketplace: [making_tax_digital](https://cloud.frappe.io/marketplace/apps/making_tax_digital), publisher Vimal Patel) | MTD VAT: OAuth, obligation sync, return preparation from box filters, submission, receipts and fraud headers | iMORPHr. 178 commits, April 2025 to July 2026 (last push Aug 2026); `frappe>=15,<16` in the repository, though the Marketplace lists v15 and v16 | The code is open, but submission runs through the "iMORPHr MTD Connector", which needs a paid subscription per VAT number (`docs/user_docs/01_user_guide.md` §4) |
| Case Solved "ERPNext United Kingdom" ([Marketplace](https://cloud.frappe.io/marketplace/apps/uk)) | MTD VAT, EU and reverse-charge VAT, VAT adjustments. RTI is "coming soon" | Case Solved Ltd. Listed for Version 14. The source repository it names is not public; [CaseSolvedUK/uk-support](https://github.com/CaseSolvedUK/uk-support) holds only a README (last commit Jun 2023) | Free to use, with a charge per VAT submission. Hosted |
| [software-to-hardware/erpnext-vat-mtd](https://github.com/software-to-hardware/erpnext-vat-mtd) (`uk_vat`) | VAT return generator, drill-down, optional MTD submission | Paul Banks. Last commit April 2021, 16 commits, GPL-3.0, 9 open issues. Forks exist (`Inshasis/uk_vat`, 2023) | **Not maintained.** A forum post from October 2025 reports that its fraud-prevention headers fail HMRC's checks, which "blocks production approval" ([forum](https://discuss.frappe.io/t/uk-vat-and-mtd-in-erpnext-v15/155489)) |
| [Cytanix/erpnext-mtd-plugin](https://github.com/Cytanix/erpnext-mtd-plugin) | MTD VAT directly to HMRC's APIs, with no third-party service | Cytanix Ltd. 43 commits, 11 to 30 Sep 2026 (last push 26 Oct); GPL-3.0; **v16 only** | Pre-release: "Do not use it to submit production VAT returns" |
| [walkinlogic/uk_hrms](https://github.com/walkinlogic/uk_hrms) | Called "UK specific additions" for HRMS, but holds only employee geolocation and asset DocTypes | One author, 5 commits on 23 April 2024 | Not a payroll app. Of no use here |
| UK payroll: PAYE, NI, RTI, pensions, statutory pay | — | **None found** | Searched GitHub, the Frappe Marketplace and the forum (see "How this was checked") |

Before any app goes live, check it on HMRC's own MTD software finder, which the gov.uk page links to
([gov.uk](https://www.gov.uk/guidance/find-software-thats-compatible-with-making-tax-digital-for-vat)).
We could not search that finder from here.

## People records

| Need | Verdict | What Frappe has, and what is missing | Evidence |
|---|---|---|---|
| Employee file: job, department, manager, start date, status, employment type | Out of the box | Employee: `designation`, `department`, `reports_to`, `date_of_joining`, `status`, `employment_type` (Frappe HR), `holiday_list`, personal and company email, addresses, education and work history | ERPNext `setup/doctype/employee/employee.json`; Frappe HR `hrms/setup.py` custom fields |
| Contract | With setup | Employee has `contract_end_date`, `scheduled_confirmation_date` (end of probation) and `notice_number_of_days`. ERPNext's Contract DocType accepts party type Employee and has templates, signed state and fulfilment terms. Frappe HR has Appointment Letter and Job Offer templates. The UK day-one written statement must be written as a Contract Template | `crm/doctype/contract/contract.json` (party_type `Customer/Supplier/Employee`); `hr/doctype/appointment_letter_template` |
| Right-to-work evidence and expiry | With setup | Only passport fields: `passport_number`, `date_of_issue`, `valid_upto`, `place_of_issue`. We would add Custom Fields (check type, date checked, share code, permission expiry, follow-up date), a Notification some days before expiry, and attach the evidence. The Home Office check itself happens outside Frappe | `employee.json` |
| Emergency contacts | Out of the box, one contact | `person_to_be_contacted`, `emergency_phone_number` and `relation`. More than one contact needs a child table | `employee.json` |
| Bank details | With setup | `bank_name`, `bank_ac_no` and `iban`. There is **no sort code field**. Add one as a Custom Field, or keep a Bank Account record against the Employee, since its `party_type` links to any DocType | `employee.json`; `accounts/doctype/bank_account/bank_account.json` |
| NI number | With setup | No field. Add a Custom Field and a format check (two letters, six digits, then A, B, C or D) | `employee.json` |
| Tax code and starter declaration | Gap | No fields, and nothing would read them, because there is no PAYE engine (see Payroll). The fields belong to the UK payroll app | `employee.json`; `salary_slip.py` |
| Documents | Out of the box | Any file can be attached to any record. Employee Onboarding and Separation templates hold checklists of activities. No register tracks each document's type and expiry | `hr/doctype/employee_onboarding`, `employee_separation` |

## Leave and absence

| Need | Verdict | What Frappe has, and what is missing | Evidence |
|---|---|---|---|
| Holiday allowance and accrual | With setup | Leave Type with `is_earned_leave`, `earned_leave_frequency` and `rounding`; Leave Policy, Leave Policy Assignment, Leave Period and Leave Allocation. Someone must set 5.6 weeks (28 days), decide whether bank holidays count, and pro-rate for part-timers by hand. The 12.07% hours-based accrual for irregular-hours and part-year workers is not there | [docs: Leave Type](https://docs.frappe.io/hr/leave-type); `hr/doctype/leave_type/leave_type.json` |
| Bank holidays for England | Out of the box | Holiday List, "Add Local Holidays": country United Kingdom, subdivision England. It uses the `holidays` library (`holidays~=0.28`). Weekly offs are added the same way | [docs: Holiday List](https://docs.frappe.io/hr/holiday-list); `setup/doctype/holiday_list/holiday_list.py:62-90` |
| Requests and approvals | Out of the box | Leave Application with a Leave Approver set on the Employee or Department, Leave Block List, email notifications, and the self-service app (`frontend/`) | `hr/doctype/leave_application`; `department_approver` |
| Carry-over | Out of the box | `is_carry_forward`, `maximum_carry_forwarded_leaves` and `expire_carry_forwarded_leaves_after_days` | `leave_type.json` |
| Sickness recording | Out of the box | A sick Leave Type, or Attendance marked absent or on leave; Leave Without Pay; partly paid leave (`is_ppl`, `fraction_of_daily_salary_per_leave`) | `leave_type.json` |
| SSP | Gap | Nothing calculates SSP. In 2026/27 that is £123.25 a week or 80% of average weekly earnings, whichever is lower, from the first day (gov.uk). Nothing handles qualifying days, linked periods, the 28-week limit or fit notes after seven days. Partly paid leave is a fraction of salary, not SSP. Build it in the UK payroll app | [gov.uk rates 2026/27](https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027); `leave_type.json` |
| Parental leave recording | With setup | Leave Types for maternity, paternity, shared parental and adoption, each with a maximum. Keeping-in-touch days need a custom record | `leave_type.json` |
| SMP, SPP, ShPP and SAP | Gap | Nothing works out average weekly earnings, applies 90% for six weeks then £194.32 or 90%, or recovers the 92% or 103% through the EPS. Build it in the UK payroll app | gov.uk rates 2026/27 |
| Return to work | Gap, small | No DocType. Build a small Return to Work record, or a Task raised by a Notification when the leave ends, with the fit note attached | `hr/doctype` (none) |

## Payroll in the UK

| Need | Verdict | What Frappe has, and what is missing | Evidence |
|---|---|---|---|
| Salary structures | Out of the box | Salary Component, Salary Structure, Salary Structure Assignment, Payroll Period (set it to 6 April to 5 April) and Payroll Entry. Frequencies are Monthly, Fortnightly, Bimonthly, Weekly and Daily; there is **no four-weekly** | `payroll/doctype/payroll_entry/payroll_entry.json:69` |
| PAYE income tax by tax code | Gap | No tax code. Income Tax Slab projects the year and spreads the remaining tax over the periods left (`calculate_variable_tax`, `salary_slip.py:1585`). It has no K codes, no 50% overriding limit, no Week 1/Month 1 or X basis, no allowance for each employee, and takes no P6 or P9 code notices. Bands add +1 (`:2265-2272`). The working route is one formula component for each code, as our mock-up does: Month 1 only, and wrong for joiners mid-year, code changes and bonuses | `salary_slip.py`; [docs: Income Tax Slab](https://docs.frappe.io/hr/income-tax-slab); `archive/demo/research/hr-payroll.md:835-840` |
| Emergency and Scottish or Welsh codes | Gap | No basis flag and no country of residence. Scotland's six bands could be a slab condition on a Custom Field, but the method above would still be wrong. The emergency codes from April 2026 are 1257L W1, M1 and X | gov.uk rates 2026/27 |
| Employee and employer NI by category | Gap | No category letters, no LEL, PT, ST or UEL for each period, no directors' annual method and no Employment Allowance (£10,500). It can only be done as a formula component for each category, and nothing records NI-able pay or the letter for RTI. In v15 a Salary Component is only Earning or Deduction, so employer NI cannot be accrued through payroll. v16.20 adds employer contributions with their own liability account | `salary_component.json:71` (`Earning\nDeduction`); [hrms v16.20.0 notes](https://newreleases.io/project/github/frappe/hrms/release/v16.20.0) |
| Student and postgraduate loans | With setup for the deduction, gap for HMRC's notices | A formula component for each plan (1, 2, 4, 5 and PGL; thresholds £26,900, £29,385, £33,795, £25,000 and £21,000; 9% or 6%) keyed on a Custom Field. The SL1, SL2, PGL1 and PGL2 start and stop notices come through HMRC's Data Provisioning Service, and nothing receives them | gov.uk rates 2026/27 |
| Pension auto-enrolment, with employee and employer contributions | Gap | Contributions are only formula components, and v15 cannot post the employer's part (see NI). Nothing assesses workers (£10,000 trigger; £6,240 to £50,270), enrols them, handles opt-out and refund, postponement or re-enrolment, sends letters or reminds about the declaration of compliance | [TPR earnings thresholds](https://www.thepensionsregulator.gov.uk/employers/new-employers/im-an-employer-who-has-to-provide-a-pension/declare-your-compliance/ongoing-duties-for-employers/earnings-thresholds); [DWP review 2026/27](https://www.gov.uk/government/publications/review-of-the-automatic-enrolment-earnings-trigger-and-qualifying-earnings-band-for-202627) |
| Provider submission (Nest, People's Pension and others) | Gap | No PAPDIS file and no provider API | No app found |
| Salary sacrifice | With setup | A Deduction with `exempted_from_income_tax` lowers taxable pay in the slab engine. With formula components it must be taken off inside both the PAYE and the NI formulas, as the mock-up does with `PEN`. Frappe has no idea of NI-able pay | `salary_component.json:232` |
| Overtime and other deductions | With setup | Additional Salary for one-off earnings and deductions; salary from timesheets (`salary_slip_based_on_timesheet`); advances recovered from salary. v15 has no Overtime DocType | `salary_structure.json:103`; `employee_advance.json:185` |
| Payslips with year to date | Out of the box | The Salary Slip carries `year_to_date` and `month_to_date` for each component and `gross_year_to_date`, measured over the Payroll Period. It has PDF and email, and employees see it in the self-service app | `salary_slip.json:62-76` |
| RTI: the FPS on or before each payday | Gap | Nothing (see "The answers in short", item 2). HMRC requires it "on or before your employees' payday". The app needs the Government Gateway Transaction Engine, the RTI XML schemas and HMRC's recognition tests. craigfrancis/hmrc-rti is a reference | [gov.uk: reporting to HMRC](https://www.gov.uk/running-payroll/reporting-to-hmrc); [#21723](https://github.com/frappe/erpnext/issues/21723) |
| RTI: the EPS to HMRC | Gap | Nothing. It is due by the 19th of the next tax month, and carries statutory pay recovered, the Employment Allowance claim and periods with no payment | gov.uk: reporting to HMRC |
| P45 for leavers | Gap | Leavers exist (`relieving_date`, Employee Separation, Full and Final Statement). There is no P45 and no leaving date on an FPS | `employee.json`; `hr/doctype/full_and_final_statement` |
| P60 each April | Gap | The year-to-date figures exist, but not the HMRC figures (NI-able pay by category, statutory pay) or the form | `salary_slip.json` |
| P11D and benefits | Gap | Employee Benefit Application and Claim are India's flexible benefits. There is no P11D or P11D(b). Payrolling benefits becomes mandatory in phases from 6 April 2027, so this grows | [Saffery on mandatory payrolling](https://www.saffery.com/insights/articles/mandatory-payrolling-of-benefits-in-kind-from-april-2027/) |
| Payroll journal into the books | Out of the box | Submitting the slips from the Payroll Entry posts an accrual Journal Entry: earnings to expense, deductions to their liability accounts, net to Payroll Payable (`make_accrual_jv_entry`, `payroll_entry.py:557`). Employer NI and pension need a manual Journal Entry in v15 | [docs: Payroll Entry](https://docs.frappe.io/hr/payroll-entry) |
| Paying net pay | With setup, and a gap for the bank file | "Make Bank Entry" drafts the payment Journal Entry (`payroll_entry.py:908`), and a Bank Remittance report exists. There is no BACS Standard 18 file and no payment initiation. Capxul's own payment rails would replace this | `payroll/report/bank_remittance` |
| Paying HMRC | With setup, and a gap for the amount | A Payment Entry or Journal Entry against the PAYE and NI liability can be made by hand. Nothing works out what is due after Employment Allowance and statutory recovery (the P32) | — |
| The contractor abroad | Out of the box | A Supplier in their currency, a Purchase Invoice and a Payment Entry that books the exchange difference. A salary structure in another currency would also work, since Frappe HR supports payroll in several currencies. Whether UK PAYE applies to them is for an adviser; the books side needs nothing new | `salary_structure_assignment.json` (`currency`) |

## Expenses

| Need | Verdict | What Frappe has, and what is missing | Evidence |
|---|---|---|---|
| Claims | Out of the box | Expense Claim with lines (date, Expense Claim Type, amount, sanctioned amount, cost centre, project), Expense Approver, and the self-service app | `hr/doctype/expense_claim`, `expense_claim_detail.json` |
| Receipts | Out of the box | An attachment on each claim. There is no OCR, and none is needed | — |
| VAT on receipts | Out of the box | A table of taxes on the claim (`expense_taxes_and_charges`) | `hr/doctype/expense_taxes_and_charges` |
| Policy | With setup | The approver for each Employee or Department, plus Workflow. Limits and rules (per diem caps, receipt above £X) need a Server Script. There is no policy engine | `expense_claim_type.json` (only `expense_type`, `description`, `accounts`) |
| Mileage | Gap, small | No mileage claim. Vehicle Log covers company vehicles only. Build a Mileage claim type with miles, rate and a tax-year counter for HMRC's 45p and then 25p after 10,000 miles | `hr/doctype/vehicle_log` |
| Advances | Out of the box | Employee Advance, linked to a claim. The unclaimed part can be returned or taken from salary (`repay_unclaimed_amount_from_salary`) | `employee_advance.json:185` |
| Reimbursement | Out of the box | A Payment Entry against the claim, or through payroll with an Additional Salary (with setup) | `hr/report/unpaid_expense_claim` |

## Books

| Need | Verdict | What Frappe has, and what is missing | Evidence |
|---|---|---|---|
| Double entry | Out of the box | GL Entry, Payment Ledger, Journal Entry and Journal Entry Template | `accounts/doctype` |
| Chart of accounts | With setup | There is **no UK chart template**. The verified charts cover AU, NZ, SG, DE, FR, NL, SE and others, but not GB. Start from the standard numbered chart and edit it, or load a UK chart with the Chart of Accounts Importer | `accounts/doctype/account/chart_of_accounts/verified/`; `chart_of_accounts_importer` |
| Sales and purchase invoices | Out of the box | Sales Invoice, Purchase Invoice, recurring invoices through Auto Repeat, and Dunning | `accounts/doctype` |
| Credit notes | Out of the box | A return against the invoice (`is_return`) on either side | — |
| Payments and allocation | Out of the box | Payment Entry with references, the Payment Reconciliation tool (and a background run of it), and receivable and payable ageing | `payment_reconciliation`, `process_payment_reconciliation` |
| Bank feeds | With setup | Plaid in core lists `GB` among its countries. It needs a Plaid account and keys in `site_config.json`, and syncs every hour. Otherwise use Bank Statement Import (CSV or XLSX) | `erpnext_integrations/doctype/plaid_settings/plaid_connector.py:32-33`; [docs: Plaid](https://docs.frappe.io/erpnext/plaid-integration) |
| Bank reconciliation | Out of the box, basic | The Bank Reconciliation Tool matches automatically only when the reference number is the same; everything else is matched by hand | [docs: Bank Reconciliation Tool](https://docs.frappe.io/erpnext/bank-reconciliation-tool) |
| VAT on transactions | With setup | Sales and Purchase Taxes and Charges Templates, Item Tax Template (20%, 5%, 0%, exempt), Tax Category and Tax Rule. Reverse charge on the contractor's services needs "add" and "deduct" rows | `item_tax_template`, `tax_rule` |
| VAT return (nine boxes) | Community app | Core has no UK VAT return report. The regional reports are UAE VAT 201, a VAT audit report (South Africa), IRS 1099 and Italy's e-invoice register. The MTD apps above build the boxes | `accounts/report` (none); `regional/report/` |
| MTD VAT submission | Community app | Zikpro UK VAT (free base edition, broker, active), iMORPHr (paid connector, active), Case Solved (hosted), software-to-hardware (unmaintained), Cytanix (pre-release, v16). We could also build our own: HMRC's VAT API with OAuth and fraud-prevention headers | Table above |
| Fixed assets | Out of the box | Asset, Asset Category, depreciation schedules (straight line, written down value, double declining), movement, repair, value adjustment and disposal. UK capital allowances are a tax computation, done outside the books | `assets/doctype` |
| Month and year end | Out of the box for the books; gap for statutory filing | Period Closing Voucher, Accounting Period locks, Exchange Rate Revaluation and deferred revenue and expense. Statutory accounts for Companies House (iXBRL) and the CT600 are not in Frappe; an accountant's tool usually does them | `period_closing_voucher`, `accounting_period` |
| Management reports | Out of the box | Profit and Loss, Balance Sheet, Cash Flow, Trial Balance, General Ledger, receivable and payable, Budget Variance, Gross Profit, Financial Ratios, Consolidated Financial Statement and Profitability Analysis | `accounts/report` |
| Multi-currency | Out of the box | A currency on each account and party, Currency Exchange Settings that fetch rates automatically, Exchange Rate Revaluation, and exchange gain and loss on payments | `currency_exchange_settings` |

## CRM

Frappe CRM is a separate app under **AGPL-3.0**. ERPNext also keeps its own older CRM (Lead,
Opportunity and Prospect) under GPL-3.0.

| Need | Verdict | What Frappe has, and what is missing | Evidence |
|---|---|---|---|
| Leads | Out of the box | CRM Lead, from manual entry, CSV import, web forms or Meta ads, with assignment rules | [docs: CRM](https://docs.frappe.io/crm); `fcrm/doctype/crm_lead` |
| Deals and pipeline | Out of the box | CRM Deal and its statuses, a drag-and-drop Kanban board, lost reasons, custom views and SLAs | [frappe/crm README](https://github.com/frappe/crm); `crm_deal`, `crm_lost_reason`, `crm_service_level_agreement` |
| Contacts and organisations | Out of the box | Contact and CRM Organization, linked when a lead becomes a deal | `crm_organization` |
| Email logging | With setup | An Email Account must be configured. Email sent from a lead or deal, and its replies, then appear on the timeline, with templates | docs: CRM |
| Call logging | With setup | CRM Call Log. Calling from the CRM with recordings needs the Twilio integration, which works in the UK, or Exotel, which is India-focused | `crm_call_log`, `crm_twilio_settings`, `crm_exotel_settings` |
| Tasks | Out of the box | CRM Task and notes on each lead or deal, in one Tasks list | `crm_task`, `fcrm_note` |

## Projects

| Need | Verdict | What Frappe has, and what is missing | Evidence |
|---|---|---|---|
| Projects | Out of the box | Project, Project Template, Project Type, and ways to work out % complete | `projects/doctype/project` |
| Tasks | Out of the box | Task with dependencies, Gantt, Kanban and calendar | `task`, `task_depends_on` |
| Timesheets | Out of the box | Timesheet with Activity Type, hours, and a billable flag on each line | `timesheet`, `timesheet_detail` |
| Billing from timesheets | Out of the box | A Sales Invoice made from timesheets, the billing and costing rate for each person in Activity Cost, and the Timesheet Billing Summary | `activity_cost`; `projects/report/timesheet_billing_summary` |
| Budgets and costing | Out of the box | The project's `estimated_costing`, `total_costing_amount`, `total_billable_amount`, `total_billed_amount`, `total_purchase_cost` and `gross_margin`; a Budget against a Project with stop or warn actions; Budget Variance; Project Profitability (Frappe HR) | `project.json`; `accounts/doctype/budget`; `hr/report/project_profitability` |
| Resourcing | Gap | No capacity planning or bookings. There is only the after-the-fact Employee Hours Utilization report and task assignment. Build a simple allocation view, or leave it out | `hr/report/employee_hours_utilization_based_on_timesheet` |

## What we would build

Almost all of it is UK payroll. Frappe HR is the base it sits on: employees, structures, slips,
payroll runs and the accrual journal. Frappe now ships regional payroll as separate apps: "India
Payroll" was announced in July 2026, and Frappe HR v16.52 lets regional rules add employer
contributions to a slip ([forum](https://discuss.frappe.io/t/introducing-india-payroll-for-frappe-hr/163503),
[v16.52.0](https://github.com/frappe/hrms/releases/tag/v16.52.0)). A UK payroll app fits the same seam
and would be easier on v16 than on v15. It would hold:

1. **UK fields on the Employee**:
   - NI number and category;
   - tax code and its basis;
   - starter declaration (A, B or C);
   - student loan plans and the postgraduate loan;
   - director flag and appointment date;
   - right to work.
2. **The PAYE engine**: HMRC's cumulative and Week 1/Month 1 methods; the rest of the UK, Scotland
   and Wales; K codes and the 50% limit; previous pay and tax from a P45.
3. **The NI engine**: category letters; thresholds for each pay period; the directors' annual or
   alternative method; Employment Allowance.
4. **Student and postgraduate loans**, and the SL1 and SL2 notices.
5. **Statutory payments**: SSP, SMP, SPP, ShPP, SAP and bereavement pay, with the recovery figures for
   the EPS.
6. **Pension auto-enrolment**:
   - assessment, enrolment, postponement, opt-out with refund, and re-enrolment;
   - the letters to workers;
   - qualifying-earnings or full-pay contributions;
   - the provider file (PAPDIS) or API for Nest and others.
7. **RTI**: FPS, EPS, EYU, NVR and EAS over the Government Gateway. This includes HMRC's recognition
   tests and the Data Provisioning Service notices that come in (P6, P9, SL1, SL2).
8. **Leavers and year end**: P45, P60, P11D, P11D(b), and payrolled benefits from April 2027; P32 and
   the HMRC payment.
9. **Small items outside payroll**: mileage claims, right-to-work expiry, a return-to-work record, a
   UK chart of accounts, and MTD VAT (adopt Zikpro or build our own).

**Before forking.** ERPNext and Frappe HR are GPL-3.0, and Frappe CRM is AGPL-3.0, so a modified CRM
offered over the network must offer its source. Fork Frappe HR's `version-15` or `version-16` branch,
or better, add a separate UK payroll app beside it. A separate app keeps Frappe's upgrades. This is how
Frappe ships India Payroll, and how every other country app found here works: Kenya, Tanzania, Nigeria
and South Africa all have PAYE apps on GitHub.

## How this matches our own mock-up

Our research for the mock-up shows a UK payslip whose PAYE and NI are formula components written by
hand (`archive/demo/research/hr-payroll.md:126-128, 835-840`). It also leaves out the Income Tax Breakup tab
"because Capxul does not compute annual tax slabs" (`:1035`). That is honest about the shape. It is
exactly the "formula salary components a person sets up" route, and it is a Month 1 calculation for one
tax code and one NI category. Running payroll for real would also need cumulative PAYE, NI categories,
statutory pay, auto-enrolment, the FPS and EPS, and year-end forms. None of them exists in Frappe
today.

## How this was checked

- **Code.** Shallow clones of `frappe/hrms` at `version-15` (`186900a`, 4 November 2026) and
  `frappe/erpnext` at `version-15` (`e5cde8c`, 4 November 2026). We read DocType JSON for Employee,
  Leave Type, Holiday List, Salary Component, Salary Structure, Salary Structure Assignment, Salary
  Slip, Income Tax Slab, Payroll Entry, Expense Claim, Employee Advance, Contract, Bank Account and
  Project. We read `salary_slip.py` (`calculate_variable_tax`, `calculate_tax_by_tax_slab`),
  `payroll_entry.py`, `holiday_list.py` and `plaid_connector.py`. We listed every DocType and report
  in Frappe HR and ERPNext Accounts, Projects, Assets and CRM, and every regional folder. Frappe HR's
  `regional/` holds India and the UAE; ERPNext's holds Australia, Italy, South Africa, Turkey, the UAE
  and the US. Frappe CRM was read at `/tmp/crm` (`2cecd30`), the clone the CRM research used.
- **Community apps.** GitHub repository search (8 to 9 November 2026) for: `hmrc frappe`,
  `hmrc erpnext`, `uk payroll frappe`, `uk payroll erpnext`, `making tax digital erpnext`,
  `mtd vat frappe`, `rti erpnext`, `paye erpnext`, `paye frappe`, `national insurance frappe`,
  `national insurance erpnext`, `hmrc rti fps`, `uk hrms frappe`, `erpnext uk`,
  `nest pension erpnext`, `bacs erpnext`, `erpnext uk localisation` and `hmrc in:readme frappe`. Each
  hit was cloned and its README and history read. `AbacusRog/PAYE`, which one search engine listed as a
  UK payroll app, now returns 404.
- **Docs.** Frappe HR: [Income Tax Slab](https://docs.frappe.io/hr/income-tax-slab),
  [Leave Type](https://docs.frappe.io/hr/leave-type), [Holiday List](https://docs.frappe.io/hr/holiday-list),
  [Payroll Entry](https://docs.frappe.io/hr/payroll-entry). ERPNext:
  [Bank Reconciliation Tool](https://docs.frappe.io/erpnext/bank-reconciliation-tool),
  [Plaid](https://docs.frappe.io/erpnext/plaid-integration). [Frappe CRM](https://docs.frappe.io/crm).
- **UK rules.** [gov.uk rates and thresholds 2026/27](https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027),
  [reporting to HMRC](https://www.gov.uk/running-payroll/reporting-to-hmrc),
  [payroll software](https://www.gov.uk/payroll-software),
  [MTD VAT software](https://www.gov.uk/guidance/find-software-thats-compatible-with-making-tax-digital-for-vat),
  [TPR earnings thresholds](https://www.thepensionsregulator.gov.uk/employers/new-employers/im-an-employer-who-has-to-provide-a-pension/declare-your-compliance/ongoing-duties-for-employers/earnings-thresholds).
- **Prior research.** `archive/demo/research/hr-payroll.md`, `accounting.md` and `crm-projects.md`;
  `docs/design/frappe/payroll.md`, `accounting.md`, `crm.md` and `projects-and-startup.md`;
  `books/target/payroll/hr-decisions.ts` (`payroll.hr-scope`). None of them had settled the UK
  statutory questions. The mock-up research models PAYE and NI as formulas and says so.
- **Not checked.** HMRC's own lists of recognised payroll and MTD software, which are behind a search
  service we could not query. The real behaviour of the community MTD apps against HMRC's sandbox. The
  Frappe Cloud Marketplace beyond the three listings named here.
