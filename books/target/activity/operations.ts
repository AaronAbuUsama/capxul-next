// The six frozen operations activity owns (OPERATION_OWNERS): `activity events`, `get`, `list` and
// `summary`, and `address` and `balance`, which leave old payments' area for whoever you act as
// (concepts.activity). `activity annotate` is books' (concepts.books).
//
// Every record is built from the frozen text (frozenText), never retyped. Acceptance claims are
// the frozen ones word for word except six that name a mechanism a black box cannot see, rewritten
// as outcomes with the old line in `was` (decision activity.acceptance-rewrites). Refusal texts are
// the frozen ones; each is reached from a world named in decision activity.worlds. Two INVALID_INPUT
// refusals have no world: the setting and the binding they name no longer exist at read time
// (decision activity.unreachable-refusals). Every operation is `normal`: none is a spine pilot.

import { Schema } from "effect";
import { budget, defineOperation, type ErrorRecord } from "../../../packages/book/src/index.ts";
import { frozen, frozenRefusals, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CLI_USAGE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
} from "../shared/vocabulary.ts";
import { ChangeEvent } from "./changes.ts";
import { Detail, Page, Summary, rpc_activity_feed_get, rpc_activity_feed_list, rpc_activity_feed_summary } from "./feed.ts";
import { flow_client_activity_changes } from "./flows.ts";
import { DepositAddress, Holdings, rpc_activity_holdings_address, rpc_activity_holdings_balances } from "./holdings.ts";

const page = (id: FrozenId) => `apps/docs/factory/operations/${id}.yaml:1`;
const CLI = "apps/cli/src/commands";

// ── worlds (decision activity.worlds) ───────────────────────────────────────────────────────

export const SIGNED_OUT = "signed-out";
export const WITH_ACTIVITY = "person-with-activity";
export const LONG_HISTORY = "person-with-long-payment-history";
export const MANY_CHANGES = "person-with-over-5000-changes";
export const READY = "person-ready";
export const UNCLAIMED = "person-unclaimed";
export const FUNDED = "person-with-funded-safe";
export const EMPTY = "person-with-empty-safe";
export const TWO_SIGNED_IN = "two-people-signed-in";
export const ORG = "org-with-budgets";
export const DEPOSIT = "person-with-credited-deposit";
/** The setting or binding the refusal names is checked before any read can meet it (activity.unreachable-refusals). */
const NO_WORLD = "?";

const ERRORS: Record<string, ErrorRecord> = {
  CLI_USAGE: error_CLI_USAGE,
  INVALID_INPUT: error_INVALID_INPUT,
  NOT_AUTHENTICATED: error_NOT_AUTHENTICATED,
  ROLE_PERMISSION_DENIED: error_ROLE_PERMISSION_DENIED,
};

/** The page's refusals, in its order and words, each from the world given for its code. */
const refusals = (id: FrozenId, worlds: Record<string, string>) =>
  frozenRefusals(id).map(({ code, when }) => {
    const error = ERRORS[code];
    const given = worlds[code];
    if (error === undefined || given === undefined) throw new Error(`${id}: refusal ${code} has no error record or world here`);
    return { error, given, when };
  });

type FrozenLine = { readonly claim: string; readonly was: readonly string[] };
const frozenLine = (id: FrozenId, n: number) => {
  const a = (frozen[id].acceptance as unknown as readonly FrozenLine[])[n - 1];
  if (!a) throw new Error(`${id}: no acceptance line ${n}`);
  return a;
};

/** Acceptance line n (from 1): the frozen claim word for word, what is observed, and its old test citation. */
const kept = (id: FrozenId, n: number, observes: string) => {
  const a = frozenLine(id, n);
  return { claim: a.claim, observes, was: [...a.was] };
};

/** Acceptance line n rewritten as an outcome: the old claim and its citation move to `was`. */
const rewritten = (id: FrozenId, n: number, claim: string, observes: string) => {
  const a = frozenLine(id, n);
  return { claim, observes, was: [a.claim, ...a.was] };
};

// ── activity events ─────────────────────────────────────────────────────────────────────────

// The CLI checks `--after` is shaped like a cursor an events read prints (else CLI_USAGE, before
// any call), then calls the one SDK method `client.activity.changes`, and adds `next`.
export const operation_activity_events = defineOperation({
  ...frozenText("activity.events"),
  was: [page("activity.events"), `${CLI}/activity/subcommands/events/execute.ts:131`, `${CLI}/activity/subcommands/events/command.ts:6`],
  priority: "normal",
  implementedBy: flow_client_activity_changes,
  acceptance: [
    kept(
      "activity.events",
      1,
      "cli: in person-with-activity, `activity events --json` prints `events: []` and a cursor at once; read: a payment " +
        "sent next is the only event of `activity events --after <that cursor>`, and no older row appears.",
    ),
    kept(
      "activity.events",
      2,
      "cli: two Payments that change after the cursor come oldest change first; when the first changes again after that " +
        "read, the next read answers it once more, after the cursor that read printed.",
    ),
    rewritten(
      "activity.events",
      3,
      "A change to an old Payment is read however many newer rows the feed holds: with 150 newer Payments, it is in the next events read.",
      "world: person-with-long-payment-history, whose oldest Payment still waits under 150 newer ones; cli: cancelling it " +
        "makes it an `updated` event of the next `activity events --after <cursor>`.",
    ),
    kept(
      "activity.events",
      4,
      "cli: in person-with-over-5000-changes, the first read says `truncated: true`; following each printed cursor " +
        "answers the rest, and across the reads every change appears exactly once (no row-and-change pair twice, none missing " +
        "against the world's list).",
    ),
    kept(
      "activity.events",
      5,
      "cli: a cursor another person's read printed, and a printed cursor with one character changed, are INVALID_INPUT " +
        "(exit 2); a value no events read could print is CLI_USAGE, and trace: that run makes no rpc call.",
    ),
  ],
  returns: Schema.Struct({
    events: Schema.Array(ChangeEvent),
    cursor: Schema.String,
    next: Schema.Struct({ argv: Schema.Array(Schema.String) }),
    truncated: Schema.Boolean,
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("activity.events", { CLI_USAGE: WITH_ACTIVITY, INVALID_INPUT: WITH_ACTIVITY, NOT_AUTHENTICATED: SIGNED_OUT }),
  budget: { ...budget("read"), excludes: ["wait.*"] },
});

// ── activity get ────────────────────────────────────────────────────────────────────────────

// The CLI checks `--kind` and `--id`, calls the one SDK method `client.activity.get`, and refuses a
// null answer, or one that is not the row it asked for, with CLI_USAGE.
export const operation_activity_get = defineOperation({
  ...frozenText("activity.get"),
  was: [page("activity.get"), `${CLI}/activity/subcommands/get/execute.ts:11`],
  priority: "normal",
  implementedBy: rpc_activity_feed_get,
  acceptance: [
    kept(
      "activity.get",
      1,
      "cli: in person-with-activity, `activity get` of a Payment and of a Movement prints each row in full, the same row " +
        "`activity list` shows; an unknown id, and a Payment's id given with `--kind movement`, are CLI_USAGE (exit 2).",
    ),
    rewritten(
      "activity.get",
      2,
      "The recipient of a Payment gets its chain evidence without the payer's private execution data.",
      "cli: as the payee of a settled Payment in person-with-activity, `evidence` names the transaction, block and log " +
        "indexes the chain shows for its PaymentSent, and `payment.execution` names no approval and no proposal; chain: " +
        "the devnet's logs match.",
    ),
    kept(
      "activity.get",
      3,
      "cli and chain: `evidence.contractAddress` is the contract that emitted the settling PaymentSent, and " +
        "`settledThrough` is `payments` for a personal send (and `budgets` for a department payment in org-with-budgets).",
    ),
    kept(
      "activity.get",
      4,
      "cli: after `activity annotate` gives a row an account and a memo, `activity get` shows them in `annotation`, and " +
        "its `evidence` is the same, field for field, as before the annotation.",
    ),
  ],
  returns: Detail,
  errors: [error_CLI_USAGE],
  refusals: refusals("activity.get", { CLI_USAGE: WITH_ACTIVITY, NOT_AUTHENTICATED: SIGNED_OUT }),
  budget: budget("read"),
});

// ── activity list ───────────────────────────────────────────────────────────────────────────

// The CLI checks `--limit`, `--from`, `--to`, `--status`, `--kind`, `--direction` and the scope
// first (CLI_USAGE, before any client work), then calls the one SDK method `client.activity.list`.
export const operation_activity_list = defineOperation({
  ...frozenText("activity.list"),
  was: [page("activity.list"), `${CLI}/activity/subcommands/list/execute.ts:10`, `${CLI}/activity/internal/parse.ts:1`],
  priority: "normal",
  implementedBy: rpc_activity_feed_list,
  acceptance: [
    kept(
      "activity.list",
      1,
      "cli: paging person-with-activity's feed with `--limit 2` to the last page lists every Payment and Movement once; " +
        "world: the union of the pages is the world's list of rows, with no row twice.",
    ),
    kept(
      "activity.list",
      2,
      "cli: with `--from` and `--to` around two rows and `--status settled`, the page holds exactly the settled Payments " +
        "inside the window, and no Movement.",
    ),
    kept(
      "activity.list",
      3,
      "cli: rows of USDC and of the second USD-pegged token carry their own `asset`, never one merged; a WETH Movement's " +
        "`amount.raw` has all 18 decimals of its Transfer (chain: the log's value).",
    ),
    kept(
      "activity.list",
      4,
      "cli: `--json` prints the page, its `nextCursor`, each Movement's `kind` and `direction`; with Ponder stopped by the " +
        "devnet supervisor, the page still lists the Payments and says `readWarning: indexer-unavailable`.",
    ),
    kept(
      "activity.list",
      5,
      "cli: `--limit 0`, `--limit 101`, a repeated or unknown `--status`, a `--from` after `--to` and an empty `--org` are " +
        "each CLI_USAGE (exit 2); trace: none of these runs makes an rpc call.",
    ),
  ],
  returns: Page,
  errors: [error_CLI_USAGE],
  refusals: refusals("activity.list", { CLI_USAGE: WITH_ACTIVITY, INVALID_INPUT: WITH_ACTIVITY, NOT_AUTHENTICATED: SIGNED_OUT }),
  budget: budget("read"),
});

// ── activity summary ────────────────────────────────────────────────────────────────────────

// At a terminal with no window the CLI asks for From and To dates in UTC (empty for all time),
// then calls the one SDK method `client.activity.summary`.
export const operation_activity_summary = defineOperation({
  ...frozenText("activity.summary"),
  was: [page("activity.summary"), `${CLI}/activity/subcommands/summary/execute.ts:1`],
  priority: "normal",
  implementedBy: rpc_activity_feed_summary,
  acceptance: [
    kept(
      "activity.summary",
      1,
      "cli: person-with-activity's summary answers one bucket for USDC and one for the second USD-pegged token, each in " +
        "raw units, whatever their peg.",
    ),
    kept("activity.summary", 2, "cli: `window` is the `--from` and `--to` given, and a row just outside either end is not counted."),
    kept(
      "activity.summary",
      3,
      "cli: `--json` keeps each bucket's raw `in`, `out`, `net` and `pendingIn`, and `window` with both of its ends.",
    ),
    kept("activity.summary", 4, "cli: in person-with-credited-deposit, the deposit's amount is in its asset's `in`."),
    kept(
      "activity.summary",
      5,
      "cli: a window that holds only a Payment to oneself answers its asset's bucket with every total `0` and `count: 1`; " +
        "a window with no rows answers `totals: []`.",
    ),
  ],
  returns: Summary,
  refusals: refusals("activity.summary", { INVALID_INPUT: WITH_ACTIVITY, NOT_AUTHENTICATED: SIGNED_OUT }),
  budget: budget("read"),
});

// ── address ─────────────────────────────────────────────────────────────────────────────────

// The CLI calls the one SDK method `client.account.profile.depositInstructions`, with the scope
// `--org` (or `capxul use org`) names.
export const operation_address = defineOperation({
  ...frozenText("address"),
  was: [page("address"), `${CLI}/address/execute.ts:1`],
  priority: "normal",
  implementedBy: rpc_activity_holdings_address,
  acceptance: [
    rewritten(
      "address",
      1,
      "It gives your Safe's address in lower case and its chain; before your Safe is claimed, it gives the Safe your email derives, on Base Sepolia.",
      "cli: in person-ready the address is the claimed Safe in lower case with chain 84532; in person-unclaimed it is the " +
        "address CompaniesHouseClaimer's `safeAddressFor` gives for the email (chain: the same view call on the devnet).",
    ),
    kept(
      "address",
      2,
      "cli: in two-people-signed-in, each person's `address` is their own Safe, and neither output contains the other's.",
    ),
    rewritten(
      "address",
      3,
      "Reading the address changes nothing.",
      "world: the diff across `address` and `address --org` is empty; trace: neither run starts a workflow.",
    ),
    kept(
      "address",
      4,
      "cli: in org-with-budgets a member's `address --org` is the company Safe, with `accountKind: orgTreasury`; the " +
        "signed-in outsider's is ROLE_PERMISSION_DENIED (exit 4).",
    ),
  ],
  returns: DepositAddress,
  refusals: refusals("address", { NOT_AUTHENTICATED: SIGNED_OUT, ROLE_PERMISSION_DENIED: ORG, INVALID_INPUT: NO_WORLD }),
  budget: budget("read"),
});

// ── balance ─────────────────────────────────────────────────────────────────────────────────

// The CLI calls the one SDK method `client.accounts.read`, with the scope `--org` names; the
// valuation is the backend's, from books' prices, so the SDK holds no rates of its own.
export const operation_balance = defineOperation({
  ...frozenText("balance"),
  was: [page("balance"), `${CLI}/balance/execute.ts:1`],
  priority: "normal",
  implementedBy: rpc_activity_holdings_balances,
  acceptance: [
    kept(
      "balance",
      1,
      "cli: in person-with-funded-safe, `balances` has one position per admitted asset (USDC 1000), and `balance` is a USD " +
        "valuation beside them, never a position.",
    ),
    kept(
      "balance",
      2,
      "cli: in person-with-empty-safe every admitted asset reads `0`; a token outside the admitted list sent to the Safe " +
        "first is not listed.",
    ),
    rewritten(
      "balance",
      3,
      "It answers without waiting on the analytics service, and its wide event names every asset it read.",
      "cli: with the PostHog fake failing every call, the answer is the same and within budget; trace: the operation's " +
        "wide event in the local collector names each admitted asset once.",
    ),
    rewritten(
      "balance",
      4,
      "An account with no Safe yet is refused `SMART_ACCOUNT_MISSING`, and an unauthenticated caller is refused.",
      "cli: in person-unclaimed it exits 6 with SMART_ACCOUNT_MISSING; in signed-out it exits 3 with NOT_AUTHENTICATED.",
    ),
    kept(
      "balance",
      5,
      "cli: the signed-in outsider in org-with-budgets gets ROLE_PERMISSION_DENIED (exit 4); trace: the rpc's span ends " +
        "at the Seat check, with no read of the company Safe's balances.",
    ),
  ],
  returns: Schema.Struct({
    id: Holdings.fields.id,
    balances: Holdings.fields.balances,
    balance: Holdings.fields.balance,
    available: Holdings.fields.available,
  }),
  refusals: refusals("balance", { NOT_AUTHENTICATED: SIGNED_OUT, ROLE_PERMISSION_DENIED: ORG, INVALID_INPUT: NO_WORLD }),
  budget: budget("read"),
});

/** Every operation this concept designs. */
export const OPERATIONS = [
  operation_activity_events,
  operation_activity_get,
  operation_activity_list,
  operation_activity_summary,
  operation_address,
  operation_balance,
];
