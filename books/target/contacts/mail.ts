// Contacts' mail area: the CRM's email, in and out, through the per-Organization CRM mailbox
// `<handle>@<CRM_MAIL_DOMAIN>` (decision contacts.crm-mailbox), on the mail integration notices
// already uses, with its inbound half added (shared/external.ts, `mail`). Out: `org crm email send`,
// one rpc that sends through Resend and records the Communication once Resend took it. In: Resend's
// signed events reach `contacts.mail.receive`, which stores each received email's id and moves each
// sent email's delivery; the inbound email's own process (`contacts.mail.thread`, ./processes.ts)
// reads it and threads it onto its record by Message-ID (decision contacts.mail-threading). A CRM email
// is the CRM's own record, never a notice (decision notices.mail-channel). Every time is the world's.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_contacts } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { integration_mail } from "../shared/external.ts";
import {
  machine_communication,
  machine_inbound_mail,
  table_communications,
  table_contacts,
  table_deal_contacts,
  table_deals,
  table_inbound_mails,
  table_leads,
  table_timeline_links,
} from "./data.ts";
import { table_org_deployments, table_org_members, table_organizations } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { LOGGED, WHO_CRM_WRITE } from "./leads.ts";
import { EmailItem } from "./timeline.ts";

const FRAPPE = "github.com/frappe/frappe@1a7ea577:frappe";
const CRM = "github.com/frappe/crm@2cecd300:crm";

const S = Schema.String;

/** The guard every CRM conversation write runs first (contacts.crm-permission), and the log it writes (contacts.change-log). */
export const PEOPLE_GUARD =
  "It first checks the caller's Seat wears the People hat (the deployment's people hat id, wearers from indexing), " +
  "else ROLE_PERMISSION_DENIED and nothing is written. ";
export const CONVERSATION_GUARD =
  PEOPLE_GUARD + "What it writes is appended to `contact-changes` and takes that seq as its `version` (contacts.change-log). ";
/**
 * What a write behind a previewing command checks too (G5, contacts.sends-preview): the preview is the asker's own to
 * answer, so the hosted FDE's act-for call is refused (organizations.fde-for-the-asker).
 */
export const PREVIEW_GUARD =
  "The hosted FDE's act-for call is ROLE_PERMISSION_DENIED: the preview is the asker's (organizations.fde-for-the-asker). ";
/** Who may make a write behind a previewing command. */
export const WHO_CRM_PREVIEW =
  `${WHO_CRM_WRITE} Never the hosted FDE for its asker: the preview is the member's own (organizations.fde-for-the-asker).`;
/** How a conversation write names its record (contacts.timeline). */
export const RECORD_RULE =
  "`record` is a contact entry's id (`party_`, `contact_`), a `lead_` or a `deal_` id of this CRM, else INVALID_INPUT; " +
  "a converted lead is WRONG_STATE naming its deal, which carries its conversations on. ";
/** What a write that checks the People hat reads (contacts.members-write). */
export const GUARD_READS = [table_org_members, table_org_deployments, table_hat_wearers];
/** The tables a record's lookup reads. */
export const RECORD_READS = [table_contacts, table_leads, table_deals, table_deal_contacts];

export const rpc_contacts_mail_send = defineRpc({
  id: "contacts.mail.send",
  title: "Send an email from the Organization's CRM mailbox about one record",
  about:
    CONVERSATION_GUARD +
    PREVIEW_GUARD +
    RECORD_RULE +
    "Recipients: `to` as given, else the record's own mailbox (a person entry's primary one, a lead's `email`, a " +
    "deal's primary person's primary one), none being INVALID_INPUT naming `to`; with `cc` and `bcc`, at most 50 " +
    "well-formed mailboxes in all. `inReplyTo` (`--in-reply-to`) names an email on this record's timeline (or its lead's) by its id: this one " +
    "answers it, with In-Reply-To its Message-ID, References its thread's and, when no subject is given, `Re: ` and " +
    "its subject. A subject (1 to 998 characters; with `inReplyTo`, its own when none is given) and a text body (1 to " +
    "100,000) are needed, else INVALID_INPUT. It " +
    "sends from `<member's name> at <Organization's name> <handle@CRM_MAIL_DOMAIN>`, Reply-To the mailbox, Message-ID " +
    "`<comm id>@CRM_MAIL_DOMAIN`, through `mail.send` under the send key; once Resend took it, one transaction writes " +
    "the communication (`send`, at the world's now, by the member), its timeline links (the record, and every contact " +
    "entry of the book keeping a recipient's mailbox) and its change-log row. A send key already recorded answers that " +
    "email and sends nothing. If Resend fails nothing is written: PROVIDER_ERROR or RATE_LIMITED, or INVALID_INPUT " +
    "naming a recipient it, or staging's MAIL_ALLOWED_RECIPIENTS, refused. Returns the email.",
  concept: concept_contacts,
  kind: "action",
  who: WHO_CRM_PREVIEW,
  input: Schema.Struct({
    orgId: S,
    record: S,
    subject: Schema.optionalKey(S),
    text: S,
    to: Schema.optionalKey(Schema.Array(S)),
    cc: Schema.optionalKey(Schema.Array(S)),
    bcc: Schema.optionalKey(Schema.Array(S)),
    inReplyTo: Schema.optionalKey(S),
    /** One per SDK invocation, repeated on its retry. */
    sendKey: S,
  }),
  output: EmailItem,
  errors: [
    error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE, error_PROVIDER_ERROR,
    error_RATE_LIMITED,
  ],
  reads: [...GUARD_READS, ...RECORD_READS, table_communications, table_organizations, table_parties],
  writes: [table_communications, table_timeline_links, ...LOGGED],
  drives: [machine_communication.t.send],
  invokes: [],
  emits: [],
  calls: [integration_mail.c.send],
  chain: [],
  spans: [],
  budget: budget("vendor"),
  was: [`${FRAPPE}/core/doctype/communication/email.py:1`, `${CRM}/api/email.py:1`],
});

export const rpc_contacts_mail_receive = defineRpc({
  id: "contacts.mail.receive",
  title: "Take one signed mail event: an email received, or a sent one's delivery",
  about:
    "Resend's POST to the CRM's mail route; no session. The Svix signature over the event's id, timestamp and body is " +
    "checked with RESEND_WEBHOOK_SECRET, the timestamp within five minutes of real time (time.real-elapsed), before the " +
    "body is read: else NOT_AUTHENTICATED and nothing is stored. An `email.received` event: each mailbox on " +
    "CRM_MAIL_DOMAIN it was received for (its `received_for`, which names a BCC'd mailbox that `to` and `cc` do not) " +
    "whose local part is an Organization's handle (its Party's) gets one inbound row " +
    "(`receive`) keyed by the event's email id, so a repeated delivery finds it and changes nothing; that row's process " +
    "reads and threads the email. A mailbox naming no Organization is ignored. An `email.delivered`, `email.bounced` or " +
    "`email.complained` event moves the CRM email whose provider id it names (`deliver`, `bounce`, `mark_spam`); one " +
    "naming a notice's email, or any other, is ignored, as is a kind not followed and a move the email's state has " +
    "passed. A body that does not decode is INVALID_INPUT. Resend gets its answer at once, so it never retries a " +
    "delivery Capxul has stored. Returns how many rows it stored, moved and ignored.",
  concept: concept_contacts,
  kind: "mutation",
  who: "resend: Resend's signed delivery to the CRM's mail route; no session is involved and none is accepted.",
  input: Schema.Struct({ eventId: S, timestamp: S, signature: S, body: S }),
  output: Schema.Struct({ stored: Schema.Int, moved: Schema.Int, ignored: Schema.Int }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [table_inbound_mails, table_communications, table_parties, table_organizations],
  writes: [table_inbound_mails, table_communications],
  drives: [machine_inbound_mail.t.receive, machine_communication.t.deliver, machine_communication.t.bounce, machine_communication.t.mark_spam],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${FRAPPE}/email/receive.py:719`, `${FRAPPE}/email/receive.py:791`],
});
