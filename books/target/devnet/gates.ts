// Devnet's gates area: feature gates scripted for an Organization on this devnet. On staging the gates
// come from PostHog through access' flag sync; on a devnet the PostHog fake answers from devnet's
// scripted gates (./data.ts), so the same sync and the same evaluator serve both, and `dev gates set`
// (./flows.ts) scripts a gate, runs the sync once and reads what now applies (decision
// devnet.scripted-gates).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_devnet } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
} from "../shared/vocabulary.ts";
import { table_feature_flags } from "../access/data.ts";
import { table_org_members } from "../organizations/data.ts";
import { table_scripted_gates } from "./data.ts";

const OLD = "packages/backend/src/access/features";

const S = Schema.String;
const B = Schema.Boolean;

/** The catalogue's ceiling for a gate on a devnet: whether it may be turned on here at all. */
export const Ceiling = Schema.Literals(["on", "off"]);

const MEMBER =
  "devnet only: a signed-in person or agent holding an active Seat in the Organization (organizations' members); " +
  "anyone else is ROLE_PERMISSION_DENIED.";

export const rpc_devnet_gates_script = defineRpc({
  id: "devnet.gates.script",
  title: "Script a feature gate on or off for one Organization",
  about:
    "One transaction. The key must be a catalogue gate that targets an Organization (a person gate, or no gate, is " +
    "INVALID_INPUT naming the gates). Turning on a gate whose devnet ceiling is off is FEATURE_NOT_AVAILABLE and nothing " +
    "is kept. Otherwise it keeps the Organization's row for the gate, replacing an earlier one, with the caller as " +
    "`set_by`, and answers the value kept and the ceiling. What applies is access' flags, which follow at the next " +
    "flag sync; the `dev gates set` flow runs that sync at once.",
  was: [`${OLD}/operations/set.ts:26`, "packages/protocol/src/features/catalog.ts:284", "docs/as-is/archive/operations/devnet.ts:679"],
  concept: concept_devnet,
  kind: "mutation",
  who: MEMBER,
  input: Schema.Struct({ orgId: S, key: S, on: B }),
  output: Schema.Struct({ key: S, orgId: S, on: B, ceiling: Ceiling }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_FEATURE_NOT_AVAILABLE],
  reads: [table_org_members, table_scripted_gates],
  writes: [table_scripted_gates],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_devnet_gates_read = defineRpc({
  id: "devnet.gates.read",
  title: "What one gate is scripted to and what applies now for an Organization",
  about:
    "Reads the Organization's scripted row for the gate (null when none was scripted), the catalogue's devnet ceiling, and " +
    "the value access' one evaluator gives over its feature flags for this Organization now: the value every gated " +
    "concept will see. The key must be a catalogue gate that targets an Organization, else INVALID_INPUT.",
  was: [`${OLD}/rules.ts:84`, `${OLD}/reads.ts:69`],
  concept: concept_devnet,
  kind: "query",
  who: MEMBER,
  input: Schema.Struct({ orgId: S, key: S }),
  output: Schema.Struct({ key: S, orgId: S, on: Schema.NullOr(B), ceiling: Ceiling, effective: B }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_org_members, table_scripted_gates, table_feature_flags],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
