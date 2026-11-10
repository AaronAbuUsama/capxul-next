// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";

contract SetAuthorised_Captable_Unit_Concrete_Test is Captable_Test {
    function test_WhenTheCallerIsNotTheCompanyGovernor() external {
        // it should revert with OnlyGovernor
        vm.prank(address(safe));
        vm.expectRevert(ICaptable.OnlyGovernor.selector);
        captable.setAuthorised(COMMON, 20_000_000);

        vm.prank(users.eve);
        vm.expectRevert(ICaptable.OnlyGovernor.selector);
        captable.setAuthorised(COMMON, 20_000_000);
    }

    function test_WhenTheClassDoesNotExist() external {
        // it should revert with UnknownClass
        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.UnknownClass.selector, uint8(7)));
        captable.setAuthorised(7, 1000);
    }

    function test_WhenTheClassIsFrozen() external {
        _freeze(COMMON);

        // it should revert with FrozenClass
        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.FrozenClass.selector, COMMON));
        captable.setAuthorised(COMMON, 20_000_000);
    }

    function test_WhenTheNewAmountIsBelowIssuedPlusConvertibleReserve() external {
        _issue(COMMON, users.amira, 5_000_000);

        // it should revert with AuthorisedExceeded
        // 5,000,000 issued + 2,000,000 reserved for Series A = 7,000,000 needed.
        vm.prank(address(governor));
        vm.expectPartialRevert(ICaptable.AuthorisedExceeded.selector);
        captable.setAuthorised(COMMON, 6_999_999);

        // Exactly issued plus reserve is allowed.
        vm.prank(address(governor));
        captable.setAuthorised(COMMON, 7_000_000);
        assertEq(captable.getClass(COMMON).authorised, 7_000_000, "lowered to issued plus reserve");
    }

    function test_WhenTheNewAmountWouldTakeTheClassOverTheVoteBound() external {
        // weight 2^15, ratio 2^58: the bound allows at most 2^127 authorised.
        uint8 id = _createClass(_params(2 ** 15, 2 ** 100, 2 ** 58, 1));

        // it should revert with VotesBoundExceeded
        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.VotesBoundExceeded.selector, id));
        captable.setAuthorised(id, 2 ** 127 + 1);

        vm.prank(address(governor));
        captable.setAuthorised(id, 2 ** 127);
        assertEq(captable.getClass(id).authorised, 2 ** 127, "exactly at the bound");
    }

    function test_WhenTheClassConvertsIntoAnotherAndTheTargetsReserveWouldBreakItsAuthorised() external {
        // Series A at 5,000,001 reserves 10,000,002 in Common, which authorises 10,000,000.
        // it should revert with AuthorisedExceeded
        vm.prank(address(governor));
        vm.expectPartialRevert(ICaptable.AuthorisedExceeded.selector);
        captable.setAuthorised(SERIES_A, 5_000_001);

        // 5,000,000 reserves exactly 10,000,000.
        vm.prank(address(governor));
        captable.setAuthorised(SERIES_A, 5_000_000);
        assertEq(captable.convertibleReserved(COMMON), 10_000_000, "target exactly full");
    }

    modifier whenTheNewAmountFits() {
        _;
    }

    function test_WhenTheNewAmountFits() external whenTheNewAmountFits {
        // it should emit AuthorisedSet
        vm.expectEmit(address(captable));
        emit ICaptable.AuthorisedSet(COMMON, 12_000_000);
        vm.prank(address(governor));
        captable.setAuthorised(COMMON, 12_000_000);

        // it should set the authorised amount
        assertEq(captable.getClass(COMMON).authorised, 12_000_000, "authorised set");
    }

    function test_GivenTheClassConvertsIntoAnother() external whenTheNewAmountFits {
        // it should move the target's convertible reserve with it
        vm.prank(address(governor));
        captable.setAuthorised(SERIES_A, 1_500_000);
        assertEq(captable.convertibleReserved(COMMON), 3_000_000, "reserve rises with the source");

        vm.prank(address(governor));
        captable.setAuthorised(SERIES_A, 250_000);
        assertEq(captable.convertibleReserved(COMMON), 500_000, "reserve falls with the source");
    }
}
