import { readFileSync } from "node:fs";
import { keccak256, toBytes, type Hex } from "viem";
import type { Sql } from "../platform/db.ts";
import { newId } from "../platform/id.ts";
import { canonical, documentHash, encode, receiptBytes, type StoreInput } from "./codec.ts";
export type { StoreInput, Content, Participant } from "./codec.ts";

export async function migrateDocuments(sql: Sql) {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}

/** No transaction starts or commits here: document and subject are one money fact. */
export async function store(sql: Sql, input: StoreInput, worldNow: (sql: Sql) => Promise<number>) {
  const encoded = encode(input);
  const at = await worldNow(sql);
  for (const p of encoded.participants) {
    if (p.party_id !== null) {
      const party = (await sql.query("select safe_address from app.parties where party_id=$1 and state<>'released'", [p.party_id])).rows[0];
      if (!party || party.safe_address !== p.safe) throw new Error("INVALID_INPUT: participant Party Safe");
    }
  }
  const row = { ...encoded, bytes: undefined, document_id: newId("doc", at),
    owner_id: input.owner_id, owner_kind: input.owner_kind, chain_id: input.chain_id,
    subject_kind: input.subject.kind, subject_id: input.subject.id, created_at: at };
  return (await sql.query("select app.documents_store($1,$2) as stored", [JSON.stringify(row), encoded.bytes])).rows[0]!.stored as {
    document_id: string; document_hash: string; content_hash: string; replayed: boolean;
  };
}

type Row = {
  document_hash: Hex; content_hash: Hex; bytes: Buffer; format: string; kind: string; media_type: string;
  issued_at: number | null; filename: string | null; chain_id: number; subject_kind: string; subject_id: string;
};
function intact(row: Row) {
  try {
    if (keccak256(row.bytes) !== row.content_hash) return false;
    if (row.format === "artifact") {
      receiptBytes({ kind: "receipt", media_type: row.media_type, bytes: row.bytes, filename: row.filename });
      return row.kind === "receipt" && row.issued_at === null && row.document_hash === row.content_hash;
    }
    const e = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(row.bytes));
    const origin = keccak256(toBytes(`${row.subject_kind}:${row.subject_id}`));
    return e.version === 1 && e.originId === origin && e.kind === row.kind && e.content.kind === row.kind &&
      e.issuedAt === row.issued_at && row.media_type === "application/json" && row.filename === null &&
      canonical(e) === row.bytes.toString("utf8") &&
      documentHash(row.chain_id, origin, e.kind, e.issuedAt, keccak256(toBytes(canonical(e.content)))) === row.document_hash;
  } catch { return false; }
}

async function find(sql: Sql, pair: { documentHash: string; contentHash: string }): Promise<Row> {
  if (!/^0x[0-9a-f]{64}$/i.test(pair.documentHash) || !/^0x[0-9a-f]{64}$/i.test(pair.contentHash)) throw new Error("INVALID_INPUT: document not found");
  // Tenant admission permits internal subject reads, not a public-reader bypass of current participation.
  const row = (await sql.query(`select * from app.documents where document_hash=$1 and content_hash=$2
    and participant_safes && app.caller_safes() and kind<>'payslip' and subject_kind<>'salary-slip'`,
  [pair.documentHash.toLowerCase(), pair.contentHash.toLowerCase()])).rows[0];
  if (!row) throw new Error("INVALID_INPUT: document not found");
  return row;
}
export async function get(sql: Sql, pair: { documentHash: string; contentHash: string }) {
  const row = await find(sql, pair);
  if (!intact(row)) throw new Error("UNKNOWN: stored document integrity mismatch");
  return { ref: { documentHash: row.document_hash, contentHash: row.content_hash, kind: row.kind, format: row.format, issuedAt: row.issued_at },
    mediaType: row.media_type, signatureStatus: row.format === "artifact" ? "opaque" : "absent", bytesBase64: row.bytes.toString("base64") };
}
export async function verify(sql: Sql, pair: { documentHash: string; contentHash: string }) {
  const row = await find(sql, pair);
  return { documentHash: row.document_hash, contentHash: row.content_hash, ok: intact(row), signatureStatus: row.format === "artifact" ? "opaque" : "absent" };
}

export type DocumentsServices = {
  authenticate(sql: Sql, bearer: string, now: number): Promise<unknown>;
  now(sql: Sql): Promise<number>;
};
export const documentsPaths = ["/documents/reading/get", "/documents/reading/verify"] as const;

/** Mount before diagnostic HMAC ingress, in the request's drained tenant transaction.
 * Services must be Access.authenticate and canonical worldNow; no body field supplies authority.
 */
export async function routeDocuments(sql: Sql, path: string, input: Record<string, unknown>, bearer: string,
  services: DocumentsServices): Promise<{ status: number; body: unknown } | null> {
  if (!documentsPaths.some((p) => p === path)) return null;
  await services.authenticate(sql, bearer, await services.now(sql));
  if (typeof input.documentHash !== "string" || typeof input.contentHash !== "string")
    throw new Error("INVALID_INPUT: document not found");
  const pair = { documentHash: input.documentHash, contentHash: input.contentHash };
  return { status: 200, body: await (path === documentsPaths[0] ? get(sql, pair) : verify(sql, pair)) };
}
