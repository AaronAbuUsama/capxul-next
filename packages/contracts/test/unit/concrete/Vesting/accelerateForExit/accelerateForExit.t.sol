// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IVesting } from "../../../../../src/interfaces/IVesting.sol";
import { Vesting_Shared_Test } from "../../../../utils/Vesting/Vesting_Shared_Test.sol";

/// @dev Single-trigger acceleration at an approved sale. It never reverts for the grant's state, so one grant
/// cannot block the exit's settle.
contract AccelerateForExit_Vesting_Unit_Concrete_Test is Vesting_Shared_Test {
    /// @dev Calls as Exits and asserts the grant and the logs are untouched and nothing reverted.
    function _assertNoOp(uint256 id) internal {
        bytes32 before = _grantHash(id);
        vm.recordLogs();
        vm.prank(exits);
        vesting.accelerateForExit(id);
        _assertNoVestingEvent();
        assertEq(_grantHash(id), before, "grant unchanged");
    }

    function test_WhenTheCallerIsNotTheCaptablesExits() external {
        // it should revert with OnlyExits
        uint256 id = _defaultGrant(users.amira);
        address[3] memory callers = [address(users.eve), address(safe), address(users.amira)];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(IVesting.OnlyExits.selector);
            vm.prank(callers[i]);
            vesting.accelerateForExit(id);
        }
    }

    function test_WhenTheGrantIsNotAccepted() external {
        // it should do nothing and not revert
        _issue(users.ben, AMOUNT);
        uint256 id = _offer(users.ben, AMOUNT);
        _assertNoOp(id);
    }

    function test_WhenTheGrantWasRevoked() external {
        // it should do nothing and not revert
        uint256 id = _defaultGrant(users.amira);
        _revoke(id, _date(2028, 1, 1));
        vm.warp(_date(2027, 6, 1));
        _assertNoOp(id);
        assertEq(_locked(users.amira, _date(2028, 1, 1)), 2_400_000, "revocation stands");
    }

    function test_WhenTheGrantHasAlreadyEnded() external {
        // it should do nothing and not revert
        uint256 id = _defaultGrant(users.amira);
        vm.warp(gEnd);
        _assertNoOp(id);
        vm.warp(gEnd + 365 days);
        _assertNoOp(id);
    }

    function test_WhenTheGrantDoesNotAccelerateOnExit() external {
        // it should do nothing and not revert
        uint256 id = _grant(users.amira, AMOUNT, gStart, gCliff, gEnd, false);
        vm.warp(_date(2027, 6, 1));
        _assertNoOp(id);
        assertEq(_locked(users.amira, _now()), 3_100_000, "still vesting");
    }

    function test_WhenTheGrantAcceleratesOnExitAndIsLive() external {
        uint256 id = _defaultGrant(users.amira);
        vm.warp(_date(2027, 6, 1));
        assertEq(_locked(users.amira, _now()), 3_100_000, "locked before the sale");
        // it should emit Accelerated
        vm.expectEmit(true, true, true, true, address(vesting));
        emit IVesting.Accelerated(address(safe), id, _now(), DOC);
        vm.prank(exits);
        vesting.accelerateForExit(id);
        // it should end the schedule now so nothing is locked
        assertEq(vesting.getGrant(id).end, _now(), "end is now");
        assertEq(_locked(users.amira, _now()), 0, "nothing locked");
        assertEq(_balance(users.amira), AMOUNT, "no shares moved");
    }
}
