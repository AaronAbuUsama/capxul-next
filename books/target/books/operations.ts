// The target records of the 17 frozen operations books owns (OPERATION_OWNERS): the 16 of the old
// books area and `activity annotate` (an annotation is a book fact). Text is the frozen book's,
// spread from frozenText, never retyped. Acceptance lines are claims (P1): kept word for word, with
// the old test citation in `was`, except the lines that name the old telemetry ("posts
// `books_account_added`", "schedules nothing", "delivered once"), which become claims about what is
// reported, observed in the local collector (books.acceptance-rewrites).
//
// Each operation is implemented by one rpc, except `org books accounts review`, which is one Core
// SDK flow (books.review-flow). `errors` holds what the CLI produces itself: CLI_USAGE (the
// Organization scope and its own argument checks) and, for the export, CLI_STORAGE.
//
// Worlds (books.worlds): org-without-chart, org-with-chart, org-with-chart-and-added-token,
// org-with-chart-and-node-down, signed-out.

import { Schema } from "effect";
import { budget, defineOperation, type Ref } from "../../../packages/book/src/index.ts";
import { frozen, frozenRefusals, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CLI_STORAGE,
  error_CLI_USAGE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  BookAccount,
  rpc_books_accounts_add,
  rpc_books_accounts_archive,
  rpc_books_accounts_import,
  rpc_books_accounts_list,
  rpc_books_accounts_reclassify,
  rpc_books_accounts_rename,
} from "./accounts.ts";
import { Annotation, rpc_books_annotations_save } from "./annotations.ts";
import { BookAsset, rpc_books_assets_add, rpc_books_assets_list, rpc_books_assets_remove } from "./assets.ts";
import { BookFact, rpc_books_facts_list } from "./facts.ts";
import {
  rpc_books_reports_balance_sheet,
  rpc_books_reports_profit_and_loss,
  rpc_books_reports_reconcile,
  rpc_books_reports_trial_balance,
} from "./reports.ts";
import { rpc_books_exports_quickbooks } from "./exports.ts";
import { flow_client_org_books_accounts_review } from "./flows.ts";
import { AccountType, Reference } from "./data.ts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

// ── worlds (named devnet snapshots, listed in books.worlds) ──────────────────────────────────

const NO_CHART = "org-without-chart";
const CHART = "org-with-chart";
const ADDED = "org-with-chart-and-added-token";
const NODE_DOWN = "org-with-chart-and-node-down";
const SIGNED_OUT = "signed-out";

// ── helpers: lines and refusals from the frozen text ─────────────────────────────────────────

type FrozenLine = { readonly claim: string; readonly was: readonly string[] };
const lineOf = (id: FrozenId, n: number): FrozenLine => {
  const a = (frozen[id].acceptance as unknown as readonly FrozenLine[])[n - 1];
  if (a === undefined) throw new Error(`${id}: no acceptance line ${n}`);
  return a;
};
/** A frozen claim kept word for word; its test citation moves to `was`. */
const keep = (id: FrozenId, n: number, observes: string) => {
  const a = lineOf(id, n);
  return { claim: a.claim, observes, was: [...a.was] };
};
/** A claim that named a mechanism, rewritten as an outcome; the old line and its citation go to `was`. */
const rewrite = (id: FrozenId, n: number, claim: string, observes: string) => {
  const a = lineOf(id, n);
  return { claim, observes, was: [a.claim, ...a.was] };
};

type Worlds = Readonly<Record<string, readonly [error: Ref<"error">, given: string]>>;
/** The page's refusals in its order, `when` verbatim; each code mapped to its error and world. */
const refusalsOf = (id: FrozenId, worlds: Worlds) =>
  frozenRefusals(id).map(({ code, when }) => {
    const mapped = worlds[code];
    if (mapped === undefined) throw new Error(`${id}: refusal ${code} has no error record`);
    return { error: mapped[0], given: mapped[1], when };
  });

const page = (id: string) => `apps/docs/factory/operations/${id}.yaml:1`;
const CLI = "apps/cli/src/commands/org/subcommands/books/subcommands";
const SDK = "packages/sdk/src/books";

const AccountRef = Schema.Struct({ accountId: S, code: S, name: S });
const Unpriced = Schema.Struct({ facts: Schema.Int, assets: Schema.Array(S) });
const Rules = Schema.Struct({ basis: Schema.Literal("cash"), version: S });
const Section = Schema.Struct({
  type: AccountType,
  rows: Schema.Array(Schema.Struct({ account: AccountRef, parent: NullOr(S), amount: S, total: S })),
  total: S,
});

// ── activity annotate ───────────────────────────────────────────────────────────────────────

export const operation_activity_annotate = defineOperation({
  ...frozenText("activity.annotate"),
  was: [page("activity.annotate"), "apps/cli/src/commands/activity/subcommands/annotate/command.ts:1", "packages/sdk/src/activity/methods.ts:1"],
  priority: "normal",
  implementedBy: rpc_books_annotations_save,
  acceptance: [
    keep("activity.annotate", 1, "cli: exit 0 with the account; read: `org books facts list --source` shows account_assigned, then recategorized."),
    keep("activity.annotate", 2, "cli: the 6999 save succeeds and the memo-only save exits with ROLE_PERMISSION_DENIED; read: the review queue lists the suggestion."),
    keep("activity.annotate", 3, "cli: `--new-account` by a Seat without the Books hat exits with ROLE_PERMISSION_DENIED; with the hat it succeeds."),
    keep("activity.annotate", 4, "cli: CLI_USAGE naming `accountingCategory`; world: no change."),
    rewrite(
      "activity.annotate",
      5,
      "A refused save changes nothing and reports nothing, and each committed save is reported once.",
      "world: a refused save leaves no change; trace: one book_annotation_transitioned per committed save, none for a refused one.",
    ),
    keep("activity.annotate", 6, "cli: without `--confirm` a script exits with CLI_USAGE; read: the saved annotation holds only the reference and annotation fields."),
  ],
  returns: Schema.Struct({ annotation: Annotation }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("activity.annotate", {
    CLI_USAGE: [error_CLI_USAGE, CHART],
    INVALID_INPUT: [error_INVALID_INPUT, CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
    NOT_AUTHENTICATED: [error_NOT_AUTHENTICATED, SIGNED_OUT],
  }),
  budget: budget("write"),
});

// ── org books accounts import ───────────────────────────────────────────────────────────────

export const operation_org_books_accounts_import = defineOperation({
  ...frozenText("org.books.accounts.import"),
  was: [page("org.books.accounts.import"), `${CLI}/accounts/subcommands/import/execute.ts:13`, `${SDK}/accounts.ts:188`],
  priority: "normal",
  implementedBy: rpc_books_accounts_import,
  acceptance: [
    keep("org.books.accounts.import", 1, "cli: `added`, `protected` and `safeAccounts` with 1010 linked to the Safe; read: `accounts list` shows the chart."),
    rewrite(
      "org.books.accounts.import",
      2,
      "The import is reported once, after it commits.",
      "trace: one book_chart_transitioned (transition import) for the import.",
    ),
    rewrite(
      "org.books.accounts.import",
      3,
      "A second import is refused and reports nothing more.",
      "cli: WRONG_STATE `already_set_up`; trace: no second book_chart_transitioned; world: no change.",
    ),
    rewrite(
      "org.books.accounts.import",
      4,
      "A Seat without Manage books, an outsider, the books gate off and a call with no session are each refused and report nothing.",
      "cli: ROLE_PERMISSION_DENIED, ROLE_PERMISSION_DENIED, FEATURE_NOT_AVAILABLE and NOT_AUTHENTICATED; trace: no book_chart_transitioned; world: no change.",
    ),
  ],
  returns: rpc_books_accounts_import.output,
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.accounts.import", {
    WRONG_STATE: [error_WRONG_STATE, CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, NO_CHART],
    INVALID_INPUT: [error_INVALID_INPUT, NO_CHART],
    NOT_AUTHENTICATED: [error_NOT_AUTHENTICATED, SIGNED_OUT],
  }),
  budget: budget("write"),
});

// ── org books accounts list ─────────────────────────────────────────────────────────────────

export const operation_org_books_accounts_list = defineOperation({
  ...frozenText("org.books.accounts.list"),
  was: [page("org.books.accounts.list"), `${CLI}/accounts/subcommands/list/execute.ts:13`, `${SDK}/accounts.ts:182`],
  priority: "normal",
  implementedBy: rpc_books_accounts_list,
  acceptance: [keep("org.books.accounts.list", 1, "cli: WRONG_STATE `no_chart` before the import, then the accounts in code order.")],
  returns: rpc_books_accounts_list.output,
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.accounts.list", {
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("read"),
});

// ── org books accounts add ──────────────────────────────────────────────────────────────────

export const operation_org_books_accounts_add = defineOperation({
  ...frozenText("org.books.accounts.add"),
  was: [page("org.books.accounts.add"), `${CLI}/accounts/subcommands/add/execute.ts:13`, `${SDK}/accounts.ts:190`],
  priority: "normal",
  implementedBy: rpc_books_accounts_add,
  acceptance: [
    keep("org.books.accounts.add", 1, "cli: `--under 6100` returns code 6101 with the parent's type."),
    keep("org.books.accounts.add", 2, "cli: a top-level expense returns the next free hundred in 6000-6999."),
    rewrite(
      "org.books.accounts.add",
      3,
      "Each committed account is reported once as added, and a refused add reports nothing.",
      "trace: one book_account_transitioned (transition add) per committed account, none for a refused add.",
    ),
    keep("org.books.accounts.add", 4, "cli: WRONG_STATE (no chart, archived parent), INVALID_INPUT (full range) and ROLE_PERMISSION_DENIED (no Books hat, outsider)."),
  ],
  returns: Schema.Struct({
    accountId: S,
    code: S,
    name: S,
    type: AccountType,
    parent: NullOr(AccountRef),
    status: Schema.Literal("active"),
  }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.accounts.add", {
    INVALID_INPUT: [error_INVALID_INPUT, CHART],
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("write"),
});

// ── org books accounts rename ───────────────────────────────────────────────────────────────

export const operation_org_books_accounts_rename = defineOperation({
  ...frozenText("org.books.accounts.rename"),
  was: [page("org.books.accounts.rename"), `${CLI}/accounts/subcommands/rename/execute.ts:18`, `${SDK}/accounts.ts:202`],
  priority: "normal",
  implementedBy: rpc_books_accounts_rename,
  acceptance: [
    keep("org.books.accounts.rename", 1, "cli: the account by code and by `acct_` id renamed and renumbered; read: an account_renamed fact."),
    keep("org.books.accounts.rename", 2, "cli: the sub-account keeps its parent and type; its name comes back trimmed."),
    keep("org.books.accounts.rename", 3, "cli: the account's own code succeeds, and a code freed by an archive is taken."),
    rewrite(
      "org.books.accounts.rename",
      4,
      "A call that changes nothing reports no change.",
      "trace: no book_account_transitioned for it; read: no account_renamed fact.",
    ),
    rewrite(
      "org.books.accounts.rename",
      5,
      "An archived account is refused and nothing is reported.",
      "cli: WRONG_STATE; trace: no book_account_transitioned.",
    ),
  ],
  returns: Schema.Struct({ accountId: S, code: S, name: S, type: AccountType }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.accounts.rename", {
    CLI_USAGE: [error_CLI_USAGE, CHART],
    INVALID_INPUT: [error_INVALID_INPUT, CHART],
    WRONG_STATE: [error_WRONG_STATE, CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("write"),
});

// ── org books accounts archive ──────────────────────────────────────────────────────────────

export const operation_org_books_accounts_archive = defineOperation({
  ...frozenText("org.books.accounts.archive"),
  was: [page("org.books.accounts.archive"), `${CLI}/accounts/subcommands/archive/execute.ts:10`, `${SDK}/accounts.ts:213`],
  priority: "normal",
  implementedBy: rpc_books_accounts_archive,
  acceptance: [
    keep("org.books.accounts.archive", 1, "cli: status `archived`; read: an account_archived fact and `accounts list` leaves it out."),
    rewrite(
      "org.books.accounts.archive",
      2,
      "A sub-account and then its parent are each reported once as archived.",
      "trace: two book_account_transitioned (transition archive), one per account.",
    ),
    rewrite(
      "org.books.accounts.archive",
      3,
      "Another Organization's account is refused and nothing is reported.",
      "cli: ROLE_PERMISSION_DENIED; trace: no book_account_transitioned; world: no change.",
    ),
  ],
  returns: Schema.Struct({ accountId: S, code: S, status: Schema.Literal("archived") }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.accounts.archive", {
    WRONG_STATE: [error_WRONG_STATE, CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("write"),
});

// ── org books accounts review ───────────────────────────────────────────────────────────────

export const operation_org_books_accounts_review = defineOperation({
  ...frozenText("org.books.accounts.review"),
  was: [page("org.books.accounts.review"), `${CLI}/accounts/subcommands/review/execute.ts:19`, `${SDK}/accounts.ts:214`],
  priority: "normal",
  implementedBy: flow_client_org_books_accounts_review,
  acceptance: [
    keep("org.books.accounts.review", 1, "cli: each waiting row with its account and suggested name, oldest first."),
    keep("org.books.accounts.review", 2, "cli: an outside deposit is listed with no suggestion until `--accept --name` gives it an account, then it is gone."),
  ],
  returns: Schema.Struct({
    rows: Schema.Array(Schema.Struct({ reference: Reference, account: AccountRef, suggestion: NullOr(S), waitingSince: N })),
  }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.accounts.review", {
    CLI_USAGE: [error_CLI_USAGE, CHART],
    INVALID_INPUT: [error_INVALID_INPUT, CHART],
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("write"),
});

// ── org books accounts reclassify ───────────────────────────────────────────────────────────

export const operation_org_books_accounts_reclassify = defineOperation({
  ...frozenText("org.books.accounts.reclassify"),
  was: [page("org.books.accounts.reclassify"), `${CLI}/accounts/subcommands/reclassify/execute.ts:43`, `${SDK}/reclassify.ts:31`],
  priority: "normal",
  implementedBy: rpc_books_accounts_reclassify,
  acceptance: [
    keep("org.books.accounts.reclassify", 1, "cli: `moved` lists every waiting row of the period and one `factId`; read: one rows_reclassified fact."),
    keep("org.books.accounts.reclassify", 2, "cli: `moved` and `refused` with each reason."),
    keep("org.books.accounts.reclassify", 3, "cli: the row is in `refused` with `straddles_period`, with or without `--row`."),
    rewrite(
      "org.books.accounts.reclassify",
      4,
      "When nothing moves it records no fact and reports no change.",
      "cli: `factId` null; read: no rows_reclassified fact; trace: no book_annotation_transitioned.",
    ),
    keep("org.books.accounts.reclassify", 5, "cli: the second call's `moved` is empty and its `factId` null."),
  ],
  returns: rpc_books_accounts_reclassify.output,
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.accounts.reclassify", {
    CLI_USAGE: [error_CLI_USAGE, CHART],
    INVALID_INPUT: [error_INVALID_INPUT, CHART],
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("write"),
});

// ── org books assets list ───────────────────────────────────────────────────────────────────

export const operation_org_books_assets_list = defineOperation({
  ...frozenText("org.books.assets.list"),
  was: [page("org.books.assets.list"), `${CLI}/assets/subcommands/list/execute.ts:10`, `${SDK}/assets.ts:40`],
  priority: "normal",
  implementedBy: rpc_books_assets_list,
  acceptance: [
    keep("org.books.assets.list", 1, "cli: Capxul's assets first, `priced` true and `addedBy` null, before any chart exists."),
    keep("org.books.assets.list", 2, "cli: added tokens after them in the order first saved, with `addedBy` and `addedAt`."),
    keep("org.books.assets.list", 3, "cli: an added token named USDC has `priced` false; read: its facts carry no USD."),
    keep("org.books.assets.list", 4, "cli: a removed token is absent, and another Organization's list does not show this one's tokens."),
    keep("org.books.assets.list", 5, "cli: a Seat with and a Seat without the Books hat get the same list."),
  ],
  returns: Schema.Struct({ assets: Schema.Array(BookAsset) }),
  errors: [error_CLI_USAGE],
  // An empty Organization id never reaches the rpc from the CLI: its scope refuses it with CLI_USAGE first.
  refusals: refusalsOf("org.books.assets.list", {
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
  }),
  budget: budget("read"),
});

// ── org books assets add ────────────────────────────────────────────────────────────────────

export const operation_org_books_assets_add = defineOperation({
  ...frozenText("org.books.assets.add"),
  was: [page("org.books.assets.add"), `${CLI}/assets/subcommands/add/execute.ts:10`, `${SDK}/assets.ts:41`],
  priority: "normal",
  implementedBy: rpc_books_assets_add,
  acceptance: [
    keep("org.books.assets.add", 1, "cli: tier `added`, `priced` false; read: `assets list` shows it after Capxul's own."),
    keep("org.books.assets.add", 2, "cli: a token whose `symbol()` returns bytes32 comes back with its text symbol."),
    keep("org.books.assets.add", 3, "chain: a Transfer of the token into the Safe; read: a facts list entry under its symbol with `usd` null."),
    rewrite(
      "org.books.assets.add",
      4,
      "Each committed add is reported once, and an add after a removal is reported again.",
      "trace: one book_asset_transitioned per add (transition add, then readd after a removal).",
    ),
    rewrite(
      "org.books.assets.add",
      5,
      "A refused add saves nothing and reports nothing, even when the chain was read first.",
      "cli: the refusal's code; world: no new token; trace: no book_asset_transitioned.",
    ),
  ],
  returns: Schema.Struct({
    assetId: S,
    address: S,
    symbol: S,
    decimals: N,
    tier: Schema.Literal("added"),
    priced: Schema.Literal(false),
  }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.assets.add", {
    INVALID_INPUT: [error_INVALID_INPUT, CHART],
    WRONG_STATE: [error_WRONG_STATE, CHART],
    PROVIDER_ERROR: [error_PROVIDER_ERROR, NODE_DOWN],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("chain-read"),
});

// ── org books assets remove ─────────────────────────────────────────────────────────────────

export const operation_org_books_assets_remove = defineOperation({
  ...frozenText("org.books.assets.remove"),
  was: [page("org.books.assets.remove"), `${CLI}/assets/subcommands/remove/execute.ts:10`, `${SDK}/assets.ts:42`],
  priority: "normal",
  implementedBy: rpc_books_assets_remove,
  acceptance: [
    keep("org.books.assets.remove", 1, "cli: the token removed; read: `assets list` leaves it out and its facts stay in the facts list."),
    keep("org.books.assets.remove", 2, "read: the other Organization's `assets list` still shows the token."),
    rewrite(
      "org.books.assets.remove",
      3,
      "A token only another Organization added is refused and nothing is reported.",
      "cli: WRONG_STATE `asset_not_added`; trace: no book_asset_transitioned.",
    ),
    rewrite(
      "org.books.assets.remove",
      4,
      "A token removed, added and removed again is reported once for each removal.",
      "trace: two book_asset_transitioned with transition remove.",
    ),
  ],
  returns: Schema.Struct({ assetId: S, address: S }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.assets.remove", {
    WRONG_STATE: [error_WRONG_STATE, CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, ADDED],
  }),
  budget: budget("write"),
});

// ── org books export quickbooks ─────────────────────────────────────────────────────────────

export const operation_org_books_export_quickbooks = defineOperation({
  ...frozenText("org.books.export.quickbooks"),
  was: [page("org.books.export.quickbooks"), `${CLI}/export/subcommands/quickbooks/execute.ts:1`, `${SDK}/exports.ts:1`],
  priority: "normal",
  implementedBy: rpc_books_exports_quickbooks,
  acceptance: [
    keep("org.books.export.quickbooks", 1, "cli: the two files in `--out`; their rows are the chart and one balanced entry per priced money fact in the window."),
    keep("org.books.export.quickbooks", 2, "cli: WRONG_STATE `no_chart` before the import, then the files."),
  ],
  returns: Schema.Struct({
    from: N,
    to: N,
    accounts: S,
    journal: S,
    entries: N,
    unpriced: Unpriced,
  }),
  errors: [error_CLI_USAGE, error_CLI_STORAGE],
  refusals: refusalsOf("org.books.export.quickbooks", {
    CLI_STORAGE: [error_CLI_STORAGE, CHART],
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("read"),
});

// ── org books facts list ────────────────────────────────────────────────────────────────────

export const operation_org_books_facts_list = defineOperation({
  ...frozenText("org.books.facts.list"),
  was: [page("org.books.facts.list"), `${CLI}/facts/subcommands/list/execute.ts:20`, `${SDK}/accounts.ts:233`],
  priority: "normal",
  implementedBy: rpc_books_facts_list,
  acceptance: [
    keep("org.books.facts.list", 1, "cli: an empty page and `next` null, with no chart."),
    keep("org.books.facts.list", 2, "cli: a fact recorded later for an earlier block lists before one recorded earlier for a later block."),
    keep("org.books.facts.list", 3, "cli: amount, `usd` with its rate and source, party and source; an unpriced fact has `usd` null."),
    keep("org.books.facts.list", 4, "cli: after a devnet reorganization, a `reversed` fact whose `reverses` is the settled fact's id."),
    keep("org.books.facts.list", 5, "cli: pages of 50; following `next` returns every fact once, in order."),
    keep("org.books.facts.list", 6, "cli: each filter returns only its facts, and another Organization's facts never appear."),
  ],
  returns: Schema.Struct({ facts: Schema.Array(BookFact), next: NullOr(S) }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.facts.list", {
    CLI_USAGE: [error_CLI_USAGE, NO_CHART],
    INVALID_INPUT: [error_INVALID_INPUT, CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("read"),
});

// ── org books reports ───────────────────────────────────────────────────────────────────────

export const operation_org_books_reports_balance_sheet = defineOperation({
  ...frozenText("org.books.reports.balance-sheet"),
  was: [page("org.books.reports.balance-sheet"), `${CLI}/reports/subcommands/balance-sheet/execute.ts:1`, `${SDK}/reports.ts:59`],
  priority: "normal",
  implementedBy: rpc_books_reports_balance_sheet,
  acceptance: [
    keep("org.books.reports.balance-sheet", 1, "cli: assets equal `liabilitiesAndEquity`."),
    keep("org.books.reports.balance-sheet", 2, "cli: money settled before the import shows under a Safe account per asset once the chart is made."),
    keep("org.books.reports.balance-sheet", 3, "cli: `asOf` is now without the flag, and the end of the given day with it."),
  ],
  returns: Schema.Struct({
    rules: Rules,
    asOf: N,
    sections: Schema.Array(Section),
    currentEarnings: S,
    liabilitiesAndEquity: S,
    unpriced: Unpriced,
  }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.reports.balance-sheet", {
    CLI_USAGE: [error_CLI_USAGE, CHART],
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("read"),
});

export const operation_org_books_reports_profit_and_loss = defineOperation({
  ...frozenText("org.books.reports.profit-and-loss"),
  was: [page("org.books.reports.profit-and-loss"), `${CLI}/reports/subcommands/profit-and-loss/execute.ts:1`, `${SDK}/reports.ts:48`],
  priority: "normal",
  implementedBy: rpc_books_reports_profit_and_loss,
  acceptance: [
    keep("org.books.reports.profit-and-loss", 1, "cli: money just before `--from` and just after `--to` is not in the totals."),
    keep("org.books.reports.profit-and-loss", 2, "cli: the parent's total includes its sub-account's once, and the section total counts it once."),
    keep("org.books.reports.profit-and-loss", 3, "cli: after 6999 is renumbered, unannotated money out still shows under it."),
  ],
  returns: Schema.Struct({
    rules: Rules,
    from: N,
    to: N,
    sections: Schema.Array(Section),
    grossProfit: S,
    netIncome: S,
    unpriced: Unpriced,
  }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.reports.profit-and-loss", {
    CLI_USAGE: [error_CLI_USAGE, CHART],
    INVALID_INPUT: [error_INVALID_INPUT, CHART],
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("read"),
});

export const operation_org_books_reports_reconcile = defineOperation({
  ...frozenText("org.books.reports.reconcile"),
  was: [page("org.books.reports.reconcile"), `${CLI}/reports/subcommands/reconcile/execute.ts:1`, `${SDK}/reports.ts:1`],
  priority: "normal",
  implementedBy: rpc_books_reports_reconcile,
  acceptance: [
    keep("org.books.reports.reconcile", 1, "cli: `matches` true with every `difference` 0, including while a claim escrow the Organization funded is open."),
    keep("org.books.reports.reconcile", 2, "cli: one line per Capxul asset and per added token; chain: each line's `chain` equals the Safe's balanceOf."),
    keep("org.books.reports.reconcile", 3, "cli: after a Transfer the books never saw (a devnet mint to the Safe), that asset's `difference` is the amount; lines in name order."),
  ],
  returns: rpc_books_reports_reconcile.output,
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.reports.reconcile", {
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    PROVIDER_ERROR: [error_PROVIDER_ERROR, NODE_DOWN],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("chain-read"),
});

export const operation_org_books_reports_trial_balance = defineOperation({
  ...frozenText("org.books.reports.trial-balance"),
  was: [page("org.books.reports.trial-balance"), `${CLI}/reports/subcommands/trial-balance/execute.ts:1`, `${SDK}/reports.ts:59`],
  priority: "normal",
  implementedBy: rpc_books_reports_trial_balance,
  acceptance: [
    keep("org.books.reports.trial-balance", 1, "cli: WRONG_STATE `no_chart` before the import, then the report."),
    keep("org.books.reports.trial-balance", 2, "cli: total debits equal total credits; the Safe account's `holds` equals the Safe's balance."),
    keep("org.books.reports.trial-balance", 3, "cli: a payment out debits its row's account and credits the Safe account; a deposit the reverse."),
    keep("org.books.reports.trial-balance", 4, "cli: `unpriced` counts the fact with no USD; an account_created fact moves no total."),
  ],
  returns: rpc_books_reports_trial_balance.output,
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.reports.trial-balance", {
    CLI_USAGE: [error_CLI_USAGE, CHART],
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("read"),
});
