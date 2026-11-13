// org.create and the setup's approvals end to end, in this process, against a local stand-in of a world
// (test/chain/up.sh), read back from the chain itself: `pnpm --filter @capxul/core chain:test`, not `pnpm test`, which
// has no chain. One world for the file, so its tests run in order.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import { MINTER, SAFE } from "../../src/chain/abi.ts";
import { readContract, usdcOf } from "../../src/chain/calls.ts";
import { hex, sameAddress } from "../../src/chain/hex.ts";
import { SEEDED, TIER } from "../../src/chain/seeded.ts";
import { companiesOf } from "../../src/organizations/site.ts";
import { found, open } from "./setup.ts";
import {
  answer,
  asPerson,
  events,
  FOUNDING,
  keyOf,
  lower,
  recordSize,
  refusal,
  safeOf,
  sign,
  variant,
} from "./world.ts";

const read = (name: string) => readFileSync(`${import.meta.dirname}/${name}`, "utf8");
const migrations = Arr.map(
  [
    "../../migrations/0001_telemetry.sql",
    "./world-tables.sql",
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

it(
  "the world: Core's migrations and a cast of five",
  Effect.gen(function* () {
    yield* fresh;
    assert.equal(yield* usdcOf(yield* safeOf("dana")), 10_000_000_000n);
  }),
);

it(
  "org.create: everything is checked before the first write (claims 5, 7)",
  Effect.gen(function* () {
    const before = yield* recordSize;
    assert.equal((yield* refusal(yield* found(FOUNDING, "pat")))._tag, "FounderNotReady");
    assert.equal((yield* refusal(yield* found(variant({ directors: ["zed"] }), "dana")))._tag, "PersonNotFound");
    assert.equal((yield* refusal(yield* found(variant({ members: ["sam", "zed"] }), "dana")))._tag, "PersonNotFound");
    const poor = yield* refusal(yield* found(variant({ capital: { asset: "USDC", amount: "20000" } }), "dana"));
    assert.ok(poor._tag === "InsufficientBalance");
    assert.deepEqual([poor.balance, poor.amount], ["10000", "20000"]);
    assert.equal(yield* recordSize, before);
  }),
);

it(
  "org.create founds northwind: its Safe is Companies House's for dana's Safe, with its approvals (claims 1, 2, 6)",
  Effect.gen(function* () {
    const ended = yield* found(FOUNDING, "dana");
    const value = yield* answer(ended);
    assert.ok(value._tag === "Founded");
    yield* Ref.set(northwind, value);
    assert.deepEqual([value.profile.bio, value.profile.size], ["We keep offices clean.", "2-10"]);
    assert.deepEqual(value.board, { directors: ["dana", "eli"], threshold: 2 });
    assert.deepEqual(
      Arr.map(value.approvals, (each) => each.signer),
      ["dana", "eli"],
    );
    assert.equal(value.approvals[0]?.signerAddress, keyOf("dana").address);
    assert.deepEqual(yield* events(ended.trace), ["org_founded"]);
    const derived = yield* readContract({
      address: SEEDED.companySafeMinter,
      abi: MINTER,
      functionName: "companySafeAddressFor",
      args: [SEEDED.companiesHouse, TIER.companyNamespace, value.org, hex(value.founderSafe)],
    });
    assert.ok(sameAddress(derived, value.safe));
    assert.ok(sameAddress(value.founderSafe, yield* safeOf("dana")));
  }),
);

it(
  "org.create: the same founding resumes; another name, another founder and a second founding are refused (claims 4, 7)",
  Effect.gen(function* () {
    const before = yield* recordSize;
    const org = (yield* Ref.get(northwind)).org;
    const again = yield* answer(yield* found(FOUNDING, "dana"));
    assert.ok(again._tag === "Resumed");
    assert.deepEqual([again.org, again.setup, again.approvals.length], [org, "awaiting_signatures", 2]);
    const renamed = yield* refusal(
      yield* found(variant({ profile: { ...FOUNDING.profile, name: "Northwind Holdings" } }), "dana"),
    );
    assert.ok(renamed._tag === "FoundingChanged" && renamed.org === org);
    assert.equal((yield* refusal(yield* found(variant({ directors: ["dana"] }), "eli")))._tag, "HandleTaken");
    const second = yield* refusal(yield* found(variant({ handle: "southwind" }), "dana"));
    assert.ok(second._tag === "SetupUnfinished" && second.org === org);
    assert.equal(yield* recordSize, before);
  }),
);

it(
  "approval.sign: another person, another key and an unknown approval are refused (claim 3)",
  Effect.gen(function* () {
    const [dana] = (yield* Ref.get(northwind)).approvals;
    assert.ok(dana !== undefined, "no approval for dana");
    assert.equal((yield* refusal(yield* sign(dana, "olga")))._tag, "NotYourApproval");
    const wrong = yield* refusal(yield* sign(dana, "dana", "olga"));
    assert.ok(wrong._tag === "SignatureInvalid" && wrong.recovered === keyOf("olga").address);
    const unknown = yield* asPerson("dana", (client, options) =>
      client("approval.sign", { approval: "apr_nobodyissued", signature: `0x${Str.repeat(65)("1b")}` }, options),
    );
    assert.equal((yield* refusal(unknown))._tag, "ApprovalNotFound");
  }),
);

it(
  "the setup: dana's signature is kept, eli's sends it; the board and the capital are on the chain (org.create 3)",
  Effect.gen(function* () {
    const company = yield* Ref.get(northwind);
    const [dana, eli] = company.approvals;
    assert.ok(dana !== undefined && eli !== undefined, "no approvals");
    const keptEnded = yield* sign(dana);
    const kept = yield* answer(keptEnded);
    assert.ok(kept._tag === "Collected");
    assert.deepEqual([kept.signatures, kept.threshold, kept.subject], [1, 2, { kind: "org_setup", id: company.org }]);
    assert.deepEqual(yield* events(keptEnded.trace), ["approval_signed"]);
    const sentEnded = yield* sign(eli);
    const sent = yield* answer(sentEnded);
    assert.ok(sent._tag === "Sent");
    assert.deepEqual(yield* events(sentEnded.trace), ["approval_signed", "approval_landed"]);
    const owners = yield* readContract({ address: company.safe, abi: SAFE, functionName: "getOwners", args: [] });
    assert.deepEqual(lower(owners), lower([yield* safeOf("dana"), yield* safeOf("eli")]));
    assert.equal(yield* readContract({ address: company.safe, abi: SAFE, functionName: "getThreshold", args: [] }), 2n);
    assert.equal(yield* usdcOf(company.safe), 1_000_000_000n);
    assert.equal(yield* usdcOf(yield* safeOf("dana")), 9_000_000_000n);
    const replayEnded = yield* sign(eli);
    const replay = yield* answer(replayEnded);
    assert.ok(replay._tag === "AlreadySent" && replay.transaction === sent.transaction);
    assert.deepEqual(yield* events(replayEnded.trace), []);
  }),
);

it(
  "the company's site is told its company, its Directors' hats and the founder's capital, then shows ready",
  Effect.gen(function* () {
    // The setup's landing looked at the site once, while it was being made; the next read of the world's companies
    // finds it made, hands it everything queued, and shows it ready.
    const companies = yield* companiesOf();
    assert.equal(companies[0]?.site.state, "ready");
    const told = yield* Ref.get(site.told);
    assert.deepEqual(
      Arr.map(told, (each) => Option.getOrElse(Arr.last(Str.split(each.call.path, ".")), () => "")),
      ["configure", "grant", "grant", "capital"],
    );
  }),
);

test("the runtime is let go", () => runtime.dispose());
