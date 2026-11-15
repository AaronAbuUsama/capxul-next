// What a change to a Board announces, and what it carries.
import { event } from "@capxul/blueprint-tools";
import { BoardChangeId, OrgId } from "../../common/values.ts";
import { BoardAction } from "./values.ts";

/** A change to a company's Board was proposed to its founder. It carries neither the person nor the threshold. */
export class BoardChangeProposed extends event<BoardChangeProposed, { readonly brand: unique symbol }>()(
  "board_change_proposed",
  {
    change: BoardChangeId,
    org: OrgId,
    action: BoardAction,
  },
) {}
