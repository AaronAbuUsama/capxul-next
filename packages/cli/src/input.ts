// What a command reads, derived from its operation's payload in the blueprint: one flag per field, and `--input`,
// a JSON file holding the payload or part of it. This is the command line's input edge (.oxlintrc.json,
// settings.capxul.jsonEdges): the one place it reads JSON text, which it decodes at once with the payload's schema.
import { operations, type OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as Str from "effect/String";
import * as CliError from "effect/cli/CliError";

/** The flags every command has besides its fields' own. A payload field may not take one of these names. */
export const RESERVED = { input: "input", as: "as" } as const;

/** One field of an operation's payload and the flag that sets it. */
export interface Field {
  /** The field's name in the payload, such as `lifetimeMinutes`. */
  readonly field: string;
  /** Its flag, in kebab case, such as `lifetime-minutes`. */
  readonly flag: string;
  /** True when `value`, a JSON value, is a value of the field. */
  readonly accepts: (value: unknown) => boolean;
}

const flagOf = (field: string): string => Str.snakeToKebab(Str.camelToSnake(field));

const acceptsOf = (type: SchemaAST.AST) => {
  const decode = Schema.decodeUnknownOption(Schema.toCodecJson(Schema.make<Schema.Codec<unknown>>(type)));
  return (value: unknown) => Option.isSome(decode(value));
};

/** The fields of the operation's payload, in the order the blueprint declares them. */
export const fieldsOf = (name: OperationName): ReadonlyArray<Field> => {
  const ast = operations[name].rpc.payloadSchema.ast;
  if (!SchemaAST.isObjects(ast)) return [];
  return Arr.map(ast.propertySignatures, (signature) => ({
    field: String(signature.name),
    flag: flagOf(String(signature.name)),
    accepts: acceptsOf(signature.type),
  }));
};

const JsonText = Schema.fromJsonString(Schema.Json);

/**
 * A flag's text as its field's value. When the text is JSON (`60`, `false`, `null`, `["eli"]`, `{"mode":"frozen"}`)
 * and the field accepts that value, it is the value; otherwise the text is the value, as a string. So `--world town`
 * is the string `town`, `--lifetime-minutes 60` the number 60, and `--note null` null where a note may be null.
 */
export const valueOf = (field: Field, text: string): unknown =>
  Option.match(Schema.decodeOption(JsonText)(text), {
    onNone: () => text,
    onSome: (value) => (field.accepts(value) ? value : text),
  });

const PayloadFile = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json));

const refused = (userMessage: string) => (cause: unknown) => CliError.UserError.make({ cause, userMessage });

const readFile = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* Effect.mapError(fs.readFileString(path), refused(`cannot read --input ${path}`));
    return yield* Effect.mapError(
      Schema.decodeEffect(PayloadFile)(text),
      refused(`--input ${path} is not a JSON object of the payload's fields`),
    );
  });

/** What one command was given: the `--input` file, if any, and each field's flag, if given. */
export interface Given {
  readonly input: Option.Option<string>;
  readonly fields: { readonly [field: string]: Option.Option<string> };
}

/**
 * The operation's payload: the `--input` file's fields, then each given flag over them, decoded with the
 * operation's own payload schema. A payload that does not decode is refused here, before any call is made.
 */
export const payloadOf = (name: OperationName, given: Given) =>
  Effect.gen(function* () {
    const fromFile = yield* Option.match(given.input, {
      onNone: () => Effect.succeed<Readonly<Record<string, unknown>>>({}),
      onSome: readFile,
    });
    const fromFlags = Rec.fromEntries(
      Arr.flatMap(fieldsOf(name), (field) =>
        Option.match(Option.flatten(Rec.get(given.fields, field.field)), {
          onNone: () => [],
          onSome: (text) => [[field.field, valueOf(field, text)] as const],
        }),
      ),
    );
    const payload = Schema.toCodecJson(operations[name].rpc.payloadSchema);
    return yield* Effect.mapError(Schema.decodeUnknownEffect(payload)({ ...fromFile, ...fromFlags }), (issue) =>
      CliError.UserError.make({ cause: issue, userMessage: `${name}: ${String(issue)}` }),
    );
  });
