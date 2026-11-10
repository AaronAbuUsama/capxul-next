// Moved out of the built book by the cut, 10 November 2026, from books/target/documents/decisions.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

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

const RPCS = [rpc_documents_reading_get, rpc_documents_reading_verify, rpc_documents_reading_render];

const FLOWS = [flow_client_payment_documents_render, flow_client_payment_documents_export];

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
