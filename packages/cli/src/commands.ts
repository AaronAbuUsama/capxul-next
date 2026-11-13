// The one Capxul command line, derived from the blueprint: every operation is a command, its path the operation's
// name split at its dots (`world.snapshot.save` is `capxul world snapshot save`), its flags its payload's fields.
// Each command calls Core through the SDK and prints the SDK's answer; nothing here names an operation.
import { Errors, servedBy, type OperationName } from "@capxul/blueprint";
import * as Sdk from "@capxul/sdk";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import type * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as FileSystem from "effect/FileSystem";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import type * as HttpClient from "effect/http/HttpClient";
import { fieldsOf, payloadOf, RESERVED, type Given } from "./input.ts";
import { answerLine, type Answer } from "./output.ts";

/** What a command fails with after printing its answer: the refusal, or input it could not use. */
export type Failure = Sdk.Refusal<OperationName> | CliError.UserError;

/** What a command needs from the process: the `--input` file's disk and an HTTP client for the SDK. */
export type Services = FileSystem.FileSystem | HttpClient.HttpClient | Stdio.Stdio;

export type CapxulCommand = Command.Command<string, never, {}, Failure, Services>;

const print = (answer: Answer) =>
  Effect.flatMap(answerLine(answer), (line) =>
    Effect.flatMap(Effect.service(Stdio.Stdio), (stdio) =>
      Effect.orDie(Stream.run(Stream.make(`${line}\n`), stdio.stdout({ endOnDone: false }))),
    ),
  );

const unconfigured = (variables: string) => (error: Config.ConfigError) =>
  CliError.UserError.make({ cause: error, userMessage: `set ${variables}: ${error.message}` });

/** The call, through the SDK, to the door that serves it: its address and credential from Config. */
const callThrough = (name: OperationName, payload: unknown, as: Option.Option<string>) => {
  const options: Sdk.CallOptions = Option.match(as, { onNone: () => ({}), onSome: (person) => ({ as: person }) });
  if (Sdk.isPlatformName(name))
    return Effect.flatMap(Sdk.platformClient, (client) => Sdk.callByName(client, name, payload, options)).pipe(
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- a command is the entry point of its one call: it reads only its own door's Config, so a command for the other door runs without it.
      Effect.provide(Sdk.platformDoorFromConfig),
      Effect.catchTag("ConfigError", (error) =>
        Effect.fail(unconfigured("CAPXUL_PLATFORM_URL and CAPXUL_PLATFORM_TOKEN")(error)),
      ),
    );
  if (Sdk.isWorldName(name))
    return Effect.flatMap(Sdk.worldClient, (client) => Sdk.callByName(client, name, payload, options)).pipe(
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- as above, for a world's door.
      Effect.provide(Sdk.worldDoorFromConfig),
      Effect.catchTag("ConfigError", (error) =>
        Effect.fail(unconfigured("CAPXUL_DOOR_URL and CAPXUL_DOOR_TOKEN")(error)),
      ),
    );
  return Effect.die(`${String(name)} is served by neither of the blueprint's groups`);
};

const isUserError = Schema.is(CliError.UserError);

/** Runs one operation: decodes its payload, calls it, prints the answer, and fails with a refusal after printing it. */
const answer = (name: OperationName, given: Given, as: Option.Option<string>) =>
  Effect.gen(function* () {
    const payload = yield* payloadOf(name, given);
    const exit = yield* Effect.exit(callThrough(name, payload, as));
    if (Exit.isSuccess(exit)) return yield* print({ operation: name, outcome: "success", success: exit.value });
    const refusal = Cause.findErrorOption(exit.cause);
    if (Option.isNone(refusal) || isUserError(refusal.value)) return yield* exit;
    yield* print({ operation: name, outcome: "refusal", refusal: refusal.value });
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

const asFlag = Flag.String(RESERVED.as).pipe(
  Flag.withDescription("the person of the world's cast the call acts as; left out, the world's owner"),
  Flag.optional,
);

/** The command of one operation, named `segment` under its parent. */
const leaf = (segment: string, name: OperationName): CapxulCommand => {
  const described = Command.withDescription(`${name}: served by the ${servedBy(name)}`);
  if (servedBy(name) === "platform")
    return Command.make(segment, { input: inputFlag, fields: fieldFlags(name) }, (given) =>
      answer(name, given, Option.none()),
    ).pipe(described);
  return Command.make(segment, { input: inputFlag, as: asFlag, fields: fieldFlags(name) }, (given) =>
    answer(name, given, given.as),
  ).pipe(described);
};

interface Node {
  readonly segment: string;
  readonly operation: Option.Option<OperationName>;
  readonly children: ReadonlyArray<Node>;
}

interface Entry {
  readonly path: ReadonlyArray<string>;
  readonly name: OperationName;
}

const nodesOf = (entries: ReadonlyArray<Entry>): ReadonlyArray<Node> =>
  pipe(
    Arr.groupBy(entries, (entry) => entry.path[0] ?? ""),
    Rec.toEntries,
    Arr.map(([segment, group]) => ({
      segment,
      operation: Option.map(
        Arr.findFirst(group, (entry) => entry.path.length === 1),
        (entry) => entry.name,
      ),
      children: nodesOf(
        Arr.flatMap(group, (entry): ReadonlyArray<Entry> =>
          entry.path.length > 1 ? [{ path: Arr.drop(entry.path, 1), name: entry.name }] : [],
        ),
      ),
    })),
  );

const beneath = (node: Node): ReadonlyArray<OperationName> => [
  ...Option.toArray(node.operation),
  ...Arr.flatMap(node.children, beneath),
];

const commandOf = (node: Node): CapxulCommand => {
  const children = Arr.map(node.children, commandOf);
  const own = Option.match(node.operation, {
    onNone: (): CapxulCommand =>
      Command.make(node.segment).pipe(Command.withDescription(Arr.join(beneath(node), ", "))),
    onSome: (name) => leaf(node.segment, name),
  });
  return Arr.isArrayNonEmpty(children) ? Command.withSubcommands(own, children) : own;
};

/** The root command, `capxul`, with one command per blueprint operation beneath it. */
export const capxul = Command.make("capxul").pipe(
  Command.withDescription("Capxul's command line: every blueprint operation, through the SDK"),
  Command.withSubcommands(
    Arr.map(nodesOf(Arr.map(Sdk.names, (name) => ({ path: Str.split(name, "."), name }))), commandOf),
  ),
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
