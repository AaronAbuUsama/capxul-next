// The setup area: a person's own Safe. The web app starts its setup; the CLI only reads it.
//
// The Safe's address is a pure function of the person's email (CompaniesHouseClaimer's
// `safeAddressFor`, with Companies House as the bootstrap owner and the deployment's namespace), so
// every read can name it before anything is on chain. Setting it up is one durable process
// (`accounts.setup.personal-safe` in ./processes.ts): Companies House's claim role installs the
// person's signer as the Safe's only owner, then the person's Safe collects the claim escrows that
// were waiting for them. The CLI never starts or resumes it: `account retry` and `account show`
// read it, and `auth login` and `auth verify` report it.
//
// Two reads, because the two commands answer differently (decision `accounts.setup-reads`):
// `account show` shows a failed setup as a lifecycle, `account retry` refuses with the chain's code.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_accounts } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_SMART_ACCOUNT_MISSING,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { machine_personal_safe, table_personal_safes, table_waitlist_entries } from "./data.ts";
import { procedure_parties_register, table_feature_gates } from "./links.ts";

const OLD = "packages/backend/src/accounts";
const SDK = "packages/sdk/src/accounts";

const S = Schema.String;
const noCalls = { calls: [], chain: [], spans: [] } as const;

/** Where setup stands, as `account show` prints it. A claimed Safe is ready while its escrows are collected. */
export const SetupLifecycle = Schema.Union([
  Schema.Struct({ status: Schema.Literal("settingUp"), step: Schema.Literal("claiming") }),
  Schema.Struct({
    status: Schema.Literal("ready"),
    safe: S,
    canTransact: Schema.Boolean,
    /** True while the claim escrows waiting for the person are still being collected. */
    collecting: Schema.Boolean,
  }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    at: Schema.Literal("claiming"),
    error: Schema.Struct({ code: Schema.Literals(["WRONG_STATE", "INVALID_INPUT", "TRANSACTION_FAILED", "PROVIDER_ERROR"]), message: S }),
  }),
]);

/** What `account retry`, `auth login` and `auth verify` report of the setup. */
export const SetupCheck = Schema.Struct({
  setupState: Schema.Literals(["ready", "setup-required"]),
  /** The web app's setup page, when setup is not done. */
  setupUrl: Schema.NullOr(S),
  /** The exact argv that checks again, when setup is not done. */
  next: Schema.NullOr(Schema.Struct({ argv: Schema.Array(S) })),
  safe: S,
  claimed: Schema.Boolean,
  collected: Schema.Int,
});

export const rpc_accounts_setup_start = defineRpc({
  id: "accounts.setup.start",
  title: "Start, resume or retry the person's Safe setup, from the web app",
  about:
    "The web app's setup page calls it with the person's embedded signer. The caller must be admitted or the beta open " +
    "to them (FEATURE_NOT_AVAILABLE while waiting). The signer must be an address, not zero and not Companies House " +
    "(INVALID_INPUT `signer`). With no setup yet it births the row at the address the email derives (`start`) and " +
    "registers the person's Party with that Safe (`parties.register`): the name and the Safe money to it lands in are " +
    "one fact. A setup in progress or ready for the same signer answers as it stands; for another signer it is " +
    "WRONG_STATE (the Safe is set up for another signer). A failed setup is retried (`retry`, attempt + 1), with this " +
    "signer. Every start after it commits runs or resumes the setup process; nothing here touches the chain.",
  concept: concept_accounts,
  kind: "mutation",
  who: "A signed-in person who is admitted or to whom the beta is open, for their own Safe, through the web app's setup page.",
  input: Schema.Struct({ signer: S }),
  output: Schema.Struct({ safe: S, status: Schema.Literals(["claiming", "collecting", "ready", "failed"]), attempt: Schema.Int }),
  errors: [error_NOT_AUTHENTICATED, error_FEATURE_NOT_AVAILABLE, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_personal_safes, table_waitlist_entries, table_feature_gates],
  writes: [table_personal_safes],
  drives: [machine_personal_safe.t.start, machine_personal_safe.t.retry],
  invokes: [procedure_parties_register],
  emits: [],
  ...noCalls,
  budget: budget("write"),
  was: [`${OLD}/safes/operations/provision.ts:10`, `${OLD}/claims/operations/claim.ts:34`, `${OLD}/claims/rules.ts:45`, `${SDK}/account-setup.ts:86`],
});

export const rpc_accounts_setup_lifecycle = defineRpc({
  id: "accounts.setup.lifecycle",
  title: "Where the signed-in person's setup stands",
  about:
    "Reads the caller's own setup and never starts or resumes it. `claiming` is setting up at step `claiming`; a claimed " +
    "Safe (`collecting` or `ready`) is ready and can transact, with `collecting` while its claim escrows are still being " +
    "collected; `failed` shows the step and the error code with the code's message, never the revert data or a stack. No " +
    "setup yet is SMART_ACCOUNT_MISSING (finish it with `capxul account retry`). `personId`, when given, must be the " +
    "caller's own, else NOT_AUTHENTICATED: another person's setup is never read.",
  concept: concept_accounts,
  kind: "query",
  who: "A signed-in person, for their own setup.",
  input: Schema.Struct({ personId: Schema.optionalKey(S) }),
  output: Schema.Struct({ lifecycle: SetupLifecycle }),
  errors: [error_NOT_AUTHENTICATED, error_SMART_ACCOUNT_MISSING],
  reads: [table_personal_safes],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  ...noCalls,
  budget: budget("read"),
  was: [`${OLD}/safes/operations/load-by-auth-user-id.ts:11`, `${OLD}/safes/guards.ts:11`, `${SDK}/account-lifecycle.ts:92`],
});

export const rpc_accounts_setup_check = defineRpc({
  id: "accounts.setup.check",
  title: "Whether the signed-in person's setup is done, and where to finish it",
  about:
    "Reads the caller's own setup and starts nothing. A claimed Safe is `ready`, with the Safe, `claimed` and how many " +
    "claim escrows the setup collected. No setup, or one still claiming, is `setup-required` with the web app's setup " +
    "page (`setupUrl`) and the argv that checks again (`capxul account retry`). A setup the chain refused answers with " +
    "the chain's code: SwapRefused (the Safe is already claimed by another signer) is WRONG_STATE; EmailNotNormalized " +
    "or InvalidSigner is INVALID_INPUT. The Safe's address is derived from the email, so it is named even before setup.",
  concept: concept_accounts,
  kind: "query",
  who: "A signed-in person, for their own setup.",
  input: Schema.Struct({}),
  output: SetupCheck,
  errors: [error_NOT_AUTHENTICATED, error_WRONG_STATE, error_INVALID_INPUT],
  reads: [table_personal_safes],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  ...noCalls,
  budget: budget("read"),
  was: [`${OLD}/safes/operations/load-by-auth-user-id.ts:11`, "apps/cli/src/auth/profile-report.ts:18", "apps/docs/factory/operations/account.retry.yaml"],
});
