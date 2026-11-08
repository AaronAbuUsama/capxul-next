// Books' durable work. Books owns no long-lived business object (its rows change only inside
// rpcs: rules.durable-processes), so it has no instance-per-row process. Two sweeps survive P3's
// list of crons: the Chainlink price sync and the scan of tokens added at run time, which Ponder has
// no source for (shared decision concepts.books-token-scan). The old minute observer, the backfill,
// the Safe opening and the outside-money timer go (books.one-observer, books.facts-without-chart).

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_books } from "../shared/foundation.ts";
import { integration_chain_rpc, integration_chainlink } from "../shared/external.ts";
import { table_book_assets, table_book_facts, table_book_prices } from "./data.ts";

const OLD = "packages/backend/src";

export const workflow_books_prices_sync = defineWorkflow({
  id: "books.prices.sync",
  title: "Keep the USD rates of Capxul's priced assets",
  about:
    "Every five minutes, reads each pair's Chainlink feed (USDC/USD, USDT/USD, EUR/USD for EURC, ETH/USD for WETH, " +
    "BTC/USD for WBTC) and stores a round it has not kept yet, dated by the round's update time. A money fact takes the " +
    "rate in force at its block's time, so it is at most one poll behind. On a devnet the Chainlink fake answers the " +
    "devnet's scripted rates. One pair's failure leaves the others' rows standing.",
  was: [`${OLD}/platform/jobs.ts:80`, `${OLD}/books/facts/operations/prices.ts:35`, `${OLD}/books/facts/rules.ts:119`],
  concept: concept_books,
  priority: "normal",
  trigger: { cron: "*/5 * * * *" },
  instance: "singleton",
  steps: [
    { name: "read-feeds", about: "Each pair's latest answer, its decimals and when it was updated, in parallel." },
    { name: "store-rounds", about: "One transaction: a row per pair whose round is newer than the last kept; a kept round is skipped." },
  ],
  reads: [table_book_prices],
  writes: [table_book_prices],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_chainlink.c.usdRate],
  chain: [],
  idempotency: "A pair's row is keyed by the round's update time: a round already kept is skipped.",
  timeoutMs: 60_000,
  retries: { max: 2, backoff: "exponential" },
  budget: budget("background"),
});

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
    { name: "book-window", about: "One transaction per window: its facts (a key already standing is skipped) and the new next block." },
  ],
  reads: [table_book_assets, table_book_facts],
  writes: [table_book_facts, table_book_assets],
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
