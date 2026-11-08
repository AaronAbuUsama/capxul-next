// The old book's Books area, as it is: one operation record for each operation that
// apps/docs/factory/areas/books.yaml lists (16), read from /home/user/factory (branch
// integration/factory). The text (title, about, who, changes, notes, mistakes, acceptance and each
// refusal's `when`) is the frozen book's, spread from ../../frozen, never retyped.
//
// implementedBy: every CLI command here (apps/cli/src/commands/org/subcommands/books/) resolves the
// Organization (proposal/internal/scope.ts:15) and calls one method of `client.org(orgId).books`
// (packages/sdk/src/books/). Each of those methods forwards one protocol row through `call`
// (accounts.ts:155), so each operation is implemented by the one rpc it reaches, owned by the books
// area file of its backend folder (../books/accounts.ts, assets.ts, facts.ts, reports.ts, exports.ts).
// The SDK's date handling (reports.ts:48, :59; reclassify.ts:34; accounts.ts:260) turns days into epoch
// ms and refuses a day that is no date with INVALID_INPUT before any call: local argument work, not a
// second call, so no flow.
//
// returns: a Struct of the page's `returns` fields, each typed from the protocol row's output schema
// (packages/protocol/src/books/*-schema.ts). Where the CLI prints the row's answer under one key
// (`{ account }`, `{ asset }`) or prints other fields, the comment on that operation says so.
//
// errors: what the CLI command produces itself, before or after its implementation. Every command
// here goes through the Organization scope, which refuses with CLI_USAGE (more than one `--org`, an
// `--org` that is no ID, none chosen in a script: auth/actor.ts:28, allowance/internal/scope.ts:16,
// :20, proposal/internal/scope.ts:31) and with ROLE_PERMISSION_DENIED (an Organization not in your
// list, scope.ts:41 → org/internal/lifecycle.ts:17). The session restore that refuses
// NOT_AUTHENTICATED when no session is stored (auth/first-party.ts:173) is shared by every signed-in
// command and is left out, as ../payments/operations.ts leaves it out.
//
// A refusal's `given` names a saved devnet world (packages/scenarios) from which a scenario step's
// command reaches the refusal; the story's own setup (a gate, a clock warp) runs first. `?` where no
// step reaches it from a saved world. No budget: nothing measured these commands.

import { Schema } from "effect";
import { defineOperation, type Ref } from "../../../packages/book/src/index.ts";
import { frozenClaims, frozenRefusals, frozenText, type FrozenId } from "../../frozen/index.ts";
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
  rpc_books_accounts_add,
  rpc_books_accounts_archive,
  rpc_books_accounts_import,
  rpc_books_accounts_list,
  rpc_books_accounts_reclassify,
  rpc_books_accounts_rename,
  rpc_books_accounts_review,
} from "../books/accounts.ts";
import { rpc_books_assets_add, rpc_books_assets_list, rpc_books_assets_remove } from "../books/assets.ts";
import { rpc_books_facts_list } from "../books/facts.ts";
import {
  rpc_books_reports_balance_sheet,
  rpc_books_reports_profit_and_loss,
  rpc_books_reports_reconcile,
  rpc_books_reports_trial_balance,
} from "../books/reports.ts";
import { rpc_books_exports_quickbooks } from "../books/exports.ts";

// ── how a page's refusals become records ─────────────────────────────────────────────────────

type Worlds = Readonly<Record<string, readonly [error: Ref<"error">, given: string]>>;

/** The page's refusals in its order, `when` verbatim; each code mapped to its error and world. */
const refusalsOf = (id: FrozenId, worlds: Worlds) =>
  frozenRefusals(id).map(({ code, when }) => {
    const mapped = worlds[code];
    if (mapped === undefined) throw new Error(`${id}: refusal ${code} has no error record`);
    return { error: mapped[0], given: mapped[1], when };
  });

const book = (id: string) => `apps/docs/factory/operations/${id}.yaml:1`;
const CLI = "apps/cli/src/commands/org/subcommands/books";
const SDK = "packages/sdk/src/books";
const ROWS = "packages/protocol/src/books";

/** The Organization scope every books command resolves first, and the refusals it makes itself. */
const SCOPE_WAS = [
  `${CLI}/internal/call.ts:18`,
  "apps/cli/src/commands/org/subcommands/proposal/internal/scope.ts:31",
  "apps/cli/src/commands/org/subcommands/proposal/internal/scope.ts:41",
  "apps/cli/src/commands/org/internal/lifecycle.ts:17",
  "apps/cli/src/commands/org/subcommands/allowance/internal/scope.ts:16",
  "apps/cli/src/auth/input.ts:20",
];
const SCOPE_ERRORS = [error_CLI_USAGE, error_ROLE_PERMISSION_DENIED];

/** S26 restores the world S1 leaves (s26:128) and turns the books gate on (s26:132). */
const S26 = "packages/scenarios/src/acme/s26-acme-reads-its-reports.scenario.ts";

// ── the row shapes (packages/protocol/src/books/) ────────────────────────────────────────────

const BOOK_ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "cost_of_services", "expense"] as const; // model.ts:7
const BOOK_FACT_KINDS = [
  "account_created",
  "account_renamed",
  "account_archived",
  "account_assigned",
  "recategorized",
  "rows_reclassified",
  "payment_settled",
  "payment_received",
  "deposit_received",
  "payment_sent_outside",
  "payout_returned",
  "opening_balance",
  "reversed",
] as const; // model.ts:189

/** BookRowSchema (schema.ts:42). */
const BookRow = Schema.Struct({ kind: Schema.Literals(["payment", "movement"]), id: Schema.String });

/** BookAccountRefSchema (schema.ts:48). */
const BookAccountRef = Schema.Struct({ accountId: Schema.String, code: Schema.String, name: Schema.String });

/** BookAccountSchema (schema.ts:55). The code's format checks are not transcribed. */
const BookAccount = Schema.Struct({
  accountId: Schema.String,
  code: Schema.String,
  name: Schema.String,
  type: Schema.Literals(BOOK_ACCOUNT_TYPES),
  parent: Schema.NullOr(BookAccountRef),
  quickbooksDetailType: Schema.String,
  status: Schema.Literals(["active", "archived"]),
  protection: Schema.NullOr(Schema.Literals(["safe", "uncategorized", "posting", "opening"])),
  safe: Schema.NullOr(Schema.Struct({ address: Schema.String, asset: Schema.String })),
});

/** BookAssetSchema (asset-schema.ts:21). */
const BookAsset = Schema.Struct({
  assetId: Schema.String,
  chainId: Schema.Number,
  address: Schema.String,
  symbol: Schema.String,
  decimals: Schema.Number,
  tier: Schema.Literals(["settlement", "held", "added"]),
  priced: Schema.Boolean,
  addedBy: Schema.NullOr(Schema.String),
  addedAt: Schema.NullOr(Schema.Number),
});

/** BookFactSchema (fact-schema.ts:26), with BookUsdValueSchema (:13) and BookFactActorSchema (:21). */
const BookFact = Schema.Struct({
  factId: Schema.String,
  kind: Schema.Literals(BOOK_FACT_KINDS),
  occurredAt: Schema.Number,
  blockTime: Schema.NullOr(Schema.Number),
  amount: Schema.NullOr(Schema.Struct({ value: Schema.String, asset: Schema.String })),
  usd: Schema.NullOr(Schema.Struct({ value: Schema.String, rate: Schema.String, source: Schema.String })),
  account: Schema.NullOr(BookAccountRef),
  fromAccount: Schema.NullOr(BookAccountRef),
  party: Schema.NullOr(Schema.String),
  reference: Schema.NullOr(BookRow),
  rows: Schema.Array(BookRow),
  source: Schema.NullOr(
    Schema.Struct({ kind: Schema.Literals(["payment", "deposit", "claim", "movement"]), id: Schema.String }),
  ),
  reverses: Schema.NullOr(Schema.String),
  txHash: Schema.NullOr(Schema.String),
  actor: Schema.Struct({ kind: Schema.Literals(["person", "system"]) }),
  recordedAt: Schema.Number,
});

/** The report shapes (report-schema.ts): RulesSchema (:18), UnpricedSchema (:49), the statement rows (:67, :75). */
const Rules = Schema.Struct({ basis: Schema.Literal("cash"), version: Schema.String });
const Unpriced = Schema.Struct({ facts: Schema.Int, assets: Schema.Array(Schema.String) });
const StatementSection = Schema.Struct({
  type: Schema.Literals(BOOK_ACCOUNT_TYPES),
  rows: Schema.Array(
    Schema.Struct({ account: BookAccountRef, parent: Schema.NullOr(Schema.String), amount: Schema.String, total: Schema.String }),
  ),
  total: Schema.String,
});

// ── org books accounts import ───────────────────────────────────────────────────────────────

export const operation_org_books_accounts_import = defineOperation({
  ...frozenText("org.books.accounts.import"),
  was: [
    book("org.books.accounts.import"),
    `${CLI}/subcommands/accounts/subcommands/import/command.ts:12`,
    `${CLI}/subcommands/accounts/subcommands/import/execute.ts:13`,
    `${SDK}/accounts.ts:188`,
    `${ROWS}/operations.ts:82`,
    `${ROWS}/schema.ts:82`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_books_accounts_import,
  acceptance: frozenClaims("org.books.accounts.import"),
  // ChartImportedSchema (schema.ts:82); the CLI prints it as is (import/execute.ts:15).
  returns: Schema.Struct({
    template: Schema.Literals(["us-services"]),
    added: Schema.Number,
    protected: Schema.Array(Schema.String),
    safeAccounts: Schema.Array(
      Schema.Struct({ code: Schema.String, accountId: Schema.String, safe: Schema.String, asset: Schema.String }),
    ),
    basis: Schema.Literals(["cash"]),
  }),
  errors: SCOPE_ERRORS,
  // As is, `--template` is a closed flag (import/command.ts:7): a template that does not exist is refused by the
  // CLI's parser with CLI_USAGE before the row's INVALID_INPUT can answer. Recorded as the page names it.
  refusals: refusalsOf("org.books.accounts.import", {
    WRONG_STATE: [error_WRONG_STATE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    NOT_AUTHENTICATED: [error_NOT_AUTHENTICATED, "?"],
  }),
});

// ── org books accounts list ─────────────────────────────────────────────────────────────────

export const operation_org_books_accounts_list = defineOperation({
  ...frozenText("org.books.accounts.list"),
  was: [
    book("org.books.accounts.list"),
    `${CLI}/subcommands/accounts/subcommands/list/command.ts:13`,
    `${CLI}/subcommands/accounts/subcommands/list/execute.ts:13`,
    `${SDK}/accounts.ts:182`,
    `${ROWS}/operations.ts:72`,
    `${ROWS}/schema.ts:71`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_books_accounts_list,
  acceptance: frozenClaims("org.books.accounts.list"),
  // BookChartSchema (schema.ts:71); the CLI prints it as is (list/execute.ts:15).
  returns: Schema.Struct({ basis: Schema.Literals(["cash"]), accounts: Schema.Array(BookAccount) }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.books.accounts.list", {
    WRONG_STATE: [error_WRONG_STATE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org books accounts add ──────────────────────────────────────────────────────────────────

export const operation_org_books_accounts_add = defineOperation({
  ...frozenText("org.books.accounts.add"),
  was: [
    book("org.books.accounts.add"),
    `${CLI}/subcommands/accounts/subcommands/add/command.ts:25`,
    `${CLI}/subcommands/accounts/subcommands/add/execute.ts:13`,
    `${CLI}/subcommands/accounts/subcommands/add/execute.ts:23`,
    `${SDK}/accounts.ts:190`,
    `${ROWS}/operations.ts:89`,
    `${ROWS}/schema.ts:55`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_books_accounts_add,
  acceptance: frozenClaims("org.books.accounts.add"),
  // The page's fields are BookAccountSchema's (schema.ts:55). As is, the CLI prints `{ account }`
  // (add/execute.ts:23), so the fields sit one level down.
  returns: Schema.Struct({
    accountId: BookAccount.fields.accountId,
    code: BookAccount.fields.code,
    name: BookAccount.fields.name,
    type: BookAccount.fields.type,
    parent: BookAccount.fields.parent,
    status: BookAccount.fields.status,
  }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.books.accounts.add", {
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    WRONG_STATE: [error_WRONG_STATE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org books accounts rename ───────────────────────────────────────────────────────────────

export const operation_org_books_accounts_rename = defineOperation({
  ...frozenText("org.books.accounts.rename"),
  was: [
    book("org.books.accounts.rename"),
    `${CLI}/subcommands/accounts/subcommands/rename/command.ts:12`,
    `${CLI}/subcommands/accounts/subcommands/rename/execute.ts:18`,
    `${CLI}/subcommands/accounts/subcommands/rename/execute.ts:20`,
    `${SDK}/accounts.ts:202`,
    `${ROWS}/operations.ts:96`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_books_accounts_rename,
  acceptance: frozenClaims("org.books.accounts.rename"),
  // BookAccountSchema's fields (schema.ts:55); the CLI prints `{ account }` (rename/execute.ts:29).
  returns: Schema.Struct({
    accountId: BookAccount.fields.accountId,
    code: BookAccount.fields.code,
    name: BookAccount.fields.name,
    type: BookAccount.fields.type,
  }),
  // The CLI refuses neither `--name` nor `--code` itself (rename/execute.ts:18).
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.books.accounts.rename", {
    CLI_USAGE: [error_CLI_USAGE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    WRONG_STATE: [error_WRONG_STATE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org books accounts archive ──────────────────────────────────────────────────────────────

export const operation_org_books_accounts_archive = defineOperation({
  ...frozenText("org.books.accounts.archive"),
  was: [
    book("org.books.accounts.archive"),
    `${CLI}/subcommands/accounts/subcommands/archive/command.ts:5`,
    `${CLI}/subcommands/accounts/subcommands/archive/execute.ts:10`,
    `${SDK}/accounts.ts:213`,
    `${ROWS}/operations.ts:103`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_books_accounts_archive,
  acceptance: frozenClaims("org.books.accounts.archive"),
  // BookAccountSchema's fields (schema.ts:55); the CLI prints `{ account }` (archive/execute.ts:12).
  returns: Schema.Struct({
    accountId: BookAccount.fields.accountId,
    code: BookAccount.fields.code,
    status: BookAccount.fields.status,
  }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.books.accounts.archive", {
    WRONG_STATE: [error_WRONG_STATE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org books accounts review ───────────────────────────────────────────────────────────────

// The CLI reads the queue with `books.accounts.review` (review/execute.ts:21), the method the page names. With
// `--accept <id>` it finds the row in that queue and then calls `books.accounts.accept` (:31), a second row
// (books.accounts.accept, operations.ts:117), and prints its SuggestionAccepted instead of the queue. Two SDK
// methods composed by the CLI, not an SDK flow: implementedBy is the rpc the named method reaches.
export const operation_org_books_accounts_review = defineOperation({
  ...frozenText("org.books.accounts.review"),
  was: [
    book("org.books.accounts.review"),
    `${CLI}/subcommands/accounts/subcommands/review/command.ts:18`,
    `${CLI}/subcommands/accounts/subcommands/review/execute.ts:19`,
    `${CLI}/subcommands/accounts/subcommands/review/execute.ts:21`,
    `${CLI}/subcommands/accounts/subcommands/review/execute.ts:26`,
    `${CLI}/subcommands/accounts/subcommands/review/execute.ts:31`,
    `${SDK}/accounts.ts:214`,
    `${SDK}/accounts.ts:215`,
    `${ROWS}/operations.ts:110`,
    `${ROWS}/operations.ts:117`,
    `${ROWS}/schema.ts:138`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_books_accounts_review,
  acceptance: frozenClaims("org.books.accounts.review"),
  // ReviewQueueSchema (schema.ts:138) with ReviewRowSchema (:130).
  returns: Schema.Struct({
    rows: Schema.Array(
      Schema.Struct({
        reference: BookRow,
        account: BookAccountRef,
        suggestion: Schema.NullOr(Schema.String),
        assignedAt: Schema.Number,
      }),
    ),
  }),
  // The CLI refuses `--under` or `--name` without `--accept` (:19) and an `--accept` not in the queue (:26).
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.books.accounts.review", {
    CLI_USAGE: [error_CLI_USAGE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    WRONG_STATE: [error_WRONG_STATE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org books accounts reclassify ───────────────────────────────────────────────────────────

// With `--row`, the CLI first reads the review queue (`books.accounts.review`, reclassify/execute.ts:34) to name
// each row's kind, then calls `books.accounts.reclassify` (:43). The SDK method forwards one row
// (reclassify.ts:31); it refuses a day that is no date, or `to` before `from`, with INVALID_INPUT first (:36-39).
export const operation_org_books_accounts_reclassify = defineOperation({
  ...frozenText("org.books.accounts.reclassify"),
  was: [
    book("org.books.accounts.reclassify"),
    `${CLI}/subcommands/accounts/subcommands/reclassify/command.ts:27`,
    `${CLI}/subcommands/accounts/subcommands/reclassify/execute.ts:20`,
    `${CLI}/subcommands/accounts/subcommands/reclassify/execute.ts:27`,
    `${CLI}/subcommands/accounts/subcommands/reclassify/execute.ts:34`,
    `${CLI}/subcommands/accounts/subcommands/reclassify/execute.ts:43`,
    `${CLI}/subcommands/reports/internal.ts:16`,
    `${SDK}/reclassify.ts:31`,
    `${SDK}/reclassify.ts:39`,
    `${ROWS}/operations.ts:129`,
    `${ROWS}/schema.ts:192`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_books_accounts_reclassify,
  acceptance: frozenClaims("org.books.accounts.reclassify"),
  // ReclassifiedSchema (schema.ts:192); the CLI prints it as is (reclassify/execute.ts:54).
  returns: Schema.Struct({
    fromAccount: BookAccountRef,
    toAccount: BookAccountRef,
    factId: Schema.NullOr(Schema.String),
    moved: Schema.Array(BookRow),
    refused: Schema.Array(
      Schema.Struct({ reference: BookRow, reason: Schema.Literals(["not_waiting", "outside_period", "straddles_period"]) }),
    ),
  }),
  // The CLI refuses a `--from` or `--to` that is no date (reports/internal.ts:16) and `--to` before `--from` (:27).
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.books.accounts.reclassify", {
    CLI_USAGE: [error_CLI_USAGE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    WRONG_STATE: [error_WRONG_STATE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org books assets list ───────────────────────────────────────────────────────────────────

export const operation_org_books_assets_list = defineOperation({
  ...frozenText("org.books.assets.list"),
  was: [
    book("org.books.assets.list"),
    `${CLI}/subcommands/assets/subcommands/list/command.ts:5`,
    `${CLI}/subcommands/assets/subcommands/list/execute.ts:10`,
    `${SDK}/assets.ts:40`,
    `${ROWS}/operations.ts:196`,
    `${ROWS}/asset-schema.ts:37`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_books_assets_list,
  acceptance: frozenClaims("org.books.assets.list"),
  // BookAssetsSchema (asset-schema.ts:37); the CLI prints it as is (list/execute.ts:12).
  returns: Schema.Struct({ assets: Schema.Array(BookAsset) }),
  errors: SCOPE_ERRORS,
  // As is, an empty Organization ID never reaches the row from the CLI: the scope refuses it with CLI_USAGE first.
  refusals: refusalsOf("org.books.assets.list", {
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
  }),
});

// ── org books assets add ────────────────────────────────────────────────────────────────────

export const operation_org_books_assets_add = defineOperation({
  ...frozenText("org.books.assets.add"),
  was: [
    book("org.books.assets.add"),
    `${CLI}/subcommands/assets/subcommands/add/command.ts:5`,
    `${CLI}/subcommands/assets/subcommands/add/execute.ts:10`,
    `${SDK}/assets.ts:41`,
    `${ROWS}/operations.ts:182`,
    `${ROWS}/asset-schema.ts:21`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_books_assets_add,
  acceptance: frozenClaims("org.books.assets.add"),
  // BookAssetSchema's fields (asset-schema.ts:21); the CLI prints `{ asset }` (add/execute.ts:12).
  returns: Schema.Struct({
    assetId: BookAsset.fields.assetId,
    address: BookAsset.fields.address,
    symbol: BookAsset.fields.symbol,
    decimals: BookAsset.fields.decimals,
    tier: BookAsset.fields.tier,
    priced: BookAsset.fields.priced,
  }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.books.assets.add", {
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    WRONG_STATE: [error_WRONG_STATE, "?"],
    PROVIDER_ERROR: [error_PROVIDER_ERROR, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org books assets remove ─────────────────────────────────────────────────────────────────

export const operation_org_books_assets_remove = defineOperation({
  ...frozenText("org.books.assets.remove"),
  was: [
    book("org.books.assets.remove"),
    `${CLI}/subcommands/assets/subcommands/remove/command.ts:5`,
    `${CLI}/subcommands/assets/subcommands/remove/execute.ts:10`,
    `${SDK}/assets.ts:42`,
    `${ROWS}/operations.ts:189`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_books_assets_remove,
  acceptance: frozenClaims("org.books.assets.remove"),
  // BookAssetSchema's fields (asset-schema.ts:21); the CLI prints `{ asset }` (remove/execute.ts:12).
  returns: Schema.Struct({ assetId: BookAsset.fields.assetId, address: BookAsset.fields.address }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.books.assets.remove", {
    WRONG_STATE: [error_WRONG_STATE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org books facts list ────────────────────────────────────────────────────────────────────

// The SDK method forwards one row; a `since` that is no date is refused INVALID_INPUT before it (accounts.ts:238).
// As is, the CLI has no `--limit` flag (facts/list/command.ts:6): a limit outside 1 to 200 cannot be given from it.
export const operation_org_books_facts_list = defineOperation({
  ...frozenText("org.books.facts.list"),
  was: [
    book("org.books.facts.list"),
    `${CLI}/subcommands/facts/subcommands/list/command.ts:26`,
    `${CLI}/subcommands/facts/subcommands/list/execute.ts:20`,
    `${CLI}/subcommands/facts/subcommands/list/execute.ts:23`,
    `${SDK}/accounts.ts:233`,
    `${SDK}/accounts.ts:238`,
    `${ROWS}/operations.ts:154`,
    `${ROWS}/fact-schema.ts:71`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_books_facts_list,
  acceptance: frozenClaims("org.books.facts.list"),
  // BookFactPageSchema (fact-schema.ts:71); the CLI prints it as is (list/execute.ts:33).
  returns: Schema.Struct({ facts: Schema.Array(BookFact), next: Schema.NullOr(Schema.String) }),
  // The CLI refuses a `--since` that is no date itself (list/execute.ts:20).
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.books.facts.list", {
    CLI_USAGE: [error_CLI_USAGE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org books reports trial-balance ─────────────────────────────────────────────────────────

export const operation_org_books_reports_trial_balance = defineOperation({
  ...frozenText("org.books.reports.trial-balance"),
  was: [
    book("org.books.reports.trial-balance"),
    `${CLI}/subcommands/reports/subcommands/trial-balance/command.ts:8`,
    `${CLI}/subcommands/reports/subcommands/trial-balance/execute.ts:13`,
    `${CLI}/subcommands/reports/subcommands/trial-balance/execute.ts:16`,
    `${CLI}/subcommands/reports/internal.ts:16`,
    `${SDK}/reports.ts:77`,
    `${SDK}/reports.ts:74`,
    `${ROWS}/operations.ts:211`,
    `${ROWS}/report-schema.ts:54`,
    ...SCOPE_WAS,
    `${S26}:128`,
    `${S26}:132`,
    `${S26}:335`,
  ],
  priority: "normal",
  implementedBy: rpc_books_reports_trial_balance,
  acceptance: frozenClaims("org.books.reports.trial-balance"),
  // TrialBalanceSchema (report-schema.ts:54) with TrialBalanceLineSchema (:39); the CLI prints it as is.
  returns: Schema.Struct({
    rules: Rules,
    asOf: Schema.Number,
    lines: Schema.Array(
      Schema.Struct({
        account: BookAccountRef,
        type: Schema.Literals(BOOK_ACCOUNT_TYPES),
        debit: Schema.String,
        credit: Schema.String,
        held: Schema.NullOr(Schema.Struct({ value: Schema.String, asset: Schema.String })),
      }),
    ),
    totals: Schema.Struct({ debit: Schema.String, credit: Schema.String }),
    unpriced: Unpriced,
  }),
  // The CLI refuses an `--as-of` that is no date itself (execute.ts:13 → reports/internal.ts:16).
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.books.reports.trial-balance", {
    CLI_USAGE: [error_CLI_USAGE, "?"],
    // s26.4 (s26:335): Dana asks for the trial balance before Acme has a chart and is refused WRONG_STATE
    // `no_chart`. S26 restores after-s1, which has no chart, and only turns the books gate on first (s26.3).
    WRONG_STATE: [error_WRONG_STATE, "after-s1"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org books reports profit-and-loss ───────────────────────────────────────────────────────

export const operation_org_books_reports_profit_and_loss = defineOperation({
  ...frozenText("org.books.reports.profit-and-loss"),
  was: [
    book("org.books.reports.profit-and-loss"),
    `${CLI}/subcommands/reports/subcommands/profit-and-loss/command.ts:15`,
    `${CLI}/subcommands/reports/subcommands/profit-and-loss/execute.ts:13`,
    `${CLI}/subcommands/reports/subcommands/profit-and-loss/execute.ts:17`,
    `${CLI}/subcommands/reports/internal.ts:16`,
    `${SDK}/reports.ts:80`,
    `${SDK}/reports.ts:59`,
    `${ROWS}/operations.ts:218`,
    `${ROWS}/report-schema.ts:81`,
    ...SCOPE_WAS,
    `${S26}:128`,
    `${S26}:416`,
  ],
  priority: "normal",
  implementedBy: rpc_books_reports_profit_and_loss,
  acceptance: frozenClaims("org.books.reports.profit-and-loss"),
  // ProfitAndLossSchema (report-schema.ts:81); the CLI prints it as is.
  returns: Schema.Struct({
    rules: Rules,
    from: Schema.Number,
    to: Schema.Number,
    sections: Schema.Array(StatementSection),
    grossProfit: Schema.String,
    netIncome: Schema.String,
    unpriced: Unpriced,
  }),
  // The CLI refuses a `--from` or `--to` that is no date itself (execute.ts:13, :14).
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.books.reports.profit-and-loss", {
    CLI_USAGE: [error_CLI_USAGE, "?"],
    // s26.9 (s26:416): Dana types October back to front; the SDK refuses `to` before `from` with INVALID_INPUT
    // before any call (reports.ts:59), so any Seat of Acme reaches it from after-s1.
    INVALID_INPUT: [error_INVALID_INPUT, "after-s1"],
    WRONG_STATE: [error_WRONG_STATE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org books reports balance-sheet ─────────────────────────────────────────────────────────

export const operation_org_books_reports_balance_sheet = defineOperation({
  ...frozenText("org.books.reports.balance-sheet"),
  was: [
    book("org.books.reports.balance-sheet"),
    `${CLI}/subcommands/reports/subcommands/balance-sheet/command.ts:8`,
    `${CLI}/subcommands/reports/subcommands/balance-sheet/execute.ts:13`,
    `${CLI}/subcommands/reports/subcommands/balance-sheet/execute.ts:16`,
    `${CLI}/subcommands/reports/internal.ts:16`,
    `${SDK}/reports.ts:78`,
    `${ROWS}/operations.ts:225`,
    `${ROWS}/report-schema.ts:95`,
    ...SCOPE_WAS,
    `${S26}:128`,
    `${S26}:446`,
  ],
  priority: "normal",
  implementedBy: rpc_books_reports_balance_sheet,
  acceptance: frozenClaims("org.books.reports.balance-sheet"),
  // BalanceSheetSchema (report-schema.ts:95); the CLI prints it as is.
  returns: Schema.Struct({
    rules: Rules,
    asOf: Schema.Number,
    sections: Schema.Array(StatementSection),
    currentEarnings: Schema.String,
    liabilitiesAndEquity: Schema.String,
    unpriced: Unpriced,
  }),
  // The CLI refuses an `--as-of` that is no date itself (execute.ts:13 → reports/internal.ts:16).
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.books.reports.balance-sheet", {
    // s26.11 (s26:446): Dana asks for the balance sheet as of "end of October"; the CLI refuses it with CLI_USAGE on
    // `as-of` before any call, from after-s1.
    CLI_USAGE: [error_CLI_USAGE, "after-s1"],
    WRONG_STATE: [error_WRONG_STATE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org books reports reconcile ─────────────────────────────────────────────────────────────

export const operation_org_books_reports_reconcile = defineOperation({
  ...frozenText("org.books.reports.reconcile"),
  was: [
    book("org.books.reports.reconcile"),
    `${CLI}/subcommands/reports/subcommands/reconcile/command.ts:7`,
    `${CLI}/subcommands/reports/subcommands/reconcile/execute.ts:10`,
    `${SDK}/reports.ts:79`,
    `${ROWS}/operations.ts:236`,
    `${ROWS}/report-schema.ts:126`,
    ...SCOPE_WAS,
    `${S26}:128`,
    `${S26}:350`,
  ],
  priority: "normal",
  implementedBy: rpc_books_reports_reconcile,
  acceptance: frozenClaims("org.books.reports.reconcile"),
  // ReconcileSchema (report-schema.ts:126) with SafeCheckSchema (:116); the CLI prints it as is.
  returns: Schema.Struct({
    asOf: Schema.Number,
    assets: Schema.Array(
      Schema.Struct({
        asset: Schema.String,
        books: Schema.String,
        safe: Schema.String,
        inAgreements: Schema.String,
        difference: Schema.String,
        matches: Schema.Boolean,
      }),
    ),
    matches: Schema.Boolean,
  }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.books.reports.reconcile", {
    // s26.5 (s26:350): the check against the Safe before Acme has a chart is refused WRONG_STATE `no_chart`, from
    // after-s1 once the books gate is on (s26.3).
    WRONG_STATE: [error_WRONG_STATE, "after-s1"],
    PROVIDER_ERROR: [error_PROVIDER_ERROR, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org books export quickbooks ─────────────────────────────────────────────────────────────

// The SDK method turns the window into epoch ms and forwards one row (exports.ts:29); the CLI then writes the two
// CSV files itself, never over a file already there (quickbooks/execute.ts:24, :78).
export const operation_org_books_export_quickbooks = defineOperation({
  ...frozenText("org.books.export.quickbooks"),
  was: [
    book("org.books.export.quickbooks"),
    `${CLI}/subcommands/export/subcommands/quickbooks/command.ts:18`,
    `${CLI}/subcommands/export/subcommands/quickbooks/execute.ts:70`,
    `${CLI}/subcommands/export/subcommands/quickbooks/execute.ts:73`,
    `${CLI}/subcommands/export/subcommands/quickbooks/execute.ts:76`,
    `${CLI}/subcommands/export/subcommands/quickbooks/execute.ts:78`,
    `${CLI}/subcommands/export/subcommands/quickbooks/execute.ts:17`,
    `${CLI}/subcommands/export/subcommands/quickbooks/execute.ts:87`,
    `${SDK}/exports.ts:29`,
    `${ROWS}/operations.ts:249`,
    `${ROWS}/export-schema.ts:21`,
    ...SCOPE_WAS,
    `${S26}:477`,
    `${S26}:497`,
  ],
  priority: "normal",
  implementedBy: rpc_books_exports_quickbooks,
  acceptance: frozenClaims("org.books.export.quickbooks"),
  // QuickbooksExportSchema (export-schema.ts:21). As is, the CLI prints `from`, `to`, `entries`, `unpriced` and
  // `files` (the two paths it wrote), not `accounts` and `journal` (quickbooks/execute.ts:87).
  returns: Schema.Struct({
    from: Schema.Number,
    to: Schema.Number,
    accounts: Schema.String,
    journal: Schema.String,
    entries: Schema.Int,
    unpriced: Unpriced,
  }),
  // The CLI refuses a `--from` or `--to` that is no date and an empty `--out` (CLI_USAGE, execute.ts:70-73), and a
  // file it cannot write or that exists (CLI_STORAGE, :17, :55).
  errors: [...SCOPE_ERRORS, error_CLI_STORAGE],
  refusals: refusalsOf("org.books.export.quickbooks", {
    // s26.14 (s26:497) exports into the folder s26.13 wrote (s26:477) and is refused CLI_STORAGE. It needs Acme's
    // chart (s26.6) to reach the write, and no saved world holds a chart: S12 and S26 save none.
    CLI_STORAGE: [error_CLI_STORAGE, "?"],
    WRONG_STATE: [error_WRONG_STATE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});
