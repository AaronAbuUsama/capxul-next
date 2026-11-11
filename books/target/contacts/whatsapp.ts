// Contacts' WhatsApp area: an Organization connects its own WhatsApp Business number through Meta's
// WhatsApp Business Cloud API (decision contacts.whatsapp-connect), in the shapes of Frappe's WhatsApp
// app (WA Account, WA Message), and every message either way is threaded onto the contact by number
// (decision contacts.whatsapp-threading). Out: `org crm whatsapp send`, one rpc that sends through
// Meta and records the message once Meta answered its wamid, a free-form text only inside WhatsApp's
// 24-hour window on the world's clock (decision contacts.whatsapp-window). In: Meta's signed webhooks
// reach `contacts.whatsapp.receive` on the account's own route. The account's process
// (./processes.ts) checks the number daily. On a devnet and in a shared world WhatsApp is the world's
// stand-in (aaron.world-clock, devnet.whatsapp-stand-in).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_contacts } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { integration_whatsapp } from "../shared/external.ts";
import {
  machine_lead,
  machine_wa_account,
  machine_wa_message,
  table_contacts,
  table_leads,
  table_timeline_links,
  table_wa_accounts,
  table_wa_messages,
} from "./data.ts";
import { LOGGED, WHO_CRM_READ } from "./leads.ts";
import { CONVERSATION_GUARD, GUARD_READS, PEOPLE_GUARD, PREVIEW_GUARD, RECORD_READS, RECORD_RULE, WHO_CRM_PREVIEW } from "./mail.ts";
import { WhatsAppItem } from "./timeline.ts";

const WA = "github.com/frappe/whatsapp@59bf368:whatsapp/whatsapp";
const CRM = "github.com/frappe/crm@2cecd300:crm";

const S = Schema.String;
const NullOr = Schema.NullOr;

/** The connected number as every WhatsApp read and write returns it: never a token, a secret or a verify token. */
export const WhatsAppAccount = Schema.Struct({
  id: S,
  status: Schema.Literals(["active", "failing", "disconnected"]),
  display_number: S,
  verified_name: NullOr(S),
  phone_id: S,
  business_id: S,
  /** The route to set as the callback URL in the Organization's Meta app. */
  webhook_url: S,
  connected_by: S,
  connectedAt: Schema.Number,
  checkedAt: NullOr(Schema.Number),
  last_error: NullOr(Schema.Struct({ code: S, message: S })),
});

export const rpc_contacts_whatsapp_connect = defineRpc({
  id: "contacts.whatsapp.connect",
  title: "Connect the Organization's WhatsApp Business number",
  about:
    PEOPLE_GUARD +
    PREVIEW_GUARD +
    "An Organization has at most one live number: a live one (active or failing) is WRONG_STATE naming it, and a " +
    "number live in another Organization is INVALID_INPUT naming `phone_id`. Each field is checked for its form (Meta's " +
    "ids are digits; the token, app secret and verify token are non-empty), else INVALID_INPUT naming it. It reads the " +
    "number from Meta with the token (`whatsapp.readNumber`), then subscribes the token's app to the number's WhatsApp " +
    "Business Account (`whatsapp.subscribeApp`, as the WhatsApp app's `subscribe_webhook` does: Meta sends no webhook " +
    "for a WABA its app is not subscribed to, and setting the callback URL does not subscribe it): a token Meta " +
    "refuses, or an id it does not reach, is INVALID_INPUT naming the field, and Meta down is PROVIDER_ERROR, with " +
    "nothing written. On staging, a `phone_id` that WHATSAPP_ALLOWED_NUMBERS does not list (Meta's test numbers, which " +
    "send only to their registered recipients) is INVALID_INPUT before any call, so staging's WhatsApp stays in its " +
    "world (contacts.whatsapp-staging-numbers). Then one transaction " +
    "writes the account, active (`connect`), its access token, app secret and verify token sealed under record-bound " +
    "encryption (a verify token not given is made: 32 random characters). Returns the account with its webhook URL, " +
    "`<SITE_URL>/v1/whatsapp/<account id>`, and, this once, its verify token, to set in the Meta app; never the token " +
    "or the app secret. On a devnet the stand-in's key file gives every field (`capxul-devnet whatsapp number add`).",
  concept: concept_contacts,
  kind: "action",
  who: WHO_CRM_PREVIEW,
  input: Schema.Struct({
    orgId: S,
    phoneId: S,
    businessId: S,
    appId: S,
    accessToken: S,
    appSecret: S,
    verifyToken: Schema.optionalKey(S),
  }),
  output: Schema.Struct({ account: WhatsAppAccount, verifyToken: S }),
  errors: [
    error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE, error_PROVIDER_ERROR,
    error_RATE_LIMITED, error_PROVIDER_RESPONSE_INVALID,
  ],
  reads: [...GUARD_READS, table_wa_accounts],
  writes: [table_wa_accounts],
  drives: [machine_wa_account.t.connect],
  invokes: [],
  emits: [],
  calls: [integration_whatsapp.c.readNumber, integration_whatsapp.c.subscribeApp],
  chain: [],
  spans: [],
  budget: budget("vendor"),
  was: [`${WA}/doctype/wa_account/wa_account.json`, `${WA}/doctype/wa_settings/wa_settings.json`, `${WA}/doctype/wa_account/wa_account.py:169`],
});

export const rpc_contacts_whatsapp_disconnect = defineRpc({
  id: "contacts.whatsapp.disconnect",
  title: "Disconnect the Organization's WhatsApp number",
  about:
    PEOPLE_GUARD +
    PREVIEW_GUARD +
    "The Organization's live account (active or failing) is disconnected (`disconnect`) and its sealed secrets erased, in " +
    "one transaction, which also ends the account's process; no live account is WRONG_STATE. Nothing more is sent, " +
    "and Meta's calls to its route are refused from then on. Every message stays on its records' timelines. Returns " +
    "the account as it now stands. Connecting a number again makes a new account.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_CRM_PREVIEW,
  input: Schema.Struct({ orgId: S }),
  output: WhatsAppAccount,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  reads: [...GUARD_READS, table_wa_accounts],
  writes: [table_wa_accounts],
  drives: [machine_wa_account.t.disconnect],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${WA}/doctype/wa_account/wa_account.json`],
});

export const rpc_contacts_whatsapp_show = defineRpc({
  id: "contacts.whatsapp.show",
  title: "Read the Organization's WhatsApp number, or null",
  about:
    "The Organization's live account (active or failing), else the last one disconnected, else null: its status, " +
    "number, verified name, Meta ids, webhook URL, who connected it and when, and its process's last check and error. " +
    "Never a token, a secret or the verify token.",
  concept: concept_contacts,
  kind: "query",
  who: WHO_CRM_READ,
  input: Schema.Struct({ orgId: S }),
  output: NullOr(WhatsAppAccount),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED],
  reads: [table_wa_accounts, ...GUARD_READS],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [`${WA}/doctype/wa_account/wa_account.json`],
});

export const rpc_contacts_whatsapp_send = defineRpc({
  id: "contacts.whatsapp.send",
  title: "Send a WhatsApp message about one record from the connected number",
  about:
    CONVERSATION_GUARD +
    PREVIEW_GUARD +
    "The Organization's account must be active: none, or one failing, is WRONG_STATE naming it. " +
    RECORD_RULE +
    "The number: `to` as given (E.164), else the record's own (a person entry's primary mobile, else its primary " +
    "phone; a lead's `mobile_no`, else `phone`; a deal's primary person's), none being INVALID_INPUT naming `to`. " +
    "Exactly one of `text` (1 to 4,096 characters) or `template` (an approved template's name, its language, `en` " +
    "when absent, and its body's parameters, as text in the order of its {{1}}, {{2}}, ...), else INVALID_INPUT. A text goes only inside WhatsApp's customer service window, " +
    "24 hours on the world's clock from the last Incoming message from that number to this account; outside it, it is " +
    "WRONG_STATE naming the window, and a template goes instead (contacts.whatsapp-window). `inReplyTo` (`--in-reply-to`) names a message of " +
    "this conversation by its id, sent as its context. It calls `whatsapp.sendMessage`; once Meta answered its wamid, one " +
    "transaction writes the message (`send`, at the world's now, by the member), its timeline links (the record, and " +
    "every contact entry keeping that number) and its change-log row. A send key already recorded answers that " +
    "message and sends nothing. If Meta fails nothing is written: PROVIDER_ERROR or RATE_LIMITED; Meta's own refusal " +
    "of the window or the token WRONG_STATE; of the number or template INVALID_INPUT. Returns the message.",
  concept: concept_contacts,
  kind: "action",
  who: WHO_CRM_PREVIEW,
  input: Schema.Struct({
    orgId: S,
    record: S,
    text: Schema.optionalKey(S),
    template: Schema.optionalKey(
      Schema.Struct({ name: S, language: Schema.optionalKey(S), params: Schema.optionalKey(Schema.Array(S)) }),
    ),
    to: Schema.optionalKey(S),
    inReplyTo: Schema.optionalKey(S),
    /** One per SDK invocation, repeated on its retry. */
    sendKey: S,
  }),
  output: WhatsAppItem,
  errors: [
    error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE, error_PROVIDER_ERROR,
    error_RATE_LIMITED, error_PROVIDER_RESPONSE_INVALID,
  ],
  reads: [...GUARD_READS, ...RECORD_READS, table_wa_accounts, table_wa_messages],
  writes: [table_wa_messages, table_timeline_links, ...LOGGED],
  drives: [machine_wa_message.t.send],
  invokes: [],
  emits: [],
  calls: [integration_whatsapp.c.sendMessage],
  chain: [],
  spans: [],
  budget: budget("vendor"),
  was: [`${WA}/doctype/wa_message/wa_message.py:200`, `${WA}/doctype/wa_message/wa_message.py:308`],
});

/** Meta's GET handshake on the account's route. */
const Handshake = Schema.Struct({ accountId: S, mode: Schema.Literal("subscribe"), verifyToken: S, challenge: S });
/** Meta's signed POST on the account's route. */
const Delivery = Schema.Struct({ accountId: S, body: S, signature: S });

export const rpc_contacts_whatsapp_receive = defineRpc({
  id: "contacts.whatsapp.receive",
  title: "Take Meta's calls on one account's route: the handshake, messages, statuses",
  about:
    "Meta's calls to `/v1/whatsapp/<account id>`; no session. The GET handshake answers `hub.challenge` when " +
    "`hub.verify_token` is the account's, else NOT_AUTHENTICATED. A POST's X-Hub-Signature-256 is checked against the " +
    "account's app secret before the body is read, else NOT_AUTHENTICATED and nothing is stored; a disconnected " +
    "account's route refuses every call so. One transaction takes the body: each message received, by its wamid (a " +
    "repeat changes nothing), is stored Incoming (`receive`) at the world's now and threaded (contacts.whatsapp-" +
    "threading): one answering a message of this account (its context id) is about the same record; else the " +
    "latest-changed contact entry keeping the sender's number in `phone_nos`; else the latest-changed lead not " +
    "converted whose `mobile_no` or `phone` it is; else a new lead is captured with the sender's profile name, the " +
    "number as `mobile_no` and source WhatsApp, as Frappe CRM's WhatsApp hook does for an account that appends to CRM " +
    "Lead; each with its timeline links " +
    "and change-log rows. Each status moves the message it names (`deliver`, `read`, or `fail` with Meta's error); one " +
    "the message has passed is ignored. A status naming no message here may be one whose send has not committed yet, " +
    "as Meta's `sent` can overtake the send's own answer: one dated within five minutes of the world's now is counted " +
    "`early`, and the route then answers 503 after storing the rest, so Meta redelivers the body, as it redelivers any " +
    "delivery not answered 200 (for up to 7 days), and the repeats change nothing; an older one is ignored " +
    "(contacts.whatsapp-early-status). Media is " +
    "kept by Meta's id and type. A body that does not decode is INVALID_INPUT. It signals the account's process, since " +
    "a signed delivery proves Meta reaches the number.",
  concept: concept_contacts,
  kind: "mutation",
  who: "meta: Meta's calls to one WhatsApp account's route, signed with its app secret; no session is involved and none is accepted.",
  input: Schema.Union([Handshake, Delivery]),
  output: Schema.Union([
    Schema.Struct({ challenge: S }),
    /** `early` above 0: the route answers 503 so Meta redelivers. */
    Schema.Struct({ stored: Schema.Int, moved: Schema.Int, ignored: Schema.Int, early: Schema.Int }),
  ]),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [table_wa_accounts, table_wa_messages, table_contacts, table_leads, ...LOGGED],
  writes: [table_wa_messages, table_timeline_links, table_leads, ...LOGGED],
  drives: [
    machine_wa_message.t.receive, machine_wa_message.t.deliver, machine_wa_message.t.read, machine_wa_message.t.fail,
    machine_lead.t.capture,
  ],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${WA}/webhook.py:30`, `${WA}/webhook.py:101`, `${WA}/webhook.py:242`, `${CRM}/api/whatsapp.py:42`, `${CRM}/api/whatsapp.py:70`],
});
