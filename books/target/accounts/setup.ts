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
//
// One write the CLI does start: `payment claim`, payments' command, calls `accounts.setup.collect`, which opens the
// approval that collects, whenever the person chooses, the claim escrows their Safe owns (decisions
// `accounts.collect-any-time` and `payments.claim-command`, under aaron.escrow-general and aaron.payment-claim).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_accounts } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROFILE_NOT_FOUND,
  error_SMART_ACCOUNT_MISSING,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { machine_personal_safe, table_admissions, table_personal_safes } from "./data.ts";
import { table_feature_flags } from "../access/data.ts";
import { table_parties, table_profiles } from "../parties/data.ts";
import { table_escrows, table_safe_balances } from "../indexing/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { contract_escrow } from "../shared/external.ts";

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
    "The web app's setup page calls it with the person's embedded signer, after the person completed their profile in " +
    "parties (PROFILE_NOT_FOUND before). The caller must be admitted or the beta open to them (FEATURE_NOT_AVAILABLE while " +
    "waiting). The signer must be an address, not zero and not Companies House (INVALID_INPUT `signer`). With no setup " +
    "yet it births the row at the address the email derives (`start`), the same address the person's Party already routes " +
    "money to, so it writes nothing in parties. A setup in progress or ready for the same signer answers as it stands; for " +
    "another signer it is WRONG_STATE (the Safe is set up for another signer). A failed setup is retried (`retry`, attempt " +
    "+ 1), with this signer. Every start after it commits runs or resumes the setup process; nothing here touches the chain.",
  concept: concept_accounts,
  kind: "mutation",
  who: "A signed-in person who is admitted or to whom the beta is open, for their own Safe, through the web app's setup page.",
  input: Schema.Struct({ signer: S }),
  output: Schema.Struct({ safe: S, status: Schema.Literals(["claiming", "collecting", "ready", "failed"]), attempt: Schema.Int }),
  errors: [error_NOT_AUTHENTICATED, error_PROFILE_NOT_FOUND, error_FEATURE_NOT_AVAILABLE, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_personal_safes, table_profiles, table_admissions, table_feature_flags],
  writes: [table_personal_safes],
  drives: [machine_personal_safe.t.start, machine_personal_safe.t.retry],
  invokes: [],
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
    "collected; `failed` shows the step and the error code with the code's message, never the revert data or a stack. A " +
    "person with no profile in parties yet is PROFILE_NOT_FOUND, and one with a profile but no setup SMART_ACCOUNT_MISSING " +
    "(either way `capxul account retry` gives the link). `personId`, when given, must be the caller's own, else " +
    "NOT_AUTHENTICATED: another person's setup is never read.",
  concept: concept_accounts,
  kind: "query",
  who: "A signed-in person, for their own setup.",
  input: Schema.Struct({ personId: Schema.optionalKey(S) }),
  output: Schema.Struct({ lifecycle: SetupLifecycle }),
  errors: [error_NOT_AUTHENTICATED, error_PROFILE_NOT_FOUND, error_SMART_ACCOUNT_MISSING],
  reads: [table_personal_safes, table_profiles],
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
    "claim escrows the setup collected. No profile, no setup, or one still claiming, is `setup-required` with the web app's setup " +
    "page (`setupUrl`) and the argv that checks again (`capxul account retry`). A setup the chain refused answers with " +
    "the chain's code: SwapRefused (the Safe is already claimed by another signer) is WRONG_STATE; EmailNotNormalized " +
    "or InvalidSigner is INVALID_INPUT. The Safe's address is derived from the email, so it is named even before setup.",
  concept: concept_accounts,
  kind: "query",
  who: "A signed-in person, for their own setup.",
  input: Schema.Struct({}),
  output: SetupCheck,
  errors: [error_NOT_AUTHENTICATED, error_WRONG_STATE, error_INVALID_INPUT],
  reads: [table_personal_safes, table_profiles],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  ...noCalls,
  budget: budget("read"),
  was: [`${OLD}/safes/operations/load-by-auth-user-id.ts:11`, "apps/cli/src/auth/profile-report.ts:18", "apps/docs/factory/operations/account.retry.yaml"],
});

/** One claim escrow the caller's Safe owns, as `payment claim` lists it. */
export const WaitingEscrow = Schema.Struct({
  escrow: S,
  asset: S,
  amount: S,
  /** The sender's address: the payer's Safe, or the company Safe for an Organization's payment. */
  sender: S,
  /** Who sent it, as parties' directory names the sender's Safe (a person, or the Organization for its company Safe); null when no Party does. */
  from_label: Schema.NullOr(S),
});

/**
 * What `payment claim` answers, as `payroll agreement collect` answers `nothing_released`: `nothing_waiting` (nothing opened),
 * `awaiting_approval` (the hand-over: with `--json`, or `--timeout-seconds` passed before the approval ended) or
 * `collected` (the approval's operation landed: each listed escrow paid the Safe).
 */
export const Collection = Schema.Struct({
  status: Schema.Literals(["nothing_waiting", "awaiting_approval", "collected"]),
  safe: S,
  escrows: Schema.Array(WaitingEscrow),
  approval_id: Schema.NullOr(S),
  approval_url: Schema.NullOr(S),
  expires_at: Schema.NullOr(Schema.Number),
});

export const rpc_accounts_setup_collect = defineRpc({
  id: "accounts.setup.collect",
  title: "Open the approval that collects the claim escrows the person's Safe owns",
  about:
    "The general escrow's owner collects whenever it chooses (aaron.escrow-general): this is that choice, any time after " +
    "setup, which `payment claim` makes (payments' flow `client.payments.claim`, aaron.payment-claim). It reads the caller's own setup: not started, still claiming, or failed in a way a new start retries is " +
    "SMART_ACCOUNT_MISSING; one the chain refused answers as `account retry` does (SwapRefused, the Safe claimed by " +
    "another signer, WRONG_STATE; EmailNotNormalized or InvalidSigner INVALID_INPUT). Then indexing's open " +
    "owner-collects escrows whose owner is that Safe and whose balance in safe-balances holds their amount, so one " +
    "deployed before its money arrived is never signed into a revert, each with its sender's Party name from parties' " +
    "directory. None: `nothing_waiting`, the empty list, and nothing opened. Otherwise (`awaiting_approval`) it opens " +
    "one approval from the person's own Safe (`approvals.open`, subject the Safe's " +
    "setup and `collect`) carrying `Escrow.collect()` on each; a live approval for the same subject answers as it " +
    "stands, so asking twice signs once. Each collection's PaymentSent settles its Payment for the payer and the person, " +
    "as setup's does. It writes no row of accounts. An escrow its sender takes back before the approval lands makes the " +
    "chain's simulation refuse it, and nothing moves (decision accounts.collect-any-time).",
  concept: concept_accounts,
  kind: "action",
  who: "A signed-in person whose own Safe is set up, for the claim escrows that Safe owns.",
  input: Schema.Struct({}),
  output: Collection,
  errors: [error_NOT_AUTHENTICATED, error_SMART_ACCOUNT_MISSING, error_WRONG_STATE, error_INVALID_INPUT],
  reads: [table_personal_safes, table_escrows, table_safe_balances, table_parties],
  writes: [],
  drives: [],
  invokes: [procedure_approvals_open],
  emits: [],
  calls: [],
  chain: [contract_escrow.f.collect],
  spans: [],
  budget: budget("write"),
  was: [`${OLD}/claims/operations/claim.ts:34`, "apps/docs/factory/operations/account.retry.yaml (designed: collects claim escrows)"],
});
