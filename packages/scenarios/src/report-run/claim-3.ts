// report.run, claim 3: a caller with no user on the company's site is refused.
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { report, REPORTS } from "../support/books.ts";
import { head, northwind, unchangedRecord } from "../support/world.ts";

export const reportRun3 = scenario(
  { operation: "report.run", claim: 3 },
  Effect.gen(function* () {
    const { org } = yield* northwind;
    const before = yield* head;
    const refused = yield* refusal("report.run as pat", "NoSiteUser", report(org, REPORTS.generalLedger, {}, "pat"));
    yield* same("NoSiteUser", { org: refused.org, person: refused.person }, { org, person: "pat" });
    yield* unchangedRecord("the refused report", before);
  }),
);
