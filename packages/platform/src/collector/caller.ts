// Who is calling the collector, from the claim it carries (claims.ts says what a claim is):
//
// - by service binding, a world's Core: its binding's props hold `claim`, which only the world's deployer can set
//   (Cloudflare gives a request from the public route empty props). The claim must name a world and a grade.
// - on the public route, anyone else: `Authorization: Bearer <claim>`, which src/collector.ts hands to `verify`.
//
// Either way the identity stamped is the claim's world and grade and the collector's own stage.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import { type CollectorClaims, verifyClaim } from "./claims.ts";
import type { Identity } from "./forward.ts";

/** The props key of a world's claim on its service binding to the collector. */
export const CLAIM_PROP = "claim";

/** The identity a verified claim stands for at a collector of `stage`. A claim naming no world stamps none. */
export const identityOf = (stage: string, claims: CollectorClaims): Identity => ({
  world: Option.getOrElse(claims.world, () => ""),
  grade: Option.getOrElse(claims.grade, () => ""),
  stage,
});

/** The claim a binding's props carry, if they carry one: none for a request on the public route. */
export const boundClaimOf = (props: Record<string, unknown>): Option.Option<Redacted.Redacted> => {
  const claim = props[CLAIM_PROP];
  return Predicate.isString(claim) ? Option.some(Redacted.make(claim)) : Option.none();
};

/**
 * Whom a claim names at a collector of `stage`, at `nowSeconds`: none when it is not signed under `key`, has expired,
 * or (`needsWorld`, a binding's) names no world and grade.
 */
export const verifierOf =
  (key: Redacted.Redacted, stage: string, nowSeconds: number, needsWorld: boolean) => (claim: Redacted.Redacted) =>
    verifyClaim(key, Redacted.value(claim), nowSeconds, needsWorld).pipe(
      Effect.map(Option.map((claims) => identityOf(stage, claims))),
    );
