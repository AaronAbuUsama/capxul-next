// What a subject's landing means beyond its transaction, by kind, and what must hold before it is sent. Each domain
// whose operations ask for approvals says what its subjects' landings mean (`landings`, by kind); this file gathers
// them and dispatches on the subject's kind. A new kind is one entry in `landings`, and the type refuses a kind of the
// blueprint's `Subject` that has none.
import { Errors } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { formatUnits } from "viem";
import { usdcOf } from "../chain/calls.ts";
import { USDC_DECIMALS } from "../chain/seeded.ts";
import type { Landed } from "../chain/userop.ts";
import * as Board from "../board/landed.ts";
import * as Organizations from "../organizations/landed.ts";
import * as Payments from "./payments.ts";
import { subjectOf, type Subject } from "./store.ts";

/** Every kind of subject, with what its landing records and tells the site, and the company it belongs to. */
const landings = {
  ...Organizations.landings,
  ...Board.landings,
  ...Payments.landings,
} satisfies {
  readonly [Kind in Subject["kind"]]: {
    readonly landed: (id: string, landing: Landed) => unknown;
    readonly orgOf: (id: string) => unknown;
  };
};

/** Refuses a send whose spend is more than its Safe holds now. */
export const checkFunds = Effect.fn("approval.sign.funds")(function* (subject: Subject) {
  const held = yield* subjectOf(subject.kind, subject.id);
  if (held.spends === null) return yield* Effect.void;
  const balance = yield* usdcOf(held.spends.safe);
  const amount = BigInt(held.spends.amount);
  if (amount > balance)
    return yield* Errors.InsufficientBalance.make({
      safe: held.spends.safe,
      asset: "USDC",
      balance: formatUnits(balance, USDC_DECIMALS),
      amount: formatUnits(amount, USDC_DECIMALS),
    });
  return yield* Effect.void;
});

/** Records what the landing of `subject` made, inside the transaction that marks it sent. */
export const landed = Effect.fn("approval.sign.landed")(function* (subject: Subject, landing: Landed) {
  return yield* landings[subject.kind].landed(subject.id, landing);
});

/** The company a landed subject belongs to, whose site may now be moved on. */
export const orgOf = (subject: Subject) => landings[subject.kind].orgOf(subject.id);
