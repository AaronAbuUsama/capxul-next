// Devnet's mail area: the mail sink and its fail switch, and notices' delivery records. Nothing leaves
// the machine on a devnet: the `mail` integration's devnet fake keeps every message in the sink
// (./data.ts) and spends the armed faults. These rpcs exist only in the devnet build of the backend,
// which serves only loopback, so "anyone on the machine that runs the local devnet" is every caller
// that reaches them (decision devnet.devnet-only-rpcs). A shared world runs the same build behind its
// gateway, which admits a request only with a world grant: there the owner reads every message, and a
// joiner, while a season they play runs, only the mail to the mailboxes its grant names, so the world's
// mail stays inside it and its players still read their own sign-in codes (decision devnet.season-players).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_devnet } from "../shared/foundation.ts";
import { error_INVALID_INPUT } from "../shared/vocabulary.ts";
import { table_notices } from "../notices/data.ts";
import { table_mail_faults, table_mail_messages } from "./data.ts";

const OP = "packages/backend/src/operator";
const ASIS = "docs/as-is/archive/operator";

const S = Schema.String;
const Int = Schema.Int;
const Instant = Schema.DateTimeUtc;
const NullOr = Schema.NullOr;

/** One message as the sink keeps it. */
export const MailMessage = Schema.Struct({
  mailId: S,
  to: S,
  from: S,
  subject: S,
  template: S,
  text: S,
  links: Schema.Array(S),
  sentAt: Instant,
});

/** An armed fault: the address (`null` for any) and how many sends it still fails. */
export const MailFault = Schema.Struct({ to: NullOr(S), remaining: Int });

const ON_THE_MACHINE =
  "devnet only: anyone on the machine that runs the local devnet; no sign-in. In a shared world, its owner's grant.";
/** The mail reads: in a shared world a player reads only its own mailboxes' mail (decision devnet.season-players). */
const MAIL_READER =
  "devnet only: anyone on the machine that runs the local devnet; no sign-in. In a shared world, its owner's grant, or, " +
  "while a season they play runs, a joiner's for the mailboxes the grant names.";

export const rpc_devnet_mail_list = defineRpc({
  id: "devnet.mail.list",
  title: "The mail Capxul sent on this devnet, newest first",
  about:
    "Reads the mail sink's sent mail (`out`; an inbound email `capxul-devnet mail receive` made is not listed), newest " +
    "first, 200 at most: to one address (trimmed and lowercased) with `to`, else to anyone. " +
    "`template` and `limit` narrow it further inside the query, before the 200 are taken, so a filter never misses an " +
    "older match; `dev approve` asks for the newest `sign-in-code` message to the person it plays. Sign-in codes are shown " +
    "as sent: on a devnet the sink is how a developer, an eval or `dev approve` signs in. A `to` that is not an address " +
    "is INVALID_INPUT. In a shared world a joiner's list holds only the mail to its own mailboxes, and a `to` outside " +
    "them is INVALID_INPUT, as an address that names nothing the caller may read.",
  was: [`${ASIS}/outboxes.ts:60`, `${OP}/outboxes/operations/list.ts:11`, `${OP}/outboxes/reads.ts:11`],
  concept: concept_devnet,
  kind: "query",
  who: MAIL_READER,
  input: Schema.Struct({
    to: Schema.optionalKey(S),
    template: Schema.optionalKey(S),
    limit: Schema.optionalKey(Int),
  }),
  output: Schema.Struct({ to: NullOr(S), mail: Schema.Array(MailMessage) }),
  errors: [error_INVALID_INPUT],
  reads: [table_mail_messages],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_devnet_mail_fail = defineRpc({
  id: "devnet.mail.fail",
  title: "Arm, list or clear the mail sink's fail switch",
  about:
    "One transaction on the faults. With `list` it reads the armed faults and changes nothing. With `clear` it deletes " +
    "every fault and answers `cleared` true. Otherwise it arms the next `next` sends (a whole number from 1 to 100) to " +
    "`to`, lowercased, or to any address without it, replacing that address's fault; a missing or out-of-range `next` is " +
    "INVALID_INPUT naming the range. It answers the faults still armed. The CLI refuses the combinations the page forbids " +
    "(`--list` with anything, `--clear` with `--next` or `--to`) before it calls.",
  was: [`${ASIS}/outboxes.ts:100`, `${OP}/outboxes/operations/fail.ts:20`, `${OP}/outboxes/rules.ts:15`, `${OP}/outboxes/writes.ts:14`],
  concept: concept_devnet,
  kind: "mutation",
  who: ON_THE_MACHINE,
  input: Schema.Struct({
    next: Schema.optionalKey(Int),
    to: Schema.optionalKey(S),
    clear: Schema.optionalKey(Schema.Boolean),
    list: Schema.optionalKey(Schema.Boolean),
  }),
  output: Schema.Struct({ cleared: Schema.Boolean, faults: Schema.Array(MailFault) }),
  errors: [error_INVALID_INPUT],
  reads: [table_mail_faults],
  writes: [table_mail_faults],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

/** One notice's delivery record, as `dev mail notices` prints it. */
export const NoticeDelivery = Schema.Struct({
  noticeId: S,
  template: S,
  to: S,
  state: Schema.Literals(["sent", "retrying", "failed"]),
  attempts: Int,
  lastError: NullOr(Schema.Struct({ code: S, message: S })),
  updatedAt: Instant,
});

export const rpc_devnet_mail_list_notices = defineRpc({
  id: "devnet.mail.list-notices",
  title: "Each notice's delivery record, most recently changed first",
  about:
    "Reads notices' delivery records (the notices concept owns them and writes them from its workflows), 200 at most, " +
    "most recently changed first, filtered by recipient and by template inside the query. Each shows its state (sent, " +
    "retrying or failed), its attempts and its last error. It lives in devnet, not notices, because it answers only on a " +
    "devnet (operations.dev-mail-notices-in-devnet); on staging the same records are read by an operator through the " +
    "database, never through an rpc. A `to` that is not an address is INVALID_INPUT.",
  was: [`${ASIS}/notices.ts:57`, `${OP}/notices/operations/list.ts:14`, `${OP}/notices/reads.ts:26`],
  concept: concept_devnet,
  kind: "query",
  who: MAIL_READER,
  input: Schema.Struct({ to: Schema.optionalKey(S), template: Schema.optionalKey(S) }),
  output: Schema.Struct({ to: NullOr(S), template: NullOr(S), notices: Schema.Array(NoticeDelivery) }),
  errors: [error_INVALID_INPUT],
  reads: [table_notices],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
