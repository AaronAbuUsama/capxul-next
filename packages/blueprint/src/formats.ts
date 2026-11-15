// Every format an operation's declaration must have, by name (docs/roadmap.md, step 3.5): `pnpm delta:check` fails
// an operation that lacks one, unless the format lists it in its `unmigrated` list. Today only `machine` (step 3.4,
// checked in machine-format.ts); step 4.1 adds `steps`. Only the `unmigrated` lists are kept here.
import type { OperationName } from "./door.ts";
import type { Format } from "./format.ts";
import { declared, machineFormat } from "./machine-format.ts";

/**
 * The existing operations allowed to lack the machine format today, by the ratchet (docs/roadmap.md, "New formats by
 * a ratchet"): the list may only shrink, and a new operation is never added. The delta check fails a listed operation
 * that now complies, so it is removed from here when it is migrated.
 */
const unmigratedMachine: ReadonlyArray<OperationName> = [
  "org.create",
  "org.member.grant",
  "org.director.add",
  "org.threshold.set",
  "org.budget.create",
  "doc.create",
  "doc.submit",
  "approval.sign",
  "world.create",
  "world.clock.warp",
  "world.snapshot.save",
  "world.snapshot.restore",
  "world.snapshot.delete",
];

/** Every format, by name. */
export const formats: { readonly [format: string]: Format<OperationName> } = {
  machine: machineFormat(declared, unmigratedMachine),
};
