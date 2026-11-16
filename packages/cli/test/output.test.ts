// Roadmap item 3.9 (docs/design/blueprint.md, part 12, decision 8, item 1; `CLI_OUTPUTS`): how a command prints its
// answer. On a terminal, a readable view; when its output is not a terminal, or with `--json`, the one line of JSON it
// prints today. Either way it exits with the blueprint's exit code for a refusal (`Errors.exitCode`), 1 for anything
// else that failed, and 0 on success.
//
// The seam: whether standard output is a terminal is `Stdio.stdoutIsTerminal` (test/harness.ts sets it). The readable
// view's layout is the builder's; these tests check only that it is not the JSON line and that it names the operation
// and the success's top-level fields.
//
// Written before the build, so each test is `todo` until the builder makes it pass and removes the mark.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { commands, Errors, operations, type OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import * as Cli from "../src/door.ts";
import {
  codeOf,
  envOf,
  exampleFlags,
  NOT_IMPLEMENTED,
  THRESHOLD_SET,
  withBench,
  WORLD_LIST,
  type Bench,
} from "./harness.ts";

const TODO = { todo: "3.9: built by the builder" };

/** `world list`: an account call whose path is the same before and after 3.9, so only the output is under test. */
const LIST = WORLD_LIST;

const runOn = (bench: Bench, name: OperationName, extra: ReadonlyArray<string>, tty: boolean) =>
  exampleFlags(name).then((flags) =>
    bench.run([...commands[name], ...flags, ...extra], { env: envOf(bench.served), tty }),
  );

test("--json on a terminal prints the one JSON line a pipe gets, exactly as today", TODO, () =>
  withBench("examples", async (bench) => {
    const piped = await runOn(bench, LIST, [], false);
    assert.ok(Exit.isSuccess(piped.exit));
    assert.equal(piped.lines.length, 1, "a pipe got more than one line");
    const answer = await Effect.runPromise(Cli.readAnswer(LIST, piped.lines[0] ?? ""));
    assert.equal(answer.outcome, "success");
    assert.equal(piped.stdout, `${await Effect.runPromise(Cli.answerLine(answer))}\n`, "the piped line changed");
    const json = await runOn(bench, LIST, ["--json"], true);
    assert.ok(Exit.isSuccess(json.exit), "--json was refused");
    assert.equal(json.stdout, piped.stdout, "--json on a terminal printed otherwise than a pipe");
    const pipedJson = await runOn(bench, LIST, ["--json"], false);
    assert.equal(pipedJson.stdout, piped.stdout, "--json in a pipe printed otherwise than a pipe");
  }),
);

test("a terminal gets a readable view, not JSON, naming the operation and the success's fields", TODO, () =>
  withBench("examples", async (bench) => {
    const ran = await runOn(bench, LIST, [], true);
    assert.ok(Exit.isSuccess(ran.exit));
    assert.ok(Str.trim(ran.stdout) !== "", "a terminal got nothing");
    assert.ok(!Str.startsWith("{")(Str.trimStart(ran.stdout)), `a terminal got JSON: ${ran.stdout}`);
    assert.ok(
      Str.includes(LIST)(ran.stdout) || Str.includes(Arr.join(commands[LIST], " "))(ran.stdout),
      `the view does not name ${LIST}: ${ran.stdout}`,
    );
    const success = operations[LIST].examples[0]?.success;
    assert.ok(typeof success === "object" && success !== null);
    for (const field of Rec.keys(success))
      assert.ok(
        Str.includes(String(field))(ran.stdout),
        `the view does not name the success's ${String(field)}: ${ran.stdout}`,
      );
  }),
);

test(
  "exit codes: 0 on success, the blueprint's code for a refusal, 1 for anything else, on a terminal or not",
  TODO,
  async () => {
    const name = THRESHOLD_SET;
    for (const tty of [false, true]) {
      await withBench("examples", async (bench) => {
        assert.equal(codeOf(await runOn(bench, name, [], tty)), 0, `success (terminal: ${tty})`);
      });
      await withBench("not-implemented", async (bench) => {
        const ran = await runOn(bench, name, [], tty);
        assert.equal(codeOf(ran), Errors.exitCode.NotImplemented, `refusal (terminal: ${tty})`);
        assert.ok(
          Str.includes(NOT_IMPLEMENTED)(ran.stdout),
          `the refusal is not shown (terminal: ${tty}): ${ran.stdout}`,
        );
      });
      await withBench("examples", async (bench) => {
        const ran = await bench.run([...commands[name], "--org", "Not An Org", "--threshold", "many"], {
          env: envOf(bench.served),
          tty,
        });
        assert.equal(codeOf(ran), 1, `a payload that does not decode (terminal: ${tty})`);
        assert.deepEqual(await bench.seen(), [], "a payload that does not decode reached the door");
      });
    }
  },
);
