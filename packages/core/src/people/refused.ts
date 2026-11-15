// Where an invitation's verb refuses: it writes the log its declaration names for that refusal (the blueprint's
// `refusals`, each to one of its `logs`), naming the rule or the state that decided, then fails with the refusal.
import * as Effect from "effect/Effect";

/** Writes `log` with `fields` where a refusal is decided, then fails with `refusal`. */
export const refuse = <E>(log: { readonly name: string }, fields: { readonly [field: string]: string }, refusal: E) =>
  Effect.logInfo(log.name).pipe(Effect.annotateLogs(fields), Effect.andThen(Effect.fail(refusal)));
