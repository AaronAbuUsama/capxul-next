// Core's empty-handler mode: every operation of both groups refuses with the blueprint's `NotImplemented`, naming
// itself (packages/blueprint/decisions.md, entry 33), whatever is built in src/handlers.ts. A stage of `CapxulCore`
// deployed with `CAPXUL_HANDLERS=empty` serves these, so the scenario author can show that every journey fails
// against handlers that do nothing (roadmap steps 1.5 and 1.14: `./run.sh scenarios --expect=not-implemented` in
// packages/runner). A world's Core never binds it.
import { Errors, PlatformRpcs, WorldRpcs, type OperationName } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** The answer of an operation that does nothing. */
const empty = (operation: OperationName) => () => Effect.fail(Errors.NotImplemented.make({ operation }));

/** Every operation of both groups, each empty. */
export const EmptyHandlers = Layer.merge(
  PlatformRpcs.toLayer({
    "world.create": empty("world.create"),
    "world.show": empty("world.show"),
    "world.snapshot.save": empty("world.snapshot.save"),
    "world.snapshot.restore": empty("world.snapshot.restore"),
  }),
  WorldRpcs.toLayer({
    "org.create": empty("org.create"),
    "org.member.grant": empty("org.member.grant"),
    "doc.create": empty("doc.create"),
    "doc.submit": empty("doc.submit"),
    "approval.sign": empty("approval.sign"),
    "report.run": empty("report.run"),
    "world.clock.warp": empty("world.clock.warp"),
    "record.export": empty("record.export"),
  }),
);

/** The value of `CAPXUL_HANDLERS` that switches a deploy to the empty handlers. */
export const EMPTY_HANDLERS = "empty";
