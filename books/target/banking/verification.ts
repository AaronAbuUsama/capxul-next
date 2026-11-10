// Banking's verification area: Bridge's KYC for a person and KYB for an Organization, which bank
// transfers need. Bridge sets the questions and makes the decision; Capxul starts or continues the
// one Bridge customer of an owner, forwards answers and documents, and follows Bridge's answer.
// The verification's durable process is in ./processes.ts; the flows are in ./flows.ts.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_banking } from "../shared/foundation.ts";
import { integration_bridge } from "../shared/external.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
} from "../shared/vocabulary.ts";
import {
  CurrencyStatus,
  machine_verification,
  machine_verification_person,
  table_verification_people,
  table_verifications,
} from "./data.ts";
import { table_parties } from "../parties/data.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { table_files } from "../media/data.ts";

const P = "packages/backend/src/parties/verifications";
const S = Schema.String;

/** What `verify start` and `verify status` return: the next step or the decision, never an answer. */
export const VerificationView = Schema.Struct({
  status: Schema.Literals(["not_started", "needs_answers", "needs_person", "in_review", "approved", "rejected", "restricted"]),
  journeyId: Schema.NullOr(S),
  subject: Schema.NullOr(Schema.Literals(["person", "business"])),
  nextStep: Schema.NullOr(
    Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("answers"),
        questions: Schema.Array(
          Schema.Struct({
            id: S,
            label: S,
            input: Schema.Literals(["text", "secret", "choice", "date", "file"]),
            choices: Schema.NullOr(Schema.Array(Schema.Struct({ value: S, label: S }))),
            correction: Schema.NullOr(S),
          }),
        ),
      }),
      Schema.Struct({ kind: Schema.Literal("person"), url: S, purpose: Schema.Literals(["terms", "liveness", "documents"]) }),
    ]),
  ),
  completed: Schema.Array(S),
  currencies: Schema.Struct({ usd: CurrencyStatus, eur: CurrencyStatus, gbp: CurrencyStatus }),
  people: Schema.Array(Schema.Struct({ invitationId: S, name: S, status: Schema.Literals(["invited", "submitted"]) })),
});

const DOCUMENT_FIELDS = [
  "id_front",
  "id_back",
  "proof_of_address",
  "business_formation",
  "ownership_information",
  "proof_of_nature_of_business",
  "evidence_of_good_standing",
  "flow_of_funds",
  "proof_of_signatory_authority",
] as const;

const NamedPerson = Schema.Struct({
  first_name: S,
  last_name: S,
  email: S,
  owner_percent: Schema.NullOr(Schema.Number),
  controller: Schema.Boolean,
  signer: Schema.Boolean,
  director: Schema.Boolean,
  title: Schema.NullOr(S),
});

const bridgeFailures = [error_PROVIDER_ERROR, error_RATE_LIMITED, error_PROVIDER_RESPONSE_INVALID] as const;

export const rpc_banking_verification_status = defineRpc({
  id: "banking.verification.status",
  title: "Read a verification's current step from Bridge",
  about:
    "The owner's verification, read back from Bridge so a change made on Bridge's own page shows: the correction asked, " +
    "the steps completed, liveness, and each currency's decision. Before any start there is no verification: it answers " +
    "`not_started` and asks Bridge nothing. It writes nothing and makes no customer; Bridge's later changes reach the " +
    "stored verification through the inbox, not through this read. `--wait` is the flow's, which calls this at most once " +
    "a minute.",
  concept: concept_banking,
  kind: "action",
  who: "A signed-in person, for themselves, or for the Organization they act as (any current member).",
  input: Schema.Struct({ org_id: Schema.NullOr(S) }),
  output: VerificationView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, ...bridgeFailures],
  reads: [table_verifications, table_verification_people, table_org_members],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_bridge.c.getVerification],
  chain: [],
  spans: ["rpc.banking.verification.status"],
  budget: budget("vendor"),
  was: [`${P}/operations/status.ts:1`, `${P}/views.ts:49`],
});

export const rpc_banking_verification_start = defineRpc({
  id: "banking.verification.start",
  title: "Start or continue a verification with Bridge",
  about:
    "Submits answers, documents and, for a business, the people it names, to the owner's one Bridge customer, and returns " +
    "Bridge's next step. The customer's Idempotency-Key is derived from the owner, so the first start makes exactly one " +
    "customer and every later start continues it. Answers Bridge already accepted are never sent again (a later tax " +
    "question carries only itself). Documents are files the SDK uploaded to media, admitted there as identity documents " +
    "(JPG or PNG up to 15 MB for an ID image, JPG, PNG or PDF up to 24 MB otherwise); this rpc reads each at the caller's " +
    "own key and admits it only if `id_front` and `id_back` are `id-image` files and every other field an `id-image` or " +
    "`document` file, each still `held` (one of another purpose, another person's, or expired is INVALID_INPUT naming the " +
    "field), then sends them on and keeps no copy. Refused before Bridge: an Organization and an invitation together (INVALID_INPUT), a caller " +
    "who is not a Director of the Organization (ROLE_PERMISSION_DENIED), an invitation whose email is not the caller's " +
    "(ROLE_PERMISSION_DENIED). Bridge's own refusal of an answer (a date of birth under 18) is INVALID_INPUT with the " +
    "field, never Bridge's reason. Then one transaction births the verification (`begin`) on a first start, applies " +
    "Bridge's answer as the next transition, births each newly named person (`invite`, for notices to email), or marks " +
    "the invited caller's own entry submitted. It is a signal of the verification's process.",
  concept: concept_banking,
  kind: "action",
  who:
    "A signed-in person, for themselves; for the Organization they act as, a Director of it (the Director hat), who alone " +
    "can name the business's people; or a person a business verification invited (`inv_kyb_`), for their own details.",
  input: Schema.Struct({
    org_id: Schema.NullOr(S),
    invitation_id: Schema.NullOr(S),
    answers: Schema.Record(S, Schema.Unknown),
    documents: Schema.Array(Schema.Struct({ field: Schema.Literals(DOCUMENT_FIELDS), file_id: S })),
    people: Schema.Array(NamedPerson),
    business_contact_email: Schema.NullOr(S),
  }),
  output: VerificationView,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, ...bridgeFailures],
  reads: [
    table_verifications,
    table_verification_people,
    table_parties,
    table_org_members,
    table_org_deployments,
    table_hat_wearers,
    table_files,
  ],
  writes: [table_verifications, table_verification_people],
  drives: [
    machine_verification.t.begin,
    machine_verification.t.ask,
    machine_verification.t.hand_to_person,
    machine_verification.t.submit,
    machine_verification.t.approve,
    machine_verification.t.reject,
    machine_verification_person.t.invite,
    machine_verification_person.t.submit,
  ],
  invokes: [],
  emits: [],
  calls: [integration_bridge.c.submitVerification],
  chain: [],
  spans: ["rpc.banking.verification.start"],
  budget: budget("vendor"),
  was: [
    `${P}/operations/start.ts:1`,
    `${P}/operations/answer.ts:1`,
    `${P}/operations/send.ts:1`,
    `${P}/operations/invite.ts:1`,
    `${P}/operations/person.ts:1`,
  ],
});
