// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";

/// @notice Fuzz ranges for unit/concrete/Escrow/collect/collect.tree.
contract Collect_Escrow_Unit_Fuzz_Test is Escrow_Test {
    /// @dev Leaf "the caller is not the owner": every other caller, the sender and admitted wearers included (G4).
    function testFuzz_RevertWhen_TheCallerIsNotTheOwner(address caller) external {
        vm.assume(caller != address(claimedOwner));
        IEscrow escrow = _escrow(_departmentTerms(address(claimedOwner)));
        authority.admit(BUDGET_ID, caller);
        usdc.mint(address(escrow), AMOUNT);
        vm.prank(caller);
        vm.expectRevert(IEscrow.NotOwner.selector);
        escrow.collect();
    }

    /// @dev Leaf "holds less than the amount": any shortfall.
    function testFuzz_RevertWhen_TheEscrowHoldsLessThanTheAmount(uint256 balance) external {
        balance = bound(balance, 0, AMOUNT - 1);
        IEscrow escrow = _claimEscrow(claimedOwner);
        usdc.mint(address(escrow), balance);
        vm.prank(address(claimedOwner));
        vm.expectRevert(IEscrow.InsufficientFunding.selector);
        escrow.collect();
    }

    /// @dev Leaves "collects a funded escrow" and "ownerTakesSurplus": any amount and surplus, either routing (G3, G8).
    function testFuzz_WhenTheClaimedOwnerCollectsAFundedEscrow(
        uint256 amount,
        uint256 surplus,
        bool ownerTakesSurplus
    )
        external
    {
        IEscrow.Terms memory terms = _terms(address(claimedOwner), OWNER_COLLECTS);
        terms.amount = bound(amount, 1, 1e36);
        terms.ownerTakesSurplus = ownerTakesSurplus;
        surplus = bound(surplus, 0, 1e36);
        IEscrow escrow = _escrow(terms);
        usdc.mint(address(escrow), terms.amount + surplus);
        uint256 senderBefore = usdc.balanceOf(sender);

        vm.prank(address(claimedOwner));
        escrow.collect();

        uint256 toOwner = ownerTakesSurplus ? terms.amount + surplus : terms.amount;
        assertEq(usdc.balanceOf(address(claimedOwner)), toOwner, "owner");
        assertEq(usdc.balanceOf(sender) - senderBefore, ownerTakesSurplus ? 0 : surplus, "sender");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow empty");
        assertEq(_state(escrow), uint256(IEscrow.State.Paid), "paid");
    }
}
