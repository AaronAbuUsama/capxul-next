// doc.create, claim 3: a member whose roles do not allow the document is refused by the site, and nothing is made.
import { Site } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { create } from "../support/site.ts";
import { head, northwind, unchangedRecord } from "../support/world.ts";

export const docCreate3 = scenario(
  { operation: "doc.create", claim: 3 },
  Effect.gen(function* () {
    const { org } = yield* northwind;
    const before = yield* head;
    const employee = {
      first_name: "Ada",
      last_name: "Lovelace",
      gender: "Female",
      date_of_birth: "1990-12-10",
      date_of_joining: "2026-11-01",
    };
    const refused = yield* refusal(
      "doc.create of an Employee as sam",
      "SiteRefused",
      create(org, Site.DOCTYPES.employee, employee, { as: "sam" }),
    );
    yield* same(
      "SiteRefused",
      { org: refused.org, target: refused.target, reason: refused.reason },
      { org, target: Site.DOCTYPES.employee, reason: "permission" },
    );
    yield* unchangedRecord("the refused Employee", before);
  }),
);
