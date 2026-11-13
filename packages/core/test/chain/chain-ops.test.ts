// Core's three chain operations end to end, served in this process against a local stand-in of a world's chain,
// bundler and database (up.sh): the claims of org.create, org.member.grant and approval.sign that need no site, a
// held payment or a second world, read back from the chain itself. Run with `pnpm --filter @capxul/core chain:test`
// after `test/chain/up.sh`; not part of `pnpm test`, which has no chain.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Values } from "@capxul/blueprint";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";
import * as RpcTest from "effect/rpc/RpcTest";
import * as PgClient from "@effect/sql-pg/PgClient";
import { decodeEventLog, parseAbi, type Hex } from "viem";
import { HATS, SAFE, MINTER } from "../../src/chain/abi.ts";
import { readContract, usdcOf } from "../../src/chain/calls.ts";
import { SEEDED, TIER } from "../../src/chain/seeded.ts";
import { WorldChain } from "../../src/chain/WorldChain.ts";
import { CoreRpcs } from "../../src/door.ts";
import { openPayment } from "../../src/approvals/payments.ts";
import { companiesOf } from "../../src/organizations/site.ts";
import { core, fakeSiteDoor, headersOf, keyOf, makeCast, migrate, services } from "./world.ts";

const urls = {
  rpc: process.env["CHAIN_RPC"] ?? "http://127.0.0.1:28545",
  bundler: process.env["CHAIN_BUNDLER"] ?? "http://127.0.0.1:24337",
  database: process.env["CHAIN_DATABASE"] ?? "postgres://postgres:test@127.0.0.1:25432/postgres",
};
const migration = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
const site = await Effect.runPromise(fakeSiteDoor);
const runtime = ManagedRuntime.make(core(services(urls, site.layer)));
const run = <A, E>(effect: Effect.Effect<A, E, any>) => runtime.runPromise(effect as Effect.Effect<A, E, never>);

type Answer = { readonly exit: Exit.Exit<any, any>; readonly trace: string };
/** One call through Core's world group, as `as` (null: the owner). */
const call = (name: string, payload: unknown, as: string | null): Promise<Answer> => {
  const { trace, headers } = headersOf(as);
  return run(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(CoreRpcs, { flatten: true });
        const send = client as unknown as (tag: string, payload: unknown, options: object) => Effect.Effect<unknown, unknown>;
        return { exit: yield* Effect.exit(send(name, payload, { headers })), trace };
      }),
    ),
  );
};
const ok = async (name: string, payload: unknown, as: string | null) => {
  const { exit, trace } = await call(name, payload, as);
  if (Exit.isFailure(exit)) assert.fail(`${name} failed: ${Cause.pretty(exit.cause)}`);
  return { value: exit.value, trace };
};
const refused = async (name: string, payload: unknown, as: string | null) => {
  const { exit } = await call(name, payload, as);
  assert.ok(Exit.isFailure(exit), `${name} succeeded`);
  const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
  assert.ok(error !== undefined, `${name} died: ${Cause.pretty(exit.cause)}`);
  return error;
};
const events = (trace: string) =>
  run(
    Effect.flatMap(PgClient.PgClient, (sql) =>
      sql<{ readonly event: string; readonly payload: unknown }>`select event, payload from app.events where trace_id = ${trace} order by id`,
    ),
  );
const head = () => run(Effect.flatMap(PgClient.PgClient, (sql) => sql<{ readonly n: string }>`select count(*)::text as n from app.events`)).then((rows) => Number(rows[0]?.n));
const sign = async (approval: Approval, as = approval.signer, key = approval.signer) =>
  call("approval.sign", { approval: approval.id, signature: await keyOf(key).sign({ hash: approval.digest as Hex }) }, as);
const safeOf = (person: string) => run(Effect.flatMap(PgClient.PgClient, (sql) => sql<{ readonly safe: string }>`select safe from app.cast where person = ${person}`)).then((rows) => rows[0]?.safe ?? "");
const receiptLogs = (tx: string) =>
  run(Effect.flatMap(WorldChain, (chain) => chain.rpc("eth_getTransactionReceipt", [tx]))) as Promise<{ logs: Array<{ address: string; topics: Array<Hex>; data: Hex }> }>;

type Approval = typeof Values.Approval.Type;

const FOUNDING = {
  handle: "northwind",
  profile: { name: "Northwind Trading", country: "NL", bio: "We keep offices clean.", size: "2-10" },
  directors: ["eli"],
  threshold: 2,
  members: ["sam", "pat"],
  capital: { asset: "USDC", amount: "1000" },
} as const;

let founded: any;

test("the world: migrations and a cast of five", async () => {
  await run(
    migrate([
      migration("../../migrations/0001_telemetry.sql"),
      migration("./world-tables.sql"),
      migration("../../migrations/0004_organizations.sql"),
      migration("../../migrations/0005_approvals.sql"),
    ]),
  );
  await run(makeCast);
  assert.equal(await run(usdcOf(await safeOf("dana"))), 10_000_000_000n);
});

test("org.create: everything is checked before the first write (claims 5 and 7)", async () => {
  const before = await head();
  assert.equal((await refused("org.create", FOUNDING, "pat"))._tag, "FounderNotReady");
  assert.equal((await refused("org.create", { ...FOUNDING, directors: ["zed"] }, "dana"))._tag, "PersonNotFound");
  assert.equal((await refused("org.create", { ...FOUNDING, members: ["sam", "zed"] }, "dana"))._tag, "PersonNotFound");
  const poor = await refused("org.create", { ...FOUNDING, capital: { asset: "USDC", amount: "20000" } }, "dana");
  assert.deepEqual([poor._tag, poor.balance, poor.amount], ["InsufficientBalance", "10000", "20000"]);
  assert.equal(await head(), before);
});

test("org.create founds northwind: its Safe is Companies House's for the founder, and it answers its approvals (claims 1, 2, 6)", async () => {
  const { value, trace } = await ok("org.create", FOUNDING, "dana");
  founded = value;
  assert.equal(value._tag, "Founded");
  assert.deepEqual([value.profile.bio, value.profile.size], ["We keep offices clean.", "2-10"]);
  assert.deepEqual(value.board, { directors: ["dana", "eli"], threshold: 2 });
  assert.deepEqual(value.approvals.map((each: Approval) => each.signer), ["dana", "eli"]);
  assert.equal(value.approvals[0].signerAddress, keyOf("dana").address);
  assert.deepEqual((await events(trace)).map((row) => row.event), ["org_founded"]);
  const derived = await run(
    readContract({ address: SEEDED.companySafeMinter, abi: MINTER, functionName: "companySafeAddressFor", args: [SEEDED.companiesHouse, TIER.companyNamespace, value.org, value.founderSafe] }),
  );
  assert.equal(derived.toLowerCase(), value.safe.toLowerCase());
  assert.equal(value.founderSafe, await safeOf("dana"));
});

test("org.create: the same founding resumes; another name, another founder, a second founding are refused (claims 4, 7)", async () => {
  const before = await head();
  const again = await ok("org.create", FOUNDING, "dana");
  assert.deepEqual([again.value._tag, again.value.org, again.value.setup], ["Resumed", founded.org, "awaiting_signatures"]);
  assert.equal(again.value.approvals.length, 2);
  const renamed = await refused("org.create", { ...FOUNDING, profile: { ...FOUNDING.profile, name: "Northwind Holdings" } }, "dana");
  assert.deepEqual([renamed._tag, renamed.org], ["FoundingChanged", founded.org]);
  assert.equal((await refused("org.create", { ...FOUNDING, directors: ["dana"] }, "eli"))._tag, "HandleTaken");
  const second = await refused("org.create", { ...FOUNDING, handle: "southwind" }, "dana");
  assert.deepEqual([second._tag, second.org], ["SetupUnfinished", founded.org]);
  assert.equal(await head(), before);
});

test("approval.sign: a wrong signer, a wrong key and an unknown approval are refused (claim 3)", async () => {
  const [dana] = founded.approvals;
  assert.equal((await refused("approval.sign", { approval: dana.id, signature: `0x${"1b".repeat(65)}` }, "olga"))._tag, "NotYourApproval");
  const wrong = await refused("approval.sign", { approval: dana.id, signature: await keyOf("olga").sign({ hash: dana.digest }) }, "dana");
  assert.deepEqual([wrong._tag, wrong.recovered], ["SignatureInvalid", keyOf("olga").address]);
  assert.equal((await refused("approval.sign", { approval: "apr_nobodyissued", signature: `0x${"1b".repeat(65)}` }, "dana"))._tag, "ApprovalNotFound");
});

test("the setup: dana's signature is kept, eli's sends it; the board and the capital are on the chain (org.create 3)", async () => {
  const [dana, eli] = founded.approvals;
  const kept = await sign(dana);
  assert.ok(Exit.isSuccess(kept.exit));
  assert.deepEqual([kept.exit.value._tag, kept.exit.value.signatures, kept.exit.value.threshold], ["Collected", 1, 2]);
  assert.deepEqual(kept.exit.value.subject, { kind: "org_setup", id: founded.org });
  assert.deepEqual((await events(kept.trace)).map((row) => row.event), ["approval_signed"]);
  const sent = await sign(eli);
  if (Exit.isFailure(sent.exit)) assert.fail(Cause.pretty(sent.exit.cause));
  assert.equal(sent.exit.value._tag, "Sent");
  assert.deepEqual((await events(sent.trace)).map((row) => row.event), ["approval_signed", "approval_landed"]);
  const owners = await run(readContract({ address: founded.safe, abi: SAFE, functionName: "getOwners", args: [] }));
  assert.deepEqual(owners.map((each) => each.toLowerCase()).sort(), [await safeOf("dana"), await safeOf("eli")].map((each) => each.toLowerCase()).sort());
  assert.equal(await run(readContract({ address: founded.safe, abi: SAFE, functionName: "getThreshold", args: [] })), 2n);
  assert.equal(await run(usdcOf(founded.safe)), 1_000_000_000n);
  assert.equal(await run(usdcOf(await safeOf("dana"))), 9_000_000_000n);
  const replay = await sign(eli);
  assert.ok(Exit.isSuccess(replay.exit));
  assert.deepEqual([replay.exit.value._tag, replay.exit.value.transaction], ["AlreadySent", sent.exit.value.transaction]);
  assert.deepEqual(await events(replay.trace), []);
});

test("the company's site is told its company, its Directors and the founder's capital, then shows ready", async () => {
  // The setup's landing looked at the site once (still being made); the world's next read of its companies finds it
  // made, hands it everything queued, and shows it ready.
  const companies = await run(companiesOf());
  assert.equal(companies[0]?.site.state, "ready");
  const told = await run(Ref.get(site.told));
  assert.deepEqual(
    told.map((each) => each.call.path.split(".").pop()),
    ["configure", "grant", "grant", "capital"],
  );
});

const HAT_LOGS = parseAbi([
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 amount)",
  "event HatMaxSupplyChanged(uint256 hatId, uint32 newMaxSupply)",
]);
const hatLogs = async (tx: string) =>
  (await receiptLogs(tx)).logs
    .filter((log) => log.address.toLowerCase() === SEEDED.hats.toLowerCase())
    .map((log) => decodeEventLog({ abi: HAT_LOGS, topics: log.topics as [Hex, ...Array<Hex>], data: log.data }).eventName);

let books: any;
test("org.member.grant: refusals before anything is proposed (claims 2, 6)", async () => {
  const grant = { org: founded.org, member: "sam", permission: "manage-books", note: "Sam keeps the books" };
  assert.equal((await refused("org.member.grant", grant, "sam"))._tag, "NotADirector");
  assert.equal((await refused("org.member.grant", { ...grant, member: "olga" }, "dana"))._tag, "NotAMember");
  assert.equal((await refused("org.member.grant", { ...grant, member: "pat" }, "dana"))._tag, "MemberHasNoSafe");
});

test("org.member.grant: a Director proposal, kept by dana, executed by eli; the Books hat on sam's Safe (claims 1, 3, 4; approval.sign 5)", async () => {
  const grant = { org: founded.org, member: "sam", permission: "manage-books", note: "Sam keeps the books" };
  const { value, trace } = await ok("org.member.grant", grant, "dana");
  books = value;
  assert.deepEqual(value.change.state, "proposed");
  assert.deepEqual(value.approvals.map((each: Approval) => each.signer), ["dana", "eli"]);
  const recorded = await events(trace);
  assert.deepEqual(recorded.map((row) => row.event), ["officer_change_proposed", "proposal_opened"]);
  assert.deepEqual(Object.keys(recorded[0]?.payload as object).sort(), ["change", "org", "permission", "proposal"]);
  const waiting = await refused("org.member.grant", { ...grant, permission: "issue-invoices" }, "dana");
  assert.deepEqual([waiting._tag, waiting.change], ["ChangeWaiting", value.change.id]);
  const kept = await sign(value.approvals[0]);
  assert.ok(Exit.isSuccess(kept.exit) && kept.exit.value._tag === "Collected");
  const sent = await sign(value.approvals[1]);
  if (Exit.isFailure(sent.exit)) assert.fail(Cause.pretty(sent.exit.cause));
  assert.deepEqual(sent.exit.value.subject, { kind: "officer_change", id: value.change.id });
  assert.deepEqual(await hatLogs(sent.exit.value.transaction), ["TransferSingle"]);
  const samSafe = (await safeOf("sam")) as Hex;
  const hats = await run(Effect.flatMap(PgClient.PgClient, (sql) => sql<{ readonly deployment: any }>`select deployment from app.organizations`));
  const hat = BigInt(hats[0]?.deployment.officerHats["manage-books"]);
  assert.equal(await run(readContract({ address: SEEDED.hats, abi: HATS, functionName: "isWearerOfHat", args: [samSafe, hat] })), true);
  const [details] = await run(readContract({ address: SEEDED.hats, abi: HATS, functionName: "viewHat", args: [hat] }));
  assert.equal(details, Values.OFFICER_HAT_DETAILS["manage-books"]);
  assert.equal((await refused("org.member.grant", grant, "dana"))._tag, "AlreadyHeld");
});

test("org.member.grant: a hat whose every seat is worn takes one more seat first (claim 5)", async () => {
  const { value } = await ok("org.member.grant", { org: founded.org, member: "eli", permission: "manage-books", note: null }, "dana");
  await sign(value.approvals[0]);
  const sent = await sign(value.approvals[1]);
  if (Exit.isFailure(sent.exit)) assert.fail(Cause.pretty(sent.exit.cause));
  assert.deepEqual(await hatLogs(sent.exit.value.transaction), ["HatMaxSupplyChanged", "TransferSingle"]);
});

const PAID = parseAbi([
  "event PaymentSent(bytes32 indexed paymentId, address indexed sender, address indexed recipient, address token, uint256 amount, uint16 kind, bytes32 documentHash)",
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
]);
test("a held payment is sent once, from sam's Safe, with its document's hash; a replay sends nothing (approval.sign 1, 2)", async () => {
  const payee = "0x000000000000000000000000000000000000bEEF";
  const documentHash = `0x${"d0".repeat(32)}`;
  const hold = { org: founded.org, person: "sam", document: { doctype: "Payment Entry", name: "ACC-PAY-2026-00001" }, payee: "Brightside Cleaning Ltd", payeeAddress: payee, safe: founded.safe, documentHash };
  const poor = await run(Effect.flip(openPayment({ ...hold, amount: { asset: "USDC", amount: "5000" } })));
  assert.deepEqual([poor._tag, poor.safe, poor.balance], ["InsufficientBalance", founded.safe, "1000"]);
  const opened = await run(openPayment({ ...hold, amount: { asset: "USDC", amount: "125.5" } }));
  assert.equal(opened.approval.signer, "sam");
  const before = { payee: await run(usdcOf(payee)), company: await run(usdcOf(founded.safe)) };
  const sent = await sign(opened.approval);
  if (Exit.isFailure(sent.exit)) assert.fail(Cause.pretty(sent.exit.cause));
  assert.deepEqual(sent.exit.value.subject, { kind: "payment", id: opened.request });
  const logs = (await receiptLogs(sent.exit.value.transaction)).logs.flatMap((log) => {
    try {
      return [decodeEventLog({ abi: PAID, topics: log.topics as [Hex, ...Array<Hex>], data: log.data })];
    } catch {
      return [];
    }
  });
  const ops = logs.filter((log) => log.eventName === "UserOperationEvent");
  const payments = logs.filter((log) => log.eventName === "PaymentSent");
  assert.equal(ops.length, 1);
  assert.equal((ops[0]?.args as { sender: string }).sender.toLowerCase(), (await safeOf("sam")).toLowerCase());
  assert.equal(payments.length, 1);
  assert.deepEqual([(payments[0]?.args as any).paymentId, (payments[0]?.args as any).documentHash], [opened.paymentId, documentHash]);
  assert.equal((await run(usdcOf(payee))) - before.payee, 125_500_000n);
  assert.equal(before.company - (await run(usdcOf(founded.safe))), 125_500_000n);
  const replay = await sign(opened.approval);
  assert.ok(Exit.isSuccess(replay.exit) && replay.exit.value._tag === "AlreadySent");
  const told = await run(Ref.get(site.told));
  assert.equal(told.at(-1)?.call.path.split(".").pop(), "paid");
});

test("approval.sign: an approval past its expiry in world time is refused, naming it (claim 4)", async () => {
  const { value } = await ok("org.member.grant", { org: founded.org, member: "sam", permission: "manage-people", note: null }, "dana");
  await run(Effect.flatMap(WorldChain, (chain) => Effect.andThen(chain.rpc("evm_increaseTime", [25 * 3600]), chain.rpc("evm_mine", []))));
  const expired = await refused("approval.sign", { approval: value.approvals[0].id, signature: await keyOf("dana").sign({ hash: value.approvals[0].digest }) }, "dana");
  assert.deepEqual([expired._tag, expired.expiredAt], ["ApprovalExpired", value.approvals[0].expiresAt]);
  await runtime.dispose();
});
