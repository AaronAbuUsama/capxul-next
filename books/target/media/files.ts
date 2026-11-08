// Media's one area of rpcs: a file's upload, where it is admitted for its purpose, and a kept
// image's serving by its id. Media owns no frozen operation (OPERATION_OWNERS), so these are reached
// by flows: banking's `client.verification.start` uploads identity documents, and media's own two
// flows in ./flows.ts serve the web app's photo and logo uploads and every page that shows one.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_media } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED } from "../shared/vocabulary.ts";
import { ContentType, FilePurpose, machine_file, table_files } from "./data.ts";

const OLD = "packages/backend/src";
const S = Schema.String;
const N = Schema.Number;

/** What the uploader gets back: the id to hand to the record that will point at the file. */
export const StoredFile = Schema.Struct({
  file_id: S,
  purpose: FilePurpose,
  content_type: ContentType,
  size: N,
  /** An identity document's end of life; null for an image, which is kept for good. */
  expires_at: Schema.NullOr(N),
});

export const rpc_media_files_upload = defineRpc({
  id: "media.files.upload",
  title: "Upload a file, admitted for one purpose",
  about:
    "Stores one file for the caller, in one transaction, only if it passes the rule for the purpose it is uploaded for; " +
    "every check runs before the write, and a refused file leaves nothing stored. Each rule checks the declared content " +
    "type, that the bytes begin with that type's signature (a JPEG's FF D8 and a frame header, a PNG's eight-byte " +
    "signature and IHDR, a WebP's RIFF and WEBP, a PDF's `%PDF-1.` or `%PDF-2.`), and the size, from 1 byte: `image` (a " +
    "logo or a profile photo) is JPEG, PNG or WebP of at most 5 MiB, and is kept for good (`keep`); `id-image` (the front " +
    "or back of an identity document) is JPEG or PNG of at most 15 MB, at least 200 by 200 pixels as its header states; " +
    "`document` (proof of address, a business's formation, ownership or standing papers) is JPEG, PNG or PDF of at most " +
    "24 MB. An identity document is held for 30 minutes (`hold`, expires_at set), which starts its process. A refusal is " +
    "INVALID_INPUT with `file` and one fixed reason (the type, the bytes not matching it, the size, the pixels); it never " +
    "echoes the file. The answer is the file's id, to hand to whatever will point at it: `parties.profiles.save`, " +
    "`organizations.setups.begin` or `banking.verification.start`. A second upload of the same bytes is a second file.",
  concept: concept_media,
  kind: "mutation",
  who:
    "A signed-in caller, person or agent; the file is theirs (its `person_id` is their principal id), and only they can " +
    "use it in a write. Nobody else can see a document they uploaded.",
  input: Schema.Struct({
    purpose: FilePurpose,
    content_type: S,
    bytes: Schema.Uint8Array,
  }),
  output: StoredFile,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [],
  writes: [table_files],
  drives: [machine_file.t.keep, machine_file.t.hold],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: {
    ...budget("write"),
    p50Ms: 900,
    p95Ms: 3_000,
    why: "receives, checks and stores up to 24 MB in one transaction; the write default fits a small image, not a document",
  },
  was: [
    `${OLD}/media/images/operations/generate-upload-url.ts:9`,
    `${OLD}/media/images/rules.ts:18`,
    `${OLD}/parties/verifications/operations/upload.ts:28`,
    `${OLD}/parties/verifications/operations/record-document.ts:15`,
    `${OLD}/parties/verifications/external/documents.ts:73`,
    `${OLD}/parties/verifications/external/documents.ts:125`,
  ],
});

export const rpc_media_files_get = defineRpc({
  id: "media.files.get",
  title: "A kept image's bytes, by its id",
  about:
    "The bytes and content type of a kept image (a Party's photo, an Organization's logo), read by its id across " +
    "tenants: the row-level policy's one exception on `files`. A file never changes, so the answer can be cached for good " +
    "by its id. Null for an id no file has and for any identity document, held or expired, so the answer never tells a " +
    "document from nothing; a malformed id (not `file_` and a ULID) is INVALID_INPUT. It writes nothing and calls " +
    "nothing. It replaces the old serving URL resolved from storage at read time.",
  concept: concept_media,
  kind: "query",
  who:
    "Anyone, signed in or not: an image is what any counterparty sees of the Party or Organization that points at it, " +
    "and its id is unguessable. A document is never served to anyone.",
  input: Schema.Struct({ file_id: S }),
  output: Schema.NullOr(
    Schema.Struct({
      file_id: S,
      content_type: ContentType,
      size: N,
      bytes: Schema.Uint8Array,
    }),
  ),
  errors: [error_INVALID_INPUT],
  reads: [table_files],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [`${OLD}/media/model.ts:17`, `${OLD}/profiles/writes.ts:34`, `${OLD}/organizations/writes.ts:26`],
});
