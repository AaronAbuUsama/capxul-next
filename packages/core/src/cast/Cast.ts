// A world's cast as Core's operations read it: each person's email, the address that signs for them and their claimed
// personal Safe (packages/blueprint/docs/decisions.md, entry 25). The world writes it when it is made (`app.cast`, the
// world's migration); Core only reads it. A test hands its own.
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import type { Values } from "@capxul/blueprint";

export type CastMember = typeof Values.CastMember.Type;

interface Row {
  readonly person: string;
  readonly email: string;
  readonly signer: string;
  readonly safe: string | null;
}

export class Cast extends Context.Service<
  Cast,
  {
    /** The person of the cast by that name, if there is one. */
    readonly find: (person: string) => Effect.Effect<Option.Option<CastMember>>;
    /** The person of the cast who signs in with that email, if there is one. */
    readonly withEmail: (email: string) => Effect.Effect<Option.Option<CastMember>>;
    /** Every person of the cast, in the cast's order. */
    readonly everyone: Effect.Effect<ReadonlyArray<CastMember>>;
  }
>()("@capxul/core/cast/Cast") {
  /** The cast the world wrote into its database. */
  static readonly fromDatabase = Layer.effect(
    Cast,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return Cast.of({
        find: (person) =>
          sql<Row>`select person, email, signer, safe from app.cast where person = ${person}`.pipe(
            Effect.map(Arr.head),
            Effect.orDie,
          ),
        withEmail: (email) =>
          sql<Row>`select person, email, signer, safe from app.cast where email = ${email} order by position limit 1`.pipe(
            Effect.map(Arr.head),
            Effect.orDie,
          ),
        everyone: sql<Row>`select person, email, signer, safe from app.cast order by position`.pipe(Effect.orDie),
      });
    }),
  );

  /** A cast handed in whole, for a test. */
  static readonly listed = (members: ReadonlyArray<CastMember>) =>
    Layer.succeed(
      Cast,
      Cast.of({
        find: (person) => Effect.succeed(Arr.findFirst(members, (each) => each.person === person)),
        withEmail: (email) => Effect.succeed(Arr.findFirst(members, (each) => each.email === email)),
        everyone: Effect.succeed(members),
      }),
    );
}
