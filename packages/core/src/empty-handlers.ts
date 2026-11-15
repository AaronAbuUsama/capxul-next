// Core's empty-handler mode: every operation of both groups refuses with the blueprint's `NotImplemented`, naming
// itself (packages/blueprint/docs/decisions.md, entry 33), whatever is built in src/handlers.ts. A stage of
// `CapxulCore` deployed with `CAPXUL_HANDLERS=empty` serves these, so the scenario author can show that every journey
// fails against handlers that do nothing (roadmap steps 1.5 and 1.14: `./run.sh scenarios --expect=not-implemented` in
// packages/runner). A world's Core never binds it. The handlers are made from the groups' own operations, so a new
// operation needs nothing here.
import { Errors, PlatformRpcs, WorldRpcs } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Rec from "effect/Record";

/** The answer of an operation that does nothing. */
const empty = (operation: string) => () => Effect.fail(Errors.NotImplemented.make({ operation }));

/** An empty handler for each operation of `group`. */
const everyEmpty = <Tag extends string>(group: { readonly requests: ReadonlyMap<string, { readonly _tag: Tag }> }) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the record is built from exactly the group's tags, which a Record's type widens to string
  Rec.fromEntries(
    Arr.map(Arr.fromIterable(group.requests.values()), (rpc) => [rpc._tag, empty(rpc._tag)] as const),
  ) as {
    readonly [Each in Tag]: ReturnType<typeof empty>;
  };

/** Every operation of both groups, each empty. */
export const EmptyHandlers = Layer.merge(
  PlatformRpcs.toLayer(everyEmpty(PlatformRpcs)),
  WorldRpcs.toLayer(everyEmpty(WorldRpcs)),
);

/** The value of `CAPXUL_HANDLERS` that switches a deploy to the empty handlers. */
export const EMPTY_HANDLERS = "empty";
