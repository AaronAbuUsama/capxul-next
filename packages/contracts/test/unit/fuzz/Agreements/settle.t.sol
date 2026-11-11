// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Agreements_Unit_Shared } from "../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice `settle` over up to 64 open agreements with random ends and expiries (A2, the 64 bound).
contract Settle_Agreements_Unit_Fuzz_Test is Agreements_Unit_Shared {
    function testFuzz_FreesExactlyWhatIsDue(uint256 seed, uint8 count, uint32 wait) external {
        uint256 n = bound(count, 1, 64);
        uint64 t0 = _now();
        uint256[] memory ends = new uint256[](n);
        vm.startPrank(users.jordan);
        for (uint256 i; i < n; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            // One in three ends within 60 days; one in three is an offer left to lapse; the rest run on.
            uint64 endsAt = r % 3 == 0 ? t0 + uint64(bound(r >> 8, 1 days, 60 days)) : 0;
            uint64 expiry = endsAt == 0 ? t0 + uint64(bound(r >> 40, 1 hours, 30 days)) : t0 + 1 hours;
            address payee = address(uint160(0x5000 + i));
            uint256 id = agreements.offer(operations, payee, 300e6, MONTH, 0, endsAt, MONTHLY, expiry, TERMS);
            if (r % 3 != 1) {
                vm.stopPrank();
                vm.prank(payee);
                agreements.accept(id, TERMS);
                vm.startPrank(users.jordan);
                ends[i] = endsAt == 0 ? type(uint256).max : endsAt;
            } else {
                ends[i] = expiry; // an offer lapses at its expiry
            }
        }
        vm.stopPrank();
        vm.warp(t0 + bound(wait, 0, 90 days));
        uint256 live;
        for (uint256 i; i < n; ++i) {
            if (_now() < ends[i]) ++live;
        }
        vm.prank(users.eve);
        agreements.settle(operations);
        assertEq(agreements.openOf(operations).length, live, "only the live ones stay listed");
        uint256 committed;
        for (uint256 i = 1; i <= n; ++i) {
            if (!agreements.agreementOf(i).closed) committed += agreements.agreementOf(i).reserved;
        }
        assertEq(budgets.ownCommitted(operations), committed, "A2: committed is the open reservations");
        assertLe(committed, live * 3600e6, "no more than the live agreements' figures");
    }
}
