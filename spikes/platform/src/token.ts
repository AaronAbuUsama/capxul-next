// A world's site token: `v1.<world>.<quota>.<expires>.<sig>`, where `sig` is HMAC-SHA256 under the platform's door
// key over everything before it. door/door.py checks it; nothing else does. It names one world, the most sites that
// world may hold, and the moment (Unix seconds, real time) it stops working, which is the world's expiry.
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { createHash, createHmac } from "node:crypto";

export const Claims = Schema.Struct({
  world: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{1,15}$/)),
  quota: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 999 })),
  expires: Schema.Int,
});
export type Claims = typeof Claims.Type;

export const mint = (key: Redacted.Redacted<string>, claims: Claims) =>
  Effect.map(Schema.decodeUnknownEffect(Claims)(claims), (c) => {
    const body = `v1.${c.world}.${c.quota}.${c.expires}`;
    return Redacted.make(`${body}.${createHmac("sha256", Redacted.value(key)).update(body).digest("hex")}`);
  });

/** A print of a token that can be logged: the first 8 hex digits of its SHA-256. */
export const fingerprint = (token: Redacted.Redacted<string>) =>
  createHash("sha256").update(Redacted.value(token)).digest("hex").slice(0, 8);
