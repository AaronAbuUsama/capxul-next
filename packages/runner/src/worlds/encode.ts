// How a starting world's maker keeps an answer as a fact: encoded as the blueprint's own schema of the operation encodes
// it (packages/blueprint/docs/decisions.md, entry 38), so `given` decodes it with the same schema.
import { operations } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { RunnerFailure } from "../failure.ts";

type Codec = Schema.Codec<unknown, unknown>;
export const schemasOf = (name: keyof typeof operations) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an operation's schemas need no services: they are the blueprint's plain Schemas, which Rpc's generic type leaves open.
  operations[name].rpc as unknown as {
    readonly payloadSchema: Codec;
    readonly successSchema: Codec;
    readonly errorSchema: Codec;
  };

export const encoded = (schema: Codec, value: unknown) =>
  Schema.encodeUnknownEffect(Schema.toCodecJson(schema))(value).pipe(
    Effect.mapError((error) => RunnerFailure.make({ step: "starting world", message: error.message })),
  );

/** An answer of `operation`, encoded as the blueprint encodes it: what a fact holds. */
export const encodeAnswer = (operation: keyof typeof operations, answer: unknown) =>
  encoded(schemasOf(operation).successSchema, answer);
