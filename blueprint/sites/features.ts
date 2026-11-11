// The parts of the product a site switches on and off (sites.features-reachability), as the site app has them
// (packages/frappe-app/capxul/features.py, CATALOG). `pnpm frappe:check-blueprint` fails the merge on any difference.
// Where the app still differs from the decision, the record says what the app does and `owes` names the change.

import { defineFeature } from "../../packages/blueprint-engine/src/index.ts";
import { concept_sites } from "../shared/foundation.ts";
import { decision_sites_features_reachability as reach } from "./decisions.ts";

const concept = concept_sites;

export const feature_accounts = defineFeature({
  id: "accounts", title: "Accounts", about: "The books, banking and payments: ERPNext's Accounts module.", concept,
  label: "Accounts", default: "on", modules: ["Accounts"],
});
export const feature_people = defineFeature({
  id: "people", title: "People", about: "Staff records, leave and expenses: Frappe HR's people modules.", concept,
  label: "People (HR)", default: "on",
  modules: ["HR", "Tax and Benefits", "Performance", "Expenses", "Leaves", "Shift and Attendance", "Recruitment", "Tenure", "HR Setup"],
  owes: [{ decision: reach, change: "Split attendance (Shift and Attendance), recruitment (Recruitment) and reviews (Performance) into parts of their own, off by default." }],
});
export const feature_payroll = defineFeature({
  id: "payroll", title: "Payroll", about: "Payroll runs: Frappe HR's Payroll module and its API.", concept,
  label: "Payroll", default: "on", modules: ["Payroll"], prefixes: ["hrms.payroll."],
  owes: [{ decision: reach, change: "Off by default until the first jurisdiction and its payroll support are chosen (aaron.jurisdiction-open); the end-to-end check B5 expects it on today." }],
});
export const feature_projects = defineFeature({
  id: "projects", title: "Projects", about: "Projects and their tasks.", concept,
  label: "Projects", default: "on", modules: ["Projects"], prefixes: ["erpnext.projects."],
});
export const feature_crm = defineFeature({
  id: "crm", title: "CRM", about: "Leads and deals in Frappe CRM, with its own pages.", concept,
  label: "CRM (Frappe CRM)", default: "on", apps: ["crm"], app: "crm", prefixes: ["crm."], paths: ["/crm", "/crm-form"],
});
export const feature_whatsapp = defineFeature({
  id: "whatsapp", title: "WhatsApp", about: "Sending WhatsApp messages from the CRM.", concept,
  label: "WhatsApp", default: "off", apps: ["frappe_whatsapp"], app: "frappe_whatsapp", prefixes: ["frappe_whatsapp."], needs: [feature_crm],
});
export const feature_stock = defineFeature({
  id: "stock", title: "Stock", about: "Stock and warehouses; its shared masters (Item, Price List, UOM) stay reachable when it is off.", concept,
  label: "Stock", default: "off", modules: ["Stock"],
});
export const feature_manufacturing = defineFeature({
  id: "manufacturing", title: "Manufacturing", about: "Bills of materials and work orders.", concept,
  label: "Manufacturing", default: "off", modules: ["Manufacturing"], prefixes: ["erpnext.manufacturing."],
});
