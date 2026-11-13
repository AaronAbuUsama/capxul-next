// report.run, claim 1: a report runs as the caller and the books agree with the chain: the General Ledger's balance
// of the Capxul Safe account and the Trial Balance's both equal the company Safe's USDC on the chain.
import { Site, startingWorlds } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { given, scenario } from "../scenario.ts";
import { sameAmount } from "../support/expect.ts";
import { usdc } from "../support/chain.ts";
import { ledger, outstanding, safeAccount, safeBalance, trialSafeBalance } from "../support/site.ts";

export const reportRun1 = scenario(
  { operation: "report.run", claim: 1 },
  Effect.gen(function* () {
    const facts = yield* given(startingWorlds.paid);
    const org = facts.founded.org;
    const sam = { as: "sam" };
    const account = yield* safeAccount(org, sam);
    const lines = yield* ledger(org, { [Site.FILTERS.generalLedger.account]: account }, sam);
    const onChain = Number(yield* usdc(facts.world, facts.founded.safe));
    yield* sameAmount(`the General Ledger's balance of ${account}`, safeBalance(lines), onChain);
    yield* sameAmount(`the Trial Balance's closing balance of ${account}`, yield* trialSafeBalance(org, sam), onChain);
    yield* sameAmount(
      `what is outstanding on ${facts.invoice.name}`,
      yield* outstanding(org, facts.invoice.name, sam),
      0,
    );
  }),
);
