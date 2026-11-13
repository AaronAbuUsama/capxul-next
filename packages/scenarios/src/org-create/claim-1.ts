// org.create, claim 1: the Organization's Safe is Companies House's company Safe for this founder.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { same, sameAddress } from "../support/expect.ts";
import { isAddress, logsOf } from "../support/chain.ts";
import { found } from "../support/founding.ts";
import { castMember, thisView } from "../support/world.ts";

export const orgCreate1 = scenario(
  { operation: "org.create", claim: 1 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const founded = yield* found();
    const world = yield* thisView;
    const dana = yield* castMember(world, "dana");
    yield* same("the founder", founded.founder, "dana");
    yield* sameAddress("the founder's Safe", founded.founderSafe, dana.safe);

    const contracts = world.contracts;
    const logs = yield* capxul.chain.logs({
      log: "CompanySafeMinted",
      address: contracts.companySafeMinter,
      fromBlock: null,
      toBlock: null,
    });
    const minted = Arr.filter(logsOf(logs, "CompanySafeMinted"), (log) => isAddress(log.safe, founded.safe));
    yield* same("the CompanySafeMinted logs naming the company Safe", minted.length, 1);
    for (const log of minted) {
      yield* sameAddress("CompanySafeMinted's founderSafe", log.founderSafe, dana.safe);
      yield* same("CompanySafeMinted's company", log.company, founded.org);
    }
    const derived = yield* capxul.chain.companySafeFor({
      minter: contracts.companySafeMinter,
      owner: contracts.companiesHouse,
      namespace: contracts.companyNamespace,
      company: founded.org,
      founderSafe: founded.founderSafe,
    });
    yield* sameAddress("companySafeAddressFor the org and dana's Safe", derived, founded.safe);
  }),
);
