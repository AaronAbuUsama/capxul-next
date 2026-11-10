// The target operation records of the 19 frozen operations board owns (OPERATION_OWNERS): the seven
// `org board` commands, the five `org director` commands, `org member grant` and `revoke`, and the
// five `org proposal` commands. Each is built from its frozen text and keeps its command. A write is
// implemented by one Core SDK flow, a read by one rpc (A4); `org proposal wait` is a polling flow.
//
// Acceptance (P1): each frozen claim is kept word for word with its test citation in `was`, unless it
// names a mechanism a black box cannot see (an old analytics event) or a pre-v4 path; then it is
// rewritten as an observable claim, the old line first in `was`, and the rewrite is recorded in
// decisions.ts (board.acceptance-events, board.director-commands). "On a v4 company" openings are
// stripped (P9) and the pre-v4-only lines retired as null. Refusals follow the frozen codes, with the
// designed text's RESERVED_MATTER (P10); each is reached from a world named in decision board.worlds.

import { Schema } from "effect";
import { ADDRESS, CHAIN_ID, PEOPLE, hash, ok, refused, uuid } from "../shared/examples.ts";
import { APPROVAL_ID, APPROVAL_URL, ORG, PROPOSAL, approvalOpened, boardChange, ownerChange, priya, marcus, proposal } from "./examples.ts";
import { budget, defineOperation } from "../../../packages/book/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CAPABILITY_UNAVAILABLE,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_RESERVED_MATTER,
  error_ROLE_CONFLICT,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { BoardChangeView, BoardView, SafeView, rpc_board_directors_safe, rpc_board_directors_show } from "./directors.ts";
import { ApprovalOpened, ProposalView, rpc_board_proposals_get, rpc_board_proposals_list } from "./proposals.ts";
import { OfficerChangeView } from "./officers.ts";
import {
  OwnerChangeView,
  flow_client_org_board_claim,
  flow_client_org_board_directors_add,
  flow_client_org_board_directors_remove,
  flow_client_org_board_hand_over,
  flow_client_org_board_refresh,
  flow_client_org_board_set_threshold,
  flow_client_org_directors_add,
  flow_client_org_directors_remove,
  flow_client_org_directors_replace,
  flow_client_org_directors_set_threshold,
  flow_client_org_members_grant,
  flow_client_org_members_revoke,
  flow_client_org_proposals_approve,
  flow_client_org_proposals_reject,
  flow_client_org_proposals_wait,
} from "./flows.ts";

// ── worlds (decision board.worlds) ──────────────────────────────────────────────────────────

/** A v4 Organization fresh from setup: the founder is its one Director (1 of 1) and wears the Shareholders' top hat; a set-up member, a member who has not finished signing up, and a signed-in outsider. */
export const W_FOUNDER = "org-with-founder-board";
/** org-with-founder-board with the set-up member seated as a second Director and the threshold 2 of 2. */
export const W_TWO = "org-with-two-directors";
/** org-with-two-directors with proposals: two waiting at consecutive nonces, one executed, one rejected, one replaced outside Capxul, a waiting rejection, a member wearing the Books hat and a waiting Invoicing grant. */
export const W_WAITING = "org-with-waiting-proposals";
/** org-with-founder-board with the founder's seat of the set-up member waiting for its approval. */
export const W_CHANGE = "org-with-board-change-waiting";
/** org-with-two-directors with the second Director's hat ruled out on chain while their Safe is still an owner. */
export const W_LAPSED = "org-with-lapsed-director";
/** org-with-two-directors after the equity install and `org board handover`: the Governor wears the Shareholders' top hat. */
export const W_HANDED = "org-with-board-handed-over";
/** An Organization whose setup waits for the founder's install approval: no deployment yet. */
export const W_SETUP = "org-with-setup-awaiting-install";
/** org-with-waiting-proposals with the `owner-safe-proposals` gate off for the Organization. */
export const W_GATE_OFF = "org-with-proposals-gate-off";
/** A machine whose CLI has no valid sign-in. */
export const W_SIGNED_OUT = "cli-signed-out";

// ── acceptance helpers ──────────────────────────────────────────────────────────────────────

type Line = { readonly claim: string; readonly was: readonly string[] };
const line = (id: FrozenId, n: number): Line => {
  const l = (frozen[id].acceptance as readonly Line[])[n - 1];
  if (!l) throw new Error(`${id} has no acceptance line ${n}`);
  return l;
};

/** The frozen claim, word for word, with its test citation. */
const keep = (id: FrozenId, n: number, observes: string) => {
  const l = line(id, n);
  return { claim: l.claim, observes, was: [...l.was] };
};

/** The frozen claim with its "On a v4 company" opening stripped (P9); the old line goes to `was`. */
const v4 = (id: FrozenId, n: number, observes: string) => {
  const l = line(id, n);
  const stripped = l.claim.replace(/^On (?:a v4 company|Protocol v4|a v4|v4),? /, "");
  return { claim: stripped.charAt(0).toUpperCase() + stripped.slice(1), observes, was: [l.claim, ...l.was] };
};

/** A rewritten claim (decisions board.acceptance-events, board.director-commands); the old line first in `was`. */
const rewrite = (id: FrozenId, n: number, claim: string, observes: string) => {
  const l = line(id, n);
  return { claim, observes, was: [l.claim, ...l.was] };
};

/** One board_change_transitioned for a change, by its transition, with no email or address in its properties. */
const reported = (transition: string) =>
  `trace: exactly one board_change_transitioned with transition ${transition} for the change, whose properties hold no email or address; ` +
  "a refused or failed change sends none with that transition";

const NOTHING = "world: the snapshot diff shows no approval, Board change, proposal or chain change";

// ── refusal helpers ─────────────────────────────────────────────────────────────────────────

const signedOut = { error: error_NOT_AUTHENTICATED, given: W_SIGNED_OUT, when: "No valid sign-in on this machine." };

/** The frozen `when` of an operation's n-th refusal (1-based), word for word. */
const when = (id: FrozenId, n: number) => String((frozen[id].refusals as readonly { when: string }[])[n - 1]!.when);
/** The designed text's `when` of a refusal by its code. */
const designedWhen = (id: FrozenId, code: string) => {
  const d = (frozen[id] as { designed: { refusals: readonly { code: string; when: string }[] } | null }).designed;
  const r = d?.refusals.find((x) => x.code === code);
  if (!r) throw new Error(`${id} has no designed ${code}`);
  return r.when;
};

const BOARD_WRITE = { ...budget("chain-submit"), excludes: ["wait.person", "chain.confirm"] };
const CHAIN_READ = budget("chain-read");
const READ = budget("read");

// ── org board ───────────────────────────────────────────────────────────────────────────────

const lc = (a: string) => a.toLowerCase();

const CLAIM = "org.board.claim";
export const operation_org_board_claim = defineOperation({
  ...frozenText(CLAIM),
  priority: "low",
  implementedBy: flow_client_org_board_claim,
  acceptance: [
    keep(CLAIM, 1, "chain: one UserOperation from the caller's own Safe whose one call is `HatsSignerGate.claimSigner(directorHat)`; read: `org board show` lists the caller with signer true"),
    keep(CLAIM, 2, "cli: ROLE_PERMISSION_DENIED for a member without the hat, WRONG_STATE for the founder who already signs and while another Board change waits; " + NOTHING),
    rewrite(
      CLAIM,
      3,
      "A claim that lands is `seated` as of its block, whatever the Board shows later, and reports `board_change_transitioned` (`claim`) once, with no email or Safe.",
      "read: `org(orgId).board.directors.get` reads `seated` at the landed block after a later removal; " + reported("claim"),
    ),
    keep(CLAIM, 4, "trace: the flow's steps prepare, sponsored, sign, give-signature and read-back under the one SDK method; cli: a declined or refused claim exits with its code at once, without waiting"),
  ],
  returns: BoardChangeView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W_FOUNDER, when: when(CLAIM, 1) },
    { error: error_WRONG_STATE, given: W_FOUNDER, when: when(CLAIM, 2) },
    signedOut,
  ],
  examples: [
    ok("Priya, newly elected, claims her seat and waits for her approval", "capxul org board claim --no-wait --json", boardChange({ action: "claim", status: "awaiting_approval", person: priya, seat: "elected", directors: 3, threshold: { needed: 2, of: 3 }, before: { needed: 2, of: 2 } })),
    refused("Priya's Director hat has not been granted", "capxul org board claim --json", error_ROLE_PERMISSION_DENIED),
    refused("Her Safe already signs", "capxul org board claim --json", error_WRONG_STATE),
  ],
  budget: BOARD_WRITE,
});

const ADD = "org.board.director.add";
export const operation_org_board_director_add = defineOperation({
  ...frozenText(ADD),
  priority: "low",
  implementedBy: flow_client_org_board_directors_add,
  acceptance: [
    keep(ADD, 1, "trace: prepare (by the member's email), sponsored, sign, give-signature and read-back under the one SDK method; cli: `status` seated, `directors` 2"),
    keep(ADD, 2, "cli: an approval whose signer is not the client's key is refused before it signs, and a declined, expired or refused seat exits with its code at once; world: nothing seated"),
    keep(ADD, 3, "chain: with every Director seat worn the founder's operation calls `Hats.changeHatMaxSupply(director, supply + 1)`, `Hats.mintHat` and `claimSignerFor` in that order; with a free seat only the mint and `claimSignerFor`, and the hat's max supply is unchanged"),
    keep(ADD, 4, "chain: for a member whose Safe already wears the Director hat, the operation's one call is `claimSignerFor`"),
    rewrite(
      ADD,
      5,
      "A seat that lands reports `board_change_transitioned` (`seat`) once, with no email or Safe.",
      reported("seat"),
    ),
  ],
  returns: BoardChangeView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W_TWO, when: when(ADD, 1) },
    { error: error_RESERVED_MATTER, given: W_HANDED, when: designedWhen(ADD, "RESERVED_MATTER") },
    { error: error_WRONG_STATE, given: W_FOUNDER, when: when(ADD, 2) },
    { error: error_INVALID_INPUT, given: W_FOUNDER, when: when(ADD, 3) },
    signedOut,
  ],
  examples: [
    ok("Hannah puts Priya forward as a Director", `capxul org board director add ${PEOPLE.priya.email} --no-wait --json`, boardChange({ action: "seat", person: priya, directors: 3, threshold: { needed: 2, of: 3 }, before: { needed: 2, of: 2 } })),
    refused("The email names nobody in the organization", `capxul org board director add stranger@northwind.test --json`, error_INVALID_INPUT),
    refused("The caller does not wear the Shareholders' top hat", `capxul org board director add ${PEOPLE.priya.email} --json`, error_ROLE_PERMISSION_DENIED),
  ],
  budget: BOARD_WRITE,
});

const REMOVE = "org.board.director.remove";
export const operation_org_board_director_remove = defineOperation({
  ...frozenText(REMOVE),
  priority: "low",
  implementedBy: flow_client_org_board_directors_remove,
  acceptance: [
    keep(REMOVE, 1, "chain: the founder's operation calls `Hats.setHatWearerStatus(director, samSafe, false, true)` then `HatsSignerGate.removeSigner(samSafe)`, and nothing targets the company Safe"),
    keep(REMOVE, 2, "cli: ROLE_PERMISSION_DENIED for the second Director, WRONG_STATE for a member who is not a Director, the last Director, a threshold above the Directors left and a change under way; " + NOTHING),
    rewrite(REMOVE, 3, "A removal that lands reports `board_change_transitioned` (`remove`) once, with no email or Safe.", reported("remove")),
    keep(REMOVE, 4, "trace: prepare (by the Director's email), sponsored, sign, give-signature and read-back under the one SDK method; cli: an expired removal exits with its code at once"),
    keep(REMOVE, 5, "chain: for a Director whose Safe already lost the hat, the operation's one call is `removeSigner`"),
  ],
  returns: BoardChangeView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W_TWO, when: when(REMOVE, 1) },
    { error: error_RESERVED_MATTER, given: W_HANDED, when: designedWhen(REMOVE, "RESERVED_MATTER") },
    { error: error_WRONG_STATE, given: W_FOUNDER, when: when(REMOVE, 2) },
    signedOut,
  ],
  examples: [
    ok("Hannah removes Marcus from the Board", `capxul org board director remove ${PEOPLE.marcus.email} --no-wait --json`, boardChange({ action: "remove", status: "awaiting_approval", person: null, removed: [marcus], directors: 1, threshold: { needed: 1, of: 1 }, before: { needed: 2, of: 2 } })),
    refused("The person is not a Director", `capxul org board director remove ${PEOPLE.priya.email} --json`, error_WRONG_STATE),
    refused("The caller does not wear the Shareholders' top hat", `capxul org board director remove ${PEOPLE.hannah.email} --json`, error_ROLE_PERMISSION_DENIED),
  ],
  budget: BOARD_WRITE,
});

const HANDOVER = "org.board.handover";
export const operation_org_board_handover = defineOperation({
  ...frozenText(HANDOVER),
  priority: "low",
  implementedBy: flow_client_org_board_hand_over,
  acceptance: [
    keep(HANDOVER, 1, "chain: the founder's operation is `Hats.changeHatEligibility(director, governor)`, `Hats.changeHatToggle(director, governor)` and `Hats.transferHat(shareholdersTop, founderSafe, governor)` last, the founder calls `Installer.buildEquity` returns"),
    keep(HANDOVER, 2, "cli: ROLE_PERMISSION_DENIED for the second Director, WRONG_STATE before the equity install, after a handover and while a Board change waits; " + NOTHING),
    keep(HANDOVER, 3, "cli: a handover while a seat waits, and a seat while a handover waits, are each WRONG_STATE naming the waiting change"),
    keep(HANDOVER, 4, "read: `org(orgId).board.directors.get` reads `handed_over` at the landed block; a world whose handover reverts reads `failed` with TRANSACTION_FAILED"),
    rewrite(HANDOVER, 5, "A handover that lands reports `board_change_transitioned` (`hand_over`) once.", reported("hand_over")),
    keep(HANDOVER, 6, "trace: prepare (by the Organization alone), sponsored, sign, give-signature and read-back under the one SDK method; cli: a refused handover exits with its code at once"),
  ],
  returns: BoardChangeView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W_TWO, when: when(HANDOVER, 1) },
    { error: error_WRONG_STATE, given: W_FOUNDER, when: when(HANDOVER, 2) },
    signedOut,
  ],
  examples: [
    ok("Hand the Board over to the Governor after the equity install", "capxul org board handover --no-wait --json", boardChange({ action: "handover", status: "awaiting_approval" })),
    refused("The Board is already handed over", "capxul org board handover --json", error_WRONG_STATE),
    refused("The caller does not wear the Shareholders' top hat", "capxul org board handover --json", error_ROLE_PERMISSION_DENIED),
  ],
  budget: BOARD_WRITE,
});

const REFRESH = "org.board.refresh";
export const operation_org_board_refresh = defineOperation({
  ...frozenText(REFRESH),
  priority: "low",
  implementedBy: flow_client_org_board_refresh,
  acceptance: [
    keep(REFRESH, 1, "chain: one operation from the caller's Safe with one `HatsSignerGate.removeSigner` per lapsed owner; cli: `removed` names each by the member holding the Safe"),
    keep(REFRESH, 2, "cli: WRONG_STATE with nobody lapsed, with every Director lapsed, and while another Board change waits; " + NOTHING),
    keep(REFRESH, 3, "read: `org(orgId).board.directors.get` reads `removed` at the landed block and `person` null"),
    rewrite(
      REFRESH,
      4,
      "A refresh that lands reports `board_change_transitioned` (`lapse`) once with the count it dropped, with no email or Safe.",
      reported("lapse") + ", with `removed_count` the number of signers dropped",
    ),
    keep(REFRESH, 5, "trace: prepare (by the Organization alone), sponsored, sign, give-signature and read-back under the one SDK method; cli: a refused refresh exits with its code at once"),
  ],
  returns: BoardChangeView,
  errors: [error_CLI_USAGE],
  refusals: [{ error: error_WRONG_STATE, given: W_TWO, when: when(REFRESH, 1) }, signedOut],
  examples: [
    ok("Refresh the Board after Marcus's Director hat lapsed", "capxul org board refresh --no-wait --json", boardChange({ action: "refresh", status: "awaiting_approval", removed: [marcus], directors: 1, threshold: { needed: 1, of: 1 }, before: { needed: 2, of: 2 } })),
    refused("Nobody's hat has lapsed", "capxul org board refresh --json", error_WRONG_STATE),
  ],
  budget: BOARD_WRITE,
});

const SHOW = "org.board.show";
export const operation_org_board_show = defineOperation({
  ...frozenText(SHOW),
  priority: "low",
  implementedBy: rpc_board_directors_show,
  acceptance: [
    keep(SHOW, 1, "cli: a member who is not a Director reads both Directors, each signer true, `threshold` 2 of 2, and `seat`, `electedBy` and `termEnds` null"),
    keep(SHOW, 2, "cli: the lapsed Director is listed with signer false, and `threshold.needed` is the Safe's `getThreshold` at the same block"),
    null,
    keep(SHOW, 4, "cli: WRONG_STATE for an Organization with no deployment; world: no chain read in the trace"),
    keep(SHOW, 5, "cli: ROLE_PERMISSION_DENIED for the signed-in outsider"),
    keep(SHOW, 6, "cli: the human output prints `2 directors · signs 2 of 2`, then each Director, marking `you` and an owner who cannot sign"),
  ],
  returns: BoardView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_WRONG_STATE, given: W_SETUP, when: when(SHOW, 1) },
    { error: error_ROLE_PERMISSION_DENIED, given: W_FOUNDER, when: when(SHOW, 2) },
    signedOut,
  ],
  examples: [
    ok("Northwind's Board: two Directors, both must sign", "capxul org board show --json", {
      orgId: ORG,
      threshold: { needed: 2, of: 2 },
      directors: [
        { address: ADDRESS.hannah, label: PEOPLE.hannah.name, isCaller: true, signer: true, seat: "founder", electedBy: null, termEnds: null },
        { address: ADDRESS.marcus, label: PEOPLE.marcus.name, isCaller: false, signer: true, seat: "elected", electedBy: "2026-01-20", termEnds: "2027-01-20" },
      ],
    }),
    refused("An outsider reads the Board", "capxul org board show --org northwind --json", error_ROLE_PERMISSION_DENIED),
    refused("The company has no installation yet", "capxul org board show --json", error_WRONG_STATE),
  ],
  budget: CHAIN_READ,
});

const THRESHOLD = "org.board.threshold";
export const operation_org_board_threshold = defineOperation({
  ...frozenText(THRESHOLD),
  priority: "low",
  implementedBy: flow_client_org_board_set_threshold,
  acceptance: [
    keep(THRESHOLD, 1, "chain: the founder's operation is one `HatsSignerGate.setThresholdConfig({ ABSOLUTE, 1, 1 })` and nothing targets the company Safe; read: the Safe's threshold reads 1"),
    keep(THRESHOLD, 2, "cli: ROLE_PERMISSION_DENIED for the second Director, INVALID_INPUT for 3 and for 2, WRONG_STATE while another threshold waits; " + NOTHING),
    rewrite(THRESHOLD, 3, "A threshold that lands reports `board_change_transitioned` (`set_threshold`) once.", reported("set_threshold")),
    keep(THRESHOLD, 4, "trace: prepare (by the number), sponsored, sign, give-signature and read-back under the one SDK method; cli: a declined threshold exits CANCELLED at once"),
  ],
  returns: BoardChangeView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W_TWO, when: when(THRESHOLD, 1) },
    { error: error_INVALID_INPUT, given: W_TWO, when: when(THRESHOLD, 2) },
    { error: error_WRONG_STATE, given: W_CHANGE, when: when(THRESHOLD, 3) },
    { error: error_RESERVED_MATTER, given: W_HANDED, when: designedWhen(THRESHOLD, "RESERVED_MATTER") },
    signedOut,
  ],
  examples: [
    ok("Lower the threshold to one signature of two", "capxul org board threshold 1 --no-wait --json", boardChange({ action: "threshold", threshold: { needed: 1, of: 2 }, before: { needed: 2, of: 2 } })),
    refused("The threshold is more than there are Directors", "capxul org board threshold 5 --json", error_INVALID_INPUT),
    refused("The Governor holds the hat after handover", "capxul org board threshold 1 --json", error_RESERVED_MATTER),
  ],
  budget: BOARD_WRITE,
});

// ── org director: the pre-v4 owner changes, and the Safe read ───────────────────────────────

/** How a refusal of an `org director` write is seen: who reaches WRONG_STATE, then one read and nothing written. */
const refusedObserves = (who: string, also = "") =>
  `cli: exit 2 with WRONG_STATE naming the v4 command for ${who} whose request the Board can take${also}; ` +
  "trace: one `board.directors.authority` span under the SDK method and no write; " + NOTHING;
const REFUSED_OBSERVES = refusedObserves("a Director");
const TOP_HAT_OBSERVES = refusedObserves("the top hat's wearer");
const REFUSE_OTHERWISE =
  "Every other time: the Organization is a v4 company, whose Signer Gate refuses an owner or threshold change its Safe " +
  "makes (`CannotCallSafe`). Nothing is proposed.";
/** A refusal of an `org director` write that its frozen page names, before the v4 refusal. */
const pageRefusal = (code: string, who: string) => `cli: ${who} exits with ${code} before anything is proposed; ${NOTHING}`;

const D_ADD = "org.director.add";
export const operation_org_director_add = defineOperation({
  ...frozenText(D_ADD),
  priority: "low",
  implementedBy: flow_client_org_directors_add,
  acceptance: [
    rewrite(
      D_ADD,
      1,
      "A Director adding a member by proposal is refused `WRONG_STATE` before anything is proposed, naming `org board director add`: the Signer Gate refuses an owner change the company Safe makes.",
      REFUSED_OBSERVES,
    ),
    null,
    null,
    null,
    keep(D_ADD, 5, REFUSED_OBSERVES),
    null,
  ],
  returns: OwnerChangeView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W_FOUNDER, when: when(D_ADD, 1) },
    { error: error_INVALID_INPUT, given: W_FOUNDER, when: when(D_ADD, 2) },
    { error: error_WRONG_STATE, given: W_TWO, when: REFUSE_OTHERWISE + " Use `capxul org board director add`." },
    signedOut,
  ],
  examples: [
    ok("Propose Priya as an owner of the company Safe", `capxul org director add ${PEOPLE.priya.email} --no-wait --json`, ownerChange({ action: "add", person: { name: PEOPLE.priya.name, email: PEOPLE.priya.email, safe: ADDRESS.priya }, replacement: null, before: { directors: 2, threshold: 2 }, after: { directors: 3, threshold: 2 } })),
    refused("A v4 company's Signer Gate refuses an owner change", `capxul org director add ${PEOPLE.priya.email} --json`, error_WRONG_STATE),
    refused("The person is not a member yet", `capxul org director add newhire@northwind.test --json`, error_INVALID_INPUT),
  ],
  budget: CHAIN_READ,
});

const D_LIST = "org.director.list";
export const operation_org_director_list = defineOperation({
  ...frozenText(D_LIST),
  priority: "low",
  implementedBy: rpc_board_directors_safe,
  acceptance: [
    keep(D_LIST, 1, "cli: a member who is not a Director reads both owners with signer true, `threshold` 2, the Safe's next `nonce` and `waiting` 2 in the world with two waiting proposals"),
    keep(D_LIST, 2, "cli: `isCaller` is true on the caller's own Safe and false on every other owner"),
  ],
  returns: SafeView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_WRONG_STATE, given: W_SETUP, when: when(D_LIST, 1) },
    { error: error_ROLE_PERMISSION_DENIED, given: W_FOUNDER, when: when(D_LIST, 2) },
    signedOut,
  ],
  examples: [
    ok("Northwind's company Safe: its owners, threshold, nonce and waiting proposals", "capxul org director list --json", {
      orgId: ORG,
      chainId: CHAIN_ID,
      safeAddress: ADDRESS.northwind,
      threshold: 2,
      nonce: 7,
      owners: [
        { address: ADDRESS.hannah, label: PEOPLE.hannah.name, isCaller: true, signer: true },
        { address: ADDRESS.marcus, label: PEOPLE.marcus.name, isCaller: false, signer: true },
      ],
      waiting: 1,
    }),
    refused("An outsider lists the owners", "capxul org director list --org northwind --json", error_ROLE_PERMISSION_DENIED),
  ],
  budget: CHAIN_READ,
});

const D_REMOVE = "org.director.remove";
export const operation_org_director_remove = defineOperation({
  ...frozenText(D_REMOVE),
  priority: "low",
  implementedBy: flow_client_org_directors_remove,
  acceptance: [
    rewrite(
      D_REMOVE,
      1,
      "A Director removing a Director by proposal is refused `WRONG_STATE` before anything is proposed, naming `org board director remove`: the Signer Gate refuses an owner change the company Safe makes.",
      REFUSED_OBSERVES,
    ),
    keep(D_REMOVE, 2, pageRefusal("INVALID_INPUT", "in org-with-founder-board the founder removing themselves, the last Director,")),
    keep(D_REMOVE, 3, REFUSED_OBSERVES),
    null,
  ],
  returns: OwnerChangeView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W_FOUNDER, when: when(D_REMOVE, 1) },
    { error: error_INVALID_INPUT, given: W_FOUNDER, when: when(D_REMOVE, 2) },
    { error: error_WRONG_STATE, given: W_TWO, when: REFUSE_OTHERWISE + " Use `capxul org board director remove`." },
    signedOut,
  ],
  examples: [
    ok("Propose removing Marcus as an owner", `capxul org director remove ${PEOPLE.marcus.email} --no-wait --json`, ownerChange({ action: "remove", person: { name: PEOPLE.marcus.name, email: PEOPLE.marcus.email, safe: ADDRESS.marcus }, replacement: null, before: { directors: 2, threshold: 2 }, after: { directors: 1, threshold: 1 } })),
    refused("The person is the last Director", `capxul org director remove ${PEOPLE.hannah.email} --json`, error_INVALID_INPUT),
    refused("A v4 company's Signer Gate refuses an owner change", `capxul org director remove ${PEOPLE.marcus.email} --json`, error_WRONG_STATE),
  ],
  budget: CHAIN_READ,
});

const D_REPLACE = "org.director.replace";
export const operation_org_director_replace = defineOperation({
  ...frozenText(D_REPLACE),
  priority: "low",
  implementedBy: flow_client_org_directors_replace,
  acceptance: [
    rewrite(
      D_REPLACE,
      1,
      "A Director replacing a Director by proposal is refused `WRONG_STATE` before anything is proposed: the Signer Gate refuses an owner change the company Safe makes; the founder removes and adds with `org board director`.",
      REFUSED_OBSERVES,
    ),
    null,
    keep(D_REPLACE, 3, REFUSED_OBSERVES),
  ],
  returns: OwnerChangeView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W_FOUNDER, when: when(D_REPLACE, 1) },
    { error: error_INVALID_INPUT, given: W_FOUNDER, when: when(D_REPLACE, 2) },
    { error: error_WRONG_STATE, given: W_TWO, when: REFUSE_OTHERWISE + " Use `capxul org board director remove` and `add`." },
    signedOut,
  ],
  examples: [
    ok("Propose Priya in Marcus's place", `capxul org director replace ${PEOPLE.marcus.email} ${PEOPLE.priya.email} --no-wait --json`, ownerChange({ action: "replace", person: { name: PEOPLE.marcus.name, email: PEOPLE.marcus.email, safe: ADDRESS.marcus }, replacement: { name: PEOPLE.priya.name, email: PEOPLE.priya.email, safe: ADDRESS.priya }, before: { directors: 2, threshold: 2 }, after: { directors: 2, threshold: 2 } })),
    refused("The new person is not a member yet", `capxul org director replace ${PEOPLE.marcus.email} newhire@northwind.test --json`, error_INVALID_INPUT),
    refused("A v4 company's Signer Gate refuses an owner change", `capxul org director replace ${PEOPLE.marcus.email} ${PEOPLE.priya.email} --json`, error_WRONG_STATE),
  ],
  budget: CHAIN_READ,
});

const D_THRESHOLD = "org.director.threshold";
export const operation_org_director_threshold = defineOperation({
  ...frozenText(D_THRESHOLD),
  priority: "low",
  implementedBy: flow_client_org_directors_set_threshold,
  acceptance: [
    rewrite(
      D_THRESHOLD,
      1,
      "A threshold change by proposal is refused before anything is proposed: the wearer of the Shareholders' top hat asking for a number the Board can take gets `WRONG_STATE` naming `org board threshold`, and every other request the refusal `org board threshold` gives it.",
      refusedObserves(
        "the top hat's wearer",
        ", RESERVED_MATTER in org-with-board-handed-over and ROLE_PERMISSION_DENIED for the second Director, as `org board threshold` answers",
      ),
    ),
    keep(D_THRESHOLD, 2, TOP_HAT_OBSERVES),
    null,
  ],
  returns: OwnerChangeView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_RESERVED_MATTER, given: W_HANDED, when: designedWhen(D_THRESHOLD, "RESERVED_MATTER") },
    { error: error_ROLE_PERMISSION_DENIED, given: W_TWO, when: designedWhen(D_THRESHOLD, "ROLE_PERMISSION_DENIED") },
    { error: error_INVALID_INPUT, given: W_TWO, when: "The number is 0, more than there are Directors, or the threshold it already has." },
    { error: error_WRONG_STATE, given: W_TWO, when: REFUSE_OTHERWISE + " Use `capxul org board threshold`." },
    signedOut,
  ],
  examples: [
    ok("Propose a threshold of one", "capxul org director threshold 1 --no-wait --json", ownerChange({ action: "threshold", person: null, replacement: null, before: { directors: 2, threshold: 2 }, after: { directors: 2, threshold: 1 } })),
    refused("The threshold is already 2", "capxul org director threshold 2 --json", error_INVALID_INPUT),
    refused("The caller does not wear the Shareholders' top hat", "capxul org director threshold 1 --json", error_ROLE_PERMISSION_DENIED),
  ],
  budget: CHAIN_READ,
});

// ── org member grant and revoke ─────────────────────────────────────────────────────────────

const OFFICER_NOTHING = "world: the snapshot diff shows no officer change, proposal or approval row";
/** Budgets' world: a v4 Organization with a budget tree whose departments have office holders (decision budgets.worlds). */
const W_BUDGET_TREE = "org-with-budget-tree";
const PEOPLE_CONFLICT_WHEN =
  "Manage people for a member who holds a department's or team's office: one person cannot hold both (ADR-0040). Nothing is proposed.";
const GATE_WHEN = "The `owner-safe-proposals` gate is off for the Organization, or for Manage books the `books` gate. Nothing is proposed.";

const GRANT = "org.member.grant";
export const operation_org_member_grant = defineOperation({
  ...frozenText(GRANT),
  priority: "normal",
  implementedBy: flow_client_org_members_grant,
  acceptance: [
    keep(GRANT, 1, "read: `org proposal get` shows the grant's proposal waiting; after the second Director approves, `org member get` shows the member wearing the hat and the change reads `applied`"),
    keep(GRANT, 2, "cli: ROLE_PERMISSION_DENIED for a member who is not a Director, INVALID_INPUT for the outsider's email, WRONG_STATE for the member already wearing the Books hat; " + OFFICER_NOTHING),
    keep(GRANT, 3, "cli: a second grant of Invoicing to the member whose grant waits is WRONG_STATE; " + OFFICER_NOTHING),
    keep(GRANT, 4, "cli: FEATURE_NOT_AVAILABLE with `owner-safe-proposals` off, and for Manage books with `books` off; " + OFFICER_NOTHING),
    rewrite(
      GRANT,
      5,
      "It reports one `officer_change_transitioned` (`propose`) for the proposing Director, carrying neither the Seat nor the note.",
      "trace: exactly one officer_change_transitioned with transition propose, its actor the proposing Director and no member id, email or note in its properties",
    ),
    v4(GRANT, 6, "chain: the executed batch is `Hats.mintHat(hat, memberSafe)`, preceded by `changeHatMaxSupply(hat, supply + 1)` when every seat is worn"),
    v4(GRANT, 7, "cli: WRONG_STATE for each; " + OFFICER_NOTHING),
    rewrite(GRANT, 8, "Manage people is the People hat.", "chain: a granted `manage-people` mints the deployment's People hat; read: `org member get` shows it"),
  ],
  returns: OfficerChangeView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W_FOUNDER, when: when(GRANT, 1) },
    { error: error_INVALID_INPUT, given: W_FOUNDER, when: when(GRANT, 2) },
    { error: error_WRONG_STATE, given: W_WAITING, when: when(GRANT, 3) },
    { error: error_WRONG_STATE, given: W_FOUNDER, when: when(GRANT, 4) },
    { error: error_FEATURE_NOT_AVAILABLE, given: W_GATE_OFF, when: GATE_WHEN },
    { error: error_ROLE_CONFLICT, given: W_BUDGET_TREE, when: PEOPLE_CONFLICT_WHEN },
    signedOut,
  ],
  examples: [
    ok("Hannah gives Marcus the Manage books permission", `capxul org member grant ${PEOPLE.marcus.email} --permission manage-books --note "Marcus keeps the Finance books" --no-wait --json`, {
      change: { changeId: "oc_0270", change: "grant", permission: "manage-books", email: PEOPLE.marcus.email, name: PEOPLE.marcus.name, state: "proposed" },
      proposal: { proposalId: PROPOSAL.second, nonce: 8, status: "awaiting_approvals", threshold: 2, approvals: [ADDRESS.hannah], note: "Marcus keeps the Finance books", approvalId: APPROVAL_ID, url: APPROVAL_URL },
    }),
    refused("The email is not a current member", `capxul org member grant stranger@northwind.test --permission manage-books --json`, error_INVALID_INPUT),
    refused("Marcus already holds that permission", `capxul org member grant ${PEOPLE.marcus.email} --permission manage-books --json`, error_WRONG_STATE),
    refused("The proposals gate is off for the organization", `capxul org member grant ${PEOPLE.priya.email} --permission issue-invoices --json`, error_FEATURE_NOT_AVAILABLE),
  ],
  budget: BOARD_WRITE,
});

const REVOKE = "org.member.revoke";
export const operation_org_member_revoke = defineOperation({
  ...frozenText(REVOKE),
  priority: "normal",
  implementedBy: flow_client_org_members_revoke,
  acceptance: [
    keep(REVOKE, 1, "read: the proposal's note is the Director's `--note`, or `Take back manage-books from <name>`; once it executes, `org member get` shows the hat gone and the change `applied`"),
    keep(REVOKE, 2, "cli: ROLE_PERMISSION_DENIED for a member who is not a Director, INVALID_INPUT for the outsider's email, WRONG_STATE for a hat the member does not wear; " + OFFICER_NOTHING),
    keep(REVOKE, 3, "cli: a second revoke while one waits is WRONG_STATE, and a signed-out CLI is NOT_AUTHENTICATED; " + OFFICER_NOTHING),
    rewrite(
      REVOKE,
      4,
      "It reports one `officer_change_transitioned` (`propose`) for the proposing Director, carrying neither the Seat nor the note.",
      "trace: exactly one officer_change_transitioned with transition propose, its actor the proposing Director and no member id, email or note in its properties",
    ),
    v4(REVOKE, 5, "chain: the executed batch is `Hats.setHatWearerStatus(hat, memberSafe, false, true)` and the member's standing stays good; cli: WRONG_STATE for a Seat whose Safe does not wear the hat"),
  ],
  returns: OfficerChangeView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W_FOUNDER, when: when(REVOKE, 1) },
    { error: error_INVALID_INPUT, given: W_FOUNDER, when: when(REVOKE, 2) },
    { error: error_WRONG_STATE, given: W_WAITING, when: when(REVOKE, 3) },
    { error: error_WRONG_STATE, given: W_FOUNDER, when: when(REVOKE, 4) },
    { error: error_FEATURE_NOT_AVAILABLE, given: W_GATE_OFF, when: GATE_WHEN },
    signedOut,
  ],
  examples: [
    ok("Take the Issue invoices permission away from Priya", `capxul org member revoke ${PEOPLE.priya.email} --permission issue-invoices --no-wait --json`, {
      change: { changeId: "oc_0271", change: "revoke", permission: "issue-invoices", email: PEOPLE.priya.email, name: PEOPLE.priya.name, state: "proposed" },
      proposal: { proposalId: PROPOSAL.second, nonce: 8, status: "awaiting_approvals", threshold: 2, approvals: [ADDRESS.hannah], note: "", approvalId: APPROVAL_ID, url: APPROVAL_URL },
    }),
    refused("Priya does not hold that permission", `capxul org member revoke ${PEOPLE.priya.email} --permission manage-people --json`, error_WRONG_STATE),
    refused("The caller's Safe is not an owner", `capxul org member revoke ${PEOPLE.priya.email} --permission issue-invoices --json`, error_ROLE_PERMISSION_DENIED),
  ],
  budget: BOARD_WRITE,
});

// ── org proposal ────────────────────────────────────────────────────────────────────────────

const APPROVE = "org.proposal.approve";
export const operation_org_proposal_approve = defineOperation({
  ...frozenText(APPROVE),
  priority: "normal",
  implementedBy: flow_client_org_proposals_approve,
  acceptance: [
    keep(APPROVE, 1, "chain: on the 2-of-2 Board the first approval is `Safe.approveHash` and moves no money; the second is `execTransaction` and the proposal's transfer lands; on the 1-of-1 Board the proposer's own approval is the execution"),
    keep(APPROVE, 2, "read: `org proposal get` lists the approval `sent` until the chain holds its ApproveHash, then `approved`; an approval whose window ends unseen reads expired and the CLI exits with its code"),
    keep(APPROVE, 3, "cli: the second call answers the same `approvalId`; world: one approval row"),
    keep(APPROVE, 4, "cli: ROLE_PERMISSION_DENIED for a member who is not a Director; a signature from another key is INVALID_INPUT from approvals and the bundler receives nothing"),
    keep(APPROVE, 5, "cli: FEATURE_NOT_AVAILABLE with the gate off; with the gate turned off after signing, the approval stays signed and unsent; chain: no operation"),
    keep(APPROVE, 6, "cli: the human output says `approval 1 of 2` or `executes the proposal`, and the result once it lands"),
    keep(APPROVE, 7, "cli: WRONG_STATE `execution_reverts` before the page asks for a signature; chain: no operation"),
  ],
  returns: ApprovalOpened,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CAPABILITY_UNAVAILABLE, given: W_WAITING, when: when(APPROVE, 1) },
    { error: error_ROLE_PERMISSION_DENIED, given: W_LAPSED, when: when(APPROVE, 2) },
    { error: error_INVALID_INPUT, given: W_WAITING, when: when(APPROVE, 3) },
    { error: error_WRONG_STATE, given: W_WAITING, when: when(APPROVE, 4) },
    { error: error_FEATURE_NOT_AVAILABLE, given: W_GATE_OFF, when: "The `owner-safe-proposals` gate is off for the Organization. Nothing was signed." },
    signedOut,
  ],
  examples: [
    ok("Marcus opens his approval of the waiting proposal", `capxul org proposal approve ${PROPOSAL.waiting} --no-wait --json`, approvalOpened),
    refused("Marcus's Director hat has lapsed", `capxul org proposal approve ${PROPOSAL.waiting} --json`, error_ROLE_PERMISSION_DENIED),
    refused("The proposal already executed", `capxul org proposal approve ${PROPOSAL.executed} --json`, error_WRONG_STATE),
    refused("No proposal with that id", `capxul org proposal approve ${uuid(299)} --json`, error_INVALID_INPUT),
  ],
  budget: BOARD_WRITE,
});

const GET = "org.proposal.get";
export const operation_org_proposal_get = defineOperation({
  ...frozenText(GET),
  priority: "normal",
  implementedBy: rpc_board_proposals_get,
  acceptance: [
    keep(GET, 1, "read: the proposal whose nonce a transaction made outside Capxul used reads `replaced`"),
    keep(GET, 2, "read: after a Director is seated, their indexed ApproveHash appears in `approvals` at the next read"),
    keep(GET, 3, "read: a proposal settled before 101 newer ones is read by its id with its settled status"),
    keep(GET, 4, "cli: exit 2 with INVALID_INPUT for an id the Organization does not hold"),
  ],
  returns: ProposalView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W_WAITING, when: when(GET, 1) },
    { error: error_INVALID_INPUT, given: W_WAITING, when: when(GET, 2) },
    signedOut,
  ],
  examples: [
    ok("Read the waiting proposal", `capxul org proposal get ${PROPOSAL.waiting} --json`, proposal()),
    refused("No proposal with that id", `capxul org proposal get ${uuid(299)} --json`, error_INVALID_INPUT),
    refused("Not a member of the organization", `capxul org proposal get ${PROPOSAL.waiting} --org northwind --json`, error_ROLE_PERMISSION_DENIED),
  ],
  budget: READ,
});

const LIST = "org.proposal.list";
export const operation_org_proposal_list = defineOperation({
  ...frozenText(LIST),
  priority: "normal",
  implementedBy: rpc_board_proposals_list,
  acceptance: [
    keep(LIST, 1, "cli: a member reads every proposal newest nonce first with its settled status; `--status awaiting_approvals` lists only the waiting ones"),
  ],
  returns: Schema.Array(ProposalView),
  errors: [error_CLI_USAGE],
  refusals: [{ error: error_ROLE_PERMISSION_DENIED, given: W_WAITING, when: when(LIST, 1) }, signedOut],
  examples: [
    ok("Proposals still waiting for approvals", "capxul org proposal list --status waiting --json", [
      proposal({ proposalId: PROPOSAL.second, nonce: 8, note: "Grant Marcus Manage books", createdAt: Date.parse("2026-02-10T08:00:00Z") }),
      proposal(),
    ]),
    refused("Not a member of the organization", "capxul org proposal list --org northwind --json", error_ROLE_PERMISSION_DENIED),
  ],
  budget: READ,
});

const REJECT = "org.proposal.reject";
export const operation_org_proposal_reject = defineOperation({
  ...frozenText(REJECT),
  priority: "normal",
  implementedBy: flow_client_org_proposals_reject,
  acceptance: [
    keep(REJECT, 1, "chain: once the rejection executes at the nonce, the rejected proposal's transfer never happens; read: it reads `rejected`"),
    keep(REJECT, 2, "cli: rejecting the waiting rejection is WRONG_STATE; world: no new proposal"),
    keep(REJECT, 3, "trace: one proposal_transitioned with transition propose for the new rejection, and none when it is asked again; cli: the same `proposalId` both times"),
    keep(REJECT, 4, "chain: the rejection's transaction is one call of `Payments.paid(bytes32(0))` with value 0"),
    keep(REJECT, 5, "cli: in org-with-lapsed-director, ROLE_PERMISSION_DENIED `director_hat_lapsed` for the lapsed Director; world: no rejection"),
  ],
  returns: ProposalView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W_WAITING, when: when(REJECT, 1) },
    { error: error_INVALID_INPUT, given: W_WAITING, when: when(REJECT, 2) },
    { error: error_WRONG_STATE, given: W_WAITING, when: when(REJECT, 3) },
    signedOut,
  ],
  examples: [
    ok("Hannah proposes rejecting the waiting proposal", `capxul org proposal reject ${PROPOSAL.waiting} --no-wait --json`, proposal({ proposalId: PROPOSAL.rejection, kind: "rejection", rejects: PROPOSAL.waiting, note: null, transaction: { to: lc(ADDRESS.northwind), value: "0", data: "0x", operation: "call" }, calls: [{ to: lc(ADDRESS.northwind), value: "0", data: "0x" }] })),
    refused("The proposal already executed", `capxul org proposal reject ${PROPOSAL.executed} --json`, error_WRONG_STATE),
    refused("The caller is not a Director", `capxul org proposal reject ${PROPOSAL.waiting} --json`, error_ROLE_PERMISSION_DENIED),
  ],
  budget: BOARD_WRITE,
});

const WAIT = "org.proposal.wait";
export const operation_org_proposal_wait = defineOperation({
  ...frozenText(WAIT),
  priority: "normal",
  implementedBy: flow_client_org_proposals_wait,
  acceptance: [
    keep(WAIT, 1, "trace: the SDK method's spans are `board.proposals.get` reads every two seconds until no approval is `sent`; cli: the result equals `org proposal get` at that moment"),
    keep(WAIT, 2, "cli: the wait on the proposal whose nonce was used outside Capxul ends with `status` replaced"),
    keep(WAIT, 3, "cli: exit 2 with INVALID_INPUT for an id the Organization does not hold"),
  ],
  returns: ProposalView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W_WAITING, when: when(WAIT, 1) },
    { error: error_INVALID_INPUT, given: W_WAITING, when: when(WAIT, 2) },
    signedOut,
  ],
  examples: [
    ok("Follow the proposal until it executes", `capxul org proposal wait ${PROPOSAL.waiting} --timeout-seconds 120 --json`, proposal({ status: "executed", approvals: [{ owner: ADDRESS.hannah, label: PEOPLE.hannah.name, state: "approved" }, { owner: ADDRESS.marcus, label: PEOPLE.marcus.name, state: "approved" }], executionUserOpHash: hash("7c") })),
    refused("No proposal with that id", `capxul org proposal wait ${uuid(299)} --json`, error_INVALID_INPUT),
  ],
  budget: { ...READ, excludes: ["wait.chain"] },
});
