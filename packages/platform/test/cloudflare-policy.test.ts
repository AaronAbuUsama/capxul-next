// CI's Cloudflare token: what worlds and the platform need, one zone, and nothing that makes or widens a token.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Arr from "effect/Array";
import { tokenPolicies } from "../bootstrap/src/cloudflare-policy.ts";

test("the token is scoped to one account and one zone, nested as Cloudflare requires", () => {
  const [account, zone] = tokenPolicies("acc1", "zone1");
  assert.deepEqual(account?.resources, { "com.cloudflare.api.account.acc1": "*" });
  assert.deepEqual(zone?.resources, {
    "com.cloudflare.api.account.acc1": { "com.cloudflare.api.account.zone.zone1": "*" },
  });
  assert.deepEqual(zone?.permissionGroups, ["Zone Read", "DNS Write", "Workers Routes Write"]);
});

test("the token cannot make tokens, change the zone's settings or certificates, or reach Access", () => {
  const groups = Arr.flatMap(tokenPolicies("a", "z"), (p) =>
    Arr.map(p.permissionGroups, (g) => (typeof g === "string" ? g : g.id)),
  );
  for (const g of groups) assert.doesNotMatch(g, /API Tokens|Access|SSL|Certificates|Zone Settings|Billing|Member/, g);
  for (const needed of [
    "Workers Scripts Write",
    "Workers Containers Write",
    "Cloudflare Tunnel Write",
    "Hyperdrive Write",
  ])
    assert.ok(Arr.contains(groups, needed), needed);
});
