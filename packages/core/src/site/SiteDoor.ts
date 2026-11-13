// A company's site, as the blueprint's operations will reach it (doc.*, report.run; decisions.md, 40): ERPNext's own
// REST calls, through the site door of the world's bench (packages/platform, door/door.py), on the site's own
// credential, never with the bench's admin. The door checks the world's site token on every call and carries a call
// only to a site of that world.
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

/** Core's own failure in reaching a site: not a refusal of the contract. Nothing in it carries a secret. */
export class SiteDoorFailed extends Schema.TaggedError<SiteDoorFailed, { readonly brand: unique symbol }>()(
  "SiteDoorFailed",
  {
    /** `unset`: this Core was deployed with no bench; `unreachable`: no answer; `refused`: the door said no. */
    reason: Schema.Literals(["unset", "unreachable", "refused"]),
    status: Schema.NullOr(Schema.Int),
    /** The door's refusal code (door.py), such as `site-not-in-world` or `site-creating`. */
    code: Schema.NullOr(Schema.String),
    message: Schema.String,
  },
) {}

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
const Refusal = Schema.Struct({ refused: Schema.String, detail: Schema.optional(Schema.String) });

export class SiteDoor extends Context.Service<
  SiteDoor,
  {
    /** The world's sites, as the door holds them. */
    readonly sites: Effect.Effect<typeof WorldSites.Type, SiteDoorFailed>;
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
            const body = yield* response.json.pipe(Effect.orElseSucceed(() => null));
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
