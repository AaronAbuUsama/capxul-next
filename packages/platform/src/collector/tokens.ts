// Who may send telemetry to a stage's collector, and what the collector stamps on what they send: a signed token,
//
//   c1.<operator>.<world or ->.<grade or ->.<expires>.<HMAC-SHA256 under the collector key over the rest, in hex>
//
// The collector key is an Alchemy.Random of the platform stage (`CollectorKey-g<n>`), read from the shared state by
// whoever holds the Cloudflare key, as the site door's key is (src/token.ts). A token reaches the collector two ways:
//
// - A world's Core: in the props of its service binding to the collector, which packages/world writes when it
//   deploys the world (`ctx.props`, set by the deployer, empty on the public route), naming its world and grade.
// - A public caller (the runner in CI or in a container, the CLI): as `Authorization: Bearer <token>` on its
//   public route (the Worker's workers.dev URL), minted for its operator, naming the world it drives when it drives one.
//
// A caller cannot widen its own token: the collector checks the signature and the expiry before anything.
import { Values } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Mac from "effect/crypto/Mac";
import * as Hex from "effect/encoding/Hex";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

/** What a token says: whose it is, the world and grade it speaks for (none for an operator's own work), until when. */
export const CollectorGrant = Schema.Struct({
  operator: Values.OperatorName,
  world: Schema.Option(Values.WorldName),
  grade: Schema.Option(Values.Grade),
  /** Unix seconds, real time. */
  expires: Schema.Int.check(Schema.isBetween({ minimum: 1_000_000_000, maximum: 9_999_999_999 })),
});
export type CollectorGrant = typeof CollectorGrant.Type;

const VERSION = "c1";
const NONE = "-";
const bytes = (text: string) => new TextEncoder().encode(text);
const orNone = (value: Option.Option<string>) => Option.getOrElse(value, () => NONE);

/** The signed text of a token, without its signature. */
export const tokenBody = (c: CollectorGrant) =>
  `${VERSION}.${c.operator}.${orNone(c.world)}.${orNone(c.grade)}.${c.expires}`;

const macKey = (key: Redacted.Redacted) => Mac.key(Mac.hmacSha256, key.pipe(Redacted.value, bytes));

/** Signs a token under the collector key. The token is checked first, as the collector checks it. */
export const mintCollectorToken = Effect.fn("sites.collector.mintCollectorToken")(function* (
  key: Redacted.Redacted,
  grant: CollectorGrant,
) {
  const c = yield* Schema.decodeEffect(CollectorGrant)(grant);
  const mac = yield* Mac.Mac;
  const sig = yield* mac.sign(yield* macKey(key), bytes(tokenBody(c)));
  return Redacted.make(`${tokenBody(c)}.${Hex.encode(sig)}`);
});

const decodeGrant = Schema.decodeUnknownOption(CollectorGrant);
const part = (text: string) => (text === NONE ? Option.none() : Option.some(text));

/** The grant a text states, before its signature is checked; none when it is not a token's shape. */
export const parseCollectorToken = (
  text: string,
): Option.Option<{ grant: CollectorGrant; body: string; sig: string }> => {
  const parts = Str.split(".")(text);
  if (parts.length !== 6 || parts[0] !== VERSION) return Option.none();
  const [, operator = "", world = "", grade = "", expires = "", sig = ""] = parts;
  const grant = decodeGrant({ operator, world: part(world), grade: part(grade), expires: Number(expires) });
  return Option.map(grant, (c) => ({ grant: c, body: tokenBody(c), sig }));
};

/**
 * The grant of a signed text, when its signature is the collector key's and it has not expired at `nowSeconds`;
 * none otherwise. A world's token must name its world and grade (`needsWorld`): a binding speaks for one world.
 */
export const verifyCollectorToken = Effect.fn("sites.collector.verifyCollectorToken")(function* (
  key: Redacted.Redacted,
  text: string,
  nowSeconds: number,
  needsWorld: boolean,
) {
  const parsed = parseCollectorToken(text);
  if (Option.isNone(parsed)) return Option.none<CollectorGrant>();
  const { grant, body, sig } = parsed.value;
  if (grant.expires <= nowSeconds) return Option.none<CollectorGrant>();
  if (needsWorld && (Option.isNone(grant.world) || Option.isNone(grant.grade))) return Option.none<CollectorGrant>();
  const tag = Hex.decode(sig);
  if (Result.isFailure(tag) || tag.success.length !== 32) return Option.none<CollectorGrant>();
  const mac = yield* Mac.Mac;
  const valid = yield* mac.verify(yield* macKey(key), tag.success, bytes(body));
  return valid ? Option.some(grant) : Option.none<CollectorGrant>();
});
