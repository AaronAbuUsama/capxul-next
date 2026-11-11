import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBlueprint, defineConcept, defineDecision, defineDoctype, defineRole } from "../src/index.ts";

const concept = defineConcept({ id: "plugs", title: "Plugs", about: "The site app.", component: { _kind: "component", id: "c" } as never, dependsOn: [], lines: 1 });
const build = (records: readonly unknown[]) => buildBlueprint({ name: "t", stage: "as-is", records: [concept, ...records] });
const found = (xs: readonly { record: string; rule: string; detail: string }[], rule: string) => xs.filter((x) => x.rule === rule).map((x) => `${x.record}: ${x.detail}`);

const user = defineDoctype({ id: "user", title: "User", about: "Frappe's user.", concept, name: "User", app: "frappe", fields: [] });
const hatRole = defineDoctype({ id: "capxul-hat-role", title: "Hat role", about: "One role of a hat.", concept, name: "Capxul Hat Role", app: "capxul", child: true, fields: [{ name: "role", type: "Data", required: true }] });

test("a DocType links to the DocTypes its Link and Table fields name, so a change to one shows who it reaches", () => {
  const grant = defineDoctype({
    id: "capxul-hat-grant", title: "Hat grant", about: "A hat applied to a user.", concept, name: "Capxul Hat Grant", app: "capxul", naming: "hash",
    fields: [{ name: "user", type: "Link", link: user, required: true }, { name: "roles", type: "Table", link: hatRole }],
  });
  const b = build([user, hatRole, grant]);
  assert.deepEqual(found(b.problems, "doctype-field"), []);
  assert.deepEqual((b.linkedBy.get("doctype:user") ?? []).map((l) => l.from), ["doctype:capxul-hat-grant"]);
  assert.deepEqual(found(b.gaps, "unused-child-doctype"), []);
});

test("a field's type and its link must agree, and a Select has options", () => {
  const bad = defineDoctype({
    id: "bad", title: "Bad", about: "Every wrong field.", concept, name: "Bad", app: "capxul",
    fields: [
      { name: "a", type: "Link" }, { name: "b", type: "Data", link: user }, { name: "c", type: "Table", link: user },
      { name: "d", type: "Link", link: hatRole }, { name: "e", type: "Select" }, { name: "e", type: "Data" },
    ],
  });
  assert.deepEqual(found(build([user, hatRole, bad]).problems, "doctype-field"), [
    "doctype:bad: a is a Link and names no DocType",
    "doctype:bad: b is Data, which links to no DocType",
    "doctype:bad: c holds rows of user, which is not a child DocType",
    "doctype:bad: d links to capxul-hat-role, a child DocType, which has no documents of its own",
    "doctype:bad: e is a Select with no options",
    "doctype:bad: e is listed twice",
  ]);
});

test("two records for one DocType is a problem; a child no Table holds and a change the code owes a decision are gaps", () => {
  const retire = defineDecision({ id: "x.retire", title: "Retire", question: "Keep?", options: [{ label: "go", text: "Remove it." }], chosen: "go", why: "w", source: "s", affects: [] });
  const twin = defineDoctype({ id: "user-again", title: "User", about: "Again.", concept, name: "User", app: "frappe", fields: [], owes: [{ decision: retire, change: "remove it" }] });
  const b = build([user, hatRole, twin, retire]);
  assert.deepEqual(found(b.problems, "doctype-name"), ["doctype:user-again: user is already the DocType User"]);
  assert.deepEqual(found(b.gaps, "unused-child-doctype"), ["doctype:capxul-hat-role: no Table field holds its rows"]);
  assert.deepEqual(found(b.gaps, "owed-change"), ["doctype:user-again: x.retire: remove it"]);
});

test("a role gives each Frappe role once", () => {
  const role = defineRole({ id: "budget-holder", title: "Budget holder", about: "Spends a budget.", concept, frappeRoles: ["Accounts User", "Accounts User"] });
  assert.deepEqual(found(build([role]).problems, "role-frappe-roles"), ["role:budget-holder: Accounts User is listed twice"]);
  assert.throws(() => defineRole({ id: "empty", title: "Empty", about: "None.", concept, frappeRoles: [] }), /^Error: role empty in /);
});
