// The bench host's machine: replaced delete-first, so its one data disk is never wanted by two machines at once.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Str from "effect/String";
import { MACHINE_PRIVATE_IP, NETWORK_CIDR } from "../src/aws.ts";

test("the machine keeps a fixed private address in the public subnet, the first /24 of the network", () => {
  assert.equal(NETWORK_CIDR, "10.73.0.0/16");
  const [a, b, c, d] = Arr.map(Str.split(".")(MACHINE_PRIVATE_IP), Number);
  assert.deepEqual([a, b, c], [10, 73, 0]);
  // AWS keeps the first four addresses of a subnet and the last one.
  assert.ok(d !== undefined && d >= 4 && d <= 254, MACHINE_PRIVATE_IP);
});
