// The holdings area: who owns what. The company's cap table (`org cap-table`), a holder's own shares
// across companies (`shares`), and the two writes a holder makes on their own shares alone: a
// conversion into Common (`shares convert`) and a delegation of a class's votes (`vote delegate`).
// Neither write changes a long-lived object, so equity.writes.follow decides them (processes.ts).

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_equity } from "../shared/foundation.ts";
import { contract_captable, contract_options, contract_share_class, contract_vesting } from "../shared/external.ts";
import { error_NOT_AUTHENTICATED, error_NOT_IMPLEMENTED, error_SHARES_LOCKED } from "../shared/vocabulary.ts";
import { table_equity_instruments, table_equity_positions } from "../indexing/data.ts";
import { table_principals } from "../access/data.ts";
import { table_organizations } from "../organizations/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { machine_equity_write, table_equity_grants, table_equity_writes, table_fundraise_investments } from "./data.ts";
import { APPROVE_ABOUT, CHAIN_READ_ERRORS, HOLDER, HOLDER_ERRORS, MEMBER, MEMBER_READ_ERRORS, OLD, READS_CHAIN, RESOLVE } from "./guards.ts";
import {
  CapTableInput,
  CapTableReturns,
  ConvertInput,
  DelegateInput,
  Prepared,
  SharesInput,
  SharesReturns,
} from "./shapes.ts";

const DESIGNED = (id: string) => `books/frozen/operations.ts (${id}, designed)`;

export const rpc_equity_holdings_cap_table = defineRpc({
  id: "equity.holdings.cap-table",
  title: "Read the company's cap table from the chain",
  about:
    "A member of the company (ROLE_PERMISSION_DENIED: you are not in the company), its `equity` gate on " +
    "(FEATURE_NOT_AVAILABLE) and equity installed (WRONG_STATE). Each class's holders and shares come from indexing's " +
    "positions (every Transfer of each class token), its weight and conversion terms from `Captable.getClass`; the pool " +
    "and the options granted from it from `Options.pool` and `allocated`. A holder is named once, by their member when " +
    "they are one (the founders and each issue's recipient); shares held by an address Capxul did not issue to count " +
    "once, as `Other holders`. Shares are by class and as converted; with `--fully-diluted`, the options granted and the " +
    "unallocated pool are added and each holder gets their fraction. `at` is when the chain was read (indexing's head). " +
    "`--at` (a past date, from the class tokens' checkpoints) is NOT_IMPLEMENTED until those reads are recorded.",
  was: [`${OLD}/equity/operations/cap-table.ts`, `${OLD}/equity/external/cap-table.ts`, `${OLD}/equity/reads/cap-table.ts`, DESIGNED("org.cap-table")],
  concept: concept_equity,
  kind: "action",
  who: "A member of the company.",
  input: CapTableInput,
  output: CapTableReturns,
  errors: [...MEMBER_READ_ERRORS, ...CHAIN_READ_ERRORS, error_NOT_IMPLEMENTED],
  reads: [...MEMBER, ...RESOLVE, table_equity_instruments, table_equity_positions, table_equity_grants],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_captable.f.getClass, contract_options.f.pool, contract_options.f.allocated],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_equity_holdings_list = defineRpc({
  id: "equity.holdings.list",
  title: "What your Safe owns and has vested, in every company",
  about:
    "Signed in (NOT_AUTHENTICATED), the caller's own Safe's positions across companies (or one, `--org`), from " +
    "indexing's positions by holder: shares by class with what vesting still locks (`Vesting.lockedOf`), grants waiting " +
    "for them to accept (with the agreement's hash and the command to accept), options with what has vested " +
    "(`Options.vestedOf`) and been exercised, and SAFEs. The companies are named by their Organizations.",
  was: [DESIGNED("shares")],
  concept: concept_equity,
  kind: "action",
  who: "Any shareholder or grantee, about themselves.",
  input: SharesInput,
  output: SharesReturns,
  errors: [error_NOT_AUTHENTICATED, ...CHAIN_READ_ERRORS],
  reads: [table_principals, table_organizations, table_equity_positions, table_equity_instruments, table_equity_grants, table_fundraise_investments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_vesting.f.lockedOf, contract_options.f.vestedOf],
  spans: [],
  budget: budget("chain-read"),
});

const HOLDER_WRITE = {
  reads: [...HOLDER, table_equity_positions, table_equity_instruments, table_equity_writes],
  writes: [table_equity_writes],
  drives: [machine_equity_write.t.open],
  invokes: [procedure_approvals_open],
  emits: [],
  calls: [...READS_CHAIN],
  spans: [],
} as const;

export const rpc_equity_holdings_convert = defineRpc({
  id: "equity.holdings.convert",
  title: "Prepare a conversion of preferred shares into Common",
  about:
    "Signed in with a claimed personal Safe (SMART_ACCOUNT_MISSING), in a company whose `equity` gate is on " +
    "(FEATURE_NOT_AVAILABLE) and installed (WRONG_STATE). The class must be the company's and convert (`Captable.getClass`, " +
    "INVALID_INPUT: the class does not convert); the shares must be held and not locked by vesting " +
    "(`balanceOf`, `Vesting.lockedOf`, SHARES_LOCKED). " +
    APPROVE_ABOUT +
    " The one call is `Captable.convert(classId, shares)`, at the class's current ratio.",
  was: [DESIGNED("shares.convert")],
  concept: concept_equity,
  kind: "action",
  who: "The shareholder, from their own Safe.",
  input: ConvertInput,
  output: Prepared,
  errors: [...HOLDER_ERRORS, error_SHARES_LOCKED],
  ...HOLDER_WRITE,
  chain: [contract_captable.f.getClass, contract_share_class.f.balanceOf, contract_vesting.f.lockedOf, contract_captable.f.convert],
  budget: budget("chain-read"),
});

export const rpc_equity_holdings_delegate = defineRpc({
  id: "equity.holdings.delegate",
  title: "Prepare a delegation of a class's votes",
  about:
    "Signed in with a claimed personal Safe (SMART_ACCOUNT_MISSING; NOT_AUTHENTICATED without a sign-in). `--class` must " +
    "name a share class of the company and `--to` someone Capxul knows: an email, `@handle`, address, or yourself " +
    "(INVALID_INPUT). " +
    APPROVE_ABOUT +
    " The one call is `ShareClass.delegate(delegatee)` on the class token, since the Captable's own `delegate` reverts.",
  was: [DESIGNED("vote.delegate")],
  concept: concept_equity,
  kind: "action",
  who: "A shareholder, from their own Safe.",
  input: DelegateInput,
  output: Prepared,
  errors: [...HOLDER_ERRORS],
  ...HOLDER_WRITE,
  chain: [contract_share_class.f.delegate],
  budget: budget("chain-read"),
});
