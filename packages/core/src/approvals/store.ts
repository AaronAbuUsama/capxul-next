// The approvals an operation opened and the subjects they authorise (migrations/0005_approvals.sql). Every write is
// made inside the caller's transaction. What a subject is, once sent, is its transaction and its block.
import { Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as PgClient from "@effect/sql-pg/PgClient";
import { Prepared } from "../chain/userop.ts";

export type Approval = typeof Values.Approval.Type;
export type Subject = typeof Values.Subject.Type;

const Uint = Schema.String.check(Schema.isPattern(/^\d+$/));
const Hex = Schema.String.check(Schema.isPattern(/^0x[0-9a-fA-F]*$/));

/** A company Safe's transaction, kept until its Directors have signed it. */
export const CompanyTransaction = Schema.Struct({
  safe: Hex,
  to: Hex,
  data: Hex,
  operation: Schema.Literals([0, 1]),
  nonce: Uint,
});

/**
 * How a subject reaches the chain: `operation`, a UserOperation of the signer's own Safe, prepared when it was opened
 * (its digest is what `needs` signs); `company`, a company Safe's transaction, signed by its Directors' Safes and
 * carried by the relayer.
 */
export const Landing = Schema.Union([
  Schema.Struct({ via: Schema.Literal("operation"), operation: Prepared }),
  Schema.Struct({ via: Schema.Literal("company"), tx: CompanyTransaction }),
]);
export type Landing = typeof Landing.Type;

/** One subject as opened: its approvals, how many must sign, whose signature must be among them, how it lands. */
export interface Opening {
  readonly subject: Subject;
  readonly org: string | null;
  readonly threshold: number;
  readonly needs: string | null;
  readonly landing: Landing;
  /** What sending it spends of the test USDC, in its smallest unit: checked before it is sent. */
  readonly spends: { readonly safe: string; readonly amount: bigint } | null;
  /** What its landing must tell the company's site, as JSON values. */
  readonly about: Readonly<Record<string, string>> | null;
  readonly approvals: ReadonlyArray<Approval & { readonly signerSafe: string | null }>;
}

/** Writes a subject and its approvals. */
export const open = Effect.fn("approvals.open")(function* (opening: Opening) {
  const sql = yield* PgClient.PgClient;
  const landing = yield* Schema.encodeEffect(Schema.toCodecJson(Landing))(opening.landing).pipe(Effect.orDie);
  yield* sql`insert into app.subjects ${sql.insert({
    kind: opening.subject.kind,
    id: opening.subject.id,
    org: opening.org,
    threshold: opening.threshold,
    needs: opening.needs,
    landing: sql.json(landing),
    spends: opening.spends === null ? null : sql.json({ safe: opening.spends.safe, amount: opening.spends.amount.toString() }),
    about: opening.about === null ? null : sql.json(opening.about),
    state: "open",
  })}`;
  const rows = Arr.map(opening.approvals, (approval, position) => ({
    approval: approval.id,
    subject_kind: opening.subject.kind,
    subject_id: opening.subject.id,
    position,
    signer: approval.signer,
    signer_address: approval.signerAddress,
    signer_safe: approval.signerSafe,
    digest: approval.digest,
    expires_at: approval.expiresAt,
  }));
  yield* Effect.forEach(rows, (row) => sql`insert into app.approvals ${sql.insert(row)}`, { discard: true });
});

interface ApprovalRow {
  readonly approval: string;
  readonly subject_kind: string;
  readonly subject_id: string;
  readonly signer: string;
  readonly signer_address: string;
  readonly signer_safe: string | null;
  readonly digest: string;
  readonly expires_at: string;
  readonly signature: string | null;
}

interface SubjectRow {
  readonly kind: string;
  readonly id: string;
  readonly org: string | null;
  readonly threshold: number;
  readonly needs: string | null;
  readonly landing: unknown;
  readonly spends: { readonly safe: string; readonly amount: string } | null;
  readonly about: Readonly<Record<string, string>> | null;
  readonly state: string;
  readonly tx: string | null;
  readonly block: string | null;
}

/** An approval's row and its subject's, if the approval exists. */
export const find = Effect.fn("approvals.find")(function* (approval: string) {
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<ApprovalRow>`select * from app.approvals where approval = ${approval}`;
  const row = Arr.head(rows);
  if (Option.isNone(row)) return Option.none();
  const subject = yield* subjectOf(row.value.subject_kind, row.value.subject_id);
  return Option.some({ approval: row.value, subject });
});

/** A subject's row and how it lands, locked for the rest of the transaction. */
export const subjectOf = Effect.fn("approvals.subject")(function* (kind: string, id: string) {
  const sql = yield* PgClient.PgClient;
  const [row] = yield* sql<SubjectRow>`select * from app.subjects where kind = ${kind} and id = ${id} for update`;
  if (row === undefined) return yield* Effect.die(`approvals of ${kind} ${id} whose subject is gone`);
  const landing = yield* Schema.decodeUnknownEffect(Landing)(row.landing).pipe(Effect.orDie);
  const subject = yield* Schema.decodeUnknownEffect(Values.Subject)({ kind: row.kind, id: row.id }).pipe(Effect.orDie);
  return { ...row, landing, subject };
});

/** Every approval of a subject, in the order they were opened. */
export const approvalsOf = Effect.fn("approvals.of")(function* (kind: string, id: string) {
  const sql = yield* PgClient.PgClient;
  return yield* sql<ApprovalRow>`
    select * from app.approvals where subject_kind = ${kind} and subject_id = ${id} order by position`;
});

/** Keeps a signature. */
export const keep = Effect.fn("approvals.keep")(function* (approval: string, signature: string) {
  const sql = yield* PgClient.PgClient;
  yield* sql`update app.approvals set signature = ${signature} where approval = ${approval}`;
});

/** Marks a subject sent, in its transaction and block. */
export const markSent = Effect.fn("approvals.sent")(function* (kind: string, id: string, tx: string, block: bigint) {
  const sql = yield* PgClient.PgClient;
  yield* sql`update app.subjects set state = 'sent', tx = ${tx}, block = ${block.toString()} where kind = ${kind} and id = ${id}`;
});

/** An approval as the blueprint answers it. */
export const viewOf = (row: ApprovalRow): Approval => ({
  id: row.approval,
  signer: row.signer,
  signerAddress: row.signer_address,
  digest: row.digest,
  expiresAt: row.expires_at,
});

export type { ApprovalRow, SubjectRow };
