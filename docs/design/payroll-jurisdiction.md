# Payroll: which country first, and what gives us a head start

Written 10 November 2026. Research only. This is not legal or tax advice. Every source was read on 10 November 2026 unless it says otherwise. "Unverified" means from memory, a search snippet or a secondary page, not from the primary source.

## The short answer

- Frappe HR has **no United States payroll** of its own. It has a generic engine and one US report (1099 for suppliers). It has no UK payroll either.
- The best head start is a **provider API** (Check, Gusto Embedded and similar) that calculates, deposits and files in all 50 states. A smaller head start is a young MIT-licensed Frappe app, **US Payroll by Bizmap**, which runs on v16 and does federal tax, W-2, W-3 and Form 941 forms.
- No serious open-source US withholding engine exists. The IRS publishes its tables as PDF.
- Pick US, but do not build the calculation. Run the first company's payroll in Frappe as the record, and let a provider or an accountant file.

## 1. What Frappe HR and ERPNext do, per country

Read in the bench: frappe 16.55.2, erpnext 16.54.0, hrms 16.53.1 (git tags in `/home/frappe/vol/frappe-bench/apps`).

**How tax works in the engine (`hrms/payroll/doctype/salary_slip/salary_slip.py`, `calculate_variable_tax`).** It projects the year's taxable pay, runs it through an **Income Tax Slab** (from, to, percent, optional condition), subtracts tax already paid, and divides the rest by the remaining pay periods. That is the Indian "annual projection" model. The slab has no filing status, no W-4 inputs, no wage-base cap and no cumulative-week method.

**What "country" changes.** On company setup, `hrms/overrides/company.py` loads `hrms.regional.<country>.setup`. `hrms/regional/` has only two folders, `india` and `united_arab_emirates`. ERPNext's `erpnext/regional/` has `united_states`, `united_arab_emirates`, `australia`, `italy`, `south_africa` and `turkey`.

| Country | What exists in the installed code | Filing |
|---|---|---|
| **United States** | ERPNext: an "IRS 1099 required" tick on Supplier, a sales-tax-exempt tick on four documents, an **IRS 1099 report** and a 1099-MISC print format (`erpnext/regional/united_states/setup.py`, `report/irs_1099`). A verified US chart of accounts with "Payroll Liabilities" accounts (federal withholding, FICA, FUTA, `us_chart_of_accounts.json`). HRMS: nothing. | None. No W-2, W-4, 941, 940, state withholding, state unemployment or new-hire reporting. |
| **United Kingdom** | Nothing in `hrms/regional` or `erpnext/regional`. No UK chart in the verified list. | None. |
| **India** | HRMS: HRA exemption, tax with marginal relief, Provident Fund and Professional Tax component types, gratuity rule, `salary_components.json`. | Reports only. Real localisation lives in other apps (section 2). |
| **UAE** | HRMS: three gratuity rules. ERPNext: VAT settings and a VAT 201 report. | VAT report only. |
| Australia, Turkey, South Africa, Italy | Mostly custom fields and VAT or e-invoice helpers. South Africa has VAT settings, Italy has an e-invoice XML. | Not payroll. |

Plainly: the US and UK each get a chart of accounts at most. India is the only country with payroll rules in HRMS, and only partly.

## 2. Existing Frappe apps

Marketplace list read from `cloud.frappe.io/marketplace` and its public API. GitHub facts from the GitHub API.

| App | Maintainer, licence | v16? | Alive? | What it does |
|---|---|---|---|---|
| **India Compliance** (`resilient-tech/india-compliance`) | Resilient Tech, GPL-3.0 | Yes, release v16.11.0 on 21 Oct 2026 | Very. Created 2021, 100 contributors, pushed 9 Nov 2026 | The benchmark: GST returns, e-invoice, e-waybill through government APIs. Not payroll. |
| **India Payroll** (`frappe/india-payroll`) | Frappe Technologies, GPL-3.0 | **No.** Its `pyproject.toml` pins Frappe and HRMS `>=17.0.0-dev` | Active, created Apr 2026 | PF, ESI, professional tax, TDS, Form 24Q e-filing through a third-party API (Sandbox), Form 16. |
| **US Payroll** (`Bizmap-Technologies-Pvt-Ltd/US-Payroll`) | Bizmap (India), MIT | Yes, branch `version-16` | Young. Created 26 May 2026, 5 stars, last push 21 Oct 2026, one vendor | See below. |
| `frappe/erpnext_usa` | Frappe, GPL-3.0 | Dead | Last push Feb 2022 | Empty shell. |
| `animusdigitalco/erpnext-usa` | One person, GPL-3.0 | Unknown | Created Oct 2026, 1 star | US chart of accounts, 1099/W-9 handling. Not payroll. |
| TaxJar Integration | Marketplace | Unverified | Unverified | US sales tax. Not payroll. |
| South Africa payroll (`EPIUSECX/za_local_payroll`) | MIT | Yes (badge) | Active | PAYE, UIF, SDL, SARS reporting. |
| Nepal, Tanzania, Nigeria, KSA | Various | Mixed | Active | Local payroll or e-invoicing. |
| UK: Making Tax Digital (VAT), Zikpro UK VAT | Small vendors | Unverified | Recent | **VAT only.** I found no Frappe app for HMRC payroll filing (RTI). |

**US Payroll in detail** (read `override/salary_slip.py`, `form_941_details`, README, `pyproject.toml`). It computes federal tax from an annualised-wage and standard-deduction method, with Married Filing Jointly and "more than one job" flags on the tax slab. FICA is salary components with employee and employer rows. It generates W-2, W-3 and Form 941 forms, ACH files and printed checks. It has a `State` doctype with one field and I found no state withholding tables. Its reports look Texas-flavoured (a TMRS pension report). The README claims "federal and FICA taxes" and forms. I did not run it. It is not a filing integration: I found no e-file code. Its `pyproject.toml` lists Frappe `>=15,<17`.

**Nothing comparable to India Compliance exists for the US.** India Compliance works because the government publishes APIs that fit one tax. The US has fifty-odd rule sets and no single API.

## 3. Open-source engines outside Frappe

| Project | Covers | Licence | Calculates or files |
|---|---|---|---|
| **IRS Publication 15-T (2026)** | Federal withholding. Worksheet 1A and "Percentage Method Tables for Automated Payroll Systems". Published as PDF and EPUB only. I saw no Excel, CSV or XML. Source: irs.gov/publications/p15t | US government | The official rules. A calculator means transcribing tables every year. |
| IRS **Publication 15 (2026)** | FICA (Social Security wage base $184,500 in 2026), deposit rules, FUTA | US government | Rules only. |
| **PSLmodels Tax-Calculator** (`taxcalc`) | Federal income and payroll tax microsimulation | CC0 (README badge) | Annual liability for policy analysis. Not per-paycheck withholding. Unverified fit. |
| **PolicyEngine-US** | Federal and many state taxes and benefits | AGPL-3.0 | Annual household simulation. Not withholding. Unverified fit. |
| `python-taxes` (PyPI) | Federal withholding, Social Security, Medicare, 2023 to 2025 | Unverified | Federal only (per search snippet). |
| Small GitHub repos | One-person paycheck calculators using Pub 15-T | Mostly none stated | Calculate only. Not reliable enough to depend on. |
| **IRS MeF** (employment tax) | XML schemas for 940, 941, 943, 944, 945, by tax year | Free to read | **Files.** Needs IRS software ID, Assurance Testing, certificate. Source: irs.gov e-file provider pages. |
| **IRS IRIS** | 1099 series. Portal (CSV upload) and A2A (API). FIRE is being retired: Pub 1099 says end of 2026, other IRS material said January 2027 (sources differ) | Free | **Files** 1099s. Needs a Transmitter Control Code (can take 45 days). |
| **SSA Business Services Online** | W-2 and W-3 upload in EFW2 format | Free | **Files** W-2. Per a search snippet (the SSA site returned 403 to me), SSA is not onboarding new web-service users and changed BSO registration on 7 Nov 2026. Unverified. |
| Symmetry Tax Engine | All states and local | Commercial | Calculates. Not open source. |

**Finding:** the filing doors are free but need accreditation. The calculation layer is the missing part, and it is the part most easily bought.

## 4. Payroll through a provider's API

| Provider | What it says it takes on | Pricing |
|---|---|---|
| **Check** (`checkhq.com/platform/payroll`) | Tax calculation, payments and filing in all 50 states and DC; quarterly and yearly returns; new-hire reporting; "fully licensed money movement". The page says nothing about penalty liability, 1099 or W-2. | Not public. A help-centre suggestion of about $40 a month plus $6 a person is a partner resale guide from a search snippet. Unverified. |
| **Gusto Embedded** | Withholds, files and remits federal, state and local payroll tax (marketing and terms, via search). | Set by the platform, invoiced under Gusto's terms. Partner rates negotiated. |
| Zeal, Rippling Embedded, Paychex Flex, Salsa, Fingercheck | Named by a comparison page (fintechspecs.com). It gives no liability terms. | Mostly not public. |

**Liability for wrong filings is not stated in anything public I could reach.** It sits in the partner contract. This is the first question to ask any provider.

**Funding.** Everything I found funds payroll in dollars by bank transfer. None was shown to accept a stablecoin. Bridge's payroll guide (`apidocs.bridge.xyz/get-started/guides/common-use-cases/payroll`) describes dollars or euros in through a virtual account, converted to stablecoin, then sent to employee wallets. It says nothing about taxes, withholding or filing. It does not describe paying a bank account from stablecoin. Its sample mixes `solana` wallets with a `tempo` rail, so check it before building. Other stablecoin payroll players (Toku, Deel, SpherePay, Circle payouts) mostly move money. SpherePay's page says "You're responsible for tax reporting". Vendor claims, unverified.

So: a conversion to dollars before payroll is needed with any tax-filing provider.

## 5. What "US first" involves that the UK did not

| Item | Honest size |
|---|---|
| Federal income tax withholding | Small. Pub 15-T formulas, yearly table updates, W-4 inputs. Days to build, but wrong numbers carry penalties. |
| FICA and Medicare, federal unemployment | Small. Rates and caps in Pub 15 (Social Security cap $184,500; FUTA base $7,000). |
| State income tax withholding | **Large.** Most states withhold, each with its own forms, tables and registration. Counts unverified. |
| State unemployment, state disability, paid-leave levies | **Large.** Every state has its own rate per employer, filings and wage base. |
| Local taxes | Medium to large in a few places. Unverified. |
| Deposits | Medium. Monthly or semiweekly by lookback (the $50,000 test), and a $100,000 next-day rule (Pub 15). Needs EFTPS or provider. Quarterly 941, annual 940. |
| New-hire reporting | Small each, but per state. Pub 15 says all 50 states have a registry. |
| W-2 and 1099 | W-2 and W-3 by 31 January. 1099-NEC threshold is $2,000 for payments after 2025 (Pub 1099, 2026). |
| Employee vs contractor | A legal test, not a field. Misclassification is a risk. |
| Pay frequency, final pay, pay-stub rules | Per state. Unverified. |

The UK has one authority and one real-time feed. The US has dozens of authorities. That is the real reason to buy and not build the calculation.

## 6. Paying wages in a stablecoin (orientation only)

- **FLSA.** 29 CFR 531.27 says the Act's minimum-wage and overtime sections "require payments ... in cash or negotiable instrument payable at par" (eCFR, read 10 Nov 2026). Whether a dollar stablecoin counts is not settled. A lawyer must say.
- **State laws.** They differ. Law-firm notes (Proskauer 2022, Hunton, Harris Beach) say New York and California do not clearly allow or ban crypto wages. California requires no discount to redeem. Several states require employee consent for direct deposit. Secondary sources, mostly 2021 to 2024.
- **Tax.** IRS Notice 2014-21, Q&A-11: virtual currency paid as wages is subject to income tax withholding, FICA and FUTA, and reported on Form W-2. Value is fair market value in dollars at payment (Q&A-5). Whether a USD stablecoin is "virtual currency" there is a lawyer question. Withholding is taken in dollars and deposited in dollars.
- **Typical structure.** Employers either pay dollars and let the employee choose a conversion, or pay a stablecoin portion by written election with the rest in dollars. Pay at least minimum wage in dollars. Vendor material (Thomson Reuters, 14 Aug 2025) also suggests signed acknowledgements.
- **Federal stablecoin law.** The GENIUS Act's OCC final rule was announced 21 October 2026 and takes effect 18 January 2027. Fed, FDIC, NCUA, Treasury, FinCEN and OFAC rules are still mostly proposals (Mayer Brown, Nov 2026; law-firm summary, not OCC's own page). It governs issuers. It does not address wages.

## 7. Routes compared

| Route | Day one | Still by hand | Effort | Legal exposure | Second country |
|---|---|---|---|---|---|
| **A. Build federal-only on Frappe HR** | Federal tax and FICA on slips | All state tax, deposits, 941, 940, W-2, new hire | Medium to build, ongoing yearly upkeep | **High.** Wrong withholding is our product's fault | Reusable engine shell, new rules each time |
| **B. Adopt an open-source engine** | Little. No withholding engine exists. Bizmap's app is the nearest (federal, forms) | State, filing, deposits | Medium. Bizmap is young, one vendor, untested by us | High. Same as A, less control | Poor |
| **C. Provider API calculates and files, Frappe as record** | Gross-to-net and filings, in all states | Funding in dollars, syncing records | Medium. A sync and funding flow | **Lowest** if the contract moves liability; unverified | Good. Same pattern per country (see India Payroll's third-party filing) |
| **D. Contractors only (1099)** | Pay contractors, track W-9, 1099 report in ERPNext | File 1099 through IRIS or an accountant | Small | Low to medium. Misclassification risk | Good |
| **E. Run payroll in Frappe, file by hand or via accountant** | A real company on real slips | All filings and deposits by the accountant | Small to start | Medium. Depends on the accountant | Fine for one company, not a product |

## 8. Recommendation and first prototype

1. **Choose US.** The owner's reasoning is sound for stablecoin treatment. I could not verify his legal-path claim.
2. **Do not build or adopt a withholding engine.** Treat payroll calculation and filing as a bought service (route C), with Frappe HR as the record. Start the first company on route E with a payroll accountant, so a real company is live while the API integration is built. Add route D (contractors, 1099) as the first Capxul-native flow, since ERPNext already has the 1099 report.
3. **Pay wages in dollars at first.** Fund payroll through a Bridge-linked dollar account. Offer stablecoin pay to contractors first. Employee stablecoin pay waits for legal advice.
4. **Prototype first:** a spike in the bench that takes one approved Salary Slip, sends it to a provider sandbox (Check or Gusto Embedded, after asking for terms), and writes the returned net pay, taxes and filing status back to the slip. Also run Bizmap US Payroll on a throwaway v16 site and compare its federal figure with Pub 15-T Worksheet 1A for three test employees. That tells us how far its numbers can be trusted.
5. **Questions for each provider:** who pays a penalty for a wrong filing, what do they need before a Safe-funded company can sign up, can funds arrive from a Bridge account, what do they charge.

## 9. What I could not verify

- Provider liability terms, partner pricing and funding rules (marketing pages and secondary sites only; Gusto and SSA pages returned 403 to me).
- SSA web-service onboarding and the BSO change dates (search snippet only).
- When FIRE closes (IRS sources differ).
- Whether Bizmap US Payroll caps Social Security at the wage base, handles state tax, or e-files. I read part of it and did not run it.
- Counts of states with wage income tax, local taxes, and pay-frequency rules (from memory).
- Current state wage-payment rules on crypto and stablecoins (law-firm notes, 2021 to 2025).
- The Frappe Cloud marketplace listing details beyond names.
- Whether Bridge can send stablecoin to a US bank account by API (the guide read does not say; other Bridge docs not read).

## What a lawyer must confirm

- Whether a dollar stablecoin counts as "cash or negotiable instrument payable at par" under the FLSA and each target state's law.
- Whether Notice 2014-21 applies to a USD stablecoin, and how value is measured.
- Employee consent, election and disclosure rules; minimum cash floor.
- Whether Capxul becomes a payroll service provider, a money transmitter, or a "reporting agent" depending on how funds and filings flow (IRS Form 8655 applies to agents; unverified).
- Employee versus contractor tests for each state.
