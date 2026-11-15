// What a change to a Board announces, and what it carries.
import * as Schema from "effect/Schema";
import { BoardChangeId, OrgId } from "../../common/values.ts";
import { BoardAction, Proposed } from "./values.ts";

/** A change to a company's Board was proposed to its founder. It carries neither the person nor the threshold. */
export class BoardChangeProposed extends Schema.TaggedClass<BoardChangeProposed, { readonly brand: unique symbol }>()(
  "board_change_proposed",
  {
    change: BoardChangeId,
    org: OrgId,
    action: BoardAction,
  },
) {}

/**
 * @internal What board_change_proposed carries, for both verbs that propose a change.
 */
export const proposed = (event: {
  readonly payload: { readonly org: string };
  readonly success: typeof Proposed.Type;
}) => ({
  change: event.success.change.id,
  org: event.payload.org,
  action: event.success.change.action,
});
