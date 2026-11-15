// The gate's climb (src/climb.ts): each command runs in its rung's declared span, with its kind and duration; the
// climb stops at the first that fails, whose span ends failed, and answers its exit code.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Envelope, Pipeline } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";
import { climb, rungsOf, type Run } from "../src/climb.ts";

interface Ended {
  readonly name: string;
  readonly parent: string | undefined;
  readonly ok: boolean;
  readonly ms: number;
  readonly attributes: ReadonlyMap<string, unknown>;
}

/** Climbs with `run`, every span kept as it ends. */
const recorded = async (run: Run) => {
  const ended: Array<Ended> = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        end(endTime, exit);
        const parent =
          options.parent._tag === "Some" && "name" in options.parent.value ? options.parent.value.name : undefined;
        ended.push({
          name: options.name,
          parent,
          ok: exit._tag === "Success",
          ms: Number(endTime - options.startTime) / 1_000_000,
          attributes: span.attributes,
        });
      };
      return span;
    },
  });
  const code = await Effect.runPromise(climb(rungsOf(undefined), run).pipe(Effect.withTracer(tracer)));
  return { code, ended };
};

const gate = Pipeline.checkGate.spans;

/** `shape` passes after 20 ms; `format:check` fails with exit code 2. */
const slowShapeFailingFormat: Run = (rung) =>
  Effect.as(Effect.sleep(rung.script === "shape" ? "20 millis" : "5 millis"), rung.script === "format:check" ? 2 : 0);

test("a rung that passes and one that fails each end their declared span, with its kind, status and duration", async () => {
  const { code, ended } = await recorded(slowShapeFailingFormat);
  assert.equal(code, 2, "the climb answers the failing command's exit code");
  const [shape, format, root] = ended;
  assert.equal(ended.length, 3, "the climb stops at the first rung that fails");
  assert.equal(shape?.name, gate.shape.name);
  assert.equal(shape?.ok, true);
  assert.ok((shape?.ms ?? 0) >= 15, `the passing rung's span lasts as long as its command: ${shape?.ms} ms`);
  assert.equal(shape?.attributes.get(Envelope.attributes.stepKind.name), gate.shape.kind);
  assert.equal(shape?.parent, Pipeline.checkGate.name);
  assert.equal(format?.name, gate.format.name);
  assert.equal(format?.ok, false, "the failing rung's span ends failed");
  assert.equal(format?.attributes.get("script"), "format:check");
  assert.equal(root?.name, Pipeline.checkGate.name);
  assert.equal(root?.ok, false);
});

test("a gate whose every command passes climbs every rung and answers 0", async () => {
  const { code, ended } = await recorded(() => Effect.succeed(0));
  assert.equal(code, 0);
  assert.equal(ended.length, rungsOf(undefined).length + 1);
  assert.ok(Arr.every(ended, (span) => span.ok));
});

test("on a pull request, R15 compares with the base branch", () => {
  const words = Arr.findFirst(rungsOf("origin/slice/telemetry"), (rung) => rung.script === "words");
  assert.deepEqual(
    Option.map(words, (rung) => rung.args),
    Option.some(["--base", "origin/slice/telemetry"]),
  );
});
