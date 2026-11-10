import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { CommandRecordEntry } from "../../../../blueprint/devnet/record-entry.ts";

test("real recorder outputs validate, redacts, and chains success, refusal and failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "record-schema-"));
  const saved = { STATE_DIR: process.env.STATE_DIR, SKELETON_SECRET: process.env.SKELETON_SECRET, CAPXUL_WORLD: process.env.CAPXUL_WORLD };
  process.env.STATE_DIR = dir;
  process.env.SKELETON_SECRET = randomBytes(32).toString("hex");
  process.env.CAPXUL_WORLD = "main";
  try {
    const { begin, finish, verifyChain } = await import("../src/record.ts");
    const { CliError } = await import("../src/errors.ts");
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
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
