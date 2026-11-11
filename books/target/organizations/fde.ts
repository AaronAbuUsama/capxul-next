// The fde area: the Organization's hosted Forward Deployed Engineer (aaron.fde-agent,
// aaron.fde-hosted, aaron.fde-anyone). Capxul hosts every Organization's FDE as a durable agent on a
// durable runtime with sandboxes (swarmD, organizations.fde-host): its key is the host's, never the
// founder's machine's. These rpcs serve `org fde show`, `org fde ask`, `org fde turn get` and
// `org fde guest add|remove|list` (organizations.commands, organizations.fde-commands,
// organizations.fde-guests); paying for the hosting, `org fde pay`, is payments' command, whose
// settlement moves the hosting on through this concept's door (procedures.ts,
// organizations.fde-hosting). The hosting's durable process is in processes.ts.
//
// Who may talk to the FDE (aaron.fde-anyone): any member, or a guest the management named. The host
// passes the asker's Seat: each ask carries an act-for token, and every call the FDE makes with it is
// the asker's, so it does for them only what their own hats allow (organizations.fde-for-the-asker).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import { integration_fde_host } from "../shared/external.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  machine_fde_guest,
  table_org_deployments,
  table_org_fde_asks,
  table_org_fde_guests,
  table_org_fde_payments,
  table_org_fdes,
  table_org_members,
  table_organizations,
} from "./data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_principals } from "../access/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import { procedure_accounts_admit } from "../accounts/procedures.ts";
import { MEMBER_GUARD, WHO_MEMBER } from "./apps.ts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;
const RULING =
  "books/target/shared/rulings.ts (aaron.fde-agent, aaron.fde-hosted, aaron.test-prices, aaron.fde-anyone); organizations.fde-commands";

/** The Organization's FDE as `org fde show` prints it; null when it has none. */
export const FdeView = Schema.Struct({
  handle: S,
  partyId: S,
  safe: S,
  /** Where it stands on the host. */
  status: Schema.Literals(["provisioned", "running", "due", "paused", "resuming", "retired"]),
  /** The officer hats its Safe wears by name (Books, Invoicing, People), and any other hat by id. The hosted FDE acts with its asker's, never these. */
  hats: Schema.Array(S),
  startedAt: NullOr(N),
  /** The instant its hosting is paid to, and the day it falls due (seven days before); null while hosting is not charged. */
  paidThrough: NullOr(N),
  dueAt: NullOr(N),
  /** The deployment's FDE_HOSTING_PRICE, a month: null when the deployment sets none, and hosting is free. */
  price: NullOr(Schema.Struct({ amount: S, asset: S })),
  /** What the Organization has paid for it: settled months, and the last payment. */
  monthsPaid: N,
  lastPaidAt: NullOr(N),
  pausedAt: NullOr(N),
  retireReason: NullOr(S),
  lastAskedAt: NullOr(N),
  /** Who last asked it something: a member's id, or a guest's. */
  lastAskedBy: NullOr(S),
});

/** One guest as `org fde guest list` prints it, and `add|remove` print it after the change. */
export const GuestView = Schema.Struct({
  guestId: S,
  partyId: S,
  email: S,
  handle: NullOr(S),
  name: NullOr(S),
  note: NullOr(S),
  status: Schema.Literals(["active", "removed"]),
  namedBy: S,
  namedAt: N,
  removedAt: NullOr(N),
});

/** What `org fde ask` answers once the host took the message. */
export const AskView = Schema.Struct({
  askId: S,
  turnId: S,
  askedAt: N,
  /** The latest instant the FDE may act for the asker under this ask, on the world's clock. */
  expiresAt: N,
});

/** One turn as `org fde turn get` prints it, and `org fde ask` prints it when the turn ends. */
export const TurnView = Schema.Struct({
  askId: S,
  turnId: S,
  status: Schema.Literals(["working", "ended", "failed"]),
  /** The FDE's reply once the turn ended; what it did is in its commands' traces, each the asker's. */
  reply: NullOr(S),
  reason: NullOr(S),
});

/** The guard of the FDE's conversation: a member, or a guest the management named (aaron.fde-anyone). */
const ASKER_GUARD =
  "It first finds the caller, signed in as themselves: their active Seat in the Organization (by principal, an " +
  "agent's by its Safe), or, with none, an active guest row for their Party (`org-fde-guests`). Neither, or an " +
  "Organization that does not exist, is ROLE_PERMISSION_DENIED alike and nothing is read or written. A call the " +
  "hosted FDE makes with an act-for token is refused the same way: the FDE never asks itself.";

/** People or Director, the management that names guests (docs/design/new-commands.md G4). */
const MANAGEMENT_GUARD =
  `${MEMBER_GUARD} Then the Seat's Safe must wear the People hat or the Director hat in good standing (indexing's ` +
  "wearers of the deployment's hats): anyone else is ROLE_PERMISSION_DENIED and nothing is written.";

const WHO_ASKER =
  "Any member of the Organization (a person or an agent), or a guest its management named (`org fde guest add`). " +
  "The FDE then acts as the asker: it does for them only what their own Seat and hats allow, and a guest's own " +
  "Party, with no Seat, allows only what a counterparty is admitted to (aaron.fde-anyone).";

const WHO_MANAGEMENT =
  "People or Director: a member whose own Safe wears the People hat or the Director hat, as indexing reads the chain " +
  "(the Organization's management, which names the outside people it works with).";

/** The host's failures, as the `fde-host` integration maps them (organizations.fde-host). */
const HOST_FAILURES = [error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID, error_RATE_LIMITED];
const MANAGEMENT_READS = [table_org_members, table_org_deployments, table_hat_wearers] as const;
const ASKER_READS = [table_org_members, table_org_fde_guests, table_parties, table_principals] as const;

export const rpc_organizations_fde_show = defineRpc({
  id: "organizations.fde.show",
  title: "The Organization's hosted FDE: its state, its hats and what is paid",
  about:
    `${MEMBER_GUARD} It answers the Organization's hosted FDE, or null when it has none (started with \`--no-fde\`): its ` +
    "handle and Party (parties), its Safe, its state on the host, the hats its Safe wears now (indexing's wearers, the " +
    "officer hats named through the deployment; the hosted FDE acts with its asker's, never these), when it started, " +
    "the instant its hosting is paid to and the day it falls due, the deployment's FDE_HOSTING_PRICE (null when unset, " +
    "and then hosting is not charged), the months paid and when, when it last paused, and who last asked it something. " +
    "It reads Capxul's own rows only and never calls the host: the host's view of a turn is `org fde turn get`'s. It " +
    "never writes.",
  was: [RULING],
  concept: concept_organizations,
  kind: "query",
  who: WHO_MEMBER,
  input: Schema.Struct({ orgId: S }),
  output: NullOr(FdeView),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED],
  reads: [table_org_members, table_org_fdes, table_org_fde_payments, table_org_fde_asks, table_parties, table_hat_wearers, table_org_deployments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_organizations_fde_ask = defineRpc({
  id: "organizations.fde.ask",
  title: "Send the hosted FDE a message from a member or a guest",
  about:
    `${ASKER_GUARD} The message is 1 to 8,000 characters, else INVALID_INPUT. The Organization must have a hosted FDE ` +
    "that is running or due: none, or one provisioned, paused, resuming or retired, is WRONG_STATE naming its state " +
    "(a paused one, the instant its hosting lapsed and `org fde pay`). It makes a fresh act-for token (32 random bytes) " +
    "and posts the message to the FDE's conversation on the host (the `fde-host` integration's `send`) with the asker " +
    "(their Seat's member id, or their guest id, their Party and name) and the token, which the host gives the FDE's " +
    "CLI for that turn alone and never stores past it; the host answers the turn's id. In one transaction it records " +
    "the ask (`org-fde-asks`: the turn, the asker, the token's SHA-256, the message's length and hash, never its text " +
    "or the token, and `expires_at`, FDE_ASK_HOURS on from now on the world's clock) and the hosting's last ask. While " +
    "the ask is open, each call the FDE makes with the token is the asker's (organizations.fde-for-the-asker). The host " +
    "unreachable, throttling or answering what does not decode is PROVIDER_ERROR, RATE_LIMITED or " +
    "PROVIDER_RESPONSE_INVALID, and nothing is recorded, so the token is never usable. This rpc grants nothing of its " +
    "own: the asker's Seat and hats are all the FDE acts with.",
  was: [RULING],
  concept: concept_organizations,
  kind: "action",
  who: WHO_ASKER,
  input: Schema.Struct({ orgId: S, message: S }),
  output: AskView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE, ...HOST_FAILURES],
  reads: [...ASKER_READS, table_org_fdes, table_organizations],
  writes: [table_org_fde_asks, table_org_fdes],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_fde_host.c.send],
  chain: [],
  spans: [],
  budget: { ...budget("vendor"), why: "one post to the FDE host before one write; the FDE's own turn is the flow's wait, never system time" },
});

export const rpc_organizations_fde_turn = defineRpc({
  id: "organizations.fde.turn",
  title: "Where one of the hosted FDE's turns stands, and its reply, for its asker",
  about:
    `${ASKER_GUARD} The turn must be one an ask of this Organization recorded for this caller (its member, or its ` +
    "guest): any other, a turn another member asked included, is INVALID_INPUT, so a turn id from elsewhere reads " +
    "nothing. It reads the turn from the host (the `fde-host` integration's `turn`): working, ended with the FDE's " +
    "reply, or failed with the host's reason. The first time it reads the turn ended or failed it stamps the ask's " +
    "`ended_at`, in one transaction, so the token acts for the asker no longer. The host's failures are PROVIDER_ERROR, " +
    "RATE_LIMITED or PROVIDER_RESPONSE_INVALID, and nothing is written.",
  was: [RULING],
  concept: concept_organizations,
  kind: "action",
  who: "The ask's own asker: the member or the guest who sent the message, never anyone else.",
  input: Schema.Struct({ orgId: S, turnId: S }),
  output: TurnView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, ...HOST_FAILURES],
  reads: [...ASKER_READS, table_org_fde_asks, table_org_fdes],
  writes: [table_org_fde_asks],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_fde_host.c.turn],
  chain: [],
  spans: [],
  budget: budget("vendor"),
});

// ── guests: the outside people the management names (organizations.fde-guests) ─────────────

const GuestLocator = Schema.Union([
  Schema.Struct({ type: Schema.Literal("email"), email: S }),
  Schema.Struct({ type: Schema.Literal("handle"), handle: S }),
]);

export const rpc_organizations_fde_guests_add = defineRpc({
  id: "organizations.fde-guests.add",
  title: "Name an outside person the Organization works with as a guest of its FDE",
  about:
    `${MANAGEMENT_GUARD} One transaction. The person is named by email or by a person's @handle and resolved with ` +
    "`parties.resolve-recipient`: an email names a person's Party, born provisional at its email-derived Safe when " +
    "nobody has it yet; an @handle must name a person's Party. Anything else (malformed, an agent's or an " +
    "Organization's Party, an outside address), or a Party that holds a Seat here (a member asks as themselves), is " +
    "INVALID_INPUT naming it, and nothing is written. A note is at most 200 characters (else INVALID_INPUT). A person " +
    "never named here is born an active guest (`name`); a removed one is active again (`name_again`), with the new " +
    "note; an active one is answered as it stands, so naming twice is one guest. A newly named or renamed guest is " +
    "admitted to the beta in the same transaction (`accounts.admit`, `via` fde-guest, `ref` the Organization's id), so " +
    "they can sign in with that mailbox; notices tells them how to ask. It grants no Seat and no hat.",
  was: [RULING],
  concept: concept_organizations,
  kind: "mutation",
  who: WHO_MANAGEMENT,
  input: Schema.Struct({ orgId: S, to: GuestLocator, note: Schema.optionalKey(S) }),
  output: GuestView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [...MANAGEMENT_READS, table_org_fde_guests, table_parties],
  writes: [table_org_fde_guests],
  drives: [machine_fde_guest.t.name, machine_fde_guest.t.name_again],
  invokes: [procedure_parties_resolve_recipient, procedure_accounts_admit],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_organizations_fde_guests_remove = defineRpc({
  id: "organizations.fde-guests.remove",
  title: "Stop a guest talking to the Organization's FDE",
  about:
    `${MANAGEMENT_GUARD} One transaction. The guest is named by email, @handle or guest id: one that names no guest ` +
    "here is INVALID_INPUT. An active guest becomes removed (`remove`), recording who removed them; from then the ask " +
    "guard finds no guest for them, so none of their open asks acts for them again and a new ask is " +
    "ROLE_PERMISSION_DENIED. One already removed is answered as it stands. Their admission to the beta, their Party and " +
    "the asks already recorded are kept.",
  was: [RULING],
  concept: concept_organizations,
  kind: "mutation",
  who: WHO_MANAGEMENT,
  input: Schema.Struct({ orgId: S, guest: S }),
  output: GuestView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [...MANAGEMENT_READS, table_org_fde_guests, table_parties],
  writes: [table_org_fde_guests],
  drives: [machine_fde_guest.t.remove],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_organizations_fde_guests_list = defineRpc({
  id: "organizations.fde-guests.list",
  title: "The outside people who may talk to the Organization's FDE",
  about:
    `${MEMBER_GUARD} It lists one page of the Organization's guests: the active ones newest named first, then the ` +
    "removed ones, or only those of `status` when given; each with their Party's mailbox, handle and name (parties), " +
    "the note, who named them and when. Pages are 25 by default (`limit` 1 to 100) and `nextCursor` is the `after` of " +
    "the next page, null on the last; a limit outside 1 to 100, or a cursor this list did not issue, is INVALID_INPUT. " +
    "It never writes.",
  was: [RULING],
  concept: concept_organizations,
  kind: "query",
  who: WHO_MEMBER,
  input: Schema.Struct({
    orgId: S,
    status: Schema.optionalKey(Schema.Literals(["active", "removed"])),
    limit: Schema.optionalKey(N),
    after: Schema.optionalKey(S),
  }),
  output: Schema.Struct({ items: Schema.Array(GuestView), nextCursor: NullOr(S) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_org_members, table_org_fde_guests, table_parties],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
