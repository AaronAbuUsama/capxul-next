// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";
import { IHatsSignerGate } from "../../../../../src/interfaces/external/IHatsSignerGate.sol";
import { IRoles } from "../../../../../src/interfaces/external/IRoles.sol";
import { MockSafe } from "../../../../mocks/MockSafe.sol";

import { BudgetsGateMock, BudgetsRolesMock } from "../../../../utils/Budgets/BudgetsMocks.sol";
import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md `configure` (D1: Roles is a module on the Gate, never on the Safe).
contract Configure_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    function test_WhenACallIntoBudgetsIsAlreadyRunning() external {
        // it should revert with ReentrantCall
        _assertLockRefuses(abi.encodeCall(IBudgets.configure, (address(payoutRoles), ROLE_KEY)));
    }

    function test_WhenTheRolesModifiersAvatarIsNotTheCaller() external {
        BudgetsRolesMock otherRoles = new BudgetsRolesMock(new MockSafe(address(this)), address(gate));
        // it should revert with InvalidConfiguration
        vm.prank(address(safe));
        vm.expectRevert(IBudgets.InvalidConfiguration.selector);
        budgets.configure(address(otherRoles), ROLE_KEY);

        // Eve cannot point Budgets at the company's Roles for herself.
        vm.prank(users.eve);
        vm.expectRevert(IBudgets.InvalidConfiguration.selector);
        budgets.configure(address(payoutRoles), ROLE_KEY);
    }

    function test_WhenTheRolesModifiersTargetIsNotASignerGateWhoseSafeIsTheCaller() external {
        // A Gate that guards another Safe.
        payoutRoles.setTarget(address(new BudgetsGateMock(makeAddr("another Safe"))));
        // it should revert with InvalidConfiguration
        vm.prank(address(safe));
        vm.expectRevert(IBudgets.InvalidConfiguration.selector);
        budgets.configure(address(payoutRoles), ROLE_KEY);
    }

    function test_WhenTheRolesModifiersTargetIsTheCallerItself() external {
        // Roles aimed straight at the Safe, the shape D1 forbids.
        payoutRoles.setTarget(address(safe));
        // it should revert with InvalidConfiguration
        vm.prank(address(safe));
        vm.expectRevert(IBudgets.InvalidConfiguration.selector);
        budgets.configure(address(payoutRoles), ROLE_KEY);
    }

    function test_WhenAReadOfTheAvatarOrTheTargetOrTheGatesSafeRevertsOrReturnsMalformedData() external {
        // it should revert with InvalidConfiguration
        // 1. Roles is not a contract.
        _expectInvalid(makeAddr("not a contract"));

        // 2. avatar() reverts.
        vm.mockCallRevert(address(payoutRoles), abi.encodeCall(IRoles.avatar, ()), "nope");
        _expectInvalid(address(payoutRoles));
        vm.clearMockedCalls();

        // 3. avatar() returns too few bytes.
        vm.mockCall(address(payoutRoles), abi.encodeCall(IRoles.avatar, ()), hex"1234");
        _expectInvalid(address(payoutRoles));
        vm.clearMockedCalls();

        // 4. avatar() returns a word with dirty upper bits.
        vm.mockCall(
            address(payoutRoles),
            abi.encodeCall(IRoles.avatar, ()),
            abi.encode((uint256(1) << 160) | uint256(uint160(address(safe))))
        );
        _expectInvalid(address(payoutRoles));
        vm.clearMockedCalls();

        // 5. target() reverts.
        vm.mockCallRevert(address(payoutRoles), abi.encodeCall(IRoles.target, ()), "nope");
        _expectInvalid(address(payoutRoles));
        vm.clearMockedCalls();

        // 6. The target has no code.
        payoutRoles.setTarget(makeAddr("no code"));
        _expectInvalid(address(payoutRoles));
        payoutRoles.setTarget(address(gate));

        // 7. The Gate's safe() reverts.
        vm.mockCallRevert(address(gate), abi.encodeCall(IHatsSignerGate.safe, ()), "nope");
        _expectInvalid(address(payoutRoles));
        vm.clearMockedCalls();

        // 8. The Gate's safe() returns too few bytes.
        vm.mockCall(address(gate), abi.encodeCall(IHatsSignerGate.safe, ()), hex"00");
        _expectInvalid(address(payoutRoles));
        vm.clearMockedCalls();

        // With every read sound again, the same call is accepted: the refusals came from the reads.
        vm.prank(address(safe));
        budgets.configure(address(payoutRoles), ROLE_KEY);
    }

    modifier whenTheAvatarIsTheCallerAndTheTargetIsTheCallersSignerGate() {
        _;
    }

    function test_WhenTheAvatarIsTheCallerAndTheTargetIsTheCallersSignerGate()
        external
        whenTheAvatarIsTheCallerAndTheTargetIsTheCallersSignerGate
    {
        // it should emit Configured
        vm.expectEmit(true, true, true, true, address(budgets));
        emit IBudgets.Configured(address(safe), address(payoutRoles), ROLE_KEY);
        vm.prank(address(safe));
        budgets.configure(address(payoutRoles), ROLE_KEY);

        // it should store the Roles address and the payout role key for the caller
        (address storedRoles, bytes32 storedKey) = budgets.configs(address(safe));
        assertEq(storedRoles, address(payoutRoles), "roles");
        assertEq(storedKey, ROLE_KEY, "payout role key");
        (address otherRoles,) = budgets.configs(users.eve);
        assertEq(otherRoles, address(0), "only the caller is configured");
    }

    function test_GivenTheSafeWasConfiguredBefore()
        external
        whenTheAvatarIsTheCallerAndTheTargetIsTheCallersSignerGate
    {
        vm.prank(address(safe));
        budgets.configure(address(payoutRoles), ROLE_KEY);

        BudgetsRolesMock newRoles = new BudgetsRolesMock(safe, address(gate));
        bytes32 newKey = keccak256("capxul.v4.payout.2");
        vm.prank(address(safe));
        budgets.configure(address(newRoles), newKey);

        // it should replace the old configuration
        (address storedRoles, bytes32 storedKey) = budgets.configs(address(safe));
        assertEq(storedRoles, address(newRoles), "new roles");
        assertEq(storedKey, newKey, "new key");
    }

    function _expectInvalid(address roles_) internal {
        vm.prank(address(safe));
        vm.expectRevert(IBudgets.InvalidConfiguration.selector);
        budgets.configure(roles_, ROLE_KEY);
    }
}
