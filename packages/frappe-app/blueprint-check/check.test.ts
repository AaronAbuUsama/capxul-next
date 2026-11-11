// node --experimental-strip-types --no-warnings --test packages/frappe-app/blueprint-check/check.test.ts
// The comparison rules, on small fixtures: no blueprint, no Frappe.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { compareSite, type Code, type DoctypeRecord, type FeatureRecord, type RoleRecord } from "./compare.ts";

const user: DoctypeRecord = { id: "user", name: "User", app: "frappe", fields: [] };
const grant: DoctypeRecord = {
  id: "grant", name: "Capxul Hat Grant", app: "capxul", naming: "hash",
  fields: [{ name: "user", type: "Link", link: user, required: true }, { name: "state", type: "Select", options: ["A", "B"], default: "A" }],
  permissions: [{ role: "System Manager", read: true, write: true, create: true, delete: true }],
};
const grantJson = {
  name: "Capxul Hat Grant", autoname: "hash",
  fields: [{ fieldname: "user", fieldtype: "Link", options: "User", reqd: 1 }, { fieldname: "state", fieldtype: "Select", options: "A\nB", default: "A" }],
  permissions: [{ role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1 }],
};
const member: RoleRecord = { id: "member", frappeRoles: ["Employee"] };
const code = (over: Partial<Code> = {}): Code => ({ doctypes: [grantJson], customFields: {}, hatRoles: { member: ["Employee"] }, features: {}, ...over });
const run = (doctypes: DoctypeRecord[], roles: RoleRecord[], c: Code, features: FeatureRecord[] = []) => compareSite({ doctypes, roles, features }, c).failures;

test("a blueprint that says what the code says has no differences", () => {
  assert.deepEqual(run([user, grant], [member], code()), []);
});

test("a DocType on one side only is a difference, both ways", () => {
  assert.deepEqual(run([user], [member], code()), ["DocType Capxul Hat Grant: the code defines it; the blueprint has no record of it"]);
  assert.deepEqual(run([user, grant], [member], code({ doctypes: [] })), ["DocType Capxul Hat Grant: the blueprint records it (doctype:grant); the code does not define it"]);
});

test("a field's type, link, options, flags and default are compared, and so are naming and permissions", () => {
  const json = {
    ...grantJson, autoname: "field:user",
    fields: [{ fieldname: "user", fieldtype: "Link", options: "Role" }, { fieldname: "state", fieldtype: "Select", options: "A\nC", default: "B" }, { fieldname: "extra", fieldtype: "Data" }],
    permissions: [{ role: "System Manager", read: 1 }],
  };
  assert.deepEqual(run([user, grant], [member], code({ doctypes: [json] })), [
    'DocType Capxul Hat Grant: naming is "hash" in the blueprint and "field:user" in the code',
    "DocType Capxul Hat Grant: the code has field extra; the blueprint does not",
    'DocType Capxul Hat Grant.user: link is "User" in the blueprint and "Role" in the code',
    "DocType Capxul Hat Grant.user: required is true in the blueprint and false in the code",
    'DocType Capxul Hat Grant.state: options is ["A","B"] in the blueprint and ["A","C"] in the code',
    'DocType Capxul Hat Grant.state: default is "A" in the blueprint and "B" in the code',
    "DocType Capxul Hat Grant: permissions are [System Manager:read+write+create+delete] in the blueprint and [System Manager:read] in the code",
  ]);
});

test("fields in another order, a single and a child table are differences", () => {
  const json = { ...grantJson, issingle: 1, istable: 1, fields: [...grantJson.fields].reverse() };
  assert.deepEqual(run([user, grant], [member], code({ doctypes: [json] })), [
    "DocType Capxul Hat Grant: single is false in the blueprint and true in the code",
    "DocType Capxul Hat Grant: child is false in the blueprint and true in the code",
    "DocType Capxul Hat Grant: the fields are in another order (code: state, user)",
  ]);
});

test("Custom Fields on Frappe's DocTypes are compared with the record of that DocType", () => {
  const supplier: DoctypeRecord = { id: "supplier", name: "Supplier", app: "erpnext", fields: [{ name: "capxul_wallet_address", type: "Data" }] };
  assert.deepEqual(run([user, grant, supplier], [member], code({ customFields: { Supplier: [{ fieldname: "capxul_wallet_address", fieldtype: "Data" }] } })), []);
  assert.deepEqual(run([user, grant, supplier], [member], code({ customFields: { Supplier: [{ fieldname: "capxul_wallet_address", fieldtype: "Data", read_only: 1 }], Customer: [] } })), [
    "Custom Fields on Supplier.capxul_wallet_address: readOnly is false in the blueprint and true in the code",
    "DocType Customer: the code adds Custom Fields to it; the blueprint has no record of it",
  ]);
  assert.deepEqual(run([user, grant, supplier], [member], code()), ["Custom Fields on Supplier: the blueprint records 1; the code adds none"]);
});

test("a hat's Frappe roles are compared with the code's hat map, both ways", () => {
  assert.deepEqual(run([user, grant], [{ id: "member", frappeRoles: ["Employee", "HR User"] }, { id: "sales", frappeRoles: ["Sales User"] }], code({ hatRoles: { member: ["Employee"], admin: ["System Manager"] } })), [
    "hat member: the blueprint gives HR User; the code does not",
    "hat admin: the code's hat map has it; the blueprint has no role record",
    "hat sales: the blueprint records it (role:sales); the code's hat map does not",
  ]);
});

test("read_setup.py reads the hat map and the Custom Fields from source, dict() calls included", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-"));
  writeFileSync(join(dir, "setup.py"), 'import frappe\nDEFAULT_HAT_ROLES = {"member": ["Employee"]}\nCUSTOM_FIELDS = {"GL Entry": [dict(fieldname="t", fieldtype="Data", read_only=1)]}\n');
  const py = spawnSync("python3", [join(dirname(fileURLToPath(import.meta.url)), "read_setup.py"), join(dir, "setup.py"), "DEFAULT_HAT_ROLES", "CUSTOM_FIELDS"], { encoding: "utf8" });
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(JSON.parse(py.stdout), { DEFAULT_HAT_ROLES: { member: ["Employee"] }, CUSTOM_FIELDS: { "GL Entry": [{ fieldname: "t", fieldtype: "Data", read_only: 1 }] } });
});

test("a feature's label, default, modules, apps, routes and needs are compared with the code's catalog, both ways", () => {
  const crm: FeatureRecord = { id: "crm", label: "CRM", default: "on", apps: ["crm"], app: "crm" };
  const wa: FeatureRecord = { id: "whatsapp", label: "WhatsApp", default: "off", needs: [crm] };
  const catalog = { crm: { label: "CRM", apps: ["crm"], app: "crm", default: 1 }, whatsapp: { label: "WhatsApp", needs: ["crm"], default: 0 } };
  assert.deepEqual(run([user, grant], [member], code({ features: catalog }), [crm, wa]), []);
  assert.deepEqual(run([user, grant], [member], code({ features: { ...catalog, crm: { ...catalog.crm, default: 0, paths: ["/crm"] }, stock: { label: "Stock", default: 0 } } }), [crm, wa, { id: "gone", label: "Gone", default: "off" }]), [
    'feature crm: default is "on" in the blueprint and "off" in the code',
    'feature crm: paths is nothing in the blueprint and ["/crm"] in the code',
    "feature stock: the code's catalog has it; the blueprint has no feature record",
    "feature gone: the blueprint records it (feature:gone); the code's catalog does not",
  ]);
});
