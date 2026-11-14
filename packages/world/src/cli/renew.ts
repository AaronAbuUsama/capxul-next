// `renew <name> --lifetime "7 days"`: a world that is meant to last (a shared world) given a later expiry and deployed
// again with the code that runs now (src/lifecycle/renew.ts). Its own file: the other commands fill commands.ts.
import * as Effect from "effect/Effect";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { renew } from "../lifecycle/renew.ts";
import { durationOf, Report } from "./report.ts";

export const renewCommand = Command.make(
  "renew",
  {
    name: Argument.String("name").pipe(Argument.withDescription("The world's name")),
    lifetime: Flag.String("lifetime").pipe(
      Flag.withDescription('How long the world lives from now, e.g. "7 days"; never less than it has left'),
    ),
  },
  (input) =>
    Effect.gen(function* () {
      const renewed = yield* renew(input.name, yield* durationOf(input.lifetime));
      const out = yield* Report;
      yield* out.print(renewed);
    }),
).pipe(
  Command.withDescription(
    "Give a world a later expiry and deploy it again with the running code, keeping its data, sites and snapshots",
  ),
);
