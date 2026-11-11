// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../utils/Captable/Captable_Test.sol";

/// @dev E1 at the edge: authorised never below issued plus reserve, in the class and in its target.
/// Ports Firm `Captable.t.sol:559-605` (the convertible limit when authorised changes).
contract SetAuthorised_Captable_Unit_Fuzz_Test is Captable_Test {
    function testFuzz_SetAuthorised_NeverBelowIssuedPlusReserve(uint128 issued, uint128 amount) external {
        issued = uint128(bound(issued, 0, COMMON_AUTHORISED - SERIES_A_RESERVE));
        amount = uint128(bound(amount, 1, 2 ** 100));
        if (issued > 0) _issue(COMMON, users.amira, issued);

        vm.prank(address(governor));
        if (amount < issued + SERIES_A_RESERVE) {
            vm.expectPartialRevert(ICaptable.AuthorisedExceeded.selector);
            captable.setAuthorised(COMMON, amount);
        } else {
            captable.setAuthorised(COMMON, amount);
            assertEq(captable.getClass(COMMON).authorised, amount, "set");
        }
    }

    function testFuzz_SetAuthorised_SourceMovesTargetReserve(uint128 amount, uint128 commonIssued) external {
        commonIssued = uint128(bound(commonIssued, 0, COMMON_AUTHORISED - SERIES_A_RESERVE));
        amount = uint128(bound(amount, 1, 2 ** 100));
        if (commonIssued > 0) _issue(COMMON, users.amira, commonIssued);

        vm.prank(address(governor));
        if (commonIssued + uint256(amount) * 2 > COMMON_AUTHORISED) {
            vm.expectPartialRevert(ICaptable.AuthorisedExceeded.selector);
            captable.setAuthorised(SERIES_A, amount);
        } else {
            captable.setAuthorised(SERIES_A, amount);
            assertEq(captable.convertibleReserved(COMMON), uint256(amount) * 2, "reserve moved");
        }
    }
}
