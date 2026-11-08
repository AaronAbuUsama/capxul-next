// Who an equity call acts for, and what every write of a kind reads, touches and can raise. Not
// records: the rpcs in the area files spread these into their fields.
//
// - A member: a current Seat in the company (organizations' members), else ROLE_PERMISSION_DENIED.
// - The Board: a member whose own Safe is an owner of the company Safe and wears the Director hat
//   now (indexing's Safe owners and hat wearers, the hat named by organizations' deployment), else
//   ROLE_PERMISSION_DENIED. The Board's threshold is the chain's; board's proposal collects it.
// - A holder: the session's principal acting from their own claimed Safe (access' principals, accounts'
//   personal Safe), whatever company they hold in: an investor, grantee, seller, buyer or voter need not
//   be a member. No claimed Safe is SMART_ACCOUNT_MISSING.
// - Every command but `shares`, `vote list` and `invest` checks the company's `equity` gate (access'
//   feature flags, read through its one evaluator: FEATURE_NOT_AVAILABLE; on for a devnet company) and,
//   except setup, that equity is installed (the live install is `installed` and indexing's
//   chain-deployments names its clones), else WRONG_STATE. A company sold and closed for exit
//   (`Captable.closedForExit`) refuses every new issue, round or grant with WRONG_STATE.

import { table_feature_flags, table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_personal_safes } from "../accounts/data.ts";
import { table_org_deployments, table_org_members, table_organizations } from "../organizations/data.ts";
import { table_chain_deployments, table_hat_wearers, table_safe_owners } from "../indexing/data.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { integration_chain_rpc } from "../shared/external.ts";
import { table_equity_installs } from "./data.ts";

export const OLD = "packages/backend/src/organizations";
export const AS_IS = "books/as-is/organizations";

/** A member of the company, with its gate and its installed equity. */
export const MEMBER = [table_organizations, table_org_members, table_feature_flags, table_equity_installs, table_chain_deployments] as const;

/** The Board: a member who is a seated Director now, from the chain. */
export const DIRECTOR = [...MEMBER, table_org_deployments, table_safe_owners, table_hat_wearers] as const;

/** A holder acting from their own claimed Safe, and the company they act in. */
export const HOLDER = [table_principals, table_personal_safes, table_parties, table_organizations, table_feature_flags, table_equity_installs, table_chain_deployments] as const;

/** Resolving `--to`, `--investor` and `--founder` to a Party and its Safe (a member's, through MEMBER's Seats). */
export const RESOLVE = [table_parties] as const;

/** The errors of a read of the chain through the nodes. */
export const CHAIN_READ_ERRORS = [error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID] as const;

/** What a member's read can raise. */
export const MEMBER_READ_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_FEATURE_NOT_AVAILABLE, error_INVALID_INPUT, error_WRONG_STATE] as const;

/** What every Board matter can raise before it is proposed. */
export const BOARD_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_FEATURE_NOT_AVAILABLE,
  error_WRONG_STATE,
  error_INVALID_INPUT,
  error_ROLE_PERMISSION_DENIED,
  ...CHAIN_READ_ERRORS,
] as const;

/** What every holder's own write can raise before its approval opens. */
export const HOLDER_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_FEATURE_NOT_AVAILABLE,
  error_WRONG_STATE,
  error_INVALID_INPUT,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  ...CHAIN_READ_ERRORS,
] as const;

/** A prepare's one outside call: live contract state before the calls are built. */
export const READS_CHAIN = [integration_chain_rpc.c.readContract] as const;

/** The Board's checks, in words, for every Board matter's `about`. */
export const BOARD_ABOUT =
  "The caller must be signed in and a member of the company (ROLE_PERMISSION_DENIED), its `equity` gate on " +
  "(FEATURE_NOT_AVAILABLE) and equity installed and not closed for exit (WRONG_STATE). The caller's own Safe must own " +
  "the company Safe and wear the Director hat now, read from the chain (ROLE_PERMISSION_DENIED: not a Director).";

/** How every Board matter is opened, in words. */
export const PROPOSE_ABOUT =
  "Then, in one transaction, the write is born `awaiting` (equity-write.open) and `board.propose` opens one Board " +
  "proposal of exactly these calls on the company Safe and the proposing Director's approval of its hash. The same " +
  "request while its write waits answers that write and proposal (`opened: false`); nothing is signed or sent.";

/** How every holder's own write is opened, in words. */
export const APPROVE_ABOUT =
  "Then, in one transaction, the write is born `awaiting` (equity-write.open) and `approvals.open` opens the approval " +
  "of exactly these calls from the caller's own Safe, with its summary for the approval page. The same request while " +
  "its write waits answers that write; nothing is signed or sent.";

export const GUARD_WAS = [`${OLD}/proposals/guards.ts`, `${OLD}/equity/reads.ts:44`, `${OLD}/equity/reads.ts:70`];
