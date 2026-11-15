// The scenarios of the blueprint's domain "world" (making, showing, saving and restoring whole worlds, and moving a
// world's clock): the checks of each of its operations, the journeys it leads, and where each claim of its operations
// is checked (../domain.ts). ../domains.ts lists it once.
import type { World } from "@capxul/blueprint";
import { worldClockWarp } from "../checks/world-clock-warp.ts";
import { worldCreate } from "../checks/world-create.ts";
import { worldShow } from "../checks/world-show.ts";
import { worldSnapshotRestore } from "../checks/world-snapshot-restore.ts";
import { worldSnapshotSave } from "../checks/world-snapshot-save.ts";
import { foundNorthwind } from "../journeys/found-northwind.ts";
import { payAndBranch } from "../journeys/pay-and-branch.ts";
import { twoOperators } from "../journeys/two-operators.ts";
import { at, type Domain } from "../domain.ts";

/** The checks of each of its operations. */
export const checks: Domain<typeof World>["checks"] = {
  "world.create": worldCreate,
  "world.clock.warp": worldClockWarp,
  "world.snapshot.save": worldSnapshotSave,
  "world.snapshot.restore": worldSnapshotRestore,
  "world.show": worldShow,
};

/** The journeys it leads, in the order they run. */
export const journeys: Domain<typeof World>["journeys"] = [twoOperators];

/** Where each claim of each of its operations is checked, in claims.md's order. */
export const coverage: Domain<typeof World>["coverage"] = {
  "world.create": [
    at(["world.create"], [twoOperators, 3]),
    at(["world.create"], [twoOperators, 2], [twoOperators, 3]),
    at(["world.create"], [twoOperators, 2]),
    at(["world.create", "world.show"], [twoOperators, 3], [twoOperators, 4]),
    at(["world.create", "record.export"], [twoOperators, 3], [twoOperators, 5]),
    at(["world.create"], [twoOperators, 1]),
  ],
  "world.clock.warp": [at(["world.clock.warp"], [payAndBranch, 8]), at(["world.clock.warp"], [twoOperators, 6])],
  "world.snapshot.save": [
    at(["world.snapshot.save"], [payAndBranch, 3]),
    at(["world.snapshot.save"], [twoOperators, 7]),
    at(["world.snapshot.save"], [twoOperators, 7]),
  ],
  "world.snapshot.restore": [
    at(["world.snapshot.restore"], [payAndBranch, 4], [payAndBranch, 5], [payAndBranch, 7]),
    at(["world.snapshot.restore"], [payAndBranch, 4]),
    at(["world.snapshot.restore"], [payAndBranch, 4]),
    at(["world.snapshot.restore"], [twoOperators, 8]),
    at(["world.snapshot.restore"], [twoOperators, 8]),
  ],
  "world.show": [
    at(["world.snapshot.restore", "world.show"], [payAndBranch, 4]),
    at(["world.show"], [twoOperators, 4]),
    at(["world.show"], [foundNorthwind, 4]),
  ],
};
