// The agents concept's Core SDK flows (A4: the SDK owns every flow and all signing; the CLI calls
// one SDK method per command). Each change of an agent is one flow: prepare (one agents rpc, which
// births the change and its carrier in one transaction), then the signature, then the follow.
//
// - A person-owned change is the owner's approval. When the session signs with its own key on this
//   machine, the flow signs the approval's digest at once (`approvals.signing.get` until it is
//   sponsored, then `approvals.signing.sign`); a person signs on the approval page, whose link the
//   flow hands over (the CLI opens it in a browser at a terminal).
// - An Organization-owned change is a Board proposal. `board.propose` opens the proposing
//   Director's own approval of it (their approveHash, or the execution when the Board needs one
//   signature), which the flow signs or hands over like any approval; the other Directors approve
//   in board's own commands.
// - Without `noWait` the flow follows the change live (`agents.changes.get`) until it lands or
//   fails; with it, it returns at the hand-over. Aborting the follow is CANCELLED and leaves the
//   change waiting as it was.
//
// `agent create` and `agent key rotate` also make the key: on this machine, never sent; only its
// address leaves. `agent list` and `agent show` are one rpc each and need no flow.

import { Schema } from "effect";
import { budget, defineFlow } from "../../packages/blueprint-engine/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import {
  error_CANCELLED,
  error_INVALID_INPUT,
  error_ROLE_PERMISSION_DENIED,
  error_TRANSACTION_FAILED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { rpc_approvals_signing_get, rpc_approvals_signing_sign } from "../approvals/signing.ts";
import { LocalKeyStore as KeyStore } from "./data.ts";
import {
  rpc_agents_changes_create,
  rpc_agents_changes_freeze,
  rpc_agents_changes_get,
  rpc_agents_changes_remove,
  rpc_agents_changes_rotate,
  rpc_agents_changes_sweep,
  rpc_agents_changes_unfreeze,
} from "./changes.ts";
import { AgentRef, CreateJson, RemoveJson, RotateJson, StateJson, SweepJson } from "./shapes.ts";

const SDK = "packages/sdk/src/accounts";
const CLI = "apps/cli/src/commands/agent";
const S = Schema.String;
const NullOr = Schema.NullOr;
const B = Schema.Boolean;

// ── the steps every change shares after it is prepared ──────────────────────────────────────

const SIGN_AND_FOLLOW = [
  {
    name: "approval",
    rpc: rpc_approvals_signing_get,
    about: "The owner's approval, or the proposing Director's approval of the Board proposal, live, until sponsored (`pending` with its digest) or ended.",
  },
  {
    name: "own-key",
    local: "sign" as const,
    about: "When the session signs with its own key on this machine, that key signs the approval's digest at once, with no prefix.",
  },
  {
    name: "submit",
    rpc: rpc_approvals_signing_sign,
    about: "Gives that signature to approvals, whose process sends it; a person signs on the approval page instead.",
  },
  {
    name: "hand-over",
    local: "wait" as const,
    about: "A person approves on the approval page (its link is handed over); a Board proposal waits for the Directors. With `noWait` the flow returns here.",
  },
  {
    name: "follow",
    rpc: rpc_agents_changes_get,
    about: "The change and its agent, live, until the change lands or fails; aborting it is CANCELLED and leaves the change waiting.",
  },
  {
    name: "until-landed",
    local: "wait" as const,
    about: "The chain and the process: the carrier's transaction lands and is indexed, and the change settles on that proof.",
  },
];

/** What a followed change ends with, beyond its rpcs' refusals: a decline or rejection, a lapse, a revert or a mismatch. */
const FOLLOW_ERRORS = [error_CANCELLED, error_WRONG_STATE, error_TRANSACTION_FAILED, error_ROLE_PERMISSION_DENIED];

const FOLLOW =
  "Then the signature: a person-owned change is the owner's approval; an Organization-owned change is a Board proposal, " +
  "whose proposing Director's own approval comes with it and the other Directors approve in board's commands. The " +
  "approval is signed at once by a key on this machine when the session has one, else on the approval page, whose " +
  "link the flow hands over. Without `noWait` it follows the change live until it lands, or fails with its code " +
  "(a decline or rejection CANCELLED, a lapse WRONG_STATE, a revert or a landing without its event TRANSACTION_FAILED, " +
  "a refusal its own code); aborting the follow is CANCELLED and the change keeps waiting.";

const NoWait = { noWait: B };

// ── create ──────────────────────────────────────────────────────────────────────────────────

export const flow_client_me_agents_create = defineFlow({
  id: "client.me.agents.create",
  title: "Create an agent: make its key here, open its create, follow it",
  about:
    "`agent create`. It makes the agent's key on this machine and keeps it before anything is prepared: `file` in a " +
    "private file beside the CLI session, `env` returned once for `CAPXUL_PRIVATE_KEY` on the machine the agent runs on; " +
    "the key is never sent, only its address. It prepares the create (`agents.changes.create`, with `org` an " +
    "Organization-owned agent through a Board proposal) and checks the answer names this key, this name and the handle " +
    "asked, else INVALID_INPUT and nothing is signed. " + FOLLOW + " A create that lands is `active` and its handle names it.",
  component: component_core_sdk,
  sdk: "client.me.agents.create",
  input: Schema.Struct({ name: S, handle: NullOr(S), key: KeyStore, org: NullOr(S), ...NoWait }),
  output: CreateJson,
  steps: [
    { name: "key", local: "build", about: "Makes the agent's key on this machine; only its address leaves it." },
    { name: "keep", local: "cache", about: "`file`: writes the key to a private file beside the session first; `env`: holds it to return once." },
    { name: "prepare", rpc: rpc_agents_changes_create, about: "The agent, its Party, its create change and its carrier, in one transaction." },
    { name: "check", local: "build", about: "The answer must name this key, this name and the handle asked; else INVALID_INPUT and nothing is signed." },
    ...SIGN_AND_FOLLOW,
  ],
  errors: [error_INVALID_INPUT, ...FOLLOW_ERRORS],
  calls: [],
  spans: [],
  budget: budget("chain-submit"),
  was: [`${SDK}/agents.ts:1`, `${CLI}/subcommands/create/execute.ts:1`, `${CLI}/internal/key.ts:1`, "apps/cli/src/auth/own-key.ts:195"],
});

// ── freeze and unfreeze ─────────────────────────────────────────────────────────────────────

export const flow_client_me_agents_freeze = defineFlow({
  id: "client.me.agents.freeze",
  title: "Freeze an agent and follow it until it reads as frozen",
  about: "`agent freeze`. It prepares the freeze (`agents.changes.freeze`). " + FOLLOW + " A freeze that lands reads `frozen`.",
  component: component_core_sdk,
  sdk: "client.me.agents.freeze",
  input: Schema.Struct({ agent: AgentRef, ...NoWait }),
  output: StateJson,
  steps: [
    { name: "prepare", rpc: rpc_agents_changes_freeze, about: "The freeze change and its carrier, in one transaction." },
    ...SIGN_AND_FOLLOW,
  ],
  errors: FOLLOW_ERRORS,
  calls: [],
  spans: [],
  budget: budget("chain-submit"),
  was: [`${SDK}/agents.ts:1`, `${CLI}/subcommands/freeze`, `${CLI}/internal/change.ts:1`],
});

export const flow_client_me_agents_unfreeze = defineFlow({
  id: "client.me.agents.unfreeze",
  title: "Unfreeze an agent and follow it until it reads as active",
  about: "`agent unfreeze`. It prepares the unfreeze (`agents.changes.unfreeze`). " + FOLLOW + " An unfreeze that lands reads `active`.",
  component: component_core_sdk,
  sdk: "client.me.agents.unfreeze",
  input: Schema.Struct({ agent: AgentRef, ...NoWait }),
  output: StateJson,
  steps: [
    { name: "prepare", rpc: rpc_agents_changes_unfreeze, about: "The unfreeze change and its carrier, in one transaction." },
    ...SIGN_AND_FOLLOW,
  ],
  errors: FOLLOW_ERRORS,
  calls: [],
  spans: [],
  budget: budget("chain-submit"),
  was: [`${SDK}/agents.ts:1`, `${CLI}/subcommands/unfreeze`, `${CLI}/internal/change.ts:1`],
});

// ── rotate ──────────────────────────────────────────────────────────────────────────────────

export const flow_client_me_agents_rotate_key = defineFlow({
  id: "client.me.agents.rotate-key",
  title: "Give an agent a new key: make it here, open the rotation, follow it",
  about:
    "`agent key rotate`. It makes the new key on this machine and keeps it as the agent's waiting key (`file`: beside " +
    "the key in use, replacing an earlier waiting key rather than nesting one; `env`: returned once); the key is never " +
    "sent, only its address. It prepares the rotation (`agents.changes.rotate`) and checks the answer retires the " +
    "agent's key now and names this new key, else INVALID_INPUT and nothing is signed; both keys are shown before the " +
    "owner approves. " + FOLLOW + " Once the rotation lands the new key is the agent's key and the old one is dropped; " +
    "a rotation that fails drops the waiting key and keeps the old one in use.",
  component: component_core_sdk,
  sdk: "client.me.agents.rotateKey",
  input: Schema.Struct({ agent: AgentRef, key: KeyStore, ...NoWait }),
  output: RotateJson,
  steps: [
    { name: "key", local: "build", about: "Makes the new key on this machine; only its address leaves it." },
    { name: "keep-waiting", local: "cache", about: "`file`: keeps it as the waiting key beside the key in use, replacing an earlier waiting key; `env`: holds it to return once." },
    { name: "prepare", rpc: rpc_agents_changes_rotate, about: "The rotation change and its carrier, in one transaction." },
    { name: "check", local: "build", about: "The answer must retire the agent's key now and name this new key; else INVALID_INPUT and nothing is signed." },
    ...SIGN_AND_FOLLOW,
    { name: "promote", local: "cache", about: "Landed: the waiting key becomes the key in use. Failed: the waiting key is dropped and the old one stays." },
  ],
  errors: [error_INVALID_INPUT, ...FOLLOW_ERRORS],
  calls: [],
  spans: [],
  budget: budget("chain-submit"),
  was: [`${SDK}/agent-keys.ts:1`, `${CLI}/internal/rotate.ts:1`, `${CLI}/internal/key.ts:1`],
});

// ── sweep and remove ────────────────────────────────────────────────────────────────────────

export const flow_client_me_agents_sweep = defineFlow({
  id: "client.me.agents.sweep",
  title: "Sweep an agent's Safe and follow it until it lands",
  about:
    "`agent sweep`. It prepares the sweep (`agents.changes.sweep`): the selected assets with each balance at " +
    "preparation, and the recipient resolved to its Safe before anything is signed. " + FOLLOW + " Once it lands it " +
    "reports each asset separately with the actual amount each AgentSwept moved, zero for one emptied before execution.",
  component: component_core_sdk,
  sdk: "client.me.agents.sweep",
  input: Schema.Struct({ agent: AgentRef, to: NullOr(S), asset: NullOr(S), ...NoWait }),
  output: SweepJson,
  steps: [
    { name: "prepare", rpc: rpc_agents_changes_sweep, about: "The sweep change, its assets and recipient, and its carrier, in one transaction." },
    ...SIGN_AND_FOLLOW,
  ],
  errors: FOLLOW_ERRORS,
  calls: [],
  spans: [],
  budget: budget("chain-submit"),
  was: [`${SDK}/agent-changes.ts:1`, `${CLI}/internal/sweep.ts:1`, `${CLI}/internal/presentation.ts:1`],
});

export const flow_client_me_agents_remove = defineFlow({
  id: "client.me.agents.remove",
  title: "Remove an agent for good and follow it until it reads as removed",
  about:
    "`agent remove`. There is no undo, so it asks first: at a terminal the CLI prompts, and a script must pass " +
    "`confirmed` (the CLI's `--confirm`). It prepares the removal (`agents.changes.remove`), which names what the Safe " +
    "holds and the Seats it holds. " + FOLLOW + " Once it lands the agent reads `removed`, with what each AgentSwept " +
    "moved to the owner's Safe and the number of Seats organizations ends.",
  component: component_core_sdk,
  sdk: "client.me.agents.remove",
  input: Schema.Struct({ agent: AgentRef, confirmed: B, ...NoWait }),
  output: RemoveJson,
  steps: [
    { name: "confirm", local: "prompt", about: "A terminal asks before it removes; without one, `confirmed` must be given." },
    { name: "prepare", rpc: rpc_agents_changes_remove, about: "The removal change, every settlement asset and its carrier, in one transaction." },
    ...SIGN_AND_FOLLOW,
  ],
  errors: FOLLOW_ERRORS,
  calls: [],
  spans: [],
  budget: budget("chain-submit"),
  was: [`${SDK}/agent-changes.ts:1`, `${CLI}/internal/remove.ts:1`],
});
