// The parts of the product a site switches on and off (sites.features-reachability), as the site app has them
// (packages/frappe-app/capxul/features.py, CATALOG). `pnpm frappe:check-blueprint` fails the merge on any difference.
// HRMS keeps the split features' DocTypes in HR, so explicit DocTypes close them without closing staff, leave and expenses.

import { defineFeature } from "../../packages/blueprint-engine/src/index.ts";
import { concept_sites } from "../shared/foundation.ts";

const concept = concept_sites;

export const feature_accounts = defineFeature({
  id: "accounts", title: "Accounts", about: "The books, banking and payments: ERPNext's Accounts module.", concept,
  label: "Accounts", default: "on", modules: ["Accounts"],
});
export const feature_people = defineFeature({
  id: "people", title: "People", about: "Staff records, leave and expenses: Frappe HR's people modules.", concept,
  label: "People (HR)", default: "on",
  modules: ["HR", "Tax and Benefits", "Expenses", "Leaves", "Tenure", "HR Setup"],
});
export const feature_payroll = defineFeature({
  id: "payroll", title: "Payroll", about: "Payroll runs: Frappe HR's Payroll module and its API.", concept,
  label: "Payroll", default: "off", modules: ["Payroll"], prefixes: ["hrms.payroll."],
});
export const feature_attendance = defineFeature({
  id: "attendance", title: "Attendance", about: "Shift assignments, check-ins and attendance; shared staff and project timesheets stay reachable.", concept,
  label: "Attendance", default: "off", modules: ["Shift and Attendance"],
  doctypes: ["Attendance", "Attendance Request", "Employee Checkin", "Employee Attendance Tool", "Shift Assignment", "Shift Assignment Tool", "Shift Request", "Shift Type", "Shift Location", "Shift Schedule", "Shift Schedule Assignment", "Overtime Type", "Overtime Slip", "Overtime Details"],
  paths: ["/hr/roster"],
});
export const feature_recruitment = defineFeature({
  id: "recruitment", title: "Recruitment", about: "Job openings, applicants, interviews and offers; shared Employee and Skill records stay reachable.", concept,
  label: "Recruitment", default: "off", modules: ["Recruitment"],
  doctypes: ["Job Opening", "Job Opening Template", "Job Applicant", "Job Applicant Source", "Job Requisition", "Job Offer", "Job Offer Term", "Job Offer Term Template", "Offer Term", "Interview", "Interview Round", "Interview Type", "Interview Detail", "Interviewer", "Interview Feedback", "Employee Referral", "Staffing Plan", "Staffing Plan Detail", "Appointment Letter", "Appointment Letter Template", "Appointment Letter Content"],
  paths: ["/jobs"],
});
export const feature_reviews = defineFeature({
  id: "reviews", title: "Reviews", about: "Goals, appraisals and employee performance feedback.", concept,
  label: "Reviews", default: "off", modules: ["Performance"],
  doctypes: ["Goal", "Appraisal", "Appraisal Cycle", "Appraisal Template", "Appraisal KRA", "Appraisal Goal", "Appraisal Template Goal", "Appraisee", "KRA", "Employee Performance Feedback", "Employee Feedback Criteria", "Employee Feedback Rating"],
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
