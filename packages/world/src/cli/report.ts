// What every command shares: where its result goes, and how a lifetime is written.
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Str from "effect/String";
import { InvalidDuration } from "../failures.ts";

/** Where a command's result goes. */
export class Report extends Context.Service<Report, { readonly print: (value: unknown) => Effect.Effect<void> }>()(
  "@capxul/world/cli/report",
) {}

const UNITS: Readonly<Record<string, (amount: number) => Duration.Duration>> = {
  second: Duration.seconds,
  minute: Duration.minutes,
  hour: Duration.hours,
  day: Duration.days,
};

/** A lifetime as people write it: "90 seconds", "30 minutes", "2 hours", "1 day". */
export const durationOf = (given: string) => {
  const found = /^(\d+)\s*(second|minute|hour|day)s?$/.exec(Str.trim(given));
  const amount = Number(found?.[1]);
  const unit = found?.[2] === undefined ? undefined : UNITS[found[2]];
  return unit === undefined || !Number.isSafeInteger(amount)
    ? Effect.fail(
        InvalidDuration.make({
          given,
          message: `"${given}" is not a duration; write it like "2 hours" or "30 minutes"`,
        }),
      )
    : Effect.succeed(unit(amount));
};
