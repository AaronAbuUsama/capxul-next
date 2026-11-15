// The runner's spans carry the names the blueprint's pipeline declares (roadmap 4.7), each with its kind: every timed
// part but a world's create (4.1) and the undeclared rest, the run's root, a journey's step and its call.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Envelope, Pipeline } from "@capxul/blueprint";
import { RUN_SPANS, stepAttributes } from "../src/telemetry/step.ts";
import { OTHER_PART, spanOf } from "../src/timings.ts";

test("each part the runner times runs in the span the pipeline declares for it, with its kind", () => {
  assert.deepEqual(spanOf("hub up"), { name: Pipeline.clusterUp.name });
  assert.deepEqual(spanOf("make founded"), { name: Pipeline.startingPointMake.name });
  assert.equal(spanOf("save founded"), Pipeline.runPrepare.spans.save);
  assert.equal(spanOf("bench template founded"), Pipeline.siteSave.spans.template);
  assert.equal(spanOf("bench sites"), Pipeline.siteTake.spans.list);
  assert.deepEqual(spanOf("reset"), { name: Pipeline.worldReset.name });
  assert.equal(spanOf("restore"), Pipeline.runPrepare.spans.restore);
  assert.equal(spanOf("starting world"), Pipeline.journeyRun.spans.start);
  assert.equal(spanOf("world destroy"), Pipeline.runTeardown.spans.worlds);
  assert.deepEqual(spanOf("renew"), { name: Pipeline.worldRenew.name });
  assert.equal(spanOf("drop bench template founded"), OTHER_PART);
});

test("a declared span carries its kind under the envelope's step kind; a work's own span carries none", () => {
  const kind = Envelope.attributes.stepKind.name;
  assert.deepEqual(stepAttributes(RUN_SPANS.step, { a: 1 }), { [kind]: RUN_SPANS.step.kind, a: 1 });
  assert.equal(RUN_SPANS.step.name, Pipeline.journeyRun.spans.step.name);
  assert.equal(RUN_SPANS.call.name, Pipeline.journeyRun.spans.call.name);
  assert.deepEqual(stepAttributes(RUN_SPANS.run, { mode: "one world" }), { mode: "one world" });
  assert.equal(RUN_SPANS.run.name, Pipeline.runStart.name);
});
