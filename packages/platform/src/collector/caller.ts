// Who is calling the collector, from what the request carries (claims.ts says what a claim is):
//
// - by service binding, a world's Core: its binding's props hold `claim`, which only the world's deployer can set
//   (Cloudflare gives a request from the public route empty props). The claim must name a world and a grade.
// - on the public route, anyone else: `Authorization: Bearer <claim>`, an operator's claim.
//
// Anything else is refused before the body is read: 401 with no claim, 403 with one that is not the collector key's,
// has expired, or (by binding) names no world.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import type * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import { type CollectorClaims, verifyClaim } from "./claims.ts";

/** The props key of a world's claim on its service binding to the collector. */
export const CLAIM_PROP = "claim";

/** How the caller reached the collector. */
export type CallerPath = "binding" | "public";

export type Identified =
  | { readonly _tag: "Caller"; readonly path: CallerPath; readonly claims: CollectorClaims }
  | { readonly _tag: "Refused"; readonly status: 401 | 403; readonly error: string };

const refused = (status: 401 | 403, error: string): Identified => ({ _tag: "Refused", status, error });

const bearerOf = (authorization: string | undefined): Option.Option<string> =>
  authorization !== undefined && Str.startsWith("Bearer ")(authorization)
    ? Option.some(Str.trim(Str.slice(7)(authorization)))
    : Option.none();

/** The caller of a request, from its binding's props and its Authorization header, at `nowSeconds`. */
export const identify = Effect.fn("platform.collector.identify")(function* (
  key: Redacted.Redacted,
  request: { readonly props: Record<string, unknown>; readonly authorization: string | undefined },
  nowSeconds: number,
) {
  const bound = request.props[CLAIM_PROP];
  if (Predicate.isString(bound)) {
    const claims = yield* verifyClaim(key, bound, nowSeconds, true);
    return Option.match(claims, {
      onNone: () => refused(403, "binding-claim-refused"),
      onSome: (c): Identified => ({ _tag: "Caller", path: "binding", claims: c }),
    });
  }
  const bearer = bearerOf(request.authorization);
  if (Option.isNone(bearer)) return refused(401, "claim-required");
  const claims = yield* verifyClaim(key, bearer.value, nowSeconds, false);
  return Option.match(claims, {
    onNone: () => refused(403, "claim-refused"),
    onSome: (c): Identified => ({ _tag: "Caller", path: "public", claims: c }),
  });
});
