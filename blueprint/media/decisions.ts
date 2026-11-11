// Media's own judgments: the one table and whose a file is, where and by which rule a file is
// admitted, how an image is served, how long each kind of file is kept and what keeps it, and what
// of old media and old parties' document buffers is not ported. The architecture's judgments about
// media (it stays, owners point at its files, files live in Postgres) are in shared/decisions.ts;
// these refine them. Media owns no operation, so it names no refusal and introduces no world.

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { concept_banking, concept_media, concept_organizations, concept_parties } from "../shared/foundation.ts";
import {
  decision_components_files,
  decision_concepts_media,
  decision_operations_owners,
  decision_rules_durable_processes,
  decision_rules_procedures,
} from "../shared/decisions.ts";
import { event_file_transitioned, machine_file, table_files } from "./data.ts";
import { rpc_media_files_get, rpc_media_files_upload } from "./files.ts";
import { workflow_media_files_expire_document } from "./processes.ts";
import { flow_client_media_fetch_image, flow_client_media_upload } from "./flows.ts";

const BY = "Claude, media target design, 8 November 2026";
const by = (evidence: string) => `${BY}; evidence: ${evidence}`;

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_media_one_table = defineDecision({
  id: "media.one-table",
  title: "One `files` table holds every stored file, its bytes included",
  question:
    "The old system kept files in three places: Convex's `_storage` for every blob, old parties' `verificationDocuments` " +
    "for the identity documents' metadata, and a storage id on each owner's row. What does the target store, and where?",
  options: [
    {
      label: "one-table",
      text: "One `files` table: uploader, purpose, state, declared type, size, the bytes and a document's expiry. Owners keep only a file id.",
    },
    { label: "per-purpose", text: "An `images` table and an `identity-documents` table, each with its own upload." },
    { label: "bucket", text: "Metadata in Postgres, bytes in an object store under a key." },
  ],
  chosen: "one-table",
  why:
    "One table gives one upload, one admission rule, one serving path and one retention column for the three uses " +
    "(concepts.media). Two tables would repeat the key, the tenancy and the upload for a difference of limits and " +
    "lifetime, which `purpose` and `state` already carry. The bytes are a column behind the BlobStore service " +
    "(components.files: one Postgres, files of at most 24 MB); Postgres keeps a large value out of line, so reading a " +
    "row's metadata does not read its bytes. The owners' storage ids stay with the owners as file ids (a Party's " +
    "`photo_file_id`, an Organization's `logo_file_id`), and old parties' document metadata is this table's row.",
  source: by("media/model.ts:8; parties/tables.ts:106; profiles/writes.ts:21; organizations/writes.ts:11; components.files"),
  affects: [table_files, concept_media, decision_components_files, decision_concepts_media],
});

export const decision_media_uploader = defineDecision({
  id: "media.uploader",
  title: "A file is its uploader's: tenancy by the uploader's principal",
  question: "Whose row is a stored file (P8), and who may use it?",
  options: [
    {
      label: "uploader",
      text: "Tenancy `person` on the uploader's principal id; only the uploader can use the file in a write, by reading it at their own key.",
    },
    { label: "owner", text: "Tenancy `owner`: the person or Organization the file will belong to, named at the upload." },
    { label: "global", text: "Global: any caller may use any file id they learn." },
  ],
  chosen: "uploader",
  why:
    "At its upload a file's owner may not exist yet: an Organization's logo is uploaded before `org create` births the " +
    "Organization. The uploader is always known, and every write that points at a file is the uploader's own (`org " +
    "create` by the founder, a profile save by its person, `verify start` by the person whose documents they are), so " +
    "reading at the caller's key both finds the file and proves it is theirs. The old check was weaker: any storage id of " +
    "the deployment could be bound, so anyone who learned a blob's id could bind it. Global would keep that hole. An " +
    "agent's principal may upload too; no consumer takes its files today, and refusing it would be a rule with no use.",
  source: by("media/images/reads.ts:15 (any _storage id binds); access principals (one person_id for person and agent); P8"),
  affects: [table_files, rpc_media_files_upload],
});

export const decision_media_admission_at_upload = defineDecision({
  id: "media.admission-at-upload",
  title: "A file is admitted when it is uploaded, for the purpose it names",
  question:
    "Old media admitted an image when an owner bound it; old parties checked a document at upload and again at " +
    "submission. Where does the target admit a file?",
  options: [
    {
      label: "at-upload",
      text: "The upload names a purpose and media checks the type, the bytes' signature, the size and an ID image's pixels before storing; a consumer checks purpose and state.",
    },
    { label: "at-bind", text: "Store any upload; each consumer runs media's rule on the stored file before its write, as old images did." },
    { label: "both", text: "Check at upload, and run the whole rule again at every bind." },
  ],
  chosen: "at-upload",
  why:
    "One rule in one place: a file never changes after its upload, so checking it again at a bind finds nothing new, " +
    "and at-bind would put media's rule into parties, organizations and banking. A consumer reads only a fact: the " +
    "file is the caller's, of its purpose, and kept or held, which is what the old `findImageRefusal` door call gave " +
    "it. A refused file is never stored, so no stray upload is left behind. The upload also checks the bytes' signature, " +
    "which the old image rule did not (Convex recorded only the declared type): a declared PNG that is not one now fails " +
    "closed, as old identity documents did. `org create`'s invalid logo is still refused by organizations, before any " +
    "write, because an id that names no kept image of the founder's names nothing it can use.",
  source: by("media/images/rules.ts:18; media/index.ts (findImageRefusal); parties/verifications/external/documents.ts:73; org.create acceptance 4"),
  affects: [rpc_media_files_upload, table_files, machine_file, concept_media, concept_organizations, concept_parties],
});

export const decision_media_purposes = defineDecision({
  id: "media.purposes",
  title: "Three purposes, each with its limits: image, id-image, document",
  question: "Which kinds of file does media admit, and with which types and sizes?",
  options: [
    {
      label: "three",
      text:
        "`image`: JPEG, PNG or WebP, at most 5 MiB. `id-image`: JPEG or PNG, at most 15 MB, at least 200 by 200 pixels. " +
        "`document`: JPEG, PNG or PDF, at most 24 MB.",
    },
    { label: "two", text: "`image` and `document`, an ID image being a document." },
    { label: "per-field", text: "One purpose for each of Bridge's nine verification document fields." },
  ],
  chosen: "three",
  why:
    "The limits differ in exactly three ways. An image is the old image rule (`rules.ts`: JPEG, PNG or WebP, 5 MiB). " +
    "An ID image and any other identity document are Bridge's published limits as old parties enforced them " +
    "(documents.ts: 15 MB and 200 by 200 pixels for an ID image; 24 MB, PDF allowed, otherwise), which the frozen " +
    "`verify start` repeats in its notes. Two purposes would lose the ID image's pixel and size rule. Bridge's nine " +
    "fields are banking's vocabulary: banking matches each field to its purpose, and the 24 MB total of a person's two " +
    "ID images is a rule of the submission, so it stays banking's too.",
  source: by("media/images/rules.ts:10-12; parties/verifications/external/documents.ts:8-10,75-102; verify.start.yaml notes"),
  affects: [table_files, rpc_media_files_upload, flow_client_media_upload, concept_banking],
});

// ── serving ─────────────────────────────────────────────────────────────────────────────────

export const decision_media_serving = defineDecision({
  id: "media.serving",
  title: "A kept image is served by its id to anyone; a document never is",
  question: "Owners keep only a file id. How does a page show a Party's photo or an Organization's logo?",
  options: [
    {
      label: "public-by-id",
      text: "`media.files.get` answers a kept image's bytes by its id with no sign-in: one cross-tenant index and the row policy's one exception.",
    },
    { label: "owner-serves", text: "Each owner's view returns the bytes, or a URL, with the record that points at the file." },
    { label: "signed-urls", text: "Media issues short-lived signed URLs, as Convex storage's serving URLs were resolved at read time." },
  ],
  chosen: "public-by-id",
  why:
    "The old serving URL was public: Convex served a blob to anyone holding its URL, and the views handed it out. An " +
    "image is what any counterparty sees of the Party or Organization pointing at it (the Party is global), and a " +
    "ULID-based id is not guessable, so serving it by id shows nothing new. Owner-serves would put bytes or URLs into " +
    "every view and media's reads into three concepts. Signed URLs add a key and an expiry for files that are public " +
    "anyway. A file never changes, so the answer is cacheable for good by its id. Identity documents were never served " +
    "(old submissions.ts: never create a serving URL) and still are not: the rpc answers a document as it answers an " +
    "unknown id, null.",
  source: by("media/model.ts:13-19 (StorageUrlResolver); profiles/writes.ts:34; parties/verifications/external/submissions.ts:10"),
  affects: [rpc_media_files_get, flow_client_media_fetch_image, table_files],
});

// ── time ────────────────────────────────────────────────────────────────────────────────────

export const decision_media_retention = defineDecision({
  id: "media.retention",
  title: "Images are kept for good; a document's bytes go 30 minutes after its upload",
  question:
    "The old bind deleted the image it replaced, and old parties deleted a document 30 minutes after its upload and " +
    "after each submission. How long does the target keep each file, now that media points at no one?",
  options: [
    { label: "images-kept", text: "A kept image stays for good; a held document's bytes are deleted 30 minutes after its upload." },
    { label: "owners-release", text: "An owner's write invokes a media procedure that frees the image it replaced." },
    { label: "unreferenced-sweep", text: "A periodic job deletes images that nothing points at." },
  ],
  chosen: "images-kept",
  why:
    "Media cannot see a replacement: owners point at files and media points at no one (concepts.media). A procedure " +
    "from the owner would be a write that is no money fact (rules.procedures); media cannot react to parties' or " +
    "organizations' changes, because it may not depend on them; and a sweep is neither a process's timer nor one of " +
    "P3's crons, and would have to read media's users. An image is small (5 MiB at most), rarely replaced and public, " +
    "so keeping a replaced one costs little and shows nothing that was not shown; this drops the old delete-on-replace. " +
    "Identity documents are private, and Capxul keeps no copy of them once Bridge has them: their bytes are deleted 30 " +
    "minutes after the upload. The old 30 minutes was Convex's action ceiling; it stays because it is enough for the one " +
    "submission that follows the upload in `verify start` (every run uploads again). The expired row stays, without " +
    "bytes, as the record of what was uploaded.",
  source: by("profiles/writes.ts:31; organizations/writes.ts:24; parties/verifications/external/documents.ts:11; parties.no-process (replaced-photo deletion to media's retention)"),
  affects: [table_files, machine_file, workflow_media_files_expire_document, concept_media, decision_concepts_media],
});

export const decision_media_document_process = defineDecision({
  id: "media.document-process",
  title: "One durable process per identity document, with its own timer",
  question:
    "What ends an identity document's lifetime: a process per document, a check at read time, or the submission that " +
    "used it? And does a file need a state machine at all?",
  options: [
    {
      label: "process",
      text: "A file machine (kept, held, expired); `hold` starts one process per document, whose timer at expires_at runs `expire`.",
    },
    { label: "expiry-on-read", text: "No machine: readers ignore a document past expires_at, and its bytes stay." },
    { label: "delete-on-submit", text: "Banking deletes each document once its submission is sent." },
  ],
  chosen: "process",
  why:
    "An identity document is a long-lived object with an expiry, so it gets one durable process (rules.durable-processes " +
    "lets a designer add an object); its own timer replaces the old scheduler's delete, with no sweep (P3). Its expiry " +
    "is a change of state that deletes bytes, so it is a named transition with its event (P7), and the two births tell " +
    "an image (`keep`, no process) from a document (`hold`, which triggers one). Ignoring expired rows at read would " +
    "keep a person's documents in the database for good. A delete by banking would be banking writing media's table " +
    "for no money fact (rules.procedures), and media may not follow banking's changes.",
  source: by("parties/verifications/operations/record-document.ts:53-58; delete-document.ts:9; rules.durable-processes; P3; P7"),
  affects: [
    workflow_media_files_expire_document,
    machine_file,
    event_file_transitioned,
    table_files,
    decision_rules_durable_processes,
  ],
});

// ── the door, the flows and what is not ported ─────────────────────────────────────────────

export const decision_media_door = defineDecision({
  id: "media.door",
  title: "Media has no procedure, and the old bind rpcs are not ported",
  question:
    "Old media had three rpcs: an upload URL, `setProfileImage` and `setOrgLogo`, the last two writing the owner's row. " +
    "What is media's door on the target?",
  options: [
    { label: "upload-only", text: "No procedure: one upload rpc and one serving rpc. Each owner binds a file in its own write, after reading `files`." },
    { label: "bind-procedures", text: "A `media.bind-image` procedure that parties and organizations invoke, as old media bound images for them." },
  ],
  chosen: "upload-only",
  why:
    "No stored file is a money fact, so media has no procedure (rules.procedures), and with owners pointing at files the " +
    "bind is the owner's own write: `parties.profiles.save` for a photo, `organizations.setups.begin` for a logo, " +
    "`banking.verification.start` for documents. Changing a logo after setup has no frozen operation and no caller in " +
    "the old system beyond an unused React hook, so it is not ported (P2); if it comes, it is organizations' rpc over " +
    "`files`. The old upload URL and its separate POST to storage become one rpc, so no storage URL outlives a request " +
    "and the SDK's provider failures for the POST go. OPERATION_OWNERS gives media no operation.",
  source: by("media/README.md (Operations); media/images/writes.ts:16-33; sdk-react media/use-capxul-image-upload.ts (only caller); P2"),
  affects: [concept_media, rpc_media_files_upload, decision_rules_procedures, decision_operations_owners],
});

export const decision_media_flows = defineDecision({
  id: "media.flows",
  title: "Two web-app flows; banking composes the upload in its own flow",
  question: "Media owns no operation. How do clients reach its two rpcs (A4: clients call SDK methods)?",
  options: [
    {
      label: "two-flows",
      text: "`client.media.upload` and `client.media.fetchImage` serve the web app's pages; `verify start`'s flow calls the upload rpc as a step.",
    },
    { label: "no-flows", text: "The web app calls the rpcs through the generated client directly." },
  ],
  chosen: "two-flows",
  why:
    "A4: the Core SDK owns every flow, and a page calls one SDK method. The web app's setup page and Organization " +
    "creation upload an image (`client.media.upload`, the old `client.media.uploadImage` without its storage POST), and " +
    "every page that shows one reads it (`client.media.fetchImage`). Banking's `client.verification.start` reads each " +
    "path on the machine and calls `media.files.upload` as one of its steps (banking depends on media), so `verify " +
    "start` stays one SDK method. Each flow says it serves the react surface.",
  source: by("sdk/src/media/images.ts:41-51; banking/flows.ts (client.verification.start upload step); parties/flows.ts:17; A4"),
  affects: [flow_client_media_upload, flow_client_media_fetch_image, rpc_media_files_upload, rpc_media_files_get],
});

export const decision_media_budgets = defineDecision({
  id: "media.budgets",
  title: "The upload's rpc and web flow leave the write default",
  question: "Which budgets do media's records take (P5)?",
  options: [
    {
      label: "upload-override",
      text: "The upload rpc 900/3000 ms and its web flow 1200/4000 ms, both class write; the serving rpc and flow read; the process background.",
    },
    { label: "defaults", text: "Every record at its class default." },
  ],
  chosen: "upload-override",
  why:
    "A write's 700/1500 ms fits a row, not receiving up to 24 MB: at 100 Mbit/s 24 MB alone takes about 2 s. The " +
    "upload is still one transaction with no outside call, so write stays its class (budget-class-fit). The web flow " +
    "adds the browser's send of an image of up to 5 MiB. Serving one image by its key is a read, and the document's " +
    "process waits on its timer, which is never system time.",
  source: by("packages/blueprint-engine/src/budgets.ts; P5; media.purposes (24 MB)"),
  affects: [rpc_media_files_upload, flow_client_media_upload, rpc_media_files_get, flow_client_media_fetch_image, workflow_media_files_expire_document],
});
