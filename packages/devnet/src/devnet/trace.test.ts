import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mintTrace, traced } from "./trace.ts";

test("traces are 32-hex, run-scoped inside a run, and each call logs exactly one line with the trace it used", async () => {
  const previous = process.env.CAPXUL_EVAL_RUN_DIR;
  const root = await mkdtemp(join(tmpdir(), "trace-")), run = join(root, "run-20261113064336836-f54de590");
  try {
    delete process.env.CAPXUL_EVAL_RUN_DIR;
    assert.match(mintTrace(), /^[0-9a-f]{32}$/, "outside a run: a plain W3C trace id, never a UUID");
    process.env.CAPXUL_EVAL_RUN_DIR = run;
    await mkdir(join(run, "preparation"), { recursive: true });
    // Derived independently: the first 16 hex digits of sha256 of the receipt id.
    const prefix = createHash("sha256").update("run-20261113064336836-f54de590").digest("hex").slice(0, 16);
    const a = mintTrace(), b = mintTrace();
    assert.match(a, /^[0-9a-f]{32}$/);
    assert.equal(a.slice(0, 16), prefix);
    assert.notEqual(a, b, "one trace per call");
    let sent = "";
    assert.equal(await traced("world.snapshot.save", async (trace) => { sent = trace; return 7; }), 7);
    await assert.rejects(traced("world.snapshot.restore", async () => { throw new Error("refused"); }), /refused/);
    const lines = (await readFile(join(run, "preparation", "operations.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0], { operation: "world.snapshot.save", trace_id: sent, ok: true });
    assert.equal(lines[1].operation, "world.snapshot.restore"); assert.equal(lines[1].ok, false);
    assert.notEqual(lines[1].trace_id, sent);
  } finally {
    if (previous === undefined) delete process.env.CAPXUL_EVAL_RUN_DIR; else process.env.CAPXUL_EVAL_RUN_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
