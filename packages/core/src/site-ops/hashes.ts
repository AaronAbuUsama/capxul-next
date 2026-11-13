// The hash doc.create answered for each document it made, kept in the world's database (`app.documents`,
// migrations/0002_site_ops.sql): a payment held for the document names this hash (blueprint decisions.md, 28).
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export interface Document {
  readonly org: string;
  readonly doctype: string;
  readonly name: string;
}

export class DocumentHashes extends Context.Service<
  DocumentHashes,
  {
    readonly keep: (document: Document, hash: string, trace: string) => Effect.Effect<void>;
    readonly of: (document: Document) => Effect.Effect<Option.Option<string>>;
  }
>()("@capxul/core/site-ops/hashes/DocumentHashes") {}

const Row = Schema.Struct({ hash: Schema.String });

export const SqlDocumentHashes = Layer.effect(
  DocumentHashes,
  Effect.map(Effect.service(SqlClient.SqlClient), (sql) =>
    DocumentHashes.of({
      keep: ({ org, doctype, name }, hash, trace) =>
        sql`insert into app.documents (org, doctype, name, hash, trace_id) values (${org}, ${doctype}, ${name}, ${hash}, ${trace})
            on conflict (org, doctype, name) do update set hash = excluded.hash, trace_id = excluded.trace_id`.pipe(
          Effect.asVoid,
          Effect.orDie,
        ),
      of: ({ org, doctype, name }) =>
        sql`select hash from app.documents where org = ${org} and doctype = ${doctype} and name = ${name}`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))),
          Effect.map((rows) => Option.map(Arr.head(rows), (row) => row.hash)),
          Effect.orDie,
        ),
    }),
  ),
);

const keyOf = ({ org, doctype, name }: Document) => `${org}\u0000${doctype}\u0000${name}`;

/** The hashes in memory: for a test. */
export const memoryDocumentHashes = Layer.effect(
  DocumentHashes,
  Effect.map(Ref.make<ReadonlyMap<string, string>>(new Map()), (ref) =>
    DocumentHashes.of({
      keep: (document, hash) => Ref.update(ref, (kept) => new Map([...kept, [keyOf(document), hash]])),
      of: (document) => Effect.map(Ref.get(ref), (kept) => Option.fromNullishOr(kept.get(keyOf(document)))),
    }),
  ),
);
