// Moved out of the built book by the cut, 10 November 2026, from books/target/books/processes.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

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
  machine_book_document_voucher,
  table_book_accounts,
  table_book_annotations,
  table_book_assets,
  table_book_companies,
  table_book_cost_centers,
  table_book_document_vouchers,
  table_book_facts,
  table_book_head_syncs,
  table_book_prices,
} from "./data.ts";

export const workflow_books_prices_sync = defineWorkflow({
  id: "books.prices.sync",
  title: "Keep the USD rates of Capxul's priced assets",
  about:
    "Every five minutes, reads each pair's Chainlink feed (USDC/USD, USDT/USD, EUR/USD for EURC, ETH/USD for WETH, " +
    "BTC/USD for WBTC, and the USD pair of each Company currency the deployment lists, such as GBP/USD) and stores a " +
    "round it has not kept yet, dated by the round's update time. A money fact takes the rate in force at its block's " +
    "time, so it is at most one poll behind; a voucher in a Company's own currency divides by that currency's rate then. On a devnet the Chainlink fake answers the " +
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

export const workflow_books_head_sync = defineWorkflow({
  id: "books.head.sync",
  title: "Sync the Organization's books with its connected head",
  about:
    "Started when a head connection is confirmed, one instance per connection; it waits on two systems for as long as " +
    "the head is connected and must survive a crash (books.sync). Push: nothing until the books are charted, then the " +
    "feed from `pushed_seq` (from 1 the first time, so a head connected late gets the whole ledger in order), each " +
    "fact's documents as they stand (`upsertDocs`, by `capxul_id`, with `capxul_version`). Money vouchers and payroll " +
    "accruals are Capxul's alone under organizations.head-ownership: read-only on the head, overwritten there if they " +
    "drift, and a newer version cancelled and amended on the voucher's own posting date (books.vouchers). Pull: the " +
    "head's own changes after `pulled_change` (`listChanges`), oldest first, each in its own transaction. A head-born or " +
    "renamed Account is applied as `books.accounts.add` or `rename` would be, Capxul assigning its code and id, with " +
    "the rights of the member the head user is, matched by mailbox (the Books hat for the chart). A head user's " +
    "classification of a Capxul voucher, made through the app's one action for it, is applied as " +
    "`books.annotations.save` would be for that member, so it is a `recategorized` fact whose repost the next push " +
    "carries. The head's own vouchers (invoices, its accruals, a closing) are kept as `head` document vouchers with " +
    "their GL Entries (books.head-vouchers). A change based on an older version loses " +
    "and Capxul's version is pushed back (a conflict); a change Capxul's checks refuse is pushed back, or, for a head " +
    "voucher, left out and counted: a line on an account or cost centre the chart lacks, on a group or on a Safe " +
    "account, a `capxul_id` on it, debits unequal to credits, or a date on or before `closed_through` when it is not a " +
    "closing (books.closed-periods, books.one-author-per-voucher). It wakes on a fact here, on " +
    "the head's ring, and once a day to catch a missed ring; while the head is failing it waits. It ends when the head " +
    "is disconnected.",
  concept: concept_books,
  priority: "normal",
  trigger: { transition: machine_org_head.t.confirm },
  instance: { per: table_book_head_syncs },
  waits: [
    {
      name: "capxul-change",
      for: "signal",
      key: [{ on: [table_book_facts], props: ["org_id"] }],
      about: "A fact was recorded here: push its documents.",
    },
    {
      name: "ring",
      for: "signal",
      key: [{ on: [table_org_heads], props: ["org_id", "head_id"] }],
      about: "The head rang its doorbell (organizations.heads.ring stamped the connection): pull its changes.",
    },
    { name: "catch-up", for: "timer", timeoutMs: DAY, about: "A day after the last pull: pull, in case a ring was lost." },
    {
      name: "disconnected",
      for: "signal",
      key: [{ on: [event_org_head_transitioned], props: ["org_id", "head_id"] }],
      about: "The head stopped failing, started failing, or was disconnected: carry on, wait, or end.",
    },
  ],
  steps: [
    {
      name: "push",
      about:
        "Once charted: page book-facts after pushed_seq; upsertDocs each fact's documents in seq order (a line's project " +
        "as its Project's head name); record the head's names; advance pushed_seq in the same transaction as the answers.",
    },
    {
      name: "pull",
      about:
        "listChanges after pulled_change; apply chart changes, classifications and head vouchers through books' checks, " +
        "one transaction each, each fact taking its feed number; a head line whose party carries no Party is kept with a " +
        "null party_id; push back a conflict or a refusal; advance pulled_change.",
    },
    { name: "await", about: "Wait for a fact here, a ring, the daily catch-up or the connection's next transition." },
  ],
  reads: [
    table_org_heads,
    table_org_members,
    table_org_deployments,
    table_hat_wearers,
    table_principals,
    table_feature_flags,
    table_book_head_syncs,
    table_book_companies,
    table_book_accounts,
    table_book_cost_centers,
    table_book_annotations,
    table_book_facts,
    table_book_document_vouchers,
  ],
  writes: [
    table_book_head_syncs,
    table_book_companies,
    table_book_accounts,
    table_book_cost_centers,
    table_book_annotations,
    table_book_facts,
    table_book_document_vouchers,
  ],
  drives: [
    machine_book_account.t.add,
    machine_book_account.t.rename,
    machine_book_account.t.archive,
    machine_book_annotation.t.queue,
    machine_book_annotation.t.assign,
    machine_book_annotation.t.requeue,
    machine_book_annotation.t.recategorize,
    machine_book_document_voucher.t.post,
    machine_book_document_voucher.t.cancel,
  ],
  invokes: [],
  emits: [],
  calls: [integration_frappe_head.c.upsertDocs, integration_frappe_head.c.listChanges],
  chain: [],
  idempotency:
    "One process per head connection (`books-head:<orgId>:<headId>`). A push is idempotent by `capxul_version` (the head " +
    "answers unchanged), and a pulled change already applied is skipped by its head name and `modified`.",
  timeoutMs: 60_000,
  retries: { max: 8, backoff: "exponential" },
  budget: budget("background"),
});
