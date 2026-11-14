// The refusals of the contract about who is calling, which every domain shares, and the one refusal no operation
// declares: a payload its operation's schema rejects. Each is declared once, here; ../errors.ts gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../errors.ts";
import { OperatorName, WorldName } from "../values.ts";

/** No caller could be established: no credential, or one this world or the platform does not know. */
export class NotSignedIn extends Schema.TaggedError<NotSignedIn, { readonly brand: unique symbol }>()("NotSignedIn", {
  reason: Schema.Literals(["no_credential", "unknown_caller"]),
}) {}

/** Only the world's owner may do this; the caller is someone else (another operator, or a person of the world). */
export class NotWorldOwner extends Schema.TaggedError<NotWorldOwner, { readonly brand: unique symbol }>()(
  "NotWorldOwner",
  {
    world: WorldName,
    owner: OperatorName,
  },
) {}

/**
 * The payload is not of its operation's schema (a hyphen too many, a negative duration, a bio of 281 characters),
 * so the caller's own client refused to send it (decisions.md, 43). Nothing reached a door: no handler ran, no span
 * was kept and nothing was recorded. `operation` is the operation's name and `issue` what the schema found.
 */
export class PayloadRejected extends Schema.TaggedError<PayloadRejected, { readonly brand: unique symbol }>()(
  "PayloadRejected",
  {
    operation: Schema.String,
    issue: Schema.String,
  },
) {}

export const refusals = { NotSignedIn, NotWorldOwner, PayloadRejected } as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  NotSignedIn: 3,
  NotWorldOwner: 4,
  PayloadRejected: 2,
};
