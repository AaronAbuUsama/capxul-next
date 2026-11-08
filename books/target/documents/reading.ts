// Documents' one area, reading: get, verify and render one stored document by its hash pair. Each
// rpc runs the same two checks in the same order before it answers anything about the document:
//
// 1. The caller takes part in it now. The caller's Safes are the Safe of their own Party (the Party at
//    their principal's Safe, when it is theirs: a person Party they claimed, or the agent's own) and the
//    company Safe of each Organization where they hold an active Seat now. One of them must be among the
//    document's participants. A caller with no Party of their own has no Safes.
// 2. Its stored bytes still hold: the content hash over the bytes; for an envelope, the typed hash over
//    its decoded message and the kind and issue time it states; for a receipt file, its media type and
//    that its two hashes are one.
//
// A pair that names nothing and a pair the caller may not read are the same INVALID_INPUT (`document not
// found`, on `documentHash`), so a refusal never says which. Hex case does not matter: the pair is
// lowercased first. Nothing here writes, and nothing sends an event.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_documents } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_UNKNOWN } from "../shared/vocabulary.ts";
import { table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_org_members, table_organizations } from "../organizations/data.ts";
import { DocumentFormat, DocumentKind, MediaType, table_documents } from "./data.ts";

const OLD = "packages/backend/src/documents";
const ACTIVITY = "packages/backend/src/activity/documents";
const PROTOCOL = "packages/protocol/src";

const S = Schema.String;

// ── wire shapes (camelCase, as the frozen book prints them) ─────────────────────────────────

/** Two 32-byte 0x hex hashes, in any hex case. */
export const HashPair = Schema.Struct({ documentHash: S, contentHash: S });

/** What a read says a document is. */
export const DocumentRef = Schema.Struct({
  documentHash: S,
  contentHash: S,
  kind: DocumentKind,
  format: DocumentFormat,
  /** Epoch ms; null for a receipt file. */
  issuedAt: Schema.NullOr(Schema.Number),
});

/**
 * `absent` for an envelope (Capxul signs none: the hashes are the check), `opaque` for a receipt file
 * (its bytes are checked, not what they say). `verified` is the frozen surface's third value, for a
 * signed envelope; the target stores none (decision documents.unsigned).
 */
export const SignatureStatus = Schema.Literals(["absent", "verified", "opaque"]);

const READS = [table_documents, table_principals, table_parties, table_org_members, table_organizations];
const WHO =
  "A signed-in person or agent who takes part in the document now: the Safe of their own Party is one of its " +
  "participants, or they hold an active Seat in an Organization whose company Safe is. Current Seats decide an " +
  "Organization's reads, never who stored the document. Anyone else, and a caller with no Party of their own, is " +
  "answered as if the pair named nothing.";

// ── get ─────────────────────────────────────────────────────────────────────────────────────

export const rpc_documents_reading_get = defineRpc({
  id: "documents.reading.get",
  title: "Read one document and its exact bytes",
  about:
    "The document a hash pair names (`by_pair`), with what it is (kind, format, issue time), its media type, its " +
    "signature status and its exact bytes in base64, answered only after the participant check and then the integrity " +
    "checks pass. A stored row that fails an integrity check is a defect, UNKNOWN (`stored document integrity " +
    "mismatch`, its `details.check` naming the check), never the caller's input: a tampered note is detected here. " +
    "`document get` prints all but the bytes; `document export` writes them to a file.",
  concept: concept_documents,
  kind: "query",
  who: WHO,
  input: HashPair,
  output: Schema.Struct({
    ref: DocumentRef,
    mediaType: MediaType,
    signatureStatus: SignatureStatus,
    bytesBase64: S,
  }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN],
  reads: READS,
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [
    `${ACTIVITY}/operations/get.ts:9`,
    `${ACTIVITY}/reads.ts:22`,
    `${OLD}/reads/contents.ts:32`,
    `${OLD}/guards.ts:100`,
    `${OLD}/rules/integrity.ts:139`,
    `${OLD}/errors.ts:12`,
    `${OLD}/errors.ts:59`,
    `${PROTOCOL}/activity/operations.ts:144`,
    `${PROTOCOL}/documents/read-schema.ts:46`,
  ],
});

// ── verify ──────────────────────────────────────────────────────────────────────────────────

export const rpc_documents_reading_verify = defineRpc({
  id: "documents.reading.verify",
  title: "Check one document against its hashes",
  about:
    "Whether a document the caller may read still matches its hashes: the same participant check as `get`, then the " +
    "same integrity checks, and the answer `ok` true when they all hold. A stored row that fails one is a completed " +
    "answer, `ok` false with its signature status, not an error: verifying is the question, so a negative answer is " +
    "the reply (decision documents.verify-answers). A pair that names nothing or that the caller may not read is still " +
    "INVALID_INPUT. It returns the pair it checked, never the bytes.",
  concept: concept_documents,
  kind: "query",
  who: WHO,
  input: HashPair,
  output: Schema.Struct({
    documentHash: S,
    contentHash: S,
    ok: Schema.Boolean,
    signatureStatus: SignatureStatus,
  }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: READS,
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [
    `${ACTIVITY}/operations/verify.ts:10`,
    `${ACTIVITY}/reads.ts:46`,
    `${OLD}/reads/contents.ts:72`,
    `${PROTOCOL}/activity/operations.ts:151`,
    `${PROTOCOL}/documents/read-schema.ts:60`,
    "apps/cli/src/commands/document/tests/document.test.ts:115",
  ],
});

// ── render ──────────────────────────────────────────────────────────────────────────────────

export const rpc_documents_reading_render = defineRpc({
  id: "documents.reading.render",
  title: "Lay out one checked document as HTML",
  about:
    "The HTML of a document the caller may read, built only after the participant check and the integrity checks pass " +
    "(an integrity failure is UNKNOWN, as for `get`). An envelope's fields are laid out with the current public names of " +
    "the parties it names, read then: an Organization by its name, a person or an agent by their display name, else " +
    "their handle, else their Safe shortened; never a Party id and never a mailbox, so an employer and an employee on " +
    "a payslip or an agreement's terms read as who they are. A receipt file renders only an escaped summary (its media type, file " +
    "name and size) and none of its bytes. The document stylesheet comes with it, its font embedded, so the PDF prints " +
    "with no network. The stored bytes never change: names are layout, not content.",
  concept: concept_documents,
  kind: "query",
  who: WHO,
  input: HashPair,
  output: Schema.Struct({
    documentHash: S,
    contentHash: S,
    kind: DocumentKind,
    ok: Schema.Literal(true),
    html: S,
  }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN],
  reads: READS,
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [
    `${ACTIVITY}/operations/render.ts:10`,
    `${ACTIVITY}/reads.ts:60`,
    `${OLD}/reads/contents.ts:127`,
    `${OLD}/reads/parties.ts:141`,
    `${OLD}/reads/stylesheet.ts:1`,
    `${PROTOCOL}/activity/operations.ts:158`,
    `${PROTOCOL}/documents/read-schema.ts:68`,
    `${PROTOCOL}/templates/documents/render.ts:1`,
  ],
});
