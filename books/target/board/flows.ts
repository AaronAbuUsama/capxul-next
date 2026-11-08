// The Core SDK flows of the board concept (A4): one SDK method per multi-step operation, which the CLI
// calls and nothing else. A write is: prepare (one board rpc, which births the change or proposal and
// opens the caller's approval), check that the calls the approval carries are exactly what was asked,
// show the Board before and after, have the caller sign (an agent with its own key, given to
// approvals; a person on the approval page the CLI opens), follow the approval, and read the change
// back. `--no-wait` returns once the approval is open; Capxul's process follows it to the chain either
// way. The reads are one rpc each and have no flow. The four `org director` writes are pre-v4 owner
// changes the Signer Gate refuses: their methods read who the caller and the named members are, give
// the frozen command's refusals, and otherwise refuse WRONG_STATE (decision board.director-commands).

import { Schema } from "effect";
import { budget, defineFlow, type Rpc } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import {
  error_CANCELLED,
  error_CAPABILITY_UNAVAILABLE,
  error_INVALID_INPUT,
  error_RESERVED_MATTER,
  error_ROLE_PERMISSION_DENIED,
  error_TRANSACTION_FAILED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { rpc_approvals_signing_get, rpc_approvals_signing_sign } from "../approvals/signing.ts";
import {
  BoardChangeView,
  ClaimInput,
  OrgInput,
  SeatInput,
  ThresholdInput,
  rpc_board_directors_authority,
  rpc_board_directors_claim,
  rpc_board_directors_get,
  rpc_board_directors_hand_over,
  rpc_board_directors_refresh,
  rpc_board_directors_remove,
  rpc_board_directors_seat,
  rpc_board_directors_set_threshold,
} from "./directors.ts";
import {
  ApprovalOpened,
  ProposalInput,
  ProposalView,
  rpc_board_proposals_approve,
  rpc_board_proposals_get,
  rpc_board_proposals_reject,
} from "./proposals.ts";
import { OfficerChangeView, OfficerInput, rpc_board_officers_get, rpc_board_officers_grant, rpc_board_officers_revoke } from "./officers.ts";

const SDK = "packages/sdk/src/organizations";
const CLI = "apps/cli/src/commands/org/subcommands";
const S = Schema.String;
const NullOr = Schema.NullOr;

/** How a write is followed: `--no-wait` returns once the approval is open. */
const Follow = { noWait: Schema.Boolean, timeoutSeconds: NullOr(Schema.Int) };

/** A write's client time: the rpcs and local steps; a person's wait and chain confirmation never count. */
const WRITE_BUDGET = { ...budget("chain-submit"), excludes: ["wait.person", "chain.confirm"] };

/** The signature and the follow every write shares, after its prepare and its check. */
const signing = [
  {
    name: "sponsored",
    rpc: rpc_approvals_signing_get,
    about: "Reads the approval until it is sponsored (`pending`, with its digest), or refused with the chain's code before anyone signs.",
  },
  {
    name: "sign",
    local: "sign" as const,
    about: "An agent signs the digest with its own key; a person signs on the approval page the CLI opens.",
  },
  {
    name: "give-signature",
    rpc: rpc_approvals_signing_sign,
    about: "An agent's signature to approvals, which sends the operation once; the approval page gives a person's.",
  },
  {
    name: "approval",
    local: "wait" as const,
    about: "Unless `--no-wait`, waits for the person and then the chain, until the approval lands or ends, or `--timeout-seconds`.",
  },
];

/** A Board change's whole flow: prepare, check, show, sign, follow, read back. */
const boardChange = (prepare: Rpc, calls: string) => [
  { name: "prepare", rpc: prepare, about: "Refuses, or births the change with the caller's approval of the calls from their own Safe." },
  { name: "check-calls", local: "build" as const, about: `Decodes the approval's calls and refuses to sign anything but ${calls}.` },
  { name: "show", local: "prompt" as const, about: "Prints the Board and its threshold before and after the change, before anyone signs." },
  ...signing,
  {
    name: "read-back",
    rpc: rpc_board_directors_get,
    about: "Reads the change until its process ends it; a change that failed or lapsed is refused with its code, not waited on.",
  },
];

const CHANGE_ERRORS = [error_CANCELLED, error_WRONG_STATE, error_TRANSACTION_FAILED] as const;

// ── Board changes from a person's own Safe ──────────────────────────────────────────────────

export const flow_client_org_board_claim = defineFlow({
  id: "client.org.board.claim",
  title: "Claim your Board seat, and sign it",
  about:
    "`org board claim`: opens the claim by the Organization alone (and `--seat`), checks the one call is the Gate's " +
    "`claimSigner(directorHat)`, signs it from the caller's own Safe and reads until seated.",
  component: component_core_sdk,
  sdk: "client.org(orgId).board.claim",
  input: Schema.Struct({ ...ClaimInput.fields, ...Follow }),
  output: BoardChangeView,
  steps: boardChange(rpc_board_directors_claim, "the Gate's `claimSigner` of the Director hat"),
  errors: [...CHANGE_ERRORS],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK}/board-claim.ts`, `${CLI}/board/command.ts`],
});

export const flow_client_org_board_directors_add = defineFlow({
  id: "client.org.board.directors.add",
  title: "Seat a Director, and sign it from the Shareholders' top hat",
  about:
    "`org board director add`: opens the seat by the member's email, checks the calls are the Director hat's supply " +
    "change when full, its mint to the member's Safe and the Gate's `claimSignerFor`, and nothing else, then signs " +
    "it from the founder's own Safe and reads until the member is seated. A seat opened for another signer is refused.",
  component: component_core_sdk,
  sdk: "client.org(orgId).board.directors.add",
  input: Schema.Struct({ ...SeatInput.fields, ...Follow }),
  output: BoardChangeView,
  steps: boardChange(rpc_board_directors_seat, "the Director hat's supply change, its mint to the member's Safe and `claimSignerFor`"),
  errors: [...CHANGE_ERRORS],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK}/board.ts`, `${CLI}/board/command.ts`],
});

export const flow_client_org_board_directors_remove = defineFlow({
  id: "client.org.board.directors.remove",
  title: "Remove a Director, and sign it from the Shareholders' top hat",
  about:
    "`org board director remove`: opens the removal by the Director's email, checks the calls are the hat ruling and " +
    "the Gate's `removeSigner` of that Safe, then signs and reads until removed.",
  component: component_core_sdk,
  sdk: "client.org(orgId).board.directors.remove",
  input: Schema.Struct({ ...SeatInput.fields, ...Follow }),
  output: BoardChangeView,
  steps: boardChange(rpc_board_directors_remove, "`Hats.setHatWearerStatus(director, safe, false, true)` and `removeSigner` of that Safe"),
  errors: [...CHANGE_ERRORS],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK}/board.ts`, `${CLI}/board/command.ts`],
});

export const flow_client_org_board_set_threshold = defineFlow({
  id: "client.org.board.set-threshold",
  title: "Set how many Directors must sign, and sign it from the Shareholders' top hat",
  about:
    "`org board threshold`: opens the threshold by its number and checks the one call is the Gate's " +
    "`setThresholdConfig` of ABSOLUTE n of n. Lowering it to 1 among several Directors needs `--confirm`, because any " +
    "one Director could then move money alone; without it the CLI refuses CLI_USAGE before anything is prepared. Then " +
    "it signs and reads until set.",
  component: component_core_sdk,
  sdk: "client.org(orgId).board.setThreshold",
  input: Schema.Struct({ ...ThresholdInput.fields, confirm: Schema.Boolean, ...Follow }),
  output: BoardChangeView,
  steps: [
    { name: "confirm", local: "prompt", about: "A threshold of 1 among several Directors needs `--confirm`." },
    ...boardChange(rpc_board_directors_set_threshold, "one `setThresholdConfig({ ABSOLUTE, n, n })` on the Gate"),
  ],
  errors: [...CHANGE_ERRORS],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK}/board.ts`, `${CLI}/board/command.ts`],
});

export const flow_client_org_board_hand_over = defineFlow({
  id: "client.org.board.hand-over",
  title: "Hand the Board to the shareholders, and sign it",
  about:
    "`org board handover`: opens the handover for the Organization alone, checks the calls are the Director hat's " +
    "eligibility and toggle to the Governor and the Shareholders' top hat to the Governor last, then signs and reads " +
    "until the Governor holds the Board.",
  component: component_core_sdk,
  sdk: "client.org(orgId).board.handOver",
  input: Schema.Struct({ ...OrgInput.fields, ...Follow }),
  output: BoardChangeView,
  steps: boardChange(rpc_board_directors_hand_over, "`changeHatEligibility`, `changeHatToggle` and the top hat's `transferHat` to the Governor"),
  errors: [...CHANGE_ERRORS],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK}/board-handover.ts`, `${CLI}/board/command.ts`],
});

export const flow_client_org_board_refresh = defineFlow({
  id: "client.org.board.refresh",
  title: "Drop the lapsed signers, and sign it",
  about:
    "`org board refresh`: opens the refresh by the Organization alone, prints who lapsed, checks the calls are one " +
    "`removeSigner` per lapsed signer and nothing else, then signs from the caller's own Safe and reads until removed.",
  component: component_core_sdk,
  sdk: "client.org(orgId).board.refresh",
  input: Schema.Struct({ ...OrgInput.fields, ...Follow }),
  output: BoardChangeView,
  steps: boardChange(rpc_board_directors_refresh, "one `removeSigner` per lapsed signer"),
  errors: [...CHANGE_ERRORS],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK}/board-refresh.ts`, `${CLI}/board/command.ts`],
});

// ── proposals ───────────────────────────────────────────────────────────────────────────────

export const flow_client_org_proposals_approve = defineFlow({
  id: "client.org.proposals.approve",
  title: "Approve a Board proposal, or execute it at the threshold",
  about:
    "`org proposal approve`: opens the caller's approval (`board.proposals.approve`), checks its calls are " +
    "`approveHash` of the proposal's own hash, or the lapsed signers' removal and `execTransaction` of exactly the " +
    "proposal's transaction, then signs and follows it until it lands. An execution whose sponsorship the chain " +
    "refuses is WRONG_STATE (`execution_reverts`) before anyone signs, and an approval that lands reverted (the " +
    "proposal changed on chain first) is WRONG_STATE too, with nothing moved. A client with no signer is " +
    "CAPABILITY_UNAVAILABLE (the CLI opens the approval page instead). It then says whether the proposal executed or " +
    "how many more Directors must approve.",
  component: component_core_sdk,
  sdk: "client.org(orgId).proposals.approve",
  input: Schema.Struct({ ...ProposalInput.fields, ...Follow }),
  output: ApprovalOpened,
  steps: [
    { name: "prepare", rpc: rpc_board_proposals_approve, about: "Refuses, or opens the caller's approval with its step (approve or execute)." },
    { name: "check-calls", local: "build", about: "Decodes the calls and refuses anything but the proposal's own approveHash or execution." },
    ...signing,
    { name: "read-back", rpc: rpc_board_proposals_get, about: "Reads the proposal: executed, or how many approvals it still needs." },
  ],
  errors: [error_CANCELLED, error_WRONG_STATE, error_CAPABILITY_UNAVAILABLE],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK}/proposals.ts`, `${SDK}/board-approval.ts`, `${CLI}/proposal/command.ts`],
});

export const flow_client_org_proposals_reject = defineFlow({
  id: "client.org.proposals.reject",
  title: "Propose a rejection, and approve it",
  about:
    "`org proposal reject`: opens the rejection (`board.proposals.reject`), checks it is one zero-value " +
    "`Payments.paid(bytes32(0))` at the rejected proposal's nonce, then signs the caller's approval of it and follows it. " +
    "Other Directors approve the rejection by its own id with `org proposal approve`.",
  component: component_core_sdk,
  sdk: "client.org(orgId).proposals.reject",
  input: Schema.Struct({ ...ProposalInput.fields, ...Follow }),
  output: ProposalView,
  steps: [
    { name: "prepare", rpc: rpc_board_proposals_reject, about: "Refuses, or opens the rejection and the caller's approval of it." },
    { name: "check-calls", local: "build", about: "Refuses a rejection that is anything but a zero-value read of Payments at that nonce." },
    ...signing,
    { name: "read-back", rpc: rpc_board_proposals_get, about: "Reads the rejection as it stands." },
  ],
  errors: [error_CANCELLED, error_WRONG_STATE],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK}/proposals.ts`, `${CLI}/proposal/command.ts`],
});

export const flow_client_org_proposals_wait = defineFlow({
  id: "client.org.proposals.wait",
  title: "Wait until nothing sent for a proposal is on its way",
  about:
    "`org proposal wait`: reads the proposal as `org proposal get` does every two seconds until no approval or " +
    "execution sent through Capxul is still on its way, or it is no longer waiting (returned at once), or " +
    "`--timeout-seconds` (two minutes without it) passes; then answers it as it stands. A transaction executed outside " +
    "Capxul at its nonce ends the wait as replaced.",
  component: component_core_sdk,
  sdk: "client.org(orgId).proposals.wait",
  input: Schema.Struct({ ...ProposalInput.fields, timeoutSeconds: NullOr(Schema.Int) }),
  output: ProposalView,
  steps: [
    { name: "read", rpc: rpc_board_proposals_get, about: "Reads the proposal; a proposal that is no longer waiting answers at once." },
    { name: "poll", local: "poll", about: "Reads again every two seconds while an approval it lists is `sent`." },
    { name: "chain", local: "wait", about: "The chain, between reads: never system time." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: { ...budget("read"), excludes: ["wait.chain"] },
  was: [`${SDK}/proposals.ts`, "books/as-is/organizations/flows-governance.ts"],
});

// ── officer hats ────────────────────────────────────────────────────────────────────────────

const officer = (prepare: Rpc, calls: string) => [
  { name: "prepare", rpc: prepare, about: "Refuses, or births the change with its Board proposal and the caller's first approval." },
  { name: "check-calls", local: "build" as const, about: `Decodes the proposal's batch and refuses to approve anything but ${calls}.` },
  ...signing,
  { name: "read-back", rpc: rpc_board_officers_get, about: "Reads the change and its proposal as they stand." },
];

export const flow_client_org_members_grant = defineFlow({
  id: "client.org.members.grant",
  title: "Propose an officer hat for a member, and approve it",
  about:
    "`org member grant`: proposes the officer hat's mint to the member's Safe (with the supply change first when the hat " +
    "is full), checks the batch, and signs the caller's approval of the proposal. The grant applies once the proposal executes.",
  component: component_core_sdk,
  sdk: "client.org(orgId).members.grant",
  input: Schema.Struct({ ...OfficerInput.fields, ...Follow }),
  output: OfficerChangeView,
  steps: officer(rpc_board_officers_grant, "the hat's supply change when full and its `mintHat` to the member's Safe"),
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK}/member-permissions.ts`, `${CLI}/member/grant`],
});

export const flow_client_org_members_revoke = defineFlow({
  id: "client.org.members.revoke",
  title: "Propose taking an officer hat back, and approve it",
  about:
    "`org member revoke`: proposes ruling the member's Safe out of the officer hat in good standing, checks the batch, " +
    "and signs the caller's approval of the proposal. The revoke applies once the proposal executes.",
  component: component_core_sdk,
  sdk: "client.org(orgId).members.revoke",
  input: Schema.Struct({ ...OfficerInput.fields, ...Follow }),
  output: OfficerChangeView,
  steps: officer(rpc_board_officers_revoke, "one `setHatWearerStatus(hat, memberSafe, false, true)`"),
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK}/member-permissions.ts`, `${CLI}/member/revoke`],
});

// ── the pre-v4 owner changes, refused ───────────────────────────────────────────────────────

/** What the old `org director` writes answered: the proposal and the owner change it carried. */
export const OwnerChangeView = Schema.Struct({
  ...ProposalView.fields,
  change: Schema.Struct({
    action: Schema.Literals(["add", "remove", "replace", "threshold"]),
    person: NullOr(Schema.Struct({ name: NullOr(S), email: S, safe: S })),
    replacement: NullOr(Schema.Struct({ name: NullOr(S), email: S, safe: S })),
    before: Schema.Struct({ directors: Schema.Int, threshold: Schema.Int }),
    after: Schema.Struct({ directors: Schema.Int, threshold: Schema.Int }),
  }),
});

/** What every refused `org director` write reads first: who the caller is, and the members it names. */
const authority = {
  name: "authority",
  rpc: rpc_board_directors_authority,
  about: "Reads the Board, whether the caller's Safe is a Director and wears the top hat, and the members named; nothing is written.",
};

const refused = (spec: { id: string; sdk: string; title: string; instead: string; input: Schema.Top; check: string; topHat?: boolean }) =>
  defineFlow({
    id: spec.id,
    title: spec.title,
    about:
      "Every Organization is a v4 company (P9), whose Signer Gate refuses an owner or threshold change its own Safe " +
      "makes (`CannotCallSafe`), so the method never proposes. It first reads where the caller and the members it names " +
      "stand (`board.directors.authority`: NOT_AUTHENTICATED without a sign-in, ROLE_PERMISSION_DENIED for a caller " +
      "with no Seat, WRONG_STATE with no deployment), then gives the frozen command's own refusals, and otherwise fails " +
      `WRONG_STATE naming \`${spec.instead}\`. Nothing is proposed, asked or signed.`,
    component: component_core_sdk,
    sdk: spec.sdk,
    input: spec.input,
    output: OwnerChangeView,
    steps: [authority, { name: "refuse", local: "build", about: spec.check }],
    errors: [
      ...(spec.topHat ? [error_RESERVED_MATTER] : []),
      error_ROLE_PERMISSION_DENIED,
      error_INVALID_INPUT,
      error_WRONG_STATE,
    ],
    calls: [],
    spans: [],
    budget: budget("chain-read"),
    was: [
      "packages/backend/src/organizations/proposals/operations/change-owners.ts:31",
      "packages/backend/src/organizations/proposals/errors.ts:112",
      "apps/cli/src/commands/org/subcommands/director/internal/change.ts:59",
    ],
  });

/** The refusal of a caller who is not a Director, the frozen pages' first. */
const NOT_A_DIRECTOR = "In order: ROLE_PERMISSION_DENIED when the caller's Safe is not a Director;";

const DirectorInput = Schema.Struct({ orgId: S, person: S, threshold: NullOr(Schema.Int), confirm: Schema.Boolean, noWait: Schema.Boolean });

export const flow_client_org_directors_add = refused({
  id: "client.org.directors.add",
  sdk: "client.org(orgId).directors.add",
  title: "Refuse a Director added by proposal: the Gate refuses it",
  instead: "capxul org board director add",
  input: DirectorInput,
  check: `${NOT_A_DIRECTOR} INVALID_INPUT when the person is not a member; else WRONG_STATE naming \`org board director add\`.`,
});
export const flow_client_org_directors_remove = refused({
  id: "client.org.directors.remove",
  sdk: "client.org(orgId).directors.remove",
  title: "Refuse a Director removed by proposal: the Gate refuses it",
  instead: "capxul org board director remove",
  input: DirectorInput,
  check:
    `${NOT_A_DIRECTOR} INVALID_INPUT when the person is not a member, is the last Director, or \`--threshold\` is ` +
    "below 1 or above the Directors left; else WRONG_STATE naming `org board director remove`.",
});
export const flow_client_org_directors_replace = refused({
  id: "client.org.directors.replace",
  sdk: "client.org(orgId).directors.replace",
  title: "Refuse a Director replaced by proposal: the Gate refuses it",
  instead: "capxul org board director remove` and `add",
  input: Schema.Struct({ orgId: S, person: S, replacement: S, confirm: Schema.Boolean, noWait: Schema.Boolean }),
  check: `${NOT_A_DIRECTOR} INVALID_INPUT when either person is not a member; else WRONG_STATE naming \`org board director remove\` and \`add\`.`,
});
export const flow_client_org_directors_set_threshold = refused({
  id: "client.org.directors.set-threshold",
  sdk: "client.org(orgId).directors.setThreshold",
  title: "Refuse a threshold changed by proposal: the Gate refuses it",
  instead: "capxul org board threshold",
  input: Schema.Struct({ orgId: S, threshold: Schema.Int, confirm: Schema.Boolean, noWait: Schema.Boolean }),
  check:
    "As `org board threshold` would, in order: RESERVED_MATTER when the Governor wears the top hat; ROLE_PERMISSION_DENIED " +
    "when the caller's Safe does not; INVALID_INPUT when `<n>` is 0, above the Directors or the threshold it has; else WRONG_STATE naming `org board threshold`.",
  topHat: true,
});
