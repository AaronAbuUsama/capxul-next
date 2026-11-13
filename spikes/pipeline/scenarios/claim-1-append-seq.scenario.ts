// Acceptance claim 1 (../contract/README.md):
//
//   The first append in a fresh world returns seq 1 and each later append returns the previous seq plus one.
//
// Five appends, one after another, in a fresh world. Their keys are not in alphabetical order, two share a kind and
// two share a body, so nothing but the order of the appends can explain the seqs. The claim holds when the first
// seq is 1 and every other seq is one more than the seq before it: 1, 2, 3, 4, 5.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { expect, scenario } from "../runner/scenario.ts";
import { append, show, type Draft } from "./record.ts";

const drafts: ReadonlyArray<Draft> = [
  { key: "payment/2026-11-0007", kind: "payment.requested", body: { amount: { value: "1250.00", currency: "GBP" }, payee: { name: "Harbour Print Ltd", account: { sortCode: "20-00-00", number: "55779911" } } } },
  { key: "budget/marketing", kind: "budget.opened", body: { limit: 40000, period: { from: "2026-11-01", to: "2027-01-31" }, owners: ["amara", "tobias"] } },
  { key: "approval/2026-11-0007/1", kind: "payment.approved", body: { by: "amara", conditions: [] } },
  { key: "approval/2026-11-0007/2", kind: "payment.approved", body: { by: "amara", conditions: [] } },
  { key: "Budget/Marketing", kind: "note", body: "same words as an earlier key, in another case: a different key" },
];

export default scenario(
  "claim 1: the first append in a fresh world returns seq 1 and each later append returns the previous seq plus one",
  Effect.gen(function* () {
    const appended = yield* Effect.forEach(drafts, append, { concurrency: 1 });
    const seqs = appended.map((entry) => entry.seq);

    yield* expect(seqs[0] === 1, `the first append in a fresh world returned seq ${seqs[0]}, expected 1`);
    yield* Effect.forEach(Arr.zip(appended, appended.slice(1)), ([previous, later]) =>
      expect(later.seq === previous.seq + 1, `the append of key ${show(later.key)} returned seq ${later.seq} after seq ${previous.seq}, expected ${previous.seq + 1}; all seqs: ${show(seqs)}`),
    );
  }),
);
