// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20Errors } from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import { Vm } from "forge-std/Vm.sol";

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { IExits } from "../../../../../src/interfaces/IExits.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";
import { Exits_Test } from "../../../../utils/Exits/Exits_Test.sol";
import { MockERC20 } from "../../../../mocks/MockERC20.sol";

/// @dev spec/exits.md `buy`: delivery against payment for a secondary sale the seller offered and consented to
/// in the Captable (ruling D3, F7) and the Board approved. Ben sells 400 Common to the investor at $1.50.
contract Buy_Exits_Unit_Concrete_Test is Exits_Test {
    uint128 internal constant SHARES = 400;
    uint128 internal constant PRICE = 1.5e6;
    uint256 internal constant AMOUNT = 600e6;

    function _offer() internal returns (uint256 id) {
        vm.prank(users.ben);
        id = exits.offerTransfer(COMMON, users.investor, SHARES, PRICE, address(usdc), DOC);
    }

    function _consent() internal {
        vm.prank(users.ben);
        captable.consentToTransfer(COMMON, users.investor, SHARES, DOC);
    }

    function _approve(uint256 id) internal {
        vm.prank(address(safe));
        exits.approveTransfer(id);
    }

    /// @dev Offered, consented, approved, and the investor has approved Exits to take the price.
    function _ready() internal returns (uint256 id) {
        id = _offer();
        _consent();
        _approve(id);
        vm.prank(users.investor);
        usdc.approve(address(exits), AMOUNT);
    }

    function _assertNothingMoved(uint256 benUsdc, uint256 investorUsdc) internal view {
        assertEq(captable.tokenOf(COMMON).balanceOf(users.ben), 3000, "seller keeps the shares");
        assertEq(captable.tokenOf(COMMON).balanceOf(users.investor), 0, "buyer has no shares");
        assertEq(usdc.balanceOf(users.ben), benUsdc, "seller not paid");
        assertEq(usdc.balanceOf(users.investor), investorUsdc, "buyer not charged");
    }

    function test_WhenTheTransferDoesNotExist() external {
        // it should revert with UnknownTransfer
        vm.expectRevert(IExits.UnknownTransfer.selector);
        vm.prank(users.investor);
        exits.buy(1);
    }

    function test_WhenTheCallerIsNotTheBuyer() external {
        // it should revert with NotBuyer
        uint256 id = _ready();
        vm.expectRevert(IExits.NotBuyer.selector);
        vm.prank(users.eve);
        exits.buy(id);
        vm.expectRevert(IExits.NotBuyer.selector);
        vm.prank(users.ben);
        exits.buy(id);
    }

    function test_WhenTheBoardHasNotApprovedIt() external {
        // it should revert with NotApproved
        uint256 id = _offer();
        _consent();
        vm.prank(users.investor);
        usdc.approve(address(exits), AMOUNT);
        vm.expectRevert(IExits.NotApproved.selector);
        vm.prank(users.investor);
        exits.buy(id);
    }

    function test_WhenItWasAlreadyBought() external {
        // it should revert with AlreadyBought
        uint256 id = _ready();
        vm.prank(users.investor);
        exits.buy(id);
        _consent(); // even a fresh consent cannot buy the same offer twice
        vm.prank(users.investor);
        usdc.approve(address(exits), AMOUNT);
        vm.expectRevert(IExits.AlreadyBought.selector);
        vm.prank(users.investor);
        exits.buy(id);
    }

    function test_WhenTheSellerDidNotConsentToTheTransferInTheCaptable() external {
        // it should revert with ConsentMissing and move no money
        uint256 id = _offer();
        _approve(id);
        vm.prank(users.investor);
        usdc.approve(address(exits), AMOUNT);
        uint256 benUsdc = usdc.balanceOf(users.ben);
        uint256 investorUsdc = usdc.balanceOf(users.investor);

        vm.expectRevert(ICaptable.ConsentMissing.selector);
        vm.prank(users.investor);
        exits.buy(id);
        _assertNothingMoved(benUsdc, investorUsdc);
    }

    function test_WhenTheSellersSharesAreLocked() external {
        // it should revert with SharesLocked and move no money
        uint256 id = _ready();
        captable.setLocked(COMMON, users.ben, 2800); // only 200 unlocked
        uint256 benUsdc = usdc.balanceOf(users.ben);
        uint256 investorUsdc = usdc.balanceOf(users.investor);

        vm.expectRevert(abi.encodeWithSelector(ICaptable.SharesLocked.selector, users.ben, uint128(2800)));
        vm.prank(users.investor);
        exits.buy(id);
        _assertNothingMoved(benUsdc, investorUsdc);
    }

    modifier whenTheBuyerBuysAnApprovedAndConsentedSale() {
        _;
    }

    function test_WhenTheBuyerBuysAnApprovedAndConsentedSale() external whenTheBuyerBuysAnApprovedAndConsentedSale {
        // it should pay the seller the shares times the price through Payments with kind 5
        // it should move the shares to the buyer by a forced transfer with the document hash
        // it should use up the seller's consent
        // it should emit Bought
        uint256 id = _ready();
        uint256 benUsdc = usdc.balanceOf(users.ben);
        uint256 investorUsdc = usdc.balanceOf(users.investor);
        bytes32 consentId = keccak256(abi.encode(COMMON, users.ben, users.investor, SHARES, DOC));
        assertTrue(captable.transferConsent(consentId), "consent recorded");

        vm.expectCall(
            address(captable),
            abi.encodeCall(ICaptable.forcedTransfer, (COMMON, users.ben, users.investor, SHARES, DOC))
        );
        vm.recordLogs();
        vm.prank(users.investor);
        exits.buy(id);

        assertEq(usdc.balanceOf(users.ben), benUsdc + AMOUNT, "seller paid 400 x $1.50");
        assertEq(usdc.balanceOf(users.investor), investorUsdc - AMOUNT, "buyer paid exactly that");
        assertEq(usdc.balanceOf(address(exits)), 0, "Exits holds nothing (X3)");
        assertEq(captable.tokenOf(COMMON).balanceOf(users.investor), SHARES, "buyer received the shares");
        assertEq(captable.tokenOf(COMMON).balanceOf(users.ben), 3000 - SHARES, "seller delivered them");
        assertFalse(captable.transferConsent(consentId), "consent used up");
        assertTrue(exits.transfer(id).bought, "bought");

        Vm.Log memory bought = _lastLog(address(exits), IExits.Bought.selector);
        assertEq(uint256(bought.topics[1]), id, "Bought transfer id");
        (uint256 amount, bytes32 paymentId) = abi.decode(bought.data, (uint256, bytes32));
        assertEq(amount, AMOUNT, "Bought amount");
        assertTrue(payments.paid(paymentId), "Bought names the Payments id it consumed");

        // The money went through Payments as a kind-5 payment to the seller, stamped with the document.
        vm.recordLogs();
        vm.prank(users.ben);
        uint256 id2 = exits.offerTransfer(COMMON, users.investor, 1, PRICE, address(usdc), DOC);
        vm.prank(users.ben);
        captable.consentToTransfer(COMMON, users.investor, 1, DOC);
        _approve(id2);
        vm.prank(users.investor);
        usdc.approve(address(exits), PRICE);
        vm.recordLogs();
        vm.prank(users.investor);
        exits.buy(id2);
        Vm.Log memory sent = _lastLog(address(payments), IPayments.PaymentSent.selector);
        assertEq(address(uint160(uint256(sent.topics[3]))), users.ben, "paid to the seller");
        (address token, uint256 paidAmount, uint16 kind, bytes32 doc) =
            abi.decode(sent.data, (address, uint256, uint16, bytes32));
        assertEq(token, address(usdc), "in the offer's token");
        assertEq(paidAmount, PRICE, "shares x price");
        assertEq(kind, SHARE_PURCHASE_KIND, "kind 5, share purchase");
        assertEq(doc, DOC, "stamped with the sale agreement");
    }

    function test_WhenThePaymentFails() external whenTheBuyerBuysAnApprovedAndConsentedSale {
        // it should revert and move no shares
        uint256 id = _ready();
        vm.prank(users.investor);
        usdc.approve(address(exits), AMOUNT - 1); // one unit short
        uint256 benUsdc = usdc.balanceOf(users.ben);
        uint256 investorUsdc = usdc.balanceOf(users.investor);

        // The token refuses the pull for want of allowance (whoever pulls: Exits or Payments).
        vm.expectPartialRevert(IERC20Errors.ERC20InsufficientAllowance.selector);
        vm.prank(users.investor);
        exits.buy(id);
        _assertNothingMoved(benUsdc, investorUsdc);
        assertFalse(exits.transfer(id).bought, "not bought");
        bytes32 consentId = keccak256(abi.encode(COMMON, users.ben, users.investor, SHARES, DOC));
        assertTrue(captable.transferConsent(consentId), "consent kept");
    }

    function test_WhenTheIncomingTransferHasAFeeAndExitsHasDonations() external {
        // it should revert without spending the donated tokens or moving shares
        ExitIncomingFeeToken feeToken = new ExitIncomingFeeToken(address(exits));
        uint256 donation = AMOUNT / 100;
        feeToken.mint(address(exits), donation);
        feeToken.mint(users.investor, AMOUNT);
        vm.prank(users.ben);
        uint256 id = exits.offerTransfer(COMMON, users.investor, SHARES, PRICE, address(feeToken), DOC);
        _consent();
        _approve(id);
        vm.prank(users.investor);
        feeToken.approve(address(exits), AMOUNT);

        vm.expectPartialRevert(IPayments.InexactTransfer.selector);
        vm.prank(users.investor);
        exits.buy(id);

        assertEq(feeToken.balanceOf(address(exits)), donation, "donation unchanged");
        assertEq(feeToken.balanceOf(users.investor), AMOUNT, "buyer not charged");
        assertEq(captable.tokenOf(COMMON).balanceOf(users.ben), 3000, "seller keeps shares");
        assertFalse(exits.transfer(id).bought, "offer remains open");
    }

    function test_WhenTheOutgoingTransferChargesExitsAnExtraFee() external {
        // it should revert without spending the donated tokens or moving shares
        ExitOutgoingFeeToken feeToken = new ExitOutgoingFeeToken(address(exits));
        uint256 donation = AMOUNT / 100;
        feeToken.mint(address(exits), donation);
        feeToken.mint(users.investor, AMOUNT);
        vm.prank(users.ben);
        uint256 id = exits.offerTransfer(COMMON, users.investor, SHARES, PRICE, address(feeToken), DOC);
        _consent();
        _approve(id);
        vm.prank(users.investor);
        feeToken.approve(address(exits), AMOUNT);

        vm.expectPartialRevert(IPayments.InexactTransfer.selector);
        vm.prank(users.investor);
        exits.buy(id);

        assertEq(feeToken.balanceOf(address(exits)), donation, "donation unchanged");
        assertEq(feeToken.balanceOf(users.investor), AMOUNT, "buyer not charged");
        assertEq(captable.tokenOf(COMMON).balanceOf(users.ben), 3000, "seller keeps shares");
        assertFalse(exits.transfer(id).bought, "offer remains open");
    }

    function test_WhenAPurchaseTransferChangesExitsBalanceUnexpectedly() external {
        // it should revert without spending the donation or moving shares
        for (uint8 mode = 1; mode <= 2; ++mode) {
            uint256 snapshot = vm.snapshotState();
            ExitPurchaseRebasingToken token = new ExitPurchaseRebasingToken(address(exits), mode);
            token.mint(address(exits), 1);
            token.mint(users.investor, AMOUNT);
            vm.prank(users.ben);
            uint256 id = exits.offerTransfer(COMMON, users.investor, SHARES, PRICE, address(token), DOC);
            _consent();
            _approve(id);
            vm.prank(users.investor);
            token.approve(address(exits), AMOUNT);
            vm.expectPartialRevert(IPayments.InexactTransfer.selector);
            vm.prank(users.investor);
            exits.buy(id);
            assertEq(token.balanceOf(address(exits)), 1, "donation unchanged");
            assertEq(token.balanceOf(users.investor), AMOUNT, "buyer not charged");
            assertEq(captable.tokenOf(COMMON).balanceOf(users.ben), 3000, "seller keeps shares");
            assertFalse(exits.transfer(id).bought, "offer remains open");
            vm.revertToState(snapshot);
        }
    }
}

/// @dev Charges only transfers into Exits; the following Payments transfer is exact.
contract ExitIncomingFeeToken is MockERC20 {
    address private immutable _exits;

    constructor(address exits_) MockERC20("Incoming fee token", "IN", 6) {
        _exits = exits_;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to == _exits) {
            uint256 fee = value / 100;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

/// @dev Charges Exits an extra fee, while the seller receives the full payment.
contract ExitOutgoingFeeToken is MockERC20 {
    address private immutable _exits;

    constructor(address exits_) MockERC20("Outgoing fee token", "OUT", 6) {
        _exits = exits_;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == _exits && to != address(0)) super._update(from, address(0), value / 100);
        super._update(from, to, value);
    }
}

/// @dev Rebases Exits during the incoming or outgoing transfer of a purchase.
contract ExitPurchaseRebasingToken is MockERC20 {
    address private immutable _exits;
    uint8 private immutable _mode;

    constructor(address exits_, uint8 mode) MockERC20("Purchase Rebasing USD", "PRUSD", 6) {
        _exits = exits_;
        _mode = mode;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (_mode == 1 && from != address(0) && to == _exits) super._update(_exits, address(0), value + 1);
        if (_mode == 2 && from == _exits && to != address(0)) super._update(address(0), _exits, value + 1);
    }
}
