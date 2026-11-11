// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Captable_Test } from "../../../utils/Captable/Captable_Test.sol";

/// @dev N-5 (E10): any amount at any conversion price mints floor(amount * oip / cp), lowers the source's
/// authorised by the amount, and keeps E1 in both classes.
contract Convert_Captable_Unit_Fuzz_Test is Captable_Test {
    function testFuzz_Convert_MintsFloorAndKeepsE1(uint128 held, uint128 amount, uint128 cp) external {
        held = uint128(bound(held, 1, SERIES_A_AUTHORISED));
        amount = uint128(bound(amount, 1, held));
        cp = uint128(bound(cp, SERIES_A_FLOOR, SERIES_A_OIP));
        _issue(SERIES_A, users.investor, held);
        _issue(COMMON, users.amira, uint128(COMMON_AUTHORISED - SERIES_A_RESERVE)); // Common full
        if (cp < SERIES_A_OIP) _lowerPrice(SERIES_A, cp);

        vm.prank(users.investor);
        captable.convert(SERIES_A, amount);

        assertEq(_token(SERIES_A).balanceOf(users.investor), held - amount, "burned");
        assertEq(captable.getClass(SERIES_A).authorised, SERIES_A_AUTHORISED - amount, "source authorised lowered");
        assertEq(_token(COMMON).balanceOf(users.investor), uint256(amount) * SERIES_A_OIP / cp, "minted, floor");
        assertLe(
            _token(SERIES_A).totalSupply() + captable.convertibleReserved(SERIES_A),
            captable.getClass(SERIES_A).authorised,
            "E1 source"
        );
        assertLe(
            _token(COMMON).totalSupply() + captable.convertibleReserved(COMMON),
            captable.getClass(COMMON).authorised,
            "E1 target"
        );
    }
}
