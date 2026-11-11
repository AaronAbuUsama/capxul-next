// Moved out of the built book by the cut, 10 November 2026, from books/target/devnet/data.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { defineTable } from "../../../packages/book/src/index.ts";
import { concept_devnet } from "../shared/foundation.ts";

export const table_whatsapp_numbers = defineTable({
  id: "whatsapp-numbers",
  title: "WhatsApp numbers: each business number the stand-in serves, and its fault switch",
  about:
    `${WHATSAPP} keeps one row per business number it serves: Meta's phone number id, the number shown (E.164), the ` +
    "business account, the Organization it was made for, the access token it accepts and the app secret it signs its " +
    "webhooks with (devnet values, kept as given), the webhook it posts to (Capxul's own route, or a connected head's " +
    "WhatsApp app at `whatsapp.whatsapp.webhook.handler`, whichever the world points it at) and its fault switch. " +
    "`capxul-devnet whatsapp number add <org> [--webhook <url>]` makes one, the next number from +447700900100 up, and " +
    "writes its key file, `<org>-whatsapp.json` in the working directory (number id, business id, token, app secret, " +
    "verify token), in the form a Capxul command or a head's WA Settings reads; `whatsapp number webhook <number> " +
    "<url>` points it at a route after the GET handshake. Each number's account holds Meta's sample template " +
    "`hello_world` (en_US, approved) and every template made through it. The stand-in's address is " +
    "the deployment's WHATSAPP_API_URL, which Frappe's WhatsApp app takes as its `whatsapp_api_url`. `capxul-devnet " +
    "fault whatsapp <mode>` arms the switch: `down` (every call is PROVIDER_ERROR), `refuse` (the next send is refused " +
    "as Meta refuses a number outside its window) or `clear`. " +
    DEVNET_ONLY,
  concept: concept_devnet,
  tenancy: "global",
  fields: Schema.Struct({
    phone_number_id: S,
    display_number: S,
    business_account_id: S,
    org_id: Schema.NullOr(S),
    access_token: S,
    app_secret: S,
    verify_token: S,
    webhook_url: Schema.NullOr(S),
    /** Whether an app subscribed to the business account (`subscribed_apps`); webhooks are posted only once one has. */
    app_subscribed: Schema.Boolean,
    /** The business account's message templates: `hello_world` (en_US) from the start, then each one made, approved at once. */
    templates: Schema.Array(
      Schema.Struct({
        template_id: S,
        name: S,
        language: S,
        category: S,
        status: Schema.Literals(["APPROVED"]),
        components: Schema.Array(Schema.Record(S, Schema.Unknown)),
      }),
    ),
    fault: Schema.Literals(["none", "down", "refuse"]),
    created_at: Instant,
    updated_at: Instant,
  }),
  key: ["phone_number_id"],
  indexes: [{ name: "by_org", fields: ["org_id", "phone_number_id"], for: "`capxul-devnet whatsapp` commands that name an Organization: its numbers." }],
  retention: "Kept for the world's life; `capxul-devnet whatsapp number remove` deletes a number and its messages.",
});

export const table_whatsapp_messages = defineTable({
  id: "whatsapp-messages",
  title: "WhatsApp messages: every message the stand-in carried, either way, on the clock",
  about:
    `${WHATSAPP} keeps every message, so nothing reaches a real phone: one sent to its messages route (text, template, ` +
    "media or interactive, as the Cloud API takes it), answered with its `wamid` and followed at once by its `sent` and " +
    "`delivered` status webhooks; and one received, which `capxul-devnet whatsapp receive <number> --from <E.164> " +
    "[--name <profile name>] <text>` posts to the number's webhook as Meta does, signed with its app secret, the name " +
    "as the webhook's contact profile. `capxul-devnet whatsapp read " +
    "<wamid>` posts a `read` status. Every time is the world's now, and so is each webhook's `timestamp` (the payload " +
    "on now; Meta's signature carries no time). A webhook its route does not answer 200 is kept with its attempts and " +
    "redelivered on the world's clock after 1, 5 and 30 minutes, then every 6 hours for 7 days; the earliest is the " +
    "stand-in's next due. A send an armed fault refuses keeps nothing. Evals read a message's " +
    "text and status here, as they read the mail sink. " +
    DEVNET_ONLY,
  concept: concept_devnet,
  tenancy: "global",
  fields: Schema.Struct({
    /** `wamid.` and a ULID of the instant it was sent or received. */
    wamid: S,
    phone_number_id: S,
    direction: Schema.Literals(["out", "in"]),
    /** The other party's number, E.164. */
    counterpart: S,
    kind: Schema.Literals(["text", "template", "media", "interactive"]),
    /** The message object as the Cloud API carries it. */
    body: Schema.Record(S, Schema.Unknown),
    status: Schema.Literals(["sent", "delivered", "read", "received"]),
    sent_at: Instant,
    status_at: Instant,
    /** This message's webhooks (the message itself, or a status) its route has not yet answered 200, each with its tries and next try. */
    undelivered: Schema.Array(
      Schema.Struct({ webhook: Schema.Literals(["message", "sent", "delivered", "read"]), attempts: Schema.Int, next_at: Instant }),
    ),
  }),
  key: ["wamid"],
  indexes: [
    { name: "by_number_sent_at", fields: ["phone_number_id", "sent_at"], for: "A number's messages, newest first, as an eval or the stand-in's read lists them." },
    {
      name: "by_counterpart",
      fields: ["phone_number_id", "counterpart", "sent_at"],
      for: "One conversation: a number's messages with one counterpart, in order.",
    },
  ],
  retention: "Kept for the world's life; a restore puts back the messages the world had when it was saved.",
});
