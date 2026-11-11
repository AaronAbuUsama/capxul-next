// The four frozen operations documents owns (OPERATION_OWNERS): `document get`, `verify`, `render` and
// `export`. Text comes from the frozen book through frozenText, never retyped. Every acceptance claim is
// the frozen one word for word, `document render` #1 included now that payroll stores payslips again
// (decisions documents.acceptance-rewrites, documents.payslip-kind).
//
// The CLI checks both hashes before it calls anything: two 32-byte 0x hex values in any case, else
// CLI_USAGE. Then it calls one SDK method: the rpc for `get` and `verify`, the flow for `render` and
// `export` (A4). Worlds (decision documents.worlds): `org-with-documents` holds a document of every kind
// with its readers and a stranger; `org-with-tampered-note` holds one stored note whose bytes were
// altered after it was stored; `signed-out` is the shared world with no session.

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

const CLI = "apps/cli/src/commands/document";
const S18 = "packages/scenarios/src/acme/s18-dana-reads-her-payment-surface.scenario.ts";
const page = (id: FrozenId) => `apps/docs/factory/operations/${id}.yaml:1`;

/** The world holding a document of every kind, its readers, a later member, a removed creator and a stranger. */
export const WORLD_DOCUMENTS = "org-with-documents";
/** The world holding one stored note whose bytes were altered after it was stored. */
export const WORLD_TAMPERED = "org-with-tampered-note";
/** The shared world with no session. */
export const WORLD_SIGNED_OUT = "signed-out";

const ERRORS = {
  CLI_USAGE: error_CLI_USAGE,
  INVALID_INPUT: error_INVALID_INPUT,
  NOT_AUTHENTICATED: error_NOT_AUTHENTICATED,
} as const;

/** The page's refusals, in its order and words, each reached from its world. */
const refusals = (id: FrozenId) =>
  frozenRefusals(id).map(({ code, when }) => {
    const error = (ERRORS as Record<string, (typeof ERRORS)[keyof typeof ERRORS] | undefined>)[code];
    if (error === undefined) throw new Error(`${id}: the refusal code ${code} has no error record here`);
    return { error, given: code === "NOT_AUTHENTICATED" ? WORLD_SIGNED_OUT : WORLD_DOCUMENTS, when };
  });

type FrozenLine = { readonly claim: string; readonly was: readonly string[] };
const frozenLine = (id: FrozenId, n: number) => (frozen[id].acceptance as readonly FrozenLine[])[n - 1]!;

/** Acceptance line n (from 1), its claim kept word for word, its test citation in `was`. */
const kept = (id: FrozenId, n: number, observes: string) => {
  const a = frozenLine(id, n);
  return { claim: a.claim, observes, was: [...a.was] };
};

// ── document get ────────────────────────────────────────────────────────────────────────────

// The CLI checks the pair, calls `client.paymentDocuments.get` (the rpc), refuses a reply for another
// pair with CLI_USAGE, and prints the ref, the media type, the signature status and the `document
// render` command: never the bytes.
export const operation_document_get = defineOperation({
  ...frozenText("document.get"),
  was: [
    page("document.get"),
    `${CLI}/subcommands/get/execute.ts:20`,
    `${CLI}/subcommands/get/execute.ts:24`,
    `${CLI}/internal/shared.ts:10`,
    `${CLI}/internal/shared.ts:20`,
    `${S18}:216`,
    "docs/as-is/archive/operations/payments.ts:1076",
  ],
  priority: "normal",
  implementedBy: rpc_documents_reading_get,
  acceptance: [
    kept(
      "document.get",
      1,
      `read: in \`${WORLD_DOCUMENTS}\`, \`document export\` of a participant's pair writes bytes whose keccak-256 is its ` +
        "content hash, while a stranger's `document get` of the same pair exits INVALID_INPUT; cli: in " +
        `\`${WORLD_TAMPERED}\`, \`document get\` of the altered note exits UNKNOWN with \`details.check\` naming the failed ` +
        "check, and prints no document.",
    ),
    kept(
      "document.get",
      2,
      `cli: in \`${WORLD_DOCUMENTS}\`, a signed-in stranger and a signed-in person with no Party of their own each get ` +
        "INVALID_INPUT for a stored pair with the same code, message and details as for a pair that names nothing; " +
        "world: the diff across the three runs is empty.",
    ),
    kept(
      "document.get",
      3,
      `cli: in \`${WORLD_DOCUMENTS}\`, a member who joined the Organization after the document was stored reads it, and ` +
        "the member who stored it for the Organization, since removed and not a participant in person, gets INVALID_INPUT.",
    ),
    kept(
      "document.get",
      4,
      "cli: `--json` carries `ref`, `mediaType` and `signatureStatus` and no bytes, and the text names the `document " +
        "render` command; world: no file appears on this machine, in the working directory or the documents folder.",
    ),
  ],
  returns: Schema.Struct({
    ref: DocumentRef, // The document's kind, format, issue time, document hash and content hash.
    mediaType: MediaType, // Its media type.
    signatureStatus: SignatureStatus, // `absent`, `verified` or `opaque`.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("document.get"),
  budget: budget("read"),
});

// ── document verify ─────────────────────────────────────────────────────────────────────────

// The CLI checks the pair, calls `client.paymentDocuments.verify` (the rpc), refuses a reply for another
// pair with CLI_USAGE, and prints the verification as it came: `ok` false still exits 0.
export const operation_document_verify = defineOperation({
  ...frozenText("document.verify"),
  was: [
    page("document.verify"),
    `${CLI}/subcommands/verify/execute.ts:18`,
    `${CLI}/internal/shared.ts:10`,
    `${CLI}/internal/shared.ts:20`,
    `${S18}:265`,
    "docs/as-is/archive/operations/payments.ts:1115",
  ],
  priority: "normal",
  implementedBy: rpc_documents_reading_verify,
  acceptance: [
    kept(
      "document.verify",
      1,
      `cli: in \`${WORLD_DOCUMENTS}\`, the person outside money reached (a Movement no Payment explains) verifies its ` +
        "Memo's pair: `ok` true, `signatureStatus` absent; read: `activity get --kind movement` of that Movement lists the " +
        "same pair.",
    ),
    kept(
      "document.verify",
      2,
      `cli: in \`${WORLD_TAMPERED}\`, \`document verify\` of the altered note exits 0 and prints \`ok\` false with the ` +
        "pair it checked; trace: the verify rpc's span ends without an error.",
    ),
  ],
  returns: Schema.Struct({
    ok: Schema.Boolean, // Whether the document verified against its hashes.
    signatureStatus: SignatureStatus, // `verified`, `absent` or `opaque`.
    documentHash: Schema.String, // The document hash checked.
    contentHash: Schema.String, // The content hash checked.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("document.verify"),
  budget: budget("read"),
});

// ── document render ─────────────────────────────────────────────────────────────────────────

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

// ── document export ─────────────────────────────────────────────────────────────────────────

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
