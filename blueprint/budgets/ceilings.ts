// The ceilings area: each token's payout ceiling, the Roles allowance on the company's payout role
// (key `keccak256("v4-payout-ceiling:" ++ token)`), the most that can leave the company Safe through
// Budgets in the allowance's period. It is the backstop, never the limit: budgets are. Every ceiling
// write is a Board proposal of the batch `Installer.buildSetCeiling` returns (one
// `Roles.setAllowance`). One ceiling write waits per token at a time, because each plans from the
// allowance as it is now, so a second would undo the first.

import { budget, defineRpc } from "../../packages/blueprint-engine/src/index.ts";
import { concept_budgets } from "../shared/foundation.ts";
import { contract_budgets, contract_installer, contract_roles, integration_chain_rpc } from "../shared/external.ts";
import { error_TOKEN_NOT_SUPPORTED } from "../shared/vocabulary.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { machine_budget_change, table_budget_changes } from "./data.ts";
import { CeilingFreezeInput, CeilingPrepared, CeilingSetInput, CeilingUnfreezeInput } from "./shapes.ts";
import { BIRTH, GUARD, WRITE_ERRORS, WRITE_READS } from "./departments.ts";

const PAY = "packages/backend/src/payroll/departments/operations";
const AS_IS = "docs/as-is/archive/payroll/departments.ts";

const WHO_BOARD = "A Director of the Organization: the Board signs every payout ceiling write.";

const BOARD_ONLY =
  "The caller must wear the Director hat (ROLE_PERMISSION_DENIED otherwise; nothing is saved). No other write to the " +
  "token's ceiling may wait, a top budget's create or amount included (WRONG_STATE, naming that proposal).";

const CEILING_TOUCHES = {
  reads: [...WRITE_READS],
  writes: [table_budget_changes],
  drives: [machine_budget_change.t.propose],
  invokes: [procedure_board_propose],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  spans: [],
} as const;

export const rpc_budgets_ceilings_set = defineRpc({
  id: "budgets.ceilings.set",
  title: "Prepare a token's payout ceiling",
  about:
    GUARD + " " + BOARD_ONLY + " The token must be one the deployment admits (TOKEN_NOT_SUPPORTED) and have a ceiling: a " +
    "token no budget pays in has none (WRONG_STATE). The amount, per the ceiling's own period, defaults to the sum of " +
    "the token's live top budgets; below that sum, each counting the larger of its amount and what it committed, it is " +
    "INVALID_INPUT naming the minimum (from indexing's top budgets and `Budgets.budgetOf` now). A resize keeps what this " +
    "period paid and changes only what is left; other tokens' ceilings stay as they are. The calls are " +
    "`Installer.buildSetCeiling`'s, from `Roles.allowances` now. " + BIRTH,
  was: [`${PAY}/set-ceiling.ts:1`, `${AS_IS}:466`],
  concept: concept_budgets,
  kind: "action",
  who: WHO_BOARD,
  input: CeilingSetInput,
  output: CeilingPrepared,
  errors: [...WRITE_ERRORS, error_TOKEN_NOT_SUPPORTED],
  ...CEILING_TOUCHES,
  chain: [contract_roles.f.allowances, contract_budgets.f.budgetOf, contract_installer.f.buildSetCeiling, contract_roles.f.setAllowance],
  budget: budget("chain-read"),
});

export const rpc_budgets_ceilings_freeze = defineRpc({
  id: "budgets.ceilings.freeze",
  title: "Prepare a payout freeze in one token",
  about:
    GUARD + " " + BOARD_ONLY + " The token must have a ceiling (WRONG_STATE) that is not frozen already (WRONG_STATE: " +
    "frozen means no refill). `leave` (0 by default) can be at most what the ceiling has left now (INVALID_INPUT, naming " +
    "the most). The freeze sets the ceiling to `leave` with no refill, so collections and spends in that token are " +
    "refused before anything is signed; other tokens still pay and payees stay owed. The change keeps the allowance it " +
    "replaced (`terms.restore`), which the unfreeze restores. The calls are `Installer.buildSetCeiling`'s. " + BIRTH,
  was: [`${PAY}/freeze-ceiling.ts:1`, `${AS_IS}:490`],
  concept: concept_budgets,
  kind: "action",
  who: WHO_BOARD,
  input: CeilingFreezeInput,
  output: CeilingPrepared,
  errors: [...WRITE_ERRORS],
  ...CEILING_TOUCHES,
  chain: [contract_roles.f.allowances, contract_installer.f.buildSetCeiling, contract_roles.f.setAllowance],
  budget: budget("chain-read"),
});

export const rpc_budgets_ceilings_unfreeze = defineRpc({
  id: "budgets.ceilings.unfreeze",
  title: "Prepare the end of a payout freeze in one token",
  about:
    GUARD + " " + BOARD_ONLY + " The token must be frozen now (WRONG_STATE). The freeze to undo is the token's last " +
    "applied freeze change: none, because it was frozen outside Capxul, is WRONG_STATE (`frozen_outside_capxul`: no " +
    "freeze Capxul proposed says what to restore), and so is a ceiling the chain no longer holds as that freeze left it. " +
    "The unfreeze restores the allowance the freeze kept, its amount and refill, with what was left less all of `leave`, " +
    "spent or not, so nothing pays twice. The calls are `Installer.buildSetCeiling`'s. " + BIRTH,
  was: [`${PAY}/unfreeze-ceiling.ts:1`, `${AS_IS}:514`],
  concept: concept_budgets,
  kind: "action",
  who: WHO_BOARD,
  input: CeilingUnfreezeInput,
  output: CeilingPrepared,
  errors: [...WRITE_ERRORS],
  ...CEILING_TOUCHES,
  chain: [contract_roles.f.allowances, contract_installer.f.buildSetCeiling, contract_roles.f.setAllowance],
  budget: budget("chain-read"),
});
