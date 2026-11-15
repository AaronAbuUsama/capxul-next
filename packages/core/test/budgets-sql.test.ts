// The budgets operations served in this process against a real Postgres with Core's migrations applied, from Northwind
// founded (the starting world `founded`), over a stand-in of the world's chain (test/support/budgets.ts): the journey
// "give sam a budget at Northwind" in packages/scenarios, step by step, with what each call answers, refuses and
// records, the company Safe transaction a creation proposes, and its landing. The transaction itself is never sent:
// that needs the real chain (test/chain/). Runs only with CAPXUL_TEST_DATABASE (a throwaway Postgres); CI has none,
// so it skips.
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Str from "effect/String";
import * as PgClient from "@effect/sql-pg/PgClient";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters } from "viem";
import { landed } from "../src/approvals/landed.ts";
import { markSent } from "../src/approvals/store.ts";
import { BUDGETS } from "../src/chain/abi.ts";
import { SEEDED } from "../src/chain/seeded.ts";
import { migrations } from "../src/door.ts";
import { BOOKS, buildHatId, proposedOf, standIn, wearing, type ChainState } from "./support/budgets.ts";
import { answer, as, core, eventsOf, fresh, ORG, recordSize, refusal } from "./support/people.ts";

const SAFE = "0x00000000000000000000000000000000000000c0";
const SAM_SAFE = "0x0000000000000000000000000000000000000051";
const USDC = 1_000_000n;
const state: ChainState = {
  budgets: new Map([
    [
      5n,
      {
        safe: "0x00000000000000000000000000000000000000f0",
        parent: 0n,
        hat: 9n,
        amount: 10n,
        childrenAmount: 0n,
        children: [],
      },
    ],
    [7n, { safe: SAFE, parent: 0n, hat: BOOKS, amount: 1_000_000n * USDC, childrenAmount: 0n, children: [] }],
  ]),
  lastChild: new Map(),
  wearers: new Set(),
  nonces: new Map([[SAFE, 3n]]),
};

const url = process.env["CAPXUL_TEST_DATABASE"];
const skip = url === undefined;
const runtime = ManagedRuntime.make(core(url ?? "", standIn(state)));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;
const it = <E>(name: string, body: Effect.Effect<void, E, Services>) =>
  test(name, { skip }, () => runtime.runPromise(Effect.orDie(body)));

let n = 0;
const next = () => (n += 1);
const list = (by: string | undefined, org = ORG) =>
  as(next(), by, (client, options) => client("org.budget.list", { org }, options));
const show = (budget: string, by: string | undefined, org = ORG) =>
  as(next(), by, (client, options) => client("org.budget.show", { org, budget }, options));
const office = { org: ORG, parent: "7", name: "Office costs", holder: "sam", amount: "1000" };
const create = (by: string, change: Partial<typeof office> = {}) =>
  as(next(), by, (client, options) => client("org.budget.create", { ...office, ...change }, options));

const TOP = {
  id: "7",
  org: ORG,
  name: "Northwind Trading",
  parent: null,
  hat: BOOKS.toString(),
  holders: [],
  asset: "USDC",
  period: "month",
  amount: "1000000",
  spent: "0",
  committed: "0",
  left: "1000000",
  closed: false,
};
const made = { creation: "", hat: buildHatId(BOOKS, 1) };

const folder = fileURLToPath(migrations.href);
const files = Arr.map(Arr.sort(Arr.filter(readdirSync(folder), Str.endsWith(".sql")), Order.String), (file) =>
  readFileSync(`${folder}${file}`, "utf8"),
);

it(
  "the world: a fresh database, the cast, and northwind founded with its top budget",
  Effect.gen(function* () {
    yield* fresh(files);
    const sql = yield* PgClient.PgClient;
    yield* sql`update app.organizations set budget = '7' where org = ${ORG}`;
    yield* sql`insert into app.companies ${sql.insert({ org: ORG, handle: "northwind", name: "Northwind Trading", site_state: "ready", site_url: null })}`;
  }),
);

it(
  "org.budget.list and show: the top budget as the chain holds it, named as the company is; who may not read it",
  Effect.gen(function* () {
    assert.deepEqual(yield* answer(yield* list("dana")), { org: ORG, budgets: [TOP] });
    assert.deepEqual(yield* answer(yield* list(undefined)), { org: ORG, budgets: [TOP] });
    assert.deepEqual(yield* answer(yield* show("7", "sam")), TOP);
    assert.deepEqual(yield* refusal(yield* list("olga")), { _tag: "NotAMember", org: ORG, person: "olga" });
    assert.deepEqual(yield* refusal(yield* show("7", "olga")), { _tag: "NotAMember", org: ORG, person: "olga" });
    assert.deepEqual(yield* refusal(yield* list("dana", "org_nowhere1")), { _tag: "OrgNotFound", org: "org_nowhere1" });
    for (const budget of ["999999", "5"])
      assert.deepEqual(yield* refusal(yield* show(budget, "dana")), { _tag: "BudgetNotFound", org: ORG, budget });
    assert.equal(yield* recordSize, 0);
  }),
);

it(
  "org.budget.create: who may not propose, whom a budget may not go to, and what does not fit, recording nothing",
  Effect.gen(function* () {
    assert.deepEqual(yield* refusal(yield* create("sam")), { _tag: "NotADirector", org: ORG, person: "sam" });
    for (const holder of ["olga", "zed"])
      assert.deepEqual(yield* refusal(yield* create("dana", { holder })), {
        _tag: "NotAMember",
        org: ORG,
        person: holder,
      });
    assert.deepEqual(yield* refusal(yield* create("dana", { holder: "pat" })), {
      _tag: "MemberHasNoSafe",
      org: ORG,
      person: "pat",
    });
    for (const parent of ["999999", "5"])
      assert.deepEqual(yield* refusal(yield* create("dana", { parent })), {
        _tag: "BudgetNotFound",
        org: ORG,
        budget: parent,
      });
    assert.deepEqual(yield* refusal(yield* create("dana", { amount: "1000000.000001" })), {
      _tag: "ExceedsParent",
      org: ORG,
      parent: "7",
      left: "1000000",
      amount: "1000000.000001",
    });
    assert.deepEqual(yield* refusal(yield* create("dana", { org: "org_nowhere1" })), {
      _tag: "OrgNotFound",
      org: "org_nowhere1",
    });
    assert.equal(yield* recordSize, 0);
  }),
);

it(
  "org.budget.create: dana proposes Office costs; one batch makes its hat under Books, mints it to sam, makes the budget",
  Effect.gen(function* () {
    const ended = yield* create("dana");
    const proposed = yield* answer(ended);
    assert.match(proposed.creation.id, /^bcr_[a-z0-9]{12}$/);
    assert.deepEqual(proposed.creation, {
      ...office,
      id: proposed.creation.id,
      asset: "USDC",
      period: "month",
      state: "proposed",
    });
    assert.deepEqual([proposed.proposal.nonce, proposed.proposal.threshold], [3, 2]);
    assert.deepEqual(
      Arr.map(proposed.approvals, (each) => [each.signer, each.signerAddress]),
      [
        ["dana", "0x0000000000000000000000000000000000000001"],
        ["eli", "0x0000000000000000000000000000000000000002"],
      ],
    );
    assert.deepEqual(yield* eventsOf(ended.trace), [
      {
        event: "budget_proposed",
        payload: { creation: proposed.creation.id, org: ORG, parent: "7", proposal: proposed.proposal.id },
      },
      {
        event: "proposal_opened",
        payload: {
          proposal: proposed.proposal.id,
          org: ORG,
          nonce: 3,
          threshold: 2,
          approvals: Arr.map(proposed.approvals, (each) => each.id),
        },
      },
    ]);
    const hats = Str.toLowerCase(SEEDED.hats);
    assert.deepEqual(yield* proposedOf(proposed.creation.id), {
      nonce: "3",
      calls: [
        { to: hats, name: "createHat", args: [BOOKS, "Budget", 1, SAFE, SAFE, true, ""] },
        { to: hats, name: "mintHat", args: [made.hat, SAM_SAFE] },
        { to: Str.toLowerCase(SEEDED.budgets), name: "createChildBudget", args: [7n, 1000n * USDC, made.hat] },
      ],
    });
    assert.deepEqual(
      Arr.map((yield* answer(yield* list("dana"))).budgets, (each) => each.id),
      ["7"],
    );
    made.creation = proposed.creation.id;
  }),
);

it(
  "a second creation and an officer change while it waits take the next nonces, and the second hat the next child",
  Effect.gen(function* () {
    const second = yield* answer(yield* create("eli", { name: "Travel", amount: "50" }));
    assert.equal(second.proposal.nonce, 4);
    const [, mint] = (yield* proposedOf(second.creation.id)).calls;
    assert.deepEqual(mint?.args, [buildHatId(BOOKS, 2), SAM_SAFE]);
    const grant = yield* as(next(), "dana", (client, options) =>
      client("org.member.grant", { org: ORG, member: "sam", permission: "issue-invoices", note: null }, options),
    );
    assert.equal((yield* answer(grant)).proposal.nonce, 5);
  }),
);

it(
  "the landing: the budget its log names is sam's Office costs, held by sam, 1,000 less left in the top one",
  Effect.gen(function* () {
    const log = {
      address: SEEDED.budgets,
      topics: Arr.filter(
        encodeEventTopics({ abi: BUDGETS, eventName: "BudgetCreated", args: { safe: SAFE, id: 8n, parent: 7n } }),
        Predicate.isString,
      ),
      data: encodeAbiParameters(parseAbiParameters("address, uint8, uint128, uint256"), [
        SEEDED.usdc,
        0,
        1000n * USDC,
        made.hat,
      ]),
    };
    const receipt = { transactionHash: `0x${Str.repeat(32)("ab")}`, blockNumber: "0x9", logs: [log] };
    yield* markSent("budget_creation", made.creation, receipt.transactionHash, 9n);
    yield* landed({ kind: "budget_creation", id: made.creation }, { success: true, receipt });
    state.budgets.set(8n, {
      safe: SAFE,
      parent: 7n,
      hat: made.hat,
      amount: 1000n * USDC,
      childrenAmount: 0n,
      children: [],
    });
    const top = state.budgets.get(7n);
    if (top !== undefined) {
      top.childrenAmount += 1000n * USDC;
      top.children.push(8n);
    }
    state.lastChild.set(BOOKS, 1);
    state.wearers.add(wearing(SAM_SAFE, made.hat));
    state.nonces.set(SAFE, 4n);
    const shown = yield* answer(yield* show("8", "sam"));
    const expected = {
      ...TOP,
      id: "8",
      name: "Office costs",
      parent: "7",
      hat: made.hat.toString(),
      holders: ["sam"],
      amount: "1000",
      left: "1000",
    };
    assert.deepEqual(shown, expected);
    assert.deepEqual(yield* answer(yield* list("eli")), { org: ORG, budgets: [{ ...TOP, left: "999000" }, expected] });
    assert.deepEqual(yield* refusal(yield* create("dana", { amount: "999000.000001" })), {
      _tag: "ExceedsParent",
      org: ORG,
      parent: "7",
      left: "999000",
      amount: "999000.000001",
    });
    const inside = yield* answer(yield* create("dana", { parent: "8", name: "Cleaners", amount: "200" }));
    assert.deepEqual([inside.creation.parent, inside.creation.period, inside.proposal.nonce], ["8", "month", 6]);
    const [hat, mint] = (yield* proposedOf(inside.creation.id)).calls;
    assert.equal(hat?.args[0], made.hat);
    assert.deepEqual(mint?.args, [buildHatId(made.hat, 1), SAM_SAFE]);
  }),
);

after(() => runtime.dispose());
