import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Effect } from "effect";
import { accountLabel, organizationFields, parseInput, personalFields } from "../src/books/validation.ts";
import { createFrappeSite } from "../src/plugs/door.ts";

const personal = { actor: { kind: "person" }, reference: { kind: "payment", id: "payment-a" } };

test("personal annotations use only fixed codes and reject retired, forged and native-only fields", () => {
  const fields = personalFields(parseInput({ ...personal, account: "6100", memo: "lunch" }));
  assert.deepEqual(accountLabel(fields.account, fields.account_number),
    { account: "personal_6100", number: "6100", name: "Food and groceries" });
  assert.equal(fields.memo, "lunch");
  assert.deepEqual(personalFields(parseInput(personal)), { account: null, account_number: null,
    party_type: null, party_id: null, cost_center: null, project: null, references: [], suggestion: null, memo: null });
  for (const account of ["6100 - Site account", "9999", "toString", "__proto__"])
    assert.throws(() => personalFields(parseInput({ ...personal, account })), /INVALID_INPUT: account/);
  assert.throws(() => parseInput({ ...personal, category: "food" }), /INVALID_INPUT: category/);
  assert.throws(() => parseInput({ ...personal, actor: { kind: "person", id: "another-person" } }), /INVALID_INPUT/);
  assert.throws(() => parseInput({ ...personal, newAccount: { name: "New", under: "Expenses", company: "Forged" } }), /INVALID_INPUT/);
  assert.throws(() => parseInput({ ...personal, account: "6100", newAccount: { name: "New", under: "Expenses" } }), /mutually exclusive/);
  for (const extra of [{ costCenter: null }, { project: "Main" }, { references: [] }, { party: null },
    { newAccount: { name: "New", under: "Expenses" } }])
    assert.throws(() => personalFields(parseInput({ ...personal, ...extra })), /only for Organization rows/);
});

test("Books validates native account/dimensions through the actual provider without copying a chart", async () => {
  // Wire-protocol fixture, not ERPNext or selected-stack acceptance.
  const created: unknown[] = [];
  const account = { doctype: "Account", name: "6127 - Workshop supplies - NW", docstatus: 0,
    fields: { account_name: "Workshop supplies", account_number: "6127", company: "North Works",
      disabled: 0, is_group: 0, account_type: "Expense Account" } };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    let message: unknown;
    if (req.url === "/api/method/capxul.service.read_site") {
      message = { version: "1", apps: ["erpnext", "capxul"], company: "North Works", features: {},
        map_version: "1", sign_in: { mode: "assertion", configured: true, oauth: false } };
    } else if (req.url === "/api/method/capxul.product_door.account") {
      message = { ok: true, data: { ...account, fields: { ...account.fields,
        ...(body.reference === "receivable" ? { account_type: "Receivable" } : {}),
        ...(body.reference === "wrong-company" ? { company: "South Works" } : {}) } } };
    } else if (body.verb === "create") {
      created.push(body.fields);
      message = { ok: true, data: account };
    } else {
      message = { ok: true, data: { doctype: body.doctype, name: body.name, docstatus: 0,
        fields: { company: body.name === "Wrong company" ? "South Works" : "North Works",
          disabled: 0, is_group: body.doctype === "Account" ? 1 : 0 } } };
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ message }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as import("node:net").AddressInfo).port;
  const provider = createFrappeSite({ baseUrl: `http://127.0.0.1:${port}`, secret: "disposable-wire-fixture" });
  const identity = { orgId: "north", site: "north.local", user: "bookkeeper@example.test", traceId: "books-validation" };
  const input = { actor: { kind: "organization", orgId: "north" }, reference: personal.reference };
  const validate = (extra: object) => Effect.runPromise(organizationFields(parseInput({ ...input, ...extra }), provider, identity, "call-one"));
  try {
    const byNumber = await validate({ account: "6127", costCenter: "Main - NW", project: "Workshop" });
    const byName = await validate({ account: account.name, costCenter: "Main - NW", project: "Workshop" });
    assert.deepEqual(byNumber, byName);
    assert.equal(byNumber.accountName, "Workshop supplies", "display label is not the native document name");
    assert.deepEqual(byNumber.fields, { account: account.name, account_number: "6127", party_type: null, party_id: null,
      cost_center: "Main - NW", project: "Workshop", references: [], suggestion: null, memo: null });
    await assert.rejects(validate({ account: "wrong-company" }), /PROVIDER_RESPONSE_INVALID/);
    await assert.rejects(validate({ account: "receivable" }), /FEATURE_NOT_AVAILABLE/);
    await assert.rejects(validate({ newAccount: { name: "Supplies", under: "Expenses - NW" },
      costCenter: "Wrong company" }), /INVALID_INPUT: Cost Center/);
    await assert.rejects(validate({ newAccount: { name: "Supplies", under: "Expenses - NW" },
      party: { type: "Supplier", id: "party-not-native-name" } }), /FEATURE_NOT_AVAILABLE/);
    assert.deepEqual(created, [], "refused dimensions/mapping must not leave a native Account behind");
    const inline = await validate({ newAccount: { name: "Supplies", under: "Expenses - NW" } });
    assert.equal(inline.fields.account, account.name);
    assert.deepEqual(created, [{ account_name: "Supplies", parent_account: "Expenses - NW", company: "North Works", is_group: 0 }]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
