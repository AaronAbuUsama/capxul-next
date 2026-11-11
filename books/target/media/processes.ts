// Media's durable processes: one per identity document, which owns its lifetime. An image has no
// process: it is kept for good and nothing ever changes it. The old system scheduled a delete per
// document 30 minutes ahead; here that is the document's own timer, so there is no sweep (P3).
// Decisions: media.document-process, media.retention.

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_media } from "../shared/foundation.ts";
import { DOCUMENT_LIFETIME_MS, machine_file, table_files } from "./data.ts";

const OLD = "packages/backend/src/parties/verifications";
const HOUR = 3_600_000;

export const workflow_media_files_expire_document = defineWorkflow({
  id: "media.files.expire-document",
  title: "One identity document's lifetime: held, then its bytes deleted",
  about:
    "The one durable process of an identity document, started by its `hold` (the upload's transition, through the " +
    "outbox). It waits for its own timer at expires_at, 30 minutes after the upload, then deletes the document's bytes " +
    "and expires it, in one transaction. It cannot be a step of the upload: it waits half an hour and must survive a " +
    "crash, or a person's identity document would be kept. Banking's verification reads a held document within that " +
    "time and sends it to Bridge, keeping no copy, so after it Capxul holds none. It replaces the old per-document " +
    "scheduled delete and the delete after each submission.",
  was: [`${OLD}/operations/record-document.ts:55`, `${OLD}/operations/delete-document.ts:9`, `${OLD}/external/submissions.ts:71`],
  concept: concept_media,
  priority: "normal",
  trigger: { transition: machine_file.t.hold },
  instance: { per: table_files },
  waits: [
    { name: "lifetime", for: "timer", timeoutMs: DOCUMENT_LIFETIME_MS, about: "Until the document's expires_at, 30 minutes after its upload." },
  ],
  steps: [
    { name: "await-lifetime", about: "Wait for the timer at expires_at." },
    { name: "expire", about: "Delete the bytes and expire the row, in one transaction; a row already expired is left as it is." },
  ],
  reads: [table_files],
  writes: [table_files],
  drives: [machine_file.t.expire],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency:
    "One process per document (`media-file:<person_id>:<file_id>`); `expire` moves only from `held`, so a replayed " +
    "step changes nothing.",
  timeoutMs: 2 * HOUR,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
});
