// Notices' durable processes: the retry process of each notice whose first attempt failed (one
// instance per notices row, A3), and the daily agreement notices, one of the crons P3 keeps
// (calendar work with no single transition). The outbox workflows that make each notice's first
// attempt are in the area files, one per transition they follow.

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { table_principals } from "../access/data.ts";
import { table_organizations } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_agreements } from "../payroll/data.ts";
import { concept_notices } from "../shared/foundation.ts";
import { contract_agreements, contract_erc20, contract_safe, integration_chain_rpc, integration_mail } from "../shared/external.ts";
import { machine_balance_alert, machine_notice, table_balance_alerts, table_notices } from "./data.ts";
import { DIRECTORS, SEND_STEPS } from "./kit.ts";

const OLD = "packages/backend/src";
const MAIL = `${OLD}/integrations/mail`;
const AG = `${OLD}/payroll/agreements`;

const n = machine_notice.t;
const a = machine_balance_alert.t;

export const workflow_notices_delivery_retry = defineWorkflow({
  id: "notices.delivery.retry",
  title: "Try a held notice again, a minute and then four minutes later",
  about:
    "Started by `hold`, one instance per notices row: the first attempt failed with PROVIDER_ERROR or RATE_LIMITED. It " +
    "waits until `next_attempt_at` (a minute), renders the same message from the row's facts and sends it again under " +
    "the same provider idempotency key: taken is `deliver`; a retryable failure is `defer`, with the last attempt four " +
    "minutes later; that one failing, or the address refused (INVALID_INPUT) on any retry, is `fail`. Three attempts in " +
    "all, as before; the mail call itself never retries (integrations.timeouts). A notice reports a change that already " +
    "committed, so nothing here touches the source concept. On a devnet, `dev mail fail` makes the sink refuse the next " +
    "sends as a provider failure, so `dev mail notices` shows the notice retrying, then sent or failed; `dev jobs run` " +
    "runs a due wait now.",
  concept: concept_notices,
  priority: "normal",
  trigger: { transition: n.hold },
  instance: { per: table_notices },
  waits: [
    {
      name: "backoff",
      for: "timer",
      timeoutMs: 240_000,
      about: "Until `next_attempt_at`: one minute after the first attempt, four after the second (60 s × 4^attempt, as before).",
    },
  ],
  steps: [
    { name: "load", about: "Reads the notice; one that is no longer `retrying`, or whose attempts moved, ends the instance." },
    { name: "backoff", about: "Waits for `next_attempt_at`." },
    { name: "send", about: "Renders the template from `facts` and calls `mail.send` with the notice's provider idempotency key." },
    {
      name: "record",
      about: "`deliver` with the mail id, `defer` with the error and the next time, or `fail` with the error; `attempts` counts up.",
    },
  ],
  reads: [table_notices],
  writes: [table_notices],
  drives: [n.deliver, n.defer, n.fail],
  invokes: [],
  emits: [],
  calls: [integration_mail.c.send],
  chain: [],
  idempotency:
    "`notice:<recipient>:<notice id>` for the instance; each record is guarded by the attempts count it was scheduled " +
    "at, and the provider takes a repeated send under the same idempotency key once.",
  timeoutMs: 900_000,
  retries: { max: 3, backoff: "exponential" },
  compensation: "None: a notice that cannot be sent ends `failed` with its last error, and its change stands.",
  budget: budget("background"),
  was: [`${MAIL}/notices.ts:17`, `${MAIL}/notices.ts:150`, `${MAIL}/README.md:30`, `${OLD}/operator/notices/operations/record.ts:13`],
});

export const workflow_notices_payroll_daily = defineWorkflow({
  id: "notices.payroll.daily",
  title: "The daily agreement notices: pay ready, a term's last week, a short Safe",
  about:
    "Once a day at 00:15 UTC, one of the crons P3 keeps: what agreements have due by the calendar has no single " +
    "transition. For every running agreement (active, paused or ending) it reads Agreements now and sends, each once: " +
    "`pay-ready` to the payee of a weekly or monthly release that is not paused and has pay to collect, once per release " +
    "period; `agreement-ending` to the payee of a fixed term in its last seven days, once. Per Organization and token it " +
    "compares the company Safe's balance with what its payees can collect now: short raises the token's balance alert " +
    "(or raises it again) and sends `low-balance-alert` to the Directors once per episode; covered, or nothing owed, " +
    "clears a raised alert. An ended agreement is not swept: its end is payroll's `finish`, which sends its own notice, " +
    `and a lapsed offer is the process's timer too. ${DIRECTORS}`,
  concept: concept_notices,
  priority: "normal",
  trigger: { cron: "15 0 * * *" },
  instance: "singleton",
  steps: [
    { name: "agreements", about: "Every running agreement, Organization by Organization (payroll's agreements by status)." },
    {
      name: "chain",
      about:
        "Each agreement's state and what its payee can collect now (`agreementOf`, `availableOf`), and each paying Safe's " +
        "balance per token (`balanceOf`), through chain-rpc.",
    },
    { name: "pay-ready", about: "A weekly or monthly release, not paused, with pay available: notice id `pay-ready:<agreement>:<period>`." },
    { name: "ending-soon", about: "A fixed term within seven days of its end: notice id `agreement-ending:<agreement>:last-week`." },
    {
      name: "balances",
      about:
        "Per Organization and token, the Safe's balance against the sum payees can collect: `raise` or `raise_again` and " +
        "`low-balance-alert:<org>:<token>:<episode>` to the Directors when short; `clear` a raised alert when covered.",
    },
    ...SEND_STEPS,
  ],
  reads: [table_agreements, table_organizations, table_parties, table_principals, table_notices, table_balance_alerts],
  writes: [table_notices, table_balance_alerts],
  drives: [n.send, n.hold, n.refuse, a.raise, a.clear, a.raise_again],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.readContract, integration_mail.c.send],
  chain: [contract_agreements.f.agreementOf, contract_agreements.f.availableOf, contract_erc20.f.balanceOf, contract_safe.f.getOwners],
  idempotency:
    "Each notice id names its agreement and period, or its Organization, token and episode, so a second run the same " +
    "day, a devnet clock warp or a resume after a crash finds every row and sends nothing again; an alert moves only " +
    "from the state it was read in.",
  timeoutMs: 1_800_000,
  retries: { max: 3, backoff: "exponential" },
  budget: {
    ...budget("background"),
    p50Ms: 10_000,
    p95Ms: 120_000,
    why: "reads every running agreement and each paying Safe's balance on chain, Organization by Organization, once a day",
  },
  was: [`${AG}/operations/sweep.ts:44`, `${AG}/rules/sweeps.ts:44`, `${AG}/writes/sweeps.ts:22`, `${OLD}/platform/jobs.ts:155`],
});
