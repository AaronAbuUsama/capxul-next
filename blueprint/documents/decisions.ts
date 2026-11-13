// Every judgment the documents design makes, as a decision record. Made by Claude on 8 November 2026
// under A1-A4 and P1-P10, with the old code (/home/user/factory, integration/factory: old documents,
// old activity's documents area, the SDK's paymentDocuments methods and the CLI's document commands)
// and the frozen book as evidence. There is no as-is book for old documents; the old code was read
// directly.

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { concept_documents, concept_payments } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_UNKNOWN } from "../shared/vocabulary.ts";
import { table_documents } from "./data.ts";
import { procedure_documents_store } from "./procedures.ts";
import { rpc_documents_reading_get, rpc_documents_reading_verify } from "./reading.ts";
import {
  operation_document_get,
  operation_document_verify,
} from "./operations.ts";

const CLAUDE = "Claude, documents design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;
const D = "packages/backend/src/documents";

const OPERATIONS = [operation_document_get, operation_document_verify, ];

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_documents_one_table = defineDecision({
  id: "documents.one-table",
  title: "One immutable documents table holds content, subject and readers",
  question:
    "Old documents kept four tables: the content (`paymentDocuments`), a link per actor and subject " +
    "(`financialDocumentLinks`), a copy of each Movement's Transfer (`financialDocumentMovements`) and its fingerprint " +
    "conflicts. What does the target keep?",
  options: [
    {
      label: "one-row",
      text:
        "One `documents` row per document: the exact bytes, both hashes, what the bytes say (kind, format, media type, " +
        "issue time), its subject and its participants, written once by `documents.store` and never changed.",
    },
    { label: "content-and-links", text: "Port the content table and the link table, one link per reader and subject." },
    { label: "as-is", text: "Port all four tables." },
  ],
  chosen: "one-row",
  why:
    "A document now has exactly one subject and its readers are fixed when it is stored (concepts.documents), so a link " +
    "per actor and subject has nothing left to say that the row cannot: the old links existed because readers were " +
    "rederived from subjects documents had to read. The Movement copy duplicated the Transfer Ponder already holds and " +
    "the Movement payments already records, with a third status (included, orphaned, unresolved) beside payments' " +
    "(P9's duplicate stores); a Memo is immutable, so a reorg changes the Movement, never the document. The conflict log " +
    "recorded two different fingerprints for one logical event: in the target a different Transfer is a different log " +
    "and a different Memo, and nothing reads the log. The line-item and adjustment projections go too: the lines live in " +
    "the Invoice's typed message (documents.kinds), and adjustments were Payslips'.",
  source: by(`${D}/tables.ts:12, :47, :63, :88; ${D}/writes/links.ts:20; ${D}/writes/memos.ts:25`),
  affects: [table_documents, procedure_documents_store, concept_documents],
});

export const decision_documents_tenancy = defineDecision({
  id: "documents.tenancy",
  title: "A document is its subject's owner's row, readable by its participants' Safes",
  question:
    "A document is read by two or three tenants (a payer and a payee, an Organization, its payee and the officer who " +
    "offered). Whose tenant is its row (P8), and how do the others read it?",
  options: [
    {
      label: "owner-and-safes",
      text:
        "`owner` tenancy, the tenant whose subject it is; the participants' Safes on the row; the generated policy admits " +
        "the owner or a session whose Safes include one; the hash-pair index crosses tenants.",
    },
    { label: "copy-per-reader", text: "One row per reader tenant, each with its own copy of the bytes." },
    { label: "global", text: "A global content table, guarded only by the rpcs." },
  ],
  chosen: "owner-and-safes",
  why:
    "It is the shape payments' Payments and requests' payer side already take (payments.two-sided-tenancy, requests' `by_payer_created`): one row, its owner's tenant, its other readers by a column on the row, so row-level security fails closed with no join. A copy per reader would need a tenant for every reader at store time, and a payer outside Capxul has none yet. A global table would leave private invoices to the rpcs alone. The participants are Safes because a Safe is the one name stable across sign-up: a person's Safe is derived from their mailbox before they join, so an outside payer who later signs in reads the invoice they were sent. Review, 11 November 2026: Confirmed documents.tenancy; original choice retained.",
  source: by("blueprint/payments/decisions.ts (payments.two-sided-tenancy); blueprint/requests/data.ts (by_payer_created); P8"),
  affects: [table_documents],
});

export const decision_documents_participants = defineDecision({
  id: "documents.participants",
  title: "Readers are given at store time and checked against current Seats",
  question: "Who may read a document, and how is that decided at read time, now that documents cannot read its subjects?",
  options: [
    {
      label: "current-scope",
      text:
        "The storing concept names the participants (Safe, Party, role). A reader's Safes are their own Party's Safe and " +
        "the company Safe of each Organization where they hold an active Seat now; one must be a participant. A caller " +
        "with no Party of their own has none. Missing and unreadable answer alike.",
    },
    { label: "subject-actors", text: "Keep the old rule: reread the subject's current actors (a Payment's, a request's) at every read." },
    { label: "creator", text: "The tenant that stored it, and the Organization it names." },
  ],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Retained Core chain documents receive fixed participants from the storing concept, without reading their subjects (concepts.documents). Fixing readers at store time keeps an issued Invoice or Memo readable only by its issuer and named payer; a later carrier cannot widen access. Current Organization membership, not the stored creator, decides Organization-side reads: its company Safe matches through the reader's active Seats. A caller with no Party has no Safes; missing and unreadable both refuse as `document not found` on `documentHash`. Rewritten in round 3 for F-2.1 against cut.documents: this rule does not imply a Core payroll dependency. Frappe HR owns runs and Salary Slips; site HR permissions through the door, not generic company-Seat admission, govern salary data. Held site payments bind the canonical draft hash under plugs.document-canon without duplicating payroll documents in Core.",
  source: "The coordinator, m1-old-decisions round 3; cut.documents; concepts.documents; plugs.document-canon; historical participant-admission evidence in docs/cut-archive/decision-review-history.json",
  affects: [table_documents, procedure_documents_store, error_INVALID_INPUT],
});

export const decision_documents_kinds = defineDecision({
  id: "documents.kinds",
  title: "Five kinds in one envelope version: Memo, Invoice, terms, payslip, receipt",
  question:
    "Old documents stored v3 envelopes (Memo, Invoice, Payslip, Receipt), a v4 Invoice with a note and a discount, a v5 Money Invoice and opaque receipt files. Which does the target store?",
  options: [
  {
    "label": "current-scope",
    "text": "Core stores canonical chain-backed memo, Invoice, agreement terms and receipt bytes with hash verification and participant admissions. HR salary slips are site documents, not a second Core payslip envelope created by a Core run. Receipt limits and retained wire types are unchanged; rendering belongs to the site."
  },
  {
    "label": "historical",
    "text": "The former answer to documents.kinds is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Core stores canonical chain-backed memo, Invoice, agreement terms and receipt bytes with hash verification and participant admissions. HR salary slips are site documents, not a second Core payslip envelope created by a Core run. Receipt limits and retained wire types are unchanged; rendering belongs to the site. Authority: cut.documents; plugs.document-canon.",
  source: "The coordinator, round 2, m1-old-decisions; cut.documents; plugs.document-canon",
  affects: [table_documents, procedure_documents_store, rpc_documents_reading_get],
});

export const decision_documents_subject_kinds = defineDecision({
  id: "documents.subject-kinds",
  title: "Subjects are named by the concepts that store them, equity's included",
  question: "Which subjects may a document belong to?",
  options: [
    {
      label: "named",
      text:
        "A closed list: a Payment and a Movement (payments), a request (requests), an agreement (payroll), and equity's " +
        "share or option grant, round, investor commitment and share transfer offer, whose contracts each take a " +
        "document hash.",
    },
    { label: "open", text: "Any string the storing concept chooses." },
  ],
  chosen: "named",
  why:
    "The subject binds the envelope (its origin id) and is how activity finds a Movement's Memo, so its kinds are part " +
    "of the schema, not free text. Equity is being designed at the same time and depends on documents " +
    "(dependencies.of-equity: 'round, SAFE and grant documents are stored with their offers'); its v4 calls taking a " +
    "document hash are offerGrant, grantAndIssue and grant (options), createSafeRound and createPricedRound, signSafe " +
    "and commit, and offerTransfer, so its kinds are listed now rather than left for an edit to this folder.",
  source: by("blueprint/shared/decisions.ts (dependencies.of-equity); blueprint/shared/external.ts (equity contracts' documentHash parameters)"),
  affects: [table_documents, procedure_documents_store],
});

export const decision_documents_unsigned = defineDecision({
  id: "documents.unsigned",
  title: "Capxul signs no document; the signature column goes",
  question: "Old envelopes could carry an EIP-712 signature, checked on read. Does the target keep it?",
  options: [
    {
      label: "unsigned",
      text:
        "No signature column: every envelope is built by `documents.store` and answers `absent`, a receipt file " +
        "`opaque`; `verified` stays in the wire type because the frozen notes list it.",
    },
    { label: "keep", text: "Keep the signature column and its check for envelopes a client supplies already signed." },
  ],
  chosen: "unsigned",
  why:
    "In the target no client supplies an envelope (documents.store-builds), and nothing signs one: the CLI's own line says 'Capxul does not sign documents; Verified checks the stored bytes against the document hash'. Keeping a column nothing writes is P2's orphan. The frozen surface's three values are kept, so a signed kind can return without changing what the commands print. Review, 11 November 2026: Confirmed documents.unsigned; original choice retained.",
  source: by(`apps/cli/src/commands/document/internal/shared.ts:31; ${D}/rules/integrity.ts:84; P2`),
  affects: [table_documents],
});

// ── the door ────────────────────────────────────────────────────────────────────────────────

export const decision_documents_store_builds = defineDecision({
  id: "documents.store-builds",
  title: "documents.store builds the envelope from the subject's facts",
  question:
    "Old payments and requests imported documents' builders, built envelopes themselves (or took a client's bytes), " +
    "then asked documents to admit them against the prepared payment. What does the target door take?",
  options: [
    {
      label: "facts-in",
      text:
        "One procedure, `documents.store`: the storing concept gives the subject, the owner, the participants, the chain, " +
        "the issue time and the typed facts (or a receipt file); documents builds the canonical bytes, computes both " +
        "hashes, writes the row and returns the id and hashes. A replay of the same pair, subject and readers writes nothing.",
    },
    { label: "bytes-in", text: "The invoker builds the envelope with exported builders and stores the bytes; documents admits them against a payable context." },
  ],
  chosen: "facts-in",
  why:
    "Money fact (rules.procedures): a hash on chain with no content behind it is a money bug, so the document must " +
    "commit with its subject (K2). Building inside the door keeps the encoding, the hashing and the size and text limits " +
    "in one concept, so payments, requests, payroll and equity cannot disagree on a hash; the separate admission step " +
    "(`admitPaymentDocumentPairInTx`) existed only because a client's bytes had to be checked against the payment, and " +
    "built bytes cannot differ from the facts they came from. One procedure, invoked once per document, keeps the " +
    "invokers inside sys:tx-width (payments' prepare invokes it beside parties.resolve-recipient and approvals.open). " +
    "A replay must be a no-op because a retried birth and a replayed Transfer store the same document again.",
  source: by(`${D}/index.ts:23; ${D}/reads/contents.ts:153; ${D}/writes/contents.ts:109; docs/as-is/payments.md (K2); rules.procedures`),
  affects: [procedure_documents_store, table_documents],
});

export const decision_documents_movement_memos = defineDecision({
  id: "documents.movement-memos",
  title: "A Movement's Memo is stored with the Movement, by payments",
  question:
    "Old payments' scan and evidence paths wrote a Movement's Memo through documents' Memo writers, documents tracked " +
    "each occurrence and its reorgs, and `documents.memos.ensure` could write Memos on demand. Who stores a Movement's " +
    "Memo in the target?",
  options: [
    {
      label: "with-the-movement",
      text:
        "Payments' Movement record invokes `documents.store` with the Transfer's Memo (basis movement, issued at its block " +
        "time, the Movement's sides as participants), so one Transfer always gives one Memo. Ensure, its authorize and " +
        "persist steps, the orphan markers and the occurrence copy go.",
    },
    { label: "on-demand", text: "Keep `documents.memos.ensure`: a reader asks documents to prove the Transfer on chain and store its Memo." },
    { label: "none", text: "Drop Movement Memos." },
  ],
  chosen: "with-the-movement",
  why:
    "A frozen line needs them ('A standalone Movement participant can verify its exact Memo'), so they stay. Documents " +
    "cannot follow a Movement (payments sits above it), and a procedure is the only way into documents' table, so the " +
    "Memo is written where the Movement is, in the same transaction: a Movement and the document that records it are " +
    "the same money fact, as a Payment and its document are. `ensure` had no caller in the SDK or the CLI (P2) and " +
    "proved on chain what Ponder already indexes. The Memo is a pure function of the Transfer once its issue time is the " +
    "block time, so a replayed or restored Transfer stores nothing new; a reorg is the Movement's `remove`, and the Memo, " +
    "immutable, stays. Payments' `payments.movements.record` does not invoke `documents.store` yet: that is a change " +
    "for payments' designer, and until it lands the frozen verify line has no Memo to verify.",
  source: by(`${D}/memos/operations/ensure.ts:13; ${D}/writes/memos.ts:219; ${D}/writes/occurrences.ts:8; old payments/movements/writes/windows.ts:66`),
  affects: [procedure_documents_store, table_documents, concept_payments, operation_document_verify],
});

export const decision_documents_movement_subject = defineDecision({
  id: "documents.movement-subject",
  title: "A Movement's Memo is keyed by its Transfer's log id, never by one side",
  question:
    "Since payments.movement-occurrence, payments keys a Movement by indexing's receipt-ordinal log id `<chain id>:<tx " +
    "hash>:<ordinal in its receipt>` and names it `<log id>:<side>`, the id Activity's change log copies " +
    "(activity.row-ids). Documents still named a Movement Memo's subject and reference by the block-global " +
    "`<chain id>:<tx hash>:<log index>`. Which key does the Memo of a Movement carry?",
  options: [
    {
      label: "log-id",
      text:
        "Subject `movement` with id the Transfer's log id, and the same bare log id as the Memo's reference: one Memo for " +
        "every side, which `activity get` finds by dropping `:<side>` from the Movement id.",
    },
    { label: "per-side", text: "Subject id `<log id>:<side>`: one Memo per Movement row, each naming one side." },
    { label: "money-key", text: "Reference books' money key `transfer:<log id>`, with the bare log id as subject." },
  ],
  chosen: "log-id",
  why:
    "A block-global log index shifts when a transaction is re-included at another position, so the old key could name " +
    "another Transfer's Memo after a reorg; the receipt ordinal is the occurrence's own name. A Memo records one Transfer " +
    "and names every Capxul side as a participant (documents.movement-memos), so a per-side key would store two documents " +
    "for one money fact, and each would hide the other side's view. The reference is inside the hashed, immutable bytes " +
    "and `basis: movement` already says what it names, so it carries the log id alone; `transfer:` is books' namespace " +
    "for telling money keys apart, not part of what the Memo records. Documents stays agnostic of the id's parts: the " +
    "storer gives the key and `by_subject` matches it exactly.",
  source:
    "Integrator cross-lane review, 13 November 2026; payments.movement-occurrence (PR #124); activity.row-ids (PR #163); " +
    "documents.movement-memos",
  affects: [procedure_documents_store, table_documents],
});

export const decision_documents_no_machine_no_process = defineDecision({
  id: "documents.no-machine-no-process",
  title: "No state machine, no event and no process",
  question: "Does a document have a status, an event or a durable process?",
  options: [
    { label: "none", text: "None: a document is written once and never changes; its subject's machine carries the funnel." },
    { label: "stored-machine", text: "A `document` machine with one `store` transition, sending `document_transitioned`." },
  ],
  chosen: "none",
  why:
    "P7 sends an event from a status write, and a document has no status to write: its subject's birth transition " +
    "(a Payment's `open`, a request's `issue`, an agreement's `prepare`) already marks the same moment for the funnel, " +
    "and a machine with one birth and no other state would be an emit-only record. Nothing about a document waits, so " +
    "it has no process (A3), and the old background work goes with it (documents.movement-memos).",
  source: by(`${D}/memos/events.ts:21; P3; P7`),
  affects: [table_documents, concept_documents],
});

// ── the reads ───────────────────────────────────────────────────────────────────────────────

export const decision_documents_rpcs_and_flows = defineDecision({
  id: "documents.rpcs-and-flows",
  title: "Three read rpcs; export and render are SDK flows",
  question:
    "Old activity owned the three document rows (get, verify, render) and `document export` reused `get`. How are the four commands implemented (A4)?",
  options: [
  {
    "label": "current-scope",
    "text": "Core retains canonical get and verify and local file export of those bytes. Print Format/rendering and salary-slip export use the company site through the door. Archive the removed documents.reading.render rpc and do not make the Core SDK a second rendering engine."
  },
  {
    "label": "historical",
    "text": "The former answer to documents.rpcs-and-flows is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Core retains canonical get and verify and local file export of those bytes. Print Format/rendering and salary-slip export use the company site through the door. Archive the removed documents.reading.render rpc and do not make the Core SDK a second rendering engine. Authority: cut.documents; plugs.document-canon.",
  source: "The coordinator, round 2, m1-old-decisions; cut.documents; plugs.document-canon",
  affects: [...OPERATIONS],
});

export const decision_documents_verify_answers = defineDecision({
  id: "documents.verify-answers",
  title: "Verify answers ok false; get, render and export refuse",
  question:
    "The old backend's verify threw UNKNOWN on any stored-row mismatch and never answered `ok` false, though the frozen " +
    "line says 'A negative verification still completes, reporting ok false'. What does the target do?",
  options: [
    {
      label: "verify-answers",
      text:
        "Verify runs the integrity checks as its question and answers `ok` false when one fails; get, render (and so " +
        "export) treat a failure as a defect, UNKNOWN naming the check.",
    },
    { label: "as-is", text: "Verify throws UNKNOWN like the others; `ok` false is only a value the CLI can print." },
  ],
  chosen: "verify-answers",
  why:
    "P10: the frozen book wins where it and the old code disagree, and its line is only checkable by a black box if the backend can answer `ok` false (the old test reached it only by mocking the SDK). A verify that cannot say no is not a check. The readers that hand the document on (its bytes, its PDF) must not hand on bad bytes, so they still refuse, as the frozen get line requires ('tampering with a hashed note is detected'). Review, 11 November 2026: Confirmed documents.verify-answers; original choice retained.",
  source: by(`${D}/reads/contents.ts:72; apps/cli/src/commands/document/tests/document.test.ts:83, :115; P10`),
  affects: [rpc_documents_reading_verify, rpc_documents_reading_get, operation_document_verify, error_UNKNOWN],
});

export const decision_documents_no_org_hint = defineDecision({
  id: "documents.no-org-hint",
  title: "The Organization hint and the read observer go",
  question:
    "Old verify and render took the caller's Organization hint and reported what the read proved (integrity, the " +
    "Organization) to a wide event. Does the target keep them?",
  options: [
    { label: "drop", text: "Drop both: access needs no hint, and the runtime's span records the read." },
    { label: "keep", text: "Keep the hint as an input and the observations as span attributes." },
  ],
  chosen: "drop",
  why:
    "The hint never granted access ('never selects an unrelated Organization'); it only labelled telemetry. Spans are the runtime's (P6) and no rpc sends an event (P7), so an input that exists for telemetry has no place on the wire. Review, 11 November 2026: Confirmed documents.no-org-hint; original choice retained.",
  source: by(`${D}/guards.ts:143; packages/backend/src/activity/documents/reads.ts:28; P6; P7`),
  affects: [rpc_documents_reading_verify],
});

// ── operations ──────────────────────────────────────────────────────────────────────────────

export const decision_documents_worlds = defineDecision({
  id: "documents.worlds",
  title: "Two worlds reach every documents refusal and line",
  question: "Which devnet worlds do the documents operations name?",
  options: [
  {
    "label": "current-scope",
    "text": "Retain removed-member, newly admitted member, counterparty, stranger, no-Party and tampered-byte document cases on world snapshots. Salary-slip privacy/rendering cases run on the site, not on a submitted Core payroll fixture. signed-out still proves unauthenticated refusal."
  },
  {
    "label": "historical",
    "text": "The former answer to documents.worlds is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Retain removed-member, newly admitted member, counterparty, stranger, no-Party and tampered-byte document cases on world snapshots. Salary-slip privacy/rendering cases run on the site, not on a submitted Core payroll fixture. signed-out still proves unauthenticated refusal. Authority: cut.documents; plugs.document-canon.",
  source: "The coordinator, round 2, m1-old-decisions; cut.documents; plugs.document-canon",
  affects: OPERATIONS,
});

// ── payslips (the payroll lane of the Frappe redesign, 8 November 2026) ────────────────────

export const decision_documents_payslip_kind = defineDecision({
  id: "documents.payslip-kind",
  title: "Archived: A payslip is a typed envelope, stored when its salary slip is submitte",
  question:
    "Payroll's runs are back in Frappe HR's shape (payroll.scope), and each slip's net is a Payment whose document hash goes on chain. Is the payslip a receipt file, or a typed kind documents builds and checks?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive Core salary-slip payslip-envelope creation at run submit/head import. Frappe HR owns Salary Slip and its print form; any payment document hash uses the current canonical form. This does not expose salary lines to every company member or restore a Core payroll run."
  },
  {
    "label": "historical",
    "text": "The former answer to documents.payslip-kind is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive Core salary-slip payslip-envelope creation at run submit/head import. Frappe HR owns Salary Slip and its print form; any payment document hash uses the current canonical form. This does not expose salary lines to every company member or restore a Core payroll run. Authority: cut.documents; plugs.document-canon.",
  source: "The coordinator, round 2, m1-old-decisions; cut.documents; plugs.document-canon",
  affects: [table_documents, procedure_documents_store, ],
});

export const decision_documents_payslip_readers = defineDecision({
  id: "documents.payslip-readers",
  title: "A payslip is its employee's and the People hat's, not every member's",
  question:
    "A payslip's participants are the employee's Safe and the paying company Safe, and an Organization participant is read by every member with an active Seat, so any member could `document render` a colleague's payslip, while `payroll payslip get` never shows someone else's. Who reads a payslip's Organization side?",
  options: [
  {
    "label": "current-scope",
    "text": "Employee salary data is private: the employee and authorized HR/People roles on the site may read it, not every company Seat. Archive the Core kind=payslip participant exception as the implementation; site HR permissions enforce the rule and no generic door read bypasses them."
  },
  {
    "label": "historical",
    "text": "The former answer to documents.payslip-readers is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Employee salary data is private: the employee and authorized HR/People roles on the site may read it, not every company Seat. Archive the Core kind=payslip participant exception as the implementation; site HR permissions enforce the rule and no generic door read bypasses them. Authority: cut.documents; plugs.document-canon.",
  source: "The coordinator, round 2, m1-old-decisions; cut.documents; plugs.document-canon",
  affects: [rpc_documents_reading_get, rpc_documents_reading_verify, table_documents],
});

export const decision_documents_core_store_scope = defineDecision({
  id: "documents.core-store-scope",
  title: "Reconcile new Core stores with the already accepted site HR boundary",
  question: "Do stale PayslipContent and salary-slip creation inputs override the current-scope decisions?",
  options: [
    { label: "four-kinds", text: "New Core stores admit memo, invoice, terms and receipt only; reject payslip and salary-slip creation. Preserve historical row and read vocabulary without a new Core HR reader." },
    { label: "core-hr", text: "Restore Core payslip creation and HR permission projections." },
  ],
  chosen: "four-kinds",
  why: "documents.kinds, documents.payslip-kind and documents.payslip-readers already archive Core salary-slip creation and make Frappe HR the authority. The stale procedure input and prose cannot restore that mechanism. Historical stored kind/subject values and read wire shapes remain compatible; no broader historical acceptance is credited. New payslip or salary-slip store input is INVALID_INPUT before any write.",
  source: "Sol integration agreement, 12 November 2026; current-scope documents.kinds, documents.payslip-kind, documents.payslip-readers; cut.documents",
  affects: [procedure_documents_store, table_documents, rpc_documents_reading_get, rpc_documents_reading_verify],
});

export const decision_documents_encoding_v1 = defineDecision({
  id: "documents.encoding-v1",
  title: "A new explicit canonical document envelope version",
  question: "Which exact bytes and EIP-712 message does the new Core store commit to?",
  options: [
    { label: "explicit-v1", text: "New v1 JSON envelopes use recursively sorted object keys, original array order, UTF-8 and no whitespace. Hash exact bytes for content_hash; use an explicit EIP-712 Document message for document_hash and fixed independent byte/hash vectors." },
    { label: "implicit", text: "Let each writer choose its JSON ordering and typed domain." },
  ],
  chosen: "explicit-v1",
  why: "This is a new version, not an assertion of old-wire compatibility. The envelope is {version:1,originId,kind,issuedAt,content}. originId is keccak256 of UTF-8 subject_kind + ':' + subject_id. EIP-712 domain is name 'Capxul Document', version '1', chainId; primary type Document has originId:bytes32, kind:string, issuedAt:uint256, contentHash:bytes32 in that order. Its contentHash is keccak256 of canonical content, avoiding a self-referential envelope hash. Addresses are lowercase; amounts are decimal integer strings. Receipt artifacts remain exact bytes with equal hashes. Known independent vectors pin both encoding and domain; changing either requires a new version.",
  source: "Sol integration agreement, 12 November 2026; documents.store-builds and procedure documents.store lacked exact encoding; frozen document operations prescribe integrity, not a fixed byte vector",
  affects: [procedure_documents_store, table_documents, rpc_documents_reading_get, rpc_documents_reading_verify],
});

export const decision_documents_postgres_store = defineDecision({
  id: "documents.postgres-store",
  title: "An immutable insert door in the invoker's checked-out Postgres transaction",
  question: "How does the new Core storage implementation prevent runtime update/delete and serialize a repeated hash pair?",
  options: [
    { label: "immutable-door", text: "Runtime roles read but have no table DML. A fixed insert/replay function, owned by a non-login non-bypass role, checks current owner and the pair under a transaction lock; the canonical TypeScript store validates content before invoking it." },
    { label: "table-dml", text: "Give runtime roles insert/update/delete and rely on callers to keep the document immutable." },
  ],
  chosen: "immutable-door",
  why: "A repeated birth must not race another insert, and a chain hash must never acquire new bytes or readers. The function has fixed search_path, no public execute, no update/delete path and no independent commit. Owner tenancy admits the authenticated owner (Access's person) or a current Seat of the owning Organization, never owner labels alone, so an internal read goes through a session, a Seat or the worker policy; public get/verify still require current caller_safes participation and exclude salary documents, whose readers belong to Frappe HR. This is local implementation scope, not production migration or security-design approval, and does not establish complete writer or participant acceptance without the composed real-stack run.",
  source: "Agents/documents/media implementation, 12 November 2026; documents.tenancy, documents.participants, documents.core-store-scope; same-Sql contract",
  affects: [procedure_documents_store, table_documents, rpc_documents_reading_get, rpc_documents_reading_verify],
});

export const decision_documents_public_transport = defineDecision({
  id: "documents.public-transport",
  title: "Authenticated hash-pair reads have isolated public route hooks",
  question: "How does Core expose retained get and verify without diagnostic HMAC or caller-supplied identity?",
  options: [
    { label: "bearer-hooks", text: "POST /documents/reading/get and /documents/reading/verify take the existing hash-pair JSON. The integrator injects Access.authenticate on the same checked-out Sql, using the raw Authorization bearer and canonical worldNow before the read. Responses retain the existing wire shapes." },
    { label: "diagnostic", text: "Use the admin diagnostic HMAC ingress for document readers." },
  ],
  chosen: "bearer-hooks",
  why: "Diagnostic service authority is not participant authority. Public hooks use real session authentication and current-Seat SQL admission, never request owner, person or Safe labels. The integrator retains routing, transaction/drain and migration ownership. No public store route, payroll reader, changed hash encoding or acceptance credit is introduced.",
  source: "Wave0 continuation, 12 November 2026; documents.participants; Access same-Sql opaque-session contract",
  affects: [rpc_documents_reading_get, rpc_documents_reading_verify],
});
