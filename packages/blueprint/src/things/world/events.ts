// What a world announces, and what it carries.
import { event } from "@capxul/blueprint-tools";
import * as Schema from "effect/Schema";
import { Grade, Instant, OperatorName, Parent, WorldName } from "../../common/values.ts";

/** A world was made: from nothing (`parent` null) or from a snapshot. Its record's first new entry. */
export class WorldCreated extends event<WorldCreated, { readonly brand: unique symbol }>()("world_created", {
  world: WorldName,
  owner: OperatorName,
  grade: Grade,
  expiresAt: Instant,
  parent: Schema.NullOr(Parent),
}) {}
