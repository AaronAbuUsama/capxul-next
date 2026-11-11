// Moved out of the built book by the cut, 10 November 2026, from books/target/shared/external.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineContract, defineIntegration } from "../../../packages/book/src/index.ts";
import { component_backend, component_core_sdk } from "./foundation.ts";
import {
  error_AMOUNT_BELOW_USE,
  error_CANCELLED,
  error_CHILDREN_EXCEED_PARENT,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_TRANSACTION_FAILED,
  error_VERIFICATION_REQUIRED,
  error_WORK_DIED,
  error_WRONG_ENVIRONMENT,
  error_WRONG_STATE,
} from "./vocabulary.ts";

export const contract_captable = defineContract({
  id: "captable",
  title: "Captable: share classes and issues",
  about: "One clone per company: share classes, their authorised amounts, issues, conversions and transfer consent. The address is the implementation.",
  addresses: { [DEV]: "0xC0e3Ac47f0e59AD627ED36F9146D6F366e47eeC1" },
  functions: {
    createClass: { signature: "createClass(ClassParams p) returns (uint8 classId)", about: "A new share class." },
    setAuthorised: { signature: "setAuthorised(uint8 classId, uint128 amount)", about: "A class's authorised amount." },
    issue: { signature: "issue(uint8 classId, address to, uint128 amount, bytes32 reason)", about: "Issues shares." },
    convert: { signature: "convert(uint8 classId, uint128 amount)", about: "A shareholder converts shares." },
    consentToTransfer: { signature: "consentToTransfer(uint8 classId, address to, uint128 amount, bytes32 reason)", about: "Consents to a transfer." },
    setIssuerAllowance: { signature: "setIssuerAllowance(address module, uint8 classId, uint128 amount)", about: "Lets Rounds or Options issue up to an amount of a class (Board)." },
    getClass: { signature: "getClass(uint8 classId) view returns (Class)", about: "A class's token, weight and terms, for the cap table." },
    setTransferRule: { signature: "setTransferRule(uint8 classId, TransferRule rule, address customRule)", about: "A class's transfer rule (the company Governor: `transfer-rule` vote)." },
    freeze: { signature: "freeze(uint8 classId)", about: "Freezes a class's terms for good (the company Governor: `freeze-class` vote)." },
    convertibleReserved: { signature: "convertibleReserved(uint8 classId) view returns (uint256)", about: "Shares of a class reserved for conversions, for an issue's headroom." },
    closedForExit: { signature: "closedForExit() view returns (bool)", about: "Whether the company was sold and the Captable closed." },
  },
  events: {
    ClassCreated: { signature: "ClassCreated(uint8 indexed classId, address indexed token, ClassParams params)", about: "A class exists." },
    Issued: { signature: "Issued(uint8 indexed classId, address indexed to, uint128 amount, bytes32 reason)", about: "Shares issued." },
    Converted: {
      signature: "Converted(address indexed shareholder, uint8 indexed fromClassId, uint8 indexed toClassId, uint128 amount, uint128 minted)",
      about: "Shares converted.",
    },
  },
  was: [`${V4}/interfaces/ICaptable.sol:77`, `${ADDR}:51`],
});

export const contract_share_class = defineContract({
  id: "share-class",
  title: "ShareClass: one class's shares and votes",
  about: "One ERC20Votes clone per class. The address is the implementation.",
  addresses: { [DEV]: "0x620703c74ea59fdAcc275363cdab122930bE4022" },
  functions: {
    delegate: { signature: "delegate(address delegatee)", about: "Delegates a shareholder's votes." },
    balanceOf: { signature: "balanceOf(address account) view returns (uint256)", about: "A shareholder's shares." },
  },
  events: {
    Transfer: { signature: "Transfer(address indexed from, address indexed to, uint256 value)", about: "Shares moved." },
    DelegateChanged: { signature: "DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate)", about: "Votes delegated." },
  },
  was: [`${V4}/interfaces/IShareClass.sol:25`, `${ADDR}:52`],
});

export const contract_vesting = defineContract({
  id: "vesting",
  title: "Vesting: share grants",
  about: "One shared contract: vesting grants offered, accepted, revoked and released.",
  addresses: { [DEV]: "0x5E032cc2B9757585B15cC029ACEC5AE46fF5Ec1a" },
  functions: {
    offerGrant: {
      signature:
        "offerGrant(address captable, uint8 classId, address shareholder, uint128 amount, uint64 start, uint64 cliff, uint64 end, uint64 offerExpiresAt, bool accelerateOnExit, bytes32 documentHash) returns (uint256 id)",
      about: "Offers a vesting grant.",
    },
    acceptGrant: { signature: "acceptGrant(uint256 id, bytes32 termsHash)", about: "Accepts it." },
    revoke: { signature: "revoke(uint256 id, uint64 effectiveAt)", about: "Revokes it." },
    grantAndIssue: {
      signature:
        "grantAndIssue(address captable, uint8 classId, address shareholder, uint128 amount, uint64 start, uint64 cliff, uint64 end, bool accelerateOnExit, bytes32 documentHash) returns (uint256 id)",
      about: "Issues a founder's shares under vesting at the equity install.",
    },
    settleRevocation: { signature: "settleRevocation(uint256 id)", about: "Returns the unvested shares of a revoked grant." },
    lockedOf: { signature: "lockedOf(address captable, uint8 classId, address account, uint64 t) view returns (uint128)", about: "A holder's unvested shares at a time, for `shares`." },
  },
  events: {
    GrantOffered: { signature: "GrantOffered(address indexed safe, uint256 indexed id, address indexed shareholder, Grant grant)", about: "Offered." },
    GrantAccepted: { signature: "GrantAccepted(address indexed safe, uint256 indexed id)", about: "Accepted." },
    Granted: {
      signature: "Granted(address indexed safe, uint256 indexed id, address indexed shareholder, Grant grant)",
      about: "A live grant made with its shares issued in the same call (a founder's vesting at the install).",
    },
    Revoked: { signature: "Revoked(address indexed safe, uint256 indexed id, uint64 effectiveAt)", about: "A grant revoked, effective at a time." },
  },
  was: [`${V4}/interfaces/IVesting.sol:30`, `${ADDR}:50`],
});

export const contract_options = defineContract({
  id: "options",
  title: "Options: option grants and exercises",
  about: "One clone per company: the option pool, grants, acceptance, exercise (the strike paid through Payments, kind 7) and ends. The address is the implementation.",
  addresses: { [DEV]: "0x48C9BF7b1993e1E4Dc0FEE06a402B2193428A0bA" },
  functions: {
    grant: {
      signature:
        "grant(address grantee, uint128 shares, address strikeToken, uint128 strikePrice, uint64 start, uint64 cliff, uint64 end, uint64 offerExpiresAt, uint64 expiresAt, uint32 exerciseWindowDays, bytes32 documentHash) returns (uint256 id)",
      about: "Grants options.",
    },
    accept: { signature: "accept(uint256 id, bytes32 termsHash)", about: "The grantee accepts." },
    exercise: { signature: "exercise(uint256 id, uint128 shares)", about: "The grantee exercises." },
    end: { signature: "end(uint256 id, uint64 endedAt)", about: "Ends a grant." },
    setPool: { signature: "setPool(uint128 amount)", about: "Sets the option pool (Board)." },
    pool: { signature: "pool() view returns (uint128)", about: "The option pool, for the cap table." },
    allocated: { signature: "allocated() view returns (uint128)", about: "The pool already granted." },
    vestedOf: { signature: "vestedOf(uint256 id, uint64 t) view returns (uint128)", about: "A grant's vested options at a time, for show, accept and exercise." },
  },
  events: {
    OptionsGranted: { signature: "OptionsGranted(uint256 indexed id, address indexed grantee, OptionGrant grant)", about: "Granted." },
    OptionsAccepted: { signature: "OptionsAccepted(uint256 indexed id, address indexed grantee)", about: "The grantee accepted the grant's terms." },
    Exercised: { signature: "Exercised(uint256 indexed id, uint128 shares, uint256 paid, bytes32 paymentId)", about: "Exercised." },
    OptionsEnded: { signature: "OptionsEnded(uint256 indexed id, uint64 endedAt, uint128 returned)", about: "Ended." },
  },
  was: [`${V4}/interfaces/IOptions.sol:35`, `${ADDR}:53`],
});

export const contract_rounds = defineContract({
  id: "rounds",
  title: "Rounds: priced rounds and SAFEs",
  about: "One clone per company: SAFE rounds and priced rounds, invitations, commitments, allocations, payments (kinds 5 and 6) and closes. The address is the implementation.",
  addresses: { [DEV]: "0xBADe818Cc6527e27Ad073cE7f82429ceC0605e02" },
  functions: {
    createSafeRound: {
      signature: "createSafeRound(address token, uint128 valuationCap, uint16 discountBps, uint64 closesAt, bytes32 documentHash) returns (uint256 roundId)",
      about: "A SAFE round.",
    },
    inviteSafe: { signature: "inviteSafe(uint256 roundId, address investor, uint128 maxAmount)", about: "Invites a SAFE investor." },
    signSafe: { signature: "signSafe(uint256 roundId, uint128 amount, bytes32 documentHash) returns (uint256 noteId)", about: "An investor signs and pays a SAFE." },
    closeSafeRound: { signature: "closeSafeRound(uint256 roundId)", about: "Closes a SAFE round." },
    createPricedRound: {
      signature: "createPricedRound(uint8 classId, address token, uint128 price, uint128 maxShares, uint64 payBy, bytes32 documentHash) returns (uint256 roundId)",
      about: "A priced round.",
    },
    invite: { signature: "invite(uint256 roundId, address investor, uint128 maxAmount)", about: "Invites an investor." },
    commit: { signature: "commit(uint256 roundId, uint128 amount, bytes32 documentHash)", about: "An investor commits." },
    allocate: { signature: "allocate(uint256 roundId, address investor, uint128 shares)", about: "Allocates shares." },
    pay: { signature: "pay(uint256 roundId) returns (bytes32 paymentId)", about: "An investor pays." },
    close: { signature: "close(uint256 roundId, uint256 deemedOutstandingA)", about: "Closes a priced round." },
    cancel: { signature: "cancel(uint256 roundId)", about: "Cancels a round." },
    convertSafes: { signature: "convertSafes(uint256[] noteIds, uint256 pricedRoundId, uint256 companyCapitalization)", about: "Converts SAFE notes into a priced round's shares (Board)." },
    safeRound: { signature: "safeRound(uint256 roundId) view returns (SafeRound)", about: "A SAFE round's terms and state." },
    safeNote: { signature: "safeNote(uint256 noteId) view returns (SafeNote)", about: "One investor's SAFE note." },
    pricedRound: { signature: "pricedRound(uint256 roundId) view returns (PricedRound)", about: "A priced round's terms and state." },
    position: { signature: "position(uint256 roundId, address investor) view returns (Position)", about: "One investor's invitation, commitment, allocation and payment." },
    consent: { signature: "consent(uint256 roundId)", about: "A class consents to a down round (its class Governor: `approve-round` vote)." },
  },
  events: {
    SafeRoundCreated: {
      signature: "SafeRoundCreated(uint256 indexed roundId, address token, uint128 valuationCap, uint16 discountBps, uint64 closesAt, bytes32 documentHash)",
      about: "A SAFE round exists.",
    },
    SafeInvited: { signature: "SafeInvited(uint256 indexed roundId, address indexed investor, uint128 maxAmount)", about: "A SAFE investor invited." },
    SafeSigned: {
      signature: "SafeSigned(uint256 indexed roundId, uint256 indexed noteId, address indexed investor, uint128 amount, bytes32 documentHash, bytes32 paymentId)",
      about: "An investor signed and paid a SAFE.",
    },
    PricedRoundCreated: {
      signature: "PricedRoundCreated(uint256 indexed roundId, uint8 indexed classId, address token, uint128 price, uint128 maxShares, uint64 payBy, bytes32 documentHash)",
      about: "A priced round exists.",
    },
    Invited: { signature: "Invited(uint256 indexed roundId, address indexed investor, uint128 maxAmount)", about: "An investor invited to a priced round." },
    Allocated: { signature: "Allocated(uint256 indexed roundId, address indexed investor, uint128 shares)", about: "Shares allocated to an investor." },
    Committed: { signature: "Committed(uint256 indexed roundId, address indexed investor, uint128 amount, bytes32 documentHash)", about: "A commitment." },
    Paid: { signature: "Paid(uint256 indexed roundId, address indexed investor, uint128 shares, uint256 amount, bytes32 paymentId)", about: "An investor paid." },
    RoundClosed: { signature: "RoundClosed(uint256 indexed roundId, Adjustment[] adjustments)", about: "Closed." },
    RoundCancelled: { signature: "RoundCancelled(uint256 indexed roundId)", about: "Cancelled." },
  },
  was: [`${V4}/interfaces/IRounds.sol:70`, `${ADDR}:54`],
});

export const contract_exits = defineContract({
  id: "exits",
  title: "Exits: sales and secondary transfers",
  about:
    "One clone per company: an approved sale's waterfall, its settlement and claims (kind 8), and secondary share " +
    "transfers (kind 5). A shareholder's unclaimed exit share waits in a general claim escrow whose terms its " +
    "`_terms` builds: owner the shareholder, sender Exits, no authority, bootstrapOwner read from the factory's " +
    "`bootstrapOwner()` (Companies House), condition owner-collects, `ownerTakesSurplus` true (payments.general-escrow; " +
    "the one line of Exits that changes, carried in packages/contracts). The address is the implementation.",
  addresses: { [DEV]: "0x3560eab3FC06C631f0309f6f1b0F2Ac3E54d22C6" },
  functions: {
    approveSale: { signature: "approveSale(uint256 saleId, address token, uint256 proceeds, bytes32 termsHash)", about: "The Board approves a sale." },
    preview: { signature: "preview(uint256 saleId, Holding[] holdings) view returns (Payout[])", about: "Who gets what." },
    settle: { signature: "settle(uint256 saleId, Holding[] holdings, uint256[] claimIndexes)", about: "Pays the sale out." },
    offerTransfer: {
      signature: "offerTransfer(uint8 classId, address buyer, uint128 shares, uint128 price, address token, bytes32 documentHash) returns (uint256 transferId)",
      about: "A shareholder offers shares to a buyer, beside the Captable's consent.",
    },
    approveTransfer: { signature: "approveTransfer(uint256 transferId)", about: "Approves a secondary transfer." },
    buy: { signature: "buy(uint256 transferId)", about: "A buyer pays for shares." },
    transfer: { signature: "transfer(uint256 transferId) view returns (Transfer)", about: "A secondary sale offer as Exits holds it." },
    sale: { signature: "sale(uint256 saleId) view returns (Sale)", about: "An approved sale: its token, proceeds and whether it settled." },
  },
  events: {
    SaleApproved: { signature: "SaleApproved(uint256 indexed saleId, address token, uint256 proceeds, bytes32 termsHash)", about: "The Board approved a sale." },
    Settled: { signature: "Settled(uint256 indexed saleId)", about: "A sale paid out." },
    TransferOffered: {
      signature:
        "TransferOffered(uint256 indexed transferId, address indexed seller, address indexed buyer, uint8 classId, uint128 shares, uint128 price, address token, bytes32 documentHash)",
      about: "A shareholder offered shares to a buyer.",
    },
    TransferApproved: { signature: "TransferApproved(uint256 indexed transferId)", about: "A secondary transfer approved." },
    Bought: { signature: "Bought(uint256 indexed transferId, uint256 amount, bytes32 paymentId)", about: "A secondary sale paid." },
  },
  was: [`${V4}/interfaces/IExits.sol:68`, `${ADDR}:55`],
});

export const contract_governor = defineContract({
  id: "governor",
  title: "Governor: shareholder votes",
  about: "One OpenZeppelin 5 Governor clone per company or class, timestamp clock, allowed targets only. The address is the implementation.",
  addresses: { [DEV]: "0x7aA1c8Df83D4F6d77DCe4799A15d9c177702c9eA" },
  functions: {
    propose: { signature: "propose(address[] targets, uint256[] values, bytes[] calldatas, string description) returns (uint256)", about: "Proposes a vote." },
    castVote: { signature: "castVote(uint256 proposalId, uint8 support) returns (uint256)", about: "Casts a vote." },
    castVoteWithReason: { signature: "castVoteWithReason(uint256 proposalId, uint8 support, string reason) returns (uint256)", about: "Casts a vote with a reason (`vote cast`)." },
    state: { signature: "state(uint256 proposalId) view returns (uint8)", about: "A vote's state: pending, active, defeated, succeeded, executed..." },
    proposalVotes: { signature: "proposalVotes(uint256 proposalId) view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)", about: "A vote's tally." },
    quorum: { signature: "quorum(uint256 timepoint) view returns (uint256)", about: "The votes a proposal needs." },
    getVotes: { signature: "getVotes(address account, uint256 timepoint) view returns (uint256)", about: "A shareholder's weighted votes at a time: the proposal threshold, a ballot's weight." },
    proposalThreshold: { signature: "proposalThreshold() view returns (uint256)", about: "The votes a proposer needs." },
    hasVoted: { signature: "hasVoted(uint256 proposalId, address account) view returns (bool)", about: "Whether a Safe already voted on a proposal." },
    isAllowedTarget: { signature: "isAllowedTarget(address target) view returns (bool)", about: "Whether a matter's call may go to a target: the Board's matters may not." },
    execute: {
      signature: "execute(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) payable returns (uint256)",
      about: "Executes a passed vote.",
    },
  },
  events: {
    ProposalCreated: {
      signature:
        "ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)",
      about: "A vote exists.",
    },
    VoteCast: { signature: "VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)", about: "A vote cast." },
    ProposalExecuted: { signature: "ProposalExecuted(uint256 proposalId)", about: "A vote executed." },
  },
  was: [`${V4}/equity/Governor.sol:111`, `${ADDR}:56`],
});

export const contract_hats_elections = defineContract({
  id: "hats-elections",
  title: "Hats Elections: a seat group's elected Directors",
  about:
    "Hats Election Eligibility v0.2.0, one clone per seat group's Director hat (from HatsModuleFactory, at the address the " +
    "equity install predicts), attached as that hat's eligibility by a shareholder vote (`org vote create board-settings`). " +
    "The company Governor records each term's winners and recalls; a Director is ineligible from the term's end until " +
    "the next term starts, with no event, so that hat is read live (indexing's hat-wearers). One clone each, so no " +
    "address is listed.",
  functions: {
    elect: { signature: "elect(uint128 termEnd, address[] winners)", about: "Records a term's winners (`elect` vote); at most the hat's seats." },
    recall: { signature: "recall(uint128 termEnd, address[] recallees)", about: "Removes winners from a term (`remove` vote)." },
    setNextTerm: { signature: "setNextTerm(uint128 newTermEnd)", about: "Opens the election for the next term (`board-settings` vote)." },
    startNextTerm: { signature: "startNextTerm()", about: "Makes the next term current once the current one has ended; anyone may send it." },
    currentTermEnd: { signature: "currentTermEnd() view returns (uint128)", about: "The current term's end: every wearer is ineligible from it until the next term starts." },
    nextTermEnd: { signature: "nextTermEnd() view returns (uint128)", about: "The next term's end, or 0 when none is open." },
  },
  events: {},
  was: [`${V4}/interfaces/external/IHatsElectionEligibility.sol:9`, `${V4}/authority/InstallerElections.sol:22`],
});
