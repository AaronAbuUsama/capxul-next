// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../utils/Captable/Captable_Test.sol";

/// @dev C-25: the lock check compares `balance < locked + amount` without subtracting, so any amount, lock and
/// balance gives a clean `SharesLocked` or a pass, never a panic.
contract CheckTransfer_Captable_Unit_Fuzz_Test is Captable_Test {
    function testFuzz_CheckTransfer_LockNeverPanics(uint128 balance, uint128 locked, uint256 amount) external {
        balance = uint128(bound(balance, 1, COMMON_AUTHORISED - SERIES_A_RESERVE));
        _issue(COMMON, users.amira, balance);
        _setRule(COMMON, ICaptable.TransferRule.AllowAll, address(0));
        _lock(COMMON, users.amira, locked);
        address token = address(_token(COMMON));

        bool dips = amount > balance || locked > balance - amount;
        vm.prank(token);
        if (dips) vm.expectRevert(abi.encodeWithSelector(ICaptable.SharesLocked.selector, users.amira, locked));
        captable.checkTransfer(COMMON, users.amira, users.bob, amount);
    }
}
