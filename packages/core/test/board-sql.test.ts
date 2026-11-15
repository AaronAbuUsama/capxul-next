// The board operations served in this process against a real Postgres with Core's migrations applied, from Northwind
// founded (the starting world `founded`, test/support/people.ts) and a chain in memory (test/support/board-chain.ts):
// the journey "seat sam on Northwind's Board" in packages/scenarios, step by step, with what each call answers,
// refuses, records and leaves on the chain and in Core, and org.member.grant asking the Board it leaves. Runs only
// with CAPXUL_TEST_DATABASE (a throwaway Postgres); CI has none, so it skips. The real contracts are
// test/chain's to exercise.
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Order from "effect/Order";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import * as PgClient from "@effect/sql-pg/PgClient";
import { mnemonicToAccount } from "viem/accounts";
import { hex } from "../src/chain/hex.ts";
import { APPROVAL_LIFETIME_MS } from "../src/chain/seeded.ts";
import { instant } from "../src/organizations/caller.ts";
import { migrations } from "../src/door.ts";
import { fakeChain, type ChainState } from "./support/board-chain.ts";
import { answer, as, core, eventsOf, fresh, ORG, recordSize, refusal, START } from "./support/people.ts";

const url = process.env["CAPXUL_TEST_DATABASE"];
const skip = url === undefined;
const DANA = "0x00000000000000000000000000000000000000d1";
const ELI = "0x00000000000000000000000000000000000000e1";
const SAM = "0x0000000000000000000000000000000000000051";
const DIRECTOR_HAT = "2";
const chain = Ref.makeUnsafe<ChainState>({
  owners: [DANA, ELI],
  threshold: 2,
  hats: { [DIRECTOR_HAT]: { supply: 2, maxSupply: 2, wearers: [DANA, ELI] } },
  sent: [],
});
const runtime = ManagedRuntime.make(core(url ?? "", fakeChain(chain)));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;
const it = <E>(name: string, body: Effect.Effect<void, E, Services>) =>
  test(name, { skip }, () => runtime.runPromise(Effect.orDie(body)));

/** dana's key: the founder's signature is the only one a change to the Board needs. */
const danaKey = mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 1 });

let n = 0;
const next = () => (n += 1);
const list = (by: string | undefined, org = ORG) =>
  as(next(), by, (client, options) => client("org.director.list", { org }, options));
const add = (person: string, by: string | undefined, org = ORG) =>
  as(next(), by, (client, options) => client("org.director.add", { org, person }, options));
const set = (threshold: number, by: string | undefined, org = ORG) =>
  as(next(), by, (client, options) => client("org.threshold.set", { org, threshold }, options));
const sign = (approval: { readonly id: string; readonly digest: string }, by: string) =>
  Effect.flatMap(
    Effect.promise(() => danaKey.sign({ hash: hex(approval.digest) })),
    (signature) =>
      as(next(), by, (client, options) => client("approval.sign", { approval: approval.id, signature }, options)),
  );
const tags = (ended: ReadonlyArray<Readonly<Record<string, unknown>>>) => Arr.map(ended, (each) => each["_tag"]);

/** Core's Board of Northwind, and the board changes it keeps. */
const kept = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const [org] = yield* sql<{ readonly directors: unknown; readonly threshold: number }>`
    select directors, threshold from app.organizations where org = ${ORG}`;
  const changes = yield* sql<{ readonly action: string; readonly state: string }>`
    select action, state from app.board_changes order by expires_ms`;
  return { directors: org?.directors, threshold: org?.threshold, changes };
});

/** What the site is to be told of a grant of the Director's hat. */
const directorGrants = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<{ readonly body: { readonly email: string; readonly hat: string } }>`
    select body from app.site_deliveries where kind = 'grant' order by id`;
  return Arr.map(rows, (row) => [row.body.email, row.body.hat]);
});

const folder = fileURLToPath(migrations.href);
const files = Arr.map(Arr.sort(Arr.filter(readdirSync(folder), Str.endsWith(".sql")), Order.String), (file) =>
  readFileSync(`${folder}${file}`, "utf8"),
);

/** The changes proposed, as they were answered. */
const proposed = { seat: { id: "", digest: "", change: "" }, raise: { id: "", digest: "", change: "" } };

it(
  "the world: a fresh database, the cast with dana's own key, and northwind founded",
  Effect.gen(function* () {
    yield* fresh(files);
    const sql = yield* PgClient.PgClient;
    yield* sql`update app.cast set signer = ${danaKey.address} where person = 'dana'`;
  }),
);

it(
  "org.director.list: dana and eli at 2, from the chain; the owner sees it, an outsider is refused",
  Effect.gen(function* () {
    const board = {
      org: ORG,
      directorHat: DIRECTOR_HAT,
      threshold: 2,
      directors: [
        { person: "dana", safe: DANA },
        { person: "eli", safe: ELI },
      ],
    };
    assert.deepEqual(yield* answer(yield* list("dana")), board);
    assert.deepEqual(yield* answer(yield* list(undefined)), board);
    assert.deepEqual(yield* refusal(yield* list("olga")), { _tag: "NotAMember", org: ORG, person: "olga" });
    assert.deepEqual(yield* refusal(yield* list("dana", "org_nowhere1")), { _tag: "OrgNotFound", org: "org_nowhere1" });
    assert.equal(yield* recordSize, 0);
  }),
);

it(
  "org.director.add: who may not change the Board, and whom it cannot seat, are refused, recording nothing",
  Effect.gen(function* () {
    const refused = [
      yield* refusal(yield* add("sam", "sam")),
      yield* refusal(yield* add("sam", "eli")),
      yield* refusal(yield* add("sam", undefined)),
      yield* refusal(yield* add("olga", "dana")),
      yield* refusal(yield* add("pat", "dana")),
      yield* refusal(yield* add("eli", "dana")),
      yield* refusal(yield* add("sam", "dana", "org_nowhere1")),
    ];
    assert.deepEqual(tags(refused), [
      "CannotChangeBoard",
      "CannotChangeBoard",
      "CannotChangeBoard",
      "NotAMember",
      "MemberHasNoSafe",
      "AlreadyADirector",
      "OrgNotFound",
    ]);
    assert.deepEqual(
      [refused[0], refused[1]?.["person"]],
      [{ _tag: "CannotChangeBoard", org: ORG, person: "sam" }, "eli"],
    );
    assert.deepEqual(Arr.map(Arr.drop(refused, 3), (each) => each["person"]).slice(0, 3), ["olga", "pat", "eli"]);
    assert.equal(yield* recordSize, 0);
    assert.deepEqual((yield* Ref.get(chain)).sent, []);
  }),
);

it(
  "org.director.add: dana proposes seating sam, 2 at 2 to 3 at 2, with her approval alone; nothing else while it waits",
  Effect.gen(function* () {
    const ended = yield* add("sam", "dana");
    const seat = yield* answer(ended);
    assert.match(seat.change.id, /^bch_[a-z0-9]{12}$/);
    assert.deepEqual(
      { ...seat.change, id: "" },
      {
        id: "",
        action: "add",
        person: "sam",
        before: { directors: 2, threshold: 2 },
        after: { directors: 3, threshold: 2 },
        state: "proposed",
      },
    );
    assert.deepEqual(
      [seat.approval.signer, seat.approval.signerAddress, seat.approval.expiresAt],
      ["dana", danaKey.address, instant(START + APPROVAL_LIFETIME_MS)],
    );
    assert.deepEqual(yield* eventsOf(ended.trace), [
      { event: "board_change_proposed", payload: { change: seat.change.id, org: ORG, action: "add" } },
    ]);
    proposed.seat = { ...seat.approval, change: seat.change.id };
    const waiting = [yield* refusal(yield* add("sam", "dana")), yield* refusal(yield* set(1, "dana"))];
    assert.deepEqual(waiting, [
      { _tag: "BoardChangeWaiting", org: ORG, change: seat.change.id },
      { _tag: "BoardChangeWaiting", org: ORG, change: seat.change.id },
    ]);
    assert.equal(yield* recordSize, 1);
    assert.deepEqual((yield* Ref.get(chain)).owners, [DANA, ELI]);
  }),
);

it(
  "approval.sign: eli may not sign it; dana's signature sends it at once and the Board in Core is three at 2",
  Effect.gen(function* () {
    assert.equal((yield* refusal(yield* sign(proposed.seat, "eli")))["_tag"], "NotYourApproval");
    const ended = yield* sign(proposed.seat, "dana");
    const sent = yield* answer(ended);
    assert.deepEqual([sent._tag, sent.subject], ["Sent", { kind: "board_change", id: proposed.seat.change }]);
    assert.deepEqual(
      Arr.map(yield* eventsOf(ended.trace), (each) => each.event),
      ["approval_signed", "approval_landed"],
    );
    const onChain = yield* Ref.get(chain);
    assert.deepEqual(onChain.sent, [{ sender: DANA, calls: ["changeHatMaxSupply 3", "mintHat", "claimSignerFor"] }]);
    assert.deepEqual([onChain.owners, onChain.threshold], [[DANA, ELI, SAM], 2]);
    assert.deepEqual(onChain.hats[DIRECTOR_HAT], { supply: 3, maxSupply: 3, wearers: [DANA, ELI, SAM] });
    assert.deepEqual(yield* kept, {
      directors: ["dana", "eli", "sam"],
      threshold: 2,
      changes: [{ action: "add", state: "landed" }],
    });
    assert.deepEqual(yield* directorGrants, [["sam@cast.test", "admin"]]);
    const again = yield* answer(yield* sign(proposed.seat, "dana"));
    assert.equal(again._tag, "AlreadySent");
  }),
);

it(
  "org.director.list and org.member.list: dana, eli and sam at 2, as sam sees it",
  Effect.gen(function* () {
    const seen = yield* answer(yield* list("sam"));
    assert.deepEqual([Arr.map(seen.directors, (each) => each.person), seen.threshold], [["dana", "eli", "sam"], 2]);
    const people = yield* answer(yield* as(next(), "sam", (client, o) => client("org.member.list", { org: ORG }, o)));
    assert.deepEqual(
      Arr.map(people.members, (each) => [each.person, each.role]),
      [
        ["dana", "director"],
        ["eli", "director"],
        ["sam", "director"],
        ["pat", "member"],
      ],
    );
  }),
);

it(
  "org.threshold.set: sam may not; 4, 2 and a company nobody founded are refused, recording nothing",
  Effect.gen(function* () {
    const size = yield* recordSize;
    const refused = [
      yield* refusal(yield* set(3, "sam")),
      yield* refusal(yield* set(4, "dana")),
      yield* refusal(yield* set(2, "dana")),
      yield* refusal(yield* set(3, "dana", "org_nowhere1")),
    ];
    assert.deepEqual(refused, [
      { _tag: "CannotChangeBoard", org: ORG, person: "sam" },
      { _tag: "ThresholdTooHigh", org: ORG, threshold: 4, directors: 3 },
      { _tag: "ThresholdUnchanged", org: ORG, threshold: 2 },
      { _tag: "OrgNotFound", org: "org_nowhere1" },
    ]);
    assert.equal(yield* recordSize, size);
  }),
);

it(
  "org.threshold.set: dana makes it 3 of 3; her signature lands it, and a grant then asks all three at 3",
  Effect.gen(function* () {
    const ended = yield* set(3, "dana");
    const raise = yield* answer(ended);
    assert.deepEqual(
      [raise.change.action, raise.change.person, raise.change.before, raise.change.after],
      ["threshold", null, { directors: 3, threshold: 2 }, { directors: 3, threshold: 3 }],
    );
    assert.deepEqual(yield* eventsOf(ended.trace), [
      { event: "board_change_proposed", payload: { change: raise.change.id, org: ORG, action: "threshold" } },
    ]);
    assert.equal((yield* Ref.get(chain)).threshold, 2);
    const sent = yield* answer(yield* sign(raise.approval, "dana"));
    assert.equal(sent._tag, "Sent");
    const onChain = yield* Ref.get(chain);
    assert.deepEqual([onChain.threshold, onChain.sent[1]], [3, { sender: DANA, calls: ["setThresholdConfig 3"] }]);
    assert.deepEqual((yield* kept).threshold, 3);
    assert.equal((yield* answer(yield* list("dana"))).threshold, 3);
    assert.deepEqual(yield* directorGrants, [["sam@cast.test", "admin"]]);
    const grant = yield* answer(
      yield* as(next(), "dana", (client, o) =>
        client("org.member.grant", { org: ORG, member: "sam", permission: "manage-books", note: null }, o),
      ),
    );
    assert.deepEqual(
      [Arr.map(grant.approvals, (each) => each.signer), grant.proposal.threshold],
      [["dana", "eli", "sam"], 3],
    );
  }),
);

it(
  "a change that expires unsigned no longer waits: another is proposed after it",
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    const first = yield* answer(yield* set(2, "dana"));
    assert.equal((yield* refusal(yield* set(1, "dana")))["_tag"], "BoardChangeWaiting");
    yield* sql`update app.clock set frozen_at_ms = ${START + APPROVAL_LIFETIME_MS + 1}`;
    const second = yield* answer(yield* set(1, "dana"));
    assert.notEqual(second.change.id, first.change.id);
    assert.deepEqual(second.change.before, { directors: 3, threshold: 3 });
  }),
);

after(() => runtime.dispose());
