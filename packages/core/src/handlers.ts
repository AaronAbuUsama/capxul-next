// The handlers of every blueprint operation. THEY ARE EMPTY: each fails with the blueprint's `NotImplemented`,
// naming its operation, so the server compiles, deploys and answers every call with a typed refusal
// (packages/blueprint/decisions.md, entry 33). The builder of each operation replaces its line.
//
// `toLayer` takes exactly one handler per operation of its group: delete a line and this file no longer compiles.
import { Errors, PlatformRpcs, WorldRpcs, type OperationName } from "@capxul/blueprint";
import * as Effect from "effect/Effect";

/** The answer of an operation that has no implementation yet. */
const unbuilt = (operation: OperationName) => () => Effect.fail(Errors.NotImplemented.make({ operation }));

/** The platform group: what `packages/world` will serve once it lands. Core serves it until then. */
export const PlatformHandlers = PlatformRpcs.toLayer({
  "world.create": unbuilt("world.create"),
  "world.show": unbuilt("world.show"),
  "world.snapshot.save": unbuilt("world.snapshot.save"),
  "world.snapshot.restore": unbuilt("world.snapshot.restore"),
});

/** The world group: everything that acts inside one running world, served through its door. */
export const WorldHandlers = WorldRpcs.toLayer({
  "org.create": unbuilt("org.create"),
  "org.member.grant": unbuilt("org.member.grant"),
  "doc.create": unbuilt("doc.create"),
  "doc.submit": unbuilt("doc.submit"),
  "approval.sign": unbuilt("approval.sign"),
  "report.run": unbuilt("report.run"),
  "world.clock.warp": unbuilt("world.clock.warp"),
  "record.export": unbuilt("record.export"),
});
