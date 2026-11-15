// A company's site, as the blueprint's operations will reach it (doc.*, report.run;
// packages/blueprint, src/common/site.ts): ERPNext's own REST calls, through the site door of the world's bench
// (packages/platform, door/door.py), on the site's own credential, never with the bench's admin. The door checks the
// world's site token on every call and carries a call only to a site of that world.
//
//   ANY <door>/sites/<site>/api/...   X-Capxul-Site-Token: <the world's site token>
//                                     Authorization: token <key>:<secret>   (the API user the door made on the site)
//   GET <door>/world                  the world's sites and their state (creating, ready, failed)
//
// The door's protocol is door.py's; this is Core's client of it. The handlers will map what comes back to the
// blueprint's refusals (NoSiteUser, SiteRefused, SiteUnavailable); this service only carries and reports.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { ENV, secretOf, textOf } from "../env.ts";
import { SiteDoorFailed } from "../failures.ts";

export { SiteDoorFailed };

/** What a site answered: its status and its JSON body, as ERPNext wrote it. */
export interface SiteAnswer {
  readonly status: number;
  readonly body: unknown;
}

export interface SiteCall {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  /** ERPNext's path, from `/api/`: `/api/resource/Supplier`, `/api/method/frappe.auth.get_logged_user`. */
  readonly path: string;
  readonly body?: unknown;
}

const WorldSites = Schema.Struct({
  world: Schema.String,
  sites: Schema.Array(Schema.Struct({ site: Schema.String, state: Schema.String })),
});
/**
 * One site as the door holds it: its name and its state (creating, ready, failed, removing, or interrupted: the door
 * restarted while making it, door.py).
 */
const DoorSite = Schema.Struct({ site: Schema.String, state: Schema.String });
export type DoorSite = typeof DoorSite.Type;

const decodeSite = (answer: SiteAnswer) =>
  Schema.decodeUnknownEffect(DoorSite)(answer.body).pipe(
    Effect.mapError((error) =>
      SiteDoorFailed.make({ reason: "refused", status: answer.status, code: null, message: error.message }),
    ),
  );

const Refusal = Schema.Struct({ refused: Schema.String, detail: Schema.optional(Schema.String) });

export class SiteDoor extends Context.Service<
  SiteDoor,
  {
    /** The world's sites, as the door holds them. */
    readonly sites: Effect.Effect<typeof WorldSites.Type, SiteDoorFailed>;
    /**
     * Starts making a site of the world for a company (about 100 s): `label` names it, `<label>-<world>.<domain>`,
     * and it gets the world's site credential as its own API user. Answers the site as the door holds it.
     */
    readonly make: (label: string, company: string) => Effect.Effect<DoorSite, SiteDoorFailed>;
    /** One of the world's sites as the door holds it now. */
    readonly site: (site: string) => Effect.Effect<DoorSite, SiteDoorFailed>;
    /** Removes one of the world's sites, its database and files, and the door's entry for it. */
    readonly remove: (site: string) => Effect.Effect<void, SiteDoorFailed>;
    /** Sets the world's clock on the bench, through one of its ready sites: frozen at an instant, or running offset. */
    readonly clock: (
      clock: { readonly frozen_at_ms: number } | { readonly offset_ms: number },
    ) => Effect.Effect<SiteAnswer, SiteDoorFailed>;
    /** One REST call to one of the world's sites, as its own API user. A site's own refusal is an answer. */
    readonly call: (site: string, call: SiteCall) => Effect.Effect<SiteAnswer, SiteDoorFailed>;
  }
>()("@capxul/core/site/SiteDoor") {
  /** The site door this Core was deployed with (src/env.ts), over `HttpClient`. */
  static readonly fromEnv = (env: Record<string, unknown>) =>
    Layer.effect(
      SiteDoor,
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const door = textOf(env[ENV.siteDoor]);
        const token = secretOf(env, ENV.siteToken);
        const key = secretOf(env, ENV.siteKey);
        const secret = secretOf(env, ENV.siteSecret);
        const unset = SiteDoorFailed.make({
          reason: "unset",
          status: null,
          code: null,
          message: "this Core was deployed with no bench: its world has no sites",
        });
        const send = (request: HttpClientRequest.HttpClientRequest) =>
          Effect.gen(function* () {
            if (Option.isNone(door) || Option.isNone(token)) return yield* unset;
            const response = yield* http
              .execute(
                request.pipe(
                  HttpClientRequest.prependUrl(door.value),
                  HttpClientRequest.setHeader("x-capxul-site-token", Redacted.value(token.value)),
                ),
              )
              .pipe(
                Effect.mapError((error) =>
                  SiteDoorFailed.make({ reason: "unreachable", status: null, code: null, message: error.message }),
                ),
              );
            // The door answers every call with JSON, and so does a site's API through it: an answer that is not JSON
            // came from something in between (Cloudflare's edge refusing a private address, a proxy), not the door.
            const parsed = yield* response.json.pipe(Effect.option);
            if (Option.isNone(parsed))
              return yield* SiteDoorFailed.make({
                reason: "unreachable",
                status: response.status,
                code: null,
                message: `HTTP ${response.status} that is not JSON (${response.headers["content-type"] ?? "no content type"}): not the site door's answer`,
              });
            const body = parsed.value;
            const refusal = Schema.decodeUnknownOption(Refusal)(body);
            if (Option.isSome(refusal) && response.status >= 400)
              return yield* SiteDoorFailed.make({
                reason: "refused",
                status: response.status,
                code: refusal.value.refused,
                message: refusal.value.detail ?? "",
              });
            return { status: response.status, body } satisfies SiteAnswer;
          }).pipe(Effect.scoped);
        return SiteDoor.of({
          make: (label, company) =>
            Effect.gen(function* () {
              if (Option.isNone(key) || Option.isNone(secret)) return yield* unset;
              const body = {
                label,
                company,
                api_key: Redacted.value(key.value),
                api_secret: Redacted.value(secret.value),
              };
              return yield* Effect.flatMap(
                send(HttpClientRequest.bodyJsonUnsafe(HttpClientRequest.post("/sites"), body)),
                decodeSite,
              );
            }),
          site: (site) => Effect.flatMap(send(HttpClientRequest.get(`/sites/${site}`)), decodeSite),
          remove: (site) => HttpClientRequest.delete(`/sites/${site}`).pipe(send, Effect.asVoid),
          clock: (clock) => send(HttpClientRequest.bodyJsonUnsafe(HttpClientRequest.post("/clock"), clock)),
          sites: send(HttpClientRequest.get("/world")).pipe(
            Effect.flatMap((answer) => Schema.decodeUnknownEffect(WorldSites)(answer.body)),
            Effect.mapError((error) =>
              Schema.is(SiteDoorFailed)(error)
                ? error
                : SiteDoorFailed.make({ reason: "refused", status: null, code: null, message: error.message }),
            ),
          ),
          call: (site, call) =>
            Effect.gen(function* () {
              if (Option.isNone(key) || Option.isNone(secret)) return yield* unset;
              const credential = `token ${Redacted.value(key.value)}:${Redacted.value(secret.value)}`;
              const base = HttpClientRequest.make(call.method)(`/sites/${site}${call.path}`).pipe(
                HttpClientRequest.setHeader("authorization", credential),
                HttpClientRequest.setHeader("accept", "application/json"),
              );
              return yield* send(call.body === undefined ? base : HttpClientRequest.bodyJsonUnsafe(base, call.body));
            }),
        });
      }),
    );
}
