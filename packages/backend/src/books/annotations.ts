import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Sql } from "../platform/db.ts";
import { emit } from "../platform/outbox.ts";
import { appendFact, type Against, type DocumentRef, type MoneySide, type PartyType, type Reference } from "./facts.ts";

export type Owner = { kind: "person" | "organization"; id: string };
export type AnnotationFields = {
  account: string | null; account_number: string | null;
  party_type: PartyType | null; party_id: string | null;
  cost_center: string | null; project: string | null; references: readonly DocumentRef[];
  suggestion: string | null; memo: string | null;
};
export type WriteContext = { at: number; traceId: string; actor: { kind: "person" | "agent" | "system"; id: string } };

export async function annotation(sql: Sql, owner: Owner, reference: Reference) {
  return (await sql.query(`select * from app.book_annotations where owner_kind=$1 and owner_id=$2
    and reference_kind=$3 and reference_id=$4`, [owner.kind, owner.id, reference.kind, reference.id])).rows[0];
}

/** The caller serializes organization writes under the feed; persons have no facts/feed. */
export async function writeAnnotation(sql: Sql, owner: Owner, reference: Reference, fields: AnnotationFields, context: WriteContext, birthOnly = false) {
  if (owner.kind === "person") await sql.query("select pg_advisory_xact_lock(hashtextextended($1,1))", [JSON.stringify([owner, reference])]);
  const old = await annotation(sql, owner, reference);
  if (birthOnly && old) return old;
  const waiting = !fields.account || ["4999", "6999"].includes(fields.account_number ?? fields.account);
  const status = waiting ? "waiting" : "decided";
  const transition = old ? waiting ? "requeue" : "recategorize" : waiting ? "queue" : "assign";
  const row = { ...fields, suggestion: waiting ? fields.suggestion : null,
    owner_kind: owner.kind, owner_id: owner.id, reference_kind: reference.kind, reference_id: reference.id,
    status, last_editor_kind: context.actor.kind, last_editor_id: context.actor.id,
    created_at: old?.created_at ?? context.at, updated_at: context.at };
  const saved = (await sql.query(`insert into app.book_annotations
    select a.* from jsonb_populate_record(null::app.book_annotations,$1::jsonb) a
    on conflict (owner_kind,owner_id,reference_kind,reference_id) do update set
      account=excluded.account,account_number=excluded.account_number,party_type=excluded.party_type,
      party_id=excluded.party_id,cost_center=excluded.cost_center,project=excluded.project,
      "references"=excluded."references",suggestion=excluded.suggestion,memo=excluded.memo,status=excluded.status,
      last_editor_kind=excluded.last_editor_kind,last_editor_id=excluded.last_editor_id,updated_at=excluded.updated_at
    returning *`, [JSON.stringify(row)])).rows[0]!;
  if (owner.kind === "organization") {
    const postingFields = ["account", "party_type", "party_id", "cost_center", "project", "references"] as const;
    const changed = old ? postingFields.some((key) => !isDeepStrictEqual(old[key], row[key]))
      : !!(row.account || row.party_id || row.references.length || row.cost_center || row.project);
    if (changed) {
      const priorAssignment = await sql.query(`select 1 from app.book_facts where org_id=$1
        and reference_kind=$2 and reference_id=$3 and kind in ('account_assigned','recategorized') limit 1`,
      [owner.id, reference.kind, reference.id]);
      await appendFact(sql, owner.id, context.at, {
        kind: priorAssignment.rowCount ? "recategorized" : "account_assigned", occurred_at: context.at,
        reference_kind: reference.kind, reference_id: reference.id, account: row.account,
        from_account: old?.account ?? null, actor_kind: context.actor.kind, actor_id: context.actor.id,
      });
    }
  }
  await emit(sql, {
    id: `event_${randomUUID()}`, name: "book_annotation_transitioned", machine: "book-annotation",
    entity_id: JSON.stringify([owner.kind, owner.id, reference.kind, reference.id]),
    owner_kind: owner.kind, owner_id: owner.id, actor: context.actor.kind === "system" ? null : context.actor.id,
    trace_id: context.traceId, at: context.at,
    props: { from: old?.status ?? null, to: status, transition, owner_kind: owner.kind, owner_id: owner.id,
      reference_kind: reference.kind, reference_id: reference.id, account: row.account },
  });
  return saved;
}

/** Unchecked names from a money instruction; only the site's posting boundary may resolve them. */
export async function birthAnnotation(sql: Sql, side: MoneySide, context: { at: number; traceId: string }) {
  if (!side.against) return;
  const owner: Owner = { kind: "organization", id: side.org_id };
  const against: Against = side.against;
  const prior = against.same_as ? await annotation(sql, owner, against.same_as) : undefined;
  const account = against.account ?? prior?.account ?? null;
  await writeAnnotation(sql, owner, side.reference, {
    account, account_number: account && /^\d+$/.test(account) ? account
      : account === prior?.account ? prior.account_number : null,
    party_type: against.party?.type ?? prior?.party_type ?? null,
    party_id: against.party?.id ?? prior?.party_id ?? null,
    cost_center: against.cost_center ?? prior?.cost_center ?? null,
    project: against.project ?? prior?.project ?? null, references: against.references ?? prior?.references ?? [],
    suggestion: against.suggestion ?? null, memo: null,
  }, { ...context, actor: { kind: side.actor.kind, id: side.actor.id ?? "system" } }, true);
}
