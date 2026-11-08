// The old book's Activity area, as it is: one operation record for every operation that
// apps/docs/factory/areas/activity.yaml lists, in /home/user/factory (branch integration/factory).
// The text (title, about, who, changes, notes, mistakes, acceptance, refusals' `when`) is the
// book's, built from the frozen text (books/frozen), never retyped.
//
// implementedBy is what the CLI command (apps/cli/src/commands/activity/subcommands/<name>/)
// reaches through the SDK method it calls (packages/sdk/src/activity/methods.ts): that method's
// flow (../activity/flows.ts) when it composes several calls, else the one rpc it reaches
// (../activity/items.ts and ../activity/annotations.ts own packages/backend/src/activity/items/
// and annotations/). client.activity.list, .get and .summary read the Ponder indexer and the
// activity.overlays.get rpc when the client has an indexer origin (methods.ts:33), else forward
// one rpc: they compose, so they are flows. client.activity.changes and .annotate forward one
// rpc each, .annotate after refusing retired fields and a mismatched actor itself (INVALID_INPUT).
//
// returns is a Struct of the page's `returns` fields; a field's type is the protocol row's
// (packages/protocol/src/activity/schema.ts) where the row gives it, otherwise Schema.Unknown
// (CLI-made fields). activity get prints a Payment detail or a Movement detail: returns is the
// Union of one Struct per shape, each with the page's fields that shape carries.
//
// errors lists what the CLI command produces itself: CLI_USAGE for every command (the parser,
// apps/cli/src/runtime/errors.ts:256, and each command's own inputRequired refusals),
// NOT_AUTHENTICATED from the session restore (apps/cli/src/auth/first-party.ts:173, :177), and
// each command's own CliFailure codes.
//
// A refusal's `given` names the devnet world (packages/scenarios) from which one runs-today
// scenario step's command reaches it, `?` where none does. S20, a root story (parent null), runs
// from the world a run starts from, which the scenarios README names `before-s1`
// (packages/scenarios/README.md:36). No budget: nothing measured these commands. Priority is
// "normal" throughout: the old book ranks no operation.

import { Schema } from "effect";
import { defineOperation } from "../../../packages/book/src/index.ts";
import { frozenClaims, frozenRefusals, frozenReturns, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CLI_DEFECT,
  error_CLI_USAGE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
} from "../shared/vocabulary.ts";
import { flow_client_activity_get, flow_client_activity_list, flow_client_activity_summary } from "../activity/flows.ts";
import { rpc_activity_items_changes } from "../activity/items.ts";
import { rpc_activity_annotations_save } from "../activity/annotations.ts";

const BOOK = "apps/docs/factory/operations";
const CLI = "apps/cli/src";
const CMD = `${CLI}/commands/activity`;
const SDK = "packages/sdk/src/activity";
const PROTOCOL = "packages/protocol/src/activity";
const S20 = "packages/scenarios/src/acme/s20-dana-follows-her-own-money.scenario.ts";

/** The world a root story's steps run from (packages/scenarios/README.md:36). */
const BEFORE_S1 = "before-s1";

const PARSER = `${CLI}/runtime/errors.ts:256`;
const NO_SESSION = [`${CLI}/auth/first-party.ts:173`, `${CLI}/auth/first-party.ts:177`];

// ── helpers: the frozen page's refusals and returns ─────────────────────────────────────────

const ERRORS = {
  CLI_USAGE: error_CLI_USAGE,
  INVALID_INPUT: error_INVALID_INPUT,
  NOT_AUTHENTICATED: error_NOT_AUTHENTICATED,
  ROLE_PERMISSION_DENIED: error_ROLE_PERMISSION_DENIED,
} as const;
type Code = keyof typeof ERRORS;

/** The page's refusals in its order, `when` verbatim, each on its error record and the world that reaches it. */
const refusals = (id: FrozenId, given: Partial<Record<Code, string>> = {}) =>
  frozenRefusals(id).map(({ code, when }) => {
    if (!(code in ERRORS)) throw new Error(`${id}: no error record for refusal ${code}`);
    return { error: ERRORS[code as Code], given: given[code as Code] ?? "?", when };
  });

/** The page's `returns` fields, Schema.Unknown unless `types` refines one; `only` keeps one --json shape's fields. */
const fieldsOf = (id: FrozenId, types: Record<string, Schema.Top> = {}, only?: readonly string[]) => {
  const page = frozenReturns(id).fields as Record<string, Schema.Top>;
  for (const name of [...Object.keys(types), ...(only ?? [])])
    if (!(name in page)) throw new Error(`${id}: the page returns no field ${name}`);
  const kept = only === undefined ? page : Object.fromEntries(only.map((name) => [name, Schema.Unknown]));
  return { ...kept, ...types };
};

// ── the activity wire shapes, as the rows return them ───────────────────────────────────────
// Transcribed from packages/protocol/src/activity/schema.ts with the payment vocabularies
// (payments/status.ts:23, :62, :92, :97). Branded strings and Finite numbers are plain here.

const Direction = Schema.Literals(["in", "out", "self"]);
const Amount = Schema.Struct({ asset: Schema.String, value: Schema.String });
const Receipt = Schema.Struct({ chainId: Schema.Number, transactionHash: Schema.String });

/** ActivityItemSchema (schema.ts:55): one row of a page, a Payment or a Movement. */
const ActivityItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("payment"),
    execution: Schema.optionalKey(
      Schema.Struct({
        status: Schema.Literals([
          "pending",
          "included",
          "dropped",
          "replaced",
          "expired",
          "unresolved",
          "superseded",
          "failed",
          "settled",
        ]),
        retryRequired: Schema.Boolean,
        notSent: Schema.optionalKey(Schema.Literal(true)),
      }),
    ),
    id: Schema.String,
    ledgerKind: Schema.Literals(["Payment", "Payout", "Deposit"]),
    status: Schema.Literals([
      "pending",
      "settling",
      "in_transit",
      "unresolved",
      "scheduled",
      "streaming",
      "pending_claim",
      "settled",
      "cancelled",
      "failed",
    ]),
    paymentType: Schema.Literals(["unspecified", "invoice", "payroll", "reimbursement"]),
    amount: Amount,
    direction: Direction,
    counterpartyLabel: Schema.String,
    receipt: Schema.NullOr(Receipt),
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal("movement"),
    id: Schema.String,
    classification: Schema.Literals(["deposit", "refund", "movement_only_outflow"]),
    amount: Amount,
    direction: Direction,
    counterpartyLabel: Schema.String,
    receipt: Receipt,
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
  }),
]);

/** ActorRefSchema (access/actor-schema.ts:16). */
const ActorRef = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("account"), accountId: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("organization"), orgId: Schema.String }),
]);

/** ActivityAnnotationSchema (schema.ts:126), its account a BookAccountRefSchema (books/schema.ts:48). */
const Annotation = Schema.Struct({
  reference: Schema.Struct({ kind: Schema.Literals(["payment", "movement"]), id: Schema.String }),
  actor: ActorRef,
  account: Schema.optionalKey(Schema.Struct({ accountId: Schema.String, code: Schema.String, name: Schema.String })),
  suggestion: Schema.optionalKey(Schema.String),
  memo: Schema.optionalKey(Schema.String),
  lastEditor: ActorRef,
  updatedAt: Schema.Number,
});

const Included = { inclusion: Schema.Literal("included"), verification: Schema.Literal("verified") };

/** PaymentEvidenceSchema (schema.ts:146). */
const PaymentEvidence = Schema.Struct({
  chainId: Schema.Literal(84532),
  contractAddress: Schema.String,
  tokenAddress: Schema.String,
  transactionHash: Schema.String,
  blockNumber: Schema.Number,
  blockHash: Schema.String,
  ...Included,
  finality: Schema.Literal("finalized"),
  paymentEventLogIndex: Schema.NullOr(Schema.Number),
  transferLogIndex: Schema.Number,
  settlementId: Schema.NullOr(Schema.String),
  source: Schema.String,
  destination: Schema.String,
  rawAmount: Schema.String,
  link: Schema.Struct({
    paymentId: Schema.String,
    movementId: Schema.NullOr(Schema.String),
    transactionHash: Schema.String,
  }),
});

/** MovementEvidenceSchema (schema.ts:169). */
const MovementEvidence = Schema.Struct({
  chainId: Schema.Number,
  contractAddress: Schema.String,
  tokenAddress: Schema.String,
  transactionHash: Schema.String,
  blockNumber: Schema.Number,
  blockHash: Schema.String,
  ...Included,
  canonicalState: Schema.Literal("finalized"),
  transferLogIndex: Schema.Number,
  source: Schema.String,
  destination: Schema.String,
  rawAmount: Schema.String,
  link: Schema.Struct({ movementId: Schema.String, depositPaymentId: Schema.NullOr(Schema.String) }),
});

// ── activity list ───────────────────────────────────────────────────────────────────────────

// The CLI checks --org, --limit, the cursor text, --direction, each --status and the range before any session
// (CLI_USAGE, internal/parse.ts:66, :82), then calls client.activity.list. With an indexer origin the SDK reads the
// actor's scope with activity.overlays.get and the indexer's rows, and stitches the page (items.ts:125); without one
// it forwards activity.items.list. The SDK adds `readWarning` when Movements are missing (records.ts:97). A next cursor
// equal to the one asked for is the CLI's own CLI_DEFECT (runtime/paging.ts:53, :62). As is, a --limit outside 1 to
// 100 is CLI_USAGE from the CLI before the INVALID_INPUT the page names can be reached.
export const operation_activity_list = defineOperation({
  ...frozenText("activity.list"),
  was: [
    `${BOOK}/activity.list.yaml:1`,
    `${CMD}/subcommands/list/command.ts:6`,
    `${CMD}/subcommands/list/execute.ts:12`,
    `${CMD}/subcommands/list/execute.ts:13`,
    `${CMD}/subcommands/list/execute.ts:16`,
    `${CMD}/subcommands/list/execute.ts:18`,
    `${CMD}/internal/parse.ts:66`,
    `${CMD}/internal/parse.ts:82`,
    `${CLI}/runtime/paging.ts:53`,
    `${SDK}/methods.ts:65`,
    `${SDK}/methods.ts:71`,
    `${SDK}/items.ts:125`,
    `${SDK}/records.ts:97`,
    `${PROTOCOL}/operations.ts:43`,
    `${PROTOCOL}/schema.ts:95`,
    ...NO_SESSION,
    PARSER,
  ],
  priority: "normal",
  implementedBy: flow_client_activity_list,
  acceptance: frozenClaims("activity.list"),
  returns: Schema.Struct(
    fieldsOf("activity.list", {
      items: Schema.Array(ActivityItem),
      nextCursor: Schema.NullOr(Schema.String),
      checkpoint: Schema.Number,
      observedAt: Schema.Number,
      readWarning: Schema.optionalKey(Schema.Literal("indexer-unavailable")),
    }),
  ),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED, error_CLI_DEFECT],
  refusals: refusals("activity.list"),
});

// ── activity get ────────────────────────────────────────────────────────────────────────────

// The CLI checks --org, --kind and --id (CLI_USAGE), then calls client.activity.get. A Movement whose id is
// `<chainId>:<txHash>:<logIndex>` is read from the indexer with the actor's overlay (movement-detail.ts:15) when the
// client has an indexer origin; anything else forwards activity.items.get (methods.ts:152). A null answer, and an
// answer for another kind or id, are CLI_USAGE from the CLI (get/execute.ts:23, :28).
// s20.10: Sam reads Dana's Payment, in which he took no part: CLI_USAGE (root story S20).
export const operation_activity_get = defineOperation({
  ...frozenText("activity.get"),
  was: [
    `${BOOK}/activity.get.yaml:1`,
    `${CMD}/subcommands/get/command.ts:6`,
    `${CMD}/subcommands/get/execute.ts:13`,
    `${CMD}/subcommands/get/execute.ts:20`,
    `${CMD}/subcommands/get/execute.ts:23`,
    `${CMD}/subcommands/get/execute.ts:28`,
    `${CMD}/subcommands/get/execute.ts:30`,
    `${CMD}/internal/parse.ts:69`,
    `${CMD}/internal/parse.ts:74`,
    `${SDK}/methods.ts:119`,
    `${SDK}/methods.ts:152`,
    `${SDK}/movement-detail.ts:15`,
    `${PROTOCOL}/operations.ts:85`,
    `${PROTOCOL}/schema.ts:192`,
    `${PROTOCOL}/schema.ts:200`,
    ...NO_SESSION,
    PARSER,
    `${S20}:454`,
  ],
  priority: "normal",
  implementedBy: flow_client_activity_get,
  acceptance: frozenClaims("activity.get"),
  // `payment` is the wire Payment (payments/payment-schema.ts:158), transcribed in ../payments/operations.ts and not
  // exported from there: Schema.Unknown here.
  returns: Schema.Union([
    Schema.Struct(
      fieldsOf(
        "activity.get",
        { kind: Schema.Literal("payment"), annotation: Schema.NullOr(Annotation), evidence: Schema.NullOr(PaymentEvidence) },
        ["kind", "payment", "annotation", "evidence"],
      ),
    ),
    Schema.Struct(
      fieldsOf(
        "activity.get",
        {
          kind: Schema.Literal("movement"),
          movementId: Schema.String,
          annotation: Schema.NullOr(Annotation),
          evidence: MovementEvidence,
        },
        ["kind", "movementId", "annotation", "evidence"],
      ),
    ),
  ]),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("activity.get", { CLI_USAGE: BEFORE_S1 }),
});

// ── activity summary ────────────────────────────────────────────────────────────────────────

// The CLI checks --org and the range (CLI_USAGE, internal/parse.ts:118), then calls client.activity.summary. With an
// indexer origin the SDK totals the indexer's rows under the actor's overlay (items.ts:179); without one it forwards
// activity.items.summary. The CLI prints the ActivitySummary.
export const operation_activity_summary = defineOperation({
  ...frozenText("activity.summary"),
  was: [
    `${BOOK}/activity.summary.yaml:1`,
    `${CMD}/subcommands/summary/command.ts:6`,
    `${CMD}/subcommands/summary/execute.ts:12`,
    `${CMD}/subcommands/summary/execute.ts:15`,
    `${CMD}/subcommands/summary/execute.ts:23`,
    `${CMD}/internal/parse.ts:118`,
    `${SDK}/methods.ts:104`,
    `${SDK}/methods.ts:110`,
    `${SDK}/items.ts:179`,
    `${PROTOCOL}/operations.ts:75`,
    `${PROTOCOL}/schema.ts:111`,
    ...NO_SESSION,
    PARSER,
  ],
  priority: "normal",
  implementedBy: flow_client_activity_summary,
  acceptance: frozenClaims("activity.summary"),
  returns: Schema.Struct(
    fieldsOf("activity.summary", {
      window: Schema.Struct({ from: Schema.NullOr(Schema.Number), to: Schema.NullOr(Schema.Number) }),
      totals: Schema.Array(
        Schema.Struct({
          asset: Schema.String,
          in: Schema.String,
          out: Schema.String,
          net: Schema.String,
          pendingIn: Schema.String,
        }),
      ),
      count: Schema.Number,
      observedAt: Schema.Number,
    }),
  ),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("activity.summary"),
});

// ── activity events ─────────────────────────────────────────────────────────────────────────

// The CLI refuses an --after that is not its own cursor text with CLI_USAGE before any session (events/execute.ts:68,
// :71). It then reads every page of client.activity.changes (Payments by when they last changed) and of
// client.activity.list filtered to Movements, up to 50 pages each, keeps rows past the cursor's replay window that the
// cursor has not answered, and with --wait reads again every 5 s. The book's method is client.activity.changes, which
// forwards one rpc, activity.items.changes (methods.ts:86); the Movement read is the list flow above. `events`,
// `cursor`, `next` and `truncated` are the CLI's own; each event carries its row as the row returns it.
// s20.7: Dana passes `yesterday` as the cursor: CLI_USAGE (root story S20).
export const operation_activity_events = defineOperation({
  ...frozenText("activity.events"),
  was: [
    `${BOOK}/activity.events.yaml:1`,
    `${CMD}/subcommands/events/command.ts:6`,
    `${CMD}/subcommands/events/execute.ts:49`,
    `${CMD}/subcommands/events/execute.ts:68`,
    `${CMD}/subcommands/events/execute.ts:71`,
    `${CMD}/subcommands/events/execute.ts:137`,
    `${CMD}/subcommands/events/execute.ts:141`,
    `${CMD}/subcommands/events/execute.ts:222`,
    `${SDK}/methods.ts:86`,
    `${SDK}/methods.ts:91`,
    `${PROTOCOL}/operations.ts:62`,
    ...NO_SESSION,
    PARSER,
    `${S20}:403`,
  ],
  priority: "normal",
  implementedBy: rpc_activity_items_changes,
  acceptance: frozenClaims("activity.events"),
  returns: Schema.Struct(
    fieldsOf("activity.events", {
      events: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          kind: Schema.Literals(["payment", "movement"]),
          change: Schema.Unknown,
          at: Schema.Unknown,
          item: ActivityItem,
          next: Schema.Unknown,
        }),
      ),
      truncated: Schema.optionalKey(Schema.Unknown),
    }),
  ),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("activity.events", { CLI_USAGE: BEFORE_S1 }),
});

// ── activity annotate ───────────────────────────────────────────────────────────────────────

// Off a terminal the CLI refuses a missing --confirm, both --input and --kind/--id, JSON with accountingCategory or
// extra fields, and a bad --id, all CLI_USAGE before any session (annotate/execute.ts:20, :23; internal/parse.ts:46,
// :203; org/internal/write.ts:40). client.activity.annotate refuses retired fields and a reference actor that is not
// the annotation's (INVALID_INPUT, methods.ts:187, :204) and forwards one rpc, activity.annotations.save. An answer for
// another row is CLI_USAGE from the CLI (:42). It prints { annotation }.
// s20.11: Sam annotates Dana's Payment, in which he took no part: INVALID_INPUT (root story S20).
export const operation_activity_annotate = defineOperation({
  ...frozenText("activity.annotate"),
  was: [
    `${BOOK}/activity.annotate.yaml:1`,
    `${CMD}/subcommands/annotate/command.ts:6`,
    `${CMD}/subcommands/annotate/execute.ts:20`,
    `${CMD}/subcommands/annotate/execute.ts:23`,
    `${CMD}/subcommands/annotate/execute.ts:26`,
    `${CMD}/subcommands/annotate/execute.ts:36`,
    `${CMD}/subcommands/annotate/execute.ts:42`,
    `${CMD}/subcommands/annotate/execute.ts:44`,
    `${CMD}/internal/parse.ts:46`,
    `${CMD}/internal/parse.ts:203`,
    `${CLI}/commands/org/internal/write.ts:40`,
    `${SDK}/methods.ts:183`,
    `${SDK}/methods.ts:187`,
    `${SDK}/methods.ts:204`,
    `${SDK}/methods.ts:221`,
    `${PROTOCOL}/operations.ts:102`,
    `${PROTOCOL}/schema.ts:126`,
    ...NO_SESSION,
    PARSER,
    `${S20}:471`,
  ],
  priority: "normal",
  implementedBy: rpc_activity_annotations_save,
  acceptance: frozenClaims("activity.annotate"),
  returns: Schema.Struct(fieldsOf("activity.annotate", { annotation: Annotation })),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("activity.annotate", { INVALID_INPUT: BEFORE_S1 }),
});
