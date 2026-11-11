// What is asked of the Payment's events: how many settle, and which are held too long (a money path, so its alert is
// fixed before code; record-kinds spec section 10). The judgment is the decision at the end of this file.

import { defineAlert, defineDecision, defineInsight } from "../../packages/blueprint-engine/src/index.ts";
import { event_payment_transitioned } from "./data.ts";

const LIVE = ["shared-world", "staging", "production"];

export const insight_payments_settled = defineInsight({
  id: "payments_settled",
  title: "Payments settled, by day",
  about: "Payments that reached settled, each day, from the Payment's own transition event.",
  reads: [event_payment_transitioned],
  query:
    "select toDate(timestamp) as day, count() as settled from events where event = 'payment_transitioned' " +
    "and properties.to = 'settled' and properties.capxul_env = '<env>' group by day order by day",
  display: "line",
  env: LIVE,
  answer: "On the thin-line world: 1 payment settled (step 6, 125.50 to the supplier).",
});

export const insight_payments_held = defineInsight({
  id: "payments_held",
  title: "Payments submitted but not settled after 30 minutes",
  about: "Payments whose last transition is to submitted or needs_retry, more than 30 minutes ago: money a person thinks is moving and is not.",
  reads: [event_payment_transitioned],
  query:
    "select properties.payment_id as payment, argMax(properties.to, timestamp) as state, max(timestamp) as since " +
    "from events where event = 'payment_transitioned' and properties.capxul_env = '<env>' group by payment " +
    "having state in ('submitted', 'needs_retry') and since < now() - interval 30 minute",
  display: "table",
  env: LIVE,
  answer: "On the thin-line world: no rows.",
});

export const alert_payment_held = defineAlert({
  id: "payment_held",
  title: "A payment is held without settling",
  about: "Fires for any payment submitted or waiting to retry for more than 30 minutes.",
  insight: insight_payments_held,
  condition: "1 row or more, evaluated every 10 minutes",
  cadence: "10m",
  severity: "page",
  route: ["operator", "director"],
  runbook:
    "Read the payment's trace: its UserOperation, the bundler's answer and the chain receipt. If the chain settled it, " +
    "the indexer is behind; if the bundler refused it, the retry process decides; never send it a second time by hand.",
  silence: ["a world being restored from a snapshot", "a world whose clock is frozen"],
});

export const decision_payments_watch = defineDecision({
  id: "payments.watch",
  title: "A payment held 30 minutes pages the operator and tells the Director",
  question: "When is a payment that has not settled someone's problem?",
  options: [
    { label: "30-minutes", text: "Submitted or needs_retry for 30 minutes pages the operator and notifies the company's Director." },
    { label: "operator-only", text: "Tell only Capxul's operator." },
  ],
  chosen: "30-minutes",
  why:
    "A held payment is money the company believes has left. The Director signed for it and must know it has not " +
    "arrived; the operator can see why. 30 minutes is far above a normal settle on chain and below a working day, so it " +
    "is a fault, not a slow block. A frozen-clock world is silenced because nothing moves there by design.",
  source: "Aaron, 18:49 and 18:53 UTC 11 November 2026 (money-path alerts are fixed before code)",
  affects: [alert_payment_held, insight_payments_settled],
});
