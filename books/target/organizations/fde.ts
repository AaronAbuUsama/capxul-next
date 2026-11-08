// The fde area: the Organization's hosted Forward Deployed Engineer (aaron.fde-agent,
// aaron.fde-hosted). Capxul hosts every Organization's FDE as a durable agent on a durable runtime
// with sandboxes (swarmD, organizations.fde-host): its key is the host's, never the founder's
// machine's. These rpcs serve `org fde show` and `org fde ask` (organizations.commands,
// organizations.fde-commands); paying for the hosting, `org fde pay`, is payments' command, whose
// settlement moves the hosting on through this concept's door (procedures.ts,
// organizations.fde-hosting). The hosting's durable process is in processes.ts.
//
// The FDE host is reached through the `fde-host` integration, which organizations.fde-host asks the
// shared designer to book (component `fde-host`, swarmD): until it is in shared/external.ts these
// rpcs name its calls in their `about` and their failures in `errors`, and list no `calls`.

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
  table_org_deployments,
  table_org_fde_asks,
  table_org_fde_payments,
  table_org_fdes,
  table_org_members,
  table_organizations,
} from "./data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { table_parties } from "../parties/data.ts";
import { MEMBER_GUARD, WHO_MEMBER } from "./apps.ts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;
const RULING = "books/target/shared/rulings.ts (aaron.fde-agent, aaron.fde-hosted, aaron.test-prices); organizations.fde-commands";

/** The Organization's FDE as `org fde show` prints it; null when it has none. */
export const FdeView = Schema.Struct({
  handle: S,
  partyId: S,
  safe: S,
  /** Where it stands on the host. */
  status: Schema.Literals(["provisioned", "running", "due", "paused", "resuming", "retired"]),
  /** The officer hats its Safe wears by name (Books, Invoicing, People), and any other hat by id: the Board grants each. */
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
  /** The member who last asked it something. */
  lastAskedBy: NullOr(S),
});

const DIRECTOR_GUARD =
  `${MEMBER_GUARD} Then the Seat's Safe must wear the Director hat in good standing (indexing's wearers of the ` +
  "deployment's Director hat): anyone else, an agent included, is ROLE_PERMISSION_DENIED and nothing is written.";

const WHO_DIRECTOR =
  "A Director of the Organization: a member whose own Safe wears the Director hat, as indexing reads the chain. The " +
  "FDE acts with the hats the Board granted its Safe, so whoever instructs it borrows them: a Director, who may " +
  "propose any grant, and never an agent.";

/** The host's failures, as the `fde-host` integration maps them (organizations.fde-host). */
const HOST_FAILURES = [error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID, error_RATE_LIMITED];

export const rpc_organizations_fde_show = defineRpc({
  id: "organizations.fde.show",
  title: "The Organization's hosted FDE: its state, its hats and what is paid",
  about:
    `${MEMBER_GUARD} It answers the Organization's hosted FDE, or null when it has none (started with \`--no-fde\`): its ` +
    "handle and Party (parties), its Safe, its state on the host, the hats its Safe wears now (indexing's wearers, the " +
    "officer hats named through the deployment), when it started, the instant its hosting is paid to and the day it " +
    "falls due, the deployment's FDE_HOSTING_PRICE (null when unset, and then hosting is not charged), the months paid " +
    "and when, when it last paused, and who last asked it something. It reads Capxul's own rows only and never calls " +
    "the host: the host's live view of a turn is `org fde ask`'s. It never writes.",
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
  title: "Send the hosted FDE a message from a Director",
  about:
    `${DIRECTOR_GUARD} The message is 1 to 8,000 characters, else INVALID_INPUT. The Organization must have a hosted ` +
    "FDE that is running or due: none, or one provisioned, paused, resuming or retired, is WRONG_STATE naming its state " +
    "(a paused one, the instant its hosting lapsed and `org fde pay`). It then posts the message to the FDE's " +
    "conversation on the host (the `fde-host` integration's `send`, with the asker's member id, name and Party, so the " +
    "FDE knows who asks), which answers the turn the FDE will take; in one transaction it records the ask (`org-fde-" +
    "asks`: the turn, the asker, the message's length and hash, never its text) and the hosting's last ask. The host " +
    "unreachable, throttling or answering what does not decode is PROVIDER_ERROR, RATE_LIMITED or " +
    "PROVIDER_RESPONSE_INVALID, and nothing is recorded. Whatever the FDE does in return it does through its own " +
    "commands, signed with its own key and each traced: this rpc grants it nothing.",
  was: [RULING],
  concept: concept_organizations,
  kind: "action",
  who: WHO_DIRECTOR,
  input: Schema.Struct({ orgId: S, message: S }),
  output: Schema.Struct({ askId: S, turnId: S, askedAt: N }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE, ...HOST_FAILURES],
  reads: [table_org_members, table_org_deployments, table_hat_wearers, table_org_fdes, table_organizations, table_parties],
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
  title: "Where one of the hosted FDE's turns stands, and its reply",
  about:
    `${DIRECTOR_GUARD} The turn must be one an ask of this Organization recorded (else INVALID_INPUT), so a turn id ` +
    "from elsewhere reads nothing. It reads the turn from the host (the `fde-host` integration's `turn`): working, " +
    "ended with the FDE's reply, or failed with the host's reason. The host's failures are PROVIDER_ERROR, RATE_LIMITED " +
    "or PROVIDER_RESPONSE_INVALID. It never writes.",
  was: [RULING],
  concept: concept_organizations,
  kind: "action",
  who: "Any Director of the Organization, as for `org fde ask`: the asker or another.",
  input: Schema.Struct({ orgId: S, turnId: S }),
  output: Schema.Struct({
    turnId: S,
    status: Schema.Literals(["working", "ended", "failed"]),
    /** The FDE's reply once the turn ended; what it did is in its own commands' traces. */
    reply: NullOr(S),
    reason: NullOr(S),
  }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, ...HOST_FAILURES],
  reads: [table_org_members, table_org_deployments, table_hat_wearers, table_org_fde_asks, table_org_fdes],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_fde_host.c.turn],
  chain: [],
  spans: [],
  budget: budget("vendor"),
});
