// The site token: what src/token.ts mints is what door/door.py accepts (HMAC-SHA256 under the door key, in hex,
// over `v1.<world>.<quota>.<expires>`), and claims the door would refuse are refused before signing.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import { cryptoLayer, fingerprint, mint } from "../src/token.ts";

const KEY = Redacted.make(Str.repeat(32)("a1"));
const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof cryptoLayer>>) =>
  Effect.runPromiseExit(Effect.provide(effect, cryptoLayer));
const TOKEN = /^v1\.([a-z][a-z0-9]{1,15})\.([0-9]{1,3})\.([0-9]{10})\.([0-9a-f]{64})$/; // door.py's pattern

test("a minted token has the door's shape and its HMAC", async () => {
  const exit = await run(mint(KEY, { world: "acme", quota: 2, expires: 1_806_487_200 }));
  assert.ok(Exit.isSuccess(exit));
  const token = Redacted.value(exit.value);
  assert.match(token, TOKEN);
  const body = "v1.acme.2.1806487200";
  const sig = createHmac("sha256", Redacted.value(KEY)).update(body).digest("hex");
  assert.equal(token, `${body}.${sig}`);
});

test("claims the door would refuse are refused before signing", async () => {
  for (const claims of [
    { world: "Acme", quota: 1, expires: 1_806_487_200 },
    { world: "acme", quota: 1000, expires: 1_806_487_200 },
    { world: "acme", quota: 1, expires: 12 },
    { world: "a", quota: 1, expires: 1_806_487_200 },
  ]) {
    assert.ok(Exit.isFailure(await run(mint(KEY, claims))), JSON.stringify(claims));
  }
});

test("a token's print is the first 8 hex digits of its SHA-256, and never the token", async () => {
  const token = Redacted.make("v1.acme.1.1806487200.00");
  const exit = await run(token.pipe(fingerprint));
  assert.ok(Exit.isSuccess(exit));
  assert.equal(exit.value, Str.slice(0, 8)(createHash("sha256").update("v1.acme.1.1806487200.00").digest("hex")));
});
