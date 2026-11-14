// Bench templates' names and the fingerprint of the code that makes them (src/site/Templates.ts; docs/roadmap.md,
// "Bench templates never change").
import * as assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { fingerprintOf, templateName } from "../src/site/Templates.ts";

const services = Layer.merge(NodeServices.layer, Digest.layerWebCrypto);
const fingerprint = (root: string, apps = "abc") =>
  Effect.runPromise(Effect.provide(fingerprintOf(root, ["a", "b/src"], apps), services));

test("a template is named by its starting world, its code and the world whose facts it holds", () => {
  const code = "0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9";
  assert.equal(
    Effect.runSync(templateName("payment-drafted", code, "w-tpl-a1b2c3")),
    "payment-drafted-0a1b2c3d-w-tpl-a1b2c3",
  );
  // The longest starting world and the longest world name still fit the door's 40 characters.
  assert.equal(Effect.runSync(templateName("payment-drafted", code, "a12345678901234")).length, 40);
  assert.ok(templateName("founded", "not hex", "w1").pipe(Effect.exit, Effect.runSync, Exit.isFailure));
  assert.ok(templateName("Founded", code, "w1").pipe(Effect.exit, Effect.runSync, Exit.isFailure));
});

test("the fingerprint follows every file of the code and the bench's apps, and nothing else", async () => {
  const root = mkdtempSync(join(tmpdir(), "templates-"));
  try {
    mkdirSync(join(root, "a", "deep"), { recursive: true });
    mkdirSync(join(root, "b", "src", "node_modules", "x"), { recursive: true });
    mkdirSync(join(root, "c"), { recursive: true });
    writeFileSync(join(root, "a", "one.ts"), "1");
    writeFileSync(join(root, "a", "deep", "two.ts"), "2");
    writeFileSync(join(root, "b", "src", "three.ts"), "3");
    writeFileSync(join(root, "b", "src", "node_modules", "x", "index.js"), "x");
    writeFileSync(join(root, "c", "other.ts"), "c");
    const before = await fingerprint(root);
    assert.match(before, /^[0-9a-f]{64}$/);
    assert.equal(await fingerprint(root), before, "the same code, the same fingerprint");
    writeFileSync(join(root, "c", "other.ts"), "changed");
    writeFileSync(join(root, "b", "src", "node_modules", "x", "index.js"), "changed");
    assert.equal(await fingerprint(root), before, "files outside the code named, and installed modules, do not count");
    assert.notEqual(await fingerprint(root, "def"), before, "the bench's apps count");
    writeFileSync(join(root, "a", "deep", "two.ts"), "22");
    assert.notEqual(await fingerprint(root), before, "a file of the code counts");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
