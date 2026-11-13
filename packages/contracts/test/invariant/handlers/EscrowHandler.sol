// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../src/interfaces/IEscrow.sol";
import { IEscrowFactory } from "../../../src/interfaces/IEscrowFactory.sol";
import { IPayments } from "../../../src/interfaces/IPayments.sol";

import { MockERC20 } from "../../mocks/MockERC20.sol";
import { AuthorityMock } from "../../utils/Escrow/AuthorityMock.sol";
import { OwnerSafeMock } from "../../utils/Escrow/OwnerSafeMock.sol";
import { EscrowHandlerBase } from "./EscrowHandlerBase.sol";

/// @notice Drives a growing set of general escrows (docs/design/escrow.md, G1 to G11): invoices (amount-reached),
/// a mailbox's claim escrows (owner-collects, Companies House as bootstrap owner), a department's (authority the
/// budgets stand-in and a budget id), an exit claim (`ownerTakesSurplus`) and owners with no bootstrap owner.
/// Actions: deposit, donate, payout, collect (by the owner or Eve), refund (by the sender, the budget's current
/// wearer, its former wearer, the owner or Eve), claim the owner's Safe, add a recovery owner, change the owner's
/// `isOwner` answer, move the budget's hat, change the authority's answer, pay an invoice id straight through
/// Payments, and deploy fresh escrows through the factory with random terms. Every call is bounded and wrapped in
/// `try`, so the handler never reverts (`fail_on_revert = true`); what each call did is checked against a model of
/// the spec, never against the escrow's own views, and every breach is recorded.
///
/// Actors: the company Safe (`sender`), each owner Safe, Jordan and Ben (who wear the budget's hat in turn), Alice
/// and Bob (the owners' keys) and Eve (anyone).
contract EscrowHandler is EscrowHandlerBase {
    constructor(
        IEscrowFactory factory_,
        IPayments payments_,
        MockERC20 token_,
        AuthorityMock authority_,
        address sender_,
        address companiesHouse_,
        Actors memory a
    )
        EscrowHandlerBase(factory_, payments_, token_, authority_, sender_, companiesHouse_, a)
    { }

    // ------------------------------------------------------------------ money in

    function deposit(uint256 seed, uint256 amount) external {
        IEscrow escrow = _pick(seed);
        amount = bound(amount, 0, 2 * escrow.amount());
        token.mint(address(escrow), amount);
        ghost[escrow].totalIn += amount;
        calls[this.deposit.selector]++;
    }

    /// @dev Eve sends some of her own tokens, at any time, including after the escrow closed.
    function donate(uint256 seed, uint256 amount) external {
        IEscrow escrow = _pick(seed);
        uint256 most = 2 * escrow.amount();
        uint256 held = token.balanceOf(eve);
        amount = bound(amount, 0, held < most ? held : most);
        vm.prank(eve);
        token.transfer(address(escrow), amount);
        ghost[escrow].totalIn += amount;
        calls[this.donate.selector]++;
    }

    // ------------------------------------------------------------------ money out

    function payout(uint256 seed, uint8 who) external {
        IEscrow escrow = _pick(seed);
        _settle(escrow, _actor(escrow, who), false);
        calls[this.payout.selector]++;
    }

    /// @dev The owner collects three times in four; otherwise someone else tries.
    function collect(uint256 seed, uint8 who) external {
        IEscrow escrow = _pick(seed);
        _settle(escrow, who % 4 != 0 ? escrow.owner() : _actor(escrow, who / 4), true);
        calls[this.collect.selector]++;
    }

    /// @dev Anyone tries: the sender, the current or former wearer, the owner or Eve.
    function refund(uint256 seed, uint8 who) external {
        IEscrow escrow = _pick(seed);
        address caller = _actor(escrow, who);
        IEscrow.State prior = escrow.state();
        bool open = prior == IEscrow.State.Open;
        uint256 held = token.balanceOf(address(escrow));
        bool invoice = escrow.condition() == 0;
        bool admitted = modelAdmitted(escrow, caller);
        if (escrow.canRefund(caller) != admitted) canRefundDisagrees = true;
        Snap memory before = _snap(escrow);
        vm.prank(caller);
        try escrow.refund() {
            successes[this.refund.selector]++;
            if (!admitted) refundByUnadmitted = true;
            if (open && invoice && held >= escrow.amount()) invoiceRefundedWhileHeld = true;
            if (open) {
                if (escrow.state() != IEscrow.State.Refunded) reopenedOrClosedTwice = true;
                ghost[escrow].closings++;
            } else if (escrow.state() != prior) {
                reopenedOrClosedTwice = true; // G7: a sweep after the end keeps the end it had
            }
            Snap memory after_ = _snap(escrow);
            if (after_.owner != before.owner || after_.sender - before.sender != held) refundPaidTheWrongSide = true;
            _account(escrow, before, after_);
        } catch {
            // Refused only where the spec refuses: not admitted, or an invoice that holds its amount.
            if (admitted && !(open && invoice && held >= escrow.amount())) admittedRefundRefused = true;
        }
        calls[this.refund.selector]++;
    }

    // ------------------------------------------------------------------ the owner's Safe

    /// @dev Companies House hands the Safe to Alice (the claimer swaps itself out).
    function claim(uint256 seed) external {
        owners[seed % owners.length].swapOwner(companiesHouse, alice);
        calls[this.claim.selector]++;
    }

    /// @dev The owner adds Bob as a recovery key (D11: the owner count does not matter).
    function addOwner(uint256 seed) external {
        OwnerSafeMock o = owners[seed % owners.length];
        if (o.getOwners().length < 4) o.addOwner(bob);
        calls[this.addOwner.selector]++;
    }

    /// @dev G5: the owner answers `isOwner` honestly, or reverts, or with 31 or 64 bytes, or any word.
    function setAnswer(uint256 seed, uint8 answer, uint256 word) external {
        OwnerSafeMock o = owners[seed % owners.length];
        answer %= 10; // half the calls restore the honest answer, so claimed owners can still collect
        if (answer > uint8(type(OwnerSafeMock.Answer).max)) answer = uint8(OwnerSafeMock.Answer.Owners);
        if (answer == uint8(OwnerSafeMock.Answer.Word) && word % 2 == 0) word = word % 3; // 0, 1 or 2 often
        o.setAnswer(OwnerSafeMock.Answer(answer), word);
        calls[this.setAnswer.selector]++;
    }

    // ------------------------------------------------------------------ the department (G9)

    /// @dev The budget's hat moves from its wearer to the other: the old one is out at once, the new one in.
    function moveHat() external {
        authority.remove(BUDGET_ID, wearer);
        authority.admit(BUDGET_ID, formerWearer);
        (wearer, formerWearer) = (formerWearer, wearer);
        calls[this.moveHat.selector]++;
    }

    /// @dev The authority answers honestly, or reverts, or with 31 or 64 bytes, or any word.
    function setAuthorityAnswer(uint8 answer, uint256 word) external {
        answer %= 10;
        if (answer > uint8(type(AuthorityMock.Answer).max)) answer = uint8(AuthorityMock.Answer.Honest);
        if (answer == uint8(AuthorityMock.Answer.Word) && word % 2 == 0) word = word % 3;
        authority.setAnswer(AuthorityMock.Answer(answer), word);
        calls[this.setAuthorityAnswer.selector]++;
    }

    // ------------------------------------------------------------------ others

    /// @dev Eve pays the escrow's payment straight through Payments: the owner is paid by Eve, not by the
    /// escrow, so the escrow's ghosts do not move. An owner-collects id refuses her (executor binding).
    function payDirectly(uint256 seed) external {
        IEscrow escrow = _pick(seed);
        IPayments.PaymentItem memory item = IPayments.PaymentItem({
            paymentId: escrow.paymentId(),
            recipient: escrow.owner(),
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
            if (escrow.condition() == 1) executorBypassed = true;
        } catch { }
        token.approve(address(payments), 0);
        vm.stopPrank();
        calls[this.payDirectly.selector]++;
    }

    /// @dev G1 and G2 for fresh random terms: money sent to the predicted address first is there after the
    /// deploy, nothing moved, the factory's predictions hold, a second deploy returns the same escrow. The new
    /// escrow joins the set while there is room.
    function deployFresh(uint256 amount, uint8 shape, bytes32 salt, uint256 early) external {
        OwnerSafeMock o = new OwnerSafeMock(_one(shape % 2 == 0 ? companiesHouse : alice));
        IEscrow.Terms memory terms = IEscrow.Terms({
            owner: address(o),
            sender: sender,
            authority: (shape >> 1) % 2 == 0 ? address(0) : address(authority),
            authorityKey: (shape >> 1) % 2 == 0 ? 0 : BUDGET_ID,
            bootstrapOwner: (shape >> 2) % 3 == 0 ? address(0) : companiesHouse,
            token: address(token),
            amount: bound(amount, 1, 1e30),
            jobNonce: bytes32(++_nonce),
            kind: 1,
            documentHash: keccak256("handler"),
            condition: (shape >> 4) % 2 == 0 ? 1 : 0,
            ownerTakesSurplus: (shape >> 5) % 2 == 1
        });
        address predicted = factory.predictAddress(terms, salt);
        bytes32 predictedId = factory.predictPaymentId(terms, salt);
        early = bound(early, 0, 2 * terms.amount);
        token.mint(predicted, early);
        uint256 senderBefore = token.balanceOf(sender);
        address deployed = factory.deploy(terms, salt);
        if (deployed != predicted || factory.deploy(terms, salt) != deployed) predictionWrong = true;
        if (IEscrow(deployed).paymentId() != predictedId) paymentIdPredictionWrong = true;
        if (token.balanceOf(deployed) != early || token.balanceOf(sender) != senderBefore) {
            earlyMoneyLostOrMoved = true;
        }
        if (escrows.length < MAX_ESCROWS) {
            escrows.push(IEscrow(deployed));
            owners.push(o);
            ghost[IEscrow(deployed)].totalIn = early;
        }
        calls[this.deployFresh.selector]++;
    }

    // ------------------------------------------------------------------ internals

    /// @dev What the model knew before a payout or collect.
    struct Pre {
        bool open;
        bool met;
        bool alreadyPaid;
        uint256 amount;
        uint256 held;
    }

    function _settle(IEscrow escrow, address caller, bool isCollect) internal {
        Pre memory pre;
        pre.open = escrow.state() == IEscrow.State.Open;
        pre.amount = escrow.amount();
        pre.held = token.balanceOf(address(escrow));
        bool ownerCollects = escrow.condition() == 1;
        pre.met = ownerCollects ? modelCanAct(escrow, owners[_indexOf(escrow)]) : pre.held >= pre.amount;
        pre.alreadyPaid = payments.paid(escrow.paymentId());
        Snap memory before = _snap(escrow);
        if (!_call(escrow, caller, isCollect)) {
            if (isCollect && ownerCollects && caller == escrow.owner() && pre.open && pre.met && pre.held >= pre.amount)
            {
                ownerCollectRefused = true;
            }
            return;
        }
        successes[isCollect ? this.collect.selector : this.payout.selector]++;
        if (!pre.open) settledAfterClose = true;
        if (escrow.state() != IEscrow.State.Paid) reopenedOrClosedTwice = true;
        ghost[escrow].closings++;
        if (isCollect && caller != escrow.owner()) collectByNonOwner = true;
        Snap memory after_ = _snap(escrow);
        _checkPaid(escrow, isCollect, pre, after_.owner - before.owner, after_.sender - before.sender);
        _account(escrow, before, after_);
    }

    function _call(IEscrow escrow, address caller, bool isCollect) internal returns (bool ok) {
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
    }

    /// @dev G5, G11 and the surplus routing for one successful payout or collect.
    function _checkPaid(IEscrow escrow, bool isCollect, Pre memory pre, uint256 ownerGot, uint256 senderGot) internal {
        if (pre.alreadyPaid) {
            // An invoice paid elsewhere closes without paying the owner again; its balance goes to the sender.
            if (isCollect || ownerGot != 0 || senderGot != pre.held) paidWithoutConditionOrInexact = true;
            return;
        }
        ghost[escrow].settlements++;
        if (!pre.met || pre.held < pre.amount) paidWithoutConditionOrInexact = true;
        bool surplusToOwner = isCollect && escrow.ownerTakesSurplus();
        uint256 surplus = pre.held >= pre.amount ? pre.held - pre.amount : 0;
        if (ownerGot != (surplusToOwner ? pre.held : pre.amount)) paidWithoutConditionOrInexact = true;
        if (senderGot != (surplusToOwner ? 0 : surplus)) surplusMisrouted = true;
    }
}
