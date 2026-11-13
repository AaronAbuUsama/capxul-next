// org.create, claim 7: a founding Director or member who is not a person of the world, capital beyond the
// founder's balance, and a second founding while the first is unfinished are each refused, and nothing is made.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { refusal, same, sameAddress, sameAmount } from "../support/expect.ts";
import { found, NORTHWIND_FOUNDING, type Founding } from "../support/founding.ts";
import { castMember, head, thisView, unchangedRecord } from "../support/world.ts";

export const orgCreate7 = scenario(
  { operation: "org.create", claim: 7 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const dana = yield* castMember(yield* thisView, "dana");
    const before = yield* head;
    const asDana = (founding: Founding) => capxul["org.create"](founding, { as: "dana" });

    const director = yield* refusal(
      "org.create naming a Director nobody in the cast",
      "PersonNotFound",
      asDana({ ...NORTHWIND_FOUNDING, directors: ["zed"] }),
    );
    yield* same("PersonNotFound's person", director.person, "zed");
    const member = yield* refusal(
      "org.create naming a member nobody in the cast",
      "PersonNotFound",
      asDana({ ...NORTHWIND_FOUNDING, members: ["sam", "zed"] }),
    );
    yield* same("PersonNotFound's person", member.person, "zed");
    const poor = yield* refusal(
      "org.create with 20,000 USDC of capital",
      "InsufficientBalance",
      asDana({ ...NORTHWIND_FOUNDING, capital: { asset: "USDC", amount: "20000" } }),
    );
    yield* sameAddress("InsufficientBalance's Safe", poor.safe, dana.safe);
    yield* same("InsufficientBalance's asset", poor.asset, "USDC");
    yield* sameAmount("InsufficientBalance's balance", poor.balance, 10_000);
    yield* sameAmount("InsufficientBalance's amount", poor.amount, 20_000);
    yield* unchangedRecord("the refused foundings", before);
    yield* same("the companies after the refusals", (yield* thisView).companies, []);

    const founded = yield* found();
    const afterFounding = yield* head;
    const second = yield* refusal(
      "a second founding by dana while northwind awaits signatures",
      "SetupUnfinished",
      asDana({ ...NORTHWIND_FOUNDING, handle: "southwind" }),
    );
    yield* same(
      "SetupUnfinished",
      { org: second.org, handle: second.handle },
      { org: founded.org, handle: "northwind" },
    );
    yield* unchangedRecord("the second founding", afterFounding);
    yield* same(
      "the companies",
      Arr.map((yield* thisView).companies, (each) => each.org),
      [founded.org],
    );
  }),
);
