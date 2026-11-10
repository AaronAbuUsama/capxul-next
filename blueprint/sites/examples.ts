// The examples of the sites operations: Northwind's site on the town world, its feature switches and the document door,
// as Marcus (Finance) uses it. Ids 500 to 549 are this concept's. The arguments of the document door follow the
// operations' own acceptance lines (`doc get "Purchase Invoice" <name>`, `doc create Supplier --field k=v`, `--action`,
// `--to`, `--filter`); `doc update` uses `--field` by the same pattern (the record does not state its flags).

import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { ADDRESS, ID, NORTHWIND, ok, refused, uuid } from "../shared/examples.ts";

const t = (iso: string) => Date.parse(iso);
const SITE_ID = uuid(500);
const HOST = "northwind-town.sites.capxul.test";

const FEATURES = [
  ["accounts", "on", true, "Accounts, with banking"],
  ["people", "on", true, "Staff records, leave and expenses"],
  ["projects", "on", true, "Projects and tasks"],
  ["crm", "on", true, "Leads, deals and contacts"],
  ["payroll", "off", false, "Payroll runs and pay agreements"],
  ["whatsapp", "off", false, "WhatsApp sending"],
  ["attendance", "off", false, "Attendance"],
  ["recruitment", "off", false, "Recruitment"],
  ["reviews", "off", false, "Reviews"],
  ["stock", "off", false, "Stock"],
  ["manufacturing", "off", false, "Manufacturing"],
] as const;

const invoice = (docstatus: number, name = "ACC-PINV-2026-00001") => ({
  doctype: "Purchase Invoice",
  name,
  docstatus,
  fields: { supplier: "Brightside Cleaning", posting_date: "2026-02-03", currency: "USDC", grand_total: "125.50", owner: "marcus.lindqvist@northwind.test" },
});

const ONE = (url: string) => `https://${HOST}${url}`;

export const siteShow = [
  ok("Show Northwind's site, ready on the town world", "capxul org site show --org northwind --json", {
    siteId: SITE_ID,
    worldId: NORTHWIND.world,
    host: HOST,
    url: ONE("/"),
    state: "ready",
    bench: "bench-01",
    appVersion: "1.0.0",
    mapVersion: "2026.1",
    failure: null,
    createdAt: t("2026-01-12T09:00:00Z"),
    readyAt: t("2026-01-12T09:06:00Z"),
  }),
  ok("A site whose creation failed", "capxul org site show --org northwind --json", {
    siteId: SITE_ID,
    worldId: NORTHWIND.world,
    host: HOST,
    url: ONE("/"),
    state: "failed",
    bench: "bench-01",
    appVersion: null,
    mapVersion: null,
    failure: "The bench did not answer within 300 seconds.",
    createdAt: t("2026-01-12T09:00:00Z"),
    readyAt: null,
  }),
  refused("An Organization that does not exist", "capxul org site show --org globex --json", error_INVALID_INPUT),
];

export const siteOpen = [
  ok("Marcus opens the site: he can sign in", "capxul org site open --org northwind --json", { url: ONE("/"), canSignIn: true, needs: null }),
  ok("A member without a hat is told which one they need", "capxul org site open --org northwind --json", {
    url: ONE("/"),
    canSignIn: false,
    needs: "Wear a hat that gives a role on the site, for example Books.",
  }),
  refused("The site is still being created", "capxul org site open --org northwind --json", error_WRONG_STATE),
];

export const siteRetry = [
  ok("Hannah retries the failed creation", "capxul org site retry --org northwind --json", { siteId: SITE_ID, state: "creating" }),
  refused("Priya does not wear the Director hat", "capxul org site retry --org northwind --json", error_ROLE_PERMISSION_DENIED),
  refused("The site did not fail", "capxul org site retry --org northwind --json", error_WRONG_STATE),
];

export const featureList = [
  ok("Northwind's features: the base set on, the rest off", "capxul org feature list --org northwind --json", {
    features: FEATURES.map(([feature, state, defaultOn, about]) => ({ feature, state, defaultOn, about })),
  }),
  refused("Signed out", "capxul org feature list --org northwind --json", error_NOT_AUTHENTICATED),
];

export const featureOn = [
  ok("Hannah turns stock on", "capxul org feature on stock --org northwind --json", { feature: "stock", state: "switching" }),
  refused("WhatsApp needs CRM, which is off", "capxul org feature on whatsapp --org northwind --json", error_WRONG_STATE),
  refused("Priya does not wear the Director hat", "capxul org feature on stock --org northwind --json", error_ROLE_PERMISSION_DENIED),
  refused("A feature that is not one of the eleven", "capxul org feature on invoicing --org northwind --json", error_INVALID_INPUT),
];

export const featureOff = [
  ok("Hannah turns projects off", "capxul org feature off projects --org northwind --json", { feature: "projects", state: "switching" }),
  refused("CRM cannot go off while WhatsApp is on", "capxul org feature off crm --org northwind --json", error_WRONG_STATE),
  refused("Priya does not wear the Director hat", "capxul org feature off projects --org northwind --json", error_ROLE_PERMISSION_DENIED),
];

const noUser = (input: string) => refused("A caller with no site user, because no hat created one", input, error_ROLE_PERMISSION_DENIED);
const switchedOff = (input: string) => refused("A document of a part that is switched off", input, error_FEATURE_NOT_AVAILABLE);
const benchDown = (input: string) => refused("The site's bench is stopped", input, error_PROVIDER_ERROR);

export const docTypes = [
  ok("The document types Marcus can reach", "capxul doc types --json", {
    types: [
      { doctype: "Purchase Invoice", module: "Accounts", app: "erpnext", feature: "accounts", reachable: true },
      { doctype: "Project", module: "Projects", app: "erpnext", feature: "projects", reachable: true },
      { doctype: "Stock Entry", module: "Stock", app: "erpnext", feature: "stock", reachable: false },
    ],
  }),
  noUser("capxul doc types --json"),
];

export const docSchema = [
  ok("What a Purchase Invoice takes", `capxul doc schema "Purchase Invoice" --json`, {
    doctype: "Purchase Invoice",
    fields: [
      { fieldname: "supplier", fieldtype: "Link", options: "Supplier", reqd: 1 },
      { fieldname: "posting_date", fieldtype: "Date", reqd: 1 },
      { fieldname: "grand_total", fieldtype: "Currency", reqd: 0 },
    ],
    workflow: null,
    actions: ["submit", "cancel", "amend"],
  }),
  switchedOff(`capxul doc schema "Stock Entry" --json`),
];

export const docList = [
  ok("Marcus lists the Purchase Invoices he may read", `capxul doc list "Purchase Invoice" --json`, {
    rows: [{ name: "ACC-PINV-2026-00001", supplier: "Brightside Cleaning", grand_total: "125.50", docstatus: 0 }],
    more: false,
  }),
  benchDown(`capxul doc list "Purchase Invoice" --json`),
];

export const docGet = [
  ok("Read one Purchase Invoice", `capxul doc get "Purchase Invoice" ACC-PINV-2026-00001 --json`, invoice(0)),
  refused("A document that does not exist", `capxul doc get "Purchase Invoice" ACC-PINV-2026-09999 --json`, error_INVALID_INPUT),
  noUser(`capxul doc get "Purchase Invoice" ACC-PINV-2026-00001 --json`),
];

export const docCreate = [
  ok("Hannah adds Brightside as a supplier", `capxul doc create Supplier --field supplier_name="Brightside Cleaning" --json`, {
    doctype: "Supplier",
    name: "Brightside Cleaning",
    docstatus: 0,
    fields: { supplier_name: "Brightside Cleaning", supplier_group: "Services", email_id: "accounts@brightside.test" },
  }),
  refused("A required field is missing", "capxul doc create Supplier --json", error_INVALID_INPUT),
  noUser(`capxul doc create Supplier --field supplier_name="Brightside Cleaning" --json`),
];

export const docUpdate = [
  ok("Add a remark to the draft invoice", `capxul doc update "Purchase Invoice" ACC-PINV-2026-00001 --field remarks="January cleaning" --json`, {
    ...invoice(0),
    fields: { ...invoice(0).fields, remarks: "January cleaning" },
  }),
  refused("The invoice is already submitted", `capxul doc update "Purchase Invoice" ACC-PINV-2026-00002 --field remarks="January cleaning" --json`, error_WRONG_STATE),
];

export const docDelete = [
  ok("Delete a draft", `capxul doc delete "Purchase Invoice" ACC-PINV-2026-00003 --json`, { deleted: true }),
  refused("The invoice is submitted", `capxul doc delete "Purchase Invoice" ACC-PINV-2026-00002 --json`, error_WRONG_STATE),
];

export const docSubmit = [
  ok("Submit the invoice: Frappe posts it", `capxul doc submit "Purchase Invoice" ACC-PINV-2026-00001 --json`, invoice(1)),
  ok("Submit the payment: it is held for the signer", `capxul doc submit "Payment Entry" ACC-PAY-2026-00001 --json`, {
    held: true,
    requestId: uuid(501),
    approvalId: ID.approval,
    awaiting: ADDRESS.marcus,
  }),
  refused("The document is not a draft", `capxul doc submit "Purchase Invoice" ACC-PINV-2026-00002 --json`, error_WRONG_STATE),
];

export const docCancel = [
  ok("Cancel a submitted invoice", `capxul doc cancel "Purchase Invoice" ACC-PINV-2026-00002 --json`, invoice(2, "ACC-PINV-2026-00002")),
  refused("The payment already went out", `capxul doc cancel "Payment Entry" ACC-PAY-2026-00001 --json`, error_WRONG_STATE),
];

export const docAmend = [
  ok("Amend the cancelled invoice into a new draft", `capxul doc amend "Purchase Invoice" ACC-PINV-2026-00002 --json`, invoice(0, "ACC-PINV-2026-00002-1")),
  refused("The invoice was not cancelled", `capxul doc amend "Purchase Invoice" ACC-PINV-2026-00001 --json`, error_WRONG_STATE),
];

export const docCall = [
  ok("Approve an expense claim through its workflow", `capxul doc call "Expense Claim" EXP-2026-00001 --action Approve --json`, {
    doctype: "Expense Claim",
    name: "EXP-2026-00001",
    docstatus: 0,
    fields: { employee: "Priya Raman", total_claimed_amount: "42.00", workflow_state: "Approved" },
  }),
  refused("The workflow allows no such action in this state", `capxul doc call "Expense Claim" EXP-2026-00001 --action Approve --json`, error_WRONG_STATE),
];

export const docNext = [
  ok(
    "Turn the purchase order into an invoice draft",
    `capxul doc next "Purchase Order" PUR-ORD-2026-00001 --to "Purchase Invoice" --json`,
    { doctype: "Purchase Invoice", name: "new-purchase-invoice-1", docstatus: 0, fields: { supplier: "Brightside Cleaning", grand_total: "125.50" } },
  ),
  refused("The source cannot be mapped to that target", `capxul doc next "Purchase Order" PUR-ORD-2026-00001 --to "Sales Invoice" --json`, error_WRONG_STATE),
];

export const reportList = [
  ok("The reports Marcus can run", "capxul report list --json", {
    reports: [
      { report: "General Ledger", module: "Accounts", feature: "accounts", reachable: true },
      { report: "Stock Balance", module: "Stock", feature: "stock", reachable: false },
    ],
  }),
  switchedOff("capxul report list --json"),
];

export const reportRun = [
  ok("Run the General Ledger for the Safe's account", `capxul report run "General Ledger" --filter account="Capxul Safe" --json`, {
    columns: [
      { fieldname: "posting_date", label: "Date" },
      { fieldname: "voucher_no", label: "Voucher" },
      { fieldname: "debit", label: "Debit" },
      { fieldname: "credit", label: "Credit" },
    ],
    rows: [{ posting_date: "2026-02-03", voucher_no: "ACC-PAY-2026-00001", debit: "0.00", credit: "125.50" }],
  }),
  refused("No such report", `capxul report run "Ledger of Everything" --json`, error_INVALID_INPUT),
];
