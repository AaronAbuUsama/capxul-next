// The acceptance claims of the world's inventory (inventory.ts): listing an operator's worlds and a world's snapshots,
// and deleting a snapshot. Rendered into claims.md with the domain's other claims (claims.ts).
import { claim, type ClaimsOf } from "../claims/claim.ts";
import { NotWorldOwner, SnapshotInUse, SnapshotNotFound, WorldNotFound } from "../errors.ts";
import { startingWorlds as w } from "../starting-worlds.ts";
import * as Inventory from "./inventory.ts";

export const list: ClaimsOf = {
  operation: Inventory.list,
  claims: [
    claim(
      "An operator lists exactly the worlds they own, each as world.show shows it, with how many snapshots it keeps.",
      w.quotaFull,
      "world.list by the first operator answers them as its owner, the limit of live worlds and every world `quota-full` filled, as many worlds as the limit; each with the grade, state, expiry, door and parent world.show answers, an owner who is the caller, and as many snapshots as world.snapshot.list lists. world.list by the second operator holds none of the first operator's worlds.",
      { thinLine: true },
    ),
    claim(
      "A world restored from another operator's template is listed by its new owner alone, naming where it came from.",
      w.quotaFull,
      "After the second operator restores the first operator's template `base`, world.list by the second operator holds the new world, its parent the first operator's world and `base`; the first operator's list does not hold it, and lists their world with one snapshot once `scratch` is deleted.",
    ),
  ],
  dropped: [],
};

export const snapshotList: ClaimsOf = {
  operation: Inventory.snapshotList,
  claims: [
    claim(
      "It lists every snapshot a world keeps, in the order they were saved, each as its save answered.",
      w.quotaFull,
      "After the first operator saves `base`, a template, and then `scratch` of a world they own, world.snapshot.list answers the world and both snapshots in that order, each exactly as world.snapshot.save answered it. The record gains no entry.",
      { thinLine: true },
    ),
    claim(
      "Each snapshot names the live worlds that hang from it.",
      w.quotaFull,
      "After the second operator restores `base` as a world of their own, world.snapshot.list lists `base` in use by that world alone and `scratch` by none.",
    ),
    claim(
      "Only the world's owner may list its snapshots, and only of a world that exists.",
      w.quotaFull,
      "world.snapshot.list by the second operator is refused with NotWorldOwner naming the first operator as owner; of a name with no world, with WorldNotFound naming it.",
      { refusals: [NotWorldOwner, WorldNotFound] },
    ),
  ],
  dropped: [],
};

export const snapshotDelete: ClaimsOf = {
  operation: Inventory.snapshotDelete,
  claims: [
    claim(
      "Deleting a snapshot removes it and records it, and leaves the world and its other snapshots as they were.",
      w.quotaFull,
      "world.snapshot.delete of `scratch` answers it as world.snapshot.list listed it. record.export lists one new entry, `snapshot_deleted`, carrying its world, its name and the record position it held; world.snapshot.list lists `base` alone, as before; world.show reads as before but for its record head, one higher. Deleting `scratch` again is refused with SnapshotNotFound.",
      { refusals: [SnapshotNotFound], thinLine: true },
    ),
    claim(
      "A snapshot a live world hangs from cannot be deleted, and stays as it was.",
      w.quotaFull,
      "world.snapshot.delete of `base`, from which the second operator restored a world, is refused with SnapshotInUse naming that world, as world.snapshot.list's `inUseBy` names it; world.snapshot.list lists `base` unchanged, the record gains no entry, and world.show of the restored world still names `base` as its parent.",
      { refusals: [SnapshotInUse] },
    ),
    claim(
      "Only the world's owner may delete a snapshot, and only one that exists, of a world that exists.",
      w.quotaFull,
      "world.snapshot.delete by the second operator is refused with NotWorldOwner naming the first operator; of a name with no world, with WorldNotFound; of `m9`, which was never saved, with SnapshotNotFound. The record gains no entry and world.snapshot.list lists the same snapshots.",
      { refusals: [NotWorldOwner, WorldNotFound, SnapshotNotFound] },
    ),
  ],
  dropped: [],
};
