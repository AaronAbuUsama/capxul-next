// The command line's own commands, beside the operations' (the blueprint's `CLI_COMMANDS`; roadmap item 3.9): none
// of them is an operation of Capxul, and none calls anything. `login` keeps the account's address and the operator's
// token in the profile (profile.ts), reading the token as one line from standard input so it never sits in a shell's
// history, and prints neither: on a terminal it asks for the token on standard error and reads the keys typed with
// echo off (Effect's Terminal reads them in raw mode); piped, it reads the first line. `logout` forgets the token;
// `use` sets the current world.
import { CLI_COMMANDS, Values } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";
import * as Terminal from "effect/Terminal";
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

/** The first line piped on standard input, trimmed: it stops at the first newline. */
const pipedLine = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio;
  const text = yield* Effect.mapError(
    stdio.stdin.pipe(
      Stream.decodeText(),
      Stream.takeUntil((chunk: string) => Str.includes("\n")(chunk)),
      Stream.runFold(
        () => "",
        (all: string, chunk: string) => all + chunk,
      ),
    ),
    (cause) => CliError.UserError.make({ cause, userMessage: "cannot read the token from standard input" }),
  );
  return Str.trim(Str.split(text, "\n")[0] ?? "");
});

/** Writes `text` to standard error, never to standard output, which holds only answers. */
const ask = (text: string) =>
  Effect.flatMap(Effect.service(Stdio.Stdio), (stdio) =>
    Effect.orDie(Stream.run(Stream.make(text), stdio.stderr({ endOnDone: false }))),
  );

const ENTER = ["return", "enter"];

/** The keys typed until Enter, in raw mode so nothing is echoed. Ctrl-C or the end of input gives up. */
const typedLine = Effect.scoped(
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    const keys = yield* terminal.readInput;
    const next = (typed: string): Effect.Effect<string, CliError.UserError> =>
      Effect.flatMap(
        Effect.mapError(Queue.take(keys), (cause) =>
          CliError.UserError.make({ cause, userMessage: "the token was not typed" }),
        ),
        (event) =>
          event.key.ctrl && event.key.name === "c"
            ? Effect.fail(CliError.UserError.make({ cause: null, userMessage: "login cancelled" }))
            : ENTER.includes(event.key.name)
              ? Effect.succeed(typed)
              : event.key.name === "backspace"
                ? next(Str.slice(0, -1)(typed))
                : next(typed + Option.getOrElse(event.input, () => "")),
      );
    return Str.trim(yield* next(""));
  }),
);

/** The operator's token: asked for and typed on a terminal, else the first line piped in. */
const tokenTyped = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio;
  if (!(yield* stdio.stdinIsTerminal)) return yield* pipedLine;
  yield* ask("The operator's token (not shown): ");
  const token = yield* typedLine;
  yield* ask("\n");
  return token;
});

/** An account's address: http or https, with a host. */
const isAccountUrl = (text: string) => /^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/.test(text);

const login = Command.make(
  "login",
  {
    account: Flag.String("account").pipe(Flag.withDescription("the account's address, what CAPXUL_PLATFORM_URL names")),
  },
  (given) =>
    Effect.gen(function* () {
      if (!isAccountUrl(given.account))
        return yield* usage(`--account ${given.account} is not an account's address: give its http or https URL`);
      const token = yield* tokenTyped;
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
