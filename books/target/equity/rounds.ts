// The rounds area: priced rounds (`org round preview|create|invite|allocate|close|cancel|show`).
// The Board opens, invites, allocates, closes and cancels each by proposal; the price, the pool
// top-up and the SAFE conversions are worked out here, so the flow can check the calls it signs. Each
// round's process (processes.ts) decides its writes and moves the round and its investors.

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_equity } from "../shared/foundation.ts";
import { contract_captable, contract_governor, contract_options, contract_rounds } from "../shared/external.ts";
import { error_AUTHORISED_EXCEEDED, error_CONSENT_MISSING, error_RESERVED_MATTER, error_ROUND_CLOSED } from "../shared/vocabulary.ts";
import { table_chain_logs, table_equity_instruments, table_equity_positions } from "../indexing/data.ts";
import {
  machine_equity_write,
  machine_fundraise_investment,
  machine_fundraise_round,
  table_equity_writes,
  table_fundraise_investments,
  table_fundraise_rounds,
  table_votes,
} from "./data.ts";
import {
  BOARD_ABOUT,
  BOARD_ERRORS,
  CHAIN_READ_ERRORS,
  DIRECTOR,
  GUARD_WAS,
  MEMBER,
  MEMBER_READ_ERRORS,
  OLD,
  PROPOSE_ABOUT,
  READS_CHAIN,
  RESOLVE,
} from "./guards.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import {
  AllocateInput,
  InviteInput,
  Prepared,
  RoundCreateInput,
  RoundPreviewReturns,
  RoundRef,
  RoundShowReturns,
  RoundTermsInput,
} from "./shapes.ts";

const ROUNDS = `${OLD}/rounds`;
const DESIGNED = (id: string) => `books/frozen/operations.ts (${id}, designed)`;
/** The v4 contracts the round checks mirror, in the old repository. */
const V4 = "packages/contracts/v4/src";

/** The pricing every priced round shares, in words. */
const PRICING =
  "The fully diluted shares are every class's issued shares (indexing's positions), the option pool (`Options.pool`) " +
  "and the pool top-up that brings the pool to `--pool-target` after the round; the price is the pre-money over them " +
  "and the shares the raise buys the raise over the price, both rounded down to the token's unit and a whole share. " +
  "With `--convert-safes`, each outstanding SAFE note (indexing's positions) converts at the lower of its cap price and " +
  "its discounted price. A class whose conversion price (`Captable.getClass`) is above the new price makes it a down " +
  "round, which needs that class's consent at close.";

/** The reads every priced round's pricing makes. */
const PRICING_READS = [table_equity_instruments, table_equity_positions] as const;
const PRICING_CHAIN = [contract_options.f.pool, contract_captable.f.getClass, contract_rounds.f.safeNote] as const;

/** A Board matter on an existing round reads and touches the same rows. */
const ROUND_MATTER = {
  reads: [...DIRECTOR, table_fundraise_rounds, table_fundraise_investments, table_equity_writes],
  writes: [table_equity_writes],
  drives: [machine_equity_write.t.open],
  invokes: [procedure_board_propose],
  emits: [],
  calls: [...READS_CHAIN],
  spans: [],
} as const;

export const rpc_equity_rounds_preview = defineRpc({
  id: "equity.rounds.preview",
  title: "Price a round from its pre-money valuation, without proposing it",
  about:
    "A member of the company, with its `equity` gate on (FEATURE_NOT_AVAILABLE), names a class and the round's pre-money " +
    "and raise. The class must exist: shareholders create a class first (RESERVED_MATTER). " +
    PRICING +
    " It answers the price, the post-money, the pool top-up, each SAFE that converts and its shares, and whether it is " +
    "a down round with the classes whose consent it needs. Nothing is written.",
  was: [DESIGNED("org.round.create"), "books/frozen/operations.ts (org.round.preview)"],
  concept: concept_equity,
  kind: "action",
  who: "A member of the company.",
  input: RoundTermsInput,
  output: RoundPreviewReturns,
  errors: [...MEMBER_READ_ERRORS, ...CHAIN_READ_ERRORS, error_RESERVED_MATTER],
  reads: [...MEMBER, ...PRICING_READS],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [...PRICING_CHAIN],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_equity_rounds_create = defineRpc({
  id: "equity.rounds.create",
  title: "Propose a priced round to the Board",
  about:
    BOARD_ABOUT +
    " The class must be the company's (RESERVED_MATTER: shareholders create it), `--closes` ahead and the raise " +
    "a whole share or more (INVALID_INPUT). " +
    PRICING +
    " The shares must fit what the class may still issue (AUTHORISED_EXCEEDED). Each class a down round affects with " +
    "a class Governor must be in the `approve-round` vote `--approved-by` names, one not failed, lapsed, defeated, " +
    "canceled or expired (equity's votes; `Governor.state`), else CONSENT_MISSING names it. " +
    "The terms go through `documents.store`; in one transaction the round is born `proposed` " +
    "(fundraise-round.propose), starting its process, with its write. " +
    PROPOSE_ABOUT +
    " The one call is `Rounds.createPricedRound(classId, token, price, maxShares, payBy, termsHash)`.",
  was: [`${ROUNDS}/operations/create.ts`, `${ROUNDS}/writes.ts`, DESIGNED("org.round.create"), ...GUARD_WAS, `${V4}/equity/Rounds.sol:272`],
  concept: concept_equity,
  kind: "action",
  who: "A Director of the company.",
  input: RoundCreateInput,
  output: Prepared,
  errors: [...BOARD_ERRORS, error_AUTHORISED_EXCEEDED, error_RESERVED_MATTER, error_CONSENT_MISSING],
  reads: [...DIRECTOR, ...PRICING_READS, table_fundraise_rounds, table_equity_writes, table_votes],
  writes: [table_fundraise_rounds, table_equity_writes],
  drives: [machine_fundraise_round.t.propose, machine_equity_write.t.open],
  invokes: [procedure_documents_store, procedure_board_propose],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [
    ...PRICING_CHAIN,
    contract_captable.f.convertibleReserved,
    contract_captable.f.closedForExit,
    contract_governor.f.state,
    contract_rounds.f.createPricedRound,
  ],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_equity_rounds_invite = defineRpc({
  id: "equity.rounds.invite",
  title: "Propose investors' invitations to a priced round",
  about:
    BOARD_ABOUT +
    " The round must be the company's and open, its pay-by day not passed (ROUND_CLOSED: the round has closed). Each " +
    "investor is an email, `@handle` or address resolved to a Party and its Safe (INVALID_INPUT), with the most they " +
    "may commit. In one transaction each investor not yet invited gets a commitment born `proposed` " +
    "(fundraise-investment.propose) with the round's one write. " +
    PROPOSE_ABOUT +
    " The proposal holds one `Rounds.invite(roundId, investor, maxAmount)` per investor.",
  was: ["books/frozen/operations.ts (org.round.invite)", DESIGNED("org.round.create")],
  concept: concept_equity,
  kind: "action",
  who: "A Director of the company.",
  input: InviteInput,
  output: Prepared,
  errors: [...BOARD_ERRORS, error_ROUND_CLOSED],
  ...ROUND_MATTER,
  reads: [...ROUND_MATTER.reads, ...RESOLVE],
  writes: [table_equity_writes, table_fundraise_investments],
  drives: [machine_equity_write.t.open, machine_fundraise_investment.t.propose],
  chain: [contract_rounds.f.pricedRound, contract_rounds.f.invite],
  budget: budget("chain-read"),
});

export const rpc_equity_rounds_allocate = defineRpc({
  id: "equity.rounds.allocate",
  title: "Propose a priced round's allocation, SAFE conversions and pool top-up",
  about:
    BOARD_ABOUT +
    " The round must be open with committed investors (WRONG_STATE). By default each committed investor is allocated " +
    "their full commitment at the round's price; `--investor --shares` overrides one. Together they must fit the " +
    "round's maximum (`Rounds.pricedRound`, INVALID_INPUT: more than the round's maximum). " +
    PROPOSE_ABOUT +
    " The batch: `Rounds.allocate` per investor, `Captable.setIssuerAllowance(rounds, classId, allocated)`, " +
    "`Rounds.convertSafes(noteIds, roundId, capitalization)` when the round converts SAFEs, and `Options.setPool` for " +
    "the top-up. It answers each investor's shares, amount and pay-by day.",
  was: ["books/frozen/operations.ts (org.round.allocate)", DESIGNED("org.round.allocate")],
  concept: concept_equity,
  kind: "action",
  who: "A Director of the company.",
  input: AllocateInput,
  output: Prepared,
  errors: [...BOARD_ERRORS],
  ...ROUND_MATTER,
  reads: [...ROUND_MATTER.reads, ...RESOLVE, table_equity_positions],
  chain: [
    contract_rounds.f.pricedRound,
    contract_rounds.f.position,
    contract_rounds.f.allocate,
    contract_captable.f.setIssuerAllowance,
    contract_rounds.f.convertSafes,
    contract_options.f.setPool,
  ],
  budget: budget("chain-read"),
});

export const rpc_equity_rounds_close = defineRpc({
  id: "equity.rounds.close",
  title: "Propose a priced round's close, with its anti-dilution",
  about:
    BOARD_ABOUT +
    " The round must be open or allocated (WRONG_STATE: it closed or was cancelled, as `RoundIsClosed` or " +
    "`RoundIsCancelled` would revert) and, before its pay-by day, every allocation paid (WRONG_STATE: an allocation is " +
    "still payable, as `InvalidRound(\"allocations still payable\")` would revert; its investors and `Rounds.pricedRound`). " +
    "Every earlier class whose conversion price is above the " +
    "round's price is adjusted by its broad-based weighted average at close; each such class must have consented " +
    "(its class Governor's `approve-round` vote, indexing's ConsentGiven), else CONSENT_MISSING names it. " +
    PROPOSE_ABOUT +
    " The one call is `Rounds.close(roundId, deemedOutstandingA)`. It answers each class's conversion price before " +
    "and after; unpaid allocations lapse once it lands.",
  was: ["books/frozen/operations.ts (org.round.close)", DESIGNED("org.round.close"), `${V4}/equity/Rounds.sol:257`],
  concept: concept_equity,
  kind: "action",
  who: "A Director of the company.",
  input: RoundRef,
  output: Prepared,
  errors: [...BOARD_ERRORS, error_CONSENT_MISSING],
  ...ROUND_MATTER,
  reads: [...ROUND_MATTER.reads, table_chain_logs, table_equity_positions],
  chain: [contract_rounds.f.pricedRound, contract_captable.f.getClass, contract_rounds.f.close],
  budget: budget("chain-read"),
});

export const rpc_equity_rounds_cancel = defineRpc({
  id: "equity.rounds.cancel",
  title: "Propose a priced round's cancellation before any payment",
  about:
    BOARD_ABOUT +
    " The round must be open or allocated and no investor may have paid (WRONG_STATE: an investor has already paid). " +
    PROPOSE_ABOUT +
    " The one call is `Rounds.cancel(roundId)`; the round is `cancelled` once it lands.",
  was: ["books/frozen/operations.ts (org.round.cancel)", DESIGNED("org.round.close")],
  concept: concept_equity,
  kind: "action",
  who: "A Director of the company.",
  input: RoundRef,
  output: Prepared,
  errors: [...BOARD_ERRORS],
  ...ROUND_MATTER,
  chain: [contract_rounds.f.pricedRound, contract_rounds.f.cancel],
  budget: budget("chain-read"),
});

export const rpc_equity_rounds_show = defineRpc({
  id: "equity.rounds.show",
  title: "Read one priced round and its investors",
  about:
    "A member of the company, with its `equity` gate on (FEATURE_NOT_AVAILABLE), reads one round by its `rd_` id " +
    "(INVALID_INPUT: no round has that id): its status, what has been committed and paid of the raise, and each " +
    "investor with their commitment, allocation and whether they paid, from its investments and indexing's positions.",
  was: ["books/frozen/operations.ts (org.round.show)"],
  concept: concept_equity,
  kind: "query",
  who: "A member of the company.",
  input: RoundRef,
  output: RoundShowReturns,
  errors: [...MEMBER_READ_ERRORS],
  reads: [...MEMBER, table_fundraise_rounds, table_fundraise_investments, table_equity_positions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
