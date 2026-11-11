// Banking's inbox area: Bridge's signed webhook deliveries. Each event is stored once, encrypted,
// and applied to what it names in the same transaction; the catch-up (./processes.ts) reads any
// event the webhook missed and applies again those that could not be applied yet.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_banking } from "../shared/foundation.ts";
import { error_NOT_AUTHENTICATED } from "../shared/vocabulary.ts";
import {
  machine_bank_account,
  machine_bank_deposit,
  machine_bank_details,
  machine_bridge_event,
  machine_verification,
  table_bank_accounts,
  table_bank_deposits,
  table_bank_details,
  table_bank_payouts,
  table_bridge_events,
  table_verifications,
} from "./data.ts";

const W = "packages/backend/src/banking/webhooks";

/** What applying one Bridge event can change, shared by the webhook route and the catch-up. */
export const APPLY = {
  reads: [table_bridge_events, table_verifications, table_bank_details, table_bank_deposits, table_bank_accounts, table_bank_payouts],
  writes: [table_bridge_events, table_verifications, table_bank_details, table_bank_deposits, table_bank_accounts],
  drives: [
    machine_bridge_event.t.store,
    machine_bridge_event.t.apply,
    machine_bridge_event.t.ignore,
    machine_bridge_event.t.refuse,
    machine_verification.t.ask,
    machine_verification.t.hand_to_person,
    machine_verification.t.submit,
    machine_verification.t.approve,
    machine_verification.t.reject,
    machine_verification.t.restrict,
    machine_bank_details.t.activate,
    machine_bank_details.t.deactivate,
    machine_bank_details.t.close,
    machine_bank_deposit.t.receive,
    machine_bank_deposit.t.mark_arriving,
    machine_bank_deposit.t.mark_below_minimum,
    machine_bank_deposit.t.mark_returned,
    machine_bank_account.t.deactivate,
    machine_bank_account.t.reactivate,
  ],
} as const;

export const rpc_banking_inbox_receive = defineRpc({
  id: "banking.inbox.receive",
  title: "Take one signed Bridge webhook event and apply it",
  about:
    "Bridge's POST to the webhook route. The signature is checked against BRIDGE_WEBHOOK_PUBLIC_KEY before the body is " +
    "read (NOT_AUTHENTICATED, nothing stored). One transaction stores the event by its id, encrypted (a repeat changes " +
    "nothing), and applies it: a customer event to its verification (signalling the verification's process while it " +
    "runs, applied here once it has ended); a virtual account event to its bank details; a deposit event to its deposit " +
    "(born on the first, moved forward only by a newer one); an external account event to its saved account (a removed " +
    "one stays removed); a transfer event to its payout's process, as a signal (the process owns the payout's machine). " +
    "An event whose object Capxul does not hold yet stays pending for the catch-up; a kind Capxul does not follow is " +
    "ignored; a body that does not decode is refused with its field. Bridge always gets its answer quickly, so it never " +
    "retries a delivery Capxul has stored.",
  concept: concept_banking,
  kind: "mutation",
  who: "bridge: Bridge's signed delivery to the webhook route; no session is involved and none is accepted.",
  input: Schema.Struct({ body: Schema.String, signature: Schema.String, timestamp: Schema.String }),
  output: Schema.Struct({ eventId: Schema.String, status: Schema.Literals(["pending", "applied", "ignored", "refused"]) }),
  errors: [error_NOT_AUTHENTICATED],
  reads: [...APPLY.reads],
  writes: [...APPLY.writes],
  drives: [...APPLY.drives],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${W}/operations/receive.ts:1`, `${W}/operations/insert.ts:1`, `${W}/operations/process.ts:1`, "packages/backend/convex/http.ts:32"],
});
