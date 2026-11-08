// The installs area: switching a company's equity on (`org equity setup`). The rpc only plans and
// begins: the deployment is a service-key transaction and the Board's batch needs the clones it makes,
// so both belong to the install's durable process (processes.ts). The setup flow follows the install
// live until its batch is proposed, then has the proposing Director sign it.

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_equity } from "../shared/foundation.ts";
import { error_AUTHORISED_EXCEEDED, error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { error_FEATURE_NOT_AVAILABLE, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { table_approvals } from "../approvals/data.ts";
import { machine_equity_install, table_equity_installs, table_equity_writes } from "./data.ts";
import { DIRECTOR, GUARD_WAS, OLD, RESOLVE } from "./guards.ts";
import { InstallView, SetupInput } from "./shapes.ts";
import { Schema } from "effect";

export const rpc_equity_installs_begin = defineRpc({
  id: "equity.installs.begin",
  title: "Plan a company's equity from a template and begin its install",
  about:
    "The caller must be a member and a seated Director now (ROLE_PERMISSION_DENIED), and the company's `equity` gate " +
    "on (FEATURE_NOT_AVAILABLE). The template must be one the command takes (`seed` and `llc` are INVALID_INPUT for " +
    "now). The plan is worked out here, as the template says: its classes with weight, transfer rule and authorised " +
    "amount (`--authorised` for Common), the founders each a member with a personal Safe, named once (INVALID_INPUT), " +
    "their shares, and vesting in calendar months from today (default 48, cliff 12; a cliff longer than the vesting or " +
    "a vesting outside 1 to 119 months is INVALID_INPUT; a template's no-vesting founders are issued outright), the pool " +
    "and the class it grants from, and the Governor's settings (1 day delay, 7 days open, 50% quorum, 1% threshold). " +
    "Founders plus pool over the class's authorised amount is AUTHORISED_EXCEEDED. All of this is refused before " +
    "anything is deployed. A live install for the company answers when its terms are the same (`terms_digest`) and is " +
    "WRONG_STATE otherwise: already installed, its batch waiting for the Directors with other terms, or its deployment " +
    "not yet resolved. Else, in one transaction, the install is born `deploying` (equity-install.begin) with its plan, " +
    "which starts its process. It answers the install as planned.",
  was: [`${OLD}/equity/operations/setup.ts`, `${OLD}/equity/rules/cap-table.ts`, "packages/protocol/src/organizations/equity-templates.ts:11", ...GUARD_WAS],
  concept: concept_equity,
  kind: "mutation",
  who: "A Director of the company: a member whose own Safe owns the company Safe and wears the Director hat now.",
  input: SetupInput,
  output: InstallView,
  errors: [
    error_NOT_AUTHENTICATED,
    error_FEATURE_NOT_AVAILABLE,
    error_WRONG_STATE,
    error_INVALID_INPUT,
    error_ROLE_PERMISSION_DENIED,
    error_AUTHORISED_EXCEEDED,
  ],
  reads: [...DIRECTOR, ...RESOLVE],
  writes: [table_equity_installs],
  drives: [machine_equity_install.t.begin],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_equity_installs_watch = defineRpc({
  id: "equity.installs.watch",
  title: "Follow a company's install until its batch is proposed and decided",
  about:
    "A live query over the company's live install (or one by id) and its batch's write: it pushes each change, from " +
    "`deploying` to `proposed` (with the Board's proposal, the proposing Director's approval and its link, and the " +
    "clones indexing's chain-deployments names) to `installed`, `failed` or `abandoned`. The setup flow subscribes to it " +
    "twice: until the batch is proposed, to sign; then until it is decided. A member who is not a Director may read it.",
  was: [`${OLD}/equity/operations/load.ts`, `${OLD}/equity/views.ts`],
  concept: concept_equity,
  kind: "live",
  who: "A member of the company.",
  input: Schema.Struct({ orgId: Schema.String, installId: Schema.optionalKey(Schema.String) }),
  output: InstallView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [...DIRECTOR, table_equity_writes, table_approvals],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("live-read"),
});
