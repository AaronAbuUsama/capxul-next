// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Addresses } from "./Addresses.sol";
import { Fork_Test } from "./Fork_Test.t.sol";
import { IHatsSignerGate, IRoles, ISafe } from "./Interfaces.sol";

/// @notice Ruling D1 against the real Safe 1.4.1, Zodiac Roles v2, Hats v1 and Hats Signer Gate v2,
/// with no v4 code: the Gate is the company Safe's only module and guard, Roles sits on the Gate,
/// and the Board acts by approveHash from the Director's own Safe.
contract CompanySafeGate_Fork_Test is Fork_Test {
    bytes32 internal constant TRANSFER_ROLE = "capxul.test.transfer";
    bytes4 internal constant ROLES_CONDITION_VIOLATION = bytes4(keccak256("ConditionViolation(uint8,bytes32)"));
    bytes4 internal constant ROLES_NOT_AUTHORIZED = bytes4(keccak256("NotAuthorized(address)"));

    /// @dev (1) A role member allowed only `usdc.transfer` moves USDC: Roles -> Gate -> Safe.
    function test_RoleMemberMovesTokenThroughRolesGateSafe() external {
        _assertGateIsOnlyModuleAndGuard();
        assertEq(companyRoles.avatar(), address(companySafe), "Roles avatar is the Safe");
        assertEq(companyRoles.target(), address(gate), "Roles target is the Gate");

        // The Board scopes the role to usdc.transfer and gives it to Jordan, in one batch.
        bytes32[] memory keys = new bytes32[](1);
        keys[0] = TRANSFER_ROLE;
        bool[] memory member = new bool[](1);
        member[0] = true;
        Call[] memory grant = new Call[](3);
        grant[0] = Call(address(companyRoles), 0, abi.encodeCall(IRoles.scopeTarget, (TRANSFER_ROLE, address(usdc))));
        grant[1] = Call(
            address(companyRoles),
            0,
            abi.encodeCall(IRoles.allowFunction, (TRANSFER_ROLE, address(usdc), usdc.transfer.selector, 0))
        );
        grant[2] = Call(address(companyRoles), 0, abi.encodeCall(IRoles.assignRoles, (users.jordan, keys, member)));
        _boardBatch(grant);

        uint256 amount = 2500 * USDC_UNIT;
        uint256 safeBefore = usdc.balanceOf(address(companySafe));
        uint256 aliceBefore = usdc.balanceOf(users.alice);

        // The Safe reports the Gate as the module, and the Gate reports Roles.
        vm.expectEmit(true, false, false, false, address(companySafe));
        emit IHatsSignerGate.ExecutionFromModuleSuccess(address(gate));
        vm.expectEmit(true, false, false, false, address(gate));
        emit IHatsSignerGate.ExecutionFromModuleSuccess(address(companyRoles));
        vm.prank(users.jordan);
        companyRoles.execTransactionWithRole(
            address(usdc), 0, abi.encodeCall(usdc.transfer, (users.alice, amount)), CALL, TRANSFER_ROLE, true
        );

        assertEq(usdc.balanceOf(address(companySafe)), safeBefore - amount, "the Safe paid");
        assertEq(usdc.balanceOf(users.alice), aliceBefore + amount, "Alice was paid");

        // Only transfer: approve on the same token is refused.
        vm.prank(users.jordan);
        vm.expectPartialRevert(ROLES_CONDITION_VIOLATION);
        companyRoles.execTransactionWithRole(
            address(usdc), 0, abi.encodeCall(usdc.approve, (users.eve, amount)), CALL, TRANSFER_ROLE, true
        );

        // Only members: Eve is refused.
        vm.prank(users.eve);
        vm.expectPartialRevert(ROLES_NOT_AUTHORIZED);
        companyRoles.execTransactionWithRole(
            address(usdc), 0, abi.encodeCall(usdc.transfer, (users.eve, amount)), CALL, TRANSFER_ROLE, true
        );
    }

    /// @dev (2) A Board batch approved by the hat-wearing Director passes the Gate; a second Safe
    /// module is refused by a direct call and inside a batch; a Director whose hat lapsed no longer counts.
    function test_BoardBatchPassesGateAndSecondModuleIsRefused() external {
        _assertGateIsOnlyModuleAndGuard();
        assertTrue(gate.isValidSigner(address(founderSafe)), "Amira's Safe is a valid signer");
        assertEq(companySafe.getThreshold(), 1, "threshold 1");

        uint256 amount = 1000 * USDC_UNIT;
        uint256 aliceBefore = usdc.balanceOf(users.alice);
        uint256 bobBefore = usdc.balanceOf(users.bob);
        Call[] memory pay = new Call[](2);
        pay[0] = Call(address(usdc), 0, abi.encodeCall(usdc.transfer, (users.alice, amount)));
        pay[1] = Call(address(usdc), 0, abi.encodeCall(usdc.transfer, (users.bob, amount)));
        _boardBatch(pay);
        assertEq(usdc.balanceOf(users.alice), aliceBefore + amount, "batch paid Alice");
        assertEq(usdc.balanceOf(users.bob), bobBefore + amount, "batch paid Bob");

        address extra = makeAddr("second module");
        bytes memory enable = abi.encodeCall(ISafe.enableModule, (extra));

        // A direct call into the Safe is refused before it runs.
        bytes memory sig = _boardApprove(address(companySafe), 0, enable, CALL);
        vm.expectRevert(IHatsSignerGate.CannotCallSafe.selector);
        companySafe.execTransaction(
            address(companySafe), 0, enable, CALL, 0, 0, 0, address(0), payable(address(0)), sig
        );

        // The same change inside a batch runs, then the Gate's after-check refuses it.
        Call[] memory sneak = new Call[](1);
        sneak[0] = Call(address(companySafe), 0, enable);
        bytes memory batch = _multiSend(sneak);
        sig = _boardApprove(Addresses.MULTI_SEND_CALL_ONLY_141, 0, batch, DELEGATECALL);
        vm.expectRevert(IHatsSignerGate.CannotChangeModules.selector);
        companySafe.execTransaction(
            Addresses.MULTI_SEND_CALL_ONLY_141, 0, batch, DELEGATECALL, 0, 0, 0, address(0), payable(address(0)), sig
        );

        assertFalse(companySafe.isModuleEnabled(extra), "no second module");
        _assertGateIsOnlyModuleAndGuard();

        // Once the Director hat lapses, her approval no longer counts.
        batch = _multiSend(pay);
        sig = _boardApprove(Addresses.MULTI_SEND_CALL_ONLY_141, 0, batch, DELEGATECALL);
        vm.prank(noModule); // the Director hat's eligibility address
        HATS.setHatWearerStatus(directorHat, address(founderSafe), false, false);
        assertFalse(gate.isValidSigner(address(founderSafe)), "lapsed Director is not a valid signer");
        vm.expectRevert(IHatsSignerGate.InsufficientValidSignatures.selector);
        companySafe.execTransaction(
            Addresses.MULTI_SEND_CALL_ONLY_141, 0, batch, DELEGATECALL, 0, 0, 0, address(0), payable(address(0)), sig
        );
    }
}
