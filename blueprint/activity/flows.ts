// Activity's one Core SDK flow: `client.activity.changes`, the SDK method `activity events` calls.
// It is a flow, not an rpc, because `--wait` waits on the host: it reads, and while nothing has
// changed it waits five seconds and reads again from the same cursor (A4: the CLI calls one SDK
// method). Every other activity command is one rpc, so its SDK method is that rpc and has no flow:
// `activity list` (`client.activity.list`), `activity get` (`client.activity.get`), `activity
// summary` (`client.activity.summary`), `balance` (`client.accounts.read`) and `address`
// (`client.account.profile.depositInstructions`).
//
// The old method was two SDK calls the CLI composed (`activity.changes` for changed Payments and
// `activity.list` for new Movements) with a replay window; the one change log replaces both
// (decision activity.one-method-for-events). The flow serves the CLI and the MCP server alike.

import { Schema } from "effect";
import { budget, defineFlow } from "../../packages/blueprint-engine/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { ChangeEvent, rpc_activity_changes_read } from "./changes.ts";
import { Scope } from "./feed.ts";

const CLI = "apps/cli/src/commands/activity/subcommands/events/execute.ts";

/** How often `wait` reads again, and how long it waits by default before it answers with no events. */
export const POLL_MS = 5_000;
export const DEFAULT_TIMEOUT_SECONDS = 300;

export const flow_client_activity_changes = defineFlow({
  id: "client.activity.changes",
  title: "Follow a feed's changes from a cursor, waiting if asked",
  about:
    "Reads what changed in the feed after `after` (`activity.changes.read`). With no `after` it starts from now: no " +
    "events, and the cursor to follow. With `wait`, while a read answers no events and is not truncated, it waits five " +
    "seconds and reads again from the same cursor, until something changes or `timeoutSeconds` (300 by default) has " +
    "passed, and then answers no events with the cursor it holds. A truncated read answers at once: the rest follows " +
    "from its cursor. The wait is the host's (a `wait.*` span, never system time); every time it answers is the " +
    "backend's. Serves the CLI's `activity events` and the MCP server's tool of the same name.",
  component: component_core_sdk,
  sdk: "client.activity.changes",
  input: Schema.Struct({
    scope: Scope,
    after: Schema.optionalKey(Schema.String),
    wait: Schema.Boolean,
    timeoutSeconds: Schema.optionalKey(Schema.Int),
  }),
  output: Schema.Struct({
    events: Schema.Array(ChangeEvent),
    cursor: Schema.String,
    truncated: Schema.Boolean,
  }),
  steps: [
    { name: "read", rpc: rpc_activity_changes_read, about: "The changes after `after`, or from now with none." },
    {
      name: "wait",
      local: "wait",
      about: "Only with `wait`, after a read with no events that was not truncated: five seconds, or what is left of the timeout.",
    },
    { name: "read-again", rpc: rpc_activity_changes_read, about: "After each wait, the changes after the same cursor; it stops at the first with events." },
  ],
  errors: [],
  calls: [],
  spans: ["sdk.client.activity.changes"],
  budget: { ...budget("read"), excludes: ["wait.*"] },
  was: [`${CLI}:131`, `${CLI}:14`, "packages/sdk/src/activity/methods.ts:1"],
});
