// The drift check's policy: values a resource changes by itself are forgiven, nothing else is, and a deploy that
// did not finish counts as drift.
import assert from "node:assert/strict";
import { test } from "node:test";
import { differingFields, unfinished } from "../src/drift-policy.ts";

const onlySettlingDiffers = (type: string, a: Record<string, unknown>, b: Record<string, unknown>) =>
  differingFields(type, a, b).length === 0;

const VOLUME = "AWS.EC2.Volume";
const recorded = { volumeId: "vol-1", size: 60, volumeType: "gp3", encrypted: true, state: "available" };

test("a volume that went from available to in-use, and nothing else, has not drifted", () => {
  assert.ok(onlySettlingDiffers(VOLUME, recorded, { ...recorded, state: "in-use" }));
  assert.ok(onlySettlingDiffers(VOLUME, { ...recorded, state: "in-use" }, recorded));
});

test("a volume in another state, or changed in any other field, has drifted", () => {
  assert.ok(!onlySettlingDiffers(VOLUME, recorded, { ...recorded, state: "error" }));
  assert.ok(!onlySettlingDiffers(VOLUME, recorded, { ...recorded, state: "deleting" }));
  assert.ok(!onlySettlingDiffers(VOLUME, recorded, { ...recorded, state: "in-use", size: 120 }));
  assert.ok(!onlySettlingDiffers(VOLUME, recorded, { ...recorded, encrypted: false }));
});

test("a drifted resource names the fields that differ, and no value", () => {
  assert.deepEqual(differingFields(VOLUME, recorded, { ...recorded, state: "in-use", size: 120, iops: 3000 }), [
    "size",
    "iops",
  ]);
});

test("a field forgiven for one resource type is not forgiven for another", () => {
  const instance = { instanceId: "i-1", state: "available" };
  assert.ok(!onlySettlingDiffers("AWS.EC2.Instance", instance, { ...instance, state: "in-use" }));
});

test("a replacement or deploy that did not finish counts; a provider that cannot read does not", () => {
  assert.ok(unfinished("resource has a pending replacement (status 'replaced'); run deploy to finish it"));
  assert.ok(unfinished("resource status 'creating' is not stable; run deploy to recover"));
  assert.ok(!unfinished("provider 'AWS.EC2.VolumeAttachment' does not implement read"));
  assert.ok(!unfinished(undefined));
});
