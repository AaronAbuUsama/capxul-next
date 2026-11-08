// The directors area: the Board as the chain answers it, and the Board changes a person makes from
// their own Safe. None of these is a Board proposal: the Signer Gate refuses every owner and threshold
// change the company Safe makes, so the Directors are changed by whoever wears the Shareholders' top
// hat (the founder's Safe until the handover, then the Governor, by a shareholder vote), an elected
// Director claims their own seat, and anyone in the Organization may drop the signers whose hat lapsed.
//
// A write is one rpc and one transaction (A3): it refuses before anything is saved, reads what the
// chain holds now, builds the calls from the actor's own Safe, and births the change (board-change.open)
// with the actor's approval (`approvals.open`, the change as its subject). Nothing is on chain when it
// returns; the change's process follows the approval (processes.ts), the SDK flow the signature and
// the wait (flows.ts). Only one Board change is under way in an Organization at a time.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_board } from "../shared/foundation.ts";
import { contract_hats, contract_hats_signer_gate, contract_safe, integration_chain_rpc } from "../shared/external.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_RESERVED_MATTER,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_org_deployments, table_org_members, table_organizations } from "../organizations/data.ts";
import { table_chain_deployments, table_chain_hats, table_hat_wearers, table_safe_owners } from "../indexing/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { Threshold, machine_board_change, table_board_changes, table_board_proposals } from "./data.ts";

const OLD = "packages/backend/src/organizations/directors";
const PROPOSALS = "packages/backend/src/organizations/proposals";
const AS_IS = "docs/as-is/archive/organizations/directors.ts";
const S = Schema.String;
const Int = Schema.Int;
const NullOr = Schema.NullOr;

// ── shapes ──────────────────────────────────────────────────────────────────────────────────

export const OrgInput = Schema.Struct({ orgId: S });
export const SeatInput = Schema.Struct({ orgId: S, email: S });
export const ThresholdInput = Schema.Struct({ orgId: S, n: Int });
export const ClaimInput = Schema.Struct({ orgId: S, seat: NullOr(S) });
export const ChangeInput = Schema.Struct({ orgId: S, changeId: S });

const Person = Schema.Struct({ name: NullOr(S), email: NullOr(S), safe: S });

/** `org board show`: each Director as the chain answers now, and the threshold. */
export const BoardView = Schema.Struct({
  orgId: S,
  threshold: Threshold,
  directors: Schema.Array(
    Schema.Struct({
      address: S,
      label: NullOr(S),
      isCaller: Schema.Boolean,
      signer: Schema.Boolean,
      seat: NullOr(S),
      electedBy: NullOr(S),
      termEnds: NullOr(S),
    }),
  ),
});

/** `org director list`: the company Safe, its signers, threshold, next nonce and waiting proposals. */
export const SafeView = Schema.Struct({
  orgId: S,
  chainId: Int,
  safeAddress: S,
  threshold: Int,
  nonce: Int,
  owners: Schema.Array(Schema.Struct({ address: S, label: NullOr(S), isCaller: Schema.Boolean, signer: Schema.Boolean })),
  waiting: Int,
});

/** A Board change as every Board write answers it, and as `org(orgId).board.directors.get` reads it. */
export const BoardChangeView = Schema.Struct({
  changeId: S,
  orgId: S,
  action: table_board_changes.fields.fields.action,
  status: table_board_changes.fields.fields.status,
  person: NullOr(Person),
  removed: Schema.Array(Person),
  seat: NullOr(S),
  directors: Int,
  threshold: Threshold,
  before: Threshold,
  approvalId: S,
  url: S,
  outcome: NullOr(Schema.Struct({ code: S, reason: S })),
});

// ── what every Board write shares ───────────────────────────────────────────────────────────

/** The guard every Board rpc runs first. */
const MEMBER =
  "The session's principal must hold a current Seat of the Organization (ROLE_PERMISSION_DENIED otherwise: an " +
  "outsider learns nothing), and the Organization must have its deployment, with the Gate as its company Safe's " +
  "module and guard in indexing's safe-owners (WRONG_STATE otherwise: no installed company, or its Gate does not match).";

const TOP_HAT =
  "The caller's Safe must wear the Shareholders' top hat, read live (`Hats.isWearerOfHat`): when the Governor wears it " +
  "(the Board was handed over) it is RESERVED_MATTER (put it to a vote), otherwise ROLE_PERMISSION_DENIED. When the " +
  "Director hat's eligibility is the company's Elections clone (indexing's chain-hats and chain-deployments), Directors " +
  "are elected: WRONG_STATE.";

const BIRTH =
  "Then, in one transaction, the change is born `awaiting_approval` (board-change.open) with the counts before and " +
  "after, and the actor's approval of the calls from their own Safe (`approvals.open`, opener board, the change as " +
  "subject, its page summary). A Board change already under way in the Organization is WRONG_STATE naming it; one " +
  "change waits at a time, because each is planned from the Board as it stands.";

/** What every Board read and write reads to authorize and to name people. */
const BOARD_READS = [
  table_organizations,
  table_org_deployments,
  table_org_members,
  table_principals,
  table_parties,
  table_safe_owners,
  table_hat_wearers,
] as const;

const READ_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID] as const;
const WRITE_ERRORS = [...READ_ERRORS, error_INVALID_INPUT] as const;

const chainRead = budget("chain-read");
const READ_LIVE = [integration_chain_rpc.c.readContract];

// ── reads ───────────────────────────────────────────────────────────────────────────────────

export const rpc_board_directors_show = defineRpc({
  id: "board.directors.show",
  title: "The Board as the chain answers it now",
  about:
    MEMBER + " Each owner of the company Safe, in the Safe's order (`Safe.getOwners`), with whether the live Gate " +
    "accepts their signature (`isValidSigner`, so an owner whose Director hat lapsed stays listed with signer false " +
    "until a refresh), the current Safe threshold (`getThreshold`) as `needed` of the owners, and each label: the name, " +
    "email or `@handle` their Safe's Party and Seat give, or null for a Safe Capxul does not know. The caller's own Safe " +
    "is marked. Seats, who elects them and terms come with Board elections and are null until then (CAP-1153). The " +
    "reads are live and concurrent; nothing is written.",
  was: [`${PROPOSALS}/operations/safe.ts:1`, "docs/as-is/archive/organizations/proposals.ts:852"],
  concept: concept_board,
  kind: "action",
  who: "Any current member of the Organization.",
  input: OrgInput,
  output: BoardView,
  errors: [...READ_ERRORS],
  reads: [...BOARD_READS],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: READ_LIVE,
  chain: [contract_safe.f.getOwners, contract_safe.f.getThreshold, contract_hats_signer_gate.f.isValidSigner],
  spans: [],
  budget: chainRead,
});

export const rpc_board_directors_safe = defineRpc({
  id: "board.directors.safe",
  title: "The company Safe's signers, threshold, next nonce and waiting proposals",
  about:
    MEMBER + " The company Safe's chain and address, its owners in the Safe's order with each one's live signer status " +
    "and label (as `board.directors.show` reads them), its threshold, the nonce the next proposal executes at (indexing's " +
    "safe-owners) and how many Board proposals still wait for approvals. The caller's own Safe is marked. Nothing is written.",
  was: [`${PROPOSALS}/operations/safe.ts:1`, `${PROPOSALS}/views.ts:9`],
  concept: concept_board,
  kind: "action",
  who: "Any current member of the Organization.",
  input: OrgInput,
  output: SafeView,
  errors: [...READ_ERRORS],
  reads: [...BOARD_READS, table_board_proposals],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: READ_LIVE,
  chain: [contract_safe.f.getOwners, contract_safe.f.getThreshold, contract_hats_signer_gate.f.isValidSigner],
  spans: [],
  budget: chainRead,
});

export const rpc_board_directors_get = defineRpc({
  id: "board.directors.get",
  title: "One Board change, as it stands",
  about:
    "Any current member reads one Board change of the Organization by its `dc_` id: its action, status, the person it " +
    "names, the signers it drops, the Directors and the threshold before and after, its approval and, once it failed, " +
    "why. The status is the change's process's, settled from the chain; nothing is read live. An id the Organization " +
    "does not hold is INVALID_INPUT.",
  was: [`${OLD}/operations/get.ts:1`, `${AS_IS}:515`],
  concept: concept_board,
  kind: "query",
  who: "Any current member of the Organization.",
  input: ChangeInput,
  output: BoardChangeView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_org_members, table_principals, table_board_changes],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

/** Where the caller and the members an old `org director` write names stand on the Board, read before it refuses. */
export const BoardAuthority = Schema.Struct({
  orgId: S,
  /** The company Safe's owners, and its threshold. */
  directors: Int,
  threshold: Int,
  /** The caller's own Safe is an owner of the company Safe. */
  callerIsDirector: Schema.Boolean,
  /** The caller's own Safe wears the Shareholders' top hat. */
  callerWearsTopHat: Schema.Boolean,
  /** The Governor wears the Shareholders' top hat: the Board was handed over. */
  handedOver: Schema.Boolean,
  /** Each email asked about: whether it names a current member, and whether that member's Safe is an owner. */
  people: Schema.Array(Schema.Struct({ email: S, member: Schema.Boolean, director: Schema.Boolean })),
});

export const rpc_board_directors_authority = defineRpc({
  id: "board.directors.authority",
  title: "Who may change the Board now, and where the named members stand on it",
  about:
    MEMBER + " The company Safe's owners and threshold, read live (`Safe.getOwners`, `getThreshold`); whether the " +
    "caller's own Safe is an owner; whether it wears the Shareholders' top hat and whether the Governor does " +
    "(`Hats.isWearerOfHat`, with the hat ids and the Governor from indexing's chain-hats and chain-deployments: the Board " +
    "was handed over); and, for each email asked about (at most two, each non-empty and at most 320 characters, " +
    "INVALID_INPUT otherwise), whether it names a current member of the Organization and whether that member's Safe is " +
    "an owner. Nothing is written. The old `org director` writes read it to give their frozen command's refusals before " +
    "they name the v4 command that makes the change (decision board.director-commands).",
  was: [
    `${PROPOSALS}/operations/change-owners.ts:31`,
    `${PROPOSALS}/rules/owner-changes.ts:117`,
    "apps/cli/src/commands/org/subcommands/director/internal/change.ts:59",
  ],
  concept: concept_board,
  kind: "action",
  who: "Any current member of the Organization.",
  input: Schema.Struct({ orgId: S, people: Schema.Array(S) }),
  output: BoardAuthority,
  errors: [...WRITE_ERRORS],
  reads: [...BOARD_READS, table_chain_hats, table_chain_deployments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: READ_LIVE,
  chain: [contract_safe.f.getOwners, contract_safe.f.getThreshold, contract_hats.f.isWearerOfHat],
  spans: [],
  budget: chainRead,
});

// ── writes from the Shareholders' top hat ───────────────────────────────────────────────────

const WRITE_TOUCHES = {
  writes: [table_board_changes],
  drives: [machine_board_change.t.open],
  invokes: [procedure_approvals_open],
  emits: [],
  calls: READ_LIVE,
  spans: [],
} as const;

export const rpc_board_directors_seat = defineRpc({
  id: "board.directors.seat",
  title: "Seat a member as a Director, from the Shareholders' top hat",
  about:
    MEMBER + " " + TOP_HAT + " The email must name a current member (INVALID_INPUT otherwise) whose Safe is claimed " +
    "(indexing's safe-owners; WRONG_STATE: they have not finished signing up) and does not sign the company Safe yet " +
    "(WRONG_STATE). The calls, from the founder's Safe: `Hats.changeHatMaxSupply(director, supply + 1)` when every " +
    "Director seat is worn, `Hats.mintHat(director, memberSafe)` unless the member already wears the hat, then " +
    "`HatsSignerGate.claimSignerFor(director, memberSafe)`. The threshold stays as the Gate computes it. " + BIRTH,
  was: [`${OLD}/operations/add.ts:1`, `${OLD}/rules.ts:150`, `${AS_IS}:258`],
  concept: concept_board,
  kind: "action",
  who: "The wearer of the Shareholders' top hat: the founder's personal Safe until the handover.",
  input: SeatInput,
  output: BoardChangeView,
  errors: [...WRITE_ERRORS, error_RESERVED_MATTER],
  reads: [...BOARD_READS, table_chain_hats, table_chain_deployments, table_board_changes],
  ...WRITE_TOUCHES,
  chain: [
    contract_hats.f.isWearerOfHat,
    contract_hats_signer_gate.f.isValidSigner,
    contract_hats.f.changeHatMaxSupply,
    contract_hats.f.mintHat,
    contract_hats_signer_gate.f.claimSignerFor,
  ],
  budget: chainRead,
});

export const rpc_board_directors_remove = defineRpc({
  id: "board.directors.remove",
  title: "Remove a Director, from the Shareholders' top hat",
  about:
    MEMBER + " " + TOP_HAT + " The email must name a Director: a member whose Safe is an owner of the company Safe " +
    "(WRONG_STATE otherwise). The last Director, and a removal that would leave fewer Directors than the Gate's " +
    "threshold needs, are WRONG_STATE (the Gate's ThresholdTooLow; lower it first with `org board threshold`). The " +
    "calls, from the founder's Safe: `Hats.setHatWearerStatus(director, directorSafe, false, true)`, which burns the hat " +
    "and keeps the Director in good standing so they can be seated again, then `HatsSignerGate.removeSigner(directorSafe)`, " +
    "which recomputes the threshold; a Safe that already lost the hat is only removed. Never a call into the company " +
    "Safe. " + BIRTH,
  was: [`${OLD}/operations/remove.ts:1`, `${OLD}/rules.ts:200`, `${AS_IS}:306`],
  concept: concept_board,
  kind: "action",
  who: "The wearer of the Shareholders' top hat: the founder's personal Safe until the handover.",
  input: SeatInput,
  output: BoardChangeView,
  errors: [...WRITE_ERRORS, error_RESERVED_MATTER],
  reads: [...BOARD_READS, table_chain_hats, table_chain_deployments, table_board_changes],
  ...WRITE_TOUCHES,
  chain: [
    contract_hats.f.isWearerOfHat,
    contract_hats_signer_gate.f.isValidSigner,
    contract_hats.f.setHatWearerStatus,
    contract_hats_signer_gate.f.removeSigner,
  ],
  budget: chainRead,
});

export const rpc_board_directors_set_threshold = defineRpc({
  id: "board.directors.set-threshold",
  title: "Set how many Directors must sign, from the Shareholders' top hat",
  about:
    MEMBER + " " + TOP_HAT + " `n` of 0, more than the Directors, or the threshold the Board already has is " +
    "INVALID_INPUT. The call, from the founder's Safe: `HatsSignerGate.setThresholdConfig({ thresholdType: ABSOLUTE, " +
    "min: n, target: n })`, and the Gate rewrites the company Safe's threshold; never a call into the company Safe. " +
    "Lowering it to 1 among several Directors is the flow's `--confirm`, not a refusal here. " + BIRTH,
  was: [`${OLD}/external/threshold.ts:1`, `${OLD}/rules.ts:250`, `${AS_IS}:345`],
  concept: concept_board,
  kind: "action",
  who: "The wearer of the Shareholders' top hat: the founder's personal Safe until the handover.",
  input: ThresholdInput,
  output: BoardChangeView,
  errors: [...WRITE_ERRORS, error_RESERVED_MATTER],
  reads: [...BOARD_READS, table_chain_hats, table_chain_deployments, table_board_changes],
  ...WRITE_TOUCHES,
  chain: [contract_hats.f.isWearerOfHat, contract_hats_signer_gate.f.isValidSigner, contract_hats_signer_gate.f.setThresholdConfig],
  budget: chainRead,
});

export const rpc_board_directors_hand_over = defineRpc({
  id: "board.directors.hand-over",
  title: "Hand the Board to the shareholders' Governor",
  about:
    MEMBER + " The caller's Safe must wear the Shareholders' top hat (ROLE_PERMISSION_DENIED). The equity must be " +
    "installed: the company's Governor in indexing's chain-deployments and the equity install's Board proposal (opener " +
    "equity) executed (WRONG_STATE otherwise); a Board the Governor already holds is WRONG_STATE. The calls, from the " +
    "founder's Safe, are the founder calls `Installer.buildEquity` returns, built here from the deployment's hat ids and " +
    "the Governor: `Hats.changeHatEligibility(director, governor)`, `Hats.changeHatToggle(director, governor)`, then " +
    "`Hats.transferHat(shareholdersTopHat, founderSafe, governor)` last. The Directors and the threshold stay. " + BIRTH +
    " So a handover and any other Board change never run together, either way round.",
  was: [`${OLD}/operations/handover.ts:1`, `${OLD}/external/handover.ts:17`, `${OLD}/rules/handover.ts:1`, `${AS_IS}:390`],
  concept: concept_board,
  kind: "action",
  who: "The founder, whose personal Safe wears the Shareholders' top hat, once the equity is installed.",
  input: OrgInput,
  output: BoardChangeView,
  errors: [...WRITE_ERRORS],
  reads: [...BOARD_READS, table_chain_hats, table_chain_deployments, table_board_changes, table_board_proposals],
  ...WRITE_TOUCHES,
  chain: [
    contract_hats.f.isWearerOfHat,
    contract_hats_signer_gate.f.isValidSigner,
    contract_hats.f.changeHatEligibility,
    contract_hats.f.changeHatToggle,
    contract_hats.f.transferHat,
  ],
  budget: chainRead,
});

// ── writes anyone, or an elected Director, makes ────────────────────────────────────────────

export const rpc_board_directors_refresh = defineRpc({
  id: "board.directors.refresh",
  title: "Drop every signer whose Director hat lapsed",
  about:
    MEMBER + " Any member with a claimed personal Safe may run it: the Gate lets anyone remove a Safe that no longer " +
    "wears the hat. The lapsed signers are the owners of the company Safe the live Gate no longer accepts " +
    "(`isValidSigner` false), each named by the member holding the Safe where one does. Nobody lapsed, or every " +
    "Director lapsed (the Board cannot be left empty), is WRONG_STATE. The calls, from the caller's Safe: one " +
    "`HatsSignerGate.removeSigner(signer)` per lapsed signer, which recomputes the threshold. " + BIRTH,
  was: [`${OLD}/operations/refresh.ts:1`, `${OLD}/rules/refresh.ts:1`, `${AS_IS}:433`],
  concept: concept_board,
  kind: "action",
  who: "Any current member of the Organization with a claimed personal Safe.",
  input: OrgInput,
  output: BoardChangeView,
  errors: [...WRITE_ERRORS],
  reads: [...BOARD_READS, table_board_changes],
  ...WRITE_TOUCHES,
  chain: [contract_safe.f.getOwners, contract_hats_signer_gate.f.isValidSigner, contract_hats_signer_gate.f.removeSigner],
  budget: chainRead,
});

export const rpc_board_directors_claim = defineRpc({
  id: "board.directors.claim",
  title: "An elected Director claims their Board seat",
  about:
    MEMBER + " The caller's Safe must wear the Director hat, read live (ROLE_PERMISSION_DENIED: not elected, or the term " +
    "ended), and must not sign the company Safe yet (WRONG_STATE). `--seat` names a seat group; until Board elections " +
    "define groups there is one Director hat, and any other group is INVALID_INPUT. The call, from the caller's own " +
    "Safe: `HatsSignerGate.claimSigner(directorHat)`, which makes it an owner and recomputes the threshold; never a " +
    "Board proposal. " + BIRTH,
  was: [`${OLD}/operations/claim.ts:1`, `${OLD}/rules/claim.ts:1`, `${AS_IS}:475`],
  concept: concept_board,
  kind: "action",
  who: "An elected Director: their personal Safe wears the Director hat but does not sign yet.",
  input: ClaimInput,
  output: BoardChangeView,
  errors: [...WRITE_ERRORS],
  reads: [...BOARD_READS, table_chain_hats, table_board_changes],
  ...WRITE_TOUCHES,
  chain: [contract_hats.f.isWearerOfHat, contract_hats_signer_gate.f.isValidSigner, contract_hats_signer_gate.f.claimSigner],
  budget: chainRead,
});
