// The as-is book of the old requests concept: the offers area (an owner's fixed-price Offers, which
// the product calls services, and their immutable revisions).
//
// Every operation registered at `requests/offers:*` (packages/backend/convex/requests/offers.ts). Five
// are public rows of `offers` (packages/protocol/src/requests/operations.ts:131); `emitChanged` is the
// internal action a committed write schedules to post `service_changed`. Nothing here is cron-driven,
// so every one is an rpc. The write operations schedule `service_changed` in their own transaction.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_requests } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
  event_service_changed,
} from "../shared/vocabulary.ts";
import { machine_fixed_offer, table_fixed_offer_revisions, table_fixed_offers } from "./data.ts";
import { procedure_access_actor_from_session, procedure_access_read_scope_safe_address_in_tx } from "../access/procedures.ts";
import { procedure_accounts_require_payment_account_in_tx } from "../accounts/procedures.ts";
import { procedure_organizations_require_issue_invoices_in_tx } from "../organizations/procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/requests/offers.ts`;
const R = `${BACKEND}/src/requests`;
const OFFERS = `${R}/offers`;
const OPS = `${OFFERS}/operations`;
const ROWS = "packages/protocol/src/requests/operations.ts";

const S = Schema.String;
const opt = Schema.optionalKey;

// ── shapes ─────────────────────────────────────────────────────────────────────────────────

/** `RequestActorSchema` (request-schema.ts:16): the signed-in Account (absent) or an Organization they belong to. */
const Actor = opt(Schema.Union([Schema.Struct({ kind: Schema.Literal("account") }), Schema.Struct({ kind: Schema.Literal("org"), orgId: S })]));

/** `FixedOfferDraftSchema` (offer-schema.ts:118). */
const OfferDraft = Schema.Struct({
  title: S,
  description: opt(S),
  unitLabel: S,
  unitAmount: Schema.Struct({ asset: S, value: S }),
  quantity: Schema.Struct({ min: Schema.Number, max: Schema.Number }),
});

/** `FixedOfferSchema` (offer-schema.ts:128): an Offer at its current revision. */
const FixedOffer = Schema.Struct({
  offerId: S,
  revision: Schema.Number,
  active: Schema.Boolean,
  terms: OfferDraft,
  recipientSafe: S,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

/** `pageOf(FixedOfferSchema)`: one page holding every Offer (`onePage`). */
const OfferPage = Schema.Struct({ items: Schema.Array(FixedOffer), nextCursor: Schema.NullOr(S) });

// ── errors ─────────────────────────────────────────────────────────────────────────────────

/** `CALL`, `DEFECTS` and `MEMBER` (operation-errors.ts:5, :11; operation.ts:54); ADMIN is the same code. */
const ROW_ERRORS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING, error_ROLE_PERMISSION_DENIED];

// ── shared touches ─────────────────────────────────────────────────────────────────────────

/** `requireReader` (guards.ts:19): the session's scope; an Organization needs current participation. */
const READER = { invokes: [procedure_access_actor_from_session], was: [`${R}/guards.ts:19`] };

/** `requireWriter` (guards.ts:44): the reader, then for an Organization a Seat holding issue invoices (CAP-945). */
const WRITER = {
  invokes: [procedure_access_actor_from_session, procedure_organizations_require_issue_invoices_in_tx],
  was: [`${R}/guards.ts:33`, `${R}/guards.ts:44`],
};

/** `offerView` (reads/offers.ts:67): the Offer row and its current revision's frozen terms. */
const VIEW_READS = [table_fixed_offers, table_fixed_offer_revisions];

/** `freezeRevision` (offers/writes.ts:31): the owner's Safe (an Account's through its payment Account), the exact unit amount. */
const FREEZE = {
  invokes: [procedure_accounts_require_payment_account_in_tx, procedure_access_read_scope_safe_address_in_tx],
  was: [`${OFFERS}/writes.ts:31`, `${OFFERS}/writes.ts:48`, `${R}/reads/instructions.ts:57`, `${R}/rules/lifecycle.ts:103`],
};

/** `serviceChanged` (offers/events.ts:53): schedules `requests.offers.emit-changed` in the write's transaction. */
const SCHEDULE_CHANGED_WAS = [`${OFFERS}/events.ts:53`, `${OFFERS}/events.ts:68`];

// ── public rows ────────────────────────────────────────────────────────────────────────────

export const rpc_requests_offers_create = defineRpc({
  id: "requests.offers.create",
  title: "Create a fixed-price Offer, or replay its request key",
  about:
    "Row `requests.offers.create`, registered as `requests/offers:create`. The request key must be 1 to 128 characters " +
    "with no control or format characters (INVALID_INPUT `requestKey`). The owner's earlier Offer with the same key replays " +
    "when its canonical draft is the same (no change, no event) and is INVALID_INPUT `request key already has different " +
    "service terms` otherwise. A new Offer `offer_<ulid>` is inserted active at revision 1 with its first revision row: the " +
    "owner's Safe (none is INVALID_INPUT `service recipient is not ready`) and the normalized unit amount (Payments' amount " +
    "rule refuses an unknown asset or bad value as INVALID_INPUT). A new Offer schedules `service_changed` (`created`).",
  was: [
    `${CONVEX}:3`,
    `${OPS}/create.ts:10`,
    `${OPS}/create.ts:15`,
    `${ROWS}:133`,
    `${OFFERS}/writes.ts:76`,
    `${OFFERS}/writes.ts:100`,
    `${OFFERS}/writes.ts:127`,
    `${R}/errors/offers.ts:7`, `${R}/errors/offers.ts:10`, `${R}/errors/offers.ts:17`,
    ...WRITER.was,
    ...FREEZE.was,
    ...SCHEDULE_CHANGED_WAS,
  ],
  concept: concept_requests,
  kind: "mutation",
  who: "A signed-in person for their own Account, or for an Organization they hold a Seat with issue invoices in.",
  input: Schema.Struct({ actor: Actor, requestKey: S, terms: OfferDraft }),
  output: FixedOffer,
  errors: ROW_ERRORS,
  reads: VIEW_READS,
  writes: [table_fixed_offers, table_fixed_offer_revisions],
  drives: [],
  invokes: [...WRITER.invokes, ...FREEZE.invokes],
  emits: [event_service_changed],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_offers_get = defineRpc({
  id: "requests.offers.get",
  title: "Read one of this scope's Offers",
  about:
    "Row `requests.offers.get`, registered as `requests/offers:get`. The Offer at its current revision; another owner's Offer " +
    "or a missing one is INVALID_INPUT `service is unavailable`. A current revision row that is missing or whose terms do not " +
    "decode is UNKNOWN.",
  was: [`${CONVEX}:6`, `${OPS}/get.ts:9`, `${ROWS}:140`, `${OFFERS}/reads.ts:12`, `${R}/reads/offers.ts:24`, `${R}/reads/offers.ts:67`, ...READER.was],
  concept: concept_requests,
  kind: "query",
  who: "A signed-in person for their own Account, or for an Organization they currently take part in.",
  input: Schema.Struct({ actor: Actor, offerId: S }),
  output: FixedOffer,
  errors: ROW_ERRORS,
  reads: VIEW_READS,
  writes: [],
  drives: [],
  invokes: READER.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_offers_list = defineRpc({
  id: "requests.offers.list",
  title: "List this scope's Offers",
  about:
    "Row `requests.offers.list`, registered as `requests/offers:list`. Every Offer the scope owns, active or not, read whole " +
    "by index and returned as one page with no cursor (`onePage`).",
  was: [`${CONVEX}:7`, `${OPS}/list.ts:10`, `${ROWS}:147`, `${OFFERS}/reads.ts:21`, `${R}/reads/offers.ts:32`, ...READER.was],
  concept: concept_requests,
  kind: "query",
  who: "A signed-in person for their own Account, or for an Organization they currently take part in.",
  input: Schema.Struct({ actor: Actor }),
  output: OfferPage,
  errors: ROW_ERRORS,
  reads: VIEW_READS,
  writes: [],
  drives: [],
  invokes: READER.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_offers_revise = defineRpc({
  id: "requests.offers.revise",
  title: "Freeze new terms as the next revision of an active Offer",
  about:
    "Row `requests.offers.revise`, registered as `requests/offers:revise`. The owner's Offer (INVALID_INPUT `service is " +
    "unavailable`) still at `expectedRevision` (INVALID_INPUT `service revision changed`) and active (INVALID_INPUT `service is " +
    "inactive`): freezes a new revision row with the owner's current Safe and amount, bumps `revision`, and always schedules " +
    "`service_changed` (`revised`).",
  was: [
    `${CONVEX}:8`,
    `${OPS}/revise.ts:10`,
    `${OPS}/revise.ts:15`,
    `${ROWS}:154`,
    `${OFFERS}/writes.ts:118`,
    `${OFFERS}/writes.ts:134`,
    `${OFFERS}/writes.ts:146`,
    ...WRITER.was,
    ...FREEZE.was,
    ...SCHEDULE_CHANGED_WAS,
  ],
  concept: concept_requests,
  kind: "mutation",
  who: "A signed-in person for their own Account, or for an Organization they hold a Seat with issue invoices in.",
  input: Schema.Struct({ actor: Actor, offerId: S, expectedRevision: Schema.Number, terms: OfferDraft }),
  output: FixedOffer,
  errors: ROW_ERRORS,
  reads: VIEW_READS,
  writes: [table_fixed_offers, table_fixed_offer_revisions],
  drives: [],
  invokes: [...WRITER.invokes, ...FREEZE.invokes],
  emits: [event_service_changed],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_offers_deactivate = defineRpc({
  id: "requests.offers.deactivate",
  title: "Stop selling an Offer",
  about:
    "Row `requests.offers.deactivate`, registered as `requests/offers:deactivate`. The owner's Offer at `expectedRevision` " +
    "(INVALID_INPUT otherwise) is marked inactive and schedules `service_changed` (`deactivated`); one already inactive is " +
    "returned as it is, schedules nothing and writes nothing.",
  was: [
    `${CONVEX}:4`,
    `${OPS}/deactivate.ts:10`,
    `${OPS}/deactivate.ts:15`,
    `${ROWS}:166`,
    `${OFFERS}/writes.ts:152`,
    `${OFFERS}/writes.ts:160`,
    `${OFFERS}/writes.ts:165`,
    ...WRITER.was,
    ...SCHEDULE_CHANGED_WAS,
  ],
  concept: concept_requests,
  kind: "mutation",
  who: "A signed-in person for their own Account, or for an Organization they hold a Seat with issue invoices in.",
  input: Schema.Struct({ actor: Actor, offerId: S, expectedRevision: Schema.Number }),
  output: FixedOffer,
  errors: ROW_ERRORS,
  reads: VIEW_READS,
  writes: [table_fixed_offers],
  drives: [machine_fixed_offer.t.to_false],
  invokes: WRITER.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal ───────────────────────────────────────────────────────────────────────────────

export const rpc_requests_offers_emit_changed = defineRpc({
  id: "requests.offers.emit-changed",
  title: "Post service_changed after an Offer write commits",
  about:
    "Telemetry plumbing: registered as the internal action `requests/offers:emitChanged`. A committed create, revision or " +
    "deactivation that changed the Offer schedules it through `scheduleTelemetryEmit` with the committed snapshot. It marks " +
    "the person signed in and, when the write verified it, the Organization, then posts `service_changed` (change, offer id, " +
    "revision, issuer scope, time; never the price, title, description or unit label) to PostHog, awaited, continuing the " +
    "caller's trace. It reads and writes no table. The PostHog post has no integration record in this book.",
  was: [
    `${CONVEX}:5`,
    `${OPS}/emit-changed.ts:12`,
    `${OPS}/emit-changed.ts:29`,
    `${OFFERS}/events.ts:72`,
    `${OFFERS}/events.ts:104`,
    `${BACKEND}/src/platform/observation/telemetry.ts:52`, `${BACKEND}/src/platform/observation/telemetry.ts:95`,
  ],
  concept: concept_requests,
  kind: "action",
  who: "internal: scheduled by `serviceChanged` (offers/events.ts:53) from the create, revise or deactivate mutation it reports.",
  input: Schema.Struct({
    authUserId: S,
    offerId: S,
    change: Schema.Literals(["created", "revised", "deactivated"]),
    revision: Schema.Number,
    issuerScopeKind: Schema.Literals(["account", "organization"]),
    issuerScopeId: S,
    occurredAt: Schema.Number,
    organizationId: opt(S),
    observationContext: opt(Schema.Unknown),
  }),
  output: Schema.Void,
  errors: [error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_service_changed],
  calls: [],
  chain: [],
  spans: [],
});
