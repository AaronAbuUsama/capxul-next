// Who is calling the collector, from the token it carries (grant.ts says what a token is):
//
// - by service binding, a world's Core: its binding's props hold `token`, which only the world's deployer can set
//   (Cloudflare gives a request from the public route empty props). The token must name a world and a grade.
// - on the public route, anyone else: `Authorization: Bearer <token>`, which src/collector.ts hands to `verify`.
//
// Either way the identity stamped is the token's world and grade and the collector's own stage.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import { type CollectorGrant, verifyCollectorToken } from "./tokens.ts";
import type { Identity } from "./forward.ts";

/** The props key of a world's token on its service binding to the collector. */
export const TOKEN_PROP = "token";

/** The identity a verified token stands for at a collector of `stage`. A token naming no world stamps none. */
export const identityOf = (stage: string, grant: CollectorGrant): Identity => ({
  world: Option.getOrElse(grant.world, () => ""),
  grade: Option.getOrElse(grant.grade, () => ""),
  stage,
});

/** The token a binding's props carry, if they carry one: none for a request on the public route. */
export const boundTokenOf = (props: Record<string, unknown>): Option.Option<Redacted.Redacted> => {
  const token = props[TOKEN_PROP];
  return Predicate.isString(token) ? Option.some(Redacted.make(token)) : Option.none();
};

/**
 * Whom a token names at a collector of `stage`, at `nowSeconds`: none when it is not signed under `key`, has expired,
 * or (`needsWorld`, a binding's) names no world and grade.
 */
export const verifierOf =
  (key: Redacted.Redacted, stage: string, nowSeconds: number, needsWorld: boolean) => (token: Redacted.Redacted) =>
    verifyCollectorToken(key, Redacted.value(token), nowSeconds, needsWorld).pipe(
      Effect.map(Option.map((grant) => identityOf(stage, grant))),
    );
