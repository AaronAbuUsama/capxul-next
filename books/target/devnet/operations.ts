// The target operation records of the 13 frozen operations devnet owns (OPERATION_OWNERS): `dev
// approve`, `dev gates set`, `dev jobs run`, the three mail commands, `dev prices set`, the three
// snapshot commands and the three time commands. `dev fund` is accounts' and `dev key` applications'.
// One new operation beyond the 215 (rules.new-operations): `dev time set`, the clock's rate, for
// aaron.world-clock (decision devnet.clock-rate, which cites it).
//
// Each spreads its frozen text (frozenText) and keeps its acceptance word for word: no frozen devnet
// claim names a mechanism, so none is rewritten, and ten of the thirteen have no acceptance line at
// all. Every command has the CLI's devnet scope, which refuses WRONG_ENVIRONMENT on any other
// environment before a network call, so WRONG_ENVIRONMENT is in every record's `errors`. Refusals
// start from the catalogued worlds (./worlds.ts); the ones devnet's own refusals name are in decision
// devnet.own-refusal-worlds. Every record is `normal`: none is a pilot of the spine.

import { Schema } from "effect";
import { budget, defineOperation, type ErrorRecord } from "../../../packages/book/src/index.ts";
import { frozen, frozenRefusals, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
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
  flow_devnet_snapshots_list,
  flow_devnet_snapshots_restore,
  flow_devnet_snapshots_save,
  flow_devnet_time_set,
  flow_devnet_time_show,
  flow_devnet_time_start_at,
  flow_devnet_time_warp,
} from "./flows.ts";
import { rpc_devnet_jobs_run } from "./jobs.ts";
import { rpc_devnet_mail_fail, rpc_devnet_mail_list, rpc_devnet_mail_list_notices } from "./mail.ts";
import { W } from "./worlds.ts";

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

// ── the clocks ──────────────────────────────────────────────────────────────────────────────

export const operation_dev_time = defineOperation({
  ...frozenText("dev.time"),
  priority: "normal",
  implementedBy: flow_devnet_time_show,
  acceptance: [],
  returns: flow_devnet_time_show.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [offDevnet("dev.time")],
  budget: budget("read"),
  was: [page("dev.time"), `${CLI}/command.ts:118`, "docs/as-is/archive/operations/devnet.ts:266"],
});

export const operation_dev_time_warp = defineOperation({
  ...frozenText("dev.time.warp"),
  priority: "normal",
  implementedBy: flow_devnet_time_warp,
  acceptance: [],
  returns: flow_devnet_time_warp.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [refusal("dev.time.warp", error_INVALID_INPUT, W.empty), offDevnet("dev.time.warp")],
  budget: budget("background"),
  was: [page("dev.time.warp"), `${CLI}/command.ts:74`, "docs/as-is/archive/operations/devnet.ts:306"],
});

export const operation_dev_time_start_at = defineOperation({
  ...frozenText("dev.time.start-at"),
  priority: "normal",
  implementedBy: flow_devnet_time_start_at,
  acceptance: [],
  returns: flow_devnet_time_start_at.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [
    refusal("dev.time.start-at", error_INVALID_INPUT, W.empty),
    refusal("dev.time.start-at", error_WRONG_STATE, W.warped),
    offDevnet("dev.time.start-at"),
  ],
  budget: budget("chain-settle"),
  was: [page("dev.time.start-at"), `${CLI}/command.ts:103`, "docs/as-is/archive/operations/devnet.ts:355"],
});

// ── the clock's rate: new, for aaron.world-clock (decision devnet.clock-rate) ───────────────

export const operation_dev_time_set = defineOperation({
  id: "dev.time.set",
  title: "Set how fast the devnet's clock runs",
  about:
    "Sets the rate of the devnet's one clock: how many seconds of world time pass in each real second while it runs, a " +
    "whole number from 1 to 60. At 4, a real hour moves the world up to four hours, less the moments the clock stands " +
    "at each due instant on the way: the chain's blocks, the backend's timers and crons, the mail sink's dates, the " +
    "stand-ins and a connected head all follow it. A frozen clock stays frozen and runs at the rate when it resumes. Warps " +
    "are unchanged: a warp moves the clock as far as it is told, whatever the rate.",
  area: "devnet",
  command: "dev time set",
  priority: "normal",
  implementedBy: flow_devnet_time_set,
  who: "Devnet only: anyone on the machine that runs the local devnet, with no sign-in; in a shared world, its owner.",
  changes: "The clock's rate, from now on. Nothing moves back, nothing is mined and no row changes.",
  acceptance: [
    {
      claim: "A frozen clock keeps a rate it is given and stays where it is; a warp still moves it exactly as far as asked.",
      observes:
        "cli: from empty-devnet, `dev time set --rate 4 --json` prints the clock with `rate: 4`, `mode: frozen` and the " +
        "same now as before. read: `dev time` shows rate 4 and the eval epoch; after `dev time warp 1h`, now is one hour " +
        "later and the chain head is at it.",
    },
    {
      claim: "A running clock at rate four moves four seconds of world time for each real second, and every block is mined at the world's now.",
      observes:
        "read: from empty-devnet, after `dev time set --rate 4` and the SDK's `devnet.time.resume`, two `dev time` reads " +
        "about ten real seconds apart, with nothing due between them, show now advanced by four times the difference " +
        "of their `realNow`, within one second, with `agree` true. chain: every block mined between them has the " +
        "authority's now as its time.",
    },
    {
      claim: "A running clock at a rate stands at each due instant it was told of before running on, and the chain head reaches that second.",
      observes:
        "read: from empty-devnet, at rate 4 and resumed, an outside follower (the SDK's `devnet.time.follow`) that reports " +
        "its next due 60 world seconds ahead gets a `stop` event about 15 real seconds later whose now is that instant, " +
        "and reads it unchanged until it acknowledges idle within the running stop's limit (5 real seconds); then a " +
        "`run` event with nothing unsettled. chain: a block is dated that second.",
    },
    {
      claim: "A rate outside the range is refused and nothing changes.",
      observes:
        "cli: `dev time set --rate 0`, `--rate 61` and `--rate 2.5` exit with INVALID_INPUT naming the range 1 to 60, and " +
        "`dev time set` with no `--rate` exits INVALID_INPUT. world: the clock's rate and mode are as before.",
    },
    {
      claim: "In a shared world only its owner sets the rate; a joiner may still read the clock.",
      observes:
        "cli: in shared-world-joiner, `dev time set --rate 4` exits ROLE_PERMISSION_DENIED and `dev time` prints the " +
        "clock at rate 1. world: the clock's rate and mode are as before.",
    },
  ],
  returns: flow_devnet_time_set.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [
    { error: error_INVALID_INPUT, given: W.empty, when: "`--rate` is missing, or is not a whole number from 1 to 60. The refusal names the range, and nothing changes." },
    { error: error_WRONG_ENVIRONMENT, given: W.offDevnet, when: "You are not on a local devnet or a shared world. Every other environment refuses it before any network call." },
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: W.sharedJoiner,
      when: "In a shared world you hold a joiner's grant: only the world's owner sets the rate (devnet.shared-world). Nothing changes.",
    },
  ],
  budget: budget("write"),
});

// ── saved worlds ────────────────────────────────────────────────────────────────────────────

export const operation_dev_snapshot_save = defineOperation({
  ...frozenText("dev.snapshot.save"),
  priority: "normal",
  implementedBy: flow_devnet_snapshots_save,
  acceptance: [],
  returns: flow_devnet_snapshots_save.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [
    refusal("dev.snapshot.save", error_WRONG_STATE, W.empty),
    refusal("dev.snapshot.save", error_INVALID_INPUT, W.empty),
    offDevnet("dev.snapshot.save"),
  ],
  budget: budget("background"),
  was: [page("dev.snapshot.save"), `${CLI}/command.ts:143`, "docs/as-is/archive/operations/devnet.ts:397"],
});

export const operation_dev_snapshot_list = defineOperation({
  ...frozenText("dev.snapshot.list"),
  priority: "normal",
  implementedBy: flow_devnet_snapshots_list,
  acceptance: [],
  returns: flow_devnet_snapshots_list.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [offDevnet("dev.snapshot.list")],
  budget: budget("read"),
  was: [page("dev.snapshot.list"), `${CLI}/command.ts:158`, "docs/as-is/archive/operations/devnet.ts:433"],
});

export const operation_dev_snapshot_restore = defineOperation({
  ...frozenText("dev.snapshot.restore"),
  priority: "normal",
  implementedBy: flow_devnet_snapshots_restore,
  acceptance: [
    keep(
      "dev.snapshot.restore",
      1,
      "world: from empty-devnet, `dev snapshot save probe`, then `dev fund 10`, `dev time warp 1d` and `dev mail fail --next 1`, " +
        "then `dev snapshot restore probe`: the diff against the world saved as `probe` is empty (the chain's block and state, " +
        "every Postgres schema, Ponder's checkpoint, the armed faults). read: `dev time` shows `probe`'s world time with " +
        "`agree` true; `dev mail fail --list` shows no fault. chain: the funded Safe holds what it held at the save.",
    ),
  ],
  returns: flow_devnet_snapshots_restore.output,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: [
    refusal("dev.snapshot.restore", error_INVALID_INPUT, W.empty),
    refusal("dev.snapshot.restore", error_WRONG_STATE, W.empty),
    offDevnet("dev.snapshot.restore"),
  ],
  budget: budget("background"),
  was: [page("dev.snapshot.restore"), `${CLI}/command.ts:162`, "docs/as-is/archive/operations/devnet.ts:468"],
});

// ── scripted prices and gates ───────────────────────────────────────────────────────────────

export const operation_dev_prices_set = defineOperation({
  ...frozenText("dev.prices.set"),
  priority: "normal",
  implementedBy: flow_devnet_prices_set,
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
