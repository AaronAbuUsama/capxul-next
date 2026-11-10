// Books' durable work. Books owns no long-lived business object of its own (its rows change only
// inside rpcs: rules.durable-processes), so it has no instance-per-row process. Two sweeps survive
// P3's list of crons: the Chainlink price sync and the scan of tokens added at run time, which Ponder
// has no source for (shared decision concepts.books-token-scan). The old minute observer, the
// backfill, the Safe opening and the outside-money timer go (books.one-observer,
// books.facts-without-chart). One process per head connection syncs the books with a connected head,
// as every app concept's own process does (books.sync, organizations.head-connection).

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_books } from "../shared/foundation.ts";
import { integration_chain_rpc, integration_chainlink, integration_frappe_head } from "../shared/external.ts";
import { table_feature_flags, table_principals } from "../access/data.ts";
import {
  event_org_head_transitioned,
  machine_org_head,
  table_org_deployments,
  table_org_heads,
  table_org_members,
} from "../organizations/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import {
  machine_book_account,
  machine_book_annotation,
  table_book_accounts,
  table_book_annotations,
  table_book_assets,
  table_book_companies,
  table_book_facts,
} from "./data.ts";

const DAY = 86_400_000;

const OLD = "packages/backend/src";

export const workflow_books_assets_scan_added = defineWorkflow({
  id: "books.assets.scan-added",
  title: "Book the Transfers of the tokens Organizations added",
  about:
    "Every minute, for each added token: reads the chain head, then the token's Transfer logs to and from the company " +
    "Safe from its `next_block` up to the deployment's finality depth below the head, in windows of at most 2,000 blocks, " +
    "and books each as outside money (in: `deposit_received`; out: `payment_sent_outside`) under its symbol with no USD, " +
    "keyed by the Transfer, whose row is the Movement `<chain>:<tx>:<log>` an annotation names, then moves `next_block` " +
    "past the windows read in full. Reading only final blocks is the " +
    "reorganization rule, so nothing it books is reversed. Capxul never pays in an added token, so no Payment explains " +
    "one of its Transfers. A removed token is not read; one token's failure leaves the others' scans standing. Its facts " +
    "are what activity shows for an added token.",
  was: [
    `${OLD}/platform/jobs.ts:139`,
    `${OLD}/indexing/movements/operations/scan-added.ts:32`,
    `${OLD}/books/assets/operations/tokens.ts:10`,
    `${OLD}/books/facts/writes/outside.ts:71`,
  ],
  concept: concept_books,
  priority: "normal",
  trigger: { cron: "* * * * *" },
  instance: "singleton",
  steps: [
    { name: "list-tokens", about: "Every `added` row of every Organization, with its Safe and next block." },
    { name: "read-head", about: "The chain head; the scan reads only to the finality depth below it." },
    { name: "read-windows", about: "Per token, the Transfer logs to and from its Safe, window by window." },
    {
      name: "book-window",
      about: "One transaction per window: its facts, each with the Organization's next feed number (a key already standing is skipped), and the new next block.",
    },
  ],
  reads: [table_book_assets, table_book_companies, table_book_facts],
  writes: [table_book_companies, table_book_facts, table_book_assets],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.getBlock, integration_chain_rpc.c.getLogs],
  chain: [],
  idempotency: "A fact's key is the Organization and the Transfer (chain, hash, log index): a window read twice books nothing twice.",
  timeoutMs: 55_000,
  retries: { max: 2, backoff: "exponential" },
  budget: budget("background"),
});

