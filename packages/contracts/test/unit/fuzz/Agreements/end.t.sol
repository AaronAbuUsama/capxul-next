// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../../../src/interfaces/IAgreements.sol";
import { Agreements_Unit_Shared } from "../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice `end` over its dates (A3, A10).
contract End_Agreements_Unit_Fuzz_Test is Agreements_Unit_Shared {
    /// @dev Any end up to a year out, read any time after it: earned stops at the end (A3), and all of it is
    /// released.
    function testFuzz_NothingIsEarnedAfterTheEnd(uint32 endDelay, uint32 extra, uint8 period) external {
        period = uint8(bound(period, 0, 2));
        uint64 t0 = _now();
        uint256 id = _offerTo(users.alice, 3333e6 + 3, period, 0, 0, MONTHLY);
        _accept(id);
        uint64 endsAt = t0 + uint64(bound(endDelay, 0, 365 days));
        vm.prank(users.jordan);
        agreements.end(id, endsAt);
        vm.warp(endsAt + bound(extra, 0, 365 days));
        uint128 earned = _units(3333e6 + 3, period, t0, endsAt);
        assertEq(agreements.earnedOf(id), earned, "earned to the end");
        assertEq(agreements.availableOf(id), earned, "all of it released");
    }

    /// @dev Two ends in turn (A10): the second is accepted only if it is earlier than the first.
    function testFuzz_AnEndOnlyMovesEarlier(uint32 first, uint32 second) external {
        uint256 id = _running();
        uint64 e1 = _now() + uint64(bound(first, 0, 365 days));
        uint64 e2 = _now() + uint64(bound(second, 0, 365 days));
        vm.startPrank(users.jordan);
        agreements.end(id, e1);
        if (e2 >= e1) vm.expectRevert(IAgreements.AlreadyEnded.selector);
        agreements.end(id, e2);
        vm.stopPrank();
        assertEq(agreements.agreementOf(id).endsAt, e2 < e1 ? e2 : e1, "the earlier end");
    }
}
