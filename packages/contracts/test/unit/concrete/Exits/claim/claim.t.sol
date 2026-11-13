// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";
import { IExits } from "../../../../../src/interfaces/IExits.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";
import { Exits_Test } from "../../../../utils/Exits/Exits_Test.sol";
import { MockBlacklistToken, MockExitSenderFeeToken } from "../../../../utils/Exits/ExitsMocks.sol";
import { MockFeeOnTransferToken } from "../../../../mocks/MockFeeOnTransferToken.sol";
import { MockERC20 } from "../../../../mocks/MockERC20.sol";

/// @dev spec/exits.md `claim` (the claim's payee; ruling F5: the money waits in a claim escrow, never in Exits);
/// invariants X3 and X4. The investor's $4,000 (payout 2) is the claim.
contract Claim_Exits_Unit_Concrete_Test is Exits_Test {
    uint256 internal constant AMOUNT = 4000e6;

    function test_WhenTheTokenReducesTheClaimEscrowBalance() external {
        // it should reject the short claim and keep it open
        MockERC20 token = new MockERC20("Reducible USD", "RUSD", 6);
        token.mint(address(safe), PROCEEDS);
        address escrow = _settleWithInvestorClaim(address(token));
        token.burn(escrow, 1);
        vm.expectRevert(abi.encodeWithSelector(IPayments.InexactTransfer.selector, address(token), AMOUNT, AMOUNT - 1));
        vm.prank(users.investor);
        exits.claim(SALE, 2, users.bob);
        assertEq(exits.claimOf(SALE, 2).escrow, escrow, "claim remains recorded");
        assertEq(uint256(IEscrow(escrow).state()), uint256(IEscrow.State.Open), "escrow remains open");
        assertEq(token.balanceOf(escrow), AMOUNT - 1, "remaining claim funds kept");
    }

    function test_WhenTheOutgoingTransferShortsTheRecipient() external {
        // it should revert and keep the claim fully funded
        ExitRecipientFeeToken token = new ExitRecipientFeeToken(address(exits));
        token.mint(address(safe), PROCEEDS);
        address escrow = _settleWithInvestorClaim(address(token));
        vm.expectPartialRevert(IPayments.InexactTransfer.selector);
        vm.prank(users.investor);
        exits.claim(SALE, 2, users.bob);
        assertEq(token.balanceOf(escrow), AMOUNT, "claim remains funded");
        assertEq(uint256(IEscrow(escrow).state()), uint256(IEscrow.State.Open), "escrow remains open");
        assertEq(token.balanceOf(users.bob), 0, "recipient not paid");
    }

    function test_WhenDirectCollectionChangesBalancesUnexpectedly() external {
        // it should revert and preserve the claim and surplus
        for (uint8 mode = 1; mode <= 4; ++mode) {
            uint256 snapshot = vm.snapshotState();
            ExitRebasingToken token = new ExitRebasingToken();
            token.mint(address(safe), PROCEEDS);
            address escrow = _settleWithInvestorClaim(address(token));
            token.mint(escrow, 7);
            token.arm(escrow, users.investor, AMOUNT, mode);
            _markClaimed(users.investor);
            vm.expectPartialRevert(IPayments.InexactTransfer.selector);
            vm.prank(users.investor);
            IEscrow(escrow).collect();
            assertEq(token.balanceOf(escrow), AMOUNT + 7, "claim and surplus remain funded");
            assertEq(token.balanceOf(users.investor), 0, "shareholder not paid");
            assertEq(uint256(IEscrow(escrow).state()), uint256(IEscrow.State.Open), "escrow remains open");
            vm.revertToState(snapshot);
        }
    }

    function test_WhenClaimTransfersChangeBalancesUnexpectedly() external {
        // it should revert and preserve the claim and unrelated balances
        for (uint8 mode = 1; mode <= 3; ++mode) {
            uint256 snapshot = vm.snapshotState();
            ExitClaimRebasingToken token = new ExitClaimRebasingToken();
            token.mint(address(safe), PROCEEDS);
            address escrow = _settleWithInvestorClaim(address(token));
            token.mint(address(exits), 1);
            token.mint(users.bob, 1);
            token.arm(escrow, address(exits), users.bob, mode);
            vm.expectPartialRevert(IPayments.InexactTransfer.selector);
            vm.prank(users.investor);
            exits.claim(SALE, 2, users.bob);
            assertEq(token.balanceOf(escrow), AMOUNT, "claim remains funded");
            assertEq(token.balanceOf(address(exits)), 1, "donation unchanged");
            assertEq(token.balanceOf(users.bob), 1, "recipient balance unchanged");
            assertEq(uint256(IEscrow(escrow).state()), uint256(IEscrow.State.Open), "escrow remains open");
            vm.revertToState(snapshot);
        }
    }

    function test_WhenDirectCollectionChargesEscrowAnExtraSenderFee() external {
        // it should revert and preserve the claim and its surplus
        ExitEscrowSenderFeeToken token = new ExitEscrowSenderFeeToken();
        token.mint(address(safe), PROCEEDS);
        address escrow = _settleWithInvestorClaim(address(token));
        token.mint(escrow, AMOUNT / 100);
        token.setFeeSender(escrow);
        _markClaimed(users.investor);

        vm.expectPartialRevert(IPayments.InexactTransfer.selector);
        vm.prank(users.investor);
        IEscrow(escrow).collect();

        assertEq(token.balanceOf(escrow), AMOUNT + AMOUNT / 100, "claim and surplus remain funded");
        assertEq(uint256(IEscrow(escrow).state()), uint256(IEscrow.State.Open), "escrow remains open");
        assertEq(token.balanceOf(users.investor), 0, "shareholder not paid");
    }

    function test_WhenTheOutgoingTransferChargesExitsAnExtraFee() external {
        // it should revert and preserve the claim and unrelated donation
        MockExitSenderFeeToken token = new MockExitSenderFeeToken(address(exits));
        token.mint(address(safe), PROCEEDS);
        address escrow = _settleWithInvestorClaim(address(token));
        token.mint(address(exits), AMOUNT / 100);

        vm.expectPartialRevert(IPayments.InexactTransfer.selector);
        vm.prank(users.investor);
        exits.claim(SALE, 2, users.bob);

        assertEq(exits.claimOf(SALE, 2).escrow, escrow, "claim kept");
        assertEq(token.balanceOf(escrow), AMOUNT, "claim remains funded");
        assertEq(uint256(IEscrow(escrow).state()), uint256(IEscrow.State.Open), "escrow remains open");
        assertEq(token.balanceOf(address(exits)), AMOUNT / 100, "donation unchanged");
        assertEq(token.balanceOf(users.bob), 0, "recipient not paid");
    }

    function test_WhenThereIsNoClaimAtTheIndex() external {
        // it should revert with NoClaim
        _settleWithInvestorClaim(address(usdc));
        vm.expectRevert(abi.encodeWithSelector(IExits.NoClaim.selector, SALE, 1));
        vm.prank(users.ben); // Ben was paid directly: payout 1 has no claim
        exits.claim(SALE, 1, users.ben);
        vm.expectRevert(abi.encodeWithSelector(IExits.NoClaim.selector, SALE + 1, 2));
        vm.prank(users.investor);
        exits.claim(SALE + 1, 2, users.investor);
    }

    function test_WhenTheCallerIsNotTheClaimsPayee() external {
        // it should revert with NotPayee
        address escrow = _settleWithInvestorClaim(address(usdc));
        address[3] memory callers = [users.eve, address(safe), governor];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(IExits.NotPayee.selector);
            vm.prank(callers[i]);
            exits.claim(SALE, 2, callers[i]);
        }
        assertEq(usdc.balanceOf(escrow), AMOUNT, "still in the escrow");
    }

    function test_WhenTheAddressToSendToIsZero() external {
        // it should revert with ZeroAddress
        _settleWithInvestorClaim(address(usdc));
        vm.expectRevert(IExits.ZeroAddress.selector);
        vm.prank(users.investor);
        exits.claim(SALE, 2, address(0));
    }

    function test_WhenTheAddressToSendToIsExitsItselfOrTheClaimEscrow() external {
        // it should revert with ZeroAddress
        // it should leave the claim recorded and its escrow open and fully funded
        address escrow = _settleWithInvestorClaim(address(usdc));
        address[2] memory sinks = [address(exits), escrow];
        for (uint256 k; k < 2; ++k) {
            vm.expectRevert(IExits.ZeroAddress.selector);
            vm.prank(users.investor);
            exits.claim(SALE, 2, sinks[k]);
            IExits.Claim memory c = exits.claimOf(SALE, 2);
            assertEq(c.payee, users.investor, "claim kept");
            assertEq(c.escrow, escrow, "same escrow");
            assertEq(c.amount, AMOUNT, "same amount");
            assertEq(uint8(IEscrow(escrow).state()), uint8(IEscrow.State.Open), "escrow still open");
            assertEq(usdc.balanceOf(escrow), AMOUNT, "escrow fully funded");
            assertEq(usdc.balanceOf(address(exits)), 0, "Exits holds nothing (X3)");
        }
        vm.prank(users.investor);
        exits.claim(SALE, 2, users.investor); // still claimable
        assertEq(usdc.balanceOf(escrow), 0, "then claimed in full");
    }

    function test_WhenThePayeeAlreadyCollectedFromTheClaimEscrow() external {
        // it should revert with NoClaim
        address escrow = _settleWithInvestorClaim(address(usdc));
        _markClaimed(users.investor); // their Safe was claimed from Companies House
        uint256 before = usdc.balanceOf(users.investor);
        vm.prank(users.investor);
        IEscrow(escrow).collect();
        assertEq(usdc.balanceOf(users.investor), before + AMOUNT, "collected directly");

        vm.expectRevert(abi.encodeWithSelector(IExits.NoClaim.selector, SALE, 2));
        vm.prank(users.investor);
        exits.claim(SALE, 2, users.investor);
        assertEq(usdc.balanceOf(users.investor), before + AMOUNT, "paid once (X4)");
    }

    function test_WhenThePayeeCollectsAnExitEscrowWithDonations() external {
        // it should send the claim and surplus to the shareholder
        address escrow = _settleWithInvestorClaim(address(usdc));
        usdc.mint(escrow, 7);
        usdc.mint(address(exits), 11);
        _markClaimed(users.investor);
        uint256 before = usdc.balanceOf(users.investor);

        vm.prank(users.investor);
        IEscrow(escrow).collect();

        assertEq(usdc.balanceOf(users.investor), before + AMOUNT + 7, "claim and surplus to shareholder");
        assertEq(usdc.balanceOf(escrow), 0, "claim escrow emptied");
        assertEq(usdc.balanceOf(address(exits)), 11, "unrelated donation remains unchanged");
    }

    function test_WhenThePayeeClaimsAnExitEscrowWithDonations() external {
        // it should send the claim and surplus to the named recipient
        address escrow = _settleWithInvestorClaim(address(usdc));
        usdc.mint(escrow, 7);
        usdc.mint(address(exits), 11);
        uint256 before = usdc.balanceOf(users.bob);

        vm.prank(users.investor);
        exits.claim(SALE, 2, users.bob);

        assertEq(usdc.balanceOf(users.bob), before + AMOUNT + 7, "claim and surplus to named recipient");
        assertEq(usdc.balanceOf(escrow), 0, "claim escrow emptied");
        assertEq(usdc.balanceOf(address(exits)), 11, "unrelated donation remains unchanged");
    }

    function test_WhenTheClaimTokenStartsChargingTransferFees() external {
        // it should revert and keep the claim fully funded
        MockFeeOnTransferToken feeToken = new MockFeeOnTransferToken();
        feeToken.setFeeBps(0);
        feeToken.mint(address(safe), PROCEEDS);
        address escrow = _settleWithInvestorClaim(address(feeToken));
        feeToken.setFeeBps(100);

        vm.expectPartialRevert(IPayments.InexactTransfer.selector);
        vm.prank(users.investor);
        exits.claim(SALE, 2, users.bob);

        assertEq(exits.claimOf(SALE, 2).escrow, escrow, "claim kept");
        assertEq(feeToken.balanceOf(escrow), AMOUNT, "claim remains funded");
        assertEq(uint256(IEscrow(escrow).state()), uint256(IEscrow.State.Open), "escrow remains open");
    }

    function test_WhenTheExitSurplusTransferChargesASeparateFee() external {
        // it should revert and keep the claim fully funded
        ExitSurplusFeeToken feeToken = new ExitSurplusFeeToken();
        feeToken.mint(address(safe), PROCEEDS);
        address escrow = _settleWithInvestorClaim(address(feeToken));
        feeToken.mint(escrow, 100);
        _markClaimed(users.investor);

        vm.expectPartialRevert(IPayments.InexactTransfer.selector);
        vm.prank(users.investor);
        IEscrow(escrow).collect();

        assertEq(feeToken.balanceOf(escrow), AMOUNT + 100, "claim and surplus remain funded");
        assertEq(uint256(IEscrow(escrow).state()), uint256(IEscrow.State.Open), "escrow remains open");
    }

    function test_WhenThePayeeCollectsWithLimitedGas() external {
        // it should either pay the claim and surplus to the shareholder or leave the escrow unchanged
        // The surplus routing is the escrow's own `ownerTakesSurplus` term, so no gas limit can misroute it.
        address escrow = _settleWithInvestorClaim(address(usdc));
        usdc.mint(escrow, 7);
        _markClaimed(users.investor);
        uint256 before = usdc.balanceOf(users.investor);
        uint256 successes;
        uint256 failures;
        for (uint256 gasLimit = 40_000; gasLimit <= 250_000; gasLimit += 1000) {
            uint256 snapshot = vm.snapshotState();
            vm.prank(users.investor);
            (bool ok,) = escrow.call{ gas: gasLimit }(abi.encodeCall(IEscrow.collect, ()));
            if (ok) {
                ++successes;
                assertEq(usdc.balanceOf(users.investor), before + AMOUNT + 7, "no surplus misrouted");
                assertEq(usdc.balanceOf(address(exits)), 0, "no surplus left in Exits");
            } else {
                ++failures;
                assertEq(usdc.balanceOf(escrow), AMOUNT + 7, "reverted collection keeps claim funded");
                assertEq(uint256(IEscrow(escrow).state()), uint256(IEscrow.State.Open), "still open");
            }
            vm.revertToState(snapshot);
        }
        assertGt(successes, 0, "some gas limits allow collection");
        assertGt(failures, 0, "some gas limits are too low, and fail whole");
    }

    modifier whenThePayeeClaims() {
        _;
    }

    function test_WhenThePayeeClaims() external whenThePayeeClaims {
        // it should clear the claim before the transfer
        // it should refund the claim escrow to Exits and send the whole amount on in the same call
        // it should send the amount to the address the payee names
        // it should hold no token itself afterwards
        // it should emit Claimed
        // The re-entrant token reads the claim from inside the transfer.
        address escrow = _settleWithInvestorClaim(address(reentrantToken));
        reentrantToken.arm(address(exits), abi.encodeCall(IExits.claimOf, (SALE, 2)));
        uint256 before = reentrantToken.balanceOf(users.investor);

        vm.expectCall(escrow, abi.encodeCall(IEscrow.refund, ()));
        vm.expectEmit(address(exits));
        emit IExits.Claimed(SALE, 2, users.investor);
        vm.prank(users.investor);
        exits.claim(SALE, 2, users.investor);

        assertTrue(reentrantToken.reentered(), "the token called back during the transfer");
        assertTrue(reentrantToken.reentrySucceeded(), "claimOf answered");
        IExits.Claim memory during = abi.decode(reentrantToken.reentryResult(), (IExits.Claim));
        assertEq(during.payee, address(0), "the claim was already cleared during the transfer");

        assertEq(reentrantToken.balanceOf(users.investor), before + AMOUNT, "the whole amount, to the payee");
        assertEq(reentrantToken.balanceOf(escrow), 0, "escrow emptied");
        assertEq(uint256(IEscrow(escrow).state()), uint256(IEscrow.State.Refunded), "escrow refunded to Exits");
        assertEq(reentrantToken.balanceOf(address(exits)), 0, "Exits holds nothing (X3)");
        assertEq(exits.claimOf(SALE, 2).payee, address(0), "claim cleared");

        vm.expectRevert(abi.encodeWithSelector(IExits.NoClaim.selector, SALE, 2));
        vm.prank(users.investor);
        exits.claim(SALE, 2, users.investor);
    }

    function test_GivenThePayeeNamesAnAddressOtherThanTheirOwn() external whenThePayeeClaims {
        // it should send it there
        // The investor's own address is on the token's blacklist, so they name Bob's.
        _settleIn(address(blacklistToken), _one(2));
        blacklistToken.setBlocked(users.investor, true);

        vm.prank(users.investor);
        exits.claim(SALE, 2, users.bob);

        assertEq(blacklistToken.balanceOf(users.bob), AMOUNT, "sent where the payee said");
        assertEq(blacklistToken.balanceOf(address(exits)), 0, "Exits holds nothing (X3)");
    }

    function test_WhenTheTokenRefusesTheTransfer() external whenThePayeeClaims {
        // it should revert and keep the claim
        address escrow = _settleWithInvestorClaim(address(blacklistToken));
        blacklistToken.setBlocked(users.investor, true);

        vm.expectRevert(abi.encodeWithSelector(MockBlacklistToken.Blacklisted.selector, users.investor));
        vm.prank(users.investor);
        exits.claim(SALE, 2, users.investor);

        IExits.Claim memory c = exits.claimOf(SALE, 2);
        assertEq(c.payee, users.investor, "claim kept");
        assertEq(c.amount, AMOUNT, "amount kept");
        assertEq(blacklistToken.balanceOf(escrow), AMOUNT, "money still in its escrow");
        assertEq(uint256(IEscrow(escrow).state()), uint256(IEscrow.State.Open), "escrow still open");
    }

    function test_WhenTheTokenRe_entersClaimDuringTheTransfer() external whenThePayeeClaims {
        // it should revert with NoClaim on the inner call
        address escrow = _settleWithInvestorClaim(address(reentrantToken));
        reentrantToken.arm(address(exits), abi.encodeCall(IExits.claim, (SALE, 2, users.eve)));
        uint256 before = reentrantToken.balanceOf(users.bob);

        vm.prank(users.investor);
        exits.claim(SALE, 2, users.bob);

        assertTrue(reentrantToken.reentered(), "re-entered");
        assertFalse(reentrantToken.reentrySucceeded(), "the inner claim failed");
        assertEq(
            reentrantToken.reentryResult(),
            abi.encodeWithSelector(IExits.NoClaim.selector, SALE, 2),
            "the inner claim found no claim"
        );
        assertEq(reentrantToken.balanceOf(users.bob), before + AMOUNT, "paid once, to Bob");
        assertEq(reentrantToken.balanceOf(users.eve), 1_000_000e6, "Eve got nothing");
        assertEq(reentrantToken.balanceOf(escrow), 0, "escrow emptied");
        assertEq(reentrantToken.balanceOf(address(exits)), 0, "Exits holds nothing (X3)");
    }
}

/// @dev Credits the recipient in full and charges the selected sender an extra fee.
contract ExitEscrowSenderFeeToken is MockERC20 {
    address private _feeSender;

    constructor() MockERC20("Escrow Sender Fee USD", "ESFUSD", 6) { }

    function setFeeSender(address sender) external {
        _feeSender = sender;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == _feeSender && to != address(0)) super._update(from, address(0), value / 100);
        super._update(from, to, value);
    }
}

/// @dev An outgoing transfer from Exits charges the recipient one unit.
contract ExitRecipientFeeToken is MockERC20 {
    address private immutable _exits;

    constructor(address exits_) MockERC20("Recipient Fee USD", "RFUSD", 6) {
        _exits = exits_;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == _exits && to != address(0) && value != 0) {
            super._update(from, address(0), 1);
            super._update(from, to, value - 1);
        } else {
            super._update(from, to, value);
        }
    }
}

/// @dev Rebases selected balances during an exit escrow's payout or surplus transfer.
contract ExitRebasingToken is MockERC20 {
    address private _escrow;
    address private _payee;
    uint256 private _claim;
    uint8 private _mode;

    constructor() MockERC20("Rebasing USD", "RBUSD", 6) { }

    function arm(address escrow, address payee, uint256 claim, uint8 mode) external {
        _escrow = escrow;
        _payee = payee;
        _claim = claim;
        _mode = mode;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from != _escrow || to != _payee) return;
        if (_mode == 1 && value == _claim) super._update(address(0), _escrow, value + 1);
        if (_mode == 2 && value != _claim) super._update(_payee, address(0), value + 1);
        if (_mode == 3 && value != _claim) super._update(address(0), _escrow, 1);
        if (_mode == 4 && value != _claim) super._update(address(0), _escrow, value + 1);
    }
}

/// @dev Rebases Exits or the recipient during a refund or claim transfer.
contract ExitClaimRebasingToken is MockERC20 {
    address private _escrow;
    address private _exits;
    address private _recipient;
    uint8 private _mode;

    constructor() MockERC20("Claim Rebasing USD", "CRUSD", 6) { }

    function arm(address escrow, address exits_, address recipient, uint8 mode) external {
        _escrow = escrow;
        _exits = exits_;
        _recipient = recipient;
        _mode = mode;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (_mode == 1 && from == _escrow && to == _exits) super._update(_exits, address(0), value + 1);
        if (_mode == 2 && from == _exits && to == _recipient) super._update(_recipient, address(0), value + 1);
        if (_mode == 3 && from == _exits && to == _recipient) super._update(address(0), _exits, value + 1);
    }
}

/// @dev Charges a fee on transfer, but not on transferFrom through Payments.
contract ExitSurplusFeeToken is MockERC20 {
    constructor() MockERC20("Surplus fee token", "SURPLUS", 6) { }

    function transfer(address to, uint256 value) public override returns (bool) {
        uint256 fee = value / 100;
        _burn(msg.sender, fee);
        return super.transfer(to, value - fee);
    }
}
