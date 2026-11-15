// The api runs next to its data (Aaron's decision D5, 15 November 2026; src/stack/region.ts): its Worker carries a
// region placement hint naming the cloud region of the Neon databases it reaches, in Cloudflare's `provider:region`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { API_PLACEMENT, DATABASE_REGION } from "../src/stack/region.ts";

test("The api's Worker is placed in its database's region, London", () => {
  assert.equal(DATABASE_REGION, "aws-eu-west-2");
  assert.deepEqual(API_PLACEMENT, { region: "aws:eu-west-2" });
});
