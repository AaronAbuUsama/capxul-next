// The members area: the Organization's Seats. A Seat is born by the setup (the founder) or by an
// accepted invitation, and ends only when the chain removes the agent that holds it
// (processes.ts). Granting and revoking an officer hat is board's (`org member grant`,
// `org member revoke`); a spending allowance is budgets'. The old area's grant, revoke,
// permission-target, record-permission-change, advance, emit and notify rpcs go with them or with
// the legacy pending states (decision organizations.members-are-seats). How many Seats an
// Organization may fill is its `seat_limit` (ten at birth, aaron.seats). The Organization buys more
// itself, paid through payments, whose settlement counts them through this concept's door
// (procedures.ts, organizations.buy-seats); a Capxul operator may still raise it, here
// (decision organizations.seat-limit).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { table_org_deployments, table_org_invitations, table_org_members, table_org_seat_purchases, table_organizations } from "./data.ts";
import { table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";

const O = "packages/backend/src/organizations";
const AS_IS = "docs/as-is/archive/organizations/members.ts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

/** One member as `org member list` and `org member get` print it (their frozen returns). */
export const MemberView = Schema.Struct({
  memberId: S,
  email: NullOr(S),
  name: NullOr(S),
  accountId: NullOr(S),
  personalSafeAddress: NullOr(S),
  /** `Director` when the Seat's Safe wears the Director hat, else `Member`; an open invitation is `Member`. */
  role: S,
  /** The target produces `pending` (an open invitation), `active` and `revoked` (a removed agent's Seat). */
  status: Schema.Literals(["pending", "pending_safe", "pending_grant", "active", "revoked", "expired"]),
  /** The frozen surface keeps `ai` for a Seat an agent holds. */
  kind: Schema.Literals(["human", "ai"]),
  /** The officer hats the Seat's Safe wears: Books, Invoicing and People. */
  permissions: Schema.Array(Schema.Literals(["manage-books", "issue-invoices", "manage-people"])),
});

export const rpc_organizations_members_list = defineRpc({
  id: "organizations.members.list",
  title: "The Organization's Seats and the people invited who have not joined",
  about:
    "One page, in join order, of the Organization's Seats, then its open invitations (authorizing or pending) as members " +
    "with status `pending` and no Account. Each Seat shows its principal's email (access) and its Party's name, its principal as the Account ID, " +
    "the Safe it acts from, and the officer hats that Safe wears now (indexing's wearers, named through the deployment). " +
    "Every row has its own memberId, an invitation's being its invitation ID. Only a current member may read it (else " +
    "ROLE_PERMISSION_DENIED); a cursor from another list is INVALID_INPUT.",
  was: [`${AS_IS}:124`, `${O}/members/operations/list.ts:9`, `${O}/members/reads.ts:27`],
  concept: concept_organizations,
  kind: "query",
  who: "Any current member of the Organization.",
  input: Schema.Struct({ orgId: S, limit: Schema.optionalKey(N), after: Schema.optionalKey(S) }),
  output: Schema.Struct({ items: Schema.Array(MemberView), nextCursor: NullOr(S) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_org_members, table_org_invitations, table_org_deployments, table_principals, table_parties, table_hat_wearers],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

/** What a raise answers: the Organization's limit now and what counts against it. */
export const SeatsView = Schema.Struct({
  orgId: S,
  seatLimit: N,
  /** Active Seats that count one, and live offers that reserve one. */
  seatsUsed: N,
  offersReserved: N,
  /** Whether the Organization's own agent holds or is offered its one place. */
  ownAgent: Schema.Boolean,
  /** Seats the Organization bought, counted now (its settled purchases). */
  seatsBought: N,
  raisedBy: NullOr(S),
  raisedAt: NullOr(N),
});

export const rpc_organizations_seats_raise = defineRpc({
  id: "organizations.seats.raise",
  title: "An operator raises an Organization's seat limit",
  about:
    "The operator's tool, run with the deployment's operator key (no person session; anything else is " +
    "NOT_AUTHENTICATED), one transaction under the Organization row's lock. It sets `seat_limit` to the number given and " +
    "records the operator's label and the time. The limit only goes up: a number that is not a whole number above the " +
    "current limit, or an Organization that does not exist, is INVALID_INPUT and nothing changes. It answers the limit " +
    "with what counts against it and the seats bought. An Organization starts with ten in the beta and after " +
    "(aaron.seats); besides this raise, only a settled seat purchase adds to the limit (organizations.buy-seats), and " +
    "nobody inside the Organization sets it by hand.",
  was: ["books/target/shared/rulings.ts (aaron.seats, aaron.buy-seats)", "books/target/accounts/admission.ts (the operator tool's pattern)"],
  concept: concept_organizations,
  kind: "mutation",
  who: "A Capxul operator with the deployment's operator key, through the operator's tool.",
  input: Schema.Struct({ orgId: S, seats: N, by: S }),
  output: SeatsView,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [table_organizations, table_org_members, table_org_invitations, table_org_seat_purchases],
  writes: [table_organizations],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

/** What `org seats show` prints: the limit and what counts against it, the seats bought, and the price of one more. */
export const SeatsShowView = Schema.Struct({
  ...SeatsView.fields,
  /** The deployment's SEAT_PRICE, paid once a seat (aaron.test-prices: 10 USDC); null when unset, and seats cannot be bought. */
  price: NullOr(Schema.Struct({ amount: S, asset: S })),
});

export const rpc_organizations_seats_show = defineRpc({
  id: "organizations.seats.show",
  title: "The Organization's seat limit, what counts against it, and the price of a seat",
  about:
    "Only a current member may read it (by principal, an agent's by its Safe; else ROLE_PERMISSION_DENIED, as for an " +
    "Organization that does not exist). It answers the seat limit, the active Seats that count one and the live offers " +
    "that reserve one (organizations.seat-limit), whether the Organization's own agent holds its place, the seats it " +
    "bought and counted now (its settled purchases), who last raised the limit and when, and the deployment's SEAT_PRICE " +
    "for one more, paid once (null when unset, when `org seats buy` is FEATURE_NOT_AVAILABLE). It never writes " +
    "(organizations.seats-show, aaron.buy-seats).",
  was: ["books/target/shared/rulings.ts (aaron.buy-seats, aaron.test-prices)"],
  concept: concept_organizations,
  kind: "query",
  who:
    "Any member of the Organization: an active Seat, a person's or an agent's. The hosted FDE reads only as the member " +
    "who asked it (aaron.fde-anyone), never as itself; a self-run own agent reads as itself.",
  input: Schema.Struct({ orgId: S }),
  output: SeatsShowView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED],
  reads: [table_organizations, table_org_members, table_org_invitations, table_org_seat_purchases],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
