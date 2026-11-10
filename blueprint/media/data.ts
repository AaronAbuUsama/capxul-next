// Media's one table and the one state machine on it: every stored file, with the purpose media
// admitted it for, and the lifetime of an identity document. Every judgment here is a record in
// ./decisions.ts.
//
// A file is admitted when it is uploaded (`media.files.upload`), for one purpose, and never changes
// after. Whoever uses a file points at it by `file_id` (a Party's photo, an Organization's logo, a
// verification's documents) and reads this table to check it; media points at no one
// (concepts.media). The bytes live in Postgres behind the BlobStore service (components.files).
//
// Ids: `file_<ulid>`; `person_id` is access' principal id of the person who uploaded the file.
// Times are epoch milliseconds.

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../packages/blueprint-engine/src/index.ts";
import { concept_media } from "../shared/foundation.ts";

const OLD = "packages/backend/src";

// ── shared columns ──────────────────────────────────────────────────────────────────────────

/** What a file was admitted as: a logo or photo, a photo of an identity document, or any other identity document. */
export const FILE_PURPOSES = ["image", "id-image", "document"] as const;
export const FILE_STATES = ["kept", "held", "expired"] as const;
const FILE_TRANSITIONS = ["keep", "hold", "expire"] as const;
/** The content types media admits, each for the purposes media.files.upload lists. */
export const CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

export const FilePurpose = Schema.Literals(FILE_PURPOSES);
export const FileState = Schema.Literals(FILE_STATES);
export const ContentType = Schema.Literals(CONTENT_TYPES);

/** How long an identity document is held after its upload, then its bytes are deleted: 30 minutes. */
export const DOCUMENT_LIFETIME_MS = 30 * 60 * 1000;

// ── files: every stored file ────────────────────────────────────────────────────────────────

export const table_files = defineTable({
  id: "files",
  title: "Stored files: each upload, admitted for one purpose",
  about:
    "One row per file a person uploaded, written once by `media.files.upload` after the file passed the rule for the " +
    "purpose it was uploaded for: `image` (a logo or a profile photo: JPEG, PNG or WebP, at most 5 MiB), `id-image` (a " +
    "photo of an identity document: JPEG or PNG, at most 15 MB, at least 200 by 200 pixels) or `document` (any other " +
    "identity document: JPEG, PNG or PDF, at most 24 MB). `content_type` is the declared type the bytes were checked " +
    "against and `size` their length. A file never changes after its upload; only an identity document's bytes are " +
    "deleted when its lifetime ends. A consumer admits a file by reading it at the caller's own key: a file the caller " +
    "did not upload, of another purpose, or expired, names nothing they can use (INVALID_INPUT, raised by the consumer). " +
    "Organizations reads it for a logo, parties for a photo, both `image` and `kept`; banking for a verification's " +
    "documents, `id-image` or `document` and `held`. Row-level security shows a person their own rows; its one exception " +
    "is a `kept` image, which anyone may read by its id (`by-id`), because an image is what any counterparty sees of the " +
    "Party or Organization that points at it. `bytes` is the BlobStore service's Postgres layer: a move to a bucket " +
    "would replace this column with the bucket's key and change nothing else.",
  concept: concept_media,
  tenancy: "person",
  tenantField: "person_id",
  admits: [
    {
      match: "anyone",
      where: { purpose: "image", state: "kept" },
      reads: true,
      writes: false,
      about:
        "The row policy's one exception: anyone, signed in or not, reads a kept image by its id (`by-id`, " +
        "`media.files.get`); a held or expired document never (media.serving).",
    },
  ],
  fields: Schema.Struct({
    /** The person who uploaded it: the only person who can use it in a write. */
    person_id: Schema.String,
    file_id: Schema.String,
    purpose: FilePurpose,
    state: FileState,
    content_type: ContentType,
    /** Its length in bytes, 1 to the purpose's limit. */
    size: Schema.Number,
    /** The file itself, exactly as uploaded; null once an identity document has expired. */
    bytes: Schema.NullOr(Schema.Uint8Array),
    created_at: Schema.Number,
    /** An identity document's end of life, 30 minutes after its upload; null for an image. */
    expires_at: Schema.NullOr(Schema.Number),
  }),
  key: ["person_id", "file_id"],
  indexes: [
    {
      name: "by-id",
      fields: ["file_id"],
      unique: true,
      crossTenant: true,
      for:
        "Serve a kept image by its id to whoever is shown the Party or Organization that points at it, with no sign-in " +
        "(`media.files.get`); a held or expired document is never read this way.",
    },
  ],
  retention:
    "A kept image is kept for good: its owners point at it and media cannot see who does. A held document's bytes are " +
    "deleted 30 minutes after its upload (`expire`); its row stays with no bytes, as the record of what was uploaded.",
  was: [
    `${OLD}/media/model.ts:8`,
    `${OLD}/media/images/rules.ts:10`,
    `${OLD}/parties/tables.ts:106`,
    `${OLD}/parties/verifications/external/documents.ts:8`,
    `${OLD}/profiles/writes.ts:21`,
    `${OLD}/organizations/writes.ts:11`,
  ],
});

// ── a file's life ───────────────────────────────────────────────────────────────────────────

export const event_file_transitioned = defineEvent({
  id: "file_transitioned",
  about:
    "A file was stored or an identity document expired. `from` is null at an upload. It names the file, its uploader and " +
    "its purpose, never its content type's details, its bytes or what points at it.",
  props: Schema.Struct({
    from: Schema.NullOr(FileState),
    to: FileState,
    transition: Schema.Literals(FILE_TRANSITIONS),
    file_id: Schema.String,
    person_id: Schema.String,
    purpose: FilePurpose,
  }),
});

export const machine_file = defineMachine({
  id: "file",
  title: "A file: an image kept for good, or an identity document held, then expired",
  about:
    "A file is born admitted, by its upload: an image is kept for good, an identity document (an `id-image` or a " +
    "`document`) is held for its 30-minute lifetime, long enough for the one submission to Bridge that follows its " +
    "upload. The document's own process expires it at the end of that lifetime, deleting its bytes. Nothing else " +
    "changes `state`, and nothing ever changes a kept image.",
  table: table_files,
  field: "state",
  initial: "kept",
  states: [
    { id: "kept", about: "An admitted image (a logo or a photo), kept for good and served by its id." },
    { id: "held", about: "An admitted identity document within its lifetime: its uploader's verification may send it to Bridge." },
    { id: "expired", about: "An identity document past its lifetime: its bytes are deleted and nothing can use it.", terminal: true },
  ],
  transitions: {
    keep: {
      from: [],
      to: "kept",
      about: "An upload for the `image` purpose passed its rule: the image is stored for good.",
      guard: "JPEG, PNG or WebP, declared and matching its bytes' signature; 1 byte to 5 MiB.",
      emits: [event_file_transitioned],
    },
    hold: {
      from: [],
      to: "held",
      about: "An upload for the `id-image` or `document` purpose passed its rule: the document is stored until expires_at.",
      guard: "Its purpose's types, declared and matching its bytes' signature, within its size limit; an id-image at least 200 by 200 pixels.",
      emits: [event_file_transitioned],
    },
    expire: {
      from: ["held"],
      to: "expired",
      about: "The document's lifetime ended: its bytes are deleted in the same transaction.",
      guard: "Now is at or after expires_at.",
      emits: [event_file_transitioned],
    },
  },
  was: [
    `${OLD}/parties/verifications/operations/record-document.ts:55`,
    `${OLD}/parties/verifications/operations/delete-document.ts:25`,
  ],
});
