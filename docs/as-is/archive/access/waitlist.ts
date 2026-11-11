// The as-is book of the old access concept: the waitlist area, the permissioned beta (CAP-1019):
// who Capxul has admitted, and who is waiting.
//
// Registered at `access/waitlist:*` (packages/backend/convex/access/waitlist.ts): two public rows of
// `waitlist` (packages/protocol/src/access/operations.ts:122), the guard's hold an action runs, the
// operator's list and admit (run with the deployment's deploy key), the form's write, and two email
// deliveries other writes schedule (workflows). `convex/http.ts` routes the public request form and
// its CORS preflight to two httpActions by path. The guard itself is the door's requireBetaAccess
// family (procedures.ts): creating an Organization, claiming a Safe and the faucet need an admission
// or an open `beta-access` gate.
//
// Every email goes through the mail owner's `sendMail`, which enqueues through the Resend component
// in the caller's transaction and returns a failure as a value (PROVIDER_ERROR); on a devnet the
// message lands in Operator's mail sink instead.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_access } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_RATE_LIMITED,
  error_UNKNOWN,
  event_referral_transitioned,
  event_waitlist_entry_transitioned,
} from "../shared/vocabulary.ts";
import { integration_mail } from "../shared/external.ts";
import {
  machine_referral,
  machine_waitlist_entry,
  table_beta_waitlist,
  table_beta_waitlist_windows,
  table_feature_flags,
  table_feature_gates,
  table_feature_syncs,
  table_referral_codes,
  table_referrals,
} from "./data.ts";
import { procedure_access_authenticated_user } from "./procedures.ts";
import { rpc_access_referrals_invite } from "./referrals.ts";
import { rpc_profiles_onboardings_complete } from "../profiles/onboardings.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/access/waitlist.ts`;
const W = `${BACKEND}/src/access/waitlist`;
const OPS = `${W}/operations`;
const R = `${BACKEND}/src/access/referrals`;
const ROWS = "packages/protocol/src/access/operations.ts";

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;

const SEND_MAIL = integration_mail.c.sendMail;

/** `CALL` and `DEFECTS` (operations.ts:11, packages/protocol/src/operation.ts:54). */
const CALL_DEFECTS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING];
const DEFECT = [error_UNKNOWN];

/** Where a person stands: their row by normalized email, then the `beta-access` gate for the person (waitlist/reads.ts:37). */
const STANDING_READS = [table_beta_waitlist, table_feature_gates, table_feature_flags, table_feature_syncs];
const STANDING_WAS = [`${W}/reads.ts:16`, `${W}/reads.ts:37`, `${W}/rules.ts:11`, `${W}/rules.ts:24`, `${BACKEND}/src/access/features/reads.ts:114`];
/** What status shows of referrals: who brought the person (masked) and their invites (referrals/reads.ts:49). */
const REFERRAL_STANDING_READS = [table_referrals, table_referral_codes];

/** `recordRequestInTx` (waitlist/writes.ts:32): a birth schedules joined, with whether a live referral brought the email. */
const RECORD_WAS = [`${W}/writes.ts:32`, `${W}/writes.ts:43`, `${W}/writes.ts:44`, `${W}/writes.ts:48`, `${W}/writes.ts:57`, `${W}/writes.ts:17`, `${R}/events.ts:20`];
/** `admitInTx` (waitlist/writes.ts:71): put on the list if absent, admit once, mark the referral admitted. */
const ADMIT = {
  reads: [table_beta_waitlist, table_referrals, table_referral_codes],
  writes: [table_beta_waitlist, table_referrals],
  drives: [machine_waitlist_entry.t.to_admitted, machine_referral.t.to_admitted],
  emits: [event_waitlist_entry_transitioned, event_referral_transitioned],
  was: [`${W}/writes.ts:71`, `${W}/writes.ts:80`, `${W}/writes.ts:81`, `${W}/writes.ts:83`, `${W}/writes.ts:90`, `${R}/writes.ts:124`, ...RECORD_WAS],
};

const WaitlistStatus = Schema.Struct({
  email: S,
  access: Schema.Literals(["admitted", "open", "waiting"]),
  requestedAt: Schema.NullOr(N),
  admittedAt: Schema.NullOr(N),
  note: Schema.NullOr(S),
  referredBy: opt(Schema.NullOr(S)),
  invitesLeft: opt(N),
});

// ── public rows ─────────────────────────────────────────────────────────────────────────────

export const rpc_access_waitlist_status = defineRpc({
  id: "access.waitlist.status",
  title: "Where the signed-in person stands on the beta waitlist",
  about:
    "Row `access.waitlist.status`, registered as `access/waitlist:status`. Signed in; the email normalized (or the session's " +
    "own when it is not one the list keeps). Admitted when the row has `admittedAt`, else open when `beta-access` is on for " +
    "the person, else waiting. Answers the row's times and note (null when there is none), who referred them (first letter " +
    "and domain, null for a voided referral) and their invites left (0 without a code row).",
  was: [`${CONVEX}:9`, `${OPS}/status.ts:15`, `${OPS}/status.ts:20`, `${OPS}/status.ts:23`, `${W}/views.ts:6`, `${R}/reads.ts:49`, `${ROWS}:124`, `${ROWS}:102`, ...STANDING_WAS],
  concept: concept_access,
  kind: "query",
  who: "A signed-in person.",
  input: Schema.Struct({}),
  output: WaitlistStatus,
  errors: CALL_DEFECTS,
  reads: [...STANDING_READS, ...REFERRAL_STANDING_READS],
  writes: [],
  drives: [],
  invokes: [procedure_access_authenticated_user],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_waitlist_join = defineRpc({
  id: "access.waitlist.join",
  title: "Join the beta waitlist, or change what you will build",
  about:
    "Row `access.waitlist.join`, registered as `access/waitlist:join` (`capxul waitlist join --note --ref`). Signed in. A note " +
    "over 500 characters is INVALID_INPUT (note). With `ref`: a code no one holds, or the person's own mailbox's, is " +
    "INVALID_INPUT (ref); a person not admitted is then tied to the code's owner by link unless a referral brought them " +
    "already (referral_transitioned attributed). Then the request is recorded with `joinedVia` `sign-in`, the value a held " +
    "sign-in also writes: a new row schedules waitlist_entry_transitioned joined; an existing row keeps its time and only " +
    "changes a given, different note; an admission stays. Answers the status.",
  was: [
    `${CONVEX}:8`,
    `${OPS}/join.ts:23`,
    `${OPS}/join.ts:26`,
    `${OPS}/join.ts:32`,
    `${OPS}/join.ts:36`,
    `${OPS}/join.ts:43`,
    `${OPS}/join.ts:48`,
    `${W}/rules.ts:17`,
    `${W}/errors.ts:29`,
    `${R}/reads.ts:65`,
    `${R}/writes.ts:182`,
    `${R}/writes.ts:96`,
    `${ROWS}:131`,
    ...RECORD_WAS,
    ...STANDING_WAS,
  ],
  concept: concept_access,
  kind: "mutation",
  who: "A signed-in person.",
  input: Schema.Struct({ note: opt(S), ref: opt(S) }),
  output: WaitlistStatus,
  errors: CALL_DEFECTS,
  reads: [...STANDING_READS, ...REFERRAL_STANDING_READS],
  writes: [table_beta_waitlist, table_referrals],
  drives: [],
  invokes: [procedure_access_authenticated_user],
  emits: [event_waitlist_entry_transitioned, event_referral_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal ────────────────────────────────────────────────────────────────────────────────

export const rpc_access_waitlist_hold = defineRpc({
  id: "access.waitlist.hold",
  title: "The waitlist guard's read for an action",
  about:
    "Internal mutation `access/waitlist:hold`, run by requireBetaAccessFromAction in the action's own call. Reads where the " +
    "person stands; a waiting person with no row is recorded as a `sign-in` request (joined), so the operator's list shows " +
    "everyone who signed in and was held. Answers `{access, reason}` (the gate's off reason); the caller refuses.",
  was: [`${CONVEX}:16`, `${OPS}/hold.ts:18`, `${OPS}/hold.ts:24`, `${OPS}/hold.ts:25`, `${W}/guards.ts:24`, ...RECORD_WAS, ...STANDING_WAS],
  concept: concept_access,
  kind: "mutation",
  who: "internal: requireBetaAccessFromAction (Accounts' claim and faucet mint).",
  input: Schema.Struct({ authUserId: S, email: S }),
  output: Schema.Struct({ access: Schema.Literals(["admitted", "open", "waiting"]), reason: Schema.NullOr(Schema.Literals(["gate", "environment", "stale"])) }),
  errors: DEFECT,
  reads: [...STANDING_READS, table_referrals],
  writes: [table_beta_waitlist],
  drives: [],
  invokes: [],
  emits: [event_waitlist_entry_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_waitlist_list = defineRpc({
  id: "access.waitlist.list",
  title: "The operator's waitlist",
  about:
    "Internal query `access/waitlist:list` (`waitlist list`). `waiting` (the default): rows with no admission, oldest " +
    "request first, by index. `admitted` and `all` read the whole table and sort by request time. Each row: email, note, how " +
    "it joined, its times, who admitted it and when the welcome went.",
  was: [`${CONVEX}:17`, `${OPS}/list.ts:15`, `${OPS}/list.ts:22`, `${W}/reads.ts:48`, `${W}/views.ts:23`],
  concept: concept_access,
  kind: "query",
  who: "internal: an operator with the deployment's deploy key.",
  input: Schema.Struct({ which: opt(Schema.Literals(["waiting", "admitted", "all"])) }),
  output: Schema.Array(
    Schema.Struct({
      email: S,
      note: Schema.NullOr(S),
      joinedVia: Schema.Literals(["form", "sign-in", "invitation", "operator", "referral"]),
      requestedAt: N,
      admittedAt: Schema.NullOr(N),
      admittedBy: Schema.NullOr(S),
      welcomeSentAt: Schema.NullOr(N),
    }),
  ),
  errors: DEFECT,
  reads: [table_beta_waitlist],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_waitlist_admit = defineRpc({
  id: "access.waitlist.admit",
  title: "The operator admits a wave of emails",
  about:
    "Internal mutation `access/waitlist:admit` (`waitlist admit`), one transaction. More than 200 emails is INVALID_INPUT " +
    "(emails). Each email that is one is admitted `operator:<by>` (put on the list first when absent) and its welcome email " +
    "enqueued in the same transaction; a sent welcome stamps `welcomeSentAt`, a failed one is a handled failure on the wide " +
    "event and reported in `welcomeFailed`. An email admitted already gets no second welcome unless an operator's or a " +
    "referral's admission still owes one (`welcomeResent`). Answers admitted, already, invalid, welcomeFailed, welcomeResent. " +
    "The welcome's links come from CAPXUL_DOCS_QUICKSTART_URL, CAPXUL_TELEGRAM_URL and CAPXUL_SUPPORT_EMAIL.",
  was: [
    `${CONVEX}:13`,
    `${OPS}/admit.ts:23`,
    `${OPS}/admit.ts:27`,
    `${OPS}/admit.ts:44`,
    `${OPS}/admit.ts:49`,
    `${OPS}/admit.ts:51`,
    `${OPS}/admit.ts:53`,
    `${OPS}/admit.ts:57`,
    `${W}/rules.ts:38`,
    `${W}/rules.ts:74`,
    `${W}/errors.ts:41`,
    `${W}/external.ts:18`,
    `${W}/external.ts:27`,
    `${W}/writes.ts:95`,
    ...ADMIT.was,
  ],
  concept: concept_access,
  kind: "mutation",
  who: "internal: an operator with the deployment's deploy key.",
  input: Schema.Struct({ emails: Schema.Array(S), by: S }),
  output: Schema.Struct({
    admitted: Schema.Array(S),
    already: Schema.Array(S),
    invalid: Schema.Array(S),
    welcomeFailed: Schema.Array(S),
    welcomeResent: Schema.Array(S),
  }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: ADMIT.reads,
  writes: ADMIT.writes,
  drives: ADMIT.drives,
  invokes: [],
  emits: ADMIT.emits,
  calls: [SEND_MAIL],
  chain: [],
  spans: [],
});

export const rpc_access_waitlist_record = defineRpc({
  id: "access.waitlist.record",
  title: "Record one request from the request-access form",
  about:
    "Internal mutation `access/waitlist:record`, run by POST /waitlist/request. Claims the IP's window first: the sixth " +
    "request in an hour is RATE_LIMITED (resource waitlist.request) and changes nothing; a claimed window counts even a " +
    "request then refused. Then an address that is not an email, or a note over 500 characters, is INVALID_INPUT. Records the " +
    "request `form`: a new row schedules joined; the form never changes a note already on the list. Answers the normalized " +
    "email.",
  was: [`${CONVEX}:18`, `${OPS}/record.ts:19`, `${OPS}/record.ts:25`, `${OPS}/record.ts:26`, `${OPS}/record.ts:27`, `${OPS}/record.ts:29`, `${OPS}/record.ts:31`, `${W}/writes.ts:100`, `${W}/rules.ts:51`, `${W}/rules.ts:60`, `${W}/errors.ts:26`, `${W}/errors.ts:33`, ...RECORD_WAS],
  concept: concept_access,
  kind: "mutation",
  who: "internal: the public request form's HTTP handler.",
  input: Schema.Struct({ email: S, note: opt(S), ip: S }),
  output: Schema.Struct({ email: S }),
  errors: [error_RATE_LIMITED, error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_beta_waitlist_windows, table_beta_waitlist, table_referrals],
  writes: [table_beta_waitlist_windows, table_beta_waitlist],
  drives: [],
  invokes: [],
  emits: [event_waitlist_entry_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

// ── HTTP: the public request form ───────────────────────────────────────────────────────────

export const rpc_access_waitlist_request = defineRpc({
  id: "access.waitlist.request",
  title: "The public request-access form (POST /waitlist/request)",
  about:
    "httpAction routed by path (convex/http.ts:161), not through the door, so the HTTP entry does not load the mail provider. " +
    "No sign-in: anyone can ask for any email, from the docs site or capxul.com. The body must be a JSON object with a string " +
    "email and an optional string note (else INVALID_INPUT body); the refusal's wording names an optional ref, but the " +
    "handler never reads one. The client IP is the first x-forwarded-for entry (`unknown` without one). Runs access.waitlist.record, " +
    "admitting its INVALID_INPUT and RATE_LIMITED; answers `{email}` with CORS for the request's origin, or the whole failure. " +
    "It runs under the action boundary as the system job beta_waitlist_request and schedules its wide event.",
  was: [
    `${OPS}/request.ts:49`,
    `${OPS}/request.ts:25`,
    `${OPS}/request.ts:26`,
    `${OPS}/request.ts:29`,
    `${OPS}/request.ts:35`,
    `${OPS}/request.ts:59`,
    `${OPS}/request.ts:65`,
    `${OPS}/request.ts:81`,
    `${OPS}/request.ts:83`,
    `${W}/errors.ts:37`,
    `${BACKEND}/convex/http.ts:149`,
    `${BACKEND}/convex/http.ts:161`,
    `${BACKEND}/src/access/referrals/writes.ts:178`,
  ],
  concept: concept_access,
  kind: "action",
  who: "Anyone: a public, unauthenticated form, paced per IP.",
  input: Schema.Struct({ email: S, note: opt(S) }),
  output: Schema.Struct({ email: S }),
  errors: [error_INVALID_INPUT, error_RATE_LIMITED, error_UNKNOWN],
  reads: [table_beta_waitlist_windows, table_beta_waitlist, table_referrals],
  writes: [table_beta_waitlist_windows, table_beta_waitlist],
  drives: [],
  invokes: [],
  emits: [event_waitlist_entry_transitioned],
  calls: [],
  chain: [],
  spans: ["convex.mutation"],
});

export const rpc_access_waitlist_request_preflight = defineRpc({
  id: "access.waitlist.request-preflight",
  title: "The request form's CORS preflight (OPTIONS /waitlist/request)",
  about: "httpAction answering the browser's preflight with Applications' shared preflight view; wrapped in observedRoute as a cors_preflight row.",
  was: [`${OPS}/request-preflight.ts:5`, `${BACKEND}/convex/http.ts:151`, `${BACKEND}/convex/http.ts:155`],
  concept: concept_access,
  kind: "action",
  who: "Anyone: a browser before it posts the form.",
  input: Schema.Struct({}),
  output: Schema.Struct({}),
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── scheduled deliveries ────────────────────────────────────────────────────────────────────

export const workflow_access_waitlist_deliver_on_the_list = defineWorkflow({
  id: "access.waitlist.deliver-on-the-list",
  title: "Email a held person that they are on the list",
  about:
    "Internal mutation `access/waitlist:deliverOnTheList`, scheduled at once by holdAtOnboarding when a person's first " +
    "completed onboarding finds the beta still holding them; it runs after the onboarding commits, so a provider refusal never " +
    "undoes it. It enqueues the `beta-waitlist` email with the display name to the session's email as given; a failure is a " +
    "handled failure on the wide event. It reads no table and is not retried. Timeout is Convex's mutation limit; the " +
    "code sets none.",
  was: [`${CONVEX}:14`, `${OPS}/deliver-on-the-list.ts:17`, `${OPS}/deliver-on-the-list.ts:26`, `${OPS}/deliver-on-the-list.ts:27`, `${W}/external.ts:36`, `${W}/guards.ts:112`, `${BACKEND}/src/profiles/onboardings/operations/complete.ts:46`],
  concept: concept_access,
  priority: "low",
  trigger: { after: rpc_profiles_onboardings_complete },
  steps: [{ name: "send", about: "Enqueues the beta-waitlist email through the mail owner; a failed enqueue is recorded and dropped." }],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [SEND_MAIL],
  chain: [],
  idempotency: "None: each scheduling sends one email; only the first completed onboarding schedules it.",
  timeoutMs: 1000,
  retries: { max: 0, backoff: "none" },
});

export const workflow_access_waitlist_deliver_welcome = defineWorkflow({
  id: "access.waitlist.deliver-welcome",
  title: "Email an admitted person their welcome",
  about:
    "Internal mutation `access/waitlist:deliverWelcome`, scheduled at once by scheduleWelcomeInTx after a referral " +
    "admission: the friend an invite admits (access.referrals.invite) and a waiting referrer that access.referrals.qualify " +
    "admits. Nothing happens when the email has no row or its welcome already went. Otherwise it enqueues the `beta-welcome` " +
    "email; sent stamps `welcomeSentAt`, a failure is a handled failure, and an operator's `waitlist admit` rerun sends it " +
    "again. Timeout is Convex's mutation limit; the code sets none.",
  was: [`${CONVEX}:15`, `${OPS}/deliver-welcome.ts:21`, `${OPS}/deliver-welcome.ts:30`, `${OPS}/deliver-welcome.ts:31`, `${OPS}/deliver-welcome.ts:32`, `${OPS}/deliver-welcome.ts:34`, `${W}/writes.ts:121`, `${W}/external.ts:27`, `${W}/writes.ts:95`],
  concept: concept_access,
  priority: "low",
  trigger: { after: rpc_access_referrals_invite },
  steps: [
    { name: "load", about: "Reads the email's waitlist row; none, or a welcome already sent, ends the run." },
    { name: "send", about: "Enqueues the beta-welcome email; sent stamps welcomeSentAt, a failure is recorded." },
  ],
  reads: [table_beta_waitlist],
  writes: [table_beta_waitlist],
  drives: [],
  invokes: [],
  emits: [],
  calls: [SEND_MAIL],
  chain: [],
  idempotency: "`welcomeSentAt`: a run for a row whose welcome went does nothing.",
  timeoutMs: 1000,
  retries: { max: 0, backoff: "none" },
});
