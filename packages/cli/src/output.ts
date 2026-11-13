// What a command prints: one line of JSON, the answer the SDK gave, encoded with the operation's own schemas. This
// is the command line's output edge (.oxlintrc.json, settings.capxul.jsonEdges). `readAnswer` decodes such a line
// back with the same schemas, so a test can compare it with the SDK's answer value for value.
import { Errors, operations, type OperationName } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const schemasOf = (name: OperationName) => {
  const rpc = operations[name].rpc;
  const success = Schema.Struct({
    operation: Schema.Literal(name),
    outcome: Schema.Literal("success"),
    success: Schema.toCodecJson(rpc.successSchema),
  });
  const refusal = Schema.Struct({
    operation: Schema.Literal(name),
    outcome: Schema.Literal("refusal"),
    refusal: Schema.toCodecJson(Schema.Union([rpc.errorSchema, Errors.NotSignedIn])),
  });
  return { success: Schema.fromJsonString(success), refusal: Schema.fromJsonString(refusal) };
};

/** What one call answered, as the command line prints it. */
export type Answer =
  | { readonly operation: OperationName; readonly outcome: "success"; readonly success: unknown }
  | { readonly operation: OperationName; readonly outcome: "refusal"; readonly refusal: unknown };

/**
 * The line for the operation's answer: `{"operation":…,"outcome":"success","success":…}` or
 * `{"operation":…,"outcome":"refusal","refusal":{"_tag":…,…}}`. Its fields are in the schemas' order, so the same
 * answer always prints the same line.
 */
export const answerLine = (answer: Answer): Effect.Effect<string> => {
  const schemas = schemasOf(answer.operation);
  return Effect.orDie(
    answer.outcome === "success"
      ? Schema.encodeUnknownEffect(schemas.success)(answer)
      : Schema.encodeUnknownEffect(schemas.refusal)(answer),
  );
};

/** The answer a printed line holds, decoded with the operation's own schemas. */
export const readAnswer = (name: OperationName, line: string): Effect.Effect<Answer, Schema.SchemaError> => {
  const schemas = schemasOf(name);
  return Effect.catch(Schema.decodeEffect(schemas.success)(line), () => Schema.decodeEffect(schemas.refusal)(line));
};
