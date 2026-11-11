// The FDE and the feeds. Harbourline's Forward Deployed Engineer sets Capxul up with the company and helps it get the
// most out of it: the onboarding of May and June 2025 step by step, what Harbourline is not using yet and what each
// would save, the training sessions, the conversations (mostly setup and how-to), and the FDE's hosting and guests.
// It does not run the company day to day: people pay, invoice and run payroll, and the sales, people and project
// agents do their own routine work in the assistant panel. This file also keeps the money feed (activity), the
// company's events and the viewer's notices. Fictional sample data.
import { cx, h } from './core.js';

const D = cx.data;
const fmt = cx.fmt;
const ORG = '--org harbourline';
const N = () => cx.native || {};
const M = D.money;
const F = D.fde;
const RATE = cx.rate(cx.today);
const r2 = (n) => Math.round((+n + Number.EPSILON) * 100) / 100;
const addDays = (d, n) => new Date(Date.parse(d.slice(0, 10) + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b.slice(0, 10) + 'T00:00:00Z') - Date.parse(a.slice(0, 10) + 'T00:00:00Z')) / 864e5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tick = 0;
const stamp = () => (N().stamp ? N().stamp() : new Date(cx.now.getTime() + ++tick * 45000).toISOString());
const FDE_HANDLE = F.hosting.handle;
const has = (r) => cx.hasRoute(r);
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

cx.style('fde', `
.fd-feed { list-style: none; margin: 0; padding: 0; }
.fd-day { padding: 8px 14px; font-size: 12px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--faint); background: var(--surface-2); border-bottom: 1px solid var(--line); border-top: 1px solid var(--line); }
.fd-feed li:first-child .fd-day { border-top: 0; }
.fd-row { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; }
.fd-row:hover { background: var(--hover); }
.fd-row .ic-wrap { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--sunk); color: var(--fg-2); }
.fd-row .ic-wrap.in { background: var(--t-green-bg); color: var(--t-green); }
.fd-row .ic-wrap.out { background: var(--sunk); color: var(--fg-2); }
.fd-row .t { min-width: 0; display: grid; gap: 1px; }
.fd-row .t b { font-weight: 600; overflow-wrap: anywhere; }
.fd-row .t small { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.fd-row .r { text-align: right; display: grid; gap: 1px; justify-items: end; }
.fd-filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.fd-filters .ctl { width: auto; min-width: 0; max-width: 100%; }
.fd-notice { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 10px; align-items: start; padding: 11px 14px; border-bottom: 1px solid var(--line); }
.fd-notice .dot2 { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; background: var(--accent); }
.fd-notice.read .dot2 { background: transparent; }
.fd-notice.read .tx { color: var(--fg-2); font-weight: 400; }
.fd-notice .tx { font-weight: 600; overflow-wrap: anywhere; }
.fd-notice small { display: block; color: var(--muted); font-size: 12px; font-weight: 400; }
.fd-steps { list-style: none; margin: 0; padding: 0; }
.fd-step { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 14px; padding: 14px; border-bottom: 1px solid var(--line); }
.fd-step:last-child { border-bottom: 0; }
.fd-cal { display: grid; justify-items: center; align-content: start; gap: 0; padding-top: 2px; }
.fd-cal b { font: 600 18px/1 var(--font-ui); font-stretch: var(--wide); }
.fd-cal small { font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.fd-cal i { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--t-green-bg); color: var(--t-green); margin-top: 8px; font-style: normal; }
.fd-step-b { min-width: 0; display: grid; gap: 6px; }
.fd-step-h { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
.fd-step-h h3 { font: 600 14.5px/1.3 var(--font-ui); margin: 0; overflow-wrap: anywhere; }
.fd-step-h h3 a { color: inherit; }
.fd-by { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; font-size: 12.5px; color: var(--muted); }
.fd-did { font-size: 13px; color: var(--fg-2); padding: 7px 10px; border-left: 2px solid var(--accent); background: var(--surface-2); border-radius: 0 6px 6px 0; overflow-wrap: anywhere; }
.fd-did b { color: var(--fg); font-weight: 600; }
.fd-res { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
.fd-feat { display: grid; gap: 10px; align-content: start; }
.fd-feat p { margin: 0; font-size: 13.5px; color: var(--fg-2); }
.fd-save { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.fd-save > div { border: 1px solid var(--line); border-radius: var(--r); padding: 8px 10px; display: grid; gap: 2px; min-width: 0; }
.fd-save small { font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.fd-save b { font-weight: 600; overflow-wrap: anywhere; }
.fd-acts { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.fd-who { display: flex; flex-wrap: wrap; gap: 4px; }
.fd-convo { display: grid; gap: 14px; }
@media (max-width: 560px) { .fd-hint { display: none; } .fd-step { grid-template-columns: 40px minmax(0, 1fr); gap: 10px; padding: 12px; } .fd-save { grid-template-columns: minmax(0, 1fr); } }
`);

/* =====================================================================================================
   Workspaces
   ===================================================================================================== */

cx.workspace({ id: 'fde', label: 'FDE', icon: 'fde', route: 'fde', seatless: true, nav: [
  { label: 'Setup', route: 'fde' },
  { label: 'Not used yet', route: 'fde-unused' },
  { label: 'Training', route: 'fde-training' },
  { label: 'Conversations', route: 'fde-conversations', match: ['fde-conversation'] },
  { label: 'Hosting and guests', route: 'fde-hosting' },
] });
cx.workspace({ id: 'activity', label: 'Activity', icon: 'activity', route: 'activity', nav: [{ label: 'Money feed', route: 'activity', match: ['activity-item'] }, { label: 'Events', route: 'events' }, { label: 'Notices', route: 'notices' }] });

/* =====================================================================================================
   Harbourline's setup, as it happened in May and June 2025
   ===================================================================================================== */

const LIVE = '2025-06-30';
const imported = D.people.filter((p) => p.dateOfJoining < D.company.onCapxulSince);
const firstRun = D.payroll.runs[0];
const bank = D.books.bankAccounts?.[0];
const leafAccounts = (D.books.accounts || []).filter((a) => !a.isGroup).length || (D.books.accounts || []).length;

/** The onboarding: each step with its date, who did it, what the FDE did and where it lives now. */
const SETUP = [
  { id: 'company', day: '2025-05-01', area: 'Company', icon: 'board', title: 'Harbourline and its hats', by: ['maya'],
    fde: 'Drafted the hat list from the team sheet and the old tools\' user roles, then walked Maya through who may approve what before anyone signed: Maya as founder Director and holder of the Harbourline hat, Isla and Sam Whitfield wearing People, Tom wearing Engineering.',
    result: `Harbourline started with ${D.seats.history?.[0]?.limit ?? 10} seats; Maya, Tom, Isla and Sam took the first four.`, route: 'board' },
  { id: 'safes', day: '2025-05-01', area: 'Money', icon: 'shield', title: 'The Treasury and the Reserve Safe', by: ['maya'],
    fde: 'Set up both Safes on Base with Maya\'s passkey, moved 1 USDC between them as a test, and wrote down the rule: department budgets pay from the Treasury; the Reserve Safe holds the rounds\' money and moves only by Board proposal.',
    result: `Treasury ${fmt.addr(D.company.treasury)} · Reserve Safe ${fmt.addr(D.company.reserve)}`, route: 'treasury' },
  { id: 'bank', day: '2025-05-01', area: 'Bank', icon: 'bank', title: 'Barclays and Bridge connected', by: ['maya'],
    fde: `Connected the ${bank?.bank || 'Barclays'} business account ·· ${bank?.last4 || '4417'} to Books and opened Harbourline's Bridge accounts in pounds, dollars and euros, so customers pay into Bridge and the money lands in the Treasury as USDC. Bridge finished checking the company and Maya as its owner on ${fmt.date(M.verification?.approvedAt || '2025-05-14')}.`,
    result: 'The first £50,000 moved from Barclays into the Treasury that night.', route: 'bank' },
  { id: 'books', day: '2025-05-05', area: 'Books', icon: 'books', title: 'Chart of accounts and opening balances from Xero', by: ['maya'],
    fde: `Imported Xero's chart of accounts (${leafAccounts} accounts, each mapped to Capxul's), the trial balance at 30 April 2025 as opening balances, ${D.books.customers.length} customers, ${D.books.suppliers.length} suppliers and the open invoices, then checked every balance against Hollis & Reed's figures to the penny.`,
    result: 'Fiscal year 2025-2026 carried over; Capxul keeps the books from 1 May 2025.', route: 'chart-of-accounts' },
  { id: 'people', day: '2025-05-09', area: 'People', icon: 'hr', title: `${imported.length} employees imported`, by: ['isla'],
    fde: `Read the team spreadsheet and the old payroll's export into ${imported.length} employee records: roles, departments, managers, salaries, National Insurance numbers, bank details and this year's leave balances. Flagged two missing NI numbers for Isla to fill in.`,
    result: andList(imported.map((p) => cx.firstName(p.id))) + '.', route: 'employees' },
  { id: 'departments', day: '2025-05-12', area: 'Departments', icon: 'departments', title: 'Departments and budgets', by: ['maya'],
    fde: `Set up Harbourline and its ${D.departments.filter((d) => d.parent).length} departments (${andList(D.departments.filter((d) => d.parent).map((d) => d.name))}) with quarterly budgets in USDC, sized from last year's spend in Xero, and a hat for each so its holder spends it and decides its people's leave and claims.`,
    result: 'Priya Raman was invited the same day to wear the Design hat.', route: 'departments' },
  { id: 'payroll', day: '2025-05-20', area: 'Payroll', icon: 'payroll', title: 'Payroll and HMRC', by: ['isla', 'samw'],
    fde: 'Connected HMRC with Harbourline\'s PAYE reference for real-time information, carried over this tax year\'s pay, tax and NI from the old payroll, set up the UK Monthly salary structure and Nest pensions, and ran May beside the old payroll so every payslip could be checked line by line.',
    result: firstRun ? `First run ${firstRun.name}, paid ${fmt.date(firstRun.postingDate)}.` : '', route: firstRun ? 'payroll-run' : 'payroll', rid: firstRun?.name },
  { id: 'invites', day: '2025-06-02', area: 'People', icon: 'seats', title: 'People invited', by: ['maya', 'isla'],
    fde: 'Sent the seat invitations (Priya on 12 May, Kwame on 2 June, who took over Books) and opened My HR to everyone else without a seat: their payslips, leave and expenses, and money waiting for them.',
    result: 'Six seats in use by the end of June.', route: 'seats' },
  { id: 'crm', day: '2025-06-03', area: 'CRM', icon: 'crm', title: 'The CRM, imported from a spreadsheet', by: ['samw'],
    fde: 'Imported Sam\'s pipeline sheet: every company, contact, open lead and deal with its stage and owner. Connected the shared sales mailbox and WhatsApp number, so every message lands on its record\'s timeline without anyone copying it in.',
    result: `${D.crm.companies.length} companies and ${D.crm.contacts.length} contacts in the CRM today.`, route: 'crm' },
  { id: 'icp', day: '2025-06-10', area: 'CRM', icon: 'crm', title: 'The ideal customer profile, for lead generation', by: ['samw', 'maya'],
    fde: 'Wrote down who Harbourline sells to, from the deals won in the last two years: software, housing, health, retail and food-and-drink organisations of 11 to 500 people in the UK and the US, with a budget of £20,000 or more. The sales agent scores every inbound lead against it, with its reason, and routes it to an owner.',
    result: 'Every lead since shows its score, fit, budget, timing and need.', route: 'crm-sources' },
  { id: 'live', day: LIVE, area: 'Company', icon: 'check', title: 'Live: Xero switched off', by: ['maya', 'kwame'],
    fde: 'Checked June\'s month end with Kwame on Capxul alone (the bank reconciled, payroll paid, VAT on track) and switched Xero to read-only for the archive.',
    result: 'Setup signed off by Maya.', route: 'books' },
];
/** What was set up after going live. */
const LATER = [
  { day: '2025-07-01', area: 'Money', title: 'Allowances for software subscriptions and Capxul', by: ['kwame'], fde: 'Set up two monthly allowances so routine subscriptions are paid without a department\'s approval each time.', route: 'allowances' },
  { day: '2025-10-13', area: 'Money', title: 'A travel allowance for Delivery', by: ['grace'], fde: 'Set it up under Delivery, so client trips no longer wait for an expense claim.', route: 'allowances' },
  { day: '2026-01-12', area: 'People', title: 'The people agent turned on', by: ['isla', 'kwame'], fde: 'Loaded the handbook and the leave policy, and set the onboarding, right-to-work and probation checklists it runs.', route: 'hr' },
  { day: '2026-01-15', area: 'Bank', title: 'Fernhill moved to the Bridge details', by: ['kwame'], fde: 'Changed the bank details on Fernhill\'s invoices so its payments land in the Treasury and match themselves.', route: 'bank' },
  { day: '2026-02-01', area: 'Projects', title: 'The project agent turned on', by: ['isla'], fde: 'Connected calendars for timesheet suggestions and showed Isla how a won deal becomes a draft plan.', route: 'projects-home' },
  { day: '2026-08-20', area: 'Company', title: 'Ruth Calloway joined the Board', by: ['maya'], fde: 'Set up Ruth\'s passkey and walked her through approving Board proposals after the seed round.', route: 'board' },
  { day: '2026-11-01', area: 'Company', title: 'Ten more seats', by: ['kwame'], fde: 'Explained the seat price and who needs one; Kwame bought ten from the Capxul allowance.', route: 'seats' },
];

/* ---------- what Harbourline is not using yet, from its own records ---------- */

const ald = D.books.salesInvoices.filter((x) => x.customer === 'aldermoor' && /retainer/i.test(x.items?.[0]?.description || '') && x.postingDate >= '2026-01-01');
const aldBy = [...new Set(ald.map((x) => x.createdBy).filter(Boolean))];
const aldLate = ald.filter((x) => +x.postingDate.slice(8) > 1).length;
const nurture = D.crm.leads.filter((l) => l.status === 'Nurture');
const nurtureCold = nurture.filter((l) => daysBetween(l.modifiedAt, cx.today) > 180);
const tmProjects = D.projects.projects.filter((p) => p.status === 'Open' && p.billing === 'tm');
const bills6 = D.books.purchaseInvoices.filter((x) => x.postingDate >= addDays(cx.today, -183));
const contractors = [...new Set(D.books.purchaseInvoices.filter((x) => /Marta Kowalczyk|Studio Varga/.test(x.supplierName)).map((x) => x.supplierName))];
const holderOf = (hat) => D.people.find((p) => p.status === 'Active' && (p.hats || []).includes(hat))?.id;

const UNUSED = [
  { id: 'recurring', title: 'Recurring invoices', area: 'Books', icon: 'file', who: 'maya', hat: 'Invoicing',
    why: `Aldermoor's ${fmt.gbp(ald[0]?.netTotal || 4500, 0)} support retainer has been invoiced by hand ${ald.length} times this year, by ${andList(aldBy.map(cx.firstName)) || 'three people'}. ${aldLate ? `${aldLate} went out after the 1st.` : ''}`,
    save: [['Time', 'About 20 minutes a month'], ['And', 'It goes out on the 1st, every month']],
    how: 'A recurring invoice drafts Aldermoor\'s retainer on the 1st of each month from the last one. Whoever wears Invoicing checks it and sends it; nothing goes out on its own.',
    ask: 'How would recurring invoices work for the Aldermoor retainer?', route: 'project', rid: 'PROJ-0009',
    steps: ['Monthly on the 1st, from November\'s invoice', 'Drafted for Invoicing to check and send', 'Stops when the retainer ends'], result: 'Recurring invoice set up for the Aldermoor retainer: the next one is drafted on 1 December' },
  { id: 'sequences', title: 'Outreach sequences', area: 'CRM', icon: 'mail', who: 'samw', hat: 'People',
    why: `${nurture.length} leads sit in Nurture, ${nurtureCold.length} of them untouched for more than six months. Nobody owns keeping them warm.`,
    save: [['Time', 'About 2 hours a month for the sales team'], ['And', `${nurture.length} leads hear from Harbourline every six weeks`]],
    how: 'A sequence has the sales agent draft a short, personal note to each Nurture lead every six weeks, from the owner\'s mailbox. The owner approves the sequence once and can stop it on any lead; replies land on the timeline and stop it.',
    ask: 'How do outreach sequences work?', route: 'leads',
    steps: ['Every six weeks, three notes at most', 'Drafted from each lead\'s own history', 'Stops on a reply or a meeting'], result: `Outreach sequence turned on for ${nurture.length} Nurture leads` },
  { id: 'budgets', title: 'Project budgets', area: 'Projects', icon: 'projects', who: 'isla',
    why: `${tmProjects.map((p) => `${p.projectName} is at ${Math.round((p.totalCostingAmount / p.estimatedCost) * 100)}% of its ${fmt.gbp(p.estimatedCost, 0)} estimate`).join('; ')}. Neither has a budget, so nobody is warned before it runs over.`,
    save: [['Risk', 'Overruns seen at 80%, not at the invoice'], ['And', 'A budget line per phase on each project']],
    how: 'A project budget sets hours and money per phase. The project agent watches timesheets against it and tells the lead at 80%, with what is left and the forecast end.',
    ask: 'How do project budgets work?', route: 'projects-portfolio',
    steps: tmProjects.map((p) => `${p.projectName}: ${fmt.gbp(p.estimatedCost, 0)}, from its estimate`), result: `Budgets set on ${tmProjects.map((p) => p.projectName).join(' and ')}` },
  { id: 'bills', title: 'Bills by email', area: 'Books', icon: 'mail', who: 'kwame', hat: 'Books',
    why: `${bills6.length} supplier bills in the last six months were keyed in by hand from PDFs.`,
    save: [['Time', 'About 3 hours a month'], ['And', 'Every bill keeps its PDF']],
    how: 'Suppliers send bills to Harbourline\'s bills address. The books agent reads each into a draft bill with the PDF attached and the supplier, VAT and due date filled in. Books checks and posts it; paying stays with a person.',
    ask: 'How do bills by email work?', route: 'purchase-invoices',
    steps: ['A bills address for suppliers', 'Each bill drafted with its PDF', 'Books checks and posts it'], result: 'Bills by email turned on: suppliers can send to bills@harbourline.studio' },
  { id: 'agreements', title: 'Pay agreements for contractors', area: 'Money', icon: 'calendar', who: 'tom', hat: 'Engineering',
    why: `${andList(contractors) || 'Two contractors'} invoice every month and someone pays each by hand. Sofia Lindqvist already collects hers under a pay agreement.`,
    save: [['Time', 'Two payments a month fewer to prepare'], ['And', 'Paid on the day, within a cap']],
    how: 'A pay agreement lets a contractor collect a fixed amount each month from a department\'s budget, within a cap the hat holder signs once with a passkey. It shows as committed in the budget until it is collected.',
    ask: 'How do pay agreements work for contractors?', route: 'department', rid: 'engineering' },
];
const used = {};
const unusedOpen = () => UNUSED.filter((u) => !used[u.id]);

/* ---------- training ---------- */

const TRAINING = [
  { day: '2025-05-01', title: 'Capxul for the founder: hats, Safes and passkeys', who: ['maya', 'tom'], mins: 60, notes: 'Who wears which hat, what each may approve, how a passkey signs, and why the Reserve moves only by Board proposal.' },
  { day: '2025-05-21', title: 'Running payroll on Capxul', who: ['isla', 'samw'], mins: 45, notes: 'Creating the run, checking payslips, submitting, and how the Harbourline hat pays it in one approval. Starters, leavers and HMRC.' },
  { day: '2025-06-04', title: 'Books after Xero: invoices, bills and the bank feed', who: ['kwame', 'maya'], mins: 60, notes: 'Sales invoices with their RF reference, bills, matching the Barclays feed, and how Bridge deposits book themselves.' },
  { day: '2025-06-11', title: 'The CRM: pipeline, deals and the sales mailbox', who: ['samw', 'maya', 'isla'], mins: 45, notes: 'Leads, deals and stages; how the mailbox and WhatsApp land on the timeline; what the sales agent scores and why.' },
  { day: '2025-06-18', title: 'Approvals for everyone with a seat', who: ['maya', 'tom', 'isla', 'samw', 'priya', 'kwame'], mins: 30, notes: 'What waits for you, approving with a passkey, and saying no.' },
  { day: '2025-07-02', title: 'Allowances', who: ['kwame'], mins: 20, notes: 'Monthly allowances, who holds them and what they may pay without a department.' },
  { day: '2025-10-07', title: 'Wearing a department\'s hat', who: ['grace'], mins: 30, notes: 'Spending a budget, handing it down, and deciding leave and claims for the department.' },
  { day: '2026-01-14', title: 'The people agent: leave, onboarding and the handbook', who: ['isla', 'kwame', 'samw'], mins: 40, notes: 'What it checks against the policy, what it asks a person to decide, and the onboarding checklist.' },
  { day: '2026-02-04', title: 'The project agent: plans and timesheets', who: ['isla', 'priya', 'tom', 'grace'], mins: 45, notes: 'A plan from a won deal, accepting or changing it, and confirming timesheet rows from your calendar.' },
  { day: '2026-03-05', title: 'Books for Nadia', who: ['nadia', 'kwame'], mins: 60, notes: 'Bills, card spend and receipts, the bank feed and the month-end checklist.' },
  { day: '2026-08-25', title: 'The Board on Capxul', who: ['ruth', 'maya', 'tom'], mins: 30, notes: 'Board proposals, votes and the cap table after the seed round.' },
  { day: '2026-11-04', title: 'New seat holders: approvals, budgets and the assistant', who: ['ellis', 'ravi', 'lena', 'callum'], mins: 30, notes: 'What a seat lets you do, what waits for you, and what the agents propose for you to approve.' },
];
const UPCOMING = [
  { day: '2026-11-18', time: '14:00', title: 'Year-end and the VAT return', who: ['kwame', 'nadia', 'maya'], mins: 45, notes: 'The VAT return the books agent drafts each quarter, checking and filing it, and closing the year in March.' },
  { day: '2026-11-24', time: '10:00', title: 'Outreach sequences for the sales team', who: ['samw', 'leo', 'zara'], mins: 30, notes: 'If the sequence is turned on: what the sales agent drafts, approving it, and stopping it on a lead.' },
];
const joined = {};

/* ---------- conversations: mostly setup and how-to ---------- */

const T = (role, text, at, extra = {}) => ({ role, text, at, ...extra });
const CONVOS = [
  { id: 'fc-0501-maya', asker: 'maya', at: '2025-05-01T08:40:00Z', screen: 'Home', topic: 'Setup', turns: [
    T('user', 'Where do we start?', '2025-05-01T08:40:00Z'),
    T('fde', 'With the hats and the money, then the books, then people. Today: who wears which hat, your two Safes, and connecting Barclays and Bridge. This week: the chart of accounts and opening balances from Xero, and the team from your spreadsheet. Payroll and HMRC before May\'s run on the 30th. The CRM and invitations in early June. I\'ll keep the list on the Setup page and tick each step off with you.', '2025-05-01T08:40:20Z', { looked: ['Xero: 18 months of invoices and bills', 'The team sheet: 14 people'], links: [['Setup', 'fde']] }),
  ] },
  { id: 'fc-0505-maya', asker: 'maya', at: '2025-05-05T09:15:00Z', screen: 'Books › Chart of accounts', topic: 'Setup', turns: [
    T('user', 'Can we bring our accounts across from Xero?', '2025-05-05T09:15:00Z'),
    T('fde', `Yes. I've read Xero's chart of accounts and mapped each account to Capxul's: ${leafAccounts} in all, with the Treasury and the Reserve Safe as two USDC accounts beside Barclays. The opening balances are Xero's trial balance at 30 April, and the open invoices and bills come across as they are. Hollis & Reed's figures agree to the penny. Have a look before I post the opening entry.`, '2025-05-05T09:15:30Z', { looked: ['Xero trial balance at 30 April 2025', `${D.books.customers.length} customers and ${D.books.suppliers.length} suppliers`], links: [['Chart of accounts', 'chart-of-accounts']] }),
    T('user', 'Looks right. Post it.', '2025-05-05T09:40:00Z'),
    T('fde', 'Posted. Capxul keeps the books from 1 May; Xero stays readable for the archive.', '2025-05-05T09:40:10Z'),
  ] },
  { id: 'fc-0509-isla', asker: 'isla', at: '2025-05-09T10:05:00Z', screen: 'HR › Employees', topic: 'Setup', turns: [
    T('user', 'How do I bring the team in from our spreadsheet?', '2025-05-09T10:05:00Z'),
    T('fde', `Send me the sheet and the old payroll's export and I'll match them: ${imported.length} people, with roles, managers, salaries, NI numbers, bank details and leave taken this year. Two NI numbers are missing (Chloe's and Oliver's); fill those in and I'll create the records.`, '2025-05-09T10:05:30Z', { looked: [`Team sheet: ${imported.length} rows`, 'Old payroll export: April 2025'], links: [['Employees', 'employees']] }),
  ] },
  { id: 'fc-0520-samw', asker: 'samw', at: '2025-05-20T13:30:00Z', screen: 'Payroll', topic: 'Setup', turns: [
    T('user', 'What do we need from HMRC to run May\'s payroll here?', '2025-05-20T13:30:00Z'),
    T('fde', 'Your PAYE reference and Accounts Office reference (both on the old payroll\'s P32), and HMRC\'s permission for Capxul to send your RTI returns, which Maya grants in the HMRC portal. I\'ll carry this tax year\'s pay, tax and NI across so May\'s payslips are right, and we run May beside the old payroll once to compare every line.', '2025-05-20T13:30:30Z', { links: [['Payroll', 'payroll']] }),
  ] },
  { id: 'fc-0603-samw', asker: 'samw', at: '2025-06-03T11:10:00Z', screen: 'CRM', topic: 'Setup', turns: [
    T('user', 'Can you bring in our pipeline sheet?', '2025-06-03T11:10:00Z'),
    T('fde', 'Done: each row is now a lead or a deal with its stage and owner, and each company and contact has its own record. I\'ve connected hello@ and the WhatsApp number, so from today every message lands on the right record\'s timeline. Next week let\'s write down your ideal customer, so the sales agent can score what comes in.', '2025-06-03T11:10:30Z', { looked: ['Pipeline sheet: companies, contacts, stages and owners'], links: [['CRM', 'crm']] }),
  ] },
  { id: 'fc-0604-kwame', asker: 'kwame', at: '2025-06-04T15:20:00Z', screen: 'Books › Banking', topic: 'How-to', turns: [
    T('user', 'How does the Barclays feed match to invoices?', '2025-06-04T15:20:00Z'),
    T('fde', 'Each invoice carries an RF reference. When a customer pays with it, the line matches itself; when they don\'t, the books agent suggests the likeliest invoice and you confirm. Payments into Bridge are better still: they land in the Treasury as USDC and are booked against the invoice with nobody keying anything.', '2025-06-04T15:20:30Z', { links: [['Bank accounts', 'bank-accounts'], ['Bridge deposits', 'bank']] }),
  ] },
  { id: 'fc-0610-samw', asker: 'samw', at: '2025-06-10T09:50:00Z', screen: 'CRM › Leads', topic: 'Setup', turns: [
    T('user', 'Which leads should the sales agent go after?', '2025-06-10T09:50:00Z'),
    T('fde', 'From the deals you\'ve won: software, housing, health, retail and food-and-drink organisations of 11 to 500 people in the UK and the US, with £20,000 or more to spend. That\'s your ideal customer. The agent scores every inbound lead on fit, budget, timing and need against it, says why, and routes it to whoever is next for that kind of enquiry. It never writes to anyone without the owner approving.', '2025-06-10T09:50:30Z', { links: [['Leads', 'leads']] }),
  ] },
  { id: 'fc-0701-kwame', asker: 'kwame', at: '2025-07-01T09:30:00Z', screen: 'Money › Allowances', topic: 'Setup', turns: [
    T('user', 'How do I set up an allowance for our software subscriptions?', '2025-07-01T09:30:00Z'),
    T('fde', 'Under Allowances, a new monthly allowance from Harbourline\'s budget, with a cap and who holds it. Maya signs it once, because it comes out of the Harbourline hat. After that the holder pays the subscriptions from it without asking each time, and it refills on the 1st.', '2025-07-01T09:30:30Z', { links: [['Allowances', 'allowances']] }),
  ] },
  { id: 'fc-1006-grace', asker: 'grace', at: '2025-10-06T10:20:00Z', screen: 'Departments › Delivery', topic: 'How-to', turns: [
    T('user', 'I wear the Delivery hat now. What can I approve?', '2025-10-06T10:20:00Z'),
    T('fde', 'Payments from Delivery\'s budget, your team\'s leave and expense claims, and handing part of the budget down to a team or an allowance. You can\'t change Delivery\'s own budget: that\'s for Harbourline above you, or the Board. Anything waiting for you shows under Approvals.', '2025-10-06T10:20:30Z', { links: [['Delivery', 'department', 'delivery'], ['Approvals', 'approvals']] }),
  ] },
  { id: 'fc-0204-tom', asker: 'tom', at: '2026-02-04T16:00:00Z', screen: 'Projects › Timesheets', topic: 'How-to', turns: [
    T('user', 'How does the project agent fill in timesheets?', '2026-02-04T16:00:00Z'),
    T('fde', 'From your calendar: a meeting or focus block that names a project or task becomes a suggested row. You confirm the rows you agree with; nothing is submitted until you submit the week. People without a seat have their time kept by Isla.', '2026-02-04T16:00:30Z', { links: [['Timesheets', 'timesheets']] }),
  ] },
  { id: 'fc-0305-nadia', asker: 'nadia', at: '2026-03-05T11:00:00Z', screen: 'Books › Purchase invoices', topic: 'How-to', turns: [
    T('user', 'How do I record a bill we paid by card?', '2026-03-05T11:00:00Z'),
    T('fde', 'Enter the bill as usual, then record the payment against it from the card account. When the card statement comes in, the books agent matches the line to it. Attach the receipt to the bill; it stays with it.', '2026-03-05T11:00:30Z', { links: [['Purchase invoices', 'purchase-invoices']] }),
  ] },
  { id: 'fc-0821-ruth', asker: 'ruth', at: '2026-08-21T17:10:00Z', screen: 'Board', topic: 'How-to', turns: [
    T('user', 'How do I approve a Board proposal?', '2026-08-21T17:10:00Z'),
    T('fde', 'Open it from Approvals or the Board page, read what it does, and approve with your passkey. It needs two of the three Directors. If you disagree, say so on the proposal and don\'t approve; it never moves without two of you.', '2026-08-21T17:10:30Z', { links: [['Proposals', 'proposals']] }),
  ] },
  { id: 'fc-1014-hannah', asker: 'hannah', at: '2026-10-14T12:20:00Z', screen: 'Me', topic: 'How-to', turns: [
    T('user', 'How do I set up my account so my pay lands?', '2026-10-14T12:20:00Z'),
    T('fde', 'Open the email Capxul sent to hannah.cole@gmail.com and set up your account with a passkey on your phone. Your pay goes to your own Safe; if it is paid before you do, it waits for you in money waiting and you claim it once your account is set up. Nothing expires.', '2026-10-14T12:20:30Z', { links: [['Your payslips', 'me-payslips']] }),
  ] },
  { id: 'fc-1030-kwame', asker: 'kwame', at: '2026-10-30T14:05:00Z', screen: 'Company › Seats', topic: 'How-to', turns: [
    T('user', 'Four more people need seats next week. How do we add them?', '2026-10-30T14:05:00Z'),
    T('fde', `All ${D.seats.history?.[0]?.limit ?? 10} seats are in use, so buy more first: ${D.seats.price?.toFixed?.(2) ?? '10.00'} USDC a seat, once, from a budget you hold. You wear People and hold the Capxul allowance, so it's yours to do from Seats. Then invite each person by email; their seat is held until they accept. People paid by Harbourline don't need a seat to see their own payslips and leave.`, '2026-10-30T14:05:30Z', { links: [['Seats', 'seats']] }),
  ] },
  { id: 'fc-1102-maya', asker: 'maya', at: '2026-11-02T08:15:40Z', screen: 'Home', topic: 'Getting more', turns: [
    T('user', 'What are we not using yet?', '2026-11-02T08:15:40Z'),
    T('fde', `${UNUSED.length} things would save you time: ${UNUSED.map((u) => u.title.toLowerCase()).join(', ')}. The quickest win is recurring invoices for Aldermoor's retainer, which has been typed by hand every month this year. I've put each one on the Not used yet page with what it would save, and asked the person who'd turn it on.`, '2026-11-02T08:16:00Z', { links: [['Not used yet', 'fde-unused']] }),
  ] },
  { id: 'fc-1103-ellis', asker: 'ellis', at: '2026-11-03T09:45:00Z', screen: 'Home', topic: 'How-to', turns: [
    T('user', 'I have a seat now. What does that let me do?', '2026-11-03T09:45:00Z'),
    T('fde', 'You can see the company: departments, projects, the CRM and the books, read-only unless a hat lets you change something. You wear no hat yet, so you approve nothing; your own payslips, leave and expenses work as before. The assistant shows what the agents propose for you, such as the timesheet rows from your calendar. Join tomorrow\'s 30-minute session for new seat holders.', '2026-11-03T09:46:00Z', { links: [['Training', 'fde-training']] }),
  ] },
  { id: 'fc-1105-samh', asker: 'samh', at: '2026-11-05T14:12:09Z', screen: '(his own Capxul)', topic: 'Guest', guest: true, turns: [
    T('user', 'Can I have Harbourline\'s VAT summary for Q2?', '2026-11-05T14:12:09Z'),
    T('fde', 'As a guest you can ask about Hollis & Reed\'s own dealings with Harbourline: your invoices to them and their payments. The VAT return needs the Books hat; Kwame Mensah wears it and can share it with you.', '2026-11-05T14:12:30Z') ] },
  { id: 'fc-1109-maya', asker: 'maya', at: '2026-11-09T09:02:11Z', screen: 'Departments › Engineering', topic: 'Reading a report', turns: [
    T('user', 'Why is Engineering already at 44% of its budget this quarter?', '2026-11-09T09:02:11Z'),
    T('fde', 'Mostly the two contractors (Sofia Lindqvist under her pay agreement, and Marta Kowalczyk by invoice) and Kestrel Cloud. Sofia\'s December collection is counted as committed, because it is already promised. At this pace Engineering ends the quarter with room to spare; the January hires need Harbourline\'s budget raised first.', '2026-11-09T09:02:23Z', { links: [['Engineering', 'department', 'engineering']] }) ] },
];

/** Topics across every ask since May 2025: counts only, never what was asked. */
const TOPICS = (() => {
  const total = F.asksByMonth.reduce((s, a) => s + a.count, 0);
  const share = [['Setting up and changing setup', 0.34], ['How do I…', 0.31], ['Finding something', 0.16], ['Reading a report', 0.12], ['Their own pay and leave', 0.07]];
  return share.map(([label, x]) => ({ label, value: Math.round(total * x) }));
})();

/* =====================================================================================================
   The FDE's brain: setup and how-to, answered over the real figures, within the asker's hats
   ===================================================================================================== */

const findDept = (q) => [...D.departments, ...D.allowances].find((d) => q.includes(d.name.toLowerCase()) || q.includes(d.id));
const hatsLine = (me) => (me.hats?.length ? me.hats.join(', ') : 'no hats');
const people = (id) => cx.holders(id).filter((x) => !String(x).startsWith('@'));
const holdersLine = (id) => andList(people(id).map(cx.name)) || 'nobody';
const nameIn = (q) => D.people.find((p) => q.includes(p.name.toLowerCase())) || D.people.find((p) => new RegExp(`\\b${p.firstName.toLowerCase()}('s)?\\b`).test(q));
function myEmployee(me) { return me.employee || D.people.find((p) => p.id === me.id)?.employee; }
function quarterPayees(deptId) {
  const b = cx.budgetOn(deptId);
  const by = new Map();
  for (const p of M.payments) if (p.budget === deptId && p.direction === 'out' && p.status !== 'Cancelled' && p.status !== 'Prepared' && String(p.settledAt) >= b.from) by.set(p.counterparty, (by.get(p.counterparty) || 0) + p.amount);
  return [...by.entries()].sort((a, b2) => b2[1] - a[1]);
}
const L = (label, route, id) => ({ label, route, id });
const seen = (...xs) => xs.filter(Boolean).map((result) => ({ result }));
const feature = (id) => UNUSED.find((u) => u.id === id);
const lc1 = (t) => (t ? t[0].toLowerCase() + t.slice(1) : t);
/** A setup step told by the FDE in the first person: "In May 2025 I imported …". */
const iDid = (st) => `In ${fmt.month(st.day.slice(0, 7)).replace(/^(\w+) (\d+)$/, (m, a, y) => ({ Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' }[a] || a) + ' ' + y)} I ${lc1(st.fde)}`;
const doneSteps = () => SETUP.filter((s) => s.day <= cx.today).length;

/** A setup proposal from the FDE for the person who would turn the feature on (the same item as on the Not used yet page). */
function featureDraft(u) {
  return { key: `fde-unused-${u.id}`, for: u.who, by: FDE_HANDLE, at: '2026-11-02T08:20:00Z', title: `Turn on ${u.title.toLowerCase()}`, why: u.why, steps: u.steps, needs: u.hat && u.id !== 'agreements' ? u.hat : undefined,
    runLabel: 'Turn it on', result: u.result, route: u.route, id: u.rid, onRun: () => turnOn(u) };
}
function turnOn(u) {
  used[u.id] = { by: cx.meId(), at: cx.now.toISOString() };
  cx.toast(`${u.result}.`, { tone: 'success' });
  cx.refresh();
}

const intents = [
  // what we are not using yet
  { test: (q) => /not using|not used|don.t use|get (the )?most|what else|unused|could we use/.test(q), run: (q, me) => {
    const open = unusedOpen();
    if (!open.length) return { text: 'You are using everything I would suggest for a studio of your size. I check again on the 1st of each month.', links: [L('Not used yet', 'fde-unused')] };
    const top = open[0];
    return { text: `${open.length} things would save you time: ${open.map((u) => `${u.title.toLowerCase()} (${u.save[0][1].toLowerCase()})`).join('; ')}. Start with ${top.title.toLowerCase()}: ${top.why} I've asked the person who'd turn each one on; they're in the assistant for them.`,
      lookedAt: seen(`${ald.length} Aldermoor retainer invoices typed by hand this year`, `${nurture.length} leads in Nurture`, `${bills6.length} bills keyed in over six months`),
      links: [L('Not used yet', 'fde-unused')] };
  } },
  // setup progress
  { test: (q) => /setup|set up|onboarding|how far|go.?live|getting started|where do (we|i) start/.test(q) && !/recurring|sequence|budget|bill|agreement|allowance|safe so|my pay|payroll|hmrc|pension|xero|import|bank|bridge|crm|lead|seat|invite/.test(q), run: () => ({
    text: `Harbourline's setup is complete: ${doneSteps()} of ${SETUP.length} steps, from the hats and Safes on 1 May 2025 to switching Xero off on ${fmt.date(LIVE)}. Since then you've added ${LATER.length} more, most recently ${LATER.at(-1).title.toLowerCase()} on ${fmt.date(LATER.at(-1).day)}. What's left is optional: ${unusedOpen().length} features you aren't using yet.`,
    lookedAt: seen(`${SETUP.length} setup steps, every one signed off`, `${unusedOpen().length} features not used yet`),
    links: [L('Setup', 'fde'), L('Not used yet', 'fde-unused')] }) },
  // approvals
  { test: (q) => /how (do )?approvals? work|approve with|passkey|how do i approve/.test(q), run: (q, me) => ({
    text: `Anything that moves money or changes who may do what waits for the person whose hat covers it, and they approve it with their passkey. A payment from Engineering waits for whoever wears Engineering (or Harbourline above it); a Board proposal needs ${D.board.threshold || 2} of the ${D.board.directors.length} Directors. You wear ${hatsLine(me)}, so ${(me.hats || []).length ? 'what those hats cover comes to you under Approvals' : 'nothing waits for your approval yet'}. What the agents propose for you is in the assistant, and nothing happens until you approve it.`,
    links: [L('Approvals', 'approvals')] }) },
  // Xero, imports
  { test: (q) => /xero|import|opening balance|bring .* (across|over|in)|spreadsheet|migrat/.test(q), run: () => {
    const s = SETUP.find((x) => x.id === 'books');
    return { text: `${iDid(s)} To bring in more history, such as older invoices for reports, send me Xero's export and I'll add them as closed records.`, lookedAt: seen(`${leafAccounts} accounts`, 'Opening balances at 30 April 2025'), links: [L('Chart of accounts', 'chart-of-accounts'), L('Setup', 'fde')] };
  } },
  // bank and Bridge
  { test: (q) => /bridge|barclays|connect .*bank|bank feed|how do customers pay|get paid by bank/.test(q), run: () => ({
    text: `Barclays ·· ${bank?.last4 || '4417'} feeds Books and is reconciled there; Capxul doesn't move money in it. Customers pay Harbourline's Bridge details (in pounds, dollars or euros) with the invoice's RF reference: the money lands in the Treasury as USDC and is matched to the invoice automatically. ${D.money.deposits.length} deposits have come in that way since May 2025.`,
    lookedAt: seen(`${D.money.deposits.length} Bridge deposits`, `Barclays: ${bank?.reconciled ?? 0} lines reconciled, ${bank?.toReconcile ?? 0} to do`),
    links: [L('Bridge deposits', 'bank'), L('Bank accounts', 'bank-accounts')] }) },
  // payroll setup
  { test: (q) => /payroll|hmrc|paye|pension|nest|rti/.test(q), run: (q, me) => {
    const last = D.payroll.runs.filter((r) => r.status === 'Paid').at(-1);
    return { text: `Payroll is set up with HMRC for real-time information, Nest pensions, and the UK Monthly salary structure. Each month someone who wears People (${D.people.filter((p) => (p.hats || []).includes('People')).map((p) => cx.firstName(p.id)).join(', ')}) creates the run and checks the payslips, and whoever wears the Harbourline hat pays it in one approval. The people agent collects the month's changes (starters, leavers, pay rises, unpaid leave) for People to review before the run. ${last ? `The last run, ${last.name}, was paid on ${fmt.date(last.postingDate)}.` : ''}`,
      links: [L('Payroll', 'payroll'), L('Payroll changes', 'payroll-changes')] };
  } },
  // seats and invitations
  { test: (q) => /seat|invite|invitation/.test(q), run: (q, me) => {
    const S = D.seats;
    const usedN = S.members.filter((m) => m.kind === 'Person' && m.status === 'Active').length;
    const held = (S.invitations || []).filter((i) => i.status === 'Pending').length;
    if (!cx.hasSeat()) return { text: `A seat lets you see the company and act with a hat. You don't need one for your own payslips, leave and expenses. Ask someone who wears People (${D.people.filter((p) => (p.hats || []).includes('People')).map((p) => p.name).join(', ')}) to invite you.` };
    return { text: `${usedN} of ${S.limit} seats are in use and ${held} ${held === 1 ? 'is' : 'are'} held for invitations. A seat costs ${(S.price || 10).toFixed(2)} USDC, once. Someone who wears People invites people from Seats; their seat is held until they accept. People paid by Harbourline don't need one for their own records.`,
      lookedAt: seen(`${usedN} of ${S.limit} seats in use`), links: [L('Seats', 'seats')] };
  } },
  // the agents and the assistant
  { test: (q) => /agent|assistant|automat/.test(q), run: (q, me) => ({
    text: `The agents do routine work, and people decide. The sales agent qualifies inbound leads with a score and its reason, routes them, logs every email, WhatsApp, call and meeting on the timeline, and drafts follow-ups for the owner to approve. The people agent runs onboarding checklists, right-to-work checks, leave against the policy and balances, and collects payroll changes. The project agent drafts plans from won deals and suggests timesheet rows from calendars. The books agent matches bank lines and drafts the VAT return. Nobody's agent pays a bill or runs payroll. What they did and propose for you is in the assistant: ${cx.agentWork.count(me.id)} ${cx.agentWork.count(me.id) === 1 ? 'thing waits' : 'things wait'} for you now.`,
    links: [] }) },
  // CRM, leads, ideal customer
  { test: (q) => /lead|crm|ideal customer|pipeline|sales/.test(q) && !/sequence/.test(q), run: () => {
    const s = SETUP.find((x) => x.id === 'icp');
    return { text: `${iDid(s)} Leads come from the website form, email and WhatsApp; each record shows how it arrived, its score and why.`, links: [L('Leads', 'leads'), L('Where leads come from', 'crm-sources')] };
  } },
  // training
  { test: (q) => /training|session|learn|walkthrough|teach/.test(q), run: (q, me) => {
    const next = UPCOMING.find((s) => s.day >= cx.today);
    const mine = TRAINING.filter((s) => s.who.includes(me.id));
    return { text: `${TRAINING.length} sessions so far${mine.length ? `; you were at ${mine.length}, most recently "${mine.at(-1).title}" on ${fmt.date(mine.at(-1).day)}` : ''}. ${next ? `Next: "${next.title}" on ${fmt.date(next.day)} at ${next.time}, for ${andList(next.who.map(cx.firstName))}.` : ''} Ask me for a session on anything you use.`, links: [L('Training', 'fde-training')] };
  } },
  // the features not used yet, one by one
  { test: (q) => /recurring/.test(q), run: (q, me) => featureAnswer(feature('recurring'), me) },
  { test: (q) => /sequence|outreach|nurture/.test(q), run: (q, me) => featureAnswer(feature('sequences'), me) },
  { test: (q) => /project budget|budget.*project|budgets work/.test(q), run: (q, me) => featureAnswer(feature('budgets'), me) },
  { test: (q) => /bills? by email|bills address|key(ed)? in/.test(q), run: (q, me) => featureAnswer(feature('bills'), me) },
  { test: (q) => /pay agreement|contractor/.test(q), run: (q, me) => featureAnswer(feature('agreements'), me) },
  // payments: people pay; the FDE explains how
  { test: (q) => /\bpay\b|payment|rent|draft a payment/.test(q) && !/payslip|my pay|pay agreement|payroll/.test(q), run: (q, me) => {
    const mine = N().payableBudgets?.() || [];
    return { text: `I don't prepare payments: paying is a person's job, from a budget whose hat they wear. ${mine.length ? `You can pay from ${andList(mine.map(cx.deptName))}: Money › Send money, choose the budget, the payee and the amount, then approve with your passkey.` : `You wear ${hatsLine(me)}, so you can't pay from a budget. Whoever wears the paying department's hat can: ${D.departments.filter((d) => d.parent).map((d) => `${d.name}, ${holdersLine(d.id)}`).join('; ')}.`} Bills are paid the same way, from their purchase invoice.`,
      links: [mine.length ? L('Send money', 'send-money') : L('Departments', 'departments')] };
  } },
  // a department's budget
  { test: (q, ctx) => (/budget|spent|spend|%|percent/.test(q) && (findDept(q) || /department/.test(ctx || ''))), run: (q, me, ctx) => {
    if (!cx.hasSeat()) return noSeat(me);
    const d = findDept(q) || findDept(String(ctx).toLowerCase());
    if (!d) return null;
    if (D.allowances.includes(d)) {
      const m = d.months.at(-1);
      return { text: `The ${d.name} allowance is ${fmt.usdc(d.monthly)} a month, held by ${holdersLine(d.id)}. This month ${fmt.usdc(m.spent)} is spent and ${fmt.usdc(m.left)} is left; it refills on the 1st.`, links: [L(`Open ${d.name}`, 'allowance', d.id)] };
    }
    const b = cx.budgetOn(d.id);
    const top = quarterPayees(d.id).slice(0, 3);
    const days = daysBetween(b.from, cx.today) + 1, all = daysBetween(b.from, b.to) + 1;
    const pace = b.amount - (b.spent / days) * all - (b.committed || 0) - (b.teamsAndAllowances || 0);
    const ag = (D.payroll.agreements || []).find((a) => a.budget === d.id);
    return { text: `${d.name} has spent ${fmt.num(b.spent, 2)} and committed ${fmt.num(b.committed || 0, 2)} of its ${fmt.usdc(b.amount)} for ${fmt.date(b.from)} to ${fmt.date(b.to)}${b.teamsAndAllowances ? `, and handed ${fmt.num(b.teamsAndAllowances, 2)} down to teams and allowances` : ''}. ${top.length ? `Most of it is ${top.map(([n, v]) => `${n} (${fmt.num(v, 2)})`).join(', ')}.` : ''} ${ag ? `The committed part is ${cx.name(ag.payee)}'s next collection under the pay agreement: it is already promised, so it counts.` : ''} At this pace ${d.name} ends the quarter with about ${fmt.num(Math.max(0, pace), 2)} USDC left. ${holdersLine(d.id)} ${people(d.id).length > 1 ? 'wear' : 'wears'} its hat.`,
      lookedAt: seen(`${d.name}: ${fmt.usdc(b.amount)} this quarter, ${fmt.num(b.left, 2)} left`), links: [L(`Open ${d.name}`, 'department', d.id)] };
  } },
  // who wears a hat
  { test: (q) => /who (wears|holds|can)|\bhats?\b/.test(q), run: (q) => {
    const d = findDept(q);
    if (d) return { text: `${holdersLine(d.id)} ${people(d.id).length > 1 ? 'wear' : 'wears'} the ${cx.deptName(d.id)} hat now.${d.parent ? ` Above it, ${holdersLine(d.parent)} wears ${cx.deptName(d.parent)} and can act for it too.` : ''} The Board can act for any of them by proposal.`, links: [L(`Open ${d.name}`, 'department', d.id)] };
    const off = ['People', 'Books', 'Invoicing'].find((x) => q.includes(x.toLowerCase()));
    if (off) return { text: `${D.people.filter((p) => (p.hats || []).includes(off)).map((p) => p.name).join(', ')} wear the ${off} hat. Officer hats carry no money; the Board grants them.`, links: [L('Board', 'board')] };
    return { text: `Departments and their holders now: ${D.departments.map((x) => `${x.name}: ${holdersLine(x.id)}`).join('; ')}.`, links: [L('Departments', 'departments')] };
  } },
  // what waits for me
  { test: (q) => /waiting for me|what.*(should i do|do first)|my approvals|waits for me/.test(q), run: (q, me) => {
    const mine = (D.approvals.waiting || []).filter((a) => (a.waitsFor || []).includes(me.id));
    const props = cx.agentWork.count(me.id);
    const order = [...mine].sort((a, b) => (a.kind === 'Money' ? -1 : 0) - (b.kind === 'Money' ? -1 : 0) || String(a.openedAt).localeCompare(String(b.openedAt)));
    return { text: `${mine.length ? `${fmt.plural(mine.length, 'approval')} ${mine.length === 1 ? 'waits' : 'wait'} for you. The oldest money first: ${order[0].what}, from ${cx.name(order[0].openedBy)} ${fmt.agoLong(order[0].openedAt)}.` : 'No approval waits for you.'} ${props ? `The agents have ${fmt.plural(props, 'proposal')} for you in the assistant's For you tab.` : ''}`,
      links: [L('Approvals', 'approvals')] };
  } },
  // an employee
  { test: (q) => /what should i know about|tell me about|who is/.test(q) && !!nameIn(q), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const p = nameIn(q);
    const leaves = D.hr.leaveApplications.filter((l) => l.employee === p.id && l.toDate >= cx.today && ['Open', 'Approved'].includes(l.status));
    const claims = D.hr.expenseClaims.filter((c) => c.employee === p.id && c.status === 'Open');
    return { text: `${p.name} is a ${p.designation} in ${cx.deptName(p.department)}, since ${fmt.date(p.dateOfJoining)}${p.reportsTo ? `, reporting to ${cx.name(p.reportsTo)}` : ''}. ${p.hats?.length ? `Wears ${p.hats.join(', ')}.` : 'Wears no hat.'} ${cx.hasSeat(p.id) ? 'Has a seat.' : 'Has no seat.'} ${leaves.length ? `Leave coming up: ${leaves.map((l) => `${fmt.day(l.fromDate)} to ${fmt.day(l.toDate)} (${l.status.toLowerCase()})`).join(', ')}.` : 'No leave booked ahead.'} ${claims.length ? `${fmt.plural(claims.length, 'expense claim')} open.` : ''}`,
      links: [L(`Open ${p.name}`, 'employee', p.employee)] };
  } },
  // my payslip, leave and money waiting
  { test: (q) => /leave|holiday|payslip|my pay|next pay|salary|money waiting|claim my|my safe|pay lands/.test(q), run: (q, me) => {
    const emp = myEmployee(me);
    const slips = D.payroll.slips.filter((s) => s.employee === me.id || s.employee === emp).sort((a, b) => a.postingDate.localeCompare(b.postingDate));
    const last = slips.at(-1);
    const allocs = D.hr.leaveAllocations.filter((a) => (a.employee === me.id || a.employee === emp) && a.toDate >= cx.today && a.fromDate <= cx.today);
    const taken = (lt) => D.hr.leaveApplications.filter((a) => (a.employee === me.id || a.employee === emp) && a.leaveType === lt && a.status === 'Approved' && a.fromDate.slice(0, 4) === cx.today.slice(0, 4)).reduce((s, a) => s + a.totalLeaveDays, 0);
    const parts = [];
    if (/payslip|pay|salary/.test(q) && last) parts.push(`Your last payslip, ${last.name}, was ${fmt.money(last.netPay, last.currency)} net, paid ${fmt.date(last.postingDate)}. ${last.salaryStructure === 'Pay agreement' ? 'Your pay agreement collects on the 2nd of each month.' : 'The next one is paid on Monday 30 November.'}`);
    if (/leave|holiday/.test(q)) parts.push(allocs.length ? `Leave left this year: ${allocs.map((a) => `${a.leaveType} ${fmt.num(a.totalLeavesAllocated - taken(a.leaveType), 1)} of ${fmt.num(a.totalLeavesAllocated, 1)}`).join(', ')}. To book some, open My leave and press New: the people agent checks it against your balance and the calendar, and your manager decides.` : 'You have no leave allocated this year.');
    if (/money waiting|claim|safe|lands/.test(q)) { const w = M.escrows.filter((e) => e.status === 'Open' && [me.email, me.personalEmail, me.companyEmail].includes(e.email)); parts.push(w.length ? `${fmt.usdc(w[0].amount)} waits for you; set up your account from Capxul's email and claim it.` : 'Nothing waits for you to claim. Pay goes straight to your Safe once your account is set up.'); }
    return { text: parts.join(' ') || 'I found nothing for you yet.', links: [has('me-payslips') ? L('Your payslips', 'me-payslips') : null, has('me-leave') ? L('Your leave', 'me-leave') : null].filter(Boolean) };
  } },
  // timesheets
  { test: (q) => /timesheet|log (my )?time|hours/.test(q), run: () => ({
    text: 'Your timesheet fills from your calendar: a meeting or focus block that names a project or task becomes a suggested row, and you confirm the ones you agree with. Add anything else by hand and submit the week on Friday. People without a seat have their time kept by Isla.', links: [L('Timesheets', 'timesheets')] }) },
  // VAT
  { test: (q) => /vat/.test(q), run: (q, me) => ({
    text: `The books agent drafts the VAT return at each quarter end from the books, with every figure traced to its invoices. ${cx.wears('Books') ? 'You wear Books, so you check it and file it with HMRC.' : `Someone who wears Books (${D.people.filter((p) => (p.hats || []).includes('Books')).map((p) => p.name).join(', ')}) checks it and files it.`} Nothing is filed on its own.`, links: [L('VAT returns', 'vat-returns')] }) },
  // runway
  { test: (q) => /runway|how long.*(money|cash)|burn/.test(q), run: (q, me) => {
    if (!cx.hasSeat()) return noSeat(me);
    const T2 = M.safes.treasury, R = M.safes.reserve;
    return { text: `Cash is ${fmt.usdc(T2.balance + R.balance)} across the two Safes plus ${fmt.gbp(bank?.balance || 0)} in Barclays. The cash flow report shows what came in and went out each month; the Reserve Safe only moves to the Treasury by Board proposal.`, links: [L('Cash flow', 'cash-flow'), L('Treasury', 'treasury')] };
  } },
];
function featureAnswer(u, me) {
  if (!u) return null;
  const d = !used[u.id] && u.id !== 'agreements' ? featureDraft(u) : null;
  const who = cx.name(u.who);
  return { text: `${u.how} For Harbourline: ${u.why} It would save ${u.save[0][1].toLowerCase()}. ${used[u.id] ? `${cx.name(used[u.id].by)} turned it on ${fmt.agoLong(used[u.id].at)}.` : d ? (me.id === u.who ? 'It\'s yours to turn on; I\'ve put it in your assistant.' : `${who}${u.hat ? `, who wears ${u.hat},` : ''} would turn it on; it waits in their assistant.`) : `${who}${u.hat ? `, who wears ${u.hat},` : ''} would set it up from the department, with their passkey.`}`,
    draft: d, links: [L('Not used yet', 'fde-unused')] };
}
function noSeat(me) {
  return { text: `You have no seat at Harbourline, so I can help with your own records: your payslips, your leave, your expenses, and setting up your account so your pay lands. Ask me about those.` };
}
async function answer(question, { context, me } = {}) {
  await sleep(450);
  const q = String(question).toLowerCase();
  me = me || cx.me();
  for (const it of intents) {
    if (!it.test(q, String(context || '').toLowerCase())) continue;
    const r = it.run(q, me, context);
    if (r) { recordAsk(); return r; }
  }
  recordAsk();
  return { text: `I set Capxul up with Harbourline and help you get more from it. Ask me how something works, how to set something up, what you're not using yet, or about training. I act only with your permissions (${hatsLine(me)}).`, links: [L('Setup', 'fde'), L('Not used yet', 'fde-unused')] };
}
function recordAsk() {
  const at = stamp();
  F.recentAsks.unshift({ at, asker: cx.meId(), turn: cx.newId('turn'), until: new Date(Date.parse(at) + 15 * 60000).toISOString(), guest: false });
  F.hosting.lastAsked = { at, by: cx.meId() };
}
function suggestFor(name) {
  if (!cx.hasSeat()) return ['How do I set up my account so my pay lands?', 'How much leave do I have left?', 'How does the people agent check my leave?'];
  if (/crm|lead|deal|contact|compan|pipeline/.test(name)) return ['How do outreach sequences work?', 'How does the sales agent score leads?', 'What are we not using yet?'];
  if (/project|task|timesheet/.test(name)) return ['How do project budgets work?', 'How does the project agent fill in timesheets?', 'What are we not using yet?'];
  if (/invoice|books|account|ledger|vat|bank|deposit/.test(name)) return ['How would recurring invoices work for the Aldermoor retainer?', 'How do bills by email work?', 'How do customers pay through Bridge?'];
  if (/hr|employee|leave|onboarding|payroll|payslip|expense/.test(name)) return ['How is payroll set up with HMRC?', 'What do the agents do?', 'When is the next training?'];
  if (/seat|agent|member/.test(name)) return ['How do we add seats and invite people?', 'What do the agents do?', 'Show me how approvals work'];
  if (/department|allowance|money|treasury|payment/.test(name)) return ['How do pay agreements work for contractors?', 'Show me how approvals work', 'What are we not using yet?'];
  return ['What are we not using yet?', 'How far along is our setup?', 'Show me how approvals work'];
}
cx.fde.answer = answer;
cx.fde.suggestions = suggestFor('home');
cx.on('route', (ctx) => { cx.fde.suggestions = suggestFor(ctx?.name || ''); });
cx.on('persona', () => { cx.fde.suggestions = suggestFor(cx.current?.name || ''); });
/** For Home: where setup stands, and the next training session. */
cx.fde.status = () => ({ liveSince: LIVE, steps: SETUP.length, done: doneSteps(), unused: unusedOpen().length, next: UPCOMING.find((s) => s.day >= cx.today) || null });

/* =====================================================================================================
   The FDE in the assistant: its setup work, and what it suggests turning on
   ===================================================================================================== */

(function registerFdeWork() {
  const put = (o) => { try { return cx.agentWork?.add?.({ agent: FDE_HANDLE, module: 'fde', ...o }) || null; } catch (e) { console.warn('agentWork.add', e); return null; } };
  for (const s of SETUP) put({ kind: 'done', key: `fde-setup-${s.id}`, who: s.by, at: `${s.day}T16:00:00Z`, title: `Setup: ${s.title}`, detail: s.fde, route: s.route, id: s.rid });
  for (const s of TRAINING.slice(-3)) put({ kind: 'done', key: `fde-training-${s.day}`, who: s.who, at: `${s.day}T15:00:00Z`, title: `Ran "${s.title}"`, detail: `${s.mins} minutes with ${s.who.map(cx.firstName).join(', ')}. ${s.notes}`, route: 'fde-training' });
  put({ kind: 'done', key: 'fde-check-2026-11', who: 'maya', at: '2026-11-02T08:10:00Z', title: `Checked Harbourline's setup: ${UNUSED.length} features not used yet`, detail: UNUSED.map((u) => u.title).join(', '), route: 'fde-unused' });
  for (const u of UNUSED) if (u.id !== 'agreements') put({ ...draftToItem(featureDraft(u)) });
})();
function draftToItem(d) {
  return { kind: 'proposal', key: d.key, who: d.for, agent: d.by, at: d.at, title: d.title, detail: d.why, steps: d.steps, needs: d.needs, approveLabel: d.runLabel, onApprove: d.onRun, result: d.result, route: d.route, id: d.id };
}

/* =====================================================================================================
   The FDE's pages: setup, not used yet, training, conversations, hosting and guests
   ===================================================================================================== */

const fdeCrumbs = [{ label: 'FDE', route: 'fde' }];
const chips = (ids) => h('span.fd-who', ids.map((id) => cx.personChip(id)));
const AREA_TONE = { Company: 'purple', Money: 'escrow', Bank: 'teal', Books: 'blue', People: 'green', Departments: 'orange', Payroll: 'green', CRM: 'yellow', Projects: 'blue' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const calOf = (day, done = true) => h('div.fd-cal', h('b', String(+day.slice(8))), h('small', `${MONTHS[+day.slice(5, 7) - 1]} ${day.slice(2, 4)}`), done ? h('i', { title: 'Done' }, cx.icon('check', { size: 12 })) : null);

function stepRow(s) {
  return h('li.fd-step', calOf(s.day),
    h('div.fd-step-b',
      h('div.fd-step-h', h('h3', s.route && has(s.route) ? h('a', { href: cx.href(s.route, s.rid) }, s.title) : s.title), cx.pill(s.area, AREA_TONE[s.area] || 'gray')),
      h('div.fd-by', h('span', 'Done by'), chips(s.by), h('span', `· ${fmt.date(s.day)}`)),
      h('div.fd-did', h('b', 'The FDE: '), s.fde),
      s.result ? h('div.fd-res', s.result) : null));
}
function laterRow(s) {
  return h('li.fd-step', calOf(s.day),
    h('div.fd-step-b',
      h('div.fd-step-h', h('h3', s.route && has(s.route) ? h('a', { href: cx.href(s.route) }, s.title) : s.title), cx.pill(s.area, AREA_TONE[s.area] || 'gray')),
      h('div.fd-by', h('span', 'Done by'), chips(s.by)),
      h('div.fd-did', h('b', 'The FDE: '), s.fde)));
}
function seatlessFde(title) {
  const me = cx.me();
  const mine = TRAINING.filter((s) => s.who.includes(me.id));
  return cx.page({ title, crumbs: fdeCrumbs, fde: 'FDE',
    sub: "Harbourline's forward deployed engineer sets Capxul up with the company and helps everyone get the most out of it",
    actions: [cx.btn('Ask the FDE', { kind: 'primary', icon: 'fde', onClick: () => cx.fde.open() })],
    body: [cx.banner(`${me.name} has no seat, so the FDE helps with ${me.firstName || 'your'}'s own records: payslips, leave, expenses and setting up your account.`, { tone: 'info' }),
      h('div.grid.c2',
        cx.card({ title: 'Ask about', body: h('div.suggest', suggestFor('').map((sg) => h('button', { type: 'button', onclick: () => cx.fde.open({ ask: sg }) }, sg))) }),
        cx.card({ title: 'Your training', body: mine.length ? h('ul.feed', mine.map((s) => h('li', cx.icon('calendar'), h('span', s.title), h('span.ago', fmt.day(s.day))))) : h('p.muted', 'No sessions yet. Ask the FDE for one on anything you use.') }))] });
}

cx.route('fde', (ctx) => {
  // older links ask for the FDE page's Hosting or Guests tab: those live on their own page now
  if (/Hosting|Guests/.test(ctx?.state?.tab || '')) { setTimeout(() => cx.go('fde-hosting'), 0); return hostingPage(); }
  if (!cx.hasSeat()) return seatlessFde('FDE');
  const st = cx.fde.status();
  const daysLive = daysBetween(LIVE, cx.today);
  return cx.page({
    title: 'Setup', crumbs: fdeCrumbs,
    sub: "How Harbourline moved onto Capxul in May and June 2025, step by step, with what its forward deployed engineer did at each",
    status: [cx.pill(`Live since ${fmt.date(LIVE)}`, 'green', { lg: true })],
    actions: [cx.btn('Not used yet', { icon: 'info', href: ['fde-unused'] }), cx.btn('Ask the FDE', { kind: 'primary', icon: 'fde', onClick: () => cx.fde.open() })],
    fde: 'FDE › Setup',
    body: [
      h('div.ncards',
        cx.numberCard({ label: 'Setup steps', value: `${st.done} of ${st.steps}`, sub: `1 May to ${fmt.date(LIVE)}` }),
        cx.numberCard({ label: 'On Capxul alone', value: `${fmt.int(daysLive)} days`, sub: 'since Xero was switched off' }),
        cx.numberCard({ label: 'Not used yet', value: String(st.unused), sub: st.unused ? 'features that would save time' : 'nothing left to suggest', href: ['fde-unused'] }),
        cx.numberCard({ label: 'Training', value: `${TRAINING.length} sessions`, sub: st.next ? `next ${fmt.day(st.next.day)}: ${st.next.title}` : 'ask for one any time', href: ['fde-training'] })),
      cx.card({ title: 'Onboarding, May and June 2025', flush: true, actions: h('span.muted.fd-hint', { style: 'font-size:12.5px' }, 'Every step signed off by the person who did it'), body: h('ol.fd-steps', SETUP.map(stepRow)) }),
      cx.card({ title: 'Since going live', flush: true, body: h('ol.fd-steps', LATER.map(laterRow)) }),
    ],
  });
}, { workspace: 'fde', title: 'Setup' });

cx.route('fde-unused', () => {
  if (!cx.hasSeat()) return seatlessFde('Not used yet');
  const card = (u) => {
    const it = cx.agentWork?.list?.({ kind: 'proposal' }).find((x) => x.key === `fde-unused-${u.id}`);
    const mine = u.who === cx.meId();
    const on = used[u.id] || (it && it.state === 'approved' ? { by: it.approvedBy, at: it.approvedAt } : null);
    return cx.card({ title: h('span', { style: 'display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap' }, cx.icon(u.icon, { size: 15 }), u.title),
      actions: on ? cx.pill('Turned on', 'green') : cx.pill('Not used', 'muted'),
      body: h('div.fd-feat',
        h('p', u.why),
        h('div.fd-save', u.save.map(([k, v]) => h('div', h('small', k), h('b', v)))),
        h('p', { style: 'font-size:13px;color:var(--muted)' }, u.how),
        h('div.fd-by', h('span', on ? `Turned on by ${cx.name(on.by)} ${fmt.agoLong(on.at)}` : u.hat ? `${cx.name(u.who)} turns it on (wears ${u.hat})` : `${cx.name(u.who)} turns it on`)),
        h('div.fd-acts',
          !on && it ? cx.btn('Turn it on', { kind: 'primary', sm: true, icon: 'check', needs: () => (mine ? (u.hat && !cx.wears(u.hat) ? `Needs the ${u.hat} hat` : true) : `Only ${cx.name(u.who)} can turn it on; it waits in their assistant.`), onClick: () => cx.agentWork.approve(it) }) : null,
          cx.btn('Show me how', { sm: true, icon: 'fde', onClick: () => cx.fde.open({ ask: u.ask }) }),
          u.route && has(u.route) ? cx.btn('Where it lives', { sm: true, kind: 'ghost', href: [u.route, u.rid] }) : null)) });
  };
  return cx.page({
    title: 'Not used yet', crumbs: fdeCrumbs,
    sub: 'What Harbourline has in Capxul but does not use yet, from its own records, and what each would save. The FDE checks on the 1st of each month.',
    actions: [cx.btn('Ask the FDE', { icon: 'fde', onClick: () => cx.fde.open({ ask: 'What are we not using yet?' }) })],
    fde: 'FDE › Not used yet',
    body: [h('div.grid.c2', UNUSED.map(card))],
  });
}, { workspace: 'fde', title: 'Not used yet' });

cx.route('fde-training', () => {
  const me = cx.me();
  const seat = cx.hasSeat();
  const held = (seat ? TRAINING : TRAINING.filter((s) => s.who.includes(me.id))).slice().reverse();
  const notes = (s) => cx.modal({ title: s.title, body: h('div', { style: 'display:grid;gap:10px' }, cx.kv([['When', `${fmt.dateLong(s.day)}${s.time ? ', ' + s.time : ''}`], ['Length', `${s.mins} minutes, by video call`], ['With', chips(s.who)]]), h('p', s.notes)), actions: [{ label: 'Close', primary: true }] });
  const upcoming = UPCOMING.filter((s) => s.day >= cx.today && (seat || s.who.includes(me.id)));
  return cx.page({
    title: 'Training', crumbs: fdeCrumbs,
    sub: 'Sessions the FDE has run with Harbourline since May 2025: each new tool, each new hat, each new seat holder',
    actions: [cx.btn('Ask for a session', { icon: 'fde', onClick: () => cx.fde.open({ ask: 'Can we have a training session?' }) })],
    fde: 'FDE › Training',
    body: [
      upcoming.length ? cx.card({ title: 'Coming up', flush: true, body: h('ol.fd-steps', upcoming.map((s) => h('li.fd-step', calOf(s.day, false), h('div.fd-step-b',
        h('div.fd-step-h', h('h3', s.title), cx.pill(`${s.time} · ${s.mins} min`, 'blue')),
        h('div.fd-by', h('span', 'For'), chips(s.who)),
        h('div.fd-res', s.notes),
        h('div.fd-acts', s.who.includes(me.id) ? (joined[s.day] ? cx.pill('In your calendar', 'green') : cx.btn('Add to my calendar', { sm: true, icon: 'calendar', onClick: () => { joined[s.day] = true; cx.toast(`Added "${s.title}" to your calendar (mock-up: no invite is sent)`, { tone: 'success' }); cx.refresh(); } })) : cx.btn('Join it', { sm: true, icon: 'plus', onClick: () => { s.who.push(me.id); joined[s.day] = true; cx.toast(`Added you to "${s.title}" (mock-up: no invite is sent)`, { tone: 'success' }); cx.refresh(); } })))))) }) : null,
      cx.card({ title: `Sessions held · ${held.length}`, flush: true, body: held.length ? h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Date'), h('th', 'Session'), h('th.opt', 'With'), h('th.num', 'Length'), h('th', ''))),
        h('tbody', held.map((s) => h('tr', h('td', fmt.date(s.day)), h('td.wrap', s.title), h('td.opt', h('span', { style: 'display:inline-flex;gap:2px' }, s.who.map((id) => cx.avatar(id, { size: 'sm' })))), h('td.num', `${s.mins} min`), h('td', cx.btn('Notes', { sm: true, kind: 'ghost', onClick: () => notes(s) }))))))) : cx.empty('No sessions with you yet.') }),
    ],
  });
}, { workspace: 'fde', title: 'Training' });

function turnView(c, t) {
  const seenL = (t.looked || []).filter(Boolean);
  return h('div.chat-turn', { class: t.role === 'user' ? 'user' : 'fde' },
    t.role === 'fde' && seenL.length ? h('div.looked', h('span', 'What I looked at'), seenL.map((x) => h('div', x))) : null,
    h('div.bubble', t.text),
    t.links?.length ? h('div.chips', t.links.filter(([, r]) => has(r)).map(([label, r, id]) => h('a.btn.sm', { href: cx.href(r, id) }, label))) : null,
    h('div', { style: 'font-size:11.5px;color:var(--faint)' }, `${t.role === 'user' ? (c.guest ? 'Sam Hollis (guest)' : cx.name(c.asker)) : "Harbourline's FDE"} · ${fmt.datetime(t.at)}`));
}
cx.route('fde-conversations', () => {
  const me = cx.me();
  const mine = CONVOS.filter((c) => c.asker === me.id).sort((a, b) => b.at.localeCompare(a.at));
  const months = [...new Set(F.asksByMonth.map((a) => a.month))].sort();
  return cx.page({
    title: 'Conversations', crumbs: fdeCrumbs,
    sub: 'What you have asked the FDE. Most questions are about setting something up or how something works.',
    actions: [cx.btn('Ask the FDE', { kind: 'primary', icon: 'fde', onClick: () => cx.fde.open() })],
    fde: 'FDE › Conversations',
    body: [
      cx.banner('Capxul records that someone asked, and when; only the asker reads their own conversation.', { tone: 'info' }),
      cx.card({ title: `Your conversations · ${mine.length}`, flush: true, body: mine.length ? h('ul.feed', mine.map((c) => h('li', cx.icon('message'), h('a', { href: cx.href('fde-conversation', c.id), style: 'color:inherit;min-width:0' }, h('b', c.turns[0].text), h('div', { style: 'font-size:12px;color:var(--muted)' }, `${c.topic} · on ${c.screen} · ${fmt.plural(c.turns.length, 'turn')}`)), h('span.ago', { title: fmt.datetime(c.at) }, fmt.day(c.at))))) : cx.empty('You have not asked the FDE anything yet.', cx.btn('Ask the FDE', { icon: 'fde', onClick: () => cx.fde.open() })) }),
      cx.hasSeat() ? h('div.grid.c2',
        cx.card({ title: 'What Harbourline asks about', body: cx.chart.hbar({ items: TOPICS.map((x, i) => ({ label: x.label, value: x.value, color: String(i + 1) })), format: (v) => fmt.int(v) }) }),
        cx.card({ title: 'Asks each month', body: cx.chart.bar({ labels: months.map((m) => fmt.monthShort(m)), series: [{ name: 'Asks', values: months.map((m) => F.asksByMonth.filter((a) => a.month === m).reduce((s, a) => s + a.count, 0)), color: '1' }], height: 200, format: (v) => String(Math.round(v)) }) })) : null,
    ],
  });
}, { workspace: 'fde', title: 'Conversations' });

cx.route('fde-conversation', (ctx) => {
  const c = cx.find(CONVOS, 'id', ctx.id);
  const crumbs = [...fdeCrumbs, { label: 'Conversations', route: 'fde-conversations' }];
  if (!c) return cx.page({ title: 'Not found', crumbs, body: cx.empty('No such conversation', cx.btn('Conversations', { href: ['fde-conversations'] })) });
  const mine = c.asker === cx.meId();
  return cx.page({
    title: mine ? c.turns[0].text : 'A conversation', crumbs,
    status: [cx.pill(c.topic, 'blue')],
    sub: `${c.guest ? 'Sam Hollis (guest)' : cx.name(c.asker)} · on ${c.screen} · ${fmt.datetime(c.at)}`,
    fde: 'FDE › Conversation',
    body: mine ? cx.card({ body: h('div.chat.fd-convo', c.turns.map((t) => turnView(c, t))) }) : cx.empty(`Only ${cx.name(c.asker)} reads their own conversation: the reply may hold what only they may see.`),
  });
}, { workspace: 'fde', title: 'Conversation' });

function payHosting() {
  const hst = F.hosting;
  const budgets = N().payableBudgets?.() || [];
  const from = budgets.includes('capxul') ? 'capxul' : budgets[0];
  if (!from) { cx.toast(`${cx.me().name} holds no budget to pay from. Kwame Mensah holds the Capxul allowance.`, { tone: 'warning' }); return; }
  return N().payFromBudget({ title: 'Pay for the FDE\'s hosting, 1 month', to: 'Capxul · FDE hosting', payee: N().CAPXUL_PAYEE, amount: hst.price, budget: from, memo: `FDE hosting to ${fmt.date(addDays(hst.paidThrough, 30))}` }).then((p) => {
    if (!p) return;
    const next = new Date(hst.paidThrough + 'T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1);
    hst.paidThrough = next.toISOString().slice(0, 10); hst.due = addDays(hst.paidThrough, -7); hst.monthsPaid += 1; hst.paidTotal += hst.price;
    const w = D.approvals.waiting; for (let i = w.length - 1; i >= 0; i--) if (w[i].ref?.type === 'fde') w.splice(i, 1);
    cx.toast(`Hosting paid through ${fmt.date(hst.paidThrough)}.`, { tone: 'success' }); cx.refresh();
  });
}
function nameGuest() {
  const model = { email: '', note: '' };
  cx.modal({ title: 'Name a guest', body: h('div', { style: 'display:grid;gap:10px' }, h('div.fields', { style: { '--cols': 2 } }, cx.field({ label: 'Email', edit: true, model, key: 'email' }), cx.field({ label: 'Note', edit: true, model, key: 'note', placeholder: 'Our accountant' })), h('p', { style: 'font-size:12.5px;color:var(--muted)' }, 'A guest may ask the FDE about their own dealings with Harbourline only. It reads nothing else for them.')),
    actions: [{ label: 'Back' }, { label: 'Name them', primary: true, needs: { any: ['People', 'Director'] }, onClick: (close) => { if (!/@/.test(model.email)) { cx.toast('Enter their email address.', { tone: 'warning' }); return; } F.guests.push({ email: model.email, name: model.email.split('@')[0], note: model.note, namedBy: cx.meId(), since: cx.today, status: 'Active' }); close(); cx.toast(`${model.email} can now ask the FDE about their own dealings.`, { tone: 'success' }); cx.refresh(); } }] });
}
cx.route('fde-hosting', () => hostingPage(), { workspace: 'fde', title: 'Hosting and guests' });
function hostingPage() {
  if (!cx.hasSeat()) return seatlessFde('Hosting and guests');
  const hst = F.hosting;
  return cx.page({
    title: 'Hosting and guests', crumbs: fdeCrumbs,
    sub: `${hst.handle} · hosted by Capxul · anyone in Harbourline can talk to it; it acts only with the asker's permissions`,
    status: [cx.pill(hst.status, hst.status === 'Running' ? 'green' : 'red', { lg: true })],
    fde: 'FDE › Hosting',
    body: [
      h('div.grid.c2',
        cx.card({ title: 'Hosting', body: cx.kv([['Status', cx.pill(`${hst.status} on Capxul`, hst.status === 'Running' ? 'green' : 'red')], ['Handle and Safe', h('span', hst.handle, ' · ', cx.addr(hst.safe))], ['Its own hats', "none: it acts with each asker's hats"], ['Started', fmt.date(hst.started)], ['Paid through', fmt.date(hst.paidThrough)], ['Next due', `${fmt.date(hst.due)}, seven days before`], ['Price', `${fmt.usdc(hst.price)} a month · ${fmt.usdc(hst.paidTotal)} so far`], ['Last asked', `${fmt.agoLong(hst.lastAsked.at)} by ${cx.name(hst.lastAsked.by)}`]]) }),
        cx.card({ title: 'Guests', flush: true, actions: cx.btn('Name a guest', { sm: true, icon: 'plus', needs: { any: ['People', 'Director'] }, onClick: nameGuest }),
          body: h('div', h('div.tbl-scroll', h('table.tbl', h('thead', h('tr', h('th', 'Guest'), h('th.opt', 'Named by'), h('th', 'Since'), h('th', 'Status'))), h('tbody', F.guests.map((g) => h('tr', h('td.wrap', h('b', g.name), h('div', { style: 'font-size:12px;color:var(--muted)' }, `${g.email} · ${g.note}`)), h('td.opt', cx.personChip(g.namedBy)), h('td', fmt.date(g.since)), h('td', cx.pill(g.status, g.status === 'Active' ? 'green' : 'muted'))))))),
            h('p', { style: 'font-size:12.5px;color:var(--muted);padding:10px 14px' }, "A guest asks about their own dealings only: Sam Hollis sees Hollis & Reed's invoices and payments, never the VAT return.")) })),
      cx.banner(`If hosting is not paid by ${fmt.date(hst.paidThrough)}, the FDE pauses. Nothing on chain changes, and paying resumes it.`, { tone: 'info', action: cx.btn('Pay for hosting', { sm: true, kind: 'primary', icon: 'passkey', needs: () => ((N().payableBudgets?.() || []).length ? true : 'Needs a budget whose hat you wear. A person pays, never an agent.'), onClick: payHosting }) }),
    ],
  });
}

/* =====================================================================================================
   Activity: the money feed
   ===================================================================================================== */

const actRows = () => cx.rows('activity');
const findAct = (id) => actRows().find((r) => cx.slug(r.payment || r.tx) === cx.slug(id));
cx.route('activity', () => {
  const st = cx.store.get('activity-f', { kind: '', dir: '', budget: '', month: '' });
  let limit = 60;
  const list = h('div');
  const sum = h('div.ncards');
  const filt = (r) => (!st.kind || r.kind === st.kind) && (!st.dir || r.direction === st.dir) && (!st.budget || r.budget === st.budget) && (!st.month || String(r.at).startsWith(st.month));
  const months = [...new Set(actRows().map((r) => String(r.at).slice(0, 7)))].sort().reverse();
  const sel = (key, opts, label) => h('select.ctl', { 'aria-label': label, onchange: (e) => { st[key] = e.target.value; cx.store.set('activity-f', st); limit = 60; draw(); } }, opts.map(([v, t]) => h('option', { value: v, selected: st[key] === v }, t)));
  const filters = h('div.fd-filters',
    sel('kind', [['', 'Any kind'], ['Payment', 'Payments'], ['Outside money', 'Outside money']], 'Kind'),
    sel('dir', [['', 'Any direction'], ['In', 'In'], ['Out', 'Out'], ['Between your Safes', 'Between your Safes']], 'Direction'),
    sel('budget', [['', 'Any budget'], ...D.departments.map((d) => [d.id, d.name]), ...D.allowances.map((a) => [a.id, a.name + ' allowance'])], 'From'),
    sel('month', [['', 'Any month'], ...months.map((m) => [m, fmt.month(m)])], 'Month'));
  const draw = () => {
    const rows = actRows().filter(filt);
    const inn = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const out = rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0);
    const pend = M.deposits.filter((d) => d.status === 'Arriving');
    const flags = [st.kind === 'Outside money' ? '--kind movement' : st.kind === 'Payment' ? '--kind payment' : '', st.dir ? `--direction ${st.dir.toLowerCase().split(' ')[0]}` : '', st.month ? `--from ${st.month}-01` : ''].filter(Boolean).join(' ');
    cx.setCommand({ cli: `capxul activity list ${ORG}${flags ? ' ' + flags : ''} --limit 25`, sdk: 'client.activity.list({ org: "harbourline", limit: 25 })', json: { items: rows.slice(0, 3).map((r) => ({ kind: r.kind === 'Payment' ? 'payment' : 'movement', at: r.at, direction: r.direction.toLowerCase(), amount: String(r.amount), asset: 'USDC', counterparty: r.counterparty, status: r.status, txHash: r.tx })), next: 'cursor_…' } });
    cx.fill(sum,
      cx.numberCard({ label: 'In', value: '+' + fmt.usdc(inn), sub: fmt.gbp(inn * RATE), cmd: `capxul activity summary ${ORG}` }),
      cx.numberCard({ label: 'Out', value: '−' + fmt.usdc(out), sub: fmt.gbp(out * RATE) }),
      cx.numberCard({ label: 'Net', value: (inn - out >= 0 ? '+' : '−') + fmt.usdc(Math.abs(inn - out)), delta: { text: inn >= out ? 'more in than out' : 'more out than in', good: inn >= out } }),
      cx.numberCard({ label: 'Pending in', value: pend.map((d) => fmt.money(d.bankAmount, d.currency)).join(' + ') || '0', sub: `${rows.length} movements` }));
    const shown = rows.slice(0, limit);
    const days = new Map();
    for (const r of shown) { const d = String(r.at).slice(0, 10); if (!days.has(d)) days.set(d, []); days.get(d).push(r); }
    cx.fill(list, shown.length ? cx.card({ flush: true, body: h('ul.fd-feed', [...days.entries()].map(([d, rs]) => h('li', h('div.fd-day', d === cx.today ? 'Today' : fmt.dateLong(d)), rs.map((r) => {
      const isIn = r.amount > 0;
      return h('a.fd-row', { href: cx.href('activity-item', r.payment || r.tx) },
        h('span.ic-wrap', { class: isIn ? 'in' : 'out' }, cx.icon(r.direction === 'Between your Safes' ? 'swap' : isIn ? 'in' : 'out', { size: 14 })),
        h('span.t', h('b', `${isIn ? 'From' : r.direction === 'Between your Safes' ? '' : 'To'} ${r.counterparty}`.trim()), h('small', [fmt.time(r.at), r.kind === 'Outside money' ? 'Outside money (received via Bridge)' : 'Payment', r.budget ? cx.deptName(r.budget) : null, r.tx ? fmt.hash(r.tx) : null].filter(Boolean).join(' · '))),
        h('span.r', cx.amount(r.amount, 'USDC', { gbp: r2(r.amount * RATE), sign: true, color: true }), r.kind === 'Payment' ? cx.pill(r.status + (r.outcome ? ' · ' + r.outcome : ''), r.status === 'Settled' ? 'green' : r.status === 'Money waiting' ? 'escrow' : 'muted') : null));
    })))) }) : cx.empty('Nothing matches.'), rows.length > limit ? h('div', { style: 'text-align:center' }, cx.btn(`Load more (${rows.length - limit} older)`, { onClick: () => { limit += 100; draw(); } })) : null);
  };
  draw();
  return cx.page({
    title: 'Activity', sub: 'Everything that moved money for Harbourline, newest first: Capxul payments and outside money',
    actions: [cx.btn('Follow live', { icon: 'activity', cmd: `capxul activity events ${ORG} --wait`, onClick: () => cx.toast('Following: new rows slide in at the top as the chain confirms them.', { cmd: `capxul activity events ${ORG} --wait` }) })],
    cmd: { cli: `capxul activity list ${ORG} --limit 25`, sdk: 'client.activity.list({ org: "harbourline", limit: 25 })' },
    body: [filters, sum, list],
  });
}, { workspace: 'activity', title: 'Activity' });

cx.route('activity-item', (ctx) => {
  const r = findAct(ctx.id);
  if (!r) return cx.page({ title: 'Not found', body: cx.empty('No such movement', cx.btn('Activity', { href: ['activity'] })) });
  const p = r.payment ? M.payments.find((x) => x.id === r.payment) : null;
  const ann = (r.annotation ||= { account: p?.account || null, memo: p?.memo || null });
  const isMove = r.kind === 'Outside money';
  const id = isMove ? `8453:${r.tx}:${p?.proof?.logIndex ?? 211}:in` : r.payment;
  const annotate = () => {
    const model = { account: ann.account || '', memo: ann.memo || '' };
    const accts = (D.books.accounts || []).filter((a) => !a.isGroup && a.code);
    const cmdOf = () => `capxul activity annotate --kind ${isMove ? 'movement' : 'payment'} --id ${id} --account ${model.account || '<code>'}${model.memo ? ` --memo ${JSON.stringify(model.memo)}` : ''}`;
    cx.modal({ title: 'Annotate', body: h('div', { style: 'display:grid;gap:10px' }, cx.field({ label: 'Account', type: 'select', edit: true, model, key: 'account', options: [['', 'Choose'], ['6999', 'Not sure: 6999 (Books reviews it)'], ...accts.map((a) => [a.code, `${a.code} · ${a.name}`])], onChange: () => cx.showAction(cmdOf(), 'Annotate', { pin: true }) }), cx.field({ label: 'Memo', edit: true, model, key: 'memo' })),
      actions: [{ label: 'Back' }, { label: 'Save', primary: true, needs: { seat: true }, cmd: cmdOf(), onClick: (close) => { ann.account = model.account; ann.memo = model.memo; close(); cx.toast('Annotated.', { tone: 'success', cmd: cmdOf() }); cx.refresh(); } }] });
  };
  const acc = ann.account ? (D.books.accounts || []).find((a) => String(a.code) === String(ann.account)) : null;
  return cx.page({
    title: `${r.amount > 0 ? 'From' : 'To'} ${r.counterparty}`, crumbs: [{ label: 'Activity', route: 'activity' }],
    status: [cx.pill(isMove ? 'Outside money' : r.status, isMove ? 'teal' : r.status === 'Settled' ? 'green' : 'muted', { lg: true })],
    sub: h('span', cx.amount(r.amount, 'USDC', { gbp: r2(r.amount * RATE), sign: true }), ' · ', fmt.datetime(r.at)),
    actions: [cx.btn('Annotate', { icon: 'edit', cmd: `capxul activity annotate --kind ${isMove ? 'movement' : 'payment'} --id ${id} --account <code>`, onClick: annotate }), p ? cx.btn('Open the payment', { kind: 'primary', href: ['payment', p.id] }) : null].filter(Boolean),
    cmd: { cli: `capxul activity get --kind ${isMove ? 'movement' : 'payment'} --id ${id}`, sdk: `client.activity.get({ kind: "${isMove ? 'movement' : 'payment'}", id: "${id}" })` },
    body: [
      h('div.grid.c2',
        cx.card({ title: 'Movement', body: cx.kv([['Time', fmt.utc(r.at)], ['Kind', isMove ? 'Outside money (received from outside Capxul, via Bridge)' : 'Capxul payment'], ['Direction', cx.dir(r.direction)], ['Amount', fmt.usdc(r.amount)], ['Counterparty', r.counterparty], ['Account', r.safe], ['From budget', r.budget ? cx.deptName(r.budget) : '—']]) }),
        cx.card({ title: 'Evidence', body: cx.kv([['Chain', 'Base · 8453'], ['Contract', isMove ? 'USDC 0x8335…2913' : 'Budgets (Capxul payments)'], ['Settled through', p?.proof?.settledThrough || (isMove ? 'a Transfer into the Treasury' : '—')], ['Token', 'USDC'], ['Transaction', r.tx ? cx.tx(r.tx) : '—'], ['Block', p?.proof?.block ? fmt.int(p.proof.block) : p?.deposit ? fmt.int(M.deposits.find((d) => d.id === p.deposit)?.block || 0) : '—'], ['Log', p?.proof ? `PaymentSent #${p.proof.logIndex}, Transfer #${p.proof.logIndex - 1}` : `Transfer #${p?.proof?.logIndex ?? 211}`]]) })),
      cx.card({ title: 'Annotation', body: h('div', { style: 'display:grid;gap:8px' }, cx.kv([['Account', acc ? `${acc.code} · ${acc.name}` : ann.account || 'not set'], ['Memo', ann.memo || '—']]), h('p', { style: 'font-size:12.5px;color:var(--muted)' }, '"Not sure" puts it in 6999 or 4999 for Books to review.')) }),
    ],
  });
}, { workspace: 'activity', title: 'Movement' });

/* =====================================================================================================
   Events and notices
   ===================================================================================================== */

const EV_ICON = { Money: 'money', People: 'hr', Payroll: 'payroll', Projects: 'projects', Agents: 'fde', Board: 'board', Equity: 'board', CRM: 'crm', Books: 'books', Departments: 'departments', Seats: 'seats', Banking: 'bank', Company: 'home' };
cx.route('events', () => {
  let kind = cx.store.get('events-kind', '');
  const box = h('div');
  const kinds = [...new Set(D.events.map((e) => e.kind))].sort();
  const draw = () => {
    const rows = D.events.filter((e) => !kind || e.kind === kind);
    const days = new Map();
    for (const e of rows) { const d = String(e.at).slice(0, 10); if (!days.has(d)) days.set(d, []); days.get(d).push(e); }
    cx.fill(box, cx.card({ flush: true, body: h('ul.fd-feed', [...days.entries()].map(([d, es]) => h('li', h('div.fd-day', d === cx.today ? 'Today' : fmt.dateLong(d)), es.map((e) => {
      const href = cx.refHref(e.ref);
      return h(href ? 'a.fd-row' : 'div.fd-row', { href }, e.who ? cx.avatar(e.who, { size: 'sm' }) : h('span.ic-wrap', cx.icon(EV_ICON[e.kind] || 'activity', { size: 13 })), h('span.t', h('b', e.text), h('small', `${e.kind} · ${fmt.time(e.at)}`)), h('span.r', h('span', { style: 'font-size:12px;color:var(--muted)' }, fmt.ago(e.at))));
    })))) }));
  };
  draw();
  return cx.page({
    title: 'Events', sub: 'What happened at Harbourline, newest first',
    actions: [h('select.ctl', { 'aria-label': 'Kind', style: 'width:auto', onchange: (e) => { kind = e.target.value; cx.store.set('events-kind', kind); draw(); } }, [['', 'Every kind'], ...kinds.map((k) => [k, k])].map(([v, t]) => h('option', { value: v, selected: v === kind }, t)))],
    cmd: { cli: `capxul activity events ${ORG}`, note: 'Money events come from the chain; the rest from each record\'s changes.' },
    body: box,
  });
}, { workspace: 'activity', title: 'Events' });

cx.route('notices', () => {
  const me = cx.me();
  let kind = '';
  const box = h('div');
  const mine = () => D.notices.filter((n) => n.to === me.id);
  const kinds = ['Money', 'Board', 'HR', 'People', 'Banking', 'FDE'];
  const chips = h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' });
  const draw = () => {
    cx.fill(chips, [['', 'All'], ...kinds.map((k) => [k, k])].map(([v, t]) => cx.btn(`${t} · ${v ? mine().filter((n) => n.kind === v).length : mine().length}`, { sm: true, kind: kind === v ? 'primary' : null, onClick: () => { kind = v; draw(); } })));
    const rows = mine().filter((n) => !kind || n.kind === kind);
    cx.fill(box, cx.card({ flush: true, body: rows.length ? h('div', rows.map((n) => {
      const href = cx.refHref(n.ref);
      return h('div.fd-notice', { class: { read: n.read } }, h('span.dot2'), h('div', h('div.tx', n.text), h('small', `${n.kind} · ${fmt.datetime(n.at)} · sent by email to ${me.companyEmail || me.email || me.personalEmail}`)), href ? cx.btn('Open', { sm: true, href, onClick: () => { n.read = true; } }) : h('span'));
    })) : cx.empty('No notices for you.') }));
  };
  draw();
  return cx.page({
    title: 'Notices', crumbs: [], sub: `What Capxul told ${me.name}, newest first. Notices are emails; the bell shows the same.`,
    actions: [cx.btn('Mark all read', { onClick: () => { mine().forEach((n) => { n.read = true; }); cx.toast('All read.'); cx.refresh(); } })],
    cmd: { cli: `capxul dev mail notices --to ${me.companyEmail || me.email || 'you'}`, note: 'No command lists a person\'s notices (a gap the book records); on the devnet, dev mail notices shows the emails.' },
    body: [chips, box],
  });
}, { workspace: 'yours', title: 'Notices' });

/* =====================================================================================================
   Search
   ===================================================================================================== */

cx.search.add((qs, limit) => {
  const t = qs.toLowerCase();
  const out = [];
  if (cx.hasSeat()) {
    for (const s of [...SETUP, ...LATER]) if (s.title.toLowerCase().includes(t)) out.push({ kind: 'FDE', label: `Setup: ${s.title}`, sub: fmt.date(s.day), route: 'fde', icon: 'fde' });
    for (const u of UNUSED) if (u.title.toLowerCase().includes(t)) out.push({ kind: 'FDE', label: `Not used yet: ${u.title}`, sub: u.save[0][1], route: 'fde-unused', icon: 'fde' });
    for (const g of F.guests) if (g.name.toLowerCase().includes(t) || g.email.includes(t)) out.push({ kind: 'FDE', label: `${g.name} (guest)`, sub: g.note, route: 'fde-hosting', icon: 'fde' });
  }
  for (const s of TRAINING) if (s.title.toLowerCase().includes(t) && (cx.hasSeat() || s.who.includes(cx.meId()))) out.push({ kind: 'FDE', label: `Training: ${s.title}`, sub: fmt.date(s.day), route: 'fde-training', icon: 'fde' });
  for (const c of CONVOS) if (c.asker === cx.meId() && c.turns[0].text.toLowerCase().includes(t)) out.push({ kind: 'FDE', label: c.turns[0].text, sub: `${c.screen} · ${fmt.date(c.at)}`, route: 'fde-conversation', id: c.id, icon: 'fde' });
  return out.slice(0, limit);
});
