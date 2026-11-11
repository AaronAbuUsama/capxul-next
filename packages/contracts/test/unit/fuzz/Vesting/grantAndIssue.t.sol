// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IVesting } from "../../../../src/interfaces/IVesting.sol";
import { Vesting_Shared_Test } from "../../../utils/Vesting/Vesting_Shared_Test.sol";

/// @dev Fuzz of the grantAndIssue tree: any caller, any amount, any start, cliff and end over six years.
contract GrantAndIssue_Vesting_Unit_Fuzz_Test is Vesting_Shared_Test {
    function testFuzz_RevertWhen_CallerIsNotTheSafe(address caller) external {
        vm.assume(caller != address(safe));
        vm.expectRevert(IVesting.OnlyBoard.selector);
        vm.prank(caller);
        vesting.grantAndIssue(address(captable), COMMON, users.amira, AMOUNT, gStart, gCliff, gEnd, true, DOC);
    }

    /// @dev V-2 and the one-month rule: the call succeeds exactly when the spec's checks pass.
    function testFuzz_Schedule(uint128 amount, uint64 start, uint64 cliff, uint64 end) external {
        amount = uint128(bound(amount, 0, AUTHORISED));
        uint64 hi = uint64(START + 6 * 365 days);
        start = uint64(bound(start, START, hi));
        cliff = uint64(bound(cliff, START, hi));
        end = uint64(bound(end, START, hi));
        bool valid = amount > 0 && _validSchedule(start, cliff, end);
        if (!valid) {
            vm.expectRevert(IVesting.InvalidSchedule.selector);
            _grant(users.amira, amount, start, cliff, end, false);
            return;
        }
        uint256 id = _grant(users.amira, amount, start, cliff, end, false);
        _assertGrant(vesting.getGrant(id), _liveGrant(users.amira, amount, start, cliff, end, false));
        assertEq(_balance(users.amira), amount, "issued");
        assertEq(_locked(users.amira, cliff), _model(amount, start, cliff, end, cliff), "at the cliff");
        if (cliff > 0) assertEq(_locked(users.amira, cliff - 1), amount, "before the cliff");
        assertEq(_locked(users.amira, end), 0, "at the end");
    }
}
