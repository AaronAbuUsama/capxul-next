// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Vm } from "forge-std/Vm.sol";

import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";
import { IExits } from "../../../../../src/interfaces/IExits.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";
import { Exits } from "../../../../../src/equity/Exits.sol";
import { Exits_Test } from "../../../../utils/Exits/Exits_Test.sol";
import { MockExitSenderFeeToken } from "../../../../utils/Exits/ExitsMocks.sol";
import { MockFeeOnTransferToken } from "../../../../mocks/MockFeeOnTransferToken.sol";

/// @dev spec/exits.md `redirectClaim` (the company Governor, a shareholder vote for a lost wallet, Q15); ruling
/// F5; invariants X3 and X4.
contract RedirectClaim_Exits_Unit_Concrete_Test is Exits_Test {
    uint256 internal constant AMOUNT = 4000e6;

    function test_WhenTheOutgoingTransferChargesExitsAnExtraFee() external {
        // it should revert and preserve the claim and unrelated donation
        MockExitSenderFeeToken token = new MockExitSenderFeeToken(address(exits));
        token.mint(address(safe), PROCEEDS);
        address escrow = _settleWithInvestorClaim(address(token));
        token.mint(address(exits), AMOUNT / 100);

        vm.expectPartialRevert(IPayments.InexactTransfer.selector);
        vm.prank(governor);
        exits.redirectClaim(SALE, 2, users.bob);

        assertEq(exits.claimOf(SALE, 2).escrow, escrow, "claim kept");
        assertEq(token.balanceOf(escrow), AMOUNT, "claim remains funded");
        assertEq(uint256(IEscrow(escrow).state()), uint256(IEscrow.State.Open), "escrow remains open");
        assertEq(token.balanceOf(address(exits)), AMOUNT / 100, "donation unchanged");
    }

    function test_WhenTheClaimTokenStartsChargingTransferFees() external {
        // it should revert and keep the claim fully funded
        MockFeeOnTransferToken feeToken = new MockFeeOnTransferToken();
        feeToken.setFeeBps(0);
        feeToken.mint(address(safe), PROCEEDS);
        address escrow = _settleWithInvestorClaim(address(feeToken));
        feeToken.setFeeBps(100);

        vm.expectPartialRevert(IPayments.InexactTransfer.selector);
        vm.prank(governor);
        exits.redirectClaim(SALE, 2, users.bob);

        assertEq(exits.claimOf(SALE, 2).escrow, escrow, "claim kept");
        assertEq(feeToken.balanceOf(escrow), AMOUNT, "claim remains funded");
        assertEq(uint256(IEscrow(escrow).state()), uint256(IEscrow.State.Open), "escrow remains open");
    }

    function test_WhenTheClaimEscrowHasDonations() external {
        // it should carry the surplus to the new payee
        address oldEscrow = _settleWithInvestorClaim(address(usdc));
        assertTrue(Exits(address(exits)).isExitClaimEscrow(oldEscrow), "old escrow registered");
        usdc.mint(oldEscrow, 7);
        usdc.mint(address(exits), 11);

        vm.prank(governor);
        exits.redirectClaim(SALE, 2, users.bob);
        IExits.Claim memory c = exits.claimOf(SALE, 2);

        assertEq(usdc.balanceOf(c.escrow), AMOUNT + 7, "claim and surplus moved to new escrow");
        assertEq(usdc.balanceOf(oldEscrow), 0, "old escrow emptied");
        assertEq(usdc.balanceOf(address(exits)), 11, "unrelated donation remains unchanged");
        uint256 before = usdc.balanceOf(users.bob);
        vm.prank(users.bob);
        exits.claim(SALE, 2, users.bob);
        assertEq(usdc.balanceOf(users.bob), before + AMOUNT + 7, "new payee receives claim and surplus");
    }

    function test_WhenTheCallerIsNotTheCompanyGovernor() external {
        // it should revert with OnlyGovernor
        _settleWithInvestorClaim(address(usdc));
        address[3] memory callers = [users.eve, address(safe), users.investor];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(IExits.OnlyGovernor.selector);
            vm.prank(callers[i]);
            exits.redirectClaim(SALE, 2, users.eve);
        }
        assertEq(exits.claimOf(SALE, 2).payee, users.investor, "payee unchanged");
    }

    function test_WhenThereIsNoClaimAtTheIndex() external {
        // it should revert with NoClaim
        _settleWithInvestorClaim(address(usdc));
        vm.expectRevert(abi.encodeWithSelector(IExits.NoClaim.selector, SALE, 0));
        vm.prank(governor);
        exits.redirectClaim(SALE, 0, users.bob);
    }

    function test_WhenTheNewPayeeIsZero() external {
        // it should revert with ZeroAddress
        _settleWithInvestorClaim(address(usdc));
        vm.expectRevert(IExits.ZeroAddress.selector);
        vm.prank(governor);
        exits.redirectClaim(SALE, 2, address(0));
    }

    function test_WhenTheNewPayeeIsExitsItselfOrTheClaimEscrow() external {
        // it should revert with ZeroAddress
        // it should leave the claim recorded and its escrow open and fully funded
        address escrow = _settleWithInvestorClaim(address(usdc));
        uint256 amount = exits.claimOf(SALE, 2).amount;
        address[2] memory sinks = [address(exits), escrow];
        for (uint256 k; k < 2; ++k) {
            vm.expectRevert(IExits.ZeroAddress.selector);
            vm.prank(governor);
            exits.redirectClaim(SALE, 2, sinks[k]);
            IExits.Claim memory c = exits.claimOf(SALE, 2);
            assertEq(c.payee, users.investor, "claim kept");
            assertEq(c.escrow, escrow, "same escrow");
            assertEq(uint8(IEscrow(escrow).state()), uint8(IEscrow.State.Open), "escrow still open");
            assertEq(usdc.balanceOf(escrow), amount, "escrow fully funded");
            assertEq(usdc.balanceOf(address(exits)), 0, "Exits holds nothing (X3)");
        }
    }

    function test_WhenAPassedVoteNamesANewPayee() external {
        // it should move the money from the old claim escrow into a new claim escrow for the new payee
        // it should make the new payee the claim's payee
        // it should stop the old payee claiming or collecting
        // it should hold no token itself afterwards
        // it should emit ClaimRedirected
        address oldEscrow = _settleWithInvestorClaim(address(usdc));
        address newPayee = makeAddr("investor's new wallet");

        vm.recordLogs();
        vm.prank(governor);
        exits.redirectClaim(SALE, 2, newPayee);

        IExits.Claim memory c = exits.claimOf(SALE, 2);
        assertEq(c.payee, newPayee, "new payee");
        assertFalse(Exits(address(exits)).isExitClaimEscrow(oldEscrow), "old escrow no longer registered");
        assertTrue(Exits(address(exits)).isExitClaimEscrow(c.escrow), "new escrow registered");
        assertEq(c.amount, AMOUNT, "same amount");
        assertEq(c.token, address(usdc), "same token");
        assertTrue(c.escrow != oldEscrow && c.escrow.code.length != 0, "a new claim escrow");
        assertEq(usdc.balanceOf(c.escrow), AMOUNT, "the money moved into it");
        assertEq(usdc.balanceOf(oldEscrow), 0, "the old escrow is empty");
        assertEq(uint256(IEscrow(oldEscrow).state()), uint256(IEscrow.State.Refunded), "old escrow refunded");
        IEscrow e = IEscrow(c.escrow);
        assertEq(e.ownerSafe(), address(exits), "owned by Exits");
        assertEq(e.payeeSafe(), newPayee, "payee the new payee");
        assertEq(e.amount(), AMOUNT, "amount");
        assertEq(e.kind(), EXIT_KIND, "kind 8");
        assertEq(e.documentHash(), TERMS, "the sale's terms");
        assertEq(e.condition(), PAYEE_CLAIMED, "payee-claimed condition");
        assertEq(usdc.balanceOf(address(exits)), 0, "Exits holds nothing (X3)");

        Vm.Log memory log = _lastLog(address(exits), IExits.ClaimRedirected.selector);
        assertEq(uint256(log.topics[1]), SALE, "event sale");
        assertEq(uint256(log.topics[2]), 2, "event index");
        assertEq(log.data, abi.encode(newPayee, c.escrow), "event payee and escrow");

        vm.expectRevert(IExits.NotPayee.selector);
        vm.prank(users.investor);
        exits.claim(SALE, 2, users.investor);
        _markClaimed(users.investor);
        vm.expectRevert(IEscrow.JobNotOpen.selector);
        vm.prank(users.investor);
        IEscrow(oldEscrow).collect();

        vm.prank(newPayee);
        exits.claim(SALE, 2, newPayee);
        assertEq(usdc.balanceOf(newPayee), AMOUNT, "the new payee can claim it");
    }
}
