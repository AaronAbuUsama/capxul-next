// Acceptance claim 2 (../contract/README.md):
//
//   Appending a key that was already appended is refused with DuplicateEntry naming the key, and the record is
//   unchanged.
//
// Two entries are appended and the record is exported. Then, in the middle of the sequence, the first key is
// appended again twice: once with exactly what is already there (a refusal is not an idempotent success), then
// with another kind and body (a refusal must not overwrite). Each must be refused with DuplicateEntry naming that
// key. The record is exported again and must be what it was before the refusals. Last, a third entry is appended:
// it must get the seq after the second entry's (a refused append takes no seq) and a final export must hold the
// three accepted entries and nothing of the refused ones.
import * as Effect from "effect/Effect";
import { expect, scenario } from "../runner/scenario.ts";
import { append, appendRefused, exported, same, show, type Draft } from "./record.ts";

const first: Draft = {
  key: "invoice/INV-1001",
  kind: "invoice.issued",
  body: { customer: { id: "cus_814", name: "Okafor & Daughters" }, lines: [{ sku: "SEAT-ANNUAL", quantity: 12, unit: "49.00" }, { sku: "SETUP", quantity: 1, unit: "250.00" }], total: "838.00" },
};
const second: Draft = { key: "invoice/INV-1002", kind: "invoice.issued", body: { customer: { id: "cus_302", name: "Linden Yard" }, lines: [], total: "0.00" } };
const third: Draft = { key: "invoice/INV-1001/paid", kind: "invoice.paid", body: { invoice: "invoice/INV-1001", received: { amount: "838.00", on: "2026-11-20" } } };

/** The first key again, with a kind and body the record must never show. */
const overwrite: Draft = { key: first.key, kind: "invoice.voided", body: { reason: "this body must not reach the record", total: "0.00" } };

export default scenario(
  "claim 2: appending a key that was already appended is refused with DuplicateEntry naming the key, and the record is unchanged",
  Effect.gen(function* () {
    const one = yield* append(first);
    const two = yield* append(second);
    const before = yield* exported;
    yield* expect(same(before, [one, two]), `before any refusal the record was ${show(before)}, expected ${show([one, two])}`);

    const refusedRepeat = yield* appendRefused(first);
    yield* expect(refusedRepeat.key === first.key, `DuplicateEntry for an identical second append named key ${show(refusedRepeat.key)}, expected ${show(first.key)}`);
    const refusedOverwrite = yield* appendRefused(overwrite);
    yield* expect(refusedOverwrite.key === first.key, `DuplicateEntry for another kind and body named key ${show(refusedOverwrite.key)}, expected ${show(first.key)}`);

    const afterRefusals = yield* exported;
    yield* expect(same(afterRefusals, before), `two refused appends changed the record: it was ${show(before)} and is now ${show(afterRefusals)}`);

    const three = yield* append(third);
    yield* expect(three.seq === two.seq + 1, `the append after two refused appends returned seq ${three.seq}, expected ${two.seq + 1}: a refused append takes no seq`);
    const final = yield* exported;
    yield* expect(same(final, [one, two, three]), `at the end the record was ${show(final)}, expected ${show([one, two, three])}`);
  }),
);
