// report.run, claim 1: a report runs as the caller and the books agree with the chain. The company Safe's balance
// is read from what the starting world says the chain holds: 1,000 USDC of dana's capital, less the 125.50 paid
// to Brightside. Not checked: that balance read through the door's chain RPC at the world's now, which Capxul does
// not offer.
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { sameAmount } from "../support/expect.ts";
import { ledger, outstanding, safeAccount, safeBalance, trialSafeBalance } from "../support/books.ts";
import { paymentDocuments } from "../support/documents.ts";

const ON_CHAIN = 1000 - 125.5;

export const reportRun1 = scenario(
  { operation: "report.run", claim: 1 },
  Effect.gen(function* () {
    const { org, invoice } = yield* paymentDocuments;
    const account = yield* safeAccount(org, "sam");
    const lines = yield* ledger(org, { account }, "sam");
    yield* sameAmount(`the General Ledger's balance of ${account}`, safeBalance(lines), ON_CHAIN);
    yield* sameAmount(
      `the Trial Balance's closing balance of ${account}`,
      yield* trialSafeBalance(org, "sam"),
      ON_CHAIN,
    );
    yield* sameAmount(`what is outstanding on ${invoice}`, yield* outstanding(org, invoice, "sam"), 0);
  }),
);
