// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { CommonBase } from "forge-std/Base.sol";
import { StdUtils } from "forge-std/StdUtils.sol";

import { IEscrow } from "../../../src/interfaces/IEscrow.sol";
import { IEscrowFactory } from "../../../src/interfaces/IEscrowFactory.sol";
import { IPayments } from "../../../src/interfaces/IPayments.sol";

import { MockERC20 } from "../../mocks/MockERC20.sol";
import { PayeeSafeMock } from "../../utils/Escrow/PayeeSafeMock.sol";

/// @notice Drives a set of escrows of **both** conditions (invariants.md, handler table): deposit, donate,
/// payout, collect, refund, claim the payee (swap Companies House out), add a recovery owner, change the
/// payee's `isOwner` answer (S8), pay an invoice id straight through Payments, and deploy fresh escrows
/// through the factory (S3, S6). Every call is bounded and wrapped in `try`, so the handler never reverts
/// (`fail_on_revert = true`); what each call did is checked against the spec and recorded in ghosts.
///
/// Actors: the Board (`owner`, the company Safe, the payer), each payee Safe, Alice and Bob (the payees'
/// keys), and Eve (anyone: pays out, donates, pays directly, tries to collect and refund).
contract EscrowHandler is CommonBase, StdUtils {
    struct Ghost {
        uint256 totalIn; // every unit the escrow ever received
        uint256 toOwner; // units the escrow sent to the owner Safe
        uint256 toPayee; // units the escrow sent to the payee Safe
        uint256 settlements; // successful payouts and collects
    }

    IEscrowFactory public immutable factory;
    IPayments public immutable payments;
    MockERC20 public immutable token;
    address public immutable owner;
    address public immutable companiesHouse;
    address public immutable eve;
    address public immutable alice;
    address public immutable bob;

    IEscrow[] public escrows;
    PayeeSafeMock[] public payees;
    mapping(IEscrow escrow => Ghost) public ghost;

    // Violations, each false while the spec holds.
    bool public settledTwiceOrAfterClose; // S1
    bool public escrowLeftHoldingToken; // S2
    bool public predictionWrong; // S3
    bool public paymentIdPredictionWrong; // S6
    bool public paidBeforeConditionOrInexact; // S5
    bool public invoiceRefundedWhileHeld; // S7
    bool public openClaimRefundRefused; // S9
    bool public refundPaidSomeoneElse; // S1: refund sends only to the owner Safe
    bool public refundByNonOwner; // only the owner Safe refunds (NotOwner)
    bool public executorBypassed; // S6: a claim id is sent only by its escrow

    mapping(bytes4 => uint256) public calls;
    mapping(bytes4 => uint256) public successes;
    uint256 internal _nonce;

    constructor(
        IEscrowFactory factory_,
        IPayments payments_,
        MockERC20 token_,
        address owner_,
        address companiesHouse_,
        address eve_,
        address alice_,
        address bob_
    ) {
        factory = factory_;
        payments = payments_;
        token = token_;
        owner = owner_;
        companiesHouse = companiesHouse_;
        eve = eve_;
        alice = alice_;
        bob = bob_;
    }

    /// @dev Setup only: registers an escrow and its payee.
    function add(IEscrow escrow, PayeeSafeMock payee) external {
        escrows.push(escrow);
        payees.push(payee);
    }

    function escrowCount() external view returns (uint256) {
        return escrows.length;
    }

    // ------------------------------------------------------------------ money in

    function deposit(uint256 seed, uint256 amount) external {
        IEscrow escrow = _pick(seed);
        amount = bound(amount, 0, 2 * escrow.amount());
        token.mint(address(escrow), amount);
        ghost[escrow].totalIn += amount;
        calls[this.deposit.selector]++;
    }

    /// @dev Eve sends some of her own tokens, at any time, including after the escrow settled.
    function donate(uint256 seed, uint256 amount) external {
        IEscrow escrow = _pick(seed);
        // At most twice the amount, so Eve keeps enough to pay ids directly.
        uint256 most = 2 * escrow.amount();
        uint256 held = token.balanceOf(eve);
        amount = bound(amount, 0, held < most ? held : most);
        vm.prank(eve);
        token.transfer(address(escrow), amount);
        ghost[escrow].totalIn += amount;
        calls[this.donate.selector]++;
    }

    // ------------------------------------------------------------------ money out

    function payout(uint256 seed) external {
        IEscrow escrow = _pick(seed);
        _settle(escrow, eve, false);
        calls[this.payout.selector]++;
    }

    /// @dev The payee Safe collects; with `asEve`, Eve tries instead.
    function collect(uint256 seed, bool asEve) external {
        IEscrow escrow = _pick(seed);
        _settle(escrow, asEve ? eve : escrow.payeeSafe(), true);
        calls[this.collect.selector]++;
    }

    /// @dev The Board refunds one time in four (a refund closes the escrow, so this leaves room for
    /// payouts and collects); Eve tries the other times.
    function refund(uint256 seed, uint8 who) external {
        IEscrow escrow = _pick(seed);
        bool asEve = who % 4 != 0;
        bool open = escrow.state() == IEscrow.State.Open;
        uint256 held = token.balanceOf(address(escrow));
        bool invoice = escrow.condition() == 0;
        (uint256 ownerBefore, uint256 payeeBefore) = _balances(escrow);
        vm.prank(asEve ? eve : owner);
        try escrow.refund() {
            successes[this.refund.selector]++;
            if (asEve) refundByNonOwner = true;
            if (open && invoice && held >= escrow.amount()) invoiceRefundedWhileHeld = true;
            if (token.balanceOf(address(escrow)) != 0) escrowLeftHoldingToken = true;
            (, uint256 payeeAfter) = _balances(escrow);
            if (payeeAfter != payeeBefore) refundPaidSomeoneElse = true;
            _account(escrow, ownerBefore, payeeBefore);
        } catch {
            if (!asEve && open && !invoice) openClaimRefundRefused = true;
        }
        calls[this.refund.selector]++;
    }

    // ------------------------------------------------------------------ the payee's Safe

    /// @dev Companies House hands the Safe to Alice (the claimer swaps itself out).
    function claim(uint256 seed) external {
        PayeeSafeMock payee = payees[seed % payees.length];
        payee.swapOwner(companiesHouse, alice);
        calls[this.claim.selector]++;
    }

    /// @dev The payee adds Bob as a recovery key (D11: the owner count does not matter).
    function addOwner(uint256 seed) external {
        PayeeSafeMock payee = payees[seed % payees.length];
        if (payee.getOwners().length < 4) payee.addOwner(bob);
        calls[this.addOwner.selector]++;
    }

    /// @dev S8: the payee answers `isOwner` honestly, or reverts, or with 31 or 64 bytes, or any word.
    function setAnswer(uint256 seed, uint8 answer, uint256 word) external {
        PayeeSafeMock payee = payees[seed % payees.length];
        // Half the calls restore the honest answer, so claimed payees can still collect.
        answer %= 10;
        if (answer > uint8(type(PayeeSafeMock.Answer).max)) answer = uint8(PayeeSafeMock.Answer.Owners);
        if (answer == uint8(PayeeSafeMock.Answer.Word) && word % 2 == 0) word = word % 3; // 0, 1 or 2 often
        payee.setAnswer(PayeeSafeMock.Answer(answer), word);
        calls[this.setAnswer.selector]++;
    }

    // ------------------------------------------------------------------ others

    /// @dev Eve pays the escrow's payment straight through Payments (R2 ES11): the payee is paid by Eve,
    /// not by the escrow, so the escrow's ghosts do not move. A claim id refuses her (executor binding).
    function payDirectly(uint256 seed) external {
        IEscrow escrow = _pick(seed);
        IPayments.PaymentItem memory item = IPayments.PaymentItem({
            paymentId: escrow.paymentId(),
            recipient: escrow.payeeSafe(),
            token: address(token),
            amount: escrow.amount(),
            kind: escrow.kind(),
            documentHash: escrow.documentHash(),
            jobNonce: escrow.jobNonce(),
            executor: escrow.condition() == 1 ? address(escrow) : address(0)
        });
        if (token.balanceOf(eve) < item.amount) return;
        vm.startPrank(eve);
        token.approve(address(payments), item.amount);
        try payments.send(item) {
            if (escrow.condition() == 1) executorBypassed = true; // only the escrow may send a claim id
        } catch { }
        token.approve(address(payments), 0);
        vm.stopPrank();
        calls[this.payDirectly.selector]++;
    }

    /// @dev S3 and S6 for fresh terms: the factory's predictions match what it deploys, twice.
    function deployFresh(uint256 amount, bool claim_, bytes32 salt) external {
        IEscrow.Terms memory terms = IEscrow.Terms({
            ownerSafe: owner,
            payeeSafe: address(payees[0]),
            token: address(token),
            amount: bound(amount, 1, 1e30),
            jobNonce: bytes32(++_nonce),
            kind: 1,
            documentHash: keccak256("handler"),
            condition: claim_ ? 1 : 0
        });
        address predicted = factory.predictAddress(terms, salt);
        bytes32 predictedId = factory.predictPaymentId(terms, salt);
        address deployed = factory.deploy(terms, salt);
        if (deployed != predicted || factory.deploy(terms, salt) != deployed) predictionWrong = true;
        if (IEscrow(deployed).paymentId() != predictedId) paymentIdPredictionWrong = true;
        calls[this.deployFresh.selector]++;
    }

    /// @dev S8's model of the claim condition, from the payee's answer and owners.
    function modelClaimed(PayeeSafeMock payee) public view returns (bool) {
        PayeeSafeMock.Answer answer = payee.answer();
        if (answer == PayeeSafeMock.Answer.Word) return payee.word() == 0;
        if (answer != PayeeSafeMock.Answer.Owners) return false;
        address[] memory owners = payee.getOwners();
        for (uint256 i; i < owners.length; ++i) {
            if (owners[i] == companiesHouse) return false;
        }
        return true;
    }

    // ------------------------------------------------------------------ internals

    function _settle(IEscrow escrow, address caller, bool isCollect) internal {
        bool open = escrow.state() == IEscrow.State.Open;
        uint256 amount = escrow.amount();
        // The spec's condition, not the escrow's own `conditionMet`, so a wrong `conditionMet` cannot hide.
        bool met = escrow.condition() == 0
            ? token.balanceOf(address(escrow)) >= amount
            : modelClaimed(PayeeSafeMock(escrow.payeeSafe()));
        bool alreadyPaid = payments.paid(escrow.paymentId());
        (uint256 ownerBefore, uint256 payeeBefore) = _balances(escrow);
        bool ok;
        vm.prank(caller);
        if (isCollect) {
            try escrow.collect() {
                ok = true;
            } catch { }
        } else {
            try escrow.payout() {
                ok = true;
            } catch { }
        }
        if (!ok) return;
        successes[isCollect ? this.collect.selector : this.payout.selector]++;
        if (!open) settledTwiceOrAfterClose = true;
        if (token.balanceOf(address(escrow)) != 0) escrowLeftHoldingToken = true;
        (, uint256 payeeAfter) = _balances(escrow);
        if (alreadyPaid) {
            // An invoice paid elsewhere completes without paying the payee again (R2 ES11).
            if (isCollect || payeeAfter != payeeBefore) paidBeforeConditionOrInexact = true;
        } else {
            ghost[escrow].settlements++;
            if (!met || payeeAfter - payeeBefore != amount) paidBeforeConditionOrInexact = true;
        }
        _account(escrow, ownerBefore, payeeBefore);
    }

    function _balances(IEscrow escrow) internal view returns (uint256, uint256) {
        return (token.balanceOf(owner), token.balanceOf(escrow.payeeSafe()));
    }

    function _account(IEscrow escrow, uint256 ownerBefore, uint256 payeeBefore) internal {
        (uint256 ownerAfter, uint256 payeeAfter) = _balances(escrow);
        ghost[escrow].toOwner += ownerAfter - ownerBefore;
        ghost[escrow].toPayee += payeeAfter - payeeBefore;
    }

    function _pick(uint256 seed) internal view returns (IEscrow) {
        return escrows[seed % escrows.length];
    }
}
