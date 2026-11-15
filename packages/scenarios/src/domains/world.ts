// The scenarios of the blueprint's domain "world" (making, showing, listing, saving, restoring and deleting whole worlds'
// snapshots, and moving a world's clock): the checks of each of its operations, the journeys it leads, and where each claim of its operations
// is checked (../domain.ts). ../domains.ts lists it once.
import type { World } from "@capxul/blueprint";
import { worldClockWarp } from "../checks/world-clock-warp.ts";
import { worldCreate } from "../checks/world-create.ts";
import { worldList } from "../checks/world-list.ts";
import { worldShow } from "../checks/world-show.ts";
import { worldSnapshotDelete } from "../checks/world-snapshot-delete.ts";
import { worldSnapshotList } from "../checks/world-snapshot-list.ts";
import { worldSnapshotRestore } from "../checks/world-snapshot-restore.ts";
import { worldSnapshotSave } from "../checks/world-snapshot-save.ts";
import { foundNorthwind } from "../journeys/found-northwind.ts";
import { branchTheBooks } from "../journeys/branch-the-books.ts";
import { twoOperators } from "../journeys/two-operators.ts";
import { worldInventory } from "../journeys/world-inventory.ts";
import { at, type Domain } from "../domain.ts";

/** The checks of each of its operations. */
export const checks: Domain<typeof World>["checks"] = {
  "world.create": worldCreate,
  "world.clock.warp": worldClockWarp,
  "world.snapshot.save": worldSnapshotSave,
  "world.snapshot.restore": worldSnapshotRestore,
  "world.show": worldShow,
  "world.list": worldList,
  "world.snapshot.list": worldSnapshotList,
  "world.snapshot.delete": worldSnapshotDelete,
};

/** The journeys it leads, in the order they run. */
export const journeys: Domain<typeof World>["journeys"] = [twoOperators, worldInventory, branchTheBooks];

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
  "world.clock.warp": [at(["world.clock.warp"], [branchTheBooks, 6]), at(["world.clock.warp"], [twoOperators, 6])],
  "world.snapshot.save": [
    at(["world.snapshot.save"], [branchTheBooks, 2]),
    at(["world.snapshot.save"], [twoOperators, 7]),
    at(["world.snapshot.save"], [twoOperators, 7]),
  ],
  "world.snapshot.restore": [
    at(["world.snapshot.restore"], [branchTheBooks, 3], [branchTheBooks, 4], [branchTheBooks, 5]),
    at(["world.snapshot.restore"], [branchTheBooks, 3]),
    at(["world.snapshot.restore"], [branchTheBooks, 3]),
    at(["world.snapshot.restore"], [twoOperators, 8]),
    at(["world.snapshot.restore"], [twoOperators, 8]),
  ],
  "world.show": [
    at(["world.snapshot.restore", "world.show"], [branchTheBooks, 3]),
    at(["world.show"], [twoOperators, 4]),
    at(["world.show"], [foundNorthwind, 4]),
  ],
  "world.list": [at(["world.list"], [worldInventory, 1]), at(["world.list"], [worldInventory, 8])],
  "world.snapshot.list": [
    at(["world.snapshot.list"], [worldInventory, 4]),
    at(["world.snapshot.list"], [worldInventory, 4]),
    at(["world.snapshot.list"], [worldInventory, 4]),
  ],
  "world.snapshot.delete": [
    at(["world.snapshot.delete"], [worldInventory, 6]),
    at(["world.snapshot.delete"], [worldInventory, 5], [worldInventory, 7]),
    at(["world.snapshot.delete"], [worldInventory, 5]),
  ],
};
