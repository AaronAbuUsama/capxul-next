// What a world announces, and what it carries.
import * as Schema from "effect/Schema";
import { Grade, Instant, OperatorName, Parent, WorldName, WorldView } from "../../common/values.ts";

/** A world was made: from nothing (`parent` null) or from a snapshot. Its record's first new entry. */
export class WorldCreated extends Schema.TaggedClass<WorldCreated, { readonly brand: unique symbol }>()(
  "world_created",
  {
    world: WorldName,
    owner: OperatorName,
    grade: Grade,
    expiresAt: Instant,
    parent: Schema.NullOr(Parent),
  },
) {}

/**
 * @internal What world_created carries, for both verbs that make a world.
 */
export const created = (view: typeof WorldView.Type) => ({
  world: view.world,
  owner: view.owner,
  grade: view.grade,
  expiresAt: view.expiresAt,
  parent: view.parent,
});
