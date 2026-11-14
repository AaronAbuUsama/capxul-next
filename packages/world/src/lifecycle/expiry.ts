// The pure decisions about a world's life: when it expires, and what its record in the shared state says about it
// at a given moment. Nothing here touches the outside world; the unit tests cover it.
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

/** What a world writes to the shared state about itself. Other outputs are ignored. */
export const Recorded = Schema.Struct({
  owner: Schema.optionalKey(Schema.String),
  expiresAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
  forkedFrom: Schema.optionalKey(Schema.String),
  /**
   * "creating" from the moment a world is claimed until its deploy has ended; "parked" for a world kept after a failure;
   * "unsite failed" or "destroy failed" for the remains of a take-down that did not finish (src/lifecycle/world.ts).
   */
  status: Schema.optionalKey(Schema.String),
});

export type Finding =
  | {
      readonly kind: "expired" | "live";
      readonly owner: string | null;
      readonly expiresAt: string;
      readonly status: string | null;
    }
  | { readonly kind: "no-expiry"; readonly owner: string | null }
  | { readonly kind: "unreadable"; readonly detail: string };

/** The moment a world created at `now` with this lifetime expires, as RFC 3339. */
export const expiryOf = (now: DateTime.Utc, lifetime: Duration.Duration): string =>
  DateTime.formatIso(DateTime.addDuration(now, lifetime));

/** Whether a lifetime is one a world may have: more than nothing, and no longer than the most allowed. */
export const lifetimeAllowed = (lifetime: Duration.Duration, most: Duration.Duration): boolean =>
  Duration.isGreaterThan(lifetime, Duration.zero) && Duration.isLessThanOrEqualTo(lifetime, most);

/** A stage's outputs are whatever its deploy recorded: nothing about their type is known before they are read. */
const decodeRecorded: (output: unknown) => Effect.Effect<typeof Recorded.Type, Schema.SchemaError> =
  Schema.decodeUnknownEffect(Recorded);

/** Decides what a stage's recorded outputs say about it at `now`. A stage with no outputs at all recorded no expiry. */
export const classify = (now: DateTime.Utc, output: unknown): Effect.Effect<Finding> =>
  decodeRecorded(output ?? {}).pipe(
    Effect.match({
      onFailure: (error): Finding => ({ kind: "unreadable", detail: Str.slice(0, 300)(error.message) }),
      onSuccess: (recorded): Finding => {
        const owner = recorded.owner ?? null;
        if (recorded.expiresAt === undefined) return { kind: "no-expiry", owner };
        const expired = DateTime.isLessThanOrEqualTo(recorded.expiresAt, now);
        return {
          kind: expired ? "expired" : "live",
          owner,
          expiresAt: DateTime.formatIso(recorded.expiresAt),
          status: recorded.status ?? null,
        };
      },
    }),
  );

export const Verdict = Schema.Literals([
  "destroyed",
  "destroy failed",
  "expired, would be destroyed",
  "kept: not expired",
  "kept: no expiry recorded",
  "kept: expiry unreadable",
]);
export type Verdict = typeof Verdict.Type;

/** What the sweeper does about a finding. It never deletes a world whose expiry it cannot read. */
export const decide = (
  finding: Finding,
  dryRun: boolean,
): "destroy" | Exclude<Verdict, "destroyed" | "destroy failed"> => {
  switch (finding.kind) {
    case "unreadable":
      return "kept: expiry unreadable";
    case "no-expiry":
      return "kept: no expiry recorded";
    case "live":
      return "kept: not expired";
    default:
      return dryRun ? "expired, would be destroyed" : "destroy";
  }
};

/**
 * Which image repositories nothing accounts for any more. The shared repositories belong to the platform, so they
 * are leftovers once the platform is gone; a repository named for one world is a leftover once that world is gone.
 */
export const leftoverRepositories = (
  repositories: ReadonlyArray<string>,
  stages: ReadonlyArray<string>,
  names: { readonly prefix: string; readonly shared: ReadonlyArray<string>; readonly platform: string },
): ReadonlyArray<string> =>
  Arr.filter(repositories, (repository) => {
    if (!Str.startsWith(names.prefix)(repository)) return false;
    if (Arr.contains(names.shared, repository)) return !Arr.contains(stages, names.platform);
    return !Arr.some(stages, (stage) => pipe(repository, Str.startsWith(`${names.prefix}${stage}-`)));
  });
