// Two small routes of Core that are not the blueprint's operations, declared here and nowhere in the blueprint:
//
//   GET /health                        200 {"core": "capxul", "world": <name>}: a world is ready once Core answers it
//   GET /probe/site?path=…[&site=…]    one read of a company site through the site door, as SiteDoor makes it:
//                                      the proof of roadmap step 1.4 that Core's world door reaches its sites
//
// The probe is signed in as the world's door is (the door token, or the owner's token), reads only (GET, and only
// ERPNext's resource reads and two whitelisted methods), and answers what the site door and the site said. Without
// `site` it reads the world's first ready site. It goes when an operation that reads a site is built.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { CREDENTIAL_HEADER } from "@capxul/blueprint";
import { SiteDoor } from "./site/SiteDoor.ts";

export const HEALTH_PATH = "/health";
export const PROBE_PATH = "/probe/site";

const READABLE = ["/api/resource/", "/api/method/frappe.auth.get_logged_user", "/api/method/capxul.clock.now"];

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

/** Answers the probe. `tokens` are the credentials that act as the world's owner. */
export const probeSite = (world: string, tokens: ReadonlyArray<Redacted.Redacted>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const credential = request.headers[CREDENTIAL_HEADER];
    if (!Arr.some(tokens, (token) => credential === `Bearer ${Redacted.value(token)}`))
      return json({ error: "not signed in at this world's door" }, 401);
    const url = Option.getOrUndefined(HttpServerRequest.toURL(request));
    const path = url?.searchParams.get("path") ?? "";
    if (request.method !== "GET" || !Arr.some(READABLE, (prefix) => Str.startsWith(prefix)(path)))
      return json({ error: `the probe reads only: ${Arr.join(READABLE, ", ")}` }, 400);
    const door = yield* SiteDoor;
    const asked = url?.searchParams.get("site") ?? null;
    const site =
      asked ??
      Option.getOrNull(
        Option.map(
          Arr.findFirst((yield* door.sites).sites, (one) => one.state === "ready"),
          (one) => one.site,
        ),
      );
    if (site === null) return json({ world, site: null, error: "the world has no ready site" }, 404);
    const answer = yield* door.call(site, { method: "GET", path });
    return json({ world, site, status: answer.status, body: answer.body });
  }).pipe(
    Effect.catchTag("SiteDoorFailed", (failed) =>
      Effect.succeed(
        json(
          { world, failed: { reason: failed.reason, status: failed.status, code: failed.code, message: failed.message } },
          failed.reason === "refused" ? (failed.status ?? 502) : 502,
        ),
      ),
    ),
  );
