import assert from "node:assert/strict";
import test from "node:test";
import { encode, type StoreInput } from "./codec.ts";

const a = "0x1111111111111111111111111111111111111111";
const b = "0x2222222222222222222222222222222222222222";
const token = "0x3333333333333333333333333333333333333333";
const base: StoreInput = {
  owner_kind: "person", owner_id: "person-vector", subject: { kind: "payment", id: "payment-vector-1" },
  chain_id: 84532, issued_at: 1700000000123, participants: [{ safe: a, party_id: null, role: "payer" }],
  content: { kind: "memo", basis: "payment", reference: "ref-7", note: "Café", amount: { token_address: token, decimals: 6, amount_raw: "1234501" }, source: a, destination: b },
};

test("new v1 document bytes and EIP712 hashes match independently ABI-encoded cast vectors", () => {
  // Generated with cast keccak + cast abi-encode, not viem/hashTypedData or this encoder.
  const bytes = '{"content":{"amount":{"amount_raw":"1234501","decimals":6,"token_address":"0x3333333333333333333333333333333333333333"},"basis":"payment","destination":"0x2222222222222222222222222222222222222222","kind":"memo","note":"Café","reference":"ref-7","source":"0x1111111111111111111111111111111111111111"},"issuedAt":1700000000123,"kind":"memo","originId":"0x74d6badf49c72b53bb4c7a30cf28adf8fa9fe424901ad0889657b50af4e49727","version":1}';
  const result = encode(base);
  assert.equal(result.bytes.toString("utf8"), bytes);
  assert.equal(result.content_hash, "0x600b272f9f2f69b50c9df38e6de94623ee652a294570021d44f8cfd188447ec0");
  assert.equal(result.document_hash, "0xe77ad17aa7d906725dfae193f8470ec103fdfd8cbfc687dc26899bcc0011469e");
  assert.notEqual(encode({ ...base, chain_id: 8453 }).document_hash, result.document_hash);
  assert.notEqual(encode({ ...base, subject: { kind: "movement", id: base.subject.id } }).document_hash, result.document_hash);
});

test("invoice arithmetic is exact above Number precision; lines and terms retain their order", () => {
  const invoice: StoreInput = { ...base, content: {
    kind: "invoice", invoice_number: "INV-7", payer: { safe: a, party_id: null }, payee: { safe: b, party_id: null },
    amount: { token_address: token, decimals: 6, amount_raw: "27021597764222980" }, due_at: null, note: "",
    lines: [{ description: "large", quantity: 3, unit_amount_raw: "9007199254740993" }, { description: "small", quantity: 1, unit_amount_raw: "1" }],
  } };
  const good = encode(invoice);
  if (invoice.content.kind !== "invoice") throw new Error("fixture");
  const content = invoice.content;
  assert.throws(() => encode({ ...invoice, content: { ...content, amount: { ...content.amount, amount_raw: "27021597764222979" } } }), /add up/);
  assert.notEqual(encode({ ...invoice, content: { ...content, lines: [...content.lines].reverse() } }).document_hash, good.document_hash);
  const terms: StoreInput = { ...base, content: { kind: "terms", title: "Offer", parties: [{ safe: a, party_id: null, role: "issuer" }], lines: [{ label: "First", value: "one" }, { label: "Second", value: "two" }] } };
  const encoded = encode(terms);
  assert.equal(JSON.parse(encoded.bytes.toString()).content.lines[0].label, "First");
});

test("receipts retain exact bytes; new payroll stores and malformed content are refused", () => {
  const bytes = Buffer.from('{ "answer": 7 }');
  const receipt = encode({ ...base, content: { kind: "receipt", media_type: "application/json", bytes, filename: "proof.json" } });
  assert.deepEqual(receipt.bytes, bytes); assert.equal(receipt.document_hash, receipt.content_hash);
  assert.throws(() => encode({ ...base, content: { kind: "receipt", media_type: "application/pdf", bytes, filename: null } }), /PDF/);
  assert.throws(() => encode({ ...base, content: { kind: "payslip" } } as unknown as StoreInput), /unsupported/);
  assert.throws(() => encode({ ...base, subject: { kind: "salary-slip", id: "slip-1" } } as unknown as StoreInput), /subject/);
  assert.throws(() => encode({ ...base, participants: [] }), /list/);
});
