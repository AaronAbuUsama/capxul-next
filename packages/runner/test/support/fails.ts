// An acceptance check written before its build (roadmap 4.4, "checks first"). The repository's tests run on node:test,
// which has no expected-failure mark on Node 22, so this is one: `failsUntilBuilt(body)` succeeds with the reason
// `body` failed, and the test asserts that reason, so it fails for the right reason only. When the build makes `body`
// pass, this dies, and the builder's pull request turns the test into a plain one that runs `body` itself.
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

export const failsUntilBuilt = <A, E>(body: Effect.Effect<A, E>): Effect.Effect<string> =>
  Effect.flatMap(
    Effect.exit(body),
    Exit.match({
      onSuccess: () =>
        Effect.die(new Error("this check passes now: make it a plain test in the pull request that built it")),
      onFailure: (cause) => cause.pipe(Cause.pretty, Effect.succeed),
    }),
  );
