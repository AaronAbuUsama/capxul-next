import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBlueprint, defineConcept, defineDoctype, defineFeature, defineRole, defineScreen } from "../src/index.ts";

const concept = defineConcept({ id: "sites", title: "Sites", about: "The site.", component: { _kind: "component", id: "c" } as never, dependsOn: [], lines: 1 });
const entry = defineDoctype({ id: "payment-entry", title: "Payment Entry", about: "A payment.", concept, name: "Payment Entry", app: "erpnext", fields: [{ name: "capxul_status", type: "Data" }] });
const director = defineRole({ id: "admin", title: "Director", about: "Runs it.", concept, frappeRoles: ["System Manager"] });
const accounts = defineFeature({ id: "accounts", title: "Accounts", about: "The books.", concept, label: "Accounts", default: "on" });
const build = (records: readonly unknown[]) => buildBlueprint({ name: "t", stage: "as-is", records: [concept, entry, director, accounts, ...records] });

test("a screen's values come from fields their source has, and its states allow only its own actions", () => {
  const bad = defineScreen({
    id: "payment-entry.form", title: "Payment Entry", about: "The form.", surface: "frappe-desk", kind: "form", record: entry,
    shows: [{ label: "Status", from: entry, field: "capxul_status" }, { label: "Hash", from: entry, field: "tx_hash" }],
    actions: [{ name: "submit", runs: "Frappe's Submit" }], who: [director],
    states: [{ state: "Draft", shows: "Editable", allows: ["submit", "cancel"] }],
  });
  assert.deepEqual(build([bad]).problems.filter((p) => p.rule === "screen-shape").map((p) => p.detail), [
    '"Hash" reads tx_hash, which doctype:payment-entry does not have',
    "state Draft allows cancel, which is not one of its actions",
  ]);
});

test("a screen derives shows, refuses, one eval per button, and off for a screen in a part", () => {
  const form = defineScreen({
    id: "payment-entry.form", title: "Payment Entry", about: "The form.", surface: "frappe-desk", kind: "form", record: entry,
    shows: [{ label: "Status", from: entry, field: "capxul_status" }], actions: [{ name: "submit", runs: "Frappe's Submit" }], who: [director], feature: accounts,
  });
  const b = build([form]);
  assert.deepEqual(b.problems.filter((p) => p.rule !== "dangling"), []);
  assert.deepEqual(b.evals.filter((e) => e.id.startsWith("scr:")).map((e) => e.id), [
    "scr:payment-entry.form/shows", "scr:payment-entry.form/refuses", "scr:payment-entry.form/action/submit", "scr:payment-entry.form/off",
  ]);
  assert.deepEqual((b.linkedBy.get("role:admin") ?? []).map((l) => `${l.from} ${l.field}`), ["screen:payment-entry.form who"]);
});
