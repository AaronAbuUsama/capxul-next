// Who a person of the world is on a company's site: their site user, the cast's email for them (the blueprint's
// `CastMember.email`). The cast is the world's (world.create, roadmap step 1.12); Core reads it from the world's
// database, `app.cast (person, email)`, which the world writes when it makes its cast. A world without that table
// has no cast yet: the read dies, naming it, rather than answering that nobody has a site user.
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export class Cast extends Context.Service<
  Cast,
  {
    /** The email of `person`'s site user; none for a name the cast does not hold. */
    readonly emailOf: (person: string) => Effect.Effect<Option.Option<string>>;
  }
>()("@capxul/core/site-ops/cast") {}

const Row = Schema.Struct({ email: Schema.String });

export const SqlCast = Layer.effect(
  Cast,
  Effect.map(Effect.service(SqlClient.SqlClient), (sql) =>
    Cast.of({
      emailOf: (person) =>
        sql`select email from app.cast where person = ${person}`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))),
          Effect.mapBoth({
            onSuccess: (rows) => Option.map(Arr.head(rows), (row) => row.email),
            onFailure: (error) => `the world's cast (app.cast) could not be read: ${error.message}`,
          }),
          Effect.orDie,
        ),
    }),
  ),
);

/** A cast of `emails` by person: for a test. */
export const memoryCast = (emails: Readonly<Record<string, string>>) =>
  Layer.succeed(Cast, Cast.of({ emailOf: (person) => Effect.succeed(Option.fromNullishOr(emails[person])) }));
