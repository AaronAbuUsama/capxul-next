// The invitations area: an Organization offers a Seat to one person or agent, with grants or
// without; the invitee accepts or declines; the Organization lists, resends or cancels. The
// invitation's one durable process (its grants' execution, its seven-day expiry, its chain
// cleanup) is in processes.ts, and these rpcs are its signals.
//
// What is not here: the grants. Budgets' `org member invite` flow (operations.member-invite-in-budgets)
// calls this area's invite rpc and then proposes the grants it offers to the Board, binding the
// company Safe transaction that carries them (procedures.ts); budgets also proposes taking granted
// hats back when an offer ends with them on chain. `invite accept` is banking's flow, which sends every id but a business verification's to
// this area's accept rpc. The email is notices', from org_invite_transitioned. The old area's
// preview, get, retry, sweep, five emit rpcs and the daily expiry cron are gone: preview is the
// flow's read before it writes, a retry has nothing to retry once grants are hats, and the expiry
// is each invitation's own timer.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_SEAT_LIMIT_REACHED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  machine_org_invite,
  machine_org_member,
  Offer,
  table_org_deployments,
  table_org_invitations,
  table_org_members,
  table_organizations,
} from "./data.ts";
import { table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import { table_personal_safes } from "../accounts/data.ts";
import { procedure_accounts_admit } from "../accounts/procedures.ts";
import { table_hat_wearers, table_safe_executions } from "../indexing/data.ts";

const O = "packages/backend/src/organizations";
const I = `${O}/invitations`;
const AS_IS = "docs/as-is/archive/organizations/invitations.ts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

export const Phase = Schema.Literals(["authorizing", "pending", "active", "revoking", "declined", "cancelled", "expired"]);

/** One invitation as every invitation command prints it. */
export const InvitationView = Schema.Struct({
  id: S,
  orgId: S,
  organizationName: S,
  grantee: Schema.Struct({
    partyId: S,
    kind: Schema.Literals(["human", "agent"]),
    handle: NullOr(S),
    accountId: NullOr(S),
    /** Whether the grantee's personal Safe is claimed (accounts), so it can act with what the offer grants; null for an agent. */
    accountReady: NullOr(Schema.Boolean),
  }),
  phase: Phase,
  offers: Schema.Array(Offer),
  offerDigest: S,
  /** Who waits on what: `board_proposal` while authorizing, `cleanup_pending` while revoking, else null. */
  recovery: NullOr(Schema.Literals(["board_proposal", "cleanup_pending"])),
  recoveryActions: Schema.Struct({ resendAvailableAt: NullOr(N) }),
  expiresAt: NullOr(N),
  endingReason: NullOr(Schema.Literals(["declined", "cancelled", "expired"])),
  acceptedAt: NullOr(N),
  memberId: NullOr(S),
  /** `none` for an offer to an `@handle`; otherwise `not_confirmed`: the email and its delivery record are notices'. */
  delivery: Schema.Literals(["sent", "failed", "not_confirmed", "none"]),
});

const Page = Schema.Struct({ items: Schema.Array(InvitationView), nextCursor: NullOr(S), observedAt: N });
const PageInput = {
  limit: Schema.optionalKey(N),
  phases: Schema.optionalKey(Schema.Array(Phase)),
  after: Schema.optionalKey(S),
};
const OneInvitation = Schema.Struct({ orgId: S, invitationId: S });

/** The wearer of the People hat: read from indexing for the Seat's Safe and the deployment's people hat. */
const PEOPLE_HAT = [table_org_members, table_org_deployments, table_hat_wearers];

export const rpc_organizations_invitations_invite = defineRpc({
  id: "organizations.invitations.invite",
  title: "Offer a Seat, with or without grants, or return the offer this request key made",
  about:
    "The first step of budgets' `org member invite` flow, one transaction. The inviter's Seat must wear the People hat " +
    "(else ROLE_PERMISSION_DENIED; whether they are a Director is the Board proposal's to check). A request key that " +
    "already made an offer here returns it unchanged; under another request it is INVALID_INPUT. The grantee is resolved " +
    "with `parties.resolve-recipient`: an email names a person's Party, named provisional at its email-derived Safe when " +
    "nobody has it yet; an `@handle` must name an agent's Party; an Account must be a person principal with a mailbox; " +
    "anything else, an Organization, an outside address, or another Organization's own agent (its FDE serves only its " +
    "Organization: organizations.fde-seat) is INVALID_INPUT. At most 16 offers, none twice, and none the grantee already " +
    "has live here (else INVALID_INPUT). Then the Seat it offers is counted, under the Organization row's lock so two " +
    "offers cannot both take the last one (organizations.seat-limit): a grantee who already holds an active Seat here " +
    "takes nothing (`seat_use` null: an offer of grants to a member is never refused for seats); a person takes a seat; " +
    "an agent whose owner (its Party's) holds a Seat here that no other agent's Seat or live offer names as its cover " +
    "rides on that Seat; the Organization's own agent rides on the Organization while no other agent it owns holds or " +
    "is offered a Seat; any other agent takes a seat. Taking a seat " +
    "when the Seats that count and the live offers that reserve one already reach `seat_limit` is SEAT_LIMIT_REACHED, " +
    "nothing written. A person invitee is admitted to the beta in the same transaction (`accounts.admit`, `via` " +
    "invitation, `ref` the Organization's id; it sends nothing: the invitation's own email is the only one). A Seat-only offer is born pending with its seven-day expiry " +
    "(`send`); one with grants is born authorizing (`send_with_grants`) and waits for budgets to bind the Board " +
    "proposal that carries them.",
  was: [`${AS_IS}:241`, `${I}/operations/invite.ts:14`, `${I}/writes/offers.ts:136`, `${I}/reads/grantees.ts:72`],
  concept: concept_organizations,
  kind: "mutation",
  who: "A member whose Safe wears the Organization's People hat.",
  input: Schema.Struct({
    orgId: S,
    to: Schema.Union([
      Schema.Struct({ type: Schema.Literal("email"), email: S }),
      Schema.Struct({ type: Schema.Literal("handle"), handle: S }),
      Schema.Struct({ type: Schema.Literal("account"), accountId: S }),
    ]),
    agent: Schema.Boolean,
    offers: Schema.Array(Offer),
    requestKey: S,
  }),
  output: InvitationView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_SEAT_LIMIT_REACHED],
  reads: [...PEOPLE_HAT, table_organizations, table_org_invitations, table_parties, table_principals, table_personal_safes],
  writes: [table_org_invitations],
  drives: [machine_org_invite.t.send, machine_org_invite.t.send_with_grants],
  invokes: [procedure_parties_resolve_recipient, procedure_accounts_admit],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_organizations_invitations_accept = defineRpc({
  id: "organizations.invitations.accept",
  title: "The invitee accepts the offer at the digest they reviewed, and takes their Seat",
  about:
    "The invitation process's signal, reached from banking's `invite accept` flow for every id that is not a business " +
    "verification's. One transaction. A digest that is not 32 bytes of hex is INVALID_INPUT before anything is read. The " +
    "caller's Party must be the grantee, else ROLE_PERMISSION_DENIED, the same answer as for an invitation that does not " +
    "exist. Accepted already: the same digest returns it unchanged, another is WRONG_STATE. Otherwise the offer must be " +
    "pending, not past its expiry, at the live digest (else WRONG_STATE); it becomes active and the Seat is born at once " +
    "with the use its offer reserved, so acceptance never overfills the Organization (or kept, when the Party already " +
    "holds one here). Its grants were minted to the grantee's Safe before it opened, so " +
    "nothing waits after consent. Consent grants no authority of its own: the hats do.",
  was: [`${AS_IS}:280`, `${I}/operations/accept.ts:12`, `${I}/writes/consent.ts:40`],
  concept: concept_organizations,
  kind: "mutation",
  who: "The person or agent the invitation was sent to.",
  input: Schema.Struct({ orgId: S, invitationId: S, offerDigest: S }),
  output: InvitationView,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  reads: [table_org_invitations, table_org_members, table_organizations, table_parties, table_principals],
  writes: [table_org_invitations, table_org_members],
  drives: [machine_org_invite.t.accept, machine_org_member.t.seat],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_organizations_invitations_decline = defineRpc({
  id: "organizations.invitations.decline",
  title: "The invitee declines an offer",
  about:
    "The invitation process's signal, one transaction. The caller's Party must be the grantee, else " +
    "ROLE_PERMISSION_DENIED with nothing written. Declined already: returned as it is, writing nothing. Accepted, ended " +
    "otherwise, or still authorizing: WRONG_STATE. A pending offer with nothing on chain is declined at once (`decline`); " +
    "one whose hats were minted begins cleanup (`begin_cleanup`, reason declined): budgets proposes taking the hats back, " +
    "and the process declines it when the chain shows them gone. Only a write reports org_invite_transitioned.",
  was: [`${AS_IS}:312`, `${I}/operations/decline.ts:14`, `${I}/writes/endings.ts:72`],
  concept: concept_organizations,
  kind: "mutation",
  who: "The person or agent the invitation was sent to.",
  input: OneInvitation,
  output: InvitationView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  reads: [table_org_invitations, table_organizations, table_parties],
  writes: [table_org_invitations],
  drives: [machine_org_invite.t.decline, machine_org_invite.t.begin_cleanup],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_organizations_invitations_cancel = defineRpc({
  id: "organizations.invitations.cancel",
  title: "The Organization cancels an offer that was not accepted",
  about:
    "The invitation process's signal, one transaction. The caller's Seat must wear the People hat, and the invitation " +
    "must be this Organization's, else ROLE_PERMISSION_DENIED. Cancelled already: returned as it is. Accepted, or ended " +
    "otherwise: WRONG_STATE. An authorizing offer whose bound company Safe transaction may still execute (indexing shows " +
    "the Safe's nonce has not passed it) is WRONG_STATE: reject the proposal first; one with no bound transaction, or " +
    "whose nonce went to another transaction, is cancelled at once with nothing to clean up. A pending offer with nothing " +
    "on chain is cancelled at once; one whose hats were minted begins cleanup (`begin_cleanup`, reason cancelled).",
  was: [`${AS_IS}:343`, `${I}/operations/cancel.ts:13`, `${I}/writes/endings.ts:108`],
  concept: concept_organizations,
  kind: "mutation",
  who: "A member whose Safe wears the Organization's People hat.",
  input: OneInvitation,
  output: InvitationView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  reads: [...PEOPLE_HAT, table_org_invitations, table_organizations, table_parties, table_safe_executions],
  writes: [table_org_invitations],
  drives: [machine_org_invite.t.cancel, machine_org_invite.t.begin_cleanup],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_organizations_invitations_resend = defineRpc({
  id: "organizations.invitations.resend",
  title: "Send a pending invitation's email again",
  about:
    "One transaction. The caller's Seat must wear the People hat, and the invitation must be this Organization's, else " +
    "ROLE_PERMISSION_DENIED. The offer must be pending, not past its expiry, and have a mailbox (an offer to an `@handle` " +
    "sent no email), else WRONG_STATE; the last send must be a minute old, else RATE_LIMITED with when the next is " +
    "allowed. `resend` stamps last_sent_at and moves nothing else: the digest and the expiry stay. Notices sends the one " +
    "message from the transition and keeps its delivery record; a mail provider's refusal is notices' outcome and never " +
    "changes the offer.",
  was: [`${AS_IS}:374`, `${I}/operations/resend.ts:14`, `${I}/rules/offers.ts:111`, `${I}/external.ts:159`],
  concept: concept_organizations,
  kind: "mutation",
  who: "A member whose Safe wears the Organization's People hat.",
  input: OneInvitation,
  output: InvitationView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE, error_RATE_LIMITED],
  reads: [...PEOPLE_HAT, table_org_invitations, table_organizations, table_parties],
  writes: [table_org_invitations],
  drives: [machine_org_invite.t.resend],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_organizations_invitations_list = defineRpc({
  id: "organizations.invitations.list",
  title: "One page of the invitations an Organization sent",
  about:
    "The caller's Seat must wear the People hat (else ROLE_PERMISSION_DENIED and no page). One page, 1 to 100, of every " +
    "invitation the Organization sent, whoever authored it, in (createdAt, invitationId) order; with phases, each at most " +
    "once, the pages of each phase merged in the same order. A cursor from another Organization or another list, a " +
    "repeated phase or a limit out of range is INVALID_INPUT. An offer whose grantee Party no longer resolves is " +
    "WRONG_STATE: its view cannot be built.",
  was: [`${AS_IS}:191`, `${I}/operations/list.ts:10`, `${I}/reads/pages.ts:201`, `${I}/reads/streams.ts:59`],
  concept: concept_organizations,
  kind: "query",
  who: "A member whose Safe wears the Organization's People hat.",
  input: Schema.Struct({ orgId: S, ...PageInput }),
  output: Page,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [...PEOPLE_HAT, table_org_invitations, table_organizations, table_parties, table_personal_safes],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_organizations_invitations_list_mine = defineRpc({
  id: "organizations.invitations.list-mine",
  title: "One page of the invitations sent to the caller, from any Organization",
  about:
    "The offers whose grantee is the caller's Party, across Organizations, in (createdAt, invitationId) order, each with " +
    "its offer digest; with phases, merged per phase in the same order. A caller with no Party gets an empty page. A " +
    "repeated phase is INVALID_INPUT before any invitation is read, as are a limit outside 1 to 100 and a foreign cursor. " +
    "An offer whose Organization or grantee no longer matches what was stored is WRONG_STATE.",
  was: [`${AS_IS}:215`, `${I}/operations/list-mine.ts:9`, `${I}/reads/streams.ts:34`],
  concept: concept_organizations,
  kind: "query",
  who: "Any signed-in person or agent.",
  input: Schema.Struct(PageInput),
  output: Page,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_org_invitations, table_organizations, table_parties, table_personal_safes],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
