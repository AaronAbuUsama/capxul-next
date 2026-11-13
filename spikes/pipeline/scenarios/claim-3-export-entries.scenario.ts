// Acceptance claim 3 (../contract/README.md):
//
//   Export returns every appended entry exactly once, in seq order, with its key, kind and body as appended.
//
// Six entries are appended. Their keys are in neither alphabetical nor reverse order, two share a kind, and their
// bodies cover what the contract calls json: a nested object, a nested array, a bare string, a bare number, null,
// and an object of empty containers and text that needs escaping. The export must hold exactly these six, each
// once, each with the seq its append returned and the key, kind and body it was appended with, lowest seq first.
// A second export must say the same: exporting changes nothing.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import { expect, scenario } from "../runner/scenario.ts";
import { append, exported, same, show, type Draft, type Plain } from "./record.ts";

const drafts: ReadonlyArray<Draft> = [
  {
    key: "mandate/treasury",
    kind: "mandate.granted",
    body: {
      holder: { name: "Ngozi Adeyemi", roles: ["treasurer", "signatory"] },
      limits: { perPayment: 5000, perMonth: 20000.5, currencies: ["GBP", "EUR"] },
      active: true,
      revokedAt: null,
      history: [{ at: "2026-10-01T09:00:00Z", change: { from: null, to: 5000 } }],
    },
  },
  { key: "ledger/2026-11", kind: "ledger.closed", body: [1, [2, [3, { deep: [true, false, null] }]], "four", -5.25, 0] },
  { key: "banner", kind: "note", body: "a body that is one bare string" },
  { key: "counter/visits", kind: "note", body: 42.5 },
  { key: "address/none", kind: "address.cleared", body: null },
  { key: "Aardvark & sons", kind: "supplier.added", body: { emptyObject: {}, emptyList: [], text: 'naïve "quoted" \\ back-slashed\nsecond line; 東京', "a key with spaces": 1 } },
];

const bySeq = Order.mapInput(Order.Number, (entry: Plain) => entry.seq);

export default scenario(
  "claim 3: export returns every appended entry exactly once, in seq order, with its key, kind and body as appended",
  Effect.gen(function* () {
    const appended = yield* Effect.forEach(drafts, append, { concurrency: 1 });
    const seqs = appended.map((entry) => entry.seq);
    yield* expect(new Set(seqs).size === drafts.length, `six appends returned seqs that are not all different: ${show(seqs)}`);
    const expected = Arr.sort(appended, bySeq);

    const entries = yield* exported;
    yield* expect(entries.length === expected.length, `export returned ${entries.length} entries after ${expected.length} appends: ${show(entries)}`);
    yield* Effect.forEach(expected, (entry) => {
      const found = entries.filter((candidate) => candidate.key === entry.key);
      return expect(found.length === 1 && same(found[0], entry), `export holds key ${show(entry.key)} ${found.length} times as ${show(found)}, expected once as ${show(entry)}`);
    });
    yield* expect(same(entries.map((entry) => entry.seq), expected.map((entry) => entry.seq)), `export returned seqs in the order ${show(entries.map((entry) => entry.seq))}, expected ${show(expected.map((entry) => entry.seq))}`);
    yield* expect(same(entries, expected), `export returned ${show(entries)}, expected ${show(expected)}`);

    const again = yield* exported;
    yield* expect(same(again, expected), `a second export returned ${show(again)}, expected the same as the first: ${show(expected)}`);
  }),
);
