// The one refusal no operation declares: a payload its operation's schema rejects. Declared once, here;
// ../errors.ts gathers it.
import * as Schema from "effect/Schema";

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
