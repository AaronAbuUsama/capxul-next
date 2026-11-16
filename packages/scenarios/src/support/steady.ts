// Chain reads that ride out a dropped connection. A world's chain answers at its door through a Core Worker that may
// have just started, and a check of a 50-person cast makes a hundred reads, so one may meet a reset socket. Such a read
// is sent again, a few times with a short wait, because a read changes nothing. Only a read that got no answer is sent
// again: an answer, a decoding failure or any other defect stands as the first try made it.
import { Chain } from "@capxul/blueprint";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Rec from "effect/Record";

/** How many times a read is tried in all, and the first wait between tries (it grows by one wait each try). */
export const STEADY = { tries: 4, wait: Duration.millis(250) } as const;

/** What the transport says when a connection dropped before any answer came back. */
const DROPPED = /ECONNRESET|socket hang up|other side closed|EPIPE|UND_ERR_SOCKET/u;

/** True when `cause` is a connection that dropped before any answer: nothing was read, so reading again is safe. */
export const dropped = (cause: Cause.Cause<unknown>): boolean => DROPPED.test(Cause.pretty(cause));

/** `read`, tried again while its connection drops, at most `STEADY.tries` times in all. */
export const steadily = <A, E, R>(read: Effect.Effect<A, E, R>, tried = 1): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.exit(read), (exit) =>
    Exit.isSuccess(exit)
      ? Effect.succeed(exit.value)
      : tried < STEADY.tries && dropped(exit.cause)
        ? Effect.andThen(Effect.sleep(Duration.times(STEADY.wait, tried)), steadily(read, tried + 1))
        : Effect.failCause(exit.cause),
  );

type AnyRead = (payload: unknown, options?: Chain.ReadOptions) => Effect.Effect<unknown>;

/** `reader` with every read tried again while its connection drops (`steadily`). */
export const steady = (reader: Chain.Reader): Chain.Reader =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each read keeps its own payload and answer: the map only wraps the effect it returns
  Rec.map(Chain.reads, (_declared, name) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the read named `name` takes that read's own payload, which the caller of the steady reader gives it unchanged
    const read = reader[name] as AnyRead;
    return (payload: unknown, options?: Chain.ReadOptions) => steadily(read(payload, options));
  }) as unknown as Chain.Reader;
