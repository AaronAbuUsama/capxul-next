// The command line's own commands, beside the operations' (the blueprint's `CLI_COMMANDS`; roadmap item 3.9): none
// of them is an operation of Capxul, and none calls anything. `login` keeps the account's address and the operator's
// token in the profile (profile.ts), reading the token as one line from standard input so it never sits in a shell's
// history, and prints neither; `logout` forgets the token; `use` sets the current world.
import { CLI_COMMANDS, Values } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";
import * as Argument from "effect/cli/Argument";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { updateProfile } from "./profile.ts";

const usage = (userMessage: string) => CliError.UserError.make({ cause: null, userMessage });

/** Prints one line of text for the caller. */
export const say = (line: string) =>
  Effect.flatMap(Effect.service(Stdio.Stdio), (stdio) =>
    Effect.orDie(Stream.run(Stream.make(`${line}\n`), stdio.stdout({ endOnDone: false }))),
  );

/** The first line typed on standard input, trimmed. */
const firstLine = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio;
  const text = yield* Effect.mapError(
    stdio.stdin.pipe(
      Stream.decodeText(),
      Stream.runFold(
        () => "",
        (all: string, chunk: string) => all + chunk,
      ),
    ),
    (cause) => CliError.UserError.make({ cause, userMessage: "cannot read the token from standard input" }),
  );
  return Str.trim(Str.split(text, "\n")[0] ?? "");
});

const login = Command.make(
  "login",
  {
    account: Flag.String("account").pipe(Flag.withDescription("the account's address, what CAPXUL_PLATFORM_URL names")),
  },
  (given) =>
    Effect.gen(function* () {
      const token = yield* firstLine;
      if (token === "") return yield* usage("type the operator's token on standard input, one line");
      yield* updateProfile((profile) => ({
        account: given.account,
        token,
        ...(profile.account === given.account && profile.world !== undefined ? { world: profile.world } : {}),
      }));
      return yield* say(`Signed in to ${given.account}.`);
    }),
).pipe(Command.withDescription(CLI_COMMANDS.login));

const logout = Command.make("logout", {}, () =>
  Effect.andThen(
    updateProfile(({ token: _forgotten, ...kept }) => kept),
    say("Signed out: the token is forgotten."),
  ),
).pipe(Command.withDescription(CLI_COMMANDS.logout));

const use = Command.make(
  "use",
  { world: Argument.String("world").pipe(Argument.withDescription("the world's name")) },
  (given) =>
    Effect.gen(function* () {
      const world = yield* Effect.mapError(Schema.decodeEffect(Values.WorldName)(given.world), (cause) =>
        CliError.UserError.make({ cause, userMessage: `${given.world} is not a world's name` }),
      );
      yield* updateProfile((profile) => ({ ...profile, world }));
      yield* say(`The current world is ${world}.`);
    }),
).pipe(Command.withDescription(CLI_COMMANDS.use));

/** The command line's own commands. */
export const ownCommands = [login, logout, use] as const;
