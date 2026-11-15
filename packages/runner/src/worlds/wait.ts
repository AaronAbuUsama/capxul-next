// The makers' wait for background work (decisions.md, 27): poll an operation until it answers differently. A wait that
// cannot end well ends at once, and one that runs out names the last thing it saw, so its record explains it (world run
// 43759314286, 15 November 2026: a site door restarted mid-make left a site stopped, and ten minutes said nothing).
import { Pipeline } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import { describe, RunnerFailure } from "../failure.ts";

const failed = (message: string) => RunnerFailure.make({ step: "starting world", message });

/** One poll every two seconds, for at most ten minutes. */
const POLL = { schedule: Schedule.spaced(Duration.seconds(2)), times: 300 } as const;

/** How a wait reads each answer: what it saw, and a reason no later poll can be done. */
export interface Reading<A> {
  readonly seen: (answer: A) => string;
  readonly stopped?: (answer: A) => Option.Option<string>;
}

/** Polls until `done`. An answer `stopped` ends it at once; one that runs out names the last answer or failure seen. */
export const until = Effect.fn(Pipeline.startingPointMake.spans.wait.name)(function* <A, E, R>(
  what: string,
  poll: Effect.Effect<A, E, R>,
  done: (answer: A) => boolean,
  read: Reading<A>,
) {
  const last = yield* Ref.make("no answer");
  const once = poll.pipe(
    Effect.tapCause((cause) => Ref.set(last, describe(cause))),
    Effect.tap((answer) => Ref.set(last, read.seen(answer))),
    Effect.flatMap((answer) => {
      if (done(answer)) return Effect.succeed(Option.none<string>());
      const why = read.stopped === undefined ? Option.none<string>() : read.stopped(answer);
      return Option.isSome(why) ? Effect.succeed(why) : Effect.fail(failed(`waiting for ${what}`));
    }),
  );
  const stop = yield* once.pipe(
    Effect.retry(POLL),
    Effect.catch(() =>
      Effect.flatMap(Ref.get(last), (seen) => Effect.fail(failed(`waited ten minutes for ${what}; last saw ${seen}`))),
    ),
  );
  return yield* Option.match(stop, {
    onNone: () => Effect.void,
    onSome: (why) => Effect.fail(failed(`stopped waiting for ${what}: ${why}`)),
  });
});

/** What a failed or successful call answered, for a wait whose poll is the call's exit. */
export const seenExit = <E>(
  exit: { readonly _tag: "Success" } | { readonly _tag: "Failure"; readonly cause: Cause.Cause<E> },
) => (exit._tag === "Success" ? "a success" : describe(exit.cause));

type Companies = {
  readonly companies: ReadonlyArray<{ readonly org: string; readonly site: { readonly state: string } }>;
};

/** How a wait for `org`'s site reads world.show: its state, and stopped for good (a stopped site is never made again). */
export const siteReading = (org: string): Reading<Companies> => ({
  seen: (view) =>
    Option.match(
      Arr.findFirst(view.companies, (company) => company.org === org),
      {
        onNone: () => `world.show listing no company ${org}`,
        onSome: (company) => `${org}'s site ${company.site.state}`,
      },
    ),
  stopped: (view) =>
    Option.map(
      Arr.findFirst(view.companies, (company) => company.org === org && company.site.state === "stopped"),
      () => `world.show lists ${org}'s site as stopped, which is never made again`,
    ),
});
