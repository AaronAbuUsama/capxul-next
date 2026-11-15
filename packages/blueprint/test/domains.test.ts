// The domains and the two Rpc groups made from them: each group holds exactly its domains' shares, with its own
// middlewares, and the thin line's twelve stay where they were. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import { domains, PlatformRpcs, WorldRpcs } from "../src/door.ts";

/** The thin line's twelve, by the group that serves each. A domain adds operations; none of these ever moves. */
const THIN_LINE = {
  platform: ["world.create", "world.show", "world.snapshot.save", "world.snapshot.restore"],
  world: [
    "org.create",
    "org.member.grant",
    "doc.create",
    "doc.submit",
    "approval.sign",
    "report.run",
    "world.clock.warp",
    "record.export",
  ],
} as const;

type Group = {
  readonly requests: ReadonlyMap<string, { readonly middlewares: ReadonlySet<{ readonly key: string }> }>;
};
type Domain = (typeof domains)[keyof typeof domains];

const tagsOf = (group: Group) => [...group.requests.keys()];
const sharesOf = (pick: (domain: Domain) => Group) =>
  Arr.flatMap(Rec.values(domains), (domain) => tagsOf(pick(domain)));
const middlewaresOf = (group: Group) =>
  Arr.map([...group.requests.values()], (rpc) => Arr.map([...rpc.middlewares], (middleware) => middleware.key));

test("each Rpc group holds exactly its domains' shares, the thin line's twelve among them, each with its group's middlewares", () => {
  assert.deepEqual(
    tagsOf(PlatformRpcs),
    sharesOf((domain) => domain.platformRpcs),
  );
  assert.deepEqual(
    tagsOf(WorldRpcs),
    sharesOf((domain) => domain.worldRpcs),
  );
  // The thin line's twelve, in the order the groups held them before the domains were split (14 November 2026).
  assert.deepEqual(Arr.intersection(tagsOf(PlatformRpcs), THIN_LINE.platform), [...THIN_LINE.platform]);
  assert.deepEqual(Arr.intersection(tagsOf(WorldRpcs), THIN_LINE.world), [...THIN_LINE.world]);
  for (const keys of middlewaresOf(PlatformRpcs))
    assert.deepEqual(keys, ["capxul/contract/Telemetry", "capxul/contract/PlatformSignIn"]);
  for (const keys of middlewaresOf(WorldRpcs))
    assert.deepEqual(keys, ["capxul/contract/Telemetry", "capxul/contract/WorldSignIn"]);
});
