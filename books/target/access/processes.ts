// Access' durable work (A2, A3, P3): one process per assistant grant, which owns its clock, and two
// of P3's surviving crons: the feature-flag sync every minute and the daily sweep (the old daily
// client-grant sweep, now over sessions, codes and ended grants).

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_access } from "../shared/foundation.ts";
import { integration_posthog } from "../shared/external.ts";
import { rpc_access_assistants_revoke, rpc_access_assistants_token } from "./assistants.ts";
import {
  machine_assistant_grant,
  machine_session,
  table_assistant_grants,
  table_feature_flags,
  table_sessions,
  table_sign_in_codes,
} from "./data.ts";

const OLD = "packages/backend/src";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const workflow_access_assistants_grant = defineWorkflow({
  id: "access.assistants.grant",
  title: "One assistant grant, from consent until it ends",
  about:
    "Started by the consent that births the grant, one instance per grant. It waits for the client to exchange its code " +
    "(10 minutes) and expires the grant if it never does. Once active it waits on the refresh window: each refresh " +
    "(a signal from the token route) starts the 30-day wait again, never past 90 days from consent, and when a wait runs " +
    "out it expires the grant. A revocation (the revocation route, or the token route seeing a spent refresh token " +
    "reused) ends it. The timers replace the old daily sweep of expired OAuth and native client grants (P3).",
  was: [`${OLD}/platform/jobs.ts:69`, "books/as-is/access/clients.ts:532", "books/as-is/access/data.ts:584"],
  concept: concept_access,
  priority: "normal",
  trigger: { transition: machine_assistant_grant.t.consent },
  instance: { per: table_assistant_grants },
  signals: [rpc_access_assistants_token, rpc_access_assistants_revoke],
  waits: [
    {
      name: "code",
      for: "signal",
      timeoutMs: 10 * MINUTE,
      key: [{ on: [rpc_access_assistants_token], props: ["code"] }],
      about: "The client's code exchange at the token route, within 10 minutes of consent.",
    },
    { name: "renewal", for: "timer", timeoutMs: 30 * DAY, about: "The refresh window: 30 days from the last refresh, cut short at 90 days from consent." },
  ],
  steps: [
    { name: "await-exchange", about: "Waits for the exchange signal; on the timeout, expires the pending grant." },
    { name: "await-renewal", about: "Waits on the refresh window; a refresh signal starts it again, a revoke signal ends the process." },
    { name: "expire", about: "Expires the grant when the window runs out, unless it has already ended." },
  ],
  reads: [table_assistant_grants],
  writes: [table_assistant_grants],
  drives: [machine_assistant_grant.t.expire],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "One instance per grant_id; expire drives nothing on a grant that has already ended.",
  timeoutMs: 91 * DAY,
  retries: { max: 3, backoff: "exponential" },
  budget: budget("background"),
});

export const workflow_access_sessions_sweep = defineWorkflow({
  id: "access.sessions.sweep",
  title: "The daily sweep: expire sessions, clear spent sign-in state",
  about:
    "Once a day: expires every active session past its `expires_at`, so its end is a recorded transition with its " +
    "event; deletes sessions and assistant grants 30 days after they ended, and sign-in codes that expired unused. " +
    "Sessions are short-lived rows with no process of their own, so a calendar sweep, not a timer per row, is the right " +
    "shape (P3 keeps the daily client-grant sweep; native client grants are gone, decision access.no-device-flow).",
  was: [`${OLD}/platform/jobs.ts:64`, `${OLD}/access/clients/writes/sweep.ts:19`, "books/as-is/access/clients.ts:532"],
  concept: concept_access,
  priority: "low",
  trigger: { cron: "17 3 * * *" },
  instance: "singleton",
  steps: [
    { name: "expire-sessions", about: "Active sessions past expires_at become expired, in batches of 500." },
    { name: "delete-ended", about: "Deletes sessions and assistant grants that ended more than 30 days ago." },
    { name: "delete-codes", about: "Deletes sign-in codes past their expiry." },
  ],
  reads: [table_sessions, table_assistant_grants, table_sign_in_codes],
  writes: [table_sessions, table_assistant_grants, table_sign_in_codes],
  drives: [machine_session.t.expire],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "Every step selects by state and time, so a second run the same day finds nothing to do.",
  timeoutMs: 10 * MINUTE,
  retries: { max: 3, backoff: "exponential" },
  budget: budget("background"),
});

export const workflow_access_gates_sync = defineWorkflow({
  id: "access.gates.sync",
  title: "Sync the feature flags from PostHog every minute",
  about:
    "Reads PostHog's flag definitions through the connector gateway and keeps the catalogue's gates only (a PostHog flag " +
    "the catalogue does not name is ignored). In one transaction it writes each gate's definition, stamps every row's " +
    "`checked_at`, and deletes a gate PostHog no longer has. A failed read writes nothing, so the copy stays as it was and " +
    "money gates close once it is 10 minutes old. On a devnet the PostHog fake answers from devnet's gate table, so " +
    "`dev gates set` lands within a minute or at `dev jobs run`.",
  was: [`${OLD}/platform/jobs.ts:77`, `${OLD}/access/features/operations/sync.ts:1`, `${OLD}/access/features/rules.ts:84`],
  concept: concept_access,
  priority: "normal",
  trigger: { cron: "* * * * *" },
  instance: "singleton",
  steps: [
    { name: "read", about: "PostHog's flag list (posthog.flags)." },
    { name: "plan", about: "Decodes each catalogue flag; a rule the evaluator cannot read is kept as unsupported." },
    { name: "write", about: "One transaction: upsert the gates, stamp checked_at, delete the ones PostHog dropped." },
  ],
  reads: [table_feature_flags],
  writes: [table_feature_flags],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_posthog.c.flags],
  chain: [],
  idempotency: "The same definitions write the same rows; only checked_at moves.",
  timeoutMs: MINUTE,
  retries: { max: 0, backoff: "none" },
  budget: budget("background"),
});
