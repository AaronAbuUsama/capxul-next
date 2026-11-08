// Documents' door: the one procedure other concepts invoke inside their own transaction (P4,
// rules.procedures). The concept that births a document's subject stores the document in the same
// transaction and puts the hash this returns on chain: payments (a Payment's note, prepare and
// propose; a Movement's Memo, its record), requests (a request's Memo or Invoice, issue and checkout),
// payroll (an agreement's terms, offer) and equity (its offers, when it lands).
//
// Reads of `documents` by the concepts above (a stored document's hash pair by its id, a Movement's
// Memo by its subject) are plain reads their dependency allows: the door is for writes only. The old
// door's builders, admissions, link writers, Memo preparers and orphan markers are not ported
// (decisions documents.store-builds, documents.movement-memos).

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_documents } from "../shared/foundation.ts";
import { error_INVALID_INPUT } from "../shared/vocabulary.ts";
import { table_parties } from "../parties/data.ts";
import { MediaType, OwnerKind, Participant, SubjectKind, table_documents } from "./data.ts";

const OLD = "packages/backend/src/documents";
const PROTOCOL = "packages/protocol/src/documents";

const S = Schema.String;
const N = Schema.Number;
const Int = Schema.Int;
const NullOr = Schema.NullOr;

// ── what a storing concept gives ────────────────────────────────────────────────────────────

/** An exact token amount: the token, its decimals and the raw integer amount as a string. */
export const Amount = Schema.Struct({ token_address: S, decimals: Int, amount_raw: S });

/** A party a document names in its text: its Party when there is one, and its Safe. */
export const Named = Schema.Struct({ party_id: NullOr(S), safe: S });

/** What a Payment or a basic request is for (basis `payment`), or the outside money a Movement records (basis `movement`). */
export const MemoContent = Schema.Struct({
  kind: Schema.Literal("memo"),
  basis: Schema.Literals(["payment", "movement"]),
  /** 0 to 120 characters: a request's reference; for a Movement, its `<chain id>:<tx hash>:<log index>`. */
  reference: S,
  /** 0 to 280 characters: the payer's or issuer's note; empty for a Movement. */
  note: S,
  amount: Amount,
  /** The Safe the money leaves, and the Safe it lands in. */
  source: S,
  destination: S,
});

/** A request's Invoice: who owes whom, the exact amount, its lines and due date. */
export const InvoiceContent = Schema.Struct({
  kind: Schema.Literal("invoice"),
  /** 1 to 120 characters: the request's reference. */
  invoice_number: S,
  payer: Named,
  payee: Named,
  amount: Amount,
  due_at: NullOr(N),
  /** 0 to 280 characters. */
  note: S,
  /** 1 to 100 lines; their quantities times unit amounts add up to `amount` exactly. */
  lines: Schema.Array(Schema.Struct({ description: S, quantity: Int, unit_amount_raw: S })),
});

/** The terms an offer commits to on chain (an agreement, a grant, a round, a transfer), written by the offering concept. */
export const TermsContent = Schema.Struct({
  kind: Schema.Literal("terms"),
  /** 1 to 120 characters: what is offered, e.g. `Salary agreement`. */
  title: S,
  /** The parties the terms name, each with its role in words (employer, employee, investor), 1 to 8. */
  parties: Schema.Array(Schema.Struct({ role: S, party_id: NullOr(S), safe: S })),
  /** 1 to 40 lines, in order: each term's label and its exact value as the offer commits to it. */
  lines: Schema.Array(Schema.Struct({ label: S, value: S })),
});

/** A file someone supplied for a Payment: kept byte for byte, checked against its media type, never interpreted. */
export const ReceiptContent = Schema.Struct({
  kind: Schema.Literal("receipt"),
  media_type: MediaType,
  /** 1 byte to 128 KB, starting as its media type requires (a PDF header, a PNG or JPEG signature, valid JSON). */
  bytes: Schema.Uint8Array,
  filename: NullOr(S),
});

export const Content = Schema.Union([MemoContent, InvoiceContent, TermsContent, ReceiptContent]);

export const StoreInput = Schema.Struct({
  /** The tenant whose subject it is: a person's principal id, or an Organization's `org_<ulid>`. */
  owner_kind: OwnerKind,
  owner_id: S,
  subject: Schema.Struct({ kind: SubjectKind, id: S }),
  /** The chain the subject's payment or offer is on: the envelope's EIP-712 domain. */
  chain_id: Int,
  /** Epoch ms: the subject's birth; for a Movement, the Transfer's block time, so one Transfer always gives one Memo. */
  issued_at: N,
  /** 1 to 8 readers; the storing concept has already resolved each to its Party and Safe. */
  participants: Schema.Array(Participant),
  content: Content,
});

export const Stored = Schema.Struct({
  document_id: S,
  /** The hash the subject puts on chain. */
  document_hash: S,
  content_hash: S,
  /** True when the same document was already stored: a replay that wrote nothing. */
  replayed: Schema.Boolean,
});

// ── documents.store ─────────────────────────────────────────────────────────────────────────

export const procedure_documents_store = defineProcedure({
  id: "documents.store",
  title: "Store a subject's document and give the hash it puts on chain",
  about:
    "Money fact: a hash on chain with no content behind it is a money bug, so the concept that births a document's " +
    "subject stores the document in the same transaction and puts the hash this returns on chain (K2: a command, its " +
    "Payments and their documents are born together). It builds the canonical envelope from the facts given (a Memo, an " +
    "Invoice with its lines, or the terms of an offer), bound to its subject by an origin id (keccak-256 of the subject's " +
    "kind and id) and to its chain by the EIP-712 domain, or takes a receipt file as supplied. It computes the content " +
    "hash (keccak-256 of the exact bytes) and the document hash (EIP-712 over the typed message; a receipt's is its " +
    "content hash), and writes one immutable `documents` row with its participants, the Safes and Parties who may read " +
    "it. The same pair for the same subject and participants is a replay: it returns the stored document and writes " +
    "nothing (a retried birth, a replayed Transfer's Memo). The same pair with another subject or other participants, " +
    "a participant whose Party is at another Safe (read from `parties`), no participant or more than 8, an Invoice whose " +
    "lines do not add up to its amount exactly, text over its limit, and a receipt over 128 KB or not of its media type " +
    "are INVALID_INPUT, and nothing is written. Invoked once per document: a batch of Payments with one note each " +
    "invokes it once per Payment. It reads no subject and makes no outside call; the invoker gives everything.",
  concept: concept_documents,
  input: StoreInput,
  output: Stored,
  errors: [error_INVALID_INPUT],
  reads: [table_documents, table_parties],
  writes: [table_documents],
  drives: [],
  invokes: [],
  emits: [],
  was: [
    `${OLD}/writes/contents.ts:53`,
    `${OLD}/writes/contents.ts:109`,
    `${OLD}/writes/contents.ts:173`,
    `${OLD}/writes/contents.ts:231`,
    `${OLD}/writes/links.ts:51`,
    `${OLD}/writes/links.ts:73`,
    `${OLD}/writes/memos.ts:219`,
    `${OLD}/rules/instructions.ts:81`,
    `${OLD}/rules/memos.ts:39`,
    `${PROTOCOL}/hash.ts:255`,
    `${PROTOCOL}/codec.ts:134`,
  ],
});
