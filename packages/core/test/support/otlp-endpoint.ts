// A test endpoint for OTLP export, and the expected-failure mark of 4.4's checks-first tests. The same file is in each
// producer's tests (core, world, platform; the runner's is split in capture.ts and fails.ts), because a package's
// tests import no other package's tests.
//
// `capturing()` is an in-memory `HttpClient` that keeps every request it is sent and answers 200.
// `failsUntilBuilt(body)` succeeds with the reason `body` failed, and the test asserts that reason; when a build makes
// `body` pass, it dies, and the builder's pull request turns the test into a plain one.
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

export interface Posted {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** The endpoint's base URL. */
export const ENDPOINT = "https://otlp.test";
/** The revision the tests export under. */
export const REVISION = "0123abc";

export const capturing = () => {
  const posted: Array<Posted> = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      posted.push({
        url: request.url,
        headers: request.headers,
        body: request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
      });
      return HttpClientResponse.fromWeb(request, new Response(null, { status: 200 }));
    }),
  );
  return { posted, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

/** The bodies posted to one path (`/v1/traces`, ...). */
export const bodiesTo = (posted: ReadonlyArray<Posted>, path: string): ReadonlyArray<string> =>
  Arr.map(
    Arr.filter(posted, (each) => Str.endsWith(path)(each.url)),
    (each) => each.body,
  );

export const failsUntilBuilt = <A, E>(body: Effect.Effect<A, E>): Effect.Effect<string> =>
  Effect.flatMap(
    Effect.exit(body),
    Exit.match({
      onSuccess: () =>
        Effect.die(new Error("this check passes now: make it a plain test in the pull request that built it")),
      onFailure: (cause) => cause.pipe(Cause.pretty, Effect.succeed),
    }),
  );
