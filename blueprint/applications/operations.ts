// The six frozen operations applications owns (OPERATION_OWNERS): `doctor`, `key create`, `key list`,
// `key rotate`, `key revoke` and `dev key`. Text comes from the frozen book through frozenText, never
// retyped. Acceptance claims are the frozen ones word for word, except three lines that name a
// mechanism (the old telemetry row, and restoring a session), rewritten as outcomes (decision
// applications.acceptance-rewrites).
//
// The worlds the refusals and claims are reached from are listed in decision applications.worlds:
// access's `empty-devnet` and `person-signed-in`, and this concept's `people-with-keys`,
// `person-at-key-limit`, `org-with-keys` and `quickstart-quota-spent`.

import { Schema } from "effect";
import { budget, defineOperation, type ErrorRecord } from "../../packages/blueprint-engine/src/index.ts";
import { frozen, frozenRefusals, frozenText, type FrozenId } from "../baseline/index.ts";
import {
  error_CLI_CONFIG,
  error_CLI_STORAGE,
  error_CLI_USAGE,
  error_INVALID_INPUT,
  error_NETWORK_ERROR,
  error_NOT_AUTHENTICATED,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_ENVIRONMENT,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { CreatedKey, Key, rpc_applications_keys_create, rpc_applications_keys_list } from "./keys.ts";
import { MintedKey } from "./quickstarts.ts";
import {
  DoctorReport,
  flow_client_account_keys_revoke,
  flow_client_account_keys_rotate,
  flow_client_dev_key,
  flow_client_system_health,
} from "./flows.ts";
import {
  examples_doctor,
  examples_key_create,
  examples_key_list,
  examples_key_revoke,
  examples_key_rotate,
  examples_dev_key,
} from "./examples.ts";

const CLI = "apps/cli/src/commands";
const AS_IS = "docs/as-is/archive/operations";
const page = (id: FrozenId) => `apps/docs/factory/operations/${id}.yaml:1`;

/** The worlds this concept's operations are reached from (decision applications.worlds). */
export const WORLDS = {
  /** access's: a devnet with no one signed in on this machine. */
  empty: "empty-devnet",
  /** access's: one person signed in, with no keys. */
  person: "person-signed-in",
  /** Two people signed in; the first holds an active, a grace and a revoked key, the second one active key; one quickstart key. */
  keys: "people-with-keys",
  /** A person signed in who holds 20 keys that still resolve. */
  limit: "person-at-key-limit",
  /** An Organization with one key; Ivy wears its Invoicing hat, Max is a member without it, Olu is outside it. */
  org: "org-with-keys",
  /** One network address has minted 15 quickstart keys in the last hour. */
  quota: "quickstart-quota-spent",
} as const;

const ERRORS: Record<string, ErrorRecord> = {
  CLI_CONFIG: error_CLI_CONFIG,
  CLI_STORAGE: error_CLI_STORAGE,
  CLI_USAGE: error_CLI_USAGE,
  INVALID_INPUT: error_INVALID_INPUT,
  NETWORK_ERROR: error_NETWORK_ERROR,
  NOT_AUTHENTICATED: error_NOT_AUTHENTICATED,
  RATE_LIMITED: error_RATE_LIMITED,
  ROLE_PERMISSION_DENIED: error_ROLE_PERMISSION_DENIED,
  WRONG_ENVIRONMENT: error_WRONG_ENVIRONMENT,
  WRONG_STATE: error_WRONG_STATE,
};

/** The page's refusals, in its order and words, each reached from the world named for its code. */
const refusals = (id: FrozenId, given: Record<string, string>) =>
  frozenRefusals(id).map(({ code, when }) => {
    const error = ERRORS[code];
    const world = given[code];
    if (error === undefined || world === undefined) throw new Error(`${id}: refusal ${code} has no error record or world here`);
    return { error, given: world, when };
  });

type FrozenLine = { readonly claim: string; readonly was: readonly string[] };
const frozenLine = (id: FrozenId, n: number) => (frozen[id].acceptance as readonly FrozenLine[])[n - 1]!;

/** Acceptance line n (from 1), its claim kept word for word, its test citation in `was`. */
const kept = (id: FrozenId, n: number, observes: string) => {
  const a = frozenLine(id, n);
  return { claim: a.claim, observes, was: [...a.was] };
};

/** Acceptance line n rewritten as an outcome: the old claim and its citation move to `was`. */
const rewritten = (id: FrozenId, n: number, claim: string, observes: string) => {
  const a = frozenLine(id, n);
  return { claim, observes, was: [a.claim, ...a.was] };
};

const NO_CONFIRM = "A scripted run without `--confirm` refuses with `CLI_USAGE` before any call, whether or not anyone is signed in here.";
const noConfirmObserves = (command: string) =>
  `cli: in \`${WORLDS.empty}\` and in \`${WORLDS.keys}\`, \`${command} --json\` without \`--confirm\` exits 2 with CLI_USAGE ` +
  "both times; trace: no rpc span; world: the diff is empty.";

const GUIDED = { ...budget("write"), excludes: ["wait.person"] };

// ── doctor ──────────────────────────────────────────────────────────────────────────────────

// The CLI refuses an unknown flag (CLI_USAGE) and `--online` with no CAPXUL_PUBLISHABLE_KEY (CLI_CONFIG) itself,
// then calls the one SDK method client.system.health. Its NETWORK_ERROR exits 124 (decision applications.doctor-exit).
export const operation_doctor = defineOperation({
  ...frozenText("doctor"),
  was: [page("doctor"), `${AS_IS}/accounts.ts:1439`, `${CLI}/doctor/execute.ts:11`, `${CLI}/doctor/internal/probe.ts:13`],
  priority: "normal",
  implementedBy: flow_client_system_health,
  examples: examples_doctor,
  acceptance: [
    kept(
      "doctor",
      1,
      "cli: `doctor --online --json` prints `network.status: ok` with the deployment's name and a round-trip time; with " +
        "the eval's proxy answering the health check with another nonce, it prints no `ok` and exits 5 with " +
        "PROVIDER_RESPONSE_INVALID. trace: the health call's span carries the run's nonce.",
    ),
    kept(
      "doctor",
      2,
      "cli: with the eval's proxy holding the health check past 15 s, `doctor --online --timeout-ms 15000` exits 124 with " +
        "NETWORK_ERROR and the SDK's mode (`timeout`) in its details.",
    ),
    rewritten(
      "doctor",
      3,
      "At its own deadline it ends with mode `timeout`, in the JSON and in its trace.",
      "cli: `doctor --online --timeout-ms 1 --json` exits 124 with NETWORK_ERROR and `details.mode: timeout`; trace: the " +
        "command's root span ends in error with the same code and mode.",
    ),
  ],
  returns: DoctorReport,
  errors: [error_CLI_USAGE, error_CLI_CONFIG],
  refusals: refusals("doctor", { CLI_CONFIG: WORLDS.empty, NETWORK_ERROR: WORLDS.empty, CLI_USAGE: WORLDS.empty }),
  budget: {
    ...budget("read"),
    p50Ms: 1_000,
    p95Ms: 2_000,
    why: "with `--online`, two backend calls in sequence: the bootstrap, then the health check at the backend it names",
  },
});

// ── key create ──────────────────────────────────────────────────────────────────────────────

// client.account.keys.create is one rpc; `--org` sets its owner. The CLI checks `--app` and its flags (CLI_USAGE).
export const operation_key_create = defineOperation({
  ...frozenText("key.create"),
  was: [page("key.create"), `${AS_IS}/accounts.ts:1351`, `${CLI}/key/subcommands/create/execute.ts:13`],
  priority: "normal",
  implementedBy: rpc_applications_keys_create,
  examples: examples_key_create,
  acceptance: [
    kept(
      "key.create",
      1,
      `cli: in \`${WORLDS.person}\`, \`key create --json\` prints \`key.app: default\` and a \`publishableKey\` starting ` +
        "`cap_pk_test_`; read: `key list` shows that key with its prefix and hint and no raw key; world: one new " +
        "application `default` and one active key; trace: one app_key_transitioned with transition create.",
    ),
    kept(
      "key.create",
      2,
      `cli: in \`${WORLDS.person}\`, \`key create --app shop --origin https://shop.test\` and then \`key create --app shop\` ` +
        "print the same applicationId, each with origins [https://shop.test]; world: one application `shop`, two keys.",
    ),
    kept(
      "key.create",
      3,
      `cli: in \`${WORLDS.limit}\`, \`key create\` exits 2 with WRONG_STATE and the world diff is empty; after ` +
        "`key revoke <one> --confirm`, `key create` succeeds.",
    ),
    kept(
      "key.create",
      4,
      `cli: in \`${WORLDS.org}\`, Ivy's \`key create --org acme\` key appears in Max's \`key list --org acme\` and not in ` +
        "Ivy's own `key list`; world: the new key's owner is the Organization.",
    ),
    kept(
      "key.create",
      5,
      `cli: in \`${WORLDS.org}\`, Max (a member without the Invoicing hat) and Olu (outside it) each get ` +
        "ROLE_PERMISSION_DENIED from `key create --org acme`; world: the diff is empty.",
    ),
  ],
  returns: CreatedKey,
  errors: [error_CLI_USAGE],
  refusals: refusals("key.create", {
    INVALID_INPUT: WORLDS.person,
    WRONG_STATE: WORLDS.limit,
    ROLE_PERMISSION_DENIED: WORLDS.org,
  }),
  budget: budget("write"),
});

// ── key list ────────────────────────────────────────────────────────────────────────────────

// client.account.keys.list is one rpc; the CLI prints `next` when there is another page.
export const operation_key_list = defineOperation({
  ...frozenText("key.list"),
  was: [page("key.list"), `${AS_IS}/accounts.ts:1322`, `${CLI}/key/subcommands/list/execute.ts:10`],
  priority: "normal",
  implementedBy: rpc_applications_keys_list,
  examples: examples_key_list,
  acceptance: [
    kept("key.list", 1, `cli: in \`${WORLDS.person}\`, \`key list --json\` prints \`items: []\` and \`next: null\`.`),
    kept(
      "key.list",
      2,
      `cli: in \`${WORLDS.keys}\`, the first person's \`key list\` shows each key's prefix and hint and no raw key; in ` +
        `\`${WORLDS.person}\` it prints \`capxul key create\` as the next command.`,
    ),
    kept(
      "key.list",
      3,
      `cli: in \`${WORLDS.keys}\`, the first person's \`key list --json\` holds exactly their keys, newest first, with ` +
        "states active, grace and revoked, and two keys made in one millisecond in the order they were made; none of the " +
        "second person's keys and no quickstart key appear.",
    ),
    kept(
      "key.list",
      4,
      `cli: in \`${WORLDS.org}\`, Max's \`key list --org acme\` lists the Organization's key; Olu's exits with ` +
        "ROLE_PERMISSION_DENIED.",
    ),
    kept(
      "key.list",
      5,
      `cli: in \`${WORLDS.keys}\`, no output of \`key list\`, with or without \`--json\`, holds a raw key; trace: no span ` +
        "attribute of the run holds one.",
    ),
  ],
  returns: Schema.Struct({ items: Schema.Array(Key), next: Schema.NullOr(Schema.String) }),
  errors: [error_CLI_USAGE],
  refusals: refusals("key.list", { ROLE_PERMISSION_DENIED: WORLDS.org, NOT_AUTHENTICATED: WORLDS.empty }),
  budget: budget("read"),
});

// ── key revoke ──────────────────────────────────────────────────────────────────────────────

// The CLI refuses a scripted run without `--confirm` (CLI_USAGE) before any call, then calls the one SDK method.
export const operation_key_revoke = defineOperation({
  ...frozenText("key.revoke"),
  was: [page("key.revoke"), `${AS_IS}/accounts.ts:1409`, `${CLI}/key/subcommands/revoke/execute.ts:12`],
  priority: "normal",
  implementedBy: flow_client_account_keys_revoke,
  examples: examples_key_revoke,
  acceptance: [
    kept(
      "key.revoke",
      1,
      `cli: in \`${WORLDS.keys}\`, \`key revoke <active> --confirm --json\` prints \`state: revoked\`, and a second run ` +
        "prints the same; world: the key goes from active to revoked once and the second diff is empty; trace: one " +
        "app_key_transitioned with transition revoke across both runs.",
    ),
    kept(
      "key.revoke",
      2,
      `cli: in \`${WORLDS.keys}\`, revoking the second person's key, an unknown key id and the quickstart key's id each ` +
        "exits 3 with NOT_AUTHENTICATED and the same message; world: the diff is empty; the bootstrap still resolves the " +
        "second person's key and the quickstart key.",
    ),
    rewritten("key.revoke", 3, NO_CONFIRM, noConfirmObserves("key revoke <active>")),
  ],
  returns: Schema.Struct({ id: Schema.String, state: Schema.Literal("revoked") }),
  errors: [error_CLI_USAGE],
  refusals: refusals("key.revoke", { NOT_AUTHENTICATED: WORLDS.keys, CLI_USAGE: WORLDS.keys }),
  budget: GUIDED,
});

// ── key rotate ──────────────────────────────────────────────────────────────────────────────

// The CLI refuses a `--grace` that is not `0` or a time up to 30 days, and a scripted run without `--confirm`
// (CLI_USAGE), before any call; then it calls the one SDK method.
export const operation_key_rotate = defineOperation({
  ...frozenText("key.rotate"),
  was: [page("key.rotate"), `${AS_IS}/accounts.ts:1381`, `${CLI}/key/subcommands/rotate/execute.ts:25`],
  priority: "normal",
  implementedBy: flow_client_account_keys_rotate,
  examples: examples_key_rotate,
  acceptance: [
    kept(
      "key.rotate",
      1,
      `cli: in \`${WORLDS.keys}\`, \`key rotate <active> --grace 1h --confirm --json\` prints \`active.publishableKey\` and ` +
        "`retired.graceEndsAt` one hour on; both keys bootstrap; after the devnet clock moves past the hour the old key's " +
        "bootstrap is NOT_AUTHENTICATED and `key list` shows it expired. trace: app_key_transitioned create and rotate, " +
        "then expire from the key's grace process.",
    ),
    kept(
      "key.rotate",
      2,
      `cli: in \`${WORLDS.keys}\`, rotating the second person's key exits 3 with NOT_AUTHENTICATED; world: the diff is ` +
        "empty, that key still active with no grace window.",
    ),
    kept(
      "key.rotate",
      3,
      `cli: in \`${WORLDS.keys}\`, rotating the key already in its grace window exits 2 with WRONG_STATE; world: the diff ` +
        "is empty.",
    ),
    kept(
      "key.rotate",
      4,
      `cli: in \`${WORLDS.limit}\`, \`key rotate <one> --grace 1h --confirm\` exits 2 with WRONG_STATE and changes nothing; ` +
        "`--grace 0` succeeds, the old key expired at once and the owner still at 20 keys that resolve.",
    ),
    rewritten("key.rotate", 5, NO_CONFIRM, noConfirmObserves("key rotate <active>")),
  ],
  returns: Schema.Struct({ active: CreatedKey, retired: Key }),
  errors: [error_CLI_USAGE],
  refusals: refusals("key.rotate", {
    CLI_USAGE: WORLDS.keys,
    INVALID_INPUT: WORLDS.keys,
    WRONG_STATE: WORLDS.keys,
    NOT_AUTHENTICATED: WORLDS.keys,
  }),
  budget: GUIDED,
});

// ── dev key ─────────────────────────────────────────────────────────────────────────────────

// The CLI refuses an origin that is not local (CLI_USAGE) before any call, then calls the one SDK method
// client.dev.key, in the Core SDK's Node-only test entry (decision applications.dev-key-flow).
export const operation_dev_key = defineOperation({
  ...frozenText("dev.key"),
  was: [page("dev.key"), `${AS_IS}/devnet.ts:778`, `${CLI}/dev/key.ts:50`, `${CLI}/dev/key.ts:189`],
  priority: "normal",
  implementedBy: flow_client_dev_key,
  examples: examples_dev_key,
  acceptance: [
    kept(
      "dev.key",
      1,
      `cli: in \`${WORLDS.empty}\`, in a folder whose \`.env.local\` holds other lines, \`dev key\` exits 0 and the file then ` +
        "holds `NEXT_PUBLIC_CAPXUL_PUBLISHABLE_KEY` and `CAPXUL_SITE_URL` with the printed values and every other line as it was.",
    ),
    kept(
      "dev.key",
      2,
      `cli: in \`${WORLDS.empty}\`, with the write made to fail after the mint, \`.env.local\` is byte for byte what it was ` +
        "and the run exits 2 with CLI_STORAGE.",
    ),
    kept(
      "dev.key",
      3,
      `cli: in \`${WORLDS.empty}\`, \`dev key --print --json\` prints the key and the site URL, \`envFile: null\`, and the ` +
        "folder is unchanged.",
    ),
    kept(
      "dev.key",
      4,
      `cli: in \`${WORLDS.quota}\`, \`dev key\` exits 6 with RATE_LIMITED and its message names the wait in whole minutes; ` +
        "world: no new quickstart key.",
    ),
  ],
  returns: Schema.Struct({ ...MintedKey.fields, origin: Schema.String, envFile: Schema.NullOr(Schema.String) }),
  errors: [error_CLI_USAGE],
  refusals: refusals("dev.key", {
    CLI_USAGE: WORLDS.empty,
    CLI_STORAGE: WORLDS.empty,
    RATE_LIMITED: WORLDS.quota,
    WRONG_ENVIRONMENT: WORLDS.empty,
  }),
  budget: budget("write"),
});
