// node --experimental-strip-types --no-warnings --test packages/contracts/abi-check/abi-check.test.ts
// The comparison rules, on small fixtures: no book, no build.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { compareContracts, type BookContract, type CodeContract, type Input } from "./compare.ts";
import { parseSignature, renderBook, signatureMismatches, type AbiEntry } from "./signature.ts";
import { sourceHash } from "./source-hash.ts";

const p = (type: string, name: string, extra: object = {}) => ({ type, name, ...extra });
const fn = (name: string, inputs: object[], outputs: object[] = [], stateMutability = "nonpayable"): AbiEntry =>
  ({ type: "function", name, inputs, outputs, stateMutability }) as AbiEntry;
const ev = (name: string, inputs: object[]): AbiEntry => ({ type: "event", name, inputs }) as AbiEntry;
const er = (name: string, inputs: object[] = []): AbiEntry => ({ type: "error", name, inputs }) as AbiEntry;

const code = (abi: AbiEntry[], name = "Vault"): CodeContract => ({ name, kind: "contract", abi });
const book = (over: Partial<BookContract> = {}): BookContract => ({
  id: "vault", code: "built", artifact: "Vault", functions: {}, events: {}, errors: {}, ...over,
});
const input = (b: BookContract[], c: CodeContract[], over: Partial<Input> = {}): Input => ({
  book: b, code: c, deployed: c.map((x) => x.name), allowances: [], decisions: {}, ...over,
});
const kinds = (i: Input) => compareContracts(i).failures.map((f) => f.kind);

test("a signature is read: name, arguments, mutability, returns, indexed", () => {
  const s = parseSignature("Spent(address indexed safe, uint256 amount)");
  assert.equal(s.name, "Spent");
  assert.deepEqual(s.params.map((x) => [x.type.base, x.indexed, x.name]), [["address", true, "safe"], ["uint256", false, "amount"]]);
  const f = parseSignature("leftOf(uint256 id) view returns (uint128)");
  assert.equal(f.mutability, "view");
  assert.equal(f.returns.length, 1);
  assert.equal(parseSignature("collect()").mutability, "nonpayable");
});

test("a tuple written out in the book is read, with its array", () => {
  const s = parseSignature("sendBatch((bytes32 id, address to)[] items)");
  assert.equal(s.params.length, 1);
  assert.equal(s.params[0]!.type.arrays, "[]");
  assert.equal(s.params[0]!.type.tuple!.length, 2);
  assert.equal(renderBook(s), "sendBatch((bytes32 id, address to)[] items)");
});

test("a book that matches the code has no difference", () => {
  const abi = [fn("get", [p("uint256", "id")], [p("uint128", "")], "view"), ev("Set", [p("address", "who", { indexed: true })]), er("Nope", [p("uint256", "id")])];
  const b = book({
    functions: { get: { signature: "get(uint256 id) view returns (uint128)" } },
    events: { Set: { signature: "Set(address indexed who)" } },
    errors: { Nope: { signature: "Nope(uint256 id)" } },
  });
  const r = compareContracts(input([b], [code(abi)]));
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.compared, { contracts: 1, functions: 1, events: 1, errors: 1 });
});

test("a function, event or error missing from the book, or from the code, is a difference", () => {
  const abi = [fn("get", []), ev("Set", []), er("Nope")];
  assert.deepEqual(kinds(input([book()], [code(abi)])), ["missing-in-book", "missing-in-book", "missing-in-book"]);
  const b = book({ functions: { gone: { signature: "gone()" } }, events: { Gone: { signature: "Gone()" } }, errors: { Gone: { signature: "Gone()" } } });
  assert.deepEqual(kinds(input([b], [code([])])), ["missing-in-code", "missing-in-code", "missing-in-code"]);
});

test("a type, an order, a mutability, an indexed flag or a return that differs is a difference", () => {
  const one = (sig: string, entry: AbiEntry) => signatureMismatches(parseSignature(sig), entry);
  const f = fn("send", [p("address", "to"), p("uint256", "amount")], [], "nonpayable");
  assert.deepEqual(one("send(address to, uint256 amount)", f), []);
  assert.match(one("send(uint256 amount, address to)", f).join(), /argument 1/);
  assert.match(one("send(address to, uint128 amount)", f).join(), /argument 2.*uint128 against uint256/);
  assert.match(one("send(address to, uint256 amount) view", f).join(), /mutability view in the book, nonpayable/);
  assert.match(one("send(address to)", f).join(), /1 in the book, 2 in the code/);
  assert.match(one("send(address to, uint256 amount) returns (bool)", f).join(), /return: 1 in the book, 0/);
  const e = ev("Set", [p("address", "who", { indexed: true })]);
  assert.match(one("Set(address who)", e).join(), /indexed in the code, not in the book/);
  assert.match(one("Set(address indexed who)", ev("Set", [p("address", "who")])).join(), /indexed in the book, not in the code/);
  assert.match(one("other(address to, uint256 amount)", f).join(), /name other against send/);
});

test("structs and enums compare by name, a contract-typed address as an address, a tuple field by field", () => {
  const st = p("tuple", "b", { internalType: "struct IVault.Budget", components: [p("address", "safe")] });
  const en = p("uint8", "state", { internalType: "enum IVault.State" });
  const ct = p("address", "pay", { internalType: "contract IPayments" });
  const f = fn("x", [st, en, ct]);
  assert.deepEqual(signatureMismatches(parseSignature("x(Budget b, State state, address pay)"), f), []);
  assert.deepEqual(signatureMismatches(parseSignature("x(Budget b, uint8 state, IPayments pay)"), f), []);
  assert.match(signatureMismatches(parseSignature("x(Other b, State state, address pay)"), f).join(), /struct Other against struct Budget/);
  assert.deepEqual(signatureMismatches(parseSignature("x((address safe) b, State state, address pay)"), f), []);
  assert.match(signatureMismatches(parseSignature("x((address safe, bool extra) b, State state, address pay)"), f).join(), /2 fields against 1/);
});

test("a record built from a contract the code lacks, or a deployed contract no record describes, is a difference", () => {
  assert.deepEqual(kinds(input([book({ artifact: "Missing" })], [code([])])), ["unknown-artifact", "code-without-book"]);
  assert.deepEqual(kinds(input([book({ code: "designed" })], [])), ["contract-without-code"]);
  assert.deepEqual(kinds(input([], [code([])])), ["code-without-book"]);
  assert.deepEqual(kinds(input([book({ code: undefined })], [code([])])), ["undeclared-code", "code-without-book"]);
  assert.deepEqual(kinds(input([book()], [code([]), code([], "Hidden")], { deployed: ["Vault"] })), ["not-deployed"]);
  assert.deepEqual(kinds(input([book()], [code([])], { deployed: ["Vault", "Ghost"] })), ["unknown-artifact"]);
});

test("a third-party record is listed, not compared; a library with code is not deployed", () => {
  const r = compareContracts(input([book({ id: "safe", code: "third-party", artifact: undefined, functions: { nope: { signature: "nope()" } } })], []));
  assert.deepEqual(r.thirdParty, ["safe"]);
  assert.deepEqual(r.failures, []);
  const lib: CodeContract = { name: "Lib", kind: "library", abi: [] };
  assert.deepEqual(compareContracts(input([], [lib], { deployed: [] })).failures, []);
});

test("a difference stands only where a decision names it, and the allowance must still be needed", () => {
  const designed = book({ id: "escrow", code: "designed" });
  const decisions = { "contracts.x": "The general escrow, `escrow`, is designed and not built." };
  const ok = compareContracts(input([designed], [], { allowances: [{ subject: "book:escrow", decision: "contracts.x" }], decisions }));
  assert.deepEqual(ok.failures, []);
  assert.equal(ok.allowed.length, 1);
  assert.equal(ok.allowed[0]!.decision, "contracts.x");

  const silent = compareContracts(input([designed], [], { allowances: [{ subject: "book:escrow", decision: "contracts.x" }], decisions: { "contracts.x": "Nothing relevant." } }));
  assert.equal(silent.failures.length, 2, "the difference stands unexplained and the allowance names nothing");

  const absent = compareContracts(input([designed], [], { allowances: [{ subject: "book:escrow", decision: "contracts.gone" }] }));
  assert.ok(absent.failures.some((f) => /not in the book/.test(f.message)));

  const stale = compareContracts(input([], [], { allowances: [{ subject: "book:escrow", decision: "contracts.x" }], decisions }));
  assert.match(stale.failures[0]!.message, /covers no difference/);
});

test("an allowance on a contract covers its members; one member's allowance covers only that member", () => {
  const abi = [fn("a", []), fn("b", [])];
  const text = { "d.one": "vault and b are named here", "d.two": "vault is named here" };
  const member = compareContracts(input([book()], [code(abi)], { allowances: [{ subject: "book:vault.function.b", decision: "d.one" }], decisions: text }));
  assert.deepEqual(member.failures.map((f) => f.subject), ["book:vault.function.a"]);
  const whole = compareContracts(input([book()], [code(abi)], { allowances: [{ subject: "book:vault", decision: "d.two" }], decisions: text }));
  assert.deepEqual(whole.failures, []);
  assert.equal(whole.allowed.length, 2);
});

test("the source hash moves with any contract file, the manifest or the build config", () => {
  const dir = mkdtempSync(join(tmpdir(), "contracts-"));
  mkdirSync(join(dir, "src/money"), { recursive: true });
  mkdirSync(join(dir, "deploy"));
  writeFileSync(join(dir, "src/money/A.sol"), "contract A {}");
  writeFileSync(join(dir, "deploy/manifest.json"), "{}");
  writeFileSync(join(dir, "foundry.toml"), "[profile.default]");
  const a = sourceHash(dir);
  assert.equal(sourceHash(dir), a);
  writeFileSync(join(dir, "src/money/A.sol"), "contract A { uint x; }");
  const b = sourceHash(dir);
  assert.notEqual(b, a);
  writeFileSync(join(dir, "deploy/manifest.json"), '{"contracts":[]}');
  assert.notEqual(sourceHash(dir), b);
});
