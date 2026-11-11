// Documents' Core SDK flows (A4): the two commands that compose an rpc with work on this machine.
// `document render` reads the checked HTML, prints it to a PDF in a headless browser and saves both
// files; `document export` reads the exact bytes and writes them to a new file. Each is one SDK method
// the CLI calls, and nothing else. `document get` and `document verify` are one rpc each, so their SDK
// methods are those rpcs and they have no flow (decision documents.rpcs-and-flows).
//
// Both flows run only on a Node host (the CLI): they write files. Each checks that the reply names the
// pair it asked for (lowercased) before it writes anything; a reply for another pair is CLI_USAGE.
// The SDK namespace stays `client.paymentDocuments`, as the frozen pages name it.

import { Schema } from "effect";
import { budget, defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_CLI_DEFECT, error_CLI_STORAGE, error_CLI_USAGE } from "../shared/vocabulary.ts";
import { DocumentKind, MediaType } from "./data.ts";
import { HashPair, rpc_documents_reading_get, rpc_documents_reading_render } from "./reading.ts";

const CLI = "apps/cli/src/commands/document";
const SDK = "packages/sdk/src/activity/documents.ts";
const PLATFORM = "apps/cli/src/platform/documents.ts";

const S = Schema.String;

/** The PDF render: a browser on this machine, its launch, its font load and its print. */
export const RENDER_BUDGET = {
  ...budget("read"),
  p50Ms: 2_500,
  p95Ms: 6_000,
  excludes: ["sdk.step.browser-install"],
  why: "prints the PDF in a headless browser on this machine: launch, font load and print follow the one read",
};

// ── document render ─────────────────────────────────────────────────────────────────────────

export const flow_client_payment_documents_render = defineFlow({
  id: "client.payment-documents.render",
  title: "Save one checked document as a PDF, with its HTML beside it",
  about:
    "Reads the document's HTML (`documents.reading.render`, after the backend's access and integrity checks), refuses a " +
    "reply for another pair with CLI_USAGE, prints the HTML to an A4 PDF in a headless browser with scripts off and the " +
    "network off once the document font has loaded, and saves `document.pdf` and `document.html` into a new private " +
    "folder: under `documents` beside the CLI settings, or under `outputDirectory`. Each run makes a new folder, so an " +
    "earlier copy is never overwritten; on any failure the folder is removed. A browser that is not installed is " +
    "downloaded once, outside the budget (`sdk.step.browser-install`). Serves the CLI.",
  was: [
    `${CLI}/subcommands/render/execute.ts:15`,
    `${PLATFORM}:16`,
    `${PLATFORM}:69`,
    `${PLATFORM}:114`,
    `${PLATFORM}:130`,
    `${SDK}:89`,
    "docs/as-is/archive/operations/payments.ts:1151",
  ],
  component: component_core_sdk,
  sdk: "client.paymentDocuments.render",
  input: Schema.Struct({ ...HashPair.fields, outputDirectory: Schema.optionalKey(S) }),
  output: Schema.Struct({
    document: Schema.Struct({
      documentHash: S,
      contentHash: S,
      kind: DocumentKind,
      path: S,
      htmlPath: S,
      mediaType: Schema.Literal("application/pdf"),
      byteLength: Schema.Number,
    }),
  }),
  steps: [
    {
      name: "render",
      rpc: rpc_documents_reading_render,
      about: "The checked HTML; a reply naming another pair is CLI_USAGE, and nothing is saved.",
    },
    {
      name: "pdf",
      local: "build",
      about: "Prints the HTML to an A4 PDF in a headless browser, scripts and network off, after its font loads; any failure is CLI_DEFECT.",
    },
    {
      name: "save",
      local: "cache",
      about: "A new 0700 folder with `document.pdf` and `document.html` at 0600; a folder or file that cannot be written is CLI_STORAGE.",
    },
  ],
  errors: [error_CLI_USAGE, error_CLI_DEFECT, error_CLI_STORAGE],
  calls: [],
  spans: ["sdk.step.browser-install"],
  budget: RENDER_BUDGET,
});

// ── document export ─────────────────────────────────────────────────────────────────────────

export const flow_client_payment_documents_export = defineFlow({
  id: "client.payment-documents.export",
  title: "Write one document's exact bytes to a new file",
  about:
    "Reads the document's exact bytes (`documents.reading.get`, after the backend's access and integrity checks), " +
    "refuses a reply for another pair with CLI_USAGE, and writes the bytes to `out` only if nothing is there " +
    "(exclusive create, readable only by you). An existing file is CLI_USAGE and stays as it was; any other write " +
    "failure is CLI_STORAGE. Serves the CLI.",
  was: [
    `${CLI}/subcommands/export/execute.ts:16`,
    `${CLI}/subcommands/export/execute.ts:18`,
    `${CLI}/subcommands/export/execute.ts:25`,
    `${SDK}:87`,
    "docs/as-is/archive/operations/payments.ts:1196",
  ],
  component: component_core_sdk,
  sdk: "client.paymentDocuments.export",
  input: Schema.Struct({ ...HashPair.fields, out: S }),
  output: Schema.Struct({
    path: S,
    documentHash: S,
    contentHash: S,
    mediaType: MediaType,
    byteLength: Schema.Number,
  }),
  steps: [
    {
      name: "get",
      rpc: rpc_documents_reading_get,
      about: "The exact bytes, checked; a reply naming another pair is CLI_USAGE, and no file is created.",
    },
    {
      name: "write",
      local: "cache",
      about: "Writes the bytes to `out` with exclusive create at 0600; an existing file is CLI_USAGE, any other failure CLI_STORAGE.",
    },
  ],
  errors: [error_CLI_USAGE, error_CLI_STORAGE],
  calls: [],
  spans: [],
  budget: budget("read"),
});
