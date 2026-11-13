// org.create, claim 5: it needs the founder's claimed personal Safe before the first write.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { NORTHWIND_FOUNDING } from "../support/founding.ts";
import { head, thisView, unchangedRecord } from "../support/world.ts";

export const orgCreate5 = scenario(
  { operation: "org.create", claim: 5 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const before = yield* head;
    const refused = yield* refusal(
      "org.create as pat",
      "FounderNotReady",
      capxul["org.create"]({ ...NORTHWIND_FOUNDING, directors: ["eli"], members: ["sam"] }, { as: "pat" }),
    );
    yield* same("FounderNotReady's person", refused.person, "pat");
    const shown = yield* thisView;
    yield* same("the companies world.show lists", shown.companies, []);
    yield* unchangedRecord("org.create as pat", before);
  }),
);
