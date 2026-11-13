// An example, not one of the thin line's scenarios (step 1.5 writes those): it shows the format and gives the runner
// something to run. It fails against Core's empty handlers, which answer `NotImplemented`.
import { startingWorlds } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { example, expect } from "../scenario.ts";

export const recordExport = example(
  "record.export answers a fresh world with its first entry",
  startingWorlds.fresh,
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const record = yield* capxul["record.export"]({ from: null, to: null });
    yield* expect(record.head >= 1, `the record's head is ${record.head}; a fresh world's record has one entry`);
  }),
);
