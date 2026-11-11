// Moved out of the built book by the cut, 10 November 2026, from books/target/documents/reading.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_documents } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_UNKNOWN } from "../shared/vocabulary.ts";
import { table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_org_deployments, table_org_members, table_organizations } from "../organizations/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { DocumentFormat, DocumentKind, MediaType, table_documents } from "./data.ts";

export const rpc_documents_reading_render = defineRpc({
  id: "documents.reading.render",
  title: "Lay out one checked document as HTML",
  about:
    "The HTML of a document the caller may read, built only after the participant check and the integrity checks pass " +
    "(an integrity failure is UNKNOWN, as for `get`). An envelope's fields are laid out with the current public names of " +
    "the parties it names, read then: an Organization by its name, a person or an agent by their display name, else " +
    "their handle, else their Safe shortened; never a Party id and never a mailbox, so an employer and an employee on " +
    "a payslip or an agreement's terms read as who they are. A receipt file renders only an escaped summary (its media type, file " +
    "name and size) and none of its bytes. The document stylesheet comes with it, its font embedded, so the PDF prints " +
    "with no network. The stored bytes never change: names are layout, not content.",
  concept: concept_documents,
  kind: "query",
  who: WHO,
  input: HashPair,
  output: Schema.Struct({
    documentHash: S,
    contentHash: S,
    kind: DocumentKind,
    ok: Schema.Literal(true),
    html: S,
  }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN],
  reads: READS,
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [
    `${ACTIVITY}/operations/render.ts:10`,
    `${ACTIVITY}/reads.ts:60`,
    `${OLD}/reads/contents.ts:127`,
    `${OLD}/reads/parties.ts:141`,
    `${OLD}/reads/stylesheet.ts:1`,
    `${PROTOCOL}/activity/operations.ts:158`,
    `${PROTOCOL}/documents/read-schema.ts:68`,
    `${PROTOCOL}/templates/documents/render.ts:1`,
  ],
});
