// Seven frozen devnet operations remain; time and snapshots are reached by world commands.
import { Schema } from "effect";
import { budget, defineOperation, type ErrorRecord } from "../../../packages/book/src/index.ts";
import { frozen, frozenRefusals, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CANCELLED,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_WORK_DIED,
  error_WRONG_ENVIRONMENT,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  flow_devnet_approve,
  flow_devnet_gates_set,
  flow_devnet_prices_set,
} from "./flows.ts";
import { rpc_devnet_jobs_run } from "./jobs.ts";
import { rpc_devnet_mail_fail, rpc_devnet_mail_list, rpc_devnet_mail_list_notices } from "./mail.ts";
import { W } from "./worlds.ts";
import {
  examples_dev_prices_set,
  examples_dev_gates_set,
  examples_dev_approve,
  examples_dev_jobs_run,
  examples_dev_mail_list,
  examples_dev_mail_fail,
  examples_dev_mail_notices,
} from "./examples.ts";

const page = (id: FrozenId) => `apps/docs/factory/operations/${id}.yaml:1`;
const CLI = "apps/cli/src/commands/dev";

/** A frozen acceptance line kept word for word, with what observes it and its old test citation. */
const keep = (id: FrozenId, n: number, observes: string) => {
  const line = frozen[id].acceptance[n - 1] as { claim: string; was: readonly string[] };
  return { claim: line.claim, observes, was: [...line.was] };
};

/** The frozen refusal text for a code, word for word. */
const when = (id: FrozenId, code: string) => {
  const r = frozenRefusals(id).find((x) => x.code === code);
  if (!r) throw new Error(`${id} has no frozen ${code} refusal`);
  return r.when;
};

const refusal = (id: FrozenId, error: ErrorRecord, given: string) => ({ error, given, when: when(id, error.id) });

/** The CLI's devnet scope: any environment but a local devnet, refused before any network call. */
const offDevnet = (id: FrozenId) => refusal(id, error_WRONG_ENVIRONMENT, W.offDevnet);

// ── scripted prices and gates ───────────────────────────────────────────────────────────────

export const operation_dev_prices_set = defineOperation({
  ...frozenText("dev.prices.set"),
  priority: "normal",
  implementedBy: flow_devnet_prices_set,
  examples: examples_dev_prices_set,
  acceptance: [],
  returns: flow_devnet_prices_set.output,
  errors: [error_CLI_USAGE, error_WRONG_ENVIRONMENT],
  refusals: [
    refusal("dev.prices.set", error_CLI_USAGE, W.signedIn),
    offDevnet("dev.prices.set"),
    { error: error_INVALID_INPUT, given: W.signedIn, when: "The pair names an asset Capxul does not price. The refusal names the ones it does." },
    { error: error_NOT_AUTHENTICATED, given: W.signedOut, when: "You are not signed in." },
  ],
  budget: budget("chain-read"),
  was: [page("dev.prices.set"), `${CLI}/prices.ts:14`, "docs/as-is/archive/operations/devnet.ts:513"],
});

export const operation_dev_gates_set = defineOperation({
  ...frozenText("dev.gates.set"),
  priority: "normal",
  implementedBy: flow_devnet_gates_set,
  examples: examples_dev_gates_set,
  acceptance: [],
  returns: flow_devnet_gates_set.output,
  errors: [error_CLI_USAGE, error_WRONG_ENVIRONMENT],
  refusals: [
    refusal("dev.gates.set", error_CLI_USAGE, W.orgReady),
    refusal("dev.gates.set", error_FEATURE_NOT_AVAILABLE, W.orgReady),
    offDevnet("dev.gates.set"),
    { error: error_NOT_AUTHENTICATED, given: W.signedOut, when: "You are not signed in." },
  ],
  budget: budget("vendor"),
  was: [page("dev.gates.set"), `${CLI}/gates.ts:24`, "docs/as-is/archive/operations/devnet.ts:679"],
});

// ── playing another person ──────────────────────────────────────────────────────────────────

export const operation_dev_approve = defineOperation({
  ...frozenText("dev.approve"),
  priority: "normal",
  implementedBy: flow_devnet_approve,
  examples: examples_dev_approve,
  acceptance: [],
  returns: flow_devnet_approve.output,
  errors: [error_CLI_USAGE, error_WRONG_ENVIRONMENT],
  refusals: [refusal("dev.approve", error_WRONG_STATE, W.history), refusal("dev.approve", error_WRONG_ENVIRONMENT, W.history)],
  budget: budget("vendor"),
  was: [page("dev.approve"), `${CLI}/command.ts:171`, "docs/as-is/archive/operations/devnet.ts:628"],
});

// ── jobs ────────────────────────────────────────────────────────────────────────────────────

export const operation_dev_jobs_run = defineOperation({
  ...frozenText("dev.jobs.run"),
  priority: "normal",
  implementedBy: rpc_devnet_jobs_run,
  examples: examples_dev_jobs_run,
  acceptance: [],
  returns: rpc_devnet_jobs_run.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [
    offDevnet("dev.jobs.run"),
    {
      error: error_WORK_DIED,
      given: W.bridgeDown,
      when: "A job fails: here Bridge's catch-up, whose stand-in fails every call. It names the job, and the other jobs still ran.",
    },
  ],
  budget: budget("background"),
  was: [page("dev.jobs.run"), `${CLI}/command.ts:128`, "docs/as-is/archive/operations/devnet.ts:732"],
});

// ── mail ────────────────────────────────────────────────────────────────────────────────────

export const operation_dev_mail_list = defineOperation({
  ...frozenText("dev.mail.list"),
  priority: "normal",
  implementedBy: rpc_devnet_mail_list,
  examples: examples_dev_mail_list,
  acceptance: [],
  returns: rpc_devnet_mail_list.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [offDevnet("dev.mail.list")],
  budget: budget("read"),
  was: [page("dev.mail.list"), `${CLI}/mail.ts:1`, "docs/as-is/archive/operator/outboxes.ts:60"],
});

export const operation_dev_mail_fail = defineOperation({
  ...frozenText("dev.mail.fail"),
  priority: "normal",
  implementedBy: rpc_devnet_mail_fail,
  examples: examples_dev_mail_fail,
  acceptance: [
    keep(
      "dev.mail.fail",
      1,
      "cli: from empty-devnet, after `dev mail fail --next 1 --to ana@acme.test`, `auth login ana@acme.test` exits PROVIDER_ERROR " +
        "and a second one sends; `dev mail fail --next 3` then `--clear` prints `cleared` true. read: `dev mail list --to " +
        "ana@acme.test` holds exactly one code; `dev mail fail --list` shows no fault.",
    ),
    keep(
      "dev.mail.fail",
      2,
      "cli: from empty-devnet after `--next 2 --to ana@acme.test`, `--list` run twice shows that one fault with 2 left both " +
        "times. world: the faults are the same before and after each `--list`.",
    ),
    keep(
      "dev.mail.fail",
      3,
      "cli: `--clear --next 1` exits 2 with CLI_USAGE before any call; `--next 0` and `--next 101` exit 2 with the backend's " +
        "INVALID_INPUT naming the range 1 to 100. world: no fault is armed.",
    ),
  ],
  returns: rpc_devnet_mail_fail.output,
  errors: [error_CLI_USAGE, error_WRONG_ENVIRONMENT],
  refusals: [
    refusal("dev.mail.fail", error_CLI_USAGE, W.empty),
    refusal("dev.mail.fail", error_INVALID_INPUT, W.empty),
    offDevnet("dev.mail.fail"),
  ],
  budget: budget("write"),
  was: [page("dev.mail.fail"), `${CLI}/mail.ts:1`, "docs/as-is/archive/operator/outboxes.ts:100"],
});

export const operation_dev_mail_notices = defineOperation({
  ...frozenText("dev.mail.notices"),
  priority: "normal",
  implementedBy: rpc_devnet_mail_list_notices,
  examples: examples_dev_mail_notices,
  acceptance: [
    keep(
      "dev.mail.notices",
      1,
      "cli: from org-with-pending-invitation, with `dev mail fail --next 1` armed for the invitee and `org invite resend`, " +
        "`dev mail notices --to <invitee>` lists the invitation's notice `retrying` with 1 attempt and last error " +
        "PROVIDER_ERROR, then `sent` with 2 attempts after `dev time warp 2m`; `--template` naming another template lists none.",
    ),
  ],
  returns: rpc_devnet_mail_list_notices.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [offDevnet("dev.mail.notices")],
  budget: budget("read"),
  was: [page("dev.mail.notices"), `${CLI}/mail.ts:1`, "docs/as-is/archive/operator/notices.ts:57"],
});
