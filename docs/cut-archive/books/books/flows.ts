// Books' Core SDK flows (A4). Every books command but one is a single rpc call, so its SDK method
// is that rpc. `org books accounts review` reads the queue and, with `--accept`, accepts one of its
// rows: two rpcs behind one SDK method, so the CLI still calls exactly one (books.review-flow). The
// other serves an outside ledger that follows the books' feed through the Core SDK, not the CLI; a
// connected head is synced by books' own process instead (books.sync, processes.ts).

import { Schema } from "effect";
import { budget, defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { rpc_books_accounts_accept, rpc_books_accounts_review } from "./accounts.ts";
import { Reference } from "./data.ts";
import { rpc_books_sync_feed } from "./sync.ts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;
const opt = Schema.optionalKey;

const AccountRef = Schema.Struct({ accountId: S, code: S, name: S });

export const flow_client_org_books_accounts_review = defineFlow({
  id: "client.org.books.accounts.review",
  title: "Read the review queue, or accept one of its rows",
  about:
    "Without `accept`, the queue (`books.accounts.review`). With `accept`, it reads the queue, and accepts the row only " +
    "if it is waiting there (`books.accounts.accept`, with `name` and `under`); a row id not in the queue comes back as " +
    "`notInQueue` and nothing is called, which the CLI refuses as a bad argument (CLI_USAGE). Serves the CLI and the MCP " +
    "server.",
  was: [
    "packages/sdk/src/books/accounts.ts:214",
    "packages/sdk/src/books/accounts.ts:215",
    "apps/cli/src/commands/org/subcommands/books/subcommands/accounts/subcommands/review/execute.ts:21",
    "apps/cli/src/commands/org/subcommands/books/subcommands/accounts/subcommands/review/execute.ts:31",
  ],
  component: component_core_sdk,
  sdk: "client.org(orgId).books.accounts.review",
  input: Schema.Struct({ orgId: S, accept: opt(S), name: opt(S), under: opt(S) }),
  output: Schema.Union([
    Schema.Struct({
      rows: Schema.Array(Schema.Struct({ reference: Reference, account: AccountRef, suggestion: NullOr(S), waitingSince: N })),
    }),
    Schema.Struct({ accepted: Schema.Struct({ reference: Reference, account: AccountRef, factIds: Schema.Array(S) }) }),
    Schema.Struct({ notInQueue: S }),
  ]),
  steps: [
    { name: "queue", rpc: rpc_books_accounts_review, about: "The rows waiting in 4999 and 6999." },
    { name: "accept", rpc: rpc_books_accounts_accept, about: "Only with `accept`, and only for a row the queue lists." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("write"),
});

export const flow_client_org_books_sync_follow = defineFlow({
  id: "client.org.books.sync.follow",
  title: "Follow the books' feed from a number, waiting if asked",
  about:
    "Serves an outside ledger that follows the books as a Seat's agent (an accountant's own system), not the CLI: no " +
    "frozen operation follows the feed, and a connected Frappe head is pushed to by books' own process instead " +
    "(books.sync). Reads the facts after `after` with their Frappe documents (`books.sync.feed`); with `waitMs` and " +
    "nothing new, waits and reads again until a fact comes or the wait ends (a `wait.*` span, never system time). The " +
    "follower applies each document by its `capxul_id` and stores the entry's number in the same transaction, so a crash " +
    "between reads replays nothing twice.",
  component: component_core_sdk,
  surfaces: ["sdk"],
  sdk: "client.org(orgId).books.sync.follow",
  input: Schema.Struct({ orgId: S, after: Schema.Int, limit: opt(Schema.Int), waitMs: opt(N) }),
  output: rpc_books_sync_feed.output,
  steps: [
    { name: "feed", rpc: rpc_books_sync_feed, about: "The facts after `after`, in number order, with their documents." },
    { name: "wait", local: "wait", about: "Only with `waitMs`, after an empty page: five seconds, or what is left of the wait." },
    { name: "feed-again", rpc: rpc_books_sync_feed, about: "After each wait, the facts after the same number; it stops at the first page with any." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: { ...budget("read"), excludes: ["wait.*"] },
});
