// A company's site, as the document, report and clock operations reach it: the Capxul app's `capxul.core_api`
// methods (packages/frappe-app), called through the world's site door (`SiteDoor`) as the site's own API user. Each
// call names the company and the person it acts for; the site runs it as that person
// (packages/blueprint, src/common/site.ts).
//
// Which site is the company's: the site door lists the world's sites, and a site that is not the company's answers
// `org-not-here`, so Core asks each ready site in turn. A world has one site per company, so with one company that is
// one call. No ready site of the company: `SiteUnavailable` while one is still being made, `OrgNotFound` otherwise.
import { Errors } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { SiteDoorFailed } from "../failures.ts";
import { SiteDoor } from "../site/SiteDoor.ts";

/** A refusal a site answers instead of doing what it was asked (capxul/core_api.py). */
export const SiteRefusal = Schema.Union([
  Schema.Struct({ refused: Schema.Literal("org-not-here"), org: Schema.String }),
  Schema.Struct({ refused: Schema.Literal("no-site-user") }),
  Schema.Struct({
    refused: Schema.Literal("site-refused"),
    target: Schema.String,
    reason: Schema.Literals(["permission", "validation", "not_found", "part_off"]),
    message: Schema.String,
  }),
  Schema.Struct({ refused: Schema.Literal("not-a-draft"), docstatus: Schema.Int }),
]);
export type SiteRefusal = typeof SiteRefusal.Type;
const isRefusal = Schema.is(SiteRefusal);

/** Frappe's answer to a whitelisted method: its `message`. */
const Message = Schema.Struct({ message: Schema.Unknown });

const unavailable = (org: string, state: "creating" | "stopped" | "unreachable") =>
  Errors.SiteUnavailable.make({ org, state });

/** What the site door's own failure means for a company: no bench is no company site; the others are its state. */
const doorFailure = (
  org: string,
  failed: SiteDoorFailed,
): Effect.Effect<never, Errors.OrgNotFound | Errors.SiteUnavailable> => {
  if (failed.reason === "unset") return Effect.fail(Errors.OrgNotFound.make({ org }));
  if (failed.reason === "unreachable") return Effect.fail(unavailable(org, "unreachable"));
  if (failed.code === "site-creating") return Effect.fail(unavailable(org, "creating"));
  if (failed.code === "site-failed") return Effect.fail(unavailable(org, "stopped"));
  return Effect.die(failed);
};

export class CompanySites extends Context.Service<
  CompanySites,
  {
    /**
     * Calls `capxul.core_api.<method>` with `body` on the company's site: the site's answer, or its refusal, other
     * than `org-not-here`. A fault of the site (an answer that is not HTTP 200) is a defect.
     */
    readonly call: (
      org: string,
      method: string,
      body: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<unknown, Errors.OrgNotFound | Errors.SiteUnavailable>;
    /** Calls `method` on every ready site of the world, in order, each with the body `bodyOf` makes for its place. */
    readonly everySite: (
      method: string,
      bodyOf: (index: number, count: number) => Readonly<Record<string, unknown>>,
    ) => Effect.Effect<ReadonlyArray<unknown>>;
  }
>()("@capxul/core/site-ops/sites/CompanySites") {}

/** The world's company sites through the site door this Core was deployed with. */
export const CompanySitesLive = Layer.effect(
  CompanySites,
  Effect.gen(function* () {
    const door = yield* SiteDoor;
    const send = (
      site: string,
      method: string,
      body: Readonly<Record<string, unknown>>,
    ): Effect.Effect<unknown, SiteDoorFailed> =>
      Effect.gen(function* () {
        const answer = yield* door.call(site, { method: "POST", path: `/api/method/capxul.core_api.${method}`, body });
        if (answer.status !== 200) return yield* Effect.die(`${site} answered ${method} with HTTP ${answer.status}`);
        return (yield* Schema.decodeUnknownEffect(Message)(answer.body).pipe(Effect.orDie)).message;
      });
    const listed = door.sites;
    return CompanySites.of({
      call: (org, method, body) =>
        Effect.gen(function* () {
          const sites = (yield* listed).sites;
          for (const site of Arr.filter(sites, (one) => one.state === "ready")) {
            const answer = yield* send(site.site, method, { org, ...body });
            if (!(isRefusal(answer) && answer.refused === "org-not-here")) return answer;
          }
          if (Arr.some(sites, (one) => one.state === "creating")) return yield* unavailable(org, "creating");
          return yield* Errors.OrgNotFound.make({ org });
        }).pipe(Effect.catchTag("SiteDoorFailed", (failed) => doorFailure(org, failed))),
      everySite: (method, bodyOf) =>
        Effect.gen(function* () {
          const ready = Arr.filter((yield* listed).sites, (one) => one.state === "ready");
          return yield* Effect.forEach(ready, (site, index) => send(site.site, method, bodyOf(index, ready.length)));
        }).pipe(
          Effect.catchTag("SiteDoorFailed", (failed) =>
            failed.reason === "unset" ? Effect.succeed([]) : Effect.die(failed),
          ),
        ),
    });
  }),
);

/** Decodes a site's answer with `schema`, or hands its refusal to `refused`. Anything else is a defect. */
export const answerOf = <S extends Schema.Top, E>(
  schema: S,
  answer: unknown,
  refused: (refusal: SiteRefusal) => Effect.Effect<never, E>,
): Effect.Effect<S["Type"], E, S["DecodingServices"]> =>
  isRefusal(answer)
    ? refused(answer)
    : Schema.decodeUnknownEffect(schema)(answer).pipe(
        Effect.mapError((error) => `the site answered what Core cannot read: ${error.message}`),
        Effect.orDie,
      );

/** A refusal no operation that met it declares: the site is not the Capxul app Core was built against. */
export const unexpected = (refusal: SiteRefusal) =>
  Effect.die(`the site refused with ${refusal.refused}, which this operation never asks for`);
