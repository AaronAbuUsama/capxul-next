import assert from "node:assert/strict";
import { test } from "node:test";

import { decision_portal_board } from "../../../blueprint/shared/portal.ts";
import { forAaron, stateOf } from "../../../blueprint/shared/waiting.ts";

test("the Overview board implementation decision does not add a Needs you question", () => {
  assert.equal(decision_portal_board.id, "portal.overview-board");
  assert.equal(stateOf(decision_portal_board), "settled");
  assert.equal(forAaron(decision_portal_board), false);
  assert.match(decision_portal_board.source ?? "", /Aaron, 11 November 2026/);
});
