// Moved out of the built book by the cut, 10 November 2026, from books/target/documents/operations.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineOperation } from "../../../packages/book/src/index.ts";
import { frozen, frozenRefusals, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CLI_DEFECT,
  error_CLI_STORAGE,
  error_CLI_USAGE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
} from "../shared/vocabulary.ts";
import { MediaType } from "./data.ts";
import { DocumentRef, SignatureStatus, rpc_documents_reading_get, rpc_documents_reading_verify } from "./reading.ts";
import { RENDER_BUDGET, flow_client_payment_documents_export, flow_client_payment_documents_render } from "./flows.ts";

// The CLI checks the pair and calls `client.paymentDocuments.render` (the flow), which saves the PDF and
// its HTML copy into a new private folder and returns where.
export const operation_document_render = defineOperation({
  ...frozenText("document.render"),
  was: [
    page("document.render"),
    `${CLI}/subcommands/render/execute.ts:15`,
    `${CLI}/internal/shared.ts:10`,
    `${S18}:389`,
    "docs/as-is/archive/operations/payments.ts:1150",
  ],
  priority: "normal",
  implementedBy: flow_client_payment_documents_render,
  acceptance: [
    kept(
      "document.render",
      1,
      `cli: in \`${WORLD_DOCUMENTS}\`, \`document render\` of a submitted run's payslip saves a PDF whose HTML copy ` +
        "names the Organization by its name and the employee by their display name, and contains no `party_` id; the " +
        "same holds for a salary agreement's terms.",
    ),
    kept(
      "document.render",
      2,
      `cli: in \`${WORLD_DOCUMENTS}\`, \`document render\` of the receipt file saves HTML holding only an escaped summary ` +
        "(media type, file name, size) and none of the file's bytes; read: `document export` of the same pair still " +
        "writes bytes whose keccak-256 is its content hash.",
    ),
    kept(
      "document.render",
      3,
      "cli: a reply naming another pair exits CLI_USAGE, and an `--output-dir` the CLI cannot write exits CLI_STORAGE " +
        "with a non-zero exit; world: neither run leaves a new folder or file under the documents folder.",
    ),
  ],
  returns: Schema.Struct({
    document: flow_client_payment_documents_render.output.fields.document, // The saved PDF's path, with its kind, document hash and content hash.
  }),
  errors: [error_CLI_USAGE, error_CLI_STORAGE, error_CLI_DEFECT],
  refusals: refusals("document.render"),
  budget: RENDER_BUDGET,
});

// The CLI checks the pair and a non-empty `--out`, and calls `client.paymentDocuments.export` (the flow),
// which writes the exact bytes to a new file.
export const operation_document_export = defineOperation({
  ...frozenText("document.export"),
  was: [
    page("document.export"),
    `${CLI}/subcommands/export/execute.ts:13`,
    `${CLI}/subcommands/export/command.ts:15`,
    `${S18}:329`,
    "docs/as-is/archive/operations/payments.ts:1195",
  ],
  priority: "normal",
  implementedBy: flow_client_payment_documents_export,
  acceptance: [
    kept(
      "document.export",
      1,
      `cli: in \`${WORLD_DOCUMENTS}\`, exporting the receipt file to a new path prints a \`byteLength\` equal to its stored ` +
        "size, and a second export to the same path exits CLI_USAGE; world: the first file's keccak-256 is the content " +
        "hash, its mode is 0600, and it is byte for byte unchanged after the second run.",
    ),
    kept(
      "document.export",
      2,
      "cli: a 31-byte hash, a hash without `0x`, and a reply naming another pair each exit CLI_USAGE; world: no file " +
        "exists at `--out` after any of them.",
    ),
    kept(
      "document.export",
      3,
      "cli: the same pair in upper-case hex exports the same bytes and prints the pair in lower case.",
    ),
  ],
  returns: flow_client_payment_documents_export.output,
  errors: [error_CLI_USAGE, error_CLI_STORAGE],
  refusals: refusals("document.export"),
  budget: budget("read"),
});
