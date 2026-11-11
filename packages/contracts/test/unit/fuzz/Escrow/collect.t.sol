// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";

/// @notice Fuzz ranges for trees/Escrow/collect.tree.
contract Collect_Escrow_Unit_Fuzz_Test is Escrow_Test {
    /// @dev Leaf "the caller is not the payee Safe": every other caller.
    function testFuzz_RevertWhen_TheCallerIsNotThePayeeSafe(address caller) external {
        vm.assume(caller != address(claimedPayee));
        IEscrow escrow = _claimEscrow(claimedPayee);
        usdc.mint(address(escrow), AMOUNT);
        vm.prank(caller);
        vm.expectRevert(IEscrow.NotPayee.selector);
        escrow.collect();
    }

    /// @dev Leaf "holds less than the amount": any shortfall.
    function testFuzz_RevertWhen_TheEscrowHoldsLessThanTheAmount(uint256 balance) external {
        balance = bound(balance, 0, AMOUNT - 1);
        IEscrow escrow = _claimEscrow(claimedPayee);
        usdc.mint(address(escrow), balance);
        vm.prank(address(claimedPayee));
        vm.expectRevert(IEscrow.InsufficientFunding.selector);
        escrow.collect();
    }

    /// @dev Leaf "the claimed payee collects a funded escrow": any amount and surplus (S2, S5).
    function testFuzz_WhenTheClaimedPayeeCollectsAFundedEscrow(uint256 amount, uint256 surplus) external {
        IEscrow.Terms memory terms = _terms(address(claimedPayee), CLAIM);
        terms.amount = bound(amount, 1, 1e36);
        surplus = bound(surplus, 0, 1e36);
        IEscrow escrow = _escrow(terms);
        usdc.mint(address(escrow), terms.amount + surplus);
        uint256 ownerBefore = usdc.balanceOf(owner);

        vm.prank(address(claimedPayee));
        escrow.collect();

        assertEq(usdc.balanceOf(address(claimedPayee)), terms.amount, "payee exact");
        assertEq(usdc.balanceOf(owner) - ownerBefore, surplus, "surplus to owner");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow empty");
        assertEq(_state(escrow), uint256(IEscrow.State.Paid), "paid");
    }
}
