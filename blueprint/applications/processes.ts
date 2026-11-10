// Applications' durable processes (A3, P3): one, a rotated key's grace window.
//
// A key is otherwise a row that changes only inside an rpc. The one thing about it that waits is a
// grace window: a date after which the old key must stop. Every write to a status is a named
// transition (P7), so the end of the window is the `expire` transition, driven by the key's own
// timer, not derived at read time as before (decision applications.grace-process). The bootstrap also
// refuses a grace key past `grace_ends_at`, so a late timer never lengthens a window. No sweep: the
// old system had none either, and each window is its own timer.

import { budget, defineWorkflow } from "../../packages/blueprint-engine/src/index.ts";
import { concept_applications } from "../shared/foundation.ts";
import { machine_app_key, table_publishable_keys } from "./data.ts";
import { rpc_applications_keys_revoke } from "./keys.ts";

const DAY = 86_400_000;

export const workflow_applications_keys_grace = defineWorkflow({
  id: "applications.keys.grace",
  title: "A rotated key's grace window, until it ends",
  about:
    "Started by `rotate`, one instance per rotated key. It waits until `grace_ends_at` (at most 30 days), then drives " +
    "`expire` if the key is still in grace, so the key stops resolving and `app_key_transitioned` records it. A revoke " +
    "during the window signals it, and it ends without expiring the key, which is already revoked. Nothing waits on it: " +
    "the rotate rpc answered long before.",
  was: ["docs/as-is/archive/applications/data.ts:201", "packages/backend/src/applications/keys/rules.ts:41"],
  concept: concept_applications,
  priority: "normal",
  trigger: { transition: machine_app_key.t.rotate },
  instance: { per: table_publishable_keys },
  signals: [rpc_applications_keys_revoke],
  waits: [
    { name: "window", for: "timer", timeoutMs: 30 * DAY, about: "Until the key's `grace_ends_at`." },
    {
      name: "revoked",
      for: "signal",
      key: [{ on: [rpc_applications_keys_revoke], props: ["keyId"] }],
      about: "The owner revoked the key during its window (applications.keys.revoke).",
    },
  ],
  steps: [
    { name: "wait", about: "Waits for the window to end or for a revoke, whichever comes first." },
    { name: "expire", about: "When the window ended: drives `expire` on the key if its status is still `grace`; otherwise does nothing." },
  ],
  reads: [table_publishable_keys],
  writes: [table_publishable_keys],
  drives: [machine_app_key.t.expire],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "The key id: one instance per rotated key, and `expire` writes only while the key's status is `grace`.",
  timeoutMs: 31 * DAY,
  retries: { max: 10, backoff: "exponential" },
  budget: budget("background"),
});
