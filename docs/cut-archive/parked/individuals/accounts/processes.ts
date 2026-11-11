// Moved out of the built book by the cut, 10 November 2026, from books/target/accounts/processes.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import {
  contract_companies_house_claimer,
  contract_erc20,
  contract_escrow,
  contract_roles,
  contract_safe,
  integration_chain_rpc,
  integration_indexer,
  integration_service_signer,
} from "../shared/external.ts";
import { concept_accounts } from "../shared/foundation.ts";
import {
  machine_personal_safe,
  machine_referral,
  machine_waitlist_entry,
  table_personal_safes,
  table_referral_codes,
  table_referrals,
  table_admissions,
} from "./data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { table_escrows, table_safe_balances } from "../indexing/data.ts";
import { rpc_accounts_setup_start } from "./setup.ts";
import { event_approval_transitioned } from "../approvals/data.ts";
import { table_indexer_progress } from "../indexing/data.ts";

export const workflow_accounts_referrals_qualify = defineWorkflow({
  id: "accounts.referrals.qualify",
  title: "Qualify the referral that brought a person whose Safe went live",
  about:
    "Started by each indexed CapxulSafeClaimed: a person's Safe is live with their signer, which is what earns the " +
    "referrer a reward. It finds the setup of the event's Safe, so the mailbox, and the referral that brought that " +
    "mailbox. In one transaction: a friend on a throwaway mail domain voids the referral (`disposable_email`); otherwise " +
    "the referral is qualified, and the referrer rewarded: a referrer still waiting is admitted `reward:<friend>` and the " +
    "referral rewarded `admission`; an admitted referrer gets one invite while the start and the rewards stay within 10, " +
    "and the referral is rewarded `invites`; at the cap it stays qualified. Counting from the chain means a claim earns " +
    "the reward even when the setup that sent it died before recording it.",
  concept: concept_accounts,
  priority: "normal",
  trigger: { chainEvent: contract_companies_house_claimer.e.CapxulSafeClaimed },
  instance: { per: table_referrals },
  steps: [
    { name: "find", about: "The setup by the event's Safe (`by-safe`), then the referral by its mailbox (`by-referee`); none, voided or qualified ends the run." },
    { name: "void-disposable", about: "A friend on one of the ten listed throwaway mail domains: `void` with `disposable_email`, and end." },
    { name: "qualify", about: "`qualify`, with qualified_at." },
    {
      name: "reward",
      about: "A waiting referrer: `admit` (or `admit_unlisted`) `reward:<friend>`, their own referral to `admitted`, and `reward` admission; else one invite within the cap and `reward` invites.",
    },
  ],
  reads: [table_personal_safes, table_referrals, table_referral_codes, table_admissions],
  writes: [table_referrals, table_referral_codes, table_admissions],
  drives: [
    machine_referral.t.qualify,
    machine_referral.t.reward,
    machine_referral.t.void,
    machine_referral.t.admit,
    machine_waitlist_entry.t.admit,
    machine_waitlist_entry.t.admit_unlisted,
  ],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "`qualify:<friend mailbox>`: a referral already qualified or voided changes nothing, so a replayed or reindexed event earns nothing twice.",
  timeoutMs: 30_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
  was: [`${OLD}/access/referrals/operations/qualify.ts:31`, `${OLD}/access/referrals/rules.ts:50`, `${OLD}/access/referrals/writes.ts:136`, `${CLAIMS}/operations/claim.ts:39`],
});
