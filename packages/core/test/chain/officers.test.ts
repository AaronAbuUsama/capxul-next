// org.member.grant, a held payment and an expired approval end to end, in this process, against a local stand-in of a
// world (test/chain/up.sh), from a founded company (the starting world `founded`'s chain): `pnpm --filter @capxul/core
// chain:test`, not `pnpm test`, which has no chain. One world for the file, so its tests run in order.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import { openPayment } from "../../src/approvals/payments.ts";
import { HATS } from "../../src/chain/abi.ts";
import { readContract, usdcOf } from "../../src/chain/calls.ts";
import { sameAddress } from "../../src/chain/hex.ts";
import { SEEDED } from "../../src/chain/seeded.ts";
import { WorldClock } from "../../src/site-ops/door.ts";
import { foundNorthwind, grant as grantIn, open } from "./setup.ts";
import { answer, eventsOf, HAT_LOGS, logsOf, OPERATIONS, PAID, refusal, safeOf, sign } from "./world.ts";

const read = (name: string) => readFileSync(`${import.meta.dirname}/${name}`, "utf8");
const migrations = Arr.map(
  [
    "../../migrations/0001_telemetry.sql",
    "../../migrations/0002_site_ops.sql",
    "../../migrations/0003_world.sql",
    "../../migrations/0004_organizations.sql",
    "../../migrations/0005_approvals.sql",
  ],
  read,
);
const urls = {
  rpc: process.env["CHAIN_RPC"] ?? "http://127.0.0.1:28545",
  bundler: process.env["CHAIN_BUNDLER"] ?? "http://127.0.0.1:24337",
  database: process.env["CHAIN_DATABASE"] ?? "postgres://postgres:test@127.0.0.1:25432/postgres",
};
const { runtime, site, it, fresh } = await Effect.runPromise(open({ urls, migrations }));
type Approval = typeof Values.Approval.Type;

/** Northwind as org.create answered it, once founded. */
const northwind = Ref.makeUnsafe({ org: "", safe: "", founderSafe: "", approvals: [] as ReadonlyArray<Approval> });
const grant = (member: string, permission: typeof Values.Permission.Type, as = "dana") =>
  Effect.flatMap(Ref.get(northwind), (company) => grantIn(company.org, member, permission, as));

it(
  "the world: a fresh database, the cast, and northwind founded and set up by dana and eli",
  Effect.gen(function* () {
    yield* fresh;
    yield* Ref.set(northwind, yield* foundNorthwind);
  }),
);

it(
  "org.member.grant: refusals before anything is proposed (claims 2, 6)",
  Effect.gen(function* () {
    assert.equal((yield* refusal(yield* grant("sam", "manage-books", "sam")))._tag, "NotADirector");
    assert.equal((yield* refusal(yield* grant("olga", "manage-books")))._tag, "NotAMember");
    assert.equal((yield* refusal(yield* grant("pat", "manage-books")))._tag, "MemberHasNoSafe");
  }),
);

it(
  "org.member.grant: a Director proposal kept by dana and executed by eli puts Books on sam's Safe (claims 1, 3, 4; approval.sign 5)",
  Effect.gen(function* () {
    const proposedEnded = yield* grant("sam", "manage-books");
    const proposed = yield* answer(proposedEnded);
    assert.deepEqual(
      Arr.map(proposed.approvals, (each) => each.signer),
      ["dana", "eli"],
    );
    const recorded = yield* eventsOf(proposedEnded.trace);
    assert.deepEqual(
      Arr.map(recorded, (row) => row.event),
      ["officer_change_proposed", "proposal_opened"],
    );
    const carried = recorded[0]?.payload;
    const fields = typeof carried === "object" && carried !== null ? Rec.keys({ ...carried }) : [];
    assert.deepEqual(Arr.sort(fields, Order.String), ["change", "org", "permission", "proposal"]);
    const waiting = yield* refusal(yield* grant("sam", "issue-invoices"));
    assert.ok(waiting._tag === "ChangeWaiting" && waiting.change === proposed.change.id);
    const [dana, eli] = proposed.approvals;
    assert.ok(dana !== undefined && eli !== undefined, "no approvals");
    assert.equal((yield* answer(yield* sign(dana)))._tag, "Collected");
    const sent = yield* answer(yield* sign(eli));
    assert.ok(sent._tag === "Sent");
    assert.deepEqual(sent.subject, { kind: "officer_change", id: proposed.change.id });
    const logs = yield* logsOf(sent.transaction, SEEDED.hats, HAT_LOGS);
    assert.deepEqual(
      Arr.map(logs, (log) => log.eventName),
      ["TransferSingle"],
    );
    const minted = logs[0];
    assert.ok(minted?.eventName === "TransferSingle", "no hat minted");
    assert.ok(sameAddress(minted.args.to, yield* safeOf("sam")));
    const [details] = yield* readContract({
      address: SEEDED.hats,
      abi: HATS,
      functionName: "viewHat",
      args: [minted.args.id],
    });
    assert.equal(details, Values.OFFICER_HAT_DETAILS["manage-books"]);
    assert.equal((yield* refusal(yield* grant("sam", "manage-books")))._tag, "AlreadyHeld");
  }),
);

it(
  "org.member.grant: a hat whose every seat is worn takes one more seat first (claim 5)",
  Effect.gen(function* () {
    const proposed = yield* answer(yield* grant("eli", "manage-books"));
    const [dana, eli] = proposed.approvals;
    assert.ok(dana !== undefined && eli !== undefined, "no approvals");
    yield* sign(dana);
    const sent = yield* answer(yield* sign(eli));
    assert.ok(sent._tag === "Sent");
    const logs = yield* logsOf(sent.transaction, SEEDED.hats, HAT_LOGS);
    assert.deepEqual(
      Arr.map(logs, (log) => log.eventName),
      ["HatMaxSupplyChanged", "TransferSingle"],
    );
  }),
);

it(
  "a held payment is sent once, from sam's Safe, with its document's hash; a replay sends nothing (approval.sign 1, 2)",
  Effect.gen(function* () {
    const company = yield* Ref.get(northwind);
    const payee = "0x000000000000000000000000000000000000bEEF";
    const documentHash = `0x${Str.repeat(32)("d0")}`;
    const hold = {
      org: company.org,
      person: "sam",
      document: { doctype: "Payment Entry", name: "ACC-PAY-2026-00001" },
      payee: "Brightside Cleaning Ltd",
      payeeAddress: payee,
      safe: company.safe,
      documentHash,
    };
    const poor = yield* Effect.flip(openPayment({ ...hold, amount: { asset: "USDC", amount: "5000" } }));
    assert.ok(poor._tag === "InsufficientBalance" && poor.balance === "1000");
    const opened = yield* openPayment({ ...hold, amount: { asset: "USDC", amount: "125.5" } });
    const before = { payee: yield* usdcOf(payee), company: yield* usdcOf(company.safe) };
    const sent = yield* answer(yield* sign(opened.approval));
    assert.ok(sent._tag === "Sent");
    assert.deepEqual(sent.subject, { kind: "payment", id: opened.request });
    const operations = yield* logsOf(sent.transaction, SEEDED.entryPoint, OPERATIONS);
    assert.equal(operations.length, 1);
    assert.ok(sameAddress(operations[0]?.args.sender ?? "", yield* safeOf("sam")));
    const payments = yield* logsOf(sent.transaction, SEEDED.payments, PAID);
    assert.deepEqual(
      Arr.map(payments, (log) => [log.args.paymentId, log.args.documentHash]),
      [[opened.paymentId, documentHash]],
    );
    assert.equal((yield* usdcOf(payee)) - before.payee, 125_500_000n);
    assert.equal(before.company - (yield* usdcOf(company.safe)), 125_500_000n);
    assert.equal((yield* answer(yield* sign(opened.approval)))._tag, "AlreadySent");
    const told = yield* Ref.get(site.told);
    const last = Option.getOrElse(
      Option.map(Arr.last(told), (each) => each.call.path),
      () => "",
    );
    assert.ok(Str.endsWith("paid")(last));
  }),
);

it(
  "approval.sign: an approval past its expiry in world time is refused, naming it (claim 4)",
  Effect.gen(function* () {
    const proposed = yield* answer(yield* grant("sam", "manage-people"));
    const clock = yield* WorldClock;
    yield* clock.moveTo((yield* clock.now).nowMs + 25 * 3600 * 1000);
    const [dana] = proposed.approvals;
    assert.ok(dana !== undefined, "no approvals");
    const expired = yield* refusal(yield* sign(dana));
    assert.ok(expired._tag === "ApprovalExpired" && expired.expiredAt === dana.expiresAt);
  }),
);

test("the runtime is let go", () => runtime.dispose());
