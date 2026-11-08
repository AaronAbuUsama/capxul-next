// Every judgment the documents design makes, as a decision record. Made by Claude on 8 November 2026
// under A1-A4 and P1-P10, with the old code (/home/user/factory, integration/factory: old documents,
// old activity's documents area, the SDK's paymentDocuments methods and the CLI's document commands)
// and the frozen book as evidence. There is no as-is book for old documents; the old code was read
// directly.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_documents, concept_payments } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_UNKNOWN } from "../shared/vocabulary.ts";
import { table_documents } from "./data.ts";
import { procedure_documents_store } from "./procedures.ts";
import { rpc_documents_reading_get, rpc_documents_reading_render, rpc_documents_reading_verify } from "./reading.ts";
import { flow_client_payment_documents_export, flow_client_payment_documents_render } from "./flows.ts";
import {
  operation_document_export,
  operation_document_get,
  operation_document_render,
  operation_document_verify,
} from "./operations.ts";

const CLAUDE = "Claude, documents design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;
const D = "packages/backend/src/documents";

const RPCS = [rpc_documents_reading_get, rpc_documents_reading_verify, rpc_documents_reading_render];
const FLOWS = [flow_client_payment_documents_render, flow_client_payment_documents_export];
const OPERATIONS = [operation_document_get, operation_document_verify, operation_document_render, operation_document_export];

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
    "It is the shape payments' Payments and requests' payer side already take (payments.two-sided-tenancy, requests' " +
    "`by_payer_created`): one row, its owner's tenant, its other readers by a column on the row, so row-level security " +
    "fails closed with no join. A copy per reader would need a tenant for every reader at store time, and a payer outside " +
    "Capxul has none yet. A global table would leave private invoices to the rpcs alone. The participants are Safes " +
    "because a Safe is the one name stable across sign-up: a person's Safe is derived from their mailbox before they " +
    "join, so an outside payer who later signs in reads the invoice they were sent.",
  source: by("books/target/payments/decisions.ts (payments.two-sided-tenancy); books/target/requests/data.ts (by_payer_created); P8"),
  affects: [table_documents, ...RPCS],
});

export const decision_documents_participants = defineDecision({
  id: "documents.participants",
  title: "Readers are given at store time and checked against current Seats",
  question: "Who may read a document, and how is that decided at read time, now that documents cannot read its subjects?",
  options: [
    {
      label: "given-participants",
      text:
        "The storing concept names the participants (Safe, Party, role). A reader's Safes are their own Party's Safe and " +
        "the company Safe of each Organization where they hold an active Seat now; one must be a participant. A caller " +
        "with no Party of their own has none. Missing and unreadable answer alike.",
    },
    { label: "subject-actors", text: "Keep the old rule: reread the subject's current actors (a Payment's, a request's) at every read." },
    { label: "creator", text: "The tenant that stored it, and the Organization it names." },
  ],
  chosen: "given-participants",
  why:
    "Documents sits below payments, requests and payroll (concepts.documents), so the old rule, which read payments' " +
    "participants and requests' invoice access at every read, would need the edges the map removed. Fixing readers at " +
    "store time also keeps the old privacy guarantee by construction: an issued Invoice or Memo is readable only by its " +
    "issuer and named payer, and a later carrier cannot widen it, because nothing adds a reader. The frozen line 'Current " +
    "Organization membership decides reads, not the stored creator' holds because an Organization participant is its " +
    "company Safe, matched through the reader's active Seats at read time. 'Strangers and accountless callers get the " +
    "same missing-pair refusal' holds because a caller with no Party of their own has no Safes, and every refusal is " +
    "`document not found` on `documentHash`.",
  source: by(`${D}/guards.ts:100, :149; packages/backend/src/activity/documents/tests/get.test.ts:191, :249; ${D}/README.md:23`),
  affects: [table_documents, procedure_documents_store, ...RPCS, error_INVALID_INPUT],
});

export const decision_documents_kinds = defineDecision({
  id: "documents.kinds",
  title: "Five kinds in one envelope version: Memo, Invoice, terms, payslip, receipt",
  question:
    "Old documents stored v3 envelopes (Memo, Invoice, Payslip, Receipt), a v4 Invoice with a note and a discount, a v5 " +
    "Money Invoice and opaque receipt files. Which does the target store?",
  options: [
    {
      label: "five-kinds",
      text:
        "One envelope version with four typed kinds, a Memo (a Payment's or request's, or a Movement's), an Invoice " +
        "with its lines and note in the typed message, the terms of an offer (an agreement, an equity offer) and a " +
        "payslip (a submitted salary slip's pay, documents.payslip-kind), plus receipt files of at most 128 KB.",
    },
    { label: "as-is", text: "Keep v3, v4 and v5 envelopes and the receipt files, each with its own format." },
  ],
  chosen: "five-kinds",
  why:
    "The target is a fresh v4 deployment with nothing migrated (P9 option A), so no stored v3 or v4 envelope needs " +
    "reading and one version is enough. A v4 Agreement commits to one terms document whose hash every collection " +
    "carries, and equity's grants, rounds and transfers commit to theirs, so 'terms' is a new kind. Payslips come back " +
    "with payroll's runs in Frappe HR's shape (payroll.scope), typed, so Capxul renders and checks " +
    "them (documents.payslip-kind). Money Invoices are dropped with requests' fiat invoices " +
    "(requests' decisions). The Invoice's lines go into its typed message instead of a separate column checked against " +
    "a lines hash, so the two hashes are the whole integrity check. Receipt files stay: payments' `document` input is " +
    "one, and the frozen render line names an opaque receipt.",
  source: by("packages/protocol/src/documents/schema.ts:162, :193, :211; packages/protocol/src/documents/codec.ts:134; P9; books/target/payments/commands.ts (SendInput.document)"),
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
  source: by("books/target/shared/decisions.ts (dependencies.of-equity); books/target/shared/external.ts (equity contracts' documentHash parameters)"),
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
    "In the target no client supplies an envelope (documents.store-builds), and nothing signs one: the CLI's own line " +
    "says 'Capxul does not sign documents; Verified checks the stored bytes against the document hash'. Keeping a " +
    "column nothing writes is P2's orphan. The frozen surface's three values are kept, so a signed kind can return " +
    "without changing what the commands print.",
  source: by(`apps/cli/src/commands/document/internal/shared.ts:31; ${D}/rules/integrity.ts:84; P2`),
  affects: [table_documents, ...RPCS],
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
    "Old activity owned the three document rows (get, verify, render) and `document export` reused `get`. How are the " +
    "four commands implemented (A4)?",
  options: [
    {
      label: "three-rpcs-two-flows",
      text:
        "Documents' `reading` area has get (with the bytes), verify and render. `document get` and `verify` are " +
        "implemented by their rpc; `export` and `render` by a flow that adds the local file work, each its own SDK method " +
        "under `client.paymentDocuments`.",
    },
    { label: "four-rpcs", text: "A separate download rpc for export, and get without bytes." },
    { label: "cli-writes", text: "The CLI calls the rpc and writes the files itself." },
  ],
  chosen: "three-rpcs-two-flows",
  why:
    "The rows read documents' content, so they are documents' rpcs, not activity's (old review-agent named the three " +
    "names for one thing). A4 puts every local step in the SDK, so writing the exported file and printing the PDF are " +
    "flow steps, and the CLI calls exactly one method. `get` keeps the bytes because its frozen first line says it " +
    "'returns the exact stored bytes', and export needs exactly that answer: a second rpc would serve the same read " +
    "twice. The SDK namespace stays the frozen pages' `client.paymentDocuments`; `export` is the one new method.",
  source: by("packages/protocol/src/activity/operations.ts:142; packages/sdk/src/activity/documents.ts:86; docs/as-is/lane-reports/review-agent.json; A4"),
  affects: [...RPCS, ...FLOWS, ...OPERATIONS],
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
    "P10: the frozen book wins where it and the old code disagree, and its line is only checkable by a black box if " +
    "the backend can answer `ok` false (the old test reached it only by mocking the SDK). A verify that cannot say no " +
    "is not a check. The readers that hand the document on (its bytes, its PDF) must not hand on bad bytes, so they " +
    "still refuse, as the frozen get line requires ('tampering with a hashed note is detected').",
  source: by(`${D}/reads/contents.ts:72; apps/cli/src/commands/document/tests/document.test.ts:83, :115; P10`),
  affects: [rpc_documents_reading_verify, rpc_documents_reading_get, rpc_documents_reading_render, operation_document_verify, error_UNKNOWN],
});

export const decision_documents_render_names = defineDecision({
  id: "documents.render-names",
  title: "Render names parties by their public names, and adds no link",
  question: "What does a rendered document show beyond its stored fields?",
  options: [
    {
      label: "public-names",
      text:
        "The current public name of each party it names (an Organization's name; a person's or agent's display name, " +
        "else handle, else Safe shortened; never a Party id or a mailbox), read after the checks; no checkout link.",
    },
    { label: "as-is", text: "Names with a mailbox fallback for a payslip, and the request's checkout link from requests." },
  ],
  chosen: "public-names",
  why:
    "The names are read from parties and organizations, which documents depends on, only after access and integrity " +
    "pass, and they never enter the stored bytes. A mailbox is left out because a counterparty who named someone by " +
    "handle never typed it (the contacts rule). The checkout link came from requests, which documents may not read; the " +
    "request's own reads and notices print it.",
  source: by(`${D}/reads/parties.ts:47; ${D}/reads/contents.ts:104; books/target/contacts/book.ts (Entry.label)`),
  affects: [rpc_documents_reading_render, operation_document_render],
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
    "The hint never granted access ('never selects an unrelated Organization'); it only labelled telemetry. Spans are " +
    "the runtime's (P6) and no rpc sends an event (P7), so an input that exists for telemetry has no place on the wire.",
  source: by(`${D}/guards.ts:143; packages/backend/src/activity/documents/reads.ts:28; P6; P7`),
  affects: [rpc_documents_reading_verify, rpc_documents_reading_render],
});

// ── operations ──────────────────────────────────────────────────────────────────────────────

export const decision_documents_acceptance_rewrites = defineDecision({
  id: "documents.acceptance-rewrites",
  title: "`document render` #1 is kept word for word: payslips are stored again",
  question:
    "The frozen line 'A payslip names its employer and employee, not their Party IDs.' was rewritten while the target " +
    "stored no payslip. Payroll now stores one per submitted salary slip (documents.payslip-kind). Keep, retire or rewrite it?",
  options: [
    { label: "keep", text: "Keep it word for word, reached by rendering a run's payslip in `org-with-documents`." },
    {
      label: "rewrite",
      text:
        "'A document that names an employer and an employee (a payslip, or an agreement's terms) renders their names, " +
        "not their Party IDs.', the old line in `was`, as while no payslip was stored.",
    },
    { label: "retire", text: "Retire it as null, as P9 does for pre-v4-only lines." },
  ],
  chosen: "keep",
  why:
    "The rewrite existed only because the target stored no payslip, and went beyond P1 (a payslip is not a mechanism), " +
    "so it was flagged for review as W1. With payroll's runs back in Frappe HR's shape, every submitted salary slip has " +
    "a typed payslip, and render lays out its employer and employee by their public names (documents.render-names). " +
    "The frozen line now reads as an outcome a world can reach, so it is kept word for word (system.frozen-behaviour), " +
    "and W1 is settled by it. Every other line of the four operations is kept word for word too.",
  source: by("books/frozen/operations.ts (document.render acceptance 1); packages/backend/src/activity/documents/tests/render.test.ts:89; P1; books/target/payroll/decisions.ts (payroll.scope)"),
  affects: [operation_document_render, rpc_documents_reading_render],
});

export const decision_documents_worlds = defineDecision({
  id: "documents.worlds",
  title: "Two worlds reach every documents refusal and line",
  question: "Which devnet worlds do the documents operations name?",
  options: [
    {
      label: "two-new",
      text:
        "`org-with-documents` (new): an Organization with a member who stored documents for it and was then removed and " +
        "a member who joined after; a person it paid with a note; an Invoice the person issued it; a salary agreement's " +
        "terms; a submitted payroll run's payslip for an Employee; a receipt file on a Payment; a Movement's Memo from an outside Transfer to the person; a signed-in " +
        "stranger; and a signed-in person with no Party of their own. `org-with-tampered-note` (new): the same with one " +
        "stored note's bytes altered after it was stored. `signed-out` (shared) for NOT_AUTHENTICATED.",
    },
    { label: "per-line", text: "A world per acceptance line." },
  ],
  chosen: "two-new",
  why:
    "Every refusal (CLI_USAGE, INVALID_INPUT) and every kept line is reached from one world that holds a document of " +
    "each kind and each kind of reader; the tampered note is its own world because altering stored bytes is a fault no " +
    "operation can make, and every other run must see clean bytes.",
  source: by("books/frozen/operations.ts (document.* refusals and acceptance); packages/scenarios/src/acme/s18-dana-reads-her-payment-surface.scenario.ts:89"),
  affects: OPERATIONS,
});

export const decision_documents_render_budget = defineDecision({
  id: "documents.render-budget",
  title: "`document render` takes a longer read budget for its browser",
  question: "Which budget does `document render` take (P5)?",
  options: [
    { label: "override", text: "The read class at 2.5 s p50 and 6 s p95, the first-run browser download excluded." },
    { label: "read", text: "The read class default, 600 ms p50 and 1.2 s p95." },
  ],
  chosen: "override",
  why:
    "After its one read the command launches a headless browser on this machine, loads the embedded font and prints an " +
    "A4 PDF: local work the read class does not anticipate, measured in seconds in the old CLI. A browser that is not " +
    "installed is downloaded once, which is its own span (`sdk.step.browser-install`) and excluded. Get, verify and " +
    "export keep the read default: one read and, for export, one small file write.",
  source: by("apps/cli/src/platform/documents.ts:16, :41; P5"),
  affects: [flow_client_payment_documents_render, operation_document_render],
});

// ── payslips (the payroll lane of the Frappe redesign, 8 November 2026) ────────────────────

export const decision_documents_payslip_kind = defineDecision({
  id: "documents.payslip-kind",
  title: "A payslip is a typed envelope, stored when its salary slip is submitted",
  question:
    "Payroll's runs are back in Frappe HR's shape (payroll.scope), and each slip's net is a Payment " +
    "whose document hash goes on chain. Is the payslip a receipt file, or a typed kind documents builds and checks?",
  options: [
    {
      label: "typed",
      text:
        "A fifth envelope kind, `payslip`: the slip's id and run, employer and employee by Party and Safe, the period and " +
        "its days, the earnings, deductions and employer contributions by component, and gross, total deduction and net " +
        "in one token, earnings less deductions equal to the net exactly. Subject kind `salary-slip`; the payer and payee " +
        "read it. Payroll stores it when a run is submitted or taken in from a head.",
    },
    { label: "receipt", text: "A PDF or JSON receipt file of at most 128 KB, kept byte for byte and never interpreted." },
  ],
  chosen: "typed",
  why:
    "A receipt file is opaque: documents could not render a payslip's names (documents.render-names) or check that its " +
    "lines make its net, and the frozen render line 'A payslip names its employer and employee' could not be reached. A " +
    "typed envelope binds the slip to its chain (EIP-712) and to its Payment, so the employee proves what they were paid " +
    "for, and the same rows are Frappe's Salary Detail, so a head shows the very slip. An agreement collection's slip " +
    "stores no payslip: its collection already carries the terms document's hash (payroll.collection-slips).",
  source: by("/tmp/hrms/hrms/payroll/doctype/salary_slip/salary_slip.json; docs/vision/erp.md (C8); books/target/payroll/decisions.ts (payroll.scope)"),
  affects: [table_documents, procedure_documents_store, rpc_documents_reading_render, operation_document_render],
});
