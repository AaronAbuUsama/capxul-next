// doc.create, claim 2: a caller with no user on the company's site is refused, and nothing is made.
import { Site } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { create } from "../support/site.ts";
import { head, northwind, unchangedRecord } from "../support/world.ts";

export const docCreate2 = scenario(
  { operation: "doc.create", claim: 2 },
  Effect.gen(function* () {
    const { org } = yield* northwind;
    const before = yield* head;
    const refused = yield* refusal(
      "doc.create as pat",
      "NoSiteUser",
      create(org, Site.DOCTYPES.supplier, Site.supplierFields(Site.BRIGHTSIDE), { as: "pat" }),
    );
    yield* same("NoSiteUser", { org: refused.org, person: refused.person }, { org, person: "pat" });
    yield* unchangedRecord("doc.create as pat", before);
  }),
);
