// org.director.add and org.threshold.set end to end, in this process, against a local stand-in of a world
// (test/chain/up.sh), from a founded company (the starting world `founded`'s chain): `pnpm --filter @capxul/core
// chain:test`, not `pnpm test`, which has no chain. dana seats sam with her signature alone, then makes the Board need
// all three; the real Hats protocol and Signer Gate carry out her Safe's UserOperation.
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import { HATS, SAFE } from "../../src/chain/abi.ts";
import { readContract } from "../../src/chain/calls.ts";
import { sameAddress } from "../../src/chain/hex.ts";
import { SEEDED } from "../../src/chain/seeded.ts";
import { foundNorthwind, grant, open } from "./setup.ts";
import { answer, asPerson, HAT_LOGS, logsOf, lower, OPERATIONS, refusal, safeOf, sign } from "./world.ts";

const folder = `${import.meta.dirname}/../../migrations/`;
const migrations = Arr.map(Arr.sort(Arr.filter(readdirSync(folder), Str.endsWith(".sql")), Order.String), (file) =>
  readFileSync(`${folder}${file}`, "utf8"),
);
const urls = {
  rpc: process.env["CHAIN_RPC"] ?? "http://127.0.0.1:28545",
  bundler: process.env["CHAIN_BUNDLER"] ?? "http://127.0.0.1:24337",
  database: process.env["CHAIN_DATABASE"] ?? "postgres://postgres:test@127.0.0.1:25432/postgres",
};
const { runtime, it, fresh } = await Effect.runPromise(open({ urls, migrations }));

const northwind = Ref.makeUnsafe({ org: "", safe: "" });
const add = (person: string, as = "dana") =>
  Effect.flatMap(Ref.get(northwind), (company) =>
    asPerson(as, (client, options) => client("org.director.add", { org: company.org, person }, options)),
  );
const set = (threshold: number, as = "dana") =>
  Effect.flatMap(Ref.get(northwind), (company) =>
    asPerson(as, (client, options) => client("org.threshold.set", { org: company.org, threshold }, options)),
  );
const companySafe = Effect.gen(function* () {
  const { safe } = yield* Ref.get(northwind);
  const owners = yield* readContract({ address: safe, abi: SAFE, functionName: "getOwners", args: [] });
  const threshold = yield* readContract({ address: safe, abi: SAFE, functionName: "getThreshold", args: [] });
  return { owners: lower(owners), threshold: Number(threshold) };
});

it(
  "the world: a fresh database, the cast, and northwind founded and set up by dana and eli",
  Effect.gen(function* () {
    yield* fresh;
    const founded = yield* foundNorthwind;
    yield* Ref.set(northwind, { org: founded.org, safe: founded.safe });
  }),
);

it(
  "org.director.add: dana's signature alone seats sam, one more seat first; the company Safe is 3 at 2",
  Effect.gen(function* () {
    assert.equal((yield* refusal(yield* add("sam", "eli")))._tag, "CannotChangeBoard");
    const seat = yield* answer(yield* add("sam"));
    assert.deepEqual(
      [seat.change.before, seat.change.after],
      [
        { directors: 2, threshold: 2 },
        { directors: 3, threshold: 2 },
      ],
    );
    const sent = yield* answer(yield* sign(seat.approval));
    assert.ok(sent._tag === "Sent");
    const operations = yield* logsOf(sent.transaction, SEEDED.entryPoint, OPERATIONS);
    assert.equal(operations.length, 1);
    assert.ok(sameAddress(operations[0]?.args.sender ?? "", yield* safeOf("dana")));
    const logs = yield* logsOf(sent.transaction, SEEDED.hats, HAT_LOGS);
    assert.deepEqual(
      Arr.map(logs, (log) => log.eventName),
      ["HatMaxSupplyChanged", "TransferSingle"],
    );
    const minted = logs[1];
    assert.ok(minted?.eventName === "TransferSingle" && sameAddress(minted.args.to, yield* safeOf("sam")));
    assert.ok(
      yield* readContract({
        address: SEEDED.hats,
        abi: HATS,
        functionName: "isWearerOfHat",
        args: [yield* safeOf("sam"), minted.args.id],
      }),
    );
    const safes = lower([yield* safeOf("dana"), yield* safeOf("eli"), yield* safeOf("sam")]);
    assert.deepEqual(yield* companySafe, { owners: safes, threshold: 2 });
    const listed = yield* answer(
      yield* asPerson("sam", (client, options) =>
        Effect.flatMap(Ref.get(northwind), (company) => client("org.director.list", { org: company.org }, options)),
      ),
    );
    assert.deepEqual([Arr.map(listed.directors, (each) => each.person), listed.threshold], [["dana", "eli", "sam"], 2]);
  }),
);

it(
  "org.threshold.set: dana's signature makes the company Safe need all three, and a grant then asks all three",
  Effect.gen(function* () {
    const raise = yield* answer(yield* set(3));
    const sent = yield* answer(yield* sign(raise.approval));
    assert.ok(sent._tag === "Sent");
    assert.equal((yield* companySafe).threshold, 3);
    const { org } = yield* Ref.get(northwind);
    const proposed = yield* answer(yield* grant(org, "sam", "manage-books"));
    assert.deepEqual(
      [Arr.map(proposed.approvals, (each) => each.signer), proposed.proposal.threshold],
      [["dana", "eli", "sam"], 3],
    );
    const [dana, eli, sam] = proposed.approvals;
    assert.ok(dana !== undefined && eli !== undefined && sam !== undefined, "no approvals");
    assert.equal((yield* answer(yield* sign(dana)))._tag, "Collected");
    assert.equal((yield* answer(yield* sign(eli)))._tag, "Collected");
    assert.equal((yield* answer(yield* sign(sam)))._tag, "Sent");
  }),
);

test("the runtime is let go", () => runtime.dispose());
