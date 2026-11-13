// record.export, claim 4: a range answers only the entries from and to the positions asked, and a range past the
// head answers none.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { same } from "../support/expect.ts";
import { record } from "../support/world.ts";

export const recordExport4 = scenario(
  { operation: "record.export", claim: 4 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const whole = yield* record;
    const range = yield* capxul["record.export"]({ from: 2, to: 3 });
    yield* same(
      "the entries from 2 to 3",
      range.entries,
      Arr.filter(whole.entries, (entry) => entry.seq >= 2 && entry.seq <= 3),
    );
    yield* same(
      "the positions from 2 to 3",
      Arr.map(range.entries, (entry) => entry.seq),
      [2, 3],
    );
    yield* same("the head of the range", range.head, whole.head);
    const past = yield* capxul["record.export"]({ from: whole.head + 1, to: null });
    yield* same("the entries past the head", past.entries, []);
    yield* same("the head of the range past the head", past.head, whole.head);
  }),
);
