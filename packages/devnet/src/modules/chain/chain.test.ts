import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "./service.ts";

test("connecting to a port nothing listens on throws instead of answering a half-made chain", async () => {
  await assert.rejects(connect("http://127.0.0.1:1"));
});
