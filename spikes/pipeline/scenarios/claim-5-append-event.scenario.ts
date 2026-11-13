// Acceptance claim 5 (../contract/README.md):
//
//   Every successful append emits exactly one record_appended event carrying its key and seq, and a refused
//   append emits none.
//
// An event cannot be seen through the door, so this scenario holds no check of events. Its job is to make the
// calls the claim is about and to make sure each ended the way the claim needs: three appends that are accepted,
// a refused append between the second and the third, and one more refused append at the end. The runner then
// applies its generic `events` check to every one of those calls under the call's own trace id: exactly one
// record_appended for each call the caller saw succeed, none for each call the caller saw refused.
//
// What that leaves unproven is said in README.md ("What claim 5 does not prove").
import * as Effect from "effect/Effect";
import { expect, scenario } from "../runner/scenario.ts";
import { append, appendRefused, show, type Draft } from "./record.ts";

const opened: Draft = { key: "account/operating", kind: "account.opened", body: { bank: { name: "Fenwick Mutual", country: "GB" }, currency: "GBP", signatories: ["ngozi", "tobias"] } };
const funded: Draft = { key: "transfer/0001", kind: "transfer.settled", body: { to: "account/operating", amount: { value: "15000.00", currency: "GBP" }, reference: null } };
const spent: Draft = { key: "transfer/0002", kind: "transfer.settled", body: { from: "account/operating", amount: { value: "320.40", currency: "GBP" }, tags: ["rent", ["2026", "11"]] } };

export default scenario(
  "claim 5: every successful append emits exactly one record_appended event carrying its key and seq, and a refused append emits none",
  Effect.gen(function* () {
    // Two successes: the runner expects one record_appended under each call's trace id.
    const one = yield* append(opened);
    const two = yield* append(funded);

    // A refusal in the middle: the runner expects no event under this call's trace id.
    const refusedFunded = yield* appendRefused({ key: funded.key, kind: "transfer.reversed", body: { reason: "a refused append must leave no event" } });
    yield* expect(refusedFunded.key === funded.key, `DuplicateEntry named key ${show(refusedFunded.key)}, expected ${show(funded.key)}`);

    // A success after a refusal: one event again, and it is this call's, not the refused one's.
    const three = yield* append(spent);

    // A refusal as the last call: nothing after it can hide an event it left.
    const refusedOpened = yield* appendRefused(opened);
    yield* expect(refusedOpened.key === opened.key, `DuplicateEntry named key ${show(refusedOpened.key)}, expected ${show(opened.key)}`);

    // What the caller can see of "carrying its key and seq": the seq each success answered, which its event must carry.
    const seqs = [one.seq, two.seq, three.seq];
    yield* expect(show(seqs) === show([1, 2, 3]), `the three accepted appends returned seqs ${show(seqs)}, expected [1,2,3]`);
  }),
);
