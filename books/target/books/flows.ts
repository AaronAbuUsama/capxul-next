// Books' Core SDK flows (A4). Every books command but one is a single rpc call, so its SDK method
// is that rpc. `org books accounts review` reads the queue and, with `--accept`, accepts one of its
// rows: two rpcs behind one SDK method, so the CLI still calls exactly one (books.review-flow).

import { Schema } from "effect";
import { budget, defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { rpc_books_accounts_accept, rpc_books_accounts_review } from "./accounts.ts";
import { Reference } from "./data.ts";

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
