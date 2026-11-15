// Every format an operation's declaration must have, by name (docs/roadmap.md, step 3.5): `pnpm delta:check` fails
// an operation that lacks one, unless the format lists it in its `unmigrated` list. Today only `machine` (step 3.4,
// checked in machine-format.ts); step 4.1 adds `steps`. Only the `unmigrated` lists, and the blueprint's domains as
// the formats read them, are kept here. It imports the blueprint's door by its path (see README.md), so the
// toolkit's own door never exports it.
import { domains, refusalsOf, type Operation, type OperationName } from "../../../blueprint/src/index.ts";
import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import type { Format } from "./format.ts";
import { machineFormat, type Declared, type DomainShape, type MachineShape } from "./machine-format.ts";

const isReasons = (value: unknown): value is { readonly [operation: string]: string } =>
  Predicate.isReadonlyObject(value) && Arr.every(Rec.values(value), Predicate.isString);

/** The domain shape of one of the blueprint's domains. */
const shapeOf = (domain: (typeof domains)[keyof typeof domains]): DomainShape => {
  const operations: { readonly [operation: string]: Operation } = domain.operations;
  const machines: { readonly [machine: string]: MachineShape } = domain.machines;
  const stateless: unknown = "stateless" in domain ? domain.stateless : undefined;
  return {
    operations: Rec.map(operations, (operation) => Arr.map(refusalsOf(operation), (refusal) => refusal.identifier)),
    machines,
    stateless: isReasons(stateless) ? stateless : undefined,
  };
};

/** The blueprint's own domains, as the format reads them. */
export const declared: Declared = Rec.map(domains, shapeOf);

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
