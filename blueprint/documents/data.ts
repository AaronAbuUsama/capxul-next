// Documents' data: one table, the immutable store of the exact financial documents whose hashes
// payments, requests and agreements put on chain (and the Memos Movements carry), each row with the
// participants who may read it, given by the concept that stored it.
//
// There is no state machine and so no event (P7 sends an event only from a status write): a document
// never changes after it is stored, and whether its subject still stands (a Payment settled, a
// Movement removed by a reorg) is its subject's concept's status, not the document's. The old four
// tables become this one (decision documents.one-table): `paymentDocuments` (the content) and
// `financialDocumentLinks` (subject and actor) fold into one row; `financialDocumentMovements` (a copy of
// each Transfer) and `financialDocumentMovementConflicts` (fingerprint conflicts) are dropped.
//
// Times are epoch milliseconds, as parties' and organizations' are. Hashes and addresses are lowercase
// 0x hex.

import { Schema } from "effect";
import { defineTable } from "../../packages/blueprint-engine/src/index.ts";
import { concept_documents } from "../shared/foundation.ts";

const OLD = "packages/backend/src/documents";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

/** Whose record a document's subject is (P8 `owner`): a person's or an Organization's. */
export const OwnerKind = Schema.Literals(["person", "organization"]);

/**
 * What a document is: a Memo, an Invoice, the terms of an offer, a payslip (one Salary Slip's pay, whose hash its
 * Payment carries; documents.payslip-kind), or a receipt file someone supplied.
 */
export const DOCUMENT_KINDS = ["memo", "invoice", "terms", "payslip", "receipt"] as const;
export const DocumentKind = Schema.Literals(DOCUMENT_KINDS);

/** How it is stored: a canonical envelope Capxul built, or an opaque file kept byte for byte. */
export const DocumentFormat = Schema.Literals(["envelope", "artifact"]);

/** An envelope is JSON; a receipt file is one of the four types the old store admitted. */
export const MediaType = Schema.Literals(["application/json", "application/pdf", "image/png", "image/jpeg"]);

/**
 * The record a document belongs to, named by the concept that stored it: payments' Payments and Movements,
 * requests' requests, payroll's agreements and salary slips, and equity's offers (a share or option grant, a
 * round, an investor's commitment or SAFE note, a share transfer offer), whose contracts each take a document hash.
 */
export const SUBJECT_KINDS = [
  "payment",
  "movement",
  "request",
  "agreement",
  "salary-slip",
  "expense-claim",
  "employee-advance",
  "grant",
  "round",
  "commitment",
  "share-transfer",
] as const;
export const SubjectKind = Schema.Literals(SUBJECT_KINDS);

/** Why a participant may read it: the side that pays, the side paid, or the officer who offered it. */
export const ParticipantRole = Schema.Literals(["payer", "payee", "holder"]);

/**
 * One reader of a document, named by the Safe money moves between (a person's email-derived Safe, an
 * agent's own, an Organization's company Safe) and the Party at that Safe when there is one.
 */
export const Participant = Schema.Struct({
  safe: S,
  party_id: NullOr(S),
  role: ParticipantRole,
});

// ── documents ───────────────────────────────────────────────────────────────────────────────

export const table_documents = defineTable({
  id: "documents",
  title: "Documents: the exact content behind every document hash",
  about:
    "One immutable row per stored document, written once by `documents.store` in the transaction that births its subject " +
    "and never updated or deleted. `bytes` are the exact bytes: for an envelope, the canonical JSON of the typed message " +
    "Capxul built (a Memo, an Invoice with its lines, the terms of an offer, or a payslip); for a receipt, the file as supplied (at " +
    "most 128 KB). `content_hash` is keccak-256 over the bytes; `document_hash` is the EIP-712 hash of the typed message, " +
    "the value a payment, an escrow or an offer carries on chain (for a receipt, the two are one). `kind`, `format`, " +
    "`media_type` and `issued_at` are read from the bytes at store time and checked against them again on every read. " +
    "`subject_kind` and `subject_id` name the record it belongs to (a Payment, a request, an agreement, a salary slip, an equity offer, a " +
    "Movement's `<chain id>:<tx hash>:<log index>`); the envelope binds it through its origin id, so one note on two Payments is " +
    "two documents. `participants` are who may read it, as the storing concept gave them: each by Safe, with its Party and " +
    "role. An Organization participant is read by whoever holds an active Seat in it at read time, never by whoever stored " +
    "it; a payslip's, only by a member wearing its People hat or a Director (documents.payslip-readers). `owner_kind` and `owner_id` are the tenant whose subject it is: the payer of a Payment, the issuer of a request, " +
    "the offering Organization of an agreement, the paying Organization of a salary slip, the first Capxul side of a Movement. Replaces old `paymentDocuments` and " +
    "`financialDocumentLinks` (one link row per actor and subject); the Movement occurrence copy, its conflict log, the " +
    "line-item and adjustment projections and the signature column are gone (decisions).",
  concept: concept_documents,
  tenancy: "owner",
  tenantField: "owner_id",
  scope:
    "The generated row-level policy admits the owner's tenant (`owner_kind` with `owner_id`), and a session whose Safes " +
    "include one of `participant_safes`: the Safe of the principal's own Party, or the company Safe of an Organization " +
    "where the principal holds an active Seat now.",
  admits: [
    {
      match: "own-safe",
      field: "participant_safes",
      reads: true,
      writes: false,
      about:
        "A participant reads the document: a session whose own Safes include one of `participant_safes`; only " +
        "`documents.store`, in its invoker's transaction, writes it (documents.tenancy).",
    },
  ],
  fields: Schema.Struct({
    owner_id: S,
    owner_kind: OwnerKind,
    /** `doc_<ulid>`, the id `documents.store` returns and the subject's row keeps. */
    document_id: S,
    document_hash: S,
    content_hash: S,
    kind: DocumentKind,
    format: DocumentFormat,
    media_type: MediaType,
    bytes: Schema.Uint8Array,
    /** The envelope's issue time; null for a receipt file. */
    issued_at: NullOr(N),
    /** A receipt file's name as supplied, shown in its rendered summary; null for an envelope. */
    filename: NullOr(S),
    /** The chain of the envelope's EIP-712 domain: the chain the subject's payment or offer is on. */
    chain_id: Schema.Int,
    subject_kind: SubjectKind,
    subject_id: S,
    /** 1 to 8 readers, in the order the storing concept gave them. */
    participants: Schema.Array(Participant),
    /** The participants' Safes, for the row policy. */
    participant_safes: Schema.Array(S),
    created_at: N,
  }),
  key: ["owner_id", "owner_kind", "document_id"],
  indexes: [
    {
      name: "by_pair",
      fields: ["document_hash", "content_hash"],
      unique: true,
      crossTenant: true,
      for:
        "`document get`, `verify`, `render` and `export` name a document by its hash pair, and the reader is often a " +
        "participant who is not its owner (the payee of a Payment, the payer of a request); the participant check follows. " +
        "Also `documents.store`'s replay of the same pair.",
    },
    {
      name: "by_document",
      fields: ["document_id"],
      unique: true,
      crossTenant: true,
      for:
        "The reads of payments, requests, payroll and activity: a Payment's, request's or agreement's document by the id " +
        "`documents.store` returned, for its hash pair and the render command, whichever side reads it.",
    },
    {
      name: "by_subject",
      fields: ["subject_kind", "subject_id"],
      crossTenant: true,
      for:
        "Activity's Movement row: the Memo of a Movement by its `<chain id>:<tx hash>:<log index>`, for whichever side reads " +
        "it (a Movement keeps no document id); and `documents.store`'s check that a subject's repeat is the same document.",
    },
  ],
  retention:
    "Kept for good, never updated or deleted: a hash on chain stays verifiable, and its readers unchanged, for as long as " +
    "the chain keeps it.",
  was: [
    `${OLD}/tables.ts:12`,
    `${OLD}/tables.ts:47`,
    `${OLD}/tables.ts:63`,
    `${OLD}/tables.ts:88`,
    `${OLD}/writes/contents.ts:53`,
    `${OLD}/writes/links.ts:20`,
    `${OLD}/guards.ts:100`,
  ],
});
