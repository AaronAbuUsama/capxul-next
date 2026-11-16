// The one Capxul command line, derived from the blueprint (roadmap item 3.9): every operation is a command at
// `capxul <thing> <verb>`, as the blueprint's `commands` table names it (`doc.create` is `capxul document create`),
// its flags its payload's fields and the `CLI_FLAGS` its kind of command reserves. Each command finds where its call
// goes (target.ts), calls it through the SDK and prints the SDK's answer: a readable view on a terminal, one line of
// JSON otherwise or with `--json`. The command line's own commands (`login`, `logout`, `use`) stand beside them.
// Nothing here names an operation.
import { commands, Errors, servedBy, type CallOptions, type OperationName } from "@capxul/blueprint";
import * as Sdk from "@capxul/sdk";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import type * as Path from "effect/Path";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import type * as HttpClient from "effect/http/HttpClient";
import { fieldsOf, payloadOf, RESERVED, type Given } from "./input.ts";
import { answerLine, type Answer } from "./output.ts";
import { readProfile } from "./profile.ts";
import { ownCommands, say } from "./sign-in.ts";
import { account, accountForWorld, ownWorld, reachingLayer } from "./target.ts";
import { answerView } from "./view.ts";

/** What a command fails with after printing its answer: the refusal, or input it could not use. */
export type Failure = Sdk.Refusal<OperationName> | CliError.UserError;

/** What a command needs from the process: its disk (the `--input` file, the profile), an HTTP client, its stdio. */
export type Services = FileSystem.FileSystem | Path.Path | HttpClient.HttpClient | Stdio.Stdio;

export type CapxulCommand = Command.Command<string, never, {}, Failure, Services>;

/** Prints the answer: one line of JSON with `--json` or when standard output is not a terminal, else its view. */
const print = (answer: Answer, json: boolean) =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    const readable = !json && (yield* stdio.stdoutIsTerminal);
    yield* say(readable ? yield* answerView(answer) : yield* answerLine(answer));
  });

/**
 * The payload's fields the profile fills: on an account's command, its `world` field, when it is left out, is the
 * world `capxul use` set. The profile is read only then.
 */
const fillFor = (name: OperationName) => (missing: ReadonlyArray<string>) =>
  servedBy(name) === "platform" && missing.includes(RESERVED.world)
    ? Effect.map(readProfile, (profile): Record<string, unknown> =>
        profile.world === undefined ? {} : { [RESERVED.world]: profile.world },
      )
    : Effect.succeed({});

/** The call, through the SDK, to where it goes: the account, or the world `--world`, the environment or `use` names. */
const callThrough = (name: OperationName, payload: unknown, options: CallOptions, world: Option.Option<string>) =>
  Effect.gen(function* () {
    const platform = servedBy(name) === "platform";
    const signed = platform ? yield* account : yield* accountForWorld(options);
    const own = platform ? null : yield* ownWorld(world, options);
    return yield* Effect.flatMap(Sdk.make, (client) => Sdk.callByName(client, name, payload, options)).pipe(
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- a command is the entry point of its one call: where it goes is known only once its flags, the environment and the profile are read.
      Effect.provide(reachingLayer(signed, own)),
    );
  });

const isUserError = Schema.is(CliError.UserError);

interface Chosen {
  readonly json: boolean;
  readonly world: Option.Option<string>;
}

/** Runs one operation: decodes its payload, calls it, prints the answer, and fails with a refusal after printing it. */
const answer = (name: OperationName, given: Given, options: CallOptions, chosen: Chosen) =>
  Effect.gen(function* () {
    const payload = yield* payloadOf(name, given, fillFor(name));
    const exit = yield* Effect.exit(callThrough(name, payload, options, chosen.world));
    if (Exit.isSuccess(exit))
      return yield* print({ operation: name, outcome: "success", success: exit.value }, chosen.json);
    const refusal = Cause.findErrorOption(exit.cause);
    if (Option.isNone(refusal) || isUserError(refusal.value)) return yield* exit;
    yield* print({ operation: name, outcome: "refusal", refusal: refusal.value }, chosen.json);
    return yield* refusal.value;
  });

const fieldFlags = (name: OperationName) =>
  Rec.fromEntries(
    Arr.map(fieldsOf(name), (field) => [
      field.field,
      Flag.String(field.flag).pipe(Flag.withDescription(`the payload's ${field.field}`), Flag.optional),
    ]),
  );

const inputFlag = Flag.String(RESERVED.input).pipe(
  Flag.withDescription("a JSON file of the payload's fields; a field's own flag overrides it"),
  Flag.optional,
);

const jsonFlag = Flag.Boolean(RESERVED.json).pipe(
  Flag.withDescription("print the answer as one line of JSON, even on a terminal"),
  Flag.withDefault(false),
);

const worldFlag = Flag.String(RESERVED.world).pipe(
  Flag.withDescription("the world to call, by its name; left out, the world capxul use set"),
  Flag.optional,
);

const asFlag = Flag.String(RESERVED.as).pipe(
  Flag.withDescription("the person of the world's cast the call acts as; left out, the world's owner"),
  Flag.optional,
);

const operatorFlag = Flag.Literals(RESERVED.operator, ["first", "second"]).pipe(
  Flag.withDescription("the operator whose token signs the call; left out, the first"),
  Flag.optional,
);

/** Hidden: another world's endpoint, as world.show answers it. Only `callVia` gives it (`CallOptions.at`). */
const atFlag = Flag.String(RESERVED.at).pipe(Flag.withHidden, Flag.optional);

/** The call's options from the flags given: only those given. */
const optionsOf = (given: {
  readonly as?: Option.Option<string>;
  readonly operator: Option.Option<"first" | "second">;
  readonly at?: Option.Option<string>;
}): CallOptions => ({
  ...Option.match(given.as ?? Option.none(), { onNone: () => ({}), onSome: (as) => ({ as }) }),
  ...Option.match(given.operator, { onNone: () => ({}), onSome: (operator) => ({ operator }) }),
  ...Option.match(given.at ?? Option.none(), { onNone: () => ({}), onSome: (at) => ({ at }) }),
});

/** The command of one operation, named by its verb under its thing. */
const leaf = (name: OperationName): CapxulCommand => {
  const [, verb] = commands[name];
  const described = Command.withDescription(`${name}: served by the ${servedBy(name)}`);
  if (servedBy(name) === "platform")
    return Command.make(
      verb,
      { input: inputFlag, operator: operatorFlag, json: jsonFlag, fields: fieldFlags(name) },
      (given) => answer(name, given, optionsOf(given), { json: given.json, world: Option.none() }),
    ).pipe(described);
  return Command.make(
    verb,
    {
      input: inputFlag,
      world: worldFlag,
      as: asFlag,
      operator: operatorFlag,
      json: jsonFlag,
      at: atFlag,
      fields: fieldFlags(name),
    },
    (given) => answer(name, given, optionsOf(given), { json: given.json, world: given.world }),
  ).pipe(described);
};

/** One command per thing, its operations' verbs beneath it, in the order of their names. */
const things = Arr.map(
  Rec.toEntries(Arr.groupBy(Arr.sort(Sdk.names, Order.String), (name) => commands[name][0])),
  ([thing, names]): CapxulCommand =>
    Command.make(thing).pipe(
      Command.withDescription(Arr.join(names, ", ")),
      Command.withSubcommands(Arr.map(names, leaf)),
    ),
);

/** The command line's version, shown by `--version`. */
export const VERSION = "0.0.0";

/** The root command, `capxul`, with one command per blueprint operation beneath it. */
export const capxul = Command.make("capxul").pipe(
  Command.withDescription("Capxul's command line: every blueprint operation, through the SDK, and signing in"),
  Command.withSubcommands([...things, ...ownCommands]),
);

const isRefusalTag = (tag: string): tag is Errors.RefusalTag => tag in Errors.exitCode;

/** The exit code for what a command failed with: the blueprint's code for a refusal, 1 for anything else. */
export const exitCodeOf = (error: unknown): number =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  typeof error._tag === "string" &&
  isRefusalTag(error._tag)
    ? Errors.exitCode[error._tag]
    : 1;
