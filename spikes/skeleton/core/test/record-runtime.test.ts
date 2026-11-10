import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { CommandRecordEntry } from "../../../../books/target/devnet/record-entry.ts";

test("real recorder outputs validate, redacts, and chains success, refusal and failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "record-schema-"));
  process.env.STATE_DIR = dir;
  const { begin, finish, verifyChain } = await import("../src/record.ts");
  const { CliError } = await import("../src/errors.ts");
  try {
    for (const r of [
      { ok: true as const, result: { password: "must-not-survive", name: "INV-1" } },
      { ok: false as const, error: new CliError("No hat", "ROLE_PERMISSION_DENIED", true) },
      { ok: false as const, error: new Error("Offline") },
    ]) {
      await begin({ command: "doc list", argv: [], flags: {}, pos: [] });
      await finish(r);
    }
    const text = readFileSync(join(dir, "record/main.jsonl"), "utf8");
    const entries = text.trim().split("\n").map(x => JSON.parse(x));
    for (const e of entries) Schema.decodeUnknownSync(CommandRecordEntry)(e);
    assert.deepEqual(entries.map(e => e.outcome), ["ok", "refused", "failed"]);
    assert.equal(text.includes("must-not-survive"), false);
    assert.equal(entries[0].result.password, "[redacted]");
    assert.equal(verifyChain("main").ok, true);
    assert.equal(verifyChain("main").count, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
