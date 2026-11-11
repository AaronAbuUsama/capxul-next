// The as-is Core SDK flows of the old organizations concept, part two: the governance methods of
// `client.org(orgId).proposals`, `.board`, `.equity`, `.options`, `.rounds`, `.safes`, `.votes`, and
// `client.me.shares` / `client.me.votes` (packages/sdk/src/organizations/), that compose more than one
// backend call or do local work (a signature, a check of what the backend opened, a poll). Methods
// that forward one rpc are listed in the comment at the end of this file, with the rpc each forwards.
//
// Every method runs under `scopedRunner` / `runCapxulEffect` (proposals.ts:196, platform/capxul-effect.ts:92):
// one client span named by its CAPXUL_OPERATIONS name, CANCELLED on an aborted signal or a passed
// deadline, UNKNOWN for a defect. The `wait` and signing methods give the runner a two-minute deadline
// unless the caller sets one, and poll every two seconds; a timeout is a cancelled read, not a failure.
// Paths in `was` are relative to the old repository root (/home/user/factory).

import { Schema } from "effect";
import { defineFlow, type FlowSpec } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { integration_openfort } from "../shared/external.ts";
import {
  error_CANCELLED,
  error_CAPABILITY_UNAVAILABLE,
  error_INVALID_INPUT,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_SIGNER_REJECTED,
  error_UNKNOWN,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { rpc_accounts_approvals_approve } from "../accounts/approvals.ts";
import {
  rpc_organizations_proposals_get,
  rpc_organizations_proposals_pay,
  rpc_organizations_proposals_request_approval,
  Approval,
  SafeProposal,
} from "./proposals.ts";
import {
  rpc_organizations_directors_add,
  rpc_organizations_directors_claim,
  rpc_organizations_directors_get,
  rpc_organizations_directors_handover,
  rpc_organizations_directors_refresh,
  rpc_organizations_directors_remove,
  rpc_organizations_directors_set_threshold,
} from "./directors.ts";
import {
  rpc_organizations_equity_approve_transfer,
  rpc_organizations_equity_create_safe_round,
  rpc_organizations_equity_grant_options,
  rpc_organizations_equity_issue,
  rpc_organizations_equity_sell,
  rpc_organizations_equity_setup,
  rpc_organizations_equity_transfer,
} from "./equity.ts";
import { rpc_organizations_rounds_create } from "./rounds.ts";
import {
  rpc_organizations_votes_ballot,
  rpc_organizations_votes_cast,
  rpc_organizations_votes_create,
  rpc_organizations_votes_execute,
  rpc_organizations_votes_execution,
  rpc_organizations_votes_get,
} from "./votes.ts";

type Steps = (typeof FlowSpec.Type)["steps"];
type Step = Steps[number];

const SDK = "packages/sdk/src/organizations";
const RUNNER_WAS = [`${SDK}/proposals.ts:196`, "packages/sdk/src/platform/capxul-effect.ts:92"];

// ── shared shapes ──────────────────────────────────────────────────────────────────────────

/** `OrgProposalOptions` (proposals.ts:52): an AbortSignal only. */
const Options = Schema.optionalKey(Schema.Struct({ signal: Schema.optionalKey(Schema.Unknown) }));
/** `OrgProposalWaitOptions` (proposals.ts:54): the signal, the wait's deadline and the poll interval. */
const WaitOptions = Schema.optionalKey(
  Schema.Struct({
    signal: Schema.optionalKey(Schema.Unknown),
    timeoutMs: Schema.optionalKey(Schema.Number),
    pollMs: Schema.optionalKey(Schema.Number),
  }),
);
/** A document given as text or bytes, hashed here, or a keccak256 already made. */
const Hashable = Schema.Union([
  Schema.String,
  Schema.Struct({ hash: Schema.String }),
  Schema.Struct({ bytes: Schema.Unknown }),
]);
/** The Board change view (`DirectorChangeView`), as organizations.directors.get answers it: too wide to transcribe here. */
const DirectorChangeView = Schema.Unknown;
const BoardThreshold = Schema.Struct({ needed: Schema.Number, of: Schema.Number });
const BoardPerson = Schema.NullOr(Schema.Struct({ name: Schema.NullOr(Schema.String), email: Schema.NullOr(Schema.String), safe: Schema.String }));
/** `DirectorSeated`, `DirectorRemoved`, `BoardClaimed` (board.ts:41, board-claim.ts:31): the Board after the change. */
const seatResult = (status: "seated" | "removed") =>
  Schema.Struct({ status: Schema.Literal(status), directors: Schema.Number, threshold: BoardThreshold, changeId: Schema.String, person: BoardPerson });

const signerCalls = [integration_openfort.c.getAddress, integration_openfort.c.signUserOpHash];

/** Errors every flow's runner adds. */
const RUNNER_ERRORS = [error_CANCELLED, error_UNKNOWN];
/** A signing flow without a configured signer, and what the signer can throw (`signerFailure`). */
const SIGNER_ERRORS = [error_CAPABILITY_UNAVAILABLE, error_SIGNER_REJECTED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID];

// ── shared steps ───────────────────────────────────────────────────────────────────────────

const needSigner = (method: string): Step => ({
  name: "signer",
  local: "build",
  about: `No configured signer is CAPABILITY_UNAVAILABLE (signer, ${method}) before any call.`,
});

/**
 * Sign an opened approval and record the signature (`signOwnerApproval`, `signSeatApproval`, `signSaleApproval`,
 * `signVoteApproval`): an approval already approved or consumed is returned as it is; the signer's address; the
 * approval must describe its digest on the client's chain (`describedOperation`) and be of this kind for this signer
 * (INVALID_INPUT); then `signUserOpHash(digest)` and Accounts' accounts.approvals.approve.
 */
const signApproval = (kind: string): Steps => [
  {
    name: "check-approval",
    local: "sign",
    about:
      `getAddress(); the approval must be a \`${kind}\` approval for that signer whose UserOperation hashes to its digest ` +
      "on the client's chain, else INVALID_INPUT. An approval already approved or consumed skips signing.",
  },
  { name: "sign", local: "sign", about: "CapxulSigner.signUserOpHash(approval.operation.digest); a throw becomes SIGNER_REJECTED or a provider error." },
  { name: "approve", rpc: rpc_accounts_approvals_approve, about: "Records the signature; Capxul sends the operation once approved." },
];
const SIGN_WAS = [`${SDK}/proposals.ts:159`, `${SDK}/proposals.ts:167`, `${SDK}/board-approval.ts:31`, `${SDK}/shares.ts:118`, `${SDK}/vote-approval.ts:26`, "packages/sdk/src/accounts/approval-rules.ts:66"];

/** Poll a read until a wanted status; a failed or lapsed one is WRONG_STATE (`untilStatus`, board-approval.ts:63). */
const poll = (read: Step, want: string): Steps => [
  read,
  {
    name: "poll",
    local: "poll",
    about: `Until ${want}: \`failed\` or \`lapsed\` is WRONG_STATE; otherwise sleeps pollMs (2 s) and reads again, until the runner's deadline (2 min) cancels.`,
  },
];

/** A Board write's ask for the Director's approval once the backend proposed it (equity, options, rounds, safes). */
const requestApproval: Step = {
  name: "request-approval",
  rpc: rpc_organizations_proposals_request_approval,
  about: "Opens this Director's approval of the new proposal; the result carries it and its id.",
};

// ── proposals ──────────────────────────────────────────────────────────────────────────────

export const flow_client_org_proposals_pay = defineFlow({
  id: "client.org.proposals.pay",
  title: "A Director proposes a payment, checked against what was asked",
  about:
    "`client.org(orgId).proposals.pay({ to, amount, note, on })`. `scheduledOn(on)` (Payments' helper) reads a UTC day or " +
    "an ISO time with its zone into `at` (INVALID_INPUT otherwise). organizations.proposals.pay proposes it. " +
    "`checkDirectorPayment` then checks the stored proposal before anyone approves: a transaction must be one payment from " +
    "the Organization Safe of the asked asset and amount, to the asked address when one was named (on Protocol v4 " +
    "`approve` and one exact `Payments.send`, or a dated one exact `Budgets.schedule`; before it one ERC-20 transfer), and " +
    "the Safe transaction must make those calls; a nonce-less scheduled payment is not checked here. A mismatch is " +
    "INVALID_INPUT naming the proposal to reject; the proposal stays stored.",
  was: [`${SDK}/proposals.ts:106`, `${SDK}/proposals.ts:253`, `${SDK}/proposals.ts:256`, `${SDK}/proposals.ts:269`, `${SDK}/director-payment-check.ts:25`, `${SDK}/director-payment-check.ts:40`, `${SDK}/director-payment-check.ts:68`, ...RUNNER_WAS],
  component: component_core_sdk,
  sdk: "client.org(orgId).proposals.pay",
  input: Schema.Struct({
    to: Schema.Unknown,
    amount: Schema.Struct({ asset: Schema.String, value: Schema.String }),
    note: Schema.optionalKey(Schema.String),
    on: Schema.optionalKey(Schema.String),
    options: Options,
  }),
  output: SafeProposal,
  steps: [
    { name: "timing", local: "build", about: "`scheduledOn(on)`: a UTC day or zoned ISO time to `at`; unreadable is INVALID_INPUT." },
    { name: "propose", rpc: rpc_organizations_proposals_pay },
    { name: "check", local: "build", about: "`checkDirectorPayment`: the calls pay exactly what was asked, else INVALID_INPUT naming the proposal." },
  ],
  errors: [error_INVALID_INPUT, ...RUNNER_ERRORS],
  calls: [],
  spans: ["org.proposals.pay"],
});

export const flow_client_org_proposals_approve = defineFlow({
  id: "client.org.proposals.approve",
  title: "Open and sign a Director's approval with the configured signer",
  about:
    "`client.org(orgId).proposals.approve(proposalId)`. Needs a configured signer (CAPABILITY_UNAVAILABLE). The signer's " +
    "address, then organizations.proposals.request-approval opens the approval (the backend decides approveHash or the " +
    "execution); `signOwnerApproval` checks it is a `safe_proposal` approval for this signer that describes its digest, " +
    "signs the digest and records it with Accounts. Returns the approval, approved; Capxul sends it. A Director whose " +
    "Director hat lapsed is refused by the backend.",
  was: [`${SDK}/proposals.ts:98`, `${SDK}/proposals.ts:296`, `${SDK}/proposals.ts:299`, `${SDK}/proposals.ts:304`, `${SDK}/proposals.ts:305`, `${SDK}/proposals.ts:306`, ...SIGN_WAS, ...RUNNER_WAS],
  component: component_core_sdk,
  sdk: "client.org(orgId).proposals.approve",
  input: Schema.Struct({ proposalId: Schema.String, options: Options }),
  output: Approval,
  steps: [
    needSigner("org.proposals.approve"),
    { name: "address", local: "sign", about: "CapxulSigner.getAddress(), before the approval is opened." },
    { name: "request-approval", rpc: rpc_organizations_proposals_request_approval },
    ...signApproval("safe_proposal"),
  ],
  errors: [...SIGNER_ERRORS, error_INVALID_INPUT, ...RUNNER_ERRORS],
  calls: signerCalls,
  spans: ["org.proposals.approve"],
});

export const flow_client_org_proposals_wait = defineFlow({
  id: "client.org.proposals.wait",
  title: "Read a proposal until no sent approval or execution is in flight",
  about:
    "`client.org(orgId).proposals.wait(proposalId, { timeoutMs, pollMs })`. Reads organizations.proposals.get until the " +
    "proposal is settled or every approval reads `approved` (none `sent`), sleeping pollMs (2 s) between reads; the " +
    "runner's deadline (2 min by default) ends it as CANCELLED.",
  was: [`${SDK}/proposals.ts:127`, `${SDK}/proposals.ts:139`, `${SDK}/proposals.ts:152`, `${SDK}/proposals.ts:318`, ...RUNNER_WAS],
  component: component_core_sdk,
  sdk: "client.org(orgId).proposals.wait",
  input: Schema.Struct({ proposalId: Schema.String, options: WaitOptions }),
  output: SafeProposal,
  steps: [
    { name: "read", rpc: rpc_organizations_proposals_get },
    { name: "poll", local: "poll", about: "`quiet`: settled, or every approval approved; otherwise sleeps pollMs and reads again." },
  ],
  errors: RUNNER_ERRORS,
  calls: [],
  spans: ["org.proposals.wait"],
});

// ── board ──────────────────────────────────────────────────────────────────────────────────

const BOARD_WAS = [`${SDK}/board.ts:145`, `${SDK}/board.ts:163`, `${SDK}/board-approval.ts:20`, `${SDK}/board-approval.ts:63`];

/** A Board change's sign-and-wait: open it, sign it, and read it until it reached its end. */
const boardChange = (input: {
  readonly id: string;
  readonly sdk: string;
  readonly span: string;
  readonly title: string;
  readonly open: Step;
  readonly want: string;
  readonly about: string;
  readonly was: readonly string[];
  readonly input: Schema.Top;
  readonly output: Schema.Top;
}) =>
  defineFlow({
    id: input.id,
    title: input.title,
    about: input.about,
    was: [...input.was, ...BOARD_WAS, ...SIGN_WAS, ...RUNNER_WAS],
    component: component_core_sdk,
    sdk: input.sdk,
    input: input.input,
    output: input.output,
    steps: [
      needSigner(input.span),
      input.open,
      ...signApproval("director_change"),
      ...poll({ name: "read", rpc: rpc_organizations_directors_get }, `\`${input.want}\``),
    ],
    errors: [...SIGNER_ERRORS, error_INVALID_INPUT, error_WRONG_STATE, ...RUNNER_ERRORS],
    calls: signerCalls,
    spans: [input.span],
  });

/** A Board change's wait alone. */
const boardWait = (input: { readonly id: string; readonly sdk: string; readonly span: string; readonly want: string; readonly was: readonly string[] }) =>
  defineFlow({
    id: input.id,
    title: `Read a Board change until it is ${input.want}`,
    about:
      `\`${input.sdk}(changeId, { timeoutMs, pollMs })\`. Reads organizations.directors.get until the change is ` +
      `\`${input.want}\`; \`failed\` or \`lapsed\` is WRONG_STATE; the runner's deadline (2 min by default) cancels it.`,
    was: [...input.was, `${SDK}/board-approval.ts:63`, ...RUNNER_WAS],
    component: component_core_sdk,
    sdk: input.sdk,
    input: Schema.Struct({ changeId: Schema.String, options: WaitOptions }),
    output: DirectorChangeView,
    steps: poll({ name: "read", rpc: rpc_organizations_directors_get }, `\`${input.want}\``),
    errors: [error_WRONG_STATE, ...RUNNER_ERRORS],
    calls: [],
    spans: [input.span],
  });

export const flow_client_org_board_directors_add = boardChange({
  id: "client.org.board.directors.add",
  sdk: "client.org(orgId).board.directors.add",
  span: "org.board.directors.add",
  title: "Seat a member as a Director and wait until their Safe signs",
  about:
    "`client.org(orgId).board.directors.add(person)`. Needs a configured signer. organizations.directors.add opens the " +
    "seat's approval; `signSeatApproval` signs it as the caller's own `director_change` approval and records it with " +
    "Accounts; then organizations.directors.get is read until the change is `seated` (the member's Safe signs the company " +
    "Safe). Returns the Board's size, the Gate's threshold and the person.",
  open: { name: "open", rpc: rpc_organizations_directors_add },
  want: "seated",
  was: [`${SDK}/board.ts:76`, `${SDK}/board.ts:149`, `${SDK}/board.ts:195`, `${SDK}/board.ts:262`],
  input: Schema.Struct({ person: Schema.String, options: WaitOptions }),
  output: seatResult("seated"),
});

export const flow_client_org_board_directors_wait = boardWait({
  id: "client.org.board.directors.wait",
  sdk: "client.org(orgId).board.directors.wait",
  span: "org.board.directors.wait",
  want: "seated",
  was: [`${SDK}/board.ts:195`, `${SDK}/board.ts:256`],
});

export const flow_client_org_board_directors_remove = boardChange({
  id: "client.org.board.directors.remove",
  sdk: "client.org(orgId).board.directors.remove",
  span: "org.board.directors.remove",
  title: "Remove a Director and wait until the Gate dropped their Safe",
  about:
    "`client.org(orgId).board.directors.remove(person)`. Needs a configured signer. organizations.directors.remove opens " +
    "the removal's approval; it is signed and recorded as for add; then organizations.directors.get is read until the " +
    "change is `removed`.",
  open: { name: "open", rpc: rpc_organizations_directors_remove },
  want: "removed",
  was: [`${SDK}/board.ts:97`, `${SDK}/board.ts:156`, `${SDK}/board.ts:203`, `${SDK}/board.ts:284`],
  input: Schema.Struct({ person: Schema.String, options: WaitOptions }),
  output: seatResult("removed"),
});

export const flow_client_org_board_directors_wait_removed = boardWait({
  id: "client.org.board.directors.wait-removed",
  sdk: "client.org(orgId).board.directors.waitRemoved",
  span: "org.board.directors.waitRemoved",
  want: "removed",
  was: [`${SDK}/board.ts:203`, `${SDK}/board.ts:278`],
});

export const flow_client_org_board_set_threshold = boardChange({
  id: "client.org.board.set-threshold",
  sdk: "client.org(orgId).board.setThreshold",
  span: "org.board.setThreshold",
  title: "Set the Board's signing threshold and wait until the Gate requires it",
  about:
    "`client.org(orgId).board.setThreshold(threshold)`. Needs a configured signer. organizations.directors.set-threshold " +
    "opens the approval; it is signed and recorded; then organizations.directors.get is read until the change is `set`. " +
    "Returns the threshold before and after.",
  open: { name: "open", rpc: rpc_organizations_directors_set_threshold },
  want: "set",
  was: [`${SDK}/board.ts:125`, `${SDK}/board.ts:170`, `${SDK}/board.ts:181`, `${SDK}/board.ts:224`],
  input: Schema.Struct({ threshold: Schema.Number, options: WaitOptions }),
  /** `BoardThresholdSet` (board-results.ts). */
  output: Schema.Struct({ status: Schema.Literal("set"), threshold: BoardThreshold, before: BoardThreshold, changeId: Schema.String }),
});

export const flow_client_org_board_wait_threshold = boardWait({
  id: "client.org.board.wait-threshold",
  sdk: "client.org(orgId).board.waitThreshold",
  span: "org.board.waitThreshold",
  want: "set",
  was: [`${SDK}/board.ts:181`, `${SDK}/board.ts:218`],
});

export const flow_client_org_board_claim = boardChange({
  id: "client.org.board.claim",
  sdk: "client.org(orgId).board.claim",
  span: "org.board.claim",
  title: "An elected Director claims their seat and waits until seated",
  about:
    "`client.org(orgId).board.claim()`. Needs a configured signer. organizations.directors.claim opens the approval; it is " +
    "signed and recorded; then organizations.directors.get is read until the change is `seated`.",
  open: { name: "open", rpc: rpc_organizations_directors_claim },
  want: "seated",
  was: [`${SDK}/board-claim.ts:31`, `${SDK}/board-claim.ts:70`, `${SDK}/board-claim.ts:80`, `${SDK}/board-claim.ts:97`],
  input: Schema.Struct({ options: WaitOptions }),
  output: seatResult("seated"),
});

export const flow_client_org_board_wait_claimed = boardWait({
  id: "client.org.board.wait-claimed",
  sdk: "client.org(orgId).board.waitClaimed",
  span: "org.board.waitClaimed",
  want: "seated",
  was: [`${SDK}/board-claim.ts:80`, `${SDK}/board-claim.ts:91`],
});

export const flow_client_org_board_refresh = boardChange({
  id: "client.org.board.refresh",
  sdk: "client.org(orgId).board.refresh",
  span: "org.board.refresh",
  title: "Drop the lapsed Board signers and wait until they are removed",
  about:
    "`client.org(orgId).board.refresh()`. Needs a configured signer. organizations.directors.refresh opens the approval; it " +
    "is signed and recorded; then organizations.directors.get is read until the change is `removed`.",
  open: { name: "open", rpc: rpc_organizations_directors_refresh },
  want: "removed",
  was: [`${SDK}/board-refresh.ts:31`, `${SDK}/board-refresh.ts:69`, `${SDK}/board-refresh.ts:83`, `${SDK}/board-refresh.ts:100`],
  input: Schema.Struct({ options: WaitOptions }),
  /** `BoardRefreshed` (board-refresh.ts:31). */
  output: Schema.Struct({ status: Schema.Literal("removed"), removed: Schema.Array(BoardPerson), directors: Schema.Number, threshold: BoardThreshold, changeId: Schema.String }),
});

export const flow_client_org_board_wait_refreshed = boardWait({
  id: "client.org.board.wait-refreshed",
  sdk: "client.org(orgId).board.waitRefreshed",
  span: "org.board.waitRefreshed",
  want: "removed",
  was: [`${SDK}/board-refresh.ts:83`, `${SDK}/board-refresh.ts:94`],
});

/** The handover's open with its local check (`handoverMismatch`, board-handover.ts:76). */
const handoverOpen: Steps = [
  { name: "open", rpc: rpc_organizations_directors_handover },
  {
    name: "check",
    local: "build",
    about:
      "`handoverMismatch`: this Organization's handover, its calls exactly a handover from the signing Safe, and the operation " +
      "that Safe's MultiSendCallOnly batch of them; else PROVIDER_RESPONSE_INVALID (conflict).",
  },
];

export const flow_client_org_board_prepare_hand_over = defineFlow({
  id: "client.org.board.prepare-hand-over",
  title: "Open the Board handover's approval, checked before anyone signs",
  about:
    "`client.org(orgId).board.prepareHandOver()`. organizations.directors.handover opens the approval, then " +
    "`handoverMismatch` checks what opened is this Organization's handover of its own calls; a mismatch is " +
    "PROVIDER_RESPONSE_INVALID. Nothing is signed: the approval page or the caller's own key signs it.",
  was: [`${SDK}/board-handover.ts:63`, `${SDK}/board-handover.ts:76`, `${SDK}/board-handover.ts:120`, `${SDK}/board-handover.ts:142`, ...RUNNER_WAS],
  component: component_core_sdk,
  sdk: "client.org(orgId).board.prepareHandOver",
  input: Schema.Struct({ options: Options }),
  output: Schema.Unknown,
  steps: handoverOpen,
  errors: [error_PROVIDER_RESPONSE_INVALID, ...RUNNER_ERRORS],
  calls: [],
  spans: ["org.board.prepareHandOver"],
});

export const flow_client_org_board_hand_over = defineFlow({
  id: "client.org.board.hand-over",
  title: "Hand the Board to the Governor and wait until it holds it",
  about:
    "`client.org(orgId).board.handOver()`. Needs a configured signer. The checked open of prepareHandOver, then the " +
    "approval is signed and recorded as a `director_change` approval, then organizations.directors.get is read until the " +
    "change is `handed_over`.",
  was: [`${SDK}/board-handover.ts:55`, `${SDK}/board-handover.ts:76`, `${SDK}/board-handover.ts:120`, `${SDK}/board-handover.ts:150`, `${SDK}/board.ts:188`, ...BOARD_WAS, ...SIGN_WAS, ...RUNNER_WAS],
  component: component_core_sdk,
  sdk: "client.org(orgId).board.handOver",
  input: Schema.Struct({ options: WaitOptions }),
  output: Schema.Struct({ status: Schema.Literal("handed_over"), directors: Schema.Number, threshold: BoardThreshold, changeId: Schema.String }),
  steps: [
    needSigner("org.board.handOver"),
    ...handoverOpen,
    ...signApproval("director_change"),
    ...poll({ name: "read", rpc: rpc_organizations_directors_get }, "`handed_over`"),
  ],
  errors: [...SIGNER_ERRORS, error_INVALID_INPUT, error_WRONG_STATE, ...RUNNER_ERRORS],
  calls: signerCalls,
  spans: ["org.board.handOver"],
});

export const flow_client_org_board_wait_hand_over = boardWait({
  id: "client.org.board.wait-hand-over",
  sdk: "client.org(orgId).board.waitHandOver",
  span: "org.board.waitHandOver",
  want: "handed_over",
  was: [`${SDK}/board.ts:188`, `${SDK}/board-handover.ts:144`],
});

// ── equity, options, rounds, SAFE rounds ───────────────────────────────────────────────────

/** What every Board write's SDK method returns besides its own fields. */
const withApproval = <F extends Schema.Struct.Fields>(fields: F) =>
  Schema.Struct({ ...fields, proposal: SafeProposal, approvalId: Schema.String, approval: Approval });

/** A Board write's SDK method: build the input, the rpc, check what it proposed, ask for the approval. */
const boardWrite = (input: {
  readonly id: string;
  readonly sdk: string;
  readonly span: string;
  readonly title: string;
  readonly about: string;
  readonly build?: Step;
  readonly propose: Step;
  readonly check: string;
  readonly was: readonly string[];
  readonly input: Schema.Top;
  /** The rpc's answer with the approval and its id (`EquitySetupResult`, `EquityIssueResult`, ...). */
  readonly output: Schema.Top;
  readonly errors?: ReadonlyArray<typeof error_INVALID_INPUT>;
}) =>
  defineFlow({
    id: input.id,
    title: input.title,
    about: input.about,
    was: [...input.was, ...RUNNER_WAS],
    component: component_core_sdk,
    sdk: input.sdk,
    input: input.input,
    output: input.output,
    steps: [
      ...(input.build === undefined ? [] : [input.build]),
      input.propose,
      { name: "check", local: "build", about: input.check },
      requestApproval,
    ],
    errors: [error_PROVIDER_RESPONSE_INVALID, ...(input.errors ?? []), ...RUNNER_ERRORS],
    calls: [],
    spans: [input.span],
  });

export const flow_client_org_equity_setup = boardWrite({
  id: "client.org.equity.setup",
  sdk: "client.org(orgId).equity.setup",
  span: "org.equity.setup",
  title: "Switch equity on and open the Director's approval of its proposal",
  about:
    "`client.org(orgId).equity.setup(input)`. organizations.equity.setup proposes the install; `checkEcho` compares the " +
    "proposed cap table with what was asked (template, founders and shares, authorised, pool, vesting, a non-empty batch); " +
    "a mismatch is PROVIDER_RESPONSE_INVALID before anyone approves. Then organizations.proposals.request-approval opens " +
    "this Director's approval. Returns the setup's status, summary, cap-table value, Governor, contracts, proposal and approval.",
  propose: { name: "propose", rpc: rpc_organizations_equity_setup },
  check: "`checkEcho`: the proposed cap table is the setup asked for, else PROVIDER_RESPONSE_INVALID (conflict).",
  was: [`${SDK}/equity.ts:96`, `${SDK}/equity.ts:116`, `${SDK}/equity.ts:119`, `${SDK}/equity-echo.ts:57`, `${SDK}/equity-results.ts:13`],
  input: Schema.Struct({
    template: Schema.String,
    authorised: Schema.Number,
    founders: Schema.Array(Schema.Struct({ shareholder: Schema.String, shares: Schema.Number })),
    pool: Schema.optionalKey(Schema.Number),
    vesting: Schema.optionalKey(Schema.Struct({ months: Schema.Number, cliffMonths: Schema.optionalKey(Schema.Number) })),
    start: Schema.optionalKey(Schema.String),
    note: Schema.optionalKey(Schema.String),
    options: Options,
  }),
  /** `EquitySetupResult` (equity-results.ts:24): the cap table reshaped as `value`. */
  output: withApproval({
    status: Schema.Literals(["awaiting_approvals", "installed"]),
    template: Schema.String,
    summary: Schema.String,
    value: Schema.Unknown,
    governor: Schema.Unknown,
    contracts: Schema.Unknown,
  }),
});

export const flow_client_org_equity_issue = boardWrite({
  id: "client.org.equity.issue",
  sdk: "client.org(orgId).equity.issue",
  span: "org.equity.issue",
  title: "Issue shares and open the Director's approval of the proposal",
  about:
    "`client.org(orgId).equity.issue({ class, to, shares, reason, note })`. The reason is hashed here (`reasonHashOf`: " +
    "text, bytes or a given hash). organizations.equity.issue proposes it; `issueAsked` and `issueCallAsked` check the " +
    "proposed issue and its one `Captable.issue` call are the issue asked for (PROVIDER_RESPONSE_INVALID otherwise). Then " +
    "organizations.proposals.request-approval opens this Director's approval.",
  build: { name: "reason-hash", local: "build", about: "`reasonHashOf(reason)`: keccak256 of the text or bytes, or the given hash." },
  propose: { name: "propose", rpc: rpc_organizations_equity_issue },
  check: "`issueAsked` and `issueCallAsked`: the proposed issue and its call are the issue asked for, else PROVIDER_RESPONSE_INVALID.",
  was: [`${SDK}/equity.ts:145`, `${SDK}/equity.ts:156`, `${SDK}/equity.ts:160`, `${SDK}/equity.ts:172`, `${SDK}/equity-echo.ts:30`, `${SDK}/equity-echo.ts:80`, `${SDK}/issue-call.ts:13`, `${SDK}/equity-results.ts:51`],
  input: Schema.Struct({ class: Schema.String, to: Schema.String, shares: Schema.Number, reason: Hashable, note: Schema.optionalKey(Schema.String), options: Options }),
  output: withApproval({ status: Schema.Literals(["awaiting_approvals", "issued"]), issue: Schema.Unknown }),
});

export const flow_client_org_equity_transfers_approve = boardWrite({
  id: "client.org.equity.transfers.approve",
  sdk: "client.org(orgId).equity.transfers.approve",
  span: "org.equity.transfers.approve",
  title: "Propose the Board's approval of a share sale and open the approval",
  about:
    "`client.org(orgId).equity.transfers.approve(transferId)`. organizations.equity.approve-transfer proposes " +
    "`Exits.approveTransfer`; the answer must be for the sale asked (PROVIDER_RESPONSE_INVALID otherwise); then " +
    "organizations.proposals.request-approval opens this Director's approval.",
  propose: { name: "propose", rpc: rpc_organizations_equity_approve_transfer },
  check: "The proposal is the asked sale's approval, else PROVIDER_RESPONSE_INVALID (conflict).",
  was: [`${SDK}/equity-transfers.ts:20`, `${SDK}/equity-transfers.ts:48`, `${SDK}/equity-transfers.ts:58`, `${SDK}/equity-transfers.ts:68`],
  input: Schema.Struct({ transferId: Schema.String, options: Options }),
  output: withApproval({ status: Schema.Literals(["awaiting_approvals", "approved"]), transfer: Schema.Unknown }),
});

export const flow_client_org_options_grant = boardWrite({
  id: "client.org.options.grant",
  sdk: "client.org(orgId).options.grant",
  span: "org.options.grant",
  title: "Grant options and open the Director's approval of the proposal",
  about:
    "`client.org(orgId).options.grant(input)`. The agreement is hashed here (`agreementHashOf`). " +
    "organizations.equity.grant-options proposes the grant; `grantAsked` checks the grantee, shares, strike and token, " +
    "vesting, agreement hash and that the one call is `Options.grant` of those terms (`callIsGrant`); a mismatch is " +
    "PROVIDER_RESPONSE_INVALID. Then organizations.proposals.request-approval opens this Director's approval.",
  build: { name: "agreement-hash", local: "build", about: "`agreementHashOf(agreement)`: keccak256 of the text or bytes, or the given hash." },
  propose: { name: "propose", rpc: rpc_organizations_equity_grant_options },
  check: "`grantAsked` / `callIsGrant`: the proposed grant and its call are the grant asked for, else PROVIDER_RESPONSE_INVALID.",
  was: [`${SDK}/options.ts:25`, `${SDK}/options.ts:66`, `${SDK}/options.ts:80`, `${SDK}/options.ts:113`, `${SDK}/options.ts:148`, `${SDK}/options.ts:169`, `${SDK}/options.ts:181`],
  input: Schema.Struct({
    to: Schema.String,
    shares: Schema.Number,
    strike: Schema.String,
    strikeToken: Schema.optionalKey(Schema.String),
    vesting: Schema.optionalKey(Schema.Struct({ months: Schema.Number, cliffMonths: Schema.optionalKey(Schema.Number) })),
    start: Schema.optionalKey(Schema.String),
    exerciseWindowDays: Schema.optionalKey(Schema.Number),
    agreement: Hashable,
    note: Schema.optionalKey(Schema.String),
    options: Options,
  }),
  output: withApproval({
    status: Schema.Literals(["awaiting_approvals", "granted"]),
    grant: Schema.Unknown,
    pool: Schema.Struct({ options: Schema.String, size: Schema.Number, left: Schema.Number }),
  }),
});

export const flow_client_org_rounds_create = boardWrite({
  id: "client.org.rounds.create",
  sdk: "client.org(orgId).rounds.create",
  span: "org.round.create",
  title: "Open a priced round and the Director's approval of its proposal",
  about:
    "`client.org(orgId).rounds.create({ class, preMoney, raise, payBy, terms, note })`. The terms are hashed here " +
    "(`termsHashOf`). organizations.rounds.create proposes the round; `roundAsked` and `callAsked` check the round and its " +
    "one `Rounds.createPricedRound` call (PROVIDER_RESPONSE_INVALID otherwise). Then organizations.proposals." +
    "request-approval opens this Director's approval. Its span name is `org.round.create`.",
  build: { name: "terms-hash", local: "build", about: "`termsHashOf(terms)`: keccak256 of the text or bytes, or the given hash." },
  propose: { name: "propose", rpc: rpc_organizations_rounds_create },
  check: "`roundAsked` / `callAsked`: the proposed round and call are the round asked for, else PROVIDER_RESPONSE_INVALID.",
  was: [`${SDK}/rounds.ts:26`, `${SDK}/rounds.ts:62`, `${SDK}/rounds.ts:72`, `${SDK}/rounds.ts:98`, `${SDK}/rounds.ts:133`, `${SDK}/rounds.ts:149`, `${SDK}/rounds.ts:161`],
  input: Schema.Struct({
    class: Schema.String,
    preMoney: Schema.Number,
    raise: Schema.Number,
    payBy: Schema.String,
    terms: Hashable,
    note: Schema.optionalKey(Schema.String),
    options: Options,
  }),
  output: withApproval({ status: Schema.Literals(["awaiting_approvals", "opened"]), round: Schema.Unknown }),
});

export const flow_client_org_safes_create = boardWrite({
  id: "client.org.safes.create",
  sdk: "client.org(orgId).safes.create",
  span: "org.safe.create",
  title: "Open a SAFE round and the Director's approval of its proposal",
  about:
    "`client.org(orgId).safes.create({ cap, discountPct, raise, closes, terms, note })`. The SAFE form is hashed here " +
    "(`termsHashOf`). organizations.equity.create-safe-round proposes it; `roundAsked` checks the round, its USDC on the " +
    "client's chain and its terms hash (PROVIDER_RESPONSE_INVALID otherwise). Then organizations.proposals.request-approval " +
    "opens this Director's approval. Its span name is `org.safe.create`.",
  build: { name: "terms-hash", local: "build", about: "`termsHashOf(terms)`: keccak256 of the SAFE form's text or bytes, or the given hash." },
  propose: { name: "propose", rpc: rpc_organizations_equity_create_safe_round },
  check: "`roundAsked`: the proposed SAFE round is the one asked for, else PROVIDER_RESPONSE_INVALID.",
  was: [`${SDK}/safes.ts:25`, `${SDK}/safes.ts:60`, `${SDK}/safes.ts:81`, `${SDK}/safes.ts:126`, `${SDK}/safes.ts:142`, `${SDK}/safes.ts:154`],
  input: Schema.Struct({
    cap: Schema.Number,
    discountPct: Schema.optionalKey(Schema.Number),
    raise: Schema.Number,
    closes: Schema.String,
    terms: Hashable,
    note: Schema.optionalKey(Schema.String),
    options: Options,
  }),
  output: withApproval({ status: Schema.Literals(["awaiting_approvals", "opened"]), safeRound: Schema.Unknown }),
});

// ── client.me.shares ───────────────────────────────────────────────────────────────────────

const SALE_INPUT = Schema.Struct({
  org: Schema.String,
  class: Schema.optionalKey(Schema.String),
  to: Schema.String,
  shares: Schema.Number,
  price: Schema.String,
  agreement: Hashable,
});

/** `prepare` (shares.ts:147): the hashed agreement, the sell rpc, and `saleAsked`. */
const saleOpen: Steps = [
  { name: "agreement-hash", local: "build", about: "`agreementHash(agreement)`: keccak256 of the text or bytes, or the given hash; the class defaults to Common." },
  { name: "open", rpc: rpc_organizations_equity_sell },
  {
    name: "check",
    local: "build",
    about: "`saleAsked`: class, buyer, shares, price and agreement hash as asked, and two calls; else PROVIDER_RESPONSE_INVALID.",
  },
];
const SALE_WAS = [`${SDK}/shares.ts:92`, `${SDK}/shares.ts:101`, `${SDK}/shares.ts:147`];

export const flow_client_me_shares_prepare_sell = defineFlow({
  id: "client.me.shares.prepare-sell",
  title: "Open a share sale's approval, checked against the sale asked",
  about:
    "`client.me.shares.prepareSell(input)`, under the sale's Organization scope. The agreement is hashed, " +
    "organizations.equity.sell opens the seller's approval, and `saleAsked` checks it; nothing is signed.",
  was: [`${SDK}/shares.ts:69`, `${SDK}/shares.ts:205`, ...SALE_WAS, ...RUNNER_WAS],
  component: component_core_sdk,
  sdk: "client.me.shares.prepareSell",
  input: Schema.Struct({ input: SALE_INPUT, options: Options }),
  output: Schema.Unknown,
  steps: saleOpen,
  errors: [error_PROVIDER_RESPONSE_INVALID, ...RUNNER_ERRORS],
  calls: [],
  spans: ["me.shares.prepareSell"],
});

export const flow_client_me_shares_sell = defineFlow({
  id: "client.me.shares.sell",
  title: "Offer shares, sign the offer and wait until Exits holds it",
  about:
    "`client.me.shares.sell(input)`. Needs a configured signer. The checked open of prepareSell, then `signSaleApproval` " +
    "signs it as the caller's `share_transfer` approval and records it with Accounts, then organizations.equity.transfer is " +
    "read until the sale is `offered` or `approved`; `failed` or `lapsed` is WRONG_STATE.",
  was: [`${SDK}/shares.ts:64`, `${SDK}/shares.ts:218`, `${SDK}/shares.ts:181`, ...SALE_WAS, ...SIGN_WAS, ...RUNNER_WAS],
  component: component_core_sdk,
  sdk: "client.me.shares.sell",
  input: Schema.Struct({ input: SALE_INPUT, options: WaitOptions }),
  output: Schema.Unknown,
  steps: [
    needSigner("me.shares.sell"),
    ...saleOpen,
    ...signApproval("share_transfer"),
    ...poll({ name: "read", rpc: rpc_organizations_equity_transfer }, "`offered` or `approved`"),
  ],
  errors: [...SIGNER_ERRORS, error_INVALID_INPUT, error_WRONG_STATE, ...RUNNER_ERRORS],
  calls: signerCalls,
  spans: ["me.shares.sell"],
});

export const flow_client_me_shares_wait = defineFlow({
  id: "client.me.shares.wait",
  title: "Read a share sale until Exits holds the offer",
  about:
    "`client.me.shares.wait(org, transferId)`. Reads organizations.equity.transfer until `offered` or `approved`; `failed` " +
    "or `lapsed` is WRONG_STATE; the runner's deadline (2 min by default) cancels it.",
  was: [`${SDK}/shares.ts:80`, `${SDK}/shares.ts:181`, `${SDK}/shares.ts:212`, ...RUNNER_WAS],
  component: component_core_sdk,
  sdk: "client.me.shares.wait",
  input: Schema.Struct({ org: Schema.String, transferId: Schema.String, options: WaitOptions }),
  output: Schema.Unknown,
  steps: poll({ name: "read", rpc: rpc_organizations_equity_transfer }, "`offered` or `approved`"),
  errors: [error_WRONG_STATE, ...RUNNER_ERRORS],
  calls: [],
  spans: ["me.shares.wait"],
});

// ── client.org(orgId).votes ────────────────────────────────────────────────────────────────

const VOTE_INPUT = Schema.Struct({
  matter: Schema.Literal("authorise"),
  class: Schema.String,
  authorised: Schema.Number,
  note: Schema.optionalKey(Schema.String),
});

export const flow_client_org_votes_create = defineFlow({
  id: "client.org.votes.create",
  title: "Propose a vote, sign it, and wait until the Governor holds it",
  about:
    "`client.org(orgId).votes.create(vote)`. Needs a configured signer. organizations.votes.create opens the proposer's " +
    "approval; `voteMismatch` checks the matter and class, the description, one `Captable.setAuthorised` of the asked " +
    "amount, the Governor proposal id of those calls and the operation's `propose` (PROVIDER_RESPONSE_INVALID otherwise); " +
    "`signVoteApproval` signs it as a `vote` approval and records it; then organizations.votes.get is read until the " +
    "Governor holds it (any on-chain status); `failed` or `lapsed` is WRONG_STATE.",
  was: [`${SDK}/votes.ts:61`, `${SDK}/votes.ts:193`, `${SDK}/votes.ts:152`, `${SDK}/vote-check.ts:17`, `${SDK}/vote-approval.ts:26`, ...SIGN_WAS, ...RUNNER_WAS],
  component: component_core_sdk,
  sdk: "client.org(orgId).votes.create",
  input: Schema.Struct({ vote: VOTE_INPUT, options: WaitOptions }),
  output: Schema.Unknown,
  steps: [
    needSigner("org.votes.create"),
    { name: "open", rpc: rpc_organizations_votes_create },
    { name: "check", local: "build", about: "`voteMismatch`: the opened vote is the matter asked for, else PROVIDER_RESPONSE_INVALID." },
    ...signApproval("vote"),
    ...poll({ name: "read", rpc: rpc_organizations_votes_get }, "an on-chain status"),
  ],
  errors: [...SIGNER_ERRORS, error_INVALID_INPUT, error_WRONG_STATE, ...RUNNER_ERRORS],
  calls: signerCalls,
  spans: ["org.votes.create"],
});

export const flow_client_org_votes_wait = defineFlow({
  id: "client.org.votes.wait",
  title: "Read a vote until it is proposed, closed or executed",
  about:
    "`client.org(orgId).votes.wait(voteId, { until })`. Reads organizations.votes.get until the status reaches `until` " +
    "(`proposed`: any on-chain status, the default; `closed`; `executed`); `failed`, `lapsed`, or for `executed` a " +
    "canceled, defeated or expired vote, is WRONG_STATE; the runner's deadline (2 min by default) cancels it.",
  was: [`${SDK}/votes.ts:76`, `${SDK}/votes.ts:152`, `${SDK}/votes.ts:187`, ...RUNNER_WAS],
  component: component_core_sdk,
  sdk: "client.org(orgId).votes.wait",
  input: Schema.Struct({
    voteId: Schema.String,
    options: Schema.optionalKey(
      Schema.Struct({
        signal: Schema.optionalKey(Schema.Unknown),
        timeoutMs: Schema.optionalKey(Schema.Number),
        pollMs: Schema.optionalKey(Schema.Number),
        until: Schema.optionalKey(Schema.Literals(["proposed", "closed", "executed"])),
      }),
    ),
  }),
  output: Schema.Unknown,
  steps: poll({ name: "read", rpc: rpc_organizations_votes_get }, "the `until` status"),
  errors: [error_WRONG_STATE, ...RUNNER_ERRORS],
  calls: [],
  spans: ["org.votes.wait"],
});

/** `prepare` (vote-execute.ts): the vote read, the execute rpc, and `executionMismatch`. */
const executeOpen: Steps = [
  { name: "vote", rpc: rpc_organizations_votes_get, about: "Reads the vote first, to check what opens against it." },
  { name: "open", rpc: rpc_organizations_votes_execute },
  {
    name: "check",
    local: "build",
    about: "`executionMismatch`: the same vote and Governor, and the executor Safe's `execute` of its calls; else PROVIDER_RESPONSE_INVALID.",
  },
];
const EXECUTE_WAS = [`${SDK}/vote-execute.ts:70`, `${SDK}/vote-execute.ts:115`];

export const flow_client_org_votes_prepare_execute = defineFlow({
  id: "client.org.votes.prepare-execute",
  title: "Open a passed vote's execution, checked against the vote",
  about:
    "`client.org(orgId).votes.prepareExecute(voteId)`. organizations.votes.get, then organizations.votes.execute opens the " +
    "executor's approval, and `executionMismatch` checks it against the vote; nothing is signed.",
  was: [`${SDK}/vote-execute.ts:52`, `${SDK}/vote-execute.ts:168`, ...EXECUTE_WAS, ...RUNNER_WAS],
  component: component_core_sdk,
  sdk: "client.org(orgId).votes.prepareExecute",
  input: Schema.Struct({ voteId: Schema.String, options: Options }),
  output: Schema.Unknown,
  steps: executeOpen,
  errors: [error_PROVIDER_RESPONSE_INVALID, ...RUNNER_ERRORS],
  calls: [],
  spans: ["org.votes.prepareExecute"],
});

export const flow_client_org_votes_execute = defineFlow({
  id: "client.org.votes.execute",
  title: "Execute a passed vote: open, sign and wait until it ran",
  about:
    "`client.org(orgId).votes.execute(voteId)`. Needs a configured signer. The checked open of prepareExecute, then the " +
    "approval is signed and recorded as a `vote` approval, then organizations.votes.execution is read until `executed`; " +
    "`failed` or `lapsed` is WRONG_STATE.",
  was: [`${SDK}/vote-execute.ts:44`, `${SDK}/vote-execute.ts:177`, `${SDK}/vote-execute.ts:146`, ...EXECUTE_WAS, ...SIGN_WAS, ...RUNNER_WAS],
  component: component_core_sdk,
  sdk: "client.org(orgId).votes.execute",
  input: Schema.Struct({ voteId: Schema.String, options: WaitOptions }),
  output: Schema.Unknown,
  steps: [
    needSigner("org.votes.execute"),
    ...executeOpen,
    ...signApproval("vote"),
    ...poll({ name: "read", rpc: rpc_organizations_votes_execution }, "`executed`"),
  ],
  errors: [...SIGNER_ERRORS, error_INVALID_INPUT, error_WRONG_STATE, ...RUNNER_ERRORS],
  calls: signerCalls,
  spans: ["org.votes.execute"],
});

export const flow_client_org_votes_wait_execute = defineFlow({
  id: "client.org.votes.wait-execute",
  title: "Read an execution until the Governor ran it",
  about:
    "`client.org(orgId).votes.waitExecute(executionId)`. Reads organizations.votes.execution until `executed`; `failed` or " +
    "`lapsed` is WRONG_STATE; the runner's deadline (2 min by default) cancels it.",
  was: [`${SDK}/vote-execute.ts:59`, `${SDK}/vote-execute.ts:146`, `${SDK}/vote-execute.ts:173`, ...RUNNER_WAS],
  component: component_core_sdk,
  sdk: "client.org(orgId).votes.waitExecute",
  input: Schema.Struct({ executionId: Schema.String, options: WaitOptions }),
  output: Schema.Unknown,
  steps: poll({ name: "read", rpc: rpc_organizations_votes_execution }, "`executed`"),
  errors: [error_WRONG_STATE, ...RUNNER_ERRORS],
  calls: [],
  spans: ["org.votes.waitExecute"],
});

// ── client.me.votes ────────────────────────────────────────────────────────────────────────

const CHOICE = Schema.Struct({ support: Schema.Literals(["for", "against", "abstain"]), reason: Schema.optionalKey(Schema.String) });

/** `prepare` (my-votes.ts:145): the cast rpc and `ballotMismatch`. */
const castOpen: Steps = [
  { name: "open", rpc: rpc_organizations_votes_cast },
  {
    name: "check",
    local: "build",
    about: "`ballotMismatch`: the vote, support and trimmed reason asked, and the voter Safe's `castVoteWithReason`; else PROVIDER_RESPONSE_INVALID.",
  },
];
const CAST_WAS = [`${SDK}/my-votes.ts:145`, `${SDK}/my-votes.ts:171`];

export const flow_client_me_votes_prepare_cast = defineFlow({
  id: "client.me.votes.prepare-cast",
  title: "Open a ballot's approval, checked against the choice",
  about:
    "`client.me.votes.prepareCast(voteId, choice)`. organizations.votes.cast opens the voter's approval and " +
    "`ballotMismatch` checks it; nothing is cast until it is signed. Its span is the row name `organizations.votes.cast`.",
  was: [`${SDK}/my-votes.ts:71`, `${SDK}/my-votes.ts:194`, ...CAST_WAS, ...RUNNER_WAS],
  component: component_core_sdk,
  sdk: "client.me.votes.prepareCast",
  input: Schema.Struct({ voteId: Schema.String, choice: CHOICE, options: Schema.optionalKey(Schema.Unknown) }),
  output: Schema.Unknown,
  steps: castOpen,
  errors: [error_PROVIDER_RESPONSE_INVALID, ...RUNNER_ERRORS],
  calls: [],
  spans: ["organizations.votes.cast"],
});

export const flow_client_me_votes_cast = defineFlow({
  id: "client.me.votes.cast",
  title: "Cast a ballot: open, sign and wait until the Governor counted it",
  about:
    "`client.me.votes.cast(voteId, choice)`. Needs a configured signer. The checked open of prepareCast, then the approval " +
    "is signed and recorded as a `vote` approval, then organizations.votes.ballot is read until `cast`; `failed` or " +
    "`lapsed` is WRONG_STATE. Its span is the row name `organizations.votes.cast`.",
  was: [`${SDK}/my-votes.ts:59`, `${SDK}/my-votes.ts:202`, ...CAST_WAS, ...SIGN_WAS, ...RUNNER_WAS],
  component: component_core_sdk,
  sdk: "client.me.votes.cast",
  input: Schema.Struct({ voteId: Schema.String, choice: CHOICE, options: WaitOptions }),
  output: Schema.Unknown,
  steps: [
    needSigner("organizations.votes.cast"),
    ...castOpen,
    ...signApproval("vote"),
    ...poll({ name: "read", rpc: rpc_organizations_votes_ballot }, "`cast`"),
  ],
  errors: [...SIGNER_ERRORS, error_INVALID_INPUT, error_WRONG_STATE, ...RUNNER_ERRORS],
  calls: signerCalls,
  spans: ["organizations.votes.cast"],
});

export const flow_client_me_votes_wait_cast = defineFlow({
  id: "client.me.votes.wait-cast",
  title: "Read a ballot until the Governor counted it",
  about:
    "`client.me.votes.waitCast(ballotId)`. Reads organizations.votes.ballot until `cast`; `failed` or `lapsed` is " +
    "WRONG_STATE (named for `organizations.votes.cast`). Its span is the row name `organizations.votes.ballot`.",
  was: [`${SDK}/my-votes.ts:79`, `${SDK}/my-votes.ts:171`, `${SDK}/my-votes.ts:198`, ...RUNNER_WAS],
  component: component_core_sdk,
  sdk: "client.me.votes.waitCast",
  input: Schema.Struct({ ballotId: Schema.String, options: WaitOptions }),
  output: Schema.Unknown,
  steps: poll({ name: "read", rpc: rpc_organizations_votes_ballot }, "`cast`"),
  errors: [error_WRONG_STATE, ...RUNNER_ERRORS],
  calls: [],
  spans: ["organizations.votes.ballot"],
});

// ── methods that forward one rpc (no flow record) ──────────────────────────────────────────
//
// client.org(id).proposals.list            → organizations.proposals.list
// client.org(id).proposals.get             → organizations.proposals.get
// client.org(id).proposals.create          → organizations.proposals.propose (calls mapped to wire text)
// client.org(id).proposals.requestApproval → organizations.proposals.request-approval
// client.org(id).proposals.cancelScheduled → organizations.proposals.cancel-scheduled
// client.org(id).proposals.reject          → organizations.proposals.reject
// client.org(id).directors.get             → organizations.proposals.safe
// client.org(id).directors.add / remove / replace / setThreshold → organizations.proposals.change-owners
// client.org(id).board.get                 → organizations.proposals.safe, reshaped (seat, electedBy, termEnds null)
// client.org(id).board.directors.prepare / prepareRemove → organizations.directors.add / remove
// client.org(id).board.prepareThreshold / prepareClaim / prepareRefresh → organizations.directors.set-threshold / claim / refresh
// client.org(id).board.directors.get       → organizations.directors.get
// client.org(id).equity.capTable           → organizations.equity.cap-table
// client.org(id).votes.prepare             → organizations.votes.create (unchecked, unlike create)
// client.org(id).votes.get / list          → organizations.votes.get / list
// client.org(id).votes.execution           → organizations.votes.execution
// client.me.shares.get                     → organizations.equity.transfer
// client.me.votes.list                     → organizations.votes.mine
// client.me.votes.ballot                   → organizations.votes.ballot
