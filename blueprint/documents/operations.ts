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
import { budget, defineOperation } from "../../packages/blueprint-engine/src/index.ts";
import { frozen, frozenRefusals, frozenText, type FrozenId } from "../baseline/index.ts";
import {
  error_CLI_DEFECT,
  error_CLI_STORAGE,
  error_CLI_USAGE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
} from "../shared/vocabulary.ts";
import { hash, ok, refused } from "../shared/examples.ts";
import { MediaType } from "./data.ts";
import { DocumentRef, SignatureStatus, rpc_documents_reading_get, rpc_documents_reading_verify } from "./reading.ts";

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
  examples: [
    ok(
      "Read an invoice Brightside sent, by its two hashes",
      `capxul document get --document-hash ${hash("a1")} --content-hash ${hash("b2")} --json`,
      { ref: { documentHash: hash("a1"), contentHash: hash("b2"), kind: "invoice", format: "envelope", issuedAt: Date.parse("2026-02-03T10:00:00Z") }, mediaType: "application/json", signatureStatus: "verified" },
    ),
    refused(
      "A hash that is not 32-byte hex",
      "capxul document get --document-hash 0x1234 --content-hash 0x5678 --json",
      error_CLI_USAGE,
    ),
    refused(
      "A document that does not exist or cannot be read",
      `capxul document get --document-hash ${hash("c3")} --content-hash ${hash("d4")} --json`,
      error_INVALID_INPUT,
    ),
  ],
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
  examples: [
    ok(
      "Verify the invoice against its hashes",
      `capxul document verify --document-hash ${hash("a1")} --content-hash ${hash("b2")} --json`,
      { ok: true, signatureStatus: "verified", documentHash: hash("a1"), contentHash: hash("b2") },
    ),
    refused(
      "Signed out",
      `capxul document verify --document-hash ${hash("a1")} --content-hash ${hash("b2")} --json`,
      error_NOT_AUTHENTICATED,
    ),
  ],
  budget: budget("read"),
});

// ── document render ─────────────────────────────────────────────────────────────────────────

// ── document export ─────────────────────────────────────────────────────────────────────────

