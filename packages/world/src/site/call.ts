// One call to a bench's site door (packages/platform, door/door.py), with a world's site token: answered at once
// (`doorCall`), or run by the door as a job and polled (`doorJob`).
//
// A call that waits on what other worlds hold on a busy bench (a claim, a save, a reset, a template, a sweep, the
// clock, a removal) could outlast the 100 s Cloudflare's edge allows a request through the tunnel, which then answers
// 524 and never says how the call ended. `doorJob` asks the door for a job (`Prefer: respond-async`, door/jobs.py):
// the door answers within its own wait (20 s), with the call's answer when it is done by then and 202 with the job
// while it runs; the job is then asked for until it ends, each ask answered within the same wait. A door from before
// jobs ignores the header and answers when done, so the same call works with either door.
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { SiteFailed } from "../failures.ts";
import { describeFailure } from "../lifecycle/describe.ts";

export const TOKEN_HEADER = "x-capxul-site-token";

/** What marks a refusal that came from Cloudflare's edge, not from the door. */
const BEFORE_THE_DOOR = "(an error page before the door)";

/**
 * A refusal's body in words: the door's own answer as it is, or an HTML error page (Cloudflare's, before the door,
 * such as 524 when the door took over 100 s) by its title.
 */
const wordsOf = (body: string) => {
  const title = /<title>([^<]*)<\/title>/i.exec(body)?.[1];
  return title === undefined ? Str.slice(0, 300)(body) : `${Str.trim(title)} ${BEFORE_THE_DOOR}`;
};

/** One request to the door with `token`; a refusal (400 and above) fails with its words, anything else is decoded. */
const send = <A, E, R>(
  door: string,
  token: Redacted.Redacted,
  request: HttpClientRequest.HttpClientRequest,
  decode: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(
      request.pipe(
        HttpClientRequest.prependUrl(door),
        HttpClientRequest.setHeader(TOKEN_HEADER, Redacted.value(token)),
      ),
    );
    if (response.status >= 400) {
      const refused = yield* response.text;
      return yield* SiteFailed.make({ step: "door", message: `HTTP ${response.status}: ${wordsOf(refused)}` });
    }
    return yield* decode(response);
  }).pipe(
    Effect.scoped,
    Effect.mapError((error) =>
      Schema.is(SiteFailed)(error) ? error : SiteFailed.make({ step: "door", message: describeFailure(error) }),
    ),
  );

/** One call to the site door with `token`, its answer decoded with `schema`. */
export const doorCall = <S extends Schema.Constraint>(
  door: string,
  token: Redacted.Redacted,
  request: HttpClientRequest.HttpClientRequest,
  schema: S,
) => send(door, token, request, HttpClientResponse.schemaBodyJson(schema));

/** The door's answer while a job runs (door/jobs.py). */
const Running = Schema.Struct({ job: Schema.String, state: Schema.Literal("running") });

/** A call's answer when it is done, or the job that is still doing it. */
type Answer<A> = { readonly done: true; readonly value: A } | { readonly done: false; readonly job: string };

const answerOf = <S extends Schema.Constraint>(
  door: string,
  token: Redacted.Redacted,
  request: HttpClientRequest.HttpClientRequest,
  schema: S,
) =>
  send(door, token, request, (response) =>
    response.status === 202
      ? Effect.map(HttpClientResponse.schemaBodyJson(Running)(response), (running): Answer<S["Type"]> => ({
          done: false,
          job: running.job,
        }))
      : Effect.map(HttpClientResponse.schemaBodyJson(schema)(response), (value): Answer<S["Type"]> => ({
          done: true,
          value,
        })),
  );

/** How soon a running job is asked for again; the door holds each ask up to its own wait. */
const POLL_EVERY = Duration.seconds(1);

/**
 * One call to the site door that the door may run as a job: answered as `doorCall` answers, however long the work
 * takes, with no request held open past the door's wait. A poll that meets an error page of Cloudflare's edge (the
 * tunnel, not the door) asks again; the caller's step timeout bounds the whole.
 */
export const doorJob = Effect.fn("world.site.job")(function* <S extends Schema.Constraint>(
  door: string,
  token: Redacted.Redacted,
  request: HttpClientRequest.HttpClientRequest,
  schema: S,
) {
  const first = yield* answerOf(door, token, HttpClientRequest.setHeader(request, "prefer", "respond-async"), schema);
  if (first.done) return first.value;
  const poll = HttpClientRequest.get(`/world/jobs/${first.job}`);
  return yield* answerOf(door, token, poll, schema).pipe(
    Effect.flatMap((answer) =>
      answer.done
        ? Effect.succeed(answer.value)
        : Effect.fail(SiteFailed.make({ step: "waiting", message: `job ${first.job} is still running` })),
    ),
    Effect.retry({
      while: (error) => error.step === "waiting" || Str.includes(BEFORE_THE_DOOR)(error.message),
      schedule: Schedule.spaced(POLL_EVERY),
    }),
  );
});
