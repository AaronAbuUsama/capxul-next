// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../utils/Captable/Captable_Test.sol";

/// @dev The issue tree's ranged leaves: E1 at the edge of authorised, the module allowance, and the D6 window.
contract Issue_Captable_Unit_Fuzz_Test is Captable_Test {
    function testFuzz_Issue_WithinAuthorisedMints(uint128 first, uint128 second) external {
        first = uint128(bound(first, 1, SERIES_A_AUTHORISED));
        second = uint128(bound(second, 1, SERIES_A_AUTHORISED));
        _issue(SERIES_A, users.investor, first);

        if (first + second > SERIES_A_AUTHORISED) {
            vm.prank(address(safe));
            vm.expectRevert(
                abi.encodeWithSelector(
                    ICaptable.AuthorisedExceeded.selector, SERIES_A, SERIES_A_AUTHORISED, first, second
                )
            );
            captable.issue(SERIES_A, users.bob, second, REASON);
        } else {
            _issue(SERIES_A, users.bob, second);
            assertEq(_token(SERIES_A).balanceOf(users.bob), second, "minted");
        }
        assertLe(_token(SERIES_A).totalSupply(), SERIES_A_AUTHORISED, "E1");
    }

    function testFuzz_Issue_CommonRoomIsAuthorisedLessReserve(uint128 amount) external {
        amount = uint128(bound(amount, 1, COMMON_AUTHORISED));
        uint256 room = COMMON_AUTHORISED - SERIES_A_RESERVE;
        if (amount > room) {
            vm.prank(address(safe));
            vm.expectPartialRevert(ICaptable.AuthorisedExceeded.selector);
            captable.issue(COMMON, users.amira, amount, REASON);
        } else {
            _issue(COMMON, users.amira, amount);
            assertEq(_token(COMMON).totalSupply(), amount, "minted");
        }
    }

    function testFuzz_Issue_ModuleAllowance(uint128 allowance, uint128 amount, uint8 moduleSeed) external {
        allowance = uint128(bound(allowance, 0, SERIES_A_AUTHORISED));
        amount = uint128(bound(amount, 1, SERIES_A_AUTHORISED));
        address module = [options, rounds, address(vesting)][bound(moduleSeed, 0, 2)];
        vm.prank(address(safe));
        captable.setIssuerAllowance(module, SERIES_A, allowance);

        vm.prank(module);
        if (amount > allowance) {
            vm.expectRevert(
                abi.encodeWithSelector(ICaptable.IssuerAllowanceExceeded.selector, module, SERIES_A, allowance, amount)
            );
            captable.issue(SERIES_A, users.investor, amount, REASON);
        } else {
            captable.issue(SERIES_A, users.investor, amount, REASON);
            assertEq(captable.issuerAllowance(module, SERIES_A), allowance - amount, "allowance lowered");
        }
    }

    function testFuzz_Issue_PendingWindow(uint32 pending, uint32 later) external {
        uint48 until = uint48(vm.getBlockTimestamp() + bound(pending, 0, 30 days));
        governor.setPendingUntil(until);
        vm.warp(vm.getBlockTimestamp() + bound(later, 0, 60 days));

        vm.prank(address(safe));
        if (vm.getBlockTimestamp() <= until) {
            vm.expectRevert(abi.encodeWithSelector(ICaptable.ProposalPending.selector, COMMON, until));
            captable.issue(COMMON, users.amira, 1, REASON);
        } else {
            captable.issue(COMMON, users.amira, 1, REASON);
            assertEq(_token(COMMON).balanceOf(users.amira), 1, "issued after the snapshot");
        }
    }
}
