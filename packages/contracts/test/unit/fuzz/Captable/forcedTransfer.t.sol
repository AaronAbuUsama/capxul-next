// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../utils/Captable/Captable_Test.sol";

/// @dev D3 (E7): consent binds every field, and no forced transfer ever moves locked shares.
contract ForcedTransfer_Captable_Unit_Fuzz_Test is Captable_Test {
    function testFuzz_ForcedTransfer_ConsentBindsEveryField(uint8 field, uint128 other) external {
        _issue(COMMON, users.amira, 1000);
        _issue(SERIES_A, users.amira, 1000);
        _issue(COMMON, users.ben, 1000);
        vm.prank(users.amira);
        captable.consentToTransfer(COMMON, users.bob, 100, REASON);

        field = uint8(bound(field, 0, 4));
        other = uint128(bound(other, 1, 999));
        if (other == 100) other = 101;
        uint8 classId = field == 0 ? SERIES_A : COMMON;
        address from = field == 1 ? users.ben : users.amira;
        address to = field == 2 ? users.eve : users.bob;
        uint128 amount = field == 3 ? other : 100;
        bytes32 reason = field == 4 ? keccak256(abi.encode(other)) : REASON;

        vm.prank(address(safe));
        vm.expectRevert(ICaptable.ConsentMissing.selector);
        captable.forcedTransfer(classId, from, to, amount, reason);

        vm.prank(address(safe));
        captable.forcedTransfer(COMMON, users.amira, users.bob, 100, REASON);
        assertEq(_token(COMMON).balanceOf(users.bob), 100, "the exact terms move");
    }

    function testFuzz_ForcedTransfer_NeverMovesLocked(uint128 balance, uint128 locked, uint128 amount) external {
        balance = uint128(bound(balance, 1, 1_000_000));
        locked = uint128(bound(locked, 0, balance));
        amount = uint128(bound(amount, 1, type(uint128).max));
        _issue(COMMON, users.amira, balance);
        _lock(COMMON, users.amira, locked);

        vm.prank(address(governor));
        if (amount > balance - locked) {
            vm.expectRevert(abi.encodeWithSelector(ICaptable.SharesLocked.selector, users.amira, locked));
            captable.forcedTransfer(COMMON, users.amira, users.bob, amount, REASON);
        } else {
            captable.forcedTransfer(COMMON, users.amira, users.bob, amount, REASON);
            assertGe(_token(COMMON).balanceOf(users.amira), locked, "the locked shares stay");
        }
    }
}
