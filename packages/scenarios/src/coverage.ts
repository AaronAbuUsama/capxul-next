// Where each claim of claims.md is checked now that scenarios are journeys (docs/roadmap.md, 14 November 2026): in
// the checks of an operation (src/checks/), which run on every call of it in every journey, and in the steps of the
// journeys that call it the way the claim says. One entry per claim, in claims.md's order; test/coverage.test.ts
// holds that every claim has one and that every step it names exists.
import type { OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import { foundNorthwind } from "./journeys/found-northwind.ts";
import { payAndBranch } from "./journeys/pay-and-branch.ts";
import { twoOperators } from "./journeys/two-operators.ts";
import type { Journey } from "./journey.ts";

/** Where one claim is checked: the operations whose checks hold it, and the journeys' steps (from 1) that call it. */
export interface Covered {
  readonly checks: ReadonlyArray<OperationName>;
  readonly steps: ReadonlyArray<{ readonly journey: Journey; readonly step: number }>;
}

const J1 = twoOperators;
const J2 = foundNorthwind;
const J3 = payAndBranch;

const at = (checks: ReadonlyArray<OperationName>, ...steps: ReadonlyArray<readonly [Journey, number]>): Covered => ({
  checks,
  steps: Arr.map(steps, ([journey, step]) => ({ journey, step })),
});

export const coverage: { readonly [N in OperationName]: ReadonlyArray<Covered> } = {
  "world.create": [
    at(["world.create"], [J1, 3]),
    at(["world.create"], [J1, 2], [J1, 3]),
    at(["world.create"], [J1, 2]),
    at(["world.create", "world.show"], [J1, 3], [J1, 4]),
    at(["world.create", "record.export"], [J1, 3], [J1, 5]),
    at(["world.create"], [J1, 1]),
  ],
  "org.create": [
    at(["org.create"], [J2, 2]),
    at(["org.create"], [J2, 2]),
    at(["approval.sign"], [J2, 3], [J2, 4]),
    at(["org.create"], [J2, 2]),
    at(["org.create"], [J2, 1]),
    at(["org.create"], [J2, 1], [J2, 2]),
    at(["org.create"], [J2, 1], [J2, 2]),
  ],
  "org.member.grant": [
    at(["org.member.grant", "approval.sign"], [J2, 5], [J2, 6], [J2, 7]),
    at(["org.member.grant"], [J2, 5], [J2, 9]),
    at(["org.member.grant"], [J2, 5]),
    at(["org.member.grant"], [J2, 5]),
    at([], [J2, 6]),
    at(["org.member.grant"], [J2, 5], [J2, 9]),
    at([], [J2, 9], [J2, 10]),
  ],
  "doc.create": [
    at(["doc.create"], [J2, 7], [J2, 8]),
    at(["doc.create"], [J2, 7]),
    at(["doc.create"], [J2, 7]),
    at(["doc.submit"], [J3, 2]),
  ],
  "doc.submit": [
    at(["doc.submit"], [J3, 2]),
    at(["doc.submit"], [J3, 2]),
    at(["doc.submit"], [J3, 2]),
    at(["doc.submit"], [J3, 2]),
  ],
  "approval.sign": [
    at(["approval.sign"], [J3, 5], [J3, 6]),
    at(["approval.sign"], [J3, 5]),
    at(["approval.sign"], [J3, 5]),
    at(["approval.sign", "world.clock.warp"], [J3, 8], [J3, 9]),
    at(["approval.sign"], [J2, 3], [J2, 6]),
  ],
  "report.run": [at(["report.run"], [J3, 6]), at(["report.run"], [J2, 8]), at(["report.run"], [J2, 8])],
  "world.clock.warp": [at(["world.clock.warp"], [J3, 8]), at(["world.clock.warp"], [J1, 6])],
  "record.export": [
    at(["record.export", "world.snapshot.restore"], [J3, 4], [J3, 10]),
    at(["record.export", "report.run"], [J3, 10]),
    at(["record.export"], [J1, 5]),
    at(["record.export"], [J3, 10]),
  ],
  "world.snapshot.save": [
    at(["world.snapshot.save"], [J3, 3]),
    at(["world.snapshot.save"], [J1, 7]),
    at(["world.snapshot.save"], [J1, 7]),
  ],
  "world.snapshot.restore": [
    at(["world.snapshot.restore"], [J3, 4], [J3, 5], [J3, 7]),
    at(["world.snapshot.restore"], [J3, 4]),
    at(["world.snapshot.restore"], [J3, 4]),
    at(["world.snapshot.restore"], [J1, 8]),
    at(["world.snapshot.restore"], [J1, 8]),
  ],
  "world.show": [
    at(["world.snapshot.restore", "world.show"], [J3, 4]),
    at(["world.show"], [J1, 4]),
    at(["world.show"], [J2, 4]),
  ],
};
