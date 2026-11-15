// The refusal of the contract about the server itself. Declared once, here; ../errors.ts gathers it.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../errors.ts";

/**
 * The server serves this operation but does not do it yet: its handler is empty (decisions.md, entry 33). Every
 * operation declares it, so a Core with empty handlers answers each call with a typed refusal rather than a defect,
 * and a scenario run against it fails on its own expectations. `operation` is the operation's name.
 */
export class NotImplemented extends Schema.TaggedError<NotImplemented, { readonly brand: unique symbol }>()(
  "NotImplemented",
  {
    operation: Schema.String,
  },
) {}

export const refusals = { NotImplemented } as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = { NotImplemented: 6 };
