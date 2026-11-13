// A world's site token: `v1.<world>.<quota>.<expires>.<sig>`, where `sig` is HMAC-SHA256 under the platform's door
// key over everything before it, in hex. door/door.py checks it; nothing else does. It names one world, the most sites
// that world may hold, and the moment (Unix seconds, real time) it stops working, which is the world's expiry.
// A world's create step mints it (src/run-mint.ts); packages/world reaches `mint` through src/door.ts.
import { Values } from "@capxul/blueprint";
import * as Digest from "effect/crypto/Digest";
import * as Mac from "effect/crypto/Mac";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as SecureRandom from "effect/crypto/SecureRandom";

export const Claims = Schema.Struct({
  /** The blueprint's WorldName: the name a site's address ends with (`<label>-<world>.<domain>`). */
  world: Values.WorldName,
  quota: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 999 })),
  expires: Schema.Int.check(Schema.isBetween({ minimum: 1_000_000_000, maximum: 9_999_999_999 })),
});
export type Claims = typeof Claims.Type;

/** The services the token needs: WebCrypto's HMAC and digest. */
export const cryptoLayer = Layer.merge(Mac.layerWebCrypto, Digest.layerWebCrypto).pipe(
  Layer.provide(SecureRandom.layerWebCrypto),
);

const bytes = (text: string) => new TextEncoder().encode(text);

/** The signed text of a token, without its signature. */
export const body = (c: Claims) => `v1.${c.world}.${c.quota}.${c.expires}`;

/** Mints a world's site token under the door key. The claims are checked first, as the door checks them. */
export const mint = Effect.fn("platform.token.mint")(function* (key: Redacted.Redacted, claims: Claims) {
  const c = yield* Schema.decodeEffect(Claims)(claims);
  const mac = yield* Mac.Mac;
  const k = yield* Mac.key(Mac.hmacSha256, key.pipe(Redacted.value, bytes));
  const sig = yield* mac.sign(k, bytes(body(c)));
  return Redacted.make(`${body(c)}.${Hex.encode(sig)}`);
});

/** A print of a token that can be logged: the first 8 hex digits of its SHA-256. */
export const fingerprint = Effect.fn("platform.token.fingerprint")(function* (token: Redacted.Redacted) {
  const digest = yield* Digest.Digest;
  const hex = yield* digest.digestHex(Digest.sha256, token.pipe(Redacted.value, bytes));
  return Str.slice(0, 8)(hex);
});
