// The target records of the 17 frozen operations books owns (OPERATION_OWNERS): the 16 of the old
// books area and `activity annotate` (an annotation is a book fact). Text is the frozen book's,
// spread from frozenText, never retyped. Acceptance lines are claims (P1): kept word for word, with
// the old test citation in `was`, except the lines that name the old telemetry ("posts
// `books_account_added`", "schedules nothing", "delivered once"), which become claims about what is
// reported, observed in the local collector (books.acceptance-rewrites).
//
// Each operation is implemented by one rpc, except `org books accounts review`, which is one Core
// SDK flow (books.review-flow). `errors` holds what the CLI produces itself: CLI_USAGE (the
// Organization scope and its own argument checks), for the export CLI_STORAGE, and for `activity
// annotate`'s terminal preview CANCELLED (vocabulary.declined-preview-cancelled).
//
// Worlds (books.worlds): org-without-chart, org-with-chart, org-with-chart-and-added-token,
// org-with-chart-and-node-down, signed-out.
//
// The chart of accounts is ERPNext's on each Organization's site (books.chart-owner): "the chart"
// in a claim below is the site's Account tree, and a world "with chart" is one whose site is set up.
// Only the observations that named the old chart event change (books.acceptance-rewrites).

import { Schema } from "effect";
import { budget, defineOperation, type Ref } from "../../packages/blueprint-engine/src/index.ts";
import { frozen, frozenRefusals, frozenText, type FrozenId } from "../baseline/index.ts";
import {
  error_CANCELLED,
  error_CLI_STORAGE,
  error_CLI_USAGE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import * as examples from "./examples.ts";
import { Annotation, rpc_books_annotations_save } from "./annotations.ts";
import { BookAsset, rpc_books_assets_add, rpc_books_assets_list, rpc_books_assets_remove } from "./assets.ts";
import { BookFact, rpc_books_facts_list } from "./facts.ts";
import { Reference } from "./data.ts";

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
  errors: [error_CLI_USAGE, error_CANCELLED],
  examples: examples.annotate,
  refusals: refusalsOf("activity.annotate", {
    CLI_USAGE: [error_CLI_USAGE, CHART],
    INVALID_INPUT: [error_INVALID_INPUT, CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
    NOT_AUTHENTICATED: [error_NOT_AUTHENTICATED, SIGNED_OUT],
  }),
  budget: budget("write"),
});

// ── org books accounts import ───────────────────────────────────────────────────────────────

// ── org books accounts list ─────────────────────────────────────────────────────────────────

// ── org books accounts add ──────────────────────────────────────────────────────────────────

// ── org books accounts rename ───────────────────────────────────────────────────────────────

// ── org books accounts archive ──────────────────────────────────────────────────────────────

// ── org books accounts review ───────────────────────────────────────────────────────────────

// ── org books accounts reclassify ───────────────────────────────────────────────────────────

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
  examples: examples.assetsList,
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
  examples: examples.assetsAdd,
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
  examples: examples.assetsRemove,
  refusals: refusalsOf("org.books.assets.remove", {
    WRONG_STATE: [error_WRONG_STATE, CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, ADDED],
  }),
  budget: budget("write"),
});

// ── org books export quickbooks ─────────────────────────────────────────────────────────────

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
  examples: examples.factsList,
  refusals: refusalsOf("org.books.facts.list", {
    CLI_USAGE: [error_CLI_USAGE, NO_CHART],
    INVALID_INPUT: [error_INVALID_INPUT, CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("read"),
});

// ── org books reports ───────────────────────────────────────────────────────────────────────

