# HR and payroll: Frappe HR's screens as a user sees them, and how Capxul shows them

Research for the Capxul mock-up, step **Research**, key `hr-payroll`. Written 9 November 2026.

This page describes every HR and payroll screen of Frappe HR as a user sees it today: the workspace, the list, the
form with its tabs and sections in order, each field or column with an example value, the actions and the states they
move through. Under each screen, **Capxul** says how the re-skin presents it: the same structure, under Capxul's names
and identity, with the matching `capxul` command (spelt as in `docs/design/command-surface.md`).

Example values come from one fictional company, Harbourline Studio Ltd, a London design and engineering studio, on
9 November 2026 (see [the cast](#the-example-cast)). They are illustrations; the data step's generator decides the real
values, and where they differ the generator wins.

## Contents

- [Sources](#sources)
- [Rules the re-skin follows in HR and payroll](#rules-the-re-skin-follows-in-hr-and-payroll)
- [The example cast](#the-example-cast)
- [The desk patterns HR shares](#the-desk-patterns-hr-shares)
- [Workspaces](#workspaces): HR, Leaves, Shift and Attendance, Expenses, Payroll
- People: [Employee](#employee), [Department](#department), [Designation](#designation)
- Leave: [Holiday List](#holiday-list), [Leave Type](#leave-type), [Leave Allocation](#leave-allocation),
  [Leave Application and its approval](#leave-application-and-its-approval), [Employee Leave Balance](#report-employee-leave-balance),
  [Employee Leave Balance Summary](#report-employee-leave-balance-summary)
- Attendance: [Attendance](#attendance), [Monthly Attendance Sheet](#report-monthly-attendance-sheet),
  [Employee Checkin](#employee-checkin), [Shift Type and Shift Assignment](#shift-type-and-shift-assignment)
- Expenses: [Expense Claim Type](#expense-claim-type), [Expense Claim](#expense-claim), [Employee Advance](#employee-advance)
- Payroll: [Salary Component](#salary-component), [Salary Structure](#salary-structure),
  [Salary Structure Assignment](#salary-structure-assignment), [Payroll Entry](#payroll-entry),
  [Salary Slip](#salary-slip), [the printed payslip](#the-printed-payslip), [Salary Register](#report-salary-register)
- [The self-service app](#the-self-service-app): home and check-in, attendance, leave, expenses and advances, payslips,
  team requests
- [The FDE in HR and payroll](#the-fde-in-hr-and-payroll)
- [Routes and commands for the module](#routes-and-commands-for-the-module)
- [Left out, and conflicts to flag](#left-out-and-conflicts-to-flag)

## Sources

| Source | What was read |
|---|---|
| Frappe HR, `frappe/hrms` at `8816102` (6 Nov 2026), cloned to `/tmp/hrms` | DocType JSON, list and form scripts, the workspaces (`hrms/*/workspace/*/*.json`), the workspace sidebars (`hrms/workspace_sidebar/*.json`), number cards and charts (`hrms/hr/number_card`, `hrms/hr/dashboard_chart`, `hrms/payroll/number_card`, `hrms/payroll/dashboard_chart`), reports (`hrms/hr/report`, `hrms/payroll/report`), print formats (`hrms/payroll/print_format`), the custom fields Frappe HR adds to Employee, Department and Designation (`hrms/setup.py` `get_custom_fields`), the Employee overview tab (`hrms/public/js/erpnext/employee_overview.js`), and the self-service app (`frontend/src`) |
| ERPNext, `frappe/erpnext` at `6b946b0` (8 Nov 2026), `/tmp/erpnext` | Employee, Department, Designation, Holiday List, Holiday (`erpnext/setup/doctype/*`) |
| Frappe, `frappe/frappe` at `1a7ea57`, `/tmp/frappe` (version `17.0.0-dev`) | the framework version; the desk sources are not in this clone, so the desk patterns below come from the docs and the HR scripts that drive them |
| Frappe HR docs | https://docs.frappe.io/hr/payroll-entry, https://docs.frappe.io/hr/expense-claim, and each DocType's `documentation` link, listed under its screen |
| capxul-next | `docs/design/command-surface.md` (sections 1 to 4, 6), `docs/design/new-commands.md` (5.3 Payroll, 5.9 HR), `docs/design/frappe/payroll.md`, `docs/design/frappe/bridge-work/design-bank.md` (G4, P5 to P8, P11), `docs/design/authority.md`, `docs/design/escrow.md`, `books/target/shared/rulings.ts` (`aaron.departments`, `aaron.fde-anyone`, `aaron.frappe-native`, `aaron.one-product`, `aaron.other-accounts`, `aaron.payment-claim`), `books/target/payroll/hr-decisions.ts`, `books/target/payroll/hr-data.ts` |

Paths below are short: `hr:` is `/tmp/hrms/hrms/hr/doctype/`, `pr:` is `/tmp/hrms/hrms/payroll/doctype/`, `en:` is
`/tmp/erpnext/erpnext/setup/doctype/`, `fe:` is `/tmp/hrms/frontend/src/`.

## Rules the re-skin follows in HR and payroll

These come from Aaron's rulings and apply to every screen below.

1. **It is all Capxul** (`aaron.one-product`). No screen, label, empty state, toast or error says Frappe, ERPNext,
   Frappe HR, head or DocType. The app header the self-service app shows ("Frappe HR", `fe:components/BaseLayout.vue`)
   says Capxul. The "Connections" tab keeps its name (it is not a brand). "Customize", "Edit DocType" and
   "Report Builder" menu items are not shown.
2. **Frappe's structure stays.** Same tabs, sections, field order, list columns, filters, statuses, reports and steps.
   The record names Frappe makes are plain and stay: `HR-EMP-00007`, `HR-LAP-2026-00131`, `HR-EXP-2026-00087`,
   `HR-EAD-2026-00006`, `HR-PRUN-2026-00010`, `Sal Slip/HR-EMP-00007/00018`.
3. **One company.** Harbourline is the only Organization in view, so every Company field is hidden or read-only, and
   the company suffix Frappe adds to departments and accounts (`Engineering - HL`, `Payroll Payable - HL`) is dropped
   from what is shown.
4. **Capxul owns money and identity.**
   - A department is a budget with a hat (`aaron.departments`). Approvers are never a list of users: leave is decided
     by whoever wears the Employee's department's hat now, or a hat above it, or the People hat; claims and advances
     are decided and paid by whoever Budgets admits on the department's budget; nobody decides their own
     (`payroll.hr-approvers`).
   - Pay goes to the Employee's Safe in USDC, or to their bank in fiat through Bridge (`aaron.other-accounts`). Frappe's
     Make Bank Entry becomes Capxul's **Pay**: one batch, one approval, one Payment per slip
     (`design-bank.md` G4 and P5).
   - Every payment shows its **proof**: the document hash it carries on chain (the payslip's, the claim's or the
     advance's), its payment id, transaction, block and time.
   - Money for someone with no account waits in an escrow they claim with `payment claim`; the sender can take it back
     with `payment cancel` until then (`aaron.payment-claim`, `escrow.md`).
5. **Every screen and action shows its command** on the command strip, and the SDK call that is the command's words
   (G7: `org hr leave approve` is `client.org(orgId).hr.leaves.approve`; `hr leave apply` is
   `client.me.hr.leaves.apply`).
6. **The FDE** can be asked anything on any screen, acts only with the asker's hats, and drafts a risky action (pay,
   leave an Employee) as a command for the person to run (`aaron.fde-anyone`).

### Names: Frappe's word, Capxul's label, the record word

| Frappe | Capxul label | Command record | Notes |
|---|---|---|---|
| Employee | Employee | `org hr employee` | An Employee needs no Seat (`payroll.hr-self`) |
| Department | Department | `org department` | A budget with a hat, Capxul's own |
| Designation | Designation | none; set with `--designation` | |
| Holiday List | Holidays (one list per year) | `org hr holiday`, `hr holiday` | |
| Leave Type | Leave type | `org hr leave-type`, `hr leave-type` | |
| Leave Allocation | Leave allocation | `org hr leave allocate`, `unallocate` | |
| Leave Application | Leave | `org hr leave`, `hr leave` | |
| Attendance | Attendance | `org hr attendance`, `hr attendance` | |
| Employee Checkin | Check-in | `hr attendance checkin` | |
| Shift Type, Shift Assignment | Shift type, shift assignment | `org hr shift-type` | |
| Expense Claim Type | Expense type | `org hr expense-type`, `hr expense-type` | |
| Expense Claim | Expense claim | `org hr expense-claim`, `hr expense-claim` | |
| Employee Advance | Advance | `org hr advance`, `hr advance` | |
| Salary Component | Salary component | `org payroll component` | |
| Salary Structure (and its Assignments) | Salary structure | `org payroll structure` | |
| Payroll Entry | Payroll run | `org payroll run` | The run's form keeps Frappe's four steps |
| Salary Slip | Payslip (the form's title keeps "Salary Slip") | `org payroll payslip`, `payroll payslip` | G2 allows `payslip` |
| Leave Approver, Expense Approver (User) | Decided by (the hat) | | Read from the department's hat |
| Mode of Payment, Salary Mode | Paid to | | Capxul Safe, or bank through Bridge |
| Make Bank Entry | Pay | `org payroll run pay` | |
| Submit (by an approver) | Approve, Reject | `approve`, `reject` | As the self-service app does it |
| Submitted, Cancelled (docstatus) | as Frappe | | Capxul adds Paying, Escrowed, Paid |

## The example cast

Illustrative only; the data step's generator decides. Harbourline grows from 14 people (May 2025) to 25 (November
2026). Departments are budgets: Design, Engineering, Delivery, Growth and Operations, under the top department
Harbourline. The officer hats Books, Invoicing and People sit in the Board's tree (`authority.md`, lines 66 to 117).

| Employee | Name | Designation | Department | Joined | Hats and notes |
|---|---|---|---|---|---|
| HR-EMP-00001 | Maya Okafor | Founder and Managing Director | Operations | 2025-05-01 | Director; wears the Harbourline (top) department hat |
| HR-EMP-00002 | Tom Ashworth | Engineering Lead | Engineering | 2025-05-01 | Wears the Engineering hat; paid to his Capxul Safe in USDC |
| HR-EMP-00003 | Priya Raman | Design Director | Design | 2025-05-12 | Wears the Design hat |
| HR-EMP-00004 | Kwame Mensah | Operations and People Lead | Operations | 2025-06-02 | Wears People and Books |
| HR-EMP-00007 | Ellis Hart | Senior Software Engineer | Engineering | 2025-09-01 | Paid to his bank (Monzo) in GBP through Bridge |
| HR-EMP-00011 | Daniel Price | Product Designer | Design | 2025-11-03 | Left on 2026-03-31 |
| HR-EMP-00019 | Sofia Lindqvist | Design Engineer (contractor, Stockholm) | Engineering | 2026-02-02 | Paid in USDC by a pay agreement, not by runs |
| HR-EMP-00024 | Hannah Cole | Junior Designer | Design | 2026-10-12 | No account yet: her October net waited in escrow until she claimed it on 4 November |

UK pay for the payslip examples: tax year 2026/27, tax code 1257L (monthly allowance 1,047.50), basic rate 20% to
3,141.67 a month, employee National Insurance 8% from 1,048 to 4,189 a month and 2% above, employer National Insurance
15% above 416.67 a month, pension 5% employee (net pay arrangement) and 3% employer.

## The desk patterns HR shares

Every HR record uses the same four patterns. The shell builds them; HR fills them.

**List view.** Page head: the record's plural title, a **+ Add Employee** primary button, and a menu. Below: a filter
bar of the record's standard filters as inline inputs (ID first), then **Filter** and **Sort** (default sort: Created
On, descending). Each row: a checkbox, the title (the record's `title_field`, usually `employee_name`), a coloured
status pill (from the list script's `get_indicator`), the record's `in_list_view` columns, and at the right the record
name and how long ago it changed ("3 d"). Paging: 20, then 100, 500. A **Group By** sidebar counts by Assigned To,
Created By, and a status field.

**Form view.** Page head: the title (`employee_name`), a status pill, the primary action (Save, Submit, or the step's
own button), an **Actions** or **Create** button group where the form script adds them, a **⋯** menu, and previous and
next arrows. Then the tabs, each holding sections (some collapsible) of up to three columns. Child tables are grids with
row numbers, a **+ Add Row** button and an edit-row panel. Below the last tab: the activity timeline (comments, "Kwame
Mensah approved this · 2 days ago", every change with its old and new value). A submittable record moves Draft (red
"Not Saved", then grey Draft) to Submitted (blue) to Cancelled (red); a submitted record can be amended into a copy.

**Report view.** Filters across the top, a chart above the grid when the report gives one, a data grid with
resizable, sortable columns, a total row where the report has one, and indented group rows where it groups.

**Workspace.** A left sidebar (Home, the main records, collapsible Reports and Setup sections, Settings last) and a
page: an onboarding block, one chart, three number cards, and sometimes quick lists (`hrms/*/workspace/*/*.json`
`content`; `hrms/workspace_sidebar/*.json` `items`).

**Status colours** used across HR (from the list scripts): green Approved, Present, Active, Paid; orange Open, Half Day,
Unpaid, Suspended, Withheld; red Rejected, Absent, On Leave (Attendance list), Inactive, Draft; blue Submitted; grey
Cancelled, Left, Expired, Returned.

**Capxul.** The shell's own versions of these, in Capxul's identity. Capxul adds to every form a **command strip**
(the command for the screen and for each action, with copy) and, on any record that moved money, a **Proof** block.

## Workspaces

Frappe HR's desktop has one app icon, "Frappe HR", that opens a folder of workspaces: HR Setup, Tenure, Leaves, Shift &
Attendance, Expenses, Payroll, Tax & Benefits, Recruitment, Performance (`hrms/desktop_icon/*.json`). Each workspace
page has the same shape (`hrms/*/workspace/*/*.json`): an onboarding block, one chart, three number cards. Its sidebar
(`hrms/workspace_sidebar/*.json`) holds the links.

**Capxul.** One group, **HR**, with five workspaces: HR (Frappe's HR Setup), Leave, Attendance (Frappe's Shift &
Attendance), Expenses, and a sibling group **Payroll**, matching the command groups `org hr` and `org payroll`.
Tenure, Tax & Benefits, Recruitment and Performance are not shown (see [left out](#left-out-and-conflicts-to-flag)).
The onboarding block is replaced by nothing after 18 months of use; a company this old has finished it.

### HR (Frappe: HR Setup)

Source: `hrms/hr_setup/workspace/hr_setup/hr_setup.json`, `hrms/workspace_sidebar/hr_setup.json`.

| Region | Frappe | Example on 9 Nov 2026 |
|---|---|---|
| Sidebar | Home · Dashboard · Employee · Organizational Chart · Setup (Company, Branch, Department, Designation, Employee Group, Employee Grade) · Settings (HR Settings) | |
| Chart | Department Wise Employee Count: pie of active Employees by `department` (`hrms/hr/dashboard_chart/department_wise_employee_count`) | Engineering 9 · Design 7 · Delivery 4 · Operations 3 · Growth 2 |
| Number card | Total Employees: count of Employee, status Active | 25 |
| Number card | Employees Joining (This Quarter): count by `date_of_joining` this quarter | 2 |
| Number card | Employees Relieving (This Quarter): count by `relieving_date` this quarter | 0 |

**Capxul.** Sidebar: Home · Employees · Organisation chart · Departments · Designations · Holidays · Expense types ·
HR settings (rename the route; the word "settings" is not a route name). The chart as a pie or a bar, drawn to scale.
The three cards as they are. Command strip: `capxul org hr employee list`. Branch, Employee Group and Employee Grade are
not shown: a 25-person studio in one office uses none.

### Leaves

Source: `hrms/leaves/workspace/leaves/leaves.json`, `hrms/workspace_sidebar/leaves.json`.

| Region | Frappe | Example |
|---|---|---|
| Sidebar | Home · Leave Application · Leave Encashment · Leave Control Panel · Leave Policy Assignment · Leave Allocation · Reports (Leave Balance = report Employee Leave Balance, Leave Balance Summary, Employees Working on a Holiday) · Setup (Holiday List, Holiday List Assignment, Leave Period, Leave Policy, Leave Block List, Leave Type) · Settings | |
| Chart | Leave Applications by Type: pie of Leave Application by `leave_type`, last year | Annual Leave 71 · Sick Leave 16 · Unpaid Leave 3 · Compassionate Leave 2 · Parental Leave 1 |
| Number card | Number of Employees on Leave (Today): approved, submitted applications | 1 |
| Number card | Number of Employees on Leave (This Month): approved, `from_date` this month | 6 |
| Number card | Holidays in this month (`hrms.utils.custom_method_for_charts.get_upcoming_holidays`) | 0 (England has no bank holiday in November) |

**Capxul.** Sidebar: Home · Leave · Leave allocations · Reports (Leave balance, Leave balance summary) · Setup
(Holidays, Leave types). Leave Encashment, Leave Control Panel, Leave Policy (and its Assignment), Leave Period, Leave
Block List and Holiday List Assignment are not shown: they are outside the leave Capxul keeps (`payroll.hr-scope`).
Command strip: `capxul org hr leave list --status open`.

### Shift and Attendance

Source: `hrms/shift_and_attendance/workspace/shift_&_attendance/shift_&_attendance.json`,
`hrms/workspace_sidebar/shift_&_attendance.json`.

| Region | Frappe | Example |
|---|---|---|
| Sidebar | Home · Roster · Dashboard · Employee Attendance Tool · Employee Checkin · Shift Request · Attendance Request · Overtime (Overtime Type, Overtime Slip) · Reports (Monthly Attendance Sheet, Shift Attendance, Employee Hours Utilization, Project Profitability) · Setup (Shift Type, Shift Location, Shift Schedule, Activity Type, Timesheet) · Settings | |
| Chart | Attendance Count: report line chart, last year | a line of present days per month, 280 to 470 |
| Number card | Total Present (This Month): submitted Attendance, status Present, this month | 109 |
| Number card | Total Absent (This Month) | 1 |
| Number card | Late Entry (This Month): `late_entry` = 1 | 4 |

**Capxul.** Name it **Attendance**. Sidebar: Home · Attendance · Check-ins · Reports (Monthly attendance sheet) · Setup
(Shift types). Roster, Shift Request, Attendance Request, Overtime, Shift Location and Shift Schedule are not shown
(`payroll.hr-scope`). Timesheets live in Projects. Command strip: `capxul org hr attendance list --start 2026-11-01`.

### Expenses

Source: `hrms/expenses/workspace/expenses/expenses.json`, `hrms/workspace_sidebar/expenses.json`.

| Region | Frappe | Example |
|---|---|---|
| Sidebar | Home · Dashboard · Employee Advance · Expense Claim · Travel (Purpose of Travel, Travel Request, Vehicle Log) · Accounting Entries (Payment Entry, Journal Entry) · Reports (Unpaid Expense Claim, Vehicle Expenses, Accounts Receivable, Accounts Payable, General Ledger) · Setup (Expense Claim Type, Driver, Vehicle) · Settings | |
| Chart | Expense Claims: monthly sum (line) of Expense Claim by `posting_date`, last year | 600 to 2,400 a month |
| Number card | Expense Claims (This Month): submitted, `posting_date` this month | 4 |
| Number card | Approved Claims (This Month) | 2 |
| Number card | Rejected Claims (This Month) | 0 |

**Capxul.** Sidebar: Home · Expense claims · Advances · Reports (Unpaid expense claims) · Setup (Expense types). The
accounting links go to Books' own screens (payments, general ledger), not repeated here. Travel and vehicles are not
shown. Command strip: `capxul org hr expense-claim list --status approved`.

### Payroll

Source: `hrms/payroll/workspace/payroll/payroll.json`, `hrms/workspace_sidebar/payroll.json`.

| Region | Frappe | Example |
|---|---|---|
| Sidebar | Home · Dashboard · Payroll Entry · Salary Structure Assignment · Salary Slip · Additional Salary · Salary Withholding · Reports (Employee CTC Break-up, Salary Register, Income Tax Deductions, General Ledger, Accounts Payable) · Setup (Salary Component, Salary Structure) · Settings (Payroll Settings) | |
| Chart | Outgoing Salary: monthly sum (line) of Salary Slip by `end_date`, last year (`hrms/payroll/dashboard_chart/outgoing_salary`) | rising from about 41,000 (May 2025) to about 74,000 (October 2026) |
| Number card | Total Outgoing Salary (Last month): sum of `rounded_total` of submitted slips starting last month | 73,918.42 |
| Number card | Total Salary Structure: count of submitted structures | 3 |
| Number card | Total Incentive Given (Last month): sum of Employee Incentive | (Capxul: see below) |

**Capxul.** Sidebar: Home · Payroll runs · Salary structure assignments · Payslips · Reports (Salary register) · Setup
(Salary components, Salary structures) · Payroll settings. The outgoing salary card sums `net_pay` (Capxul turns off
the rounded total, `payroll.md` "Settings"). Replace the incentive card, whose record Capxul does not keep, with
**Waiting to be claimed**: the nets in escrow for people with no account yet (0.00 today; 1,521.72 from 30 October
to 4 November, Hannah Cole's). Additional Salary is reached only through an advance's recovery; Salary Withholding is the payslip's
**Withhold** action. Command strip: `capxul org payroll run list`.

## Employee

Docs: https://docs.frappe.io/erpnext/user/manual/en/employee. Source: `en:employee/employee.json`, the fields Frappe HR
adds (`/tmp/hrms/hrms/setup.py`, `get_custom_fields()["Employee"]`, and `rename_employee_details_tab`), the overview
tab (`/tmp/hrms/hrms/public/js/erpnext/employee_overview.js`, `/tmp/hrms/hrms/overrides/employee_overview.py`), the
connections (`/tmp/hrms/hrms/overrides/dashboard_overrides.py`), the list (`en:employee/employee_list.js`).

### List

- Title: `employee_name`. Columns (`in_list_view`): Department, Designation, Branch, Employment Type. Status pill:
  Active green, Inactive red, Suspended orange, Left grey. Default filter: Status = Active.
- Standard filters: ID, Full Name, Department. Also a tree view (Employee is a tree by `reports_to`) and the
  Organizational Chart page.

| Full Name | Status | Department | Designation | Employment Type | ID |
|---|---|---|---|---|---|
| Ellis Hart | Active | Engineering | Senior Software Engineer | Full-time | HR-EMP-00007 |
| Hannah Cole | Active | Design | Junior Designer | Full-time | HR-EMP-00024 |
| Sofia Lindqvist | Active | Engineering | Design Engineer | Contract | HR-EMP-00019 |

**Capxul.** The same list, Branch dropped. Two Capxul columns: **Paid to** (Safe or Bank) and **Seat** (yes or no).
Command: `capxul org hr employee list --department engineering --status active`
(`client.org(orgId).hr.employees.list`). **+ Add Employee** runs `org hr employee add`.

### Form

Page head: "Ellis Hart", pill Active, Save. Actions are in the ⋯ menu. Tabs in order (Frappe HR renames ERPNext's
first tab "Details" and adds "Overview" second; `tests/test_employee_overview.py:141-147`):

**Tab 1, Details.**

| Section | Field | Example |
|---|---|---|
| (basic) | Series (hidden after save), First Name\*, Middle Name, Last Name, Full Name (read-only) | Ellis, , Hart, Ellis Hart |
| | Gender\*, Date of Birth\*, Salutation | Male, 1991-03-14, Mr |
| | Date of Joining\*, Status\* (Active, Inactive, Suspended, Left), Image | 2025-09-01, Active |
| User Details (collapsible) | User ID, Create User Permission | ellis@harbourline.studio, on |
| Company Details | Company\*, Department, Employment Type (Frappe HR), Employee Number | Harbourline Studio Ltd, Engineering, Full-time |
| | Designation, Reports to | Senior Software Engineer, Tom Ashworth |
| | Branch, Grade (Frappe HR) | London, |

**Tab 2, Overview** (Frappe HR's dashboard, shown once saved): a Period select (Current Fiscal Year, Last 12 Months,
This Quarter, Last Fiscal Year), then:

- four KPI cards: **Gross Pay** (with change "since last year"), **Net Pay** ("{n} deducted"), **Attendance** (rate,
  "1 absent · 2 on leave"), **Leave Balance** (days left, "3 days pending approval" or "Across 3 leave types");
- **Monthly Pay**: bar chart of gross and net from submitted slips, "Avg net pay 3,013 a month", link Salary Register;
- **Attendance**: donut of Present, Work From Home, Half Day, On Leave, Absent, link Attendance;
- **Leave Balance**: horizontal stacked bars per leave type, Remaining and Taken, link Employee Leave Balance;
- **Pending Items**: Leave Requests, Claims Awaiting Approval, Claims to Reimburse ("approved, not paid"), Advances to
  Settle;
- **Recent Transactions**: a list of Salary Slip, Leave Application, Expense Claim and Employee Advance with columns
  Document, Type, Date, Status, Amount, Outstanding, filtered by type.

Example for Ellis Hart, Current Fiscal Year (from 6 April 2026): Gross Pay 28,000.00, Net Pay 21,093.38 (6,906.62
deducted), Attendance 136 days worked (9.5 on leave, none absent), Leave Balance 22.5 days (4 days pending
approval).

**Tab 3, Address & Contacts.** Mobile; Company Email, Personal Email; Preferred Contact Email (Company Email, Personal
Email, User ID), Preferred Email (read-only), Unsubscribed. Section Address: Current Address, Current Address Is
(Rented, Owned), Permanent Address, Permanent Address Is. Section Emergency Contact: Emergency Contact Name, Emergency
Phone, Relation. Example: 07700 900418; ellis@harbourline.studio; ellis.hart@fastmail.com; "Flat 3, 22 Lordship Lane,
London SE22 8HN", Rented; Ruth Hart, 07700 900233, Sister.

**Tab 4, Attendance & Leaves.** Attendance Device ID (Biometric/RF tag ID), Holiday List, Default Shift (Frappe HR);
section Approvers (Frappe HR): Expense Approver, Leave Approver, Shift Request Approver (each a User). Example: Holiday
List "England 2026", Default Shift "Studio Day".

**Tab 5, Salary.** Cost to Company (CTC), Salary Currency, Salary Mode (Bank, Cash, Cheque), Employee Advance Account
(Frappe HR), Payroll Cost Center (Frappe HR, fetched from the department). Section Bank Details (when Salary Mode is
Bank): Bank Name, Bank A/C No., IBAN. Example: CTC 55,890.00 (salary 48,000, employer National Insurance 6,450,
employer pension 1,440), GBP, Bank, Monzo, 41829057.

**Tab 6, Personal Details.** Marital Status, Family Background, Blood Group, Health Details; section Health Insurance
(Frappe HR): provider, number; section Passport Details: Passport Number, Valid Up To, Date of Issue, Place of Issue.

**Tab 7, Profile.** Bio / Cover Letter; Educational Qualification (table: School/Univ, Qualification, Level, Year of
Passing); Previous Work Experience (Company, Designation, Salary, Address, Total Experience); History In Company
(Branch, Department, Designation, From, To).

**Tab 8, Joining.** Job Applicant, Job Offer (Frappe HR, read-only, only when set); Offer Date, Confirmation Date,
Contract End Date, Notice (days), Date Of Retirement. Example: Offer Date 2025-07-18, Confirmation Date 2026-03-01,
Notice 30.

**Tab 9, Exit.** Resignation Letter Date, Relieving Date (required when Status is Left), Exit Interview Held On, New
Workplace, Leave Encashed? (Yes, No), Encashment Date; section Feedback: Reason for Leaving, Feedback. Example (Daniel
Price): 2026-02-27, 2026-03-31, 2026-03-26, "Pentagram", No; "Moving to a larger studio".

**Tab 10, Connections.** Linked records by group, each with a count and a **+**: Attendance (Attendance, Attendance
Request, Employee Checkin); Leave (Leave Application, Leave Allocation, Leave Policy Assignment, Holiday List
Assignment); Lifecycle; Employee Exit; Shift; Expense (Expense Claim, Travel Request, Employee Advance); Benefit;
Payroll (Salary Structure Assignment, Salary Slip, Additional Salary, Timesheet, ...); Training; Evaluation; Contract.
A heatmap of attendance sits above.

**Capxul.** Keep the ten tabs, minus Profile (rarely filled at a studio; keep it if the data step fills it). Changes:

- **Details.** Company read-only. Add a section **Capxul identity** (Capxul's own fields, as the Capxul app's custom
  fields `capxul_party` and `capxul_id` are on the real record, `payroll.md` "A head connected"): Party (Ellis Hart,
  ellis.hart@fastmail.com), Seat (yes, one of ten), Hats worn now (none; Tom Ashworth's form shows Engineering). Gender
  and Date of Birth are not required (`payroll.md` Property Setters).
- **Overview.** As Frappe's, plus a fifth pending item **Waiting to be claimed** for an escrowed slip.
- **Attendance & Leaves.** Replace the three approver user fields with read-only **Decided by**: "Leave: whoever wears
  the Engineering hat (Tom Ashworth) or a hat above it, or People (Kwame Mensah). Claims and advances: Engineering's
  budget (Tom Ashworth). Never Ellis himself." (`payroll.hr-approvers`)
- **Salary.** Salary Mode gains **Capxul Safe** (`payroll.md`: `salary_mode` `Capxul`), shown as **Paid to**: Capxul
  Safe (Tom Ashworth's: 0x7c3E…91aD, USDC) or Bank through Bridge (Ellis Hart's: Monzo ·· 9057, GBP by Faster
  Payments). Add **Pay mailbox**: the
  personal email pay is keyed to, which a change of work email never moves (`payroll.mailbox-for-pay`). Employee
  Advance Account and Payroll Cost Center shown without the company suffix.
- **Exit.** The relieving action is `org hr employee leave HR-EMP-00011 --on 2026-03-31` with a preview, final; the
  FDE drafts it, the People hat runs it.
- **Connections.** Only the groups Capxul keeps: Attendance (Attendance, Check-in), Leave (Leave, Leave allocation),
  Shift (Shift assignment), Expense (Expense claim, Advance), Payroll (Salary structure assignment, Payslip).

Commands on the form: `capxul org hr employee get HR-EMP-00007`; Save is `org hr employee change HR-EMP-00007
--designation "Senior Software Engineer"`; the status menu: `org hr employee suspend|deactivate|reinstate|leave`. New:
`org hr employee add ellis.hart@fastmail.com --first-name Ellis --last-name Hart --joined 2025-09-01 --department
engineering --designation "Senior Software Engineer" --type full-time`.

## Department

Docs: https://docs.frappe.io/erpnext/user/manual/en/department. Source: `en:department/department.json`, and the fields
Frappe HR adds (`/tmp/hrms/hrms/setup.py`, `"Department"`).

- **List** (a tree, "All Departments" at the root): Department, Parent Department, Is Group; filter Company.
- **Form**: Department\* (Engineering), Parent Department (All Departments), Company\*, Is Group, Disabled. Frappe HR
  adds Payroll Cost Center (Engineering - HL), Leave Block List, and a section **Approvers** with three tables of
  users: Shift Request Approver, Leave Approver, Expense Approver ("The first Approver in the list will be set as the
  default Approver.").

**Capxul.** A department is Capxul's: a budget in the company Safe's tree with an office hat (`authority.md` lines 90
to 106). The tree view stays (Harbourline at the root; Design, Engineering, Delivery, Growth, Operations under it). The
form keeps Department, Parent Department, Is Group, Disabled and Payroll Cost Center, and replaces the three approver
tables with:

| Section | Field | Example |
|---|---|---|
| Hat | Wears it now; since | Tom Ashworth, since 2025-05-01 |
| | Earlier wearers | (none) |
| Budget | This quarter's budget, spent, left | 180,000.00 USDC, 126,412.30, 53,587.70 |
| Decides | Leave, claims and advances of its people | by the hat; People also decides leave |
| People | Its Employees now | 9 |

Commands: `capxul org department show engineering`; swap a person in: `org department holder add engineering
<safe>` and `org department holder remove engineering <safe>`; `org department budget set`. The money side of a
department is the capxul-native research's; HR only links to it.

## Designation

Docs: https://docs.frappe.io/erpnext/user/manual/en/designation. Source: `en:designation/designation.json`.

- **List**: Designation. **Form**: Designation\* (Senior Software Engineer), Description; Frappe HR adds Appraisal
  Template and a Required Skills table (Skill, Proficiency).

**Capxul.** List and form with Designation and Description only. No command of its own: it is set with
`--designation` on `org hr employee add|change`. Examples: Founder and Managing Director, Design Director, Engineering
Lead, Senior Product Designer, Product Designer, Junior Designer, Senior Software Engineer, Software Engineer, Design
Engineer, Project Manager, Operations and People Lead, Business Development Lead.

## Holiday List

Docs: https://docs.frappe.io/erpnext/user/manual/en/holiday-list. Source: `en:holiday_list/holiday_list.json`,
`en:holiday/holiday.json`.

- **List**: From Date, To Date, Total Holidays; filter Weekly Off.
- **Form**:

| Section | Field | Example |
|---|---|---|
| (top) | Holiday List Name\*, From Date\*, To Date\*, Total Holidays (read-only) | England 2026, 2026-01-01, 2026-12-31, 112 |
| Add Weekly Holidays (collapsible) | Weekly Off (a weekday), **Add to Holidays** button, Is Half Day | Saturday, then Sunday |
| Add Local Holidays (collapsible) | Country, Subdivision, **Add to Holidays** button | United Kingdom, England |
| Holidays | table: Date\*, Description\*, Weekly Off, Is Half Day; **Clear Table** button | see below |
| | Color | |

England 2026's bank holidays: 1 Jan New Year's Day; 3 Apr Good Friday; 6 Apr Easter Monday; 4 May Early May bank
holiday; 25 May Spring bank holiday; 31 Aug Summer bank holiday; 25 Dec Christmas Day; 28 Dec Boxing Day (substitute
day). With 104 weekend days, 112 in all. England 2025 (for the first months): 18 Apr, 21 Apr, 5 May, 26 May, 25 Aug,
25 Dec, 26 Dec (from May 2025, 6 to come).

**Capxul.** One list per year (`table_holiday_lists`, index `by_year` in `books/target/payroll/hr-data.ts`), titled
"Holidays 2026". The form as Frappe's, without Color. Commands: `capxul org hr holiday list --year 2026`; the Add Weekly
Holidays button is `org hr holiday add --weekly saturday --year 2026`; a row is `org hr holiday add 2026-12-28
--description "Boxing Day (substitute day)"`; removing a row is `org hr holiday remove <day>`. An Employee reads it with
`hr holiday list`.

## Leave Type

Docs: https://docs.frappe.io/hr/leave-type. Source: `hr:leave_type/leave_type.json`.

- **List**: Leave Type Name, Maximum Consecutive Leaves Allowed, Is Carry Forward.
- **Form**, tab one (unnamed):

| Section | Field | Example (Annual Leave) |
|---|---|---|
| (top) | Leave Type Name\*, Is Compensatory, Is Leave Without Pay, Is Partially Paid Leave, Fraction of Daily Salary per Leave | Annual Leave, off, off, off |
| | Allow Negative Balance, Allow Over Allocation, Include holidays within leaves as leaves, Leave for optional holiday | off, off, off, off |
| Carry Forward (collapsible) | Carry Forward, Maximum Carry Forwarded Leaves, Expire Carry Forwarded Leaves (Days) | on, 5, |
| Encashment (collapsible) | Allow Encashment, Maximum Encashable Leaves, Non-Encashable Leaves, Earning Component | off |
| Earned Leave (collapsible) | Is Earned Leave, Earned Leave Frequency, Allocate on Day, Rounding | off |

  Tab **Limits**: Maximum Leave Allocation Allowed per Leave Period (25), Maximum Consecutive Leaves Allowed (15),
  Allow Leave Application After (Calendar Days) (0). Tab **Connections**.

Harbourline's types: Annual Leave (25 a year, carry 5), Sick Leave (10, paid), Unpaid Leave (Is Leave Without Pay),
Compassionate Leave (5), Parental Leave.

**Capxul.** The form without Is Compensatory, Leave for optional holiday, Encashment and Earned Leave, which Capxul does
not keep (`new-commands.md` 5.9, `org.hr.leave-type.add`: these four kinds stay outside Capxul's native leave), so
they are simply absent. Commands: `capxul org hr leave-type add "Annual Leave" --max-days 25 --max-continuous 15
--carry-forward --max-carry 5`; `org hr leave-type change "Sick Leave" --max-days 10`; `org hr leave-type list`; an
Employee: `hr leave-type list`.

## Leave Allocation

Docs: https://docs.frappe.io/hr/leave-allocation. Source: `hr:leave_allocation/leave_allocation.json`,
`hr:leave_allocation/leave_allocation.js`, `hr:leave_allocation/leave_allocation_list.js`.

- **List**: title `employee_name`; columns Employee, Employee Name, Leave Type; Expired pill (grey); filters Employee,
  Leave Type, Leave Period, Leave Policy, Expired.
- **Form** (submittable, series `HR-LAL-.YYYY.-`):

| Section | Field | Example |
|---|---|---|
| (top) | Employee\*, Employee Name, Department, Company | HR-EMP-00007, Ellis Hart, Engineering |
| | Leave Type\*, From Date\*, To Date\* | Annual Leave, 2026-01-01, 2026-12-31 |
| Allocation | New Leaves Allocated (bold), Add unused leaves from previous allocations, Unused leaves, Total Leaves Allocated\* | 25, on, 3, 28 |
| | Compensatory Leave Request, Leave Period, Leave Policy Assignment, Carry Forwarded Leaves | , , , 3 |
| Earned Leave Schedule | table (only for earned leave) | |
| Notes | Description | "2026 entitlement, 3 carried from 2025" |

- **Actions** (submitted): Expire Allocation, Adjust Allocation.

**Capxul.** Same form without the policy, period, compensatory and earned-leave fields. Commands: `capxul org hr leave
allocate HR-EMP-00007 --type "Annual Leave" --days 25 --start 2026-01-01 --end 2026-12-31 --carry-forward`; cancel is
`org hr leave unallocate HR-LAL-2026-00007`. Carrying forward expires the previous allocation (`payroll.leave-balance`),
so the 2025 allocation shows the grey Expired pill. Adjust Allocation is not offered (Leave Adjustment is refused,
`command-surface.md` section 3); a change is unallocate and allocate.

## Leave Application and its approval

Docs: https://docs.frappe.io/hr/leave-application. Source: `hr:leave_application/leave_application.json`, `.js`, `.py`,
`leave_application_list.js`, `leave_application_dashboard.html`, `leave_application_calendar.js`.

### List

- Title `employee_name`; columns From Date, Total Leave Days; status pill Open orange, Approved green, Rejected red,
  Cancelled red, Draft red; filters Employee, Leave Type, Status. A **Calendar** view shows each leave as a bar
  ("Ellis Hart: Annual Leave"), with holidays and blocked days.

| Employee Name | Status | Leave Type | From Date | To Date | Total Leave Days | ID |
|---|---|---|---|---|---|---|
| Ellis Hart | Open | Annual Leave | 2026-12-21 | 2026-12-24 | 4 | HR-LAP-2026-00131 |
| Priya Raman | Approved | Annual Leave | 2026-11-09 | 2026-11-13 | 5 | HR-LAP-2026-00124 |
| Kwame Mensah | Approved | Sick Leave | 2026-10-27 | 2026-10-28 | 2 | HR-LAP-2026-00119 |

### Form

Submittable, series `HR-LAP-.YYYY.-`. When an Employee and Leave Type are set, the form's dashboard shows an
**Allocated Leaves** table: Leave Type, Total Allocated Leaves, Expired Leaves, Used Leaves, Leaves Pending Approval,
Available Leaves (green above zero, red otherwise) (`leave_application_dashboard.html`).

| Section | Field | Example |
|---|---|---|
| (top) | Employee\*, Employee Name | HR-EMP-00007, Ellis Hart |
| | Leave Type\*, Company, Department | Annual Leave, , Engineering |
| Dates & Reason | From Date\*, To Date\*, Half Day, Half Day Date, Total Leave Days (read-only) | 2026-12-21, 2026-12-24, off, , 4 |
| | Reason, Leave Balance Before Application (read-only) | "Family in Leeds before Christmas", 18.5 |
| Approval | Leave Approver, Leave Approver Name, Follow via Email | tom@harbourline.studio, Tom Ashworth, on |
| | Posting Date\*, Status\* (Open, Approved, Rejected, Cancelled) | 2026-11-06, Open |
| Other Details (collapsible) | Salary Slip, Color, Letter Head, Amended From | |

Allocated Leaves for Ellis, 9 November: Annual Leave 28, 0, 9.5, 4, 14.5; Sick Leave 10, 0, 2, 0, 8.

### Approval, as Frappe does it

1. The Employee saves the application (Status Open) and Frappe emails the Leave Approver.
2. The approver opens it, sets **Status** to Approved or Rejected, and presses **Submit**. Frappe refuses to submit any
   other status: "Only Leave Applications with status 'Approved' and 'Rejected' can be submitted"
   (`leave_application.py:137`).
3. On approval each day is marked Attendance On Leave, and the balance drops.
4. Refusals the user can meet: "Self-approval for leaves is not allowed" (`:884`), "Insufficient leave balance for
   Leave Type {0}" (`:494`), "Employee {0} has already applied for {1} between {2} and {3}" (`:546`), "Leave of type {0}
   cannot be longer than {1}" (`:576`), "Half Day Date cannot be a holiday" (`:898`).

The self-service app replaces step 2's field and button with **Approve** and **Reject** in an action sheet, then
**Submit** (`fe:components/RequestActionSheet.vue`).

**Capxul.** The form as Frappe's, with the Allocated Leaves table. The Approval section reads **Decided by**: "Tom
Ashworth, who wears the Engineering hat" once decided; while Open, "Waiting for the Engineering hat (Tom Ashworth), a
hat above it, or People". The Status field is read-only; the page head shows **Approve** and **Reject** (with a reason)
to a person who may decide, as the self-service app does, and nothing to the applicant but **Cancel**. Commands:

- new: `capxul hr leave apply --type "Annual Leave" --start 2026-12-21 --end 2026-12-24 --reason "Family in Leeds
  before Christmas"` (`client.me.hr.leaves.apply`);
- approve: `capxul org hr leave approve HR-LAP-2026-00131` (`client.org(orgId).hr.leaves.approve`);
- reject: `capxul org hr leave reject HR-LAP-2026-00131 --reason "Release week for Severn Dynamics"`;
- withdraw: `capxul hr leave cancel HR-LAP-2026-00131`;
- the list: `capxul org hr leave list --status open`.

A self-approval shows Capxul's refusal in words: "You can't decide your own leave. Someone who wears the Engineering
hat or one above it, or People, decides it." Approving marks each day On Leave (`payroll.attendance-based`), so an
Unpaid Leave day docks the next payslip.

## Report: Employee Leave Balance

Docs: https://docs.frappe.io/hr/human-resources-reports#1-employee-leave-balance. Source:
`/tmp/hrms/hrms/hr/report/employee_leave_balance/employee_leave_balance.{js,py,json}`. The Leaves sidebar labels it
"Leave Balance".

- **Filters**: From Date\*, To Date\*, Company\*, Department, Employee, Employee Status (Active default), Consolidate
  Leave Types (on).
- **Columns**: Leave Type, Employee, Employee Name, Opening Balance, Leave(s) Allocated, Leave(s) Taken, Leave(s)
  Expired, Closing Balance. Consolidated, each leave type is a group row with its Employees indented under it.
- **Chart**: bars per employee of each type's closing balance.

| Leave Type | Employee | Employee Name | Opening | Allocated | Taken | Expired | Closing |
|---|---|---|---|---|---|---|---|
| Annual Leave | | | | | | | |
| | HR-EMP-00007 | Ellis Hart | 3 | 25 | 9.5 | 0 | 18.5 |
| | HR-EMP-00003 | Priya Raman | 5 | 25 | 17 | 0 | 13 |

**Capxul.** The same report, 2026-01-01 to 2026-12-31. Command: `capxul org hr leave balance HR-EMP-00007 --on
2026-12-31` per Employee (each row group); an Employee's own: `capxul hr leave balance`.

## Report: Employee Leave Balance Summary

Docs: https://docs.frappe.io/hr/reports/employee-leave-balance-summary. Source:
`/tmp/hrms/hrms/hr/report/employee_leave_balance_summary/employee_leave_balance_summary.{js,py}`.

- **Filters**: Date (today), Company, Employee, Department, Employee Status (Active).
- **Columns**: Employee, Employee Name, Department, then one column per leave type with the balance on the date.

| Employee | Employee Name | Department | Annual Leave | Compassionate Leave | Parental Leave | Sick Leave | Unpaid Leave |
|---|---|---|---|---|---|---|---|
| HR-EMP-00007 | Ellis Hart | Engineering | 14.5 | 5 | 0 | 8 | 0 |

**Capxul.** As Frappe's. Command: `capxul org hr leave balance <employee> --on 2026-11-09`, one call per row; the
command strip names the call for the selected row.

## Attendance

Docs: https://docs.frappe.io/hr/attendance. Source: `hr:attendance/attendance.json`, `attendance_list.js`,
`attendance_calendar.js`.

- **List**: title `employee_name`, column Attendance Date; pill Present and Work From Home green, Absent and On Leave
  red, Half Day orange; filters Employee, Status, Leave Type. Also a calendar view. List button **Mark Attendance**
  opens a dialog: For Employee, Start, End, Status, Shift, Exclude Holidays, then "Unmarked Attendance for days" as
  checkboxes, primary **Mark Attendance**, with a confirmation "Mark attendance as {0} for {1} on selected dates?".
- **Form** (submittable, series `HR-ATT-.YYYY.-`):

| Section | Field | Example |
|---|---|---|
| (top) | Employee\*, Employee Name, Working Hours, Status\* (Present, Absent, On Leave, Half Day, Work From Home), Leave Type, Leave Application | HR-EMP-00007, Ellis Hart, 8.42, Present |
| | Attendance Date\*, Company, Department, Attendance Request, Status for Other Half | 2026-11-06, , Engineering |
| Details | Shift, In Time, Out Time, Late Entry, Early Exit | Studio Day, 2026-11-06 09:24, 17:49, off, off |
| Overtime | Overtime Type, Actual Overtime Duration, Standard Working Hours | (hidden unless set) |

**Capxul.** List, calendar and form as Frappe's, without Attendance Request and Overtime. The Mark Attendance dialog
is `capxul org hr attendance mark HR-EMP-00024 --on 2026-11-05 --status work_from_home`, one call per ticked day;
Cancel is `org hr attendance cancel HR-ATT-2026-04512`. Days a shift's check-ins mark say "Marked from check-ins at
19:00" in the timeline (`payroll.shift-types`: 60 minutes after the shift ends, on the world's clock).

## Report: Monthly Attendance Sheet

Docs: https://docs.frappe.io/hr/human-resources-reports#3-monthly-attendance-sheet. Source:
`/tmp/hrms/hrms/hr/report/monthly_attendance_sheet/monthly_attendance_sheet.{js,py}`.

- **Filters**: Filter Based On (Month, Date Range), Month, Year, Start Date, End Date, Employee, Employment Type,
  Status, Company, Group By, Summarized View.
- **Grid**: Employee, Employee Name, then one column per day labelled "1 Sun", "2 Mon"..., each cell P (Present), A
  (Absent), HD (Half Day), WFH (Work From Home), L (On Leave), H (Holiday), WO (Weekly Off); then totals. A legend of
  the abbreviations above the grid; a chart of present, absent and leave per day.

**Capxul.** As Frappe's, for October 2026, its own horizontal scroll inside the report container at 400 px. Command:
`capxul org hr attendance list --start 2026-10-01 --end 2026-10-31`.

## Employee Checkin

Docs: https://docs.frappe.io/hr/employee-checkin. Source: `hr:employee_checkin/employee_checkin.json`.

- **List**: Employee Name, Log Type, Time; filter Employee. Name series `EMP-CKIN-.MM.-.YYYY.-.######`
  (EMP-CKIN-11-2026-004318).
- **Form**: Employee\*, Employee Name, Log Type (IN, OUT), Shift (read-only); Time\* (now), Location / Device ID, Skip
  Auto Attendance, Attendance Marked (link). Section Location: Latitude, Longitude, Fetch Geolocation, a map. Section
  Shift Timings (hidden). Example: HR-EMP-00007, Ellis Hart, IN, Studio Day, 2026-11-09 09:21:07, "Mobile app".

**Capxul.** List and form as Frappe's, without the map (no outside map tiles; show the coordinates in text if given).
Time is stamped by the world's clock and is read-only (`payroll.hr-world-clock`). Commands: `capxul hr attendance
checkin --log in` (`client.me.hr.attendances.checkin`); reading: `capxul hr attendance list --start 2026-11-01`.

## Shift Type and Shift Assignment

Docs: https://docs.frappe.io/hr/shift-type, https://docs.frappe.io/hr/shift-assignment. Source:
`hr:shift_type/shift_type.json`, `shift_type.js`, `hr:shift_assignment/shift_assignment.json`.

**Shift Type.** List: Start Time, End Time. Named by the user (Studio Day). Form:

| Section | Field | Example |
|---|---|---|
| (top) | Start Time\*, End Time\*, Holiday List, Roster Color, Enable Auto Attendance | 09:30, 18:00, England 2026, Blue, on |
| Auto Attendance Settings | Determine Check-in and Check-out; Working Hours Calculation Based On; Begin check-in before shift start time (in minutes); Allow check-out after shift end time (in minutes); Mark Auto Attendance on Holidays; Absent Buffer (Days) | Alternating entries as IN and OUT during the same shift; First Check-in and Last Check-out; 60; 60; off; 1 |
| | Working Hours Threshold for Half Day; for Absent; Process Attendance After; Last Sync of Checkin; Automatically update Last Sync of Checkin | 4; 2; 2025-05-01 |
| Late Entry & Early Exit Settings | Enable Late Entry Marking, Late Entry Grace Period, Enable Early Exit Marking, Early Exit Grace Period | on, 15, on, 15 |
| Overtime | Allow Overtime, Overtime Type | off |

Button **Mark Attendance** (needs Process Attendance After and Last Sync of Checkin).

**Shift Assignment** (submittable, `HR-SHA-.YY.-.MM.-.#####`). List: Shift Type, Start Date; filters Employee, Shift
Type. Form: section Employee Details (Employee\*, Employee Name, Company\*, Department); section Shift Details (Shift
Type\*, Shift Location, Status Active or Inactive, Overtime Type, Start Date\*, End Date, Shift Request, Shift Schedule
Assignment).

**Capxul.** Shift Type form with the two Frappe options fixed to their first values (`payroll.shift-types`) and shown
read-only; Absent Buffer shows 0; no Roster Color, Overtime or Mark Attendance button (a shift assignment marks its own
days). A type is never changed, so the form has no Save once created. Shift Assignment without Shift Location, Shift
Request and Schedule. Commands: `capxul org hr shift-type add "Studio Day" --start 09:30 --end 18:00 --auto-attendance
--half-day-below 4 --absent-below 2 --late-grace 15 --early-grace 15`; `org hr shift-type list`; `org hr shift-type
assign "Studio Day" HR-EMP-00024 --start 2026-10-12`; `org hr shift-type unassign HR-SHA-26-10-00031`.

## Expense Claim Type

Docs: https://docs.frappe.io/hr/expense-claim. Source: `hr:expense_claim_type/expense_claim_type.json`,
`hr:expense_claim_account`. Frappe HR's fixtures: Calls, Food, Medical, Others, Travel (`/tmp/hrms/hrms/setup.py`,
`make_fixtures`).

- **List**: Expense Claim Type. **Form**: Deferred Expense Account, Expense Claim Type\*, Accounts (table: Company,
  Default Account), Description.

Harbourline's: Travel (Travel Expenses), Food (Staff Welfare), Accommodation (Travel Expenses), Software (Software
Subscriptions), Equipment (Office Equipment), Calls, Others.

**Capxul.** Form: Expense Claim Type, Default Account (one company, so one row), Description. Commands: `capxul org hr
expense-type add Accommodation --account 5210 --description "Hotels on client trips"`; `org hr expense-type list`; an
Employee: `hr expense-type list`. No change: a different account is a new type (`payroll.expense-types`).

## Expense Claim

Docs: https://docs.frappe.io/hr/expense-claim. Source: `hr:expense_claim/expense_claim.json`, `.js`, `.py`,
`expense_claim_dashboard.py`; child tables `hr:expense_claim_detail`, `hr:expense_taxes_and_charges`,
`hr:expense_claim_advance`.

### List

Title `employee_name`; columns Total Claimed Amount, Total Amount Reimbursed, Status, Grand Total; filters Employee,
Posting Date, Company. Status (`expense_claim.py:127-161`): Draft; then on submit Unpaid (approved, owed), Paid,
Partially Paid, or Rejected; Cancelled.

| Employee Name | Status | Total Claimed | Reimbursed | Grand Total | ID |
|---|---|---|---|---|---|
| Ellis Hart | Paid | 184.85 | 188.82 | 188.82 | HR-EXP-2026-00087 |
| Hannah Cole | Draft | 64.99 | 0.00 | 64.99 | HR-EXP-2026-00091 |

### Form

Submittable, series `HR-EXP-.YYYY.-`. Tabs:

**Expenses & Advances.**

| Section | Field | Example |
|---|---|---|
| (top) | Series, From Employee\*, Employee Name, Department, Company\* | HR-EXP-2026-00087, HR-EMP-00007, Ellis Hart, Engineering |
| | Expense Approver, Approval Status (Draft, Approved, Rejected, Cancelled) | tom@harbourline.studio, Approved |
| Currency (collapsible) | Currency\* (from the Employee's salary currency), Exchange Rate | GBP, 1 |
| (expenses) | **Expenses** table\*: Expense Date, Expense Claim Type\*, Description, Amount\*, Sanctioned Amount (each row also Cost Center, Project) | see below |
| Taxes & Charges (collapsible) | table: Account Head\*, Rate, Amount, Total, Description\*, Cost Center, Project | VAT, , 3.97, 188.82, "VAT on taxi receipt" |
| Advance Payments (collapsible) | table: Employee Advance\*, Posting Date, Advance Paid, Unclaimed Amount\*, Allocated Amount (and Returned Amount) | (none) |
| Totals | Total Sanctioned Amount, Total Advance Amount, Grand Total, Total Claimed Amount, Total Taxes and Charges, Total Amount Reimbursed (and each in company currency) | 184.85, 0.00, 188.82, 184.85, 3.97, 188.82 |

Expenses for HR-EXP-2026-00087:

| # | Expense Date | Expense Claim Type | Description | Amount | Sanctioned Amount |
|---|---|---|---|---|---|
| 1 | 2026-10-14 | Travel | Return train London Paddington to Bristol Temple Meads, Severn Dynamics workshop | 142.60 | 142.60 |
| 2 | 2026-10-14 | Food | Lunch on the workshop day | 18.45 | 18.45 |
| 3 | 2026-10-15 | Travel | Taxi, Temple Meads to Severn Dynamics, Filton (net of VAT) | 23.80 | 23.80 |

**Accounting.** Section Accounting Details: Posting Date\*, Is Paid, Mode of Payment, Bank / Cash Account, Payable
Account (Expense Claim Payable); Clearance Date, Remark. Section Accounting Dimensions: Project, Cost Center. Example:
2026-10-21, off, , , Expense Claims Payable, , ; Project "Severn Dynamics: Test Rig UI".

**More Info.** Status (read-only), Task, Amended From, Delivery Trip, Vehicle Log.

**Dashboard.** Connections: Payment (Payment Entry, Journal Entry), Reference (Employee Advance).

Actions: when approved and submitted and unpaid, **Create > Payment**; **View > Accounting Ledger**; **View > Bank
Entries**.

### Approval and payment, as Frappe does it

The Employee saves the claim (Draft) and assigns it to the Expense Approver. The approver sets Sanctioned Amounts,
sets Approval Status to Approved or Rejected (explaining a rejection in a comment), and submits; submitting books the
expense against the payable. Payment is **Create > Payment**, a Payment Entry Pay to the Employee, which sets the claim
Paid (docs page; `expense_claim.py:302-421`, `:675-708`).

**Capxul.** Keep the three tabs and the Dashboard tab's Connections, adding a **Receipts** section after Expenses
(each receipt stored as a document with its hash, `table_expense_claims.receipts`), and on a paid claim a **Proof**
section (below). Changes:

- Expense Approver becomes **Decided by** (Engineering's budget, Tom Ashworth); Approval Status is read-only; the page
  head shows **Approve** (with sanctioned amounts per line) and **Reject** (with a reason) to whoever Budgets admits on
  the department's budget, never the claimant (`payroll.hr-approvers`).
- Is Paid, Mode of Payment and Bank / Cash Account are not shown: a Capxul claim is never marked paid by hand
  (`design-bank.md` G3).
- **Create > Payment** becomes **Pay**. The payment is one command from Engineering's budget: to Ellis's Safe in USDC
  at Bridge's quote, or to his bank in GBP through Bridge, by his Salary Mode.
- Status shows Capxul's moves: Open (Frappe's Draft), Approved (Unpaid), Paying, Paid, Rejected, Cancelled
  (`EXPENSE_CLAIM_STATUSES`).
- **Proof** (on HR-EXP-2026-00087): Payment pay_01JBX4…Q2; route Bank through Bridge (bank received 188.82 GBP, Safe sent
  239.61 USDC, fee 0.48); document hash 0x5e1d…a07c (the claim's lines and VAT, with each receipt's hash);
  transaction 0x9b42…e1f0; block 28,114,906; settled 2026-10-23 11:06. A **Verify** link runs `document verify`.

Commands: create `capxul hr expense-claim create --type Travel --amount 142.60 --on 2026-10-14 --description "Return
train to Bristol" --receipt ./gwr-ticket.pdf` (or `--file claim.json` for several lines); approve `capxul org hr
expense-claim approve HR-EXP-2026-00087`; reject `capxul org hr expense-claim reject HR-EXP-2026-00087 --reason
"Personal travel"`; pay `capxul org hr expense-claim pay HR-EXP-2026-00087` (`client.org(orgId).hr.expenseClaims.pay`);
read `capxul org hr expense-claim get HR-EXP-2026-00087`; the claimant withdraws with `capxul hr expense-claim cancel`.

## Employee Advance

Docs: https://docs.frappe.io/hr/employee-advance. Source: `hr:employee_advance/employee_advance.json`, `.js`, `.py`.

- **List**: Employee, Posting Date, Purpose, Advance Amount. Statuses (`employee_advance.py:142-173`): Draft, Paid,
  Partially Paid, Unpaid, Claimed, Returned, Partly Claimed and Returned, Cancelled.
- **Form** (submittable, series `HR-EAD-.YYYY.-`):

| Section | Field | Example |
|---|---|---|
| (top) | Series, Employee\*, Employee Name | HR-EAD-2026-00006, HR-EMP-00003, Priya Raman |
| | Posting Date\*, Company\*, Department | 2026-09-28, , Design |
| Currency (collapsible) | Currency\* | GBP |
| Purpose & Amount | Purpose\* | "Copenhagen, Design Week client visits, 6 to 9 October" |
| | Advance Amount\*, Paid Amount, Pending Amount, Claimed Amount, Returned Amount | 600.00, 600.00, 0.00, 518.40, 81.60 |
| Accounting | Advance Account, Mode of Payment, Repay Unclaimed Amount from Salary | Employee Advances, , on |
| More Info (collapsible) | Status, Amended From | Partly Claimed and Returned |

- **Actions** (Create group): Payment (when submitted and unpaid); Expense Claim (to claim against it); Return; Deduction
  from Salary (when Repay Unclaimed Amount from Salary is on).

**Capxul.** The form without Mode of Payment. Statuses: Requested, Paying, Paid, Claimed, Returned, Partly Claimed and
Returned, Rejected, Cancelled (`ADVANCE_STATUSES`). Paying approves it (`payroll.hr-commands`: "Paying an advance
approves it"), so the decider sees **Pay** and **Reject**. The Return action is Capxul's **Settle**, which deducts the
unclaimed amount from the next payslip after a preview (`payroll.advance-recovery`). A paid advance shows its Proof as a
claim does. Commands: `capxul hr advance request --amount 600 --purpose "Copenhagen, Design Week client visits"`; `capxul
org hr advance pay HR-EAD-2026-00006`; `org hr advance reject HR-EAD-2026-00006 --reason …`; `org hr advance settle
HR-EAD-2026-00006` (preview, then `--confirm`); `org hr advance get HR-EAD-2026-00006`; the requester: `hr advance list`,
`hr advance cancel`. Create > Expense Claim is `hr expense-claim create --advance HR-EAD-2026-00006 …`.

## Salary Component

Docs: https://docs.frappe.io/hr/salary-component. Source: `pr:salary_component/salary_component.json`,
`pr:salary_component_account`.

- **List**: Name, Abbr, Description; filter Type.
- **Form**, tab **Overview**:

| Field | Example (Basic Salary) | Example (PAYE Income Tax) |
|---|---|---|
| Name\*, Abbr\*, Type\* (Earning, Deduction, Employer Contribution), Description | Basic Salary, BS, Earning | PAYE Income Tax, PAYE, Deduction, "Tax code 1257L, monthly" |
| Depends on Payment Days | on | off |
| Is Tax Applicable (earnings) | on | |
| Deduct Full Tax on Selected Payroll Date | off | |
| Variable Based On Taxable Salary, Is Income Tax Component, Exempted from Income Tax (deductions) | | off, on, off |
| Round to the Nearest Integer, Statistical Component, Accrual Component, Do Not Include in Total, Do Not Include in Accounting Entries, Remove if Zero Valued, Arrear Component, Disabled | off, off, off, off, off, on, off, off | off, off, , off, off, on, off, off |
| Accounts (table: Company, Account, Liability Account) | Salaries and Wages | PAYE and NI Payable |

  Tab **Condition & Formula**: Condition (Python expression), Amount, Amount based on formula, Formula, and a Help
  panel ("Use field `base` for using base salary of the Employee"; "Use Salary Component abbreviations in conditions and
  formulas. BS = Basic Salary"; examples). Tab **Flexible Benefits** (earnings): Is Flexible Benefit, Payout Method,
  Max Benefit Amount (Yearly).

Harbourline's components:

| Component | Abbr | Type | Formula |
|---|---|---|---|
| Basic Salary | BS | Earning | `base` |
| Pension (Employee 5%) | PEN | Deduction | `BS * 0.05` |
| PAYE Income Tax | PAYE | Deduction | `max(0, min(BS - PEN - 1047.5, 3141.67)) * 0.2 + max(0, BS - PEN - 1047.5 - 3141.67) * 0.4` |
| Employee National Insurance | NI | Deduction | `max(0, min(BS, 4189) - 1048) * 0.08 + max(0, BS - 4189) * 0.02` |
| Advance Recovery | ADVR | Deduction | (an amount, from an advance's settlement) |
| Employer National Insurance | ERNI | Employer Contribution | `max(0, BS - 416.67) * 0.15` |
| Pension (Employer 3%) | ERPEN | Employer Contribution | `BS * 0.03` |

**Capxul.** Overview and Condition & Formula tabs as Frappe's; Flexible Benefits not shown. The Accounts table shows
the account without the company suffix. Capxul adds **Owed to** on a deduction or employer contribution (the Party a
remittance goes to: HM Revenue and Customs for PAYE and NI, Nest Pensions for pension; `payroll.deduction-remittance`,
custom field `capxul_payee_party`). Commands: `capxul org payroll component add "Employee National Insurance" --abbr
NI --type deduction --formula "max(0, min(BS, 4189) - 1048) * 0.08 + max(0, BS - 4189) * 0.02" --account 2310 --payee
hmrc`; `org payroll component change|list|disable|enable`.

## Salary Structure

Docs: https://docs.frappe.io/hr/salary-structure. Source: `pr:salary_structure/salary_structure.json`, `.js`;
`pr:salary_detail/salary_detail.json`.

- **List**: Is Active; filter Is Active. Named by the user ("UK Monthly 2026/27"). Submittable.
- **Form**, tab one: Company\*, Letter Head; Is Active\* (Yes, No), Currency\*; then Leave Encashment Amount Per Day,
  Max Benefits (Amount), Salary Slip Based on Timesheet, Payroll Frequency (Monthly, Fortnightly, Bimonthly, Weekly,
  Daily), Salary Component and Hour Rate (timesheet only). Tab **Earnings & Deductions**: three Salary Detail grids,
  **Earnings**, **Deductions**, **Employer Contributions**, each row Component\*, Abbr, Amount, (expanded) Condition,
  Amount based on formula, Formula, the component's flags; and a "Condition and Formula Help" link. Tab **Account**:
  Mode of Payment, Payment Account.
- **Actions**: Create > Single Assignment, Bulk Assignments, Income Tax Slab; Actions > Preview Salary Slip (pick an
  Employee, see the slip).

Harbourline's structures: "UK Monthly 2025/26" (cancelled), "UK Monthly 2026/27" (active, from 6 April 2026), "Pay
agreement" (Capxul's own, one earning, for contractors; `payroll.agreements-in-frappe-shape`).

**Capxul.** Tab one without Letter Head, timesheet and benefit fields; Currency shows GBP. Tab Account shows **Paid
from**: the department budget's Safe (Harbourline Treasury · USDC) and Bridge for bank payouts. Preview Salary Slip
stays (it is a read). Commands: `capxul org payroll structure create "UK Monthly 2026/27" --frequency monthly --token GBP
--earning BS --deduction PEN --deduction PAYE --deduction NI --contribution ERNI --contribution ERPEN --amends "UK
Monthly 2025/26"` (spelling as booked; `--token` names the currency); `org payroll structure cancel`; Create > Single
Assignment is `org payroll structure assign`.

## Salary Structure Assignment

Docs: https://docs.frappe.io/hr/salary-structure-assignment. Source:
`pr:salary_structure_assignment/salary_structure_assignment.json`.

- **List**: Employee, Salary Structure; filters Employee, Department, Designation, Salary Structure. Submittable,
  `HR-SSA-.YY.-.MM.-.#####`.
- **Form**:

| Section | Field | Example |
|---|---|---|
| (top) | Employee\*, Employee Name, Department, Designation, Grade | HR-EMP-00007, Ellis Hart, Engineering, Senior Software Engineer |
| | Salary Structure\*, From Date\*, Income Tax Slab | UK Monthly 2026/27, 2026-04-06 |
| | Company\*, Payroll Payable Account, Currency | , Payroll Payable, GBP |
| Base, Variable & Leave Encashment | Base, Annual Gross Earning (read-only) | 4,000.00, 48,000.00 |
| | Variable, Total Cost To Company (CTC) (read-only), Leave Encashment Amount Per Day | 0.00, 55,890.00 |
| Employee Benefits | Maximum Benefit Amount, Flexible Benefits table | |
| Payroll Cost Centers (collapsible) | table: Cost Center, Percentage | Engineering, 100 |

**Capxul.** Without Grade, Income Tax Slab, leave encashment and benefits. Adds **Paid by**: the department budget
(Engineering) whose hat pays the runs that include this Employee. Commands: `capxul org payroll structure assign "UK
Monthly 2026/27" HR-EMP-00007 --start 2026-04-06 --base 4000`; `org payroll structure unassign HR-SSA-26-04-00009`;
`org payroll structure list --employee HR-EMP-00007`.

## Payroll Entry

Docs: https://docs.frappe.io/hr/payroll-entry. Source: `pr:payroll_entry/payroll_entry.json`, `payroll_entry.js`
(refresh, lines 64 to 205), `payroll_entry_list.js`, `payroll_entry.py`.

### List

Columns Company, Branch, Currency; status pill Draft red, Submitted blue, Queued orange, Failed red, Cancelled red.
Named `HR-PRUN-.YYYY.-.#####`.

| ID | Status | Posting Date | Period | Department | Employees | Currency |
|---|---|---|---|---|---|---|
| HR-PRUN-2026-00010 | Submitted | 2026-10-30 | 2026-10-01 to 2026-10-31 | (all) | 23 | GBP |
| HR-PRUN-2026-00009 | Submitted | 2026-09-29 | 2026-09-01 to 2026-09-30 | (all) | 21 | GBP |

### Form

Tabs:

**Overview.** Posting Date\*, Company\*; Currency\*, Exchange Rate\*, Payroll Payable Account\*, Status (read-only:
Draft, Submitted, Cancelled, Queued, Failed). Section: Salary Slip Based on Timesheet, Payroll Frequency, Start
Date\*, End Date\*, Deduct Tax For Unsubmitted Tax Exemption Proof. Example: 2026-10-30; GBP, 1, Payroll Payable;
Monthly, 2026-10-01, 2026-10-31.

**Employees.** Section Filter Employees: Branch, Department, Designation, Grade, Number Of Employees (read-only). Section
Employee Details: the **Employees** grid (Employee, Employee Name, Department, Designation, Is Salary Withheld). Then
Validate Attendance and, when on, an attendance summary of unmarked days per employee.

**Accounting & Payment.** Section Accounting Dimensions: Cost Center\*, Project. Section Payment Entry: Payment Account,
Bank Account.

**Failure Details** (only when Failed): Error Message.

**Connections.** Salary Slip, Journal Entry.

### The steps, as Frappe does them

The buttons change with the run's state (`payroll_entry.js:64-205`):

| Step | State before | Button | What it does | State after |
|---|---|---|---|---|
| 1 | new, saved Draft with no employees | **Get Employees** (primary) | Fills the Employees grid from the filters (`fill_employee_details`) | Draft, 23 employees |
| 2 | Draft with employees | **Create Salary Slips** (primary) | Submits the Payroll Entry and makes one draft slip per employee (`create_salary_slips`, `payroll_entry.py:309`) | Submitted, slips Draft |
| 3 | Submitted, slips created | **Submit Salary Slip** (primary) | Submits every slip and posts the accrual Journal Entry: Dr each earning, Cr each deduction, Cr Payroll Payable (`make_accrual_jv_entry`, `:619`) | slips Submitted |
| 4 | slips submitted, no bank entry | **Make Bank Entry** (primary) | Opens a draft Bank Entry for the nets; the user enters the reference and submits it (`make_bank_entry`, `:1093`) | paid by the Bank Entry |
| 4b | some salaries withheld | **Release Withheld Salaries** | A Bank Entry for the withheld slips once released | |

A Failed run shows a headline: "Salary Slip creation failed. You can resolve the issue and retry creation."

### Capxul

The run's form keeps the four tabs and a **step strip** of four steps, each with its command. Frappe's Make Bank Entry
is refused on a Capxul account and replaced by **Pay** (`design-bank.md` G4, P5):

| Step | Capxul button | Command | Who |
|---|---|---|---|
| 1 Get employees, 2 Create slips | **Create run** (one action: the run is drafted with its slips worked out) | `capxul org payroll run create harbourline --start 2026-10-01 --end 2026-10-31 --posting 2026-10-30` | People |
| 3 Submit slips | **Submit slips** (fixes the slips, stores each payslip, posts the accrual) | `capxul org payroll run submit HR-PRUN-2026-00010` | People |
| 4 Pay | **Pay 23 payslips** (one payment command, one approval) | `capxul org payroll run pay HR-PRUN-2026-00010` | the department's hat (here the Harbourline hat, Maya Okafor) |
| 4b Release | **Release** on a withheld slip, then Pay again | `capxul org payroll payslip release <slip>`, then `org payroll run pay HR-PRUN-2026-00010 --slip <slip>` | People, then the hat |

Run status (`payroll.run-machine`): Draft, Submitted, Paying, Paid, Cancelled. Frappe's Queued and Failed do not occur.

- **Overview** shows Currency GBP, Payroll Payable, and replaces Exchange Rate with **Paid from**: Harbourline Treasury
  · USDC, by Bridge at each payout's quote for bank-paid slips.
- **Employees**: the grid gains **Payslip**, **Net Pay**, **Paid to** (Safe or Bank), and **Payment** (Paid, Paying,
  Escrowed, Withheld) columns. The filter section offers Department only (Branch, Designation and Grade are not used).
- **Accounting & Payment**: Cost Center; Payment Account shows "Harbourline Treasury · USDC". Capxul adds a **Payment**
  section after a pay: command id, approval (approved by Maya Okafor from her Safe, 2026-10-30 16:02), the batch's
  transaction and block, the count paid (22 of 23 settled, 1 escrowed), and the escrow line for anyone with no account:
  "Hannah Cole: 1,521.72 GBP waiting to be claimed. She was sent an email. You can take it back with `payment cancel`
  until she claims it." (claimed 2026-11-04 08:51).
- **Connections**: Payslips (23), Bank entries (23: one per slip on settlement, `bank.entry-per-slip`), Accrual (1).

**One batch per month.** Frappe's run filters employees by department or takes all. Capxul's run names a department,
whose budget pays it. For the data brief's "one batch per month", run it on the top department, Harbourline, whose hat
the managing director wears; each slip still shows the Employee's own department and cost centre. Contractors on pay
agreements are never in a run (`payroll.md`, "Runs never pay agreements"); their collections appear as payslips born
paid.

**The FDE** may prepare and submit a run for the People hat wearer who asks; paying is drafted for the hat wearer to run.

## Salary Slip

Docs: https://docs.frappe.io/hr/salary-slip. Source: `pr:salary_slip/salary_slip.json`, `salary_slip_list.js`,
`salary_slip.py` (`default_series` line 167: `Sal Slip/{employee}/.#####`); `pr:salary_slip_leave`.

### List

Columns Posting Date, Employee, Employee Name, Company, Salary Structure; filters Employee, Department, Branch, Company,
Salary Structure. Menu: Email Salary Slips (for selected). Status: Draft, Submitted, Withheld, Cancelled.

| Employee Name | Status | Posting Date | Period | Net Pay | ID |
|---|---|---|---|---|---|
| Ellis Hart | Submitted | 2026-10-30 | Oct 2026 | 3,013.34 | Sal Slip/HR-EMP-00007/00014 |
| Hannah Cole | Submitted | 2026-10-30 | 12 to 31 Oct 2026 | 1,521.72 | Sal Slip/HR-EMP-00024/00001 |

### Form

Submittable. Tabs:

**Details.** Section Employee Info: Employee\*, Employee Name, Company\*, Department, Designation, Branch; Posting
Date\*, Letter Head; Status (read-only), Salary Withholding, Currency. Section Payroll Info: Payroll Frequency, Start
Date, End Date; Salary Structure, Payroll Entry, Mode Of Payment; Salary Slip Based on Timesheet.

**Payment Days.** Working Days, Leave Without Pay; Absent Days, Payment Days; a Payment Days Calculation Help panel.

**Earnings & Deductions.** Earnings and Deductions grids side by side (Component, Abbr, Amount, Year To Date, and the
component's flags), Employer Contributions (collapsible), then Totals: Gross Pay, Gross Year To Date; Total Deduction.

**Net Pay Info.** Net Pay, Rounded Total (bold), Year To Date, Month To Date; Total in words.

**Income Tax Breakup** (when a CTC is set): CTC, Income from Other Sources, Total Earnings, Non Taxable Earnings,
Standard Tax Exemption Amount, Tax Exemption Declaration, Deductions before tax calculation, Annual Taxable Amount,
Income Tax Deducted Till Date, Current Month Income Tax, Future Income Tax, Total Income Tax.

**Bank Details.** Journal Entry, Amended From, Bank Name, Bank Account No.

**Leaves.** Leave Details table: Leave Type, Total Allocated Leave(s), Expired Leave(s), Used Leave(s), Leave(s)
Pending Approval, Available Leave(s).

Example, Sal Slip/HR-EMP-00007/00014 (Ellis Hart, October 2026, base 4,000.00):

| Earnings | Amount | Year To Date | | Deductions | Amount | Year To Date |
|---|---|---|---|---|---|---|
| Basic Salary | 4,000.00 | 28,000.00 | | Pension (Employee 5%) | 200.00 | 1,400.00 |
| | | | | PAYE Income Tax | 550.50 | 3,853.50 |
| | | | | Employee National Insurance | 236.16 | 1,653.12 |
| **Gross Pay** | **4,000.00** | **28,000.00** | | **Total Deduction** | **986.66** | **6,906.62** |

Employer Contributions: Employer National Insurance 537.50; Pension (Employer 3%) 120.00. Net Pay 3,013.34 ("Three
Thousand Thirteen Pounds and Thirty Four Pence only"). Working Days 31, Payment Days 31, Leave Without Pay 0, Absent 0.
Leaves: Annual Leave 28, 0, 9.5, 4, 14.5; Sick Leave 10, 0, 2, 0, 8.

### Capxul

The tabs as Frappe's, except Income Tax Breakup (Capxul does not compute annual tax slabs; the PAYE row is a monthly
formula; leave the tab out) and Bank Details, which becomes **Payment**:

| Field | Example |
|---|---|
| Status | Paid (Capxul's moves: Draft, Submitted, Withheld, Paying, Escrowed, Paid, Cancelled; `payroll.slip-machine`) |
| Paid to | Ellis Hart's bank through Bridge, Monzo ·· 9057 (Tom Ashworth's slip shows his Capxul Safe, 0x7c3E…91aD) |
| Amount sent | The bank received 3,013.34 GBP; the Safe sent 3,824.51 USDC at Bridge's quote; Bridge's fee 1.91 USDC (a Safe-paid slip shows the USDC sent at the day's quote) |
| Payment | pay_01JBW9…7TK, one of 23 in run HR-PRUN-2026-00010 (item 7 of 23) |
| Proof: document hash | 0x3fa1…c29e, the payslip's hash, carried on chain (C8) |
| Transaction, block, settled | 0x6d0e…41b8, 28,093,551, 2026-10-30 16:04 |
| Bank entry | the Journal Entry made on settlement (Dr Payroll Payable, Cr Harbourline Treasury) |

Rounded Total is not shown (Capxul disables it). Hannah Cole's slip shows Escrowed from 30 October to 4 November, with
"Waiting for Hannah to claim" and the cancel command for the payer; then Paid with the claim's transaction. Actions:
**Withhold** (People, with a reason) and **Release**; **View payslip** opens the printed layout. Commands: `capxul org
payroll payslip withhold "Sal Slip/HR-EMP-00011/00005" --reason "Final pay held until equipment is returned"`; `org
payroll payslip release …`; the employee: `capxul payroll payslip get "Sal Slip/HR-EMP-00007/00014"`, `capxul payroll
payslip list`; proof: `capxul document verify <document>` and `capxul payment get pay_01JBW9…7TK`.

## The printed payslip

Source: `/tmp/hrms/hrms/payroll/print_format/salary_slip_detailed/salary_slip_detailed.json` (also Compact and Classic,
same blocks). Frappe HR's print formats are built of HTML blocks, in this order:

1. **Header**: "Salary Statement"; the period ("1 Oct 2026 to 31 Oct 2026", and the payroll period if set); at the
   right the slip's name and "Issued 30 Oct 2026".
2. **Employee Details**, two key-value columns: Employee Name, Employee ID, Designation, Department; Branch, Salary
   Structure, Payroll Frequency, Exchange Rate (if not 1).
3. **Attendance strip**: Working Days, Payment Days, Leave Without Pay, Absent Days, Unmarked Days.
4. **Earnings** ledger: Component, This Period, Year to Date, rows with an amount, then a Gross Pay total row.
5. **Deductions** ledger, the same columns, then Total Deduction (and Total Loan Repayment if any).
6. **Net Pay** band: the amount (net pay when the rounded total is disabled), the total in words, "Net paid year to
   date …".
7. **Leave Balances and Income Tax**, side by side: Leave Type, Used, Available; and an Income Tax Working table (CTC,
   Total Earnings, exemptions, Annual Taxable Amount, Total Income Tax) when tax was computed.
8. **Footer**: bank name and account, or "Paid by {mode}"; "This is a computer generated document and does not require
   a signature."

**Capxul.** A page-like payslip view in Capxul's identity with the same eight blocks, the company's name and address
at the top ("Harbourline Studio Ltd, 14 Hoxton Square, London N1 6NU"; `document render`'s rule: a payslip names its
employer and employee), employer contributions as a small block after deductions, and a footer that replaces the bank
line with the **proof**: "Paid 30 Oct 2026 16:04 to Monzo ·· 9057 through Bridge. Document hash 0x3fa1…c29e, transaction
0x6d0e…41b8." No print or download button (page rules); the view is the slip. Command: `capxul document render
<document>`.

## Report: Salary Register

Docs: https://docs.frappe.io/hr/human-resources-reports#2-salary-register. Source:
`/tmp/hrms/hrms/payroll/report/salary_register/salary_register.{js,py}`.

- **Filters**: From\*, To\*, Currency, Employee, Company\*, Document Status (Draft, Submitted, Cancelled), Department,
  Designation, Branch, Show Employer Contributions.
- **Columns**: Salary Slip ID, Employee, Employee Name, Date of Joining, Branch, Department, Designation, Company, Start
  Date, End Date, Leave Without Pay, Absent Days, Payment Days, then one column per earning component, Gross Pay, one
  per deduction component, Loan Repayment (with Lending only), Total Deduction, Net Pay, then (when asked) one per
  employer contribution and Total Employer Contribution, and Currency. A total row.

| Salary Slip ID | Employee Name | Department | Payment Days | Basic Salary | Gross Pay | Pension | PAYE | NI | Total Deduction | Net Pay |
|---|---|---|---|---|---|---|---|---|---|---|
| Sal Slip/HR-EMP-00007/00014 | Ellis Hart | Engineering | 31 | 4,000.00 | 4,000.00 | 200.00 | 550.50 | 236.16 | 986.66 | 3,013.34 |
| Sal Slip/HR-EMP-00024/00001 | Hannah Cole | Design | 20 | 1,806.45 | 1,806.45 | 90.32 | 133.73 | 60.68 | 284.73 | 1,521.72 |
| **Total (23)** | | | | | 92,412.90 | | | | 18,494.48 | 73,918.42 |

**Capxul.** The same report for October 2026, without Branch, Company and Loan Repayment, with two Capxul columns at
the end: **Payment** (Paid, Escrowed, Withheld) and **Proof** (the short document hash, linking to the payment). Its
Net Pay total equals the run's payments. Command: `capxul org payroll run get HR-PRUN-2026-00010` (one run with its
slips; `client.org(orgId).payroll.runs.get`).

Hannah Cole's first month, 12 to 31 October, on a base of 2,800.00: payment days 20 of 31, so Basic Salary is
2,800 × 20 / 31 = 1,806.45 and Pension 90.32 (both depend on payment days); PAYE (1,806.45 − 90.32 − 1,047.50) × 0.2 =
133.73 and NI (1,806.45 − 1,048) × 0.08 = 60.68 are worked from the prorated rows (they do not depend on payment
days). The generator works every slip out from the formulas above.

## The self-service app

Frappe HR's mobile app is an installable web app at `/hrms` (`/tmp/hrms/frontend/vite.config.js:29-31`,
`hrms/hooks.py:86-87`), built with Ionic and Vue (`fe:`). Every screen has a header with the page title (default
"Frappe HR"), a bell with an unread dot, and the person's avatar; and a bottom tab bar: **Home**, **Attendance**,
**Leaves**, **Expenses**, **Salary** (`fe:components/BottomTabs.vue`).

**Capxul.** A "My HR" side of the app, at phone width first, in Capxul's identity, header "Capxul", the same five
tabs. These are the Employee's own commands, which need no Seat and take `--employer` (`payroll.hr-self`). Show it
inside the mock-up as a phone frame or as the 400 px layout of the same routes.

### Login

Email or username, password, Login; "Forgot Password?" (`fe:views/Login.vue`). **Capxul**: Capxul's sign-in (`capxul
auth login`); not part of the mock-up's walkthroughs.

### Home and check-in

`fe:views/Home.vue`, `fe:components/CheckInPanel.vue`, `fe:components/QuickLinks.vue`, `fe:components/RequestPanel.vue`.

1. **Check-in panel**: "Hey, Ellis 👋"; "Last check-in was at 09:21 am · View List"; a **Check Out** button (Check In
   when the last log was OUT). Pressing it opens a sheet with the time (09:21:07 am), the date, the location
   (latitude, longitude, a map) and **Confirm Check In**.
2. **Quick Links**: Request Attendance; Request a Shift; Request Leave; Request Compensatory Leave; Claim an Expense;
   Request an Advance; View Salary Slips.
3. **Requests**: two tabs, **My Requests** and **Team Requests**, each a list of leave applications, expense claims,
   shift requests and attendance requests, with type, dates or amount, and a status badge.

**Capxul.** "Good morning, Ellis" (no emoji); "Checked in at 09:21 · View list"; **Check out**; the confirm sheet
without a map. Quick links keep only what Capxul has: Request leave, Claim an expense, Request an advance, View
payslips (Request Attendance, Request a Shift and Compensatory Leave are not native: drop them). Requests: My requests
and Team requests (the second only for someone who wears a hat). Commands: `capxul hr attendance checkin --log out`;
`capxul hr leave list`, `capxul hr expense-claim list`.

### Attendance tab

`fe:views/attendance/Dashboard.vue`, `fe:components/AttendanceCalendar.vue`: **Attendance Calendar** (a month grid,
each day coloured: Present green, Absent red, Half Day, On Leave; a summary row of Present, Half Day, Absent, On Leave
counts); **Request Attendance**; Recent Attendance Requests; **Upcoming Shifts**; **Request a Shift**; Recent Shift
Requests. Check-in list: Log Type and time per row.

**Capxul.** The calendar and its summary, Upcoming shifts (from the assignment), and the check-in list. No request
buttons. Command: `capxul hr attendance list --start 2026-11-01`.

### Leaves tab ("Leaves & Holidays")

`fe:views/leave/Dashboard.vue`, `fe:components/LeaveBalance.vue`, `fe:components/Holidays.vue`, `fe:views/leave/Form.vue`.

- **Leave Balance**: a semicircle gauge per type, "Annual Leave balance 14.5 / 28"; "View Leave History".
- **Request a Leave** (solid button); Compensatory Leave Requests (outline).
- **Recent Leaves**: rows with type, dates, "4d", status badge; View List.
- **Upcoming Holidays**: date and description; "View All" opens the Holiday List sheet.
- **The form**: Employee, Leave Type (only types with balance), From Date, To Date, Half Day, Total Leave Days, Reason,
  Leave Balance Before Application, Leave Approver (filled), Posting Date, attachments; **Save**, then **Submit**.

**Capxul.** As Frappe's without compensatory leave; the approver shows as the hat. Upcoming Holidays: 25 Dec Christmas
Day, 28 Dec Boxing Day (substitute day), 1 Jan 2027 New Year's Day. Commands: `capxul hr leave balance`, `capxul hr
leave apply …`, `capxul hr holiday list`.

### Expenses tab

`fe:views/expense_claim/Dashboard.vue`, `fe:views/expense_claim/Form.vue`, `fe:components/ExpenseClaimSummary.vue`,
`fe:components/ExpensesTable.vue`, `fe:components/ExpenseAdvancesTable.vue`, `fe:components/EmployeeAdvanceBalance.vue`.

- **Expense Claim Summary**: Total Claimed Amount; Pending, Approved, Rejected amounts.
- **Claim an Expense**; **Recent Expenses** ("Travel & 2 more", amount, date, status badge); **Employee Advance
  Balance** with **Request an Advance**.
- **The claim form** in three tabs: **Expenses** (the expense items, each added in a sheet: Expense Date, Expense Claim
  Type, Description, Amount; "Sanctioned: …" shown once decided; Taxes), **Advances** ("Settle against Advances": each
  advance with "Unclaimed Amount: …" and an allocated amount), **Totals** (the totals, Cost Center).
- **The advance form**: Employee, Purpose, Advance Amount, Posting Date.

**Capxul.** As Frappe's, plus a receipt photo per expense item and, on a paid claim, a short proof line ("Paid 23 Oct ·
proof 0x5e1d…a07c"). Commands: `capxul hr expense-claim create …`, `capxul hr advance request …`, `capxul hr
expense-claim get HR-EXP-2026-00087`.

### Salary tab

`fe:views/salary_slip/Dashboard.vue`, `fe:views/salary_slip/Detail.vue`, `fe:components/SalarySlipItem.vue`,
`fe:components/SalaryDetailTable.vue`.

- **Year To Date** (from the latest slip) and a **Payroll Period** select ("Apr 2026 - Mar 2027").
- The slips of that period, each with the month, "Gross Pay: …" and the net.
- **The slip's detail**: the slip's fields with Earnings and Deductions tables, and **Download PDF**.

**Capxul.** Year to date 28,000.00 gross, 21,093.38 net; the slips for April to October 2026 (net 3,013.34 each); the detail as the printed payslip view, with its proof, and no download.
Commands: `capxul payroll payslip list`, `capxul payroll payslip get "Sal Slip/HR-EMP-00007/00014"`.

### Team requests and approval

A request in Team Requests opens an action sheet (`fe:components/RequestActionSheet.vue`) with the request's fields
and attachments and, for a leave or claim waiting for this person, **Reject** and **Approve**; for the owner of an open
one, **Submit**; for a submitted one, **Cancel** ("Permanently cancel Leave Application?" with Yes and No). Toasts:
"Approved successfully!", "Document submitted successfully!".

**Capxul.** The same sheet: Approve and Reject (a reason for a rejection), Cancel for the applicant's own open request,
with the confirmation built into the sheet (no browser dialog). Toast: "Leave approved. Ellis's days are marked on
leave." Commands: `capxul org hr leave approve …`, `capxul org hr expense-claim approve …`.

## The FDE in HR and payroll

Anyone can ask the FDE; it acts with the asker's hats and drafts the risky step (`aaron.fde-anyone`). Examples for the
module's FDE panel (answers scripted in the mock-up):

| Asker | Ask | The FDE does | It drafts for the person |
|---|---|---|---|
| Ellis Hart (no hat) | "Book me off 21 to 24 December" | Reads `hr leave balance` (14.5 left) and the holidays | `capxul hr leave apply --type "Annual Leave" --start 2026-12-21 --end 2026-12-24` for Ellis to run |
| Kwame Mensah (People) | "Run October's payroll" | Runs `org payroll run create harbourline --start 2026-10-01 --end 2026-10-31` and, once Kwame checks the slips, `org payroll run submit HR-PRUN-2026-00010` | `capxul org payroll run pay HR-PRUN-2026-00010` for Maya, who wears the Harbourline hat |
| Maya Okafor, on 2 November | "Who hasn't claimed their pay?" | Reads the run: Hannah Cole, 1,521.72 waiting since 30 Oct (she claimed on 4 November) | nothing, or `payment cancel` if Maya asks to take it back |
| Kwame Mensah | "Hannah Cole starts on 12 October as a Junior Designer" | Drafts the hire, the structure assignment and the shift assignment | `org hr employee add hannah.cole@… --first-name Hannah --last-name Cole --joined 2026-10-12 --department design --designation "Junior Designer" --type full-time`, then `org payroll structure assign …`, `org hr shift-type assign …` |
| Tom Ashworth (Engineering hat) | "Approve Ellis's Bristol claim" | Checks the receipts | `capxul org hr expense-claim approve HR-EXP-2026-00087`, then `… pay …` for Tom |

The FDE's own commands: `capxul org fde ask "…"`, `org fde show`, `org fde turn get`.

## Routes and commands for the module

Suggested hash routes for `app/js/hr.js` and `app/js/payroll.js` (plain names; a record's id follows as the shell's
router decides). None uses a forbidden word: the two settings screens are `hr-config` and `payroll-config`.

| Route | Screen | Command on the strip |
|---|---|---|
| `hr` | HR workspace | `capxul org hr employee list` |
| `employees`, `employee` | Employee list, form | `org hr employee list`, `org hr employee get <employee>` |
| `org-chart` | Organisation chart (tree by Reports to) | `org hr employee list` |
| `departments`, `department` | Department tree, form | `org department list`, `org department show <department>` |
| `designations` | Designations | (none) |
| `holidays` | Holiday List for a year | `org hr holiday list --year 2026` |
| `leave-home` | Leaves workspace | `org hr leave list --status open` |
| `leave-types`, `leave-type` | Leave types | `org hr leave-type list` |
| `leave-allocations`, `leave-allocation` | Allocations | `org hr leave allocate …` |
| `leaves`, `leave`, `leave-calendar` | Leave applications: list, form, calendar | `org hr leave list`, `org hr leave approve <application>` |
| `leave-balance`, `leave-balance-summary` | The two reports | `org hr leave balance <employee>` |
| `attendance-home` | Attendance workspace | `org hr attendance list` |
| `attendance`, `attendance-sheet` | Attendance list and form; Monthly Attendance Sheet | `org hr attendance list --start … --end …` |
| `checkins` | Check-ins | `hr attendance checkin` |
| `shift-types`, `shift-type` | Shift types and assignments | `org hr shift-type list` |
| `expenses` | Expenses workspace | `org hr expense-claim list` |
| `expense-types` | Expense types | `org hr expense-type list` |
| `expense-claims`, `expense-claim` | Claims | `org hr expense-claim get <claim>`, `… approve`, `… pay` |
| `advances`, `advance` | Advances | `org hr advance get <advance>`, `… pay`, `… settle` |
| `payroll` | Payroll workspace | `org payroll run list` |
| `salary-components`, `salary-component` | Components | `org payroll component list` |
| `salary-structures`, `salary-structure` | Structures | `org payroll structure list` |
| `structure-assignments` | Assignments | `org payroll structure assign …` |
| `payroll-runs`, `payroll-run` | Runs, with the step strip | `org payroll run get <run>`, `… submit`, `… pay` |
| `payslips`, `payslip`, `payslip-print` | Slips, the slip, the printed payslip | `org payroll payslip withhold <slip>`, `payroll payslip get <slip>`, `document render <document>` |
| `salary-register` | Salary Register | `org payroll run get <run>` |
| `me`, `me-attendance`, `me-leave`, `me-expenses`, `me-payslips` | The self-service app's five tabs | `hr attendance checkin`, `hr leave balance`, `hr expense-claim list`, `payroll payslip list` |

## Left out, and conflicts to flag

**Left out of the mock-up, because Capxul does not keep them natively** (`payroll.hr-scope`): Frappe HR's Recruitment,
Performance, Tenure (onboarding, separation, grievance, promotion, transfer), Tax & Benefits, Training, Travel and
Vehicles, Leave Policy and its Assignment, Leave Period, Leave Encashment, Leave Control Panel, Leave Block List,
Compensatory Leave Request, Attendance Request, Shift Request, Shift Schedule, Roster, Overtime, Employee Incentive,
Retention Bonus, Income Tax Slab and the Income Tax Breakup tab, Employee Grade, Branch and Employee Group.

**Conflicts for the orchestrator.**

1. **`org head …` names "head".** The command surface reaches every record Capxul does not keep natively through
   `org head doc …` (`command-surface.md` section 4), but `aaron.one-product` forbids the word "head" anywhere. Every
   screen in this module maps to a native command, so the module needs no `org head` command. If any later screen does,
   leave its command strip empty and flag it rather than print `org head`.
2. **Approvers.** Frappe's Leave Approver and Expense Approver are users; Capxul decides by hat. The re-skin shows the
   hat and its wearer in their place, never a user picker.
3. **One batch per month.** Capxul's run names a department; the data brief wants one payroll batch a month. Use the top
   department (Harbourline) for the run, as above, or one run per department a month (five approvals). Choose one and
   keep it for all 18 months.
4. **Currency.** Capxul's payroll design says the run's currency is the department budget's token; a UK employer
   computes PAYE and NI in pounds. This page shows UK staff in GBP, paid from the USDC Safe through Bridge (the bank
   amount in GBP, the USDC sent, the fee) or to a Capxul Safe at the quote, and contractors abroad in USDC by pay
   agreement. The data step should state the rule it uses and apply it everywhere.
5. **Desk sources.** The Frappe clone at `/tmp/frappe` holds no desk JavaScript, so the list, form and report patterns
   come from the docs and the HR scripts; the shell research may describe them more closely.
