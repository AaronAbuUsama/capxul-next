// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";

/// @dev N-5 (E10): convert burns the source, lowers the source's authorised, and mints amount x oip / cp
/// rounded down in the target. Ports Firm `Captable.t.sol:408-421,539-551`.
contract Convert_Captable_Unit_Concrete_Test is Captable_Test {
    function setUp() public override {
        super.setUp();
        try this.issueInvestor() { } catch { } // red stub: each test fails on its own call
    }

    function issueInvestor() external {
        _issue(SERIES_A, users.investor, 100);
    }

    function test_WhenTheClassDoesNotExist() external {
        // it should revert with UnknownClass
        vm.prank(users.investor);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.UnknownClass.selector, uint8(2)));
        captable.convert(2, 10);
    }

    function test_WhenTheClassConvertsIntoNothing() external {
        _issue(COMMON, users.amira, 100);

        // it should revert with NotConvertible
        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.NotConvertible.selector, COMMON));
        captable.convert(COMMON, 10);
    }

    function test_WhenTheCallersUnlockedSharesAreFewerThanTheAmount() external {
        _lock(SERIES_A, users.investor, 60); // 40 unlocked

        // it should revert with SharesLocked
        vm.prank(users.investor);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.SharesLocked.selector, users.investor, uint128(60)));
        captable.convert(SERIES_A, 41);

        // More than the balance is the same clean refusal, never a panic.
        vm.prank(users.investor);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.SharesLocked.selector, users.investor, uint128(60)));
        captable.convert(SERIES_A, 101);
    }

    modifier whenTheCallerConvertsUnlockedShares() {
        _;
    }

    function test_WhenTheCallerConvertsUnlockedShares() external whenTheCallerConvertsUnlockedShares {
        _lowerPrice(SERIES_A, 1.5e6); // ratio 2 / 1.5
        uint256 reserveBefore = captable.convertibleReserved(COMMON);

        // it should emit Converted
        vm.expectEmit(address(captable));
        emit ICaptable.Converted(users.investor, SERIES_A, COMMON, 40, 53);
        vm.prank(users.investor);
        captable.convert(SERIES_A, 40);

        // it should burn the amount of the source class
        assertEq(_token(SERIES_A).balanceOf(users.investor), 60, "source burned");
        assertEq(_token(SERIES_A).totalSupply(), 60, "source supply");

        // it should lower the source class's authorised by the amount
        assertEq(captable.getClass(SERIES_A).authorised, SERIES_A_AUTHORISED - 40, "source authorised lowered");

        // it should mint the amount times the issue price over the current conversion price rounded down in the target class
        // 40 * 2.00 / 1.50 = 53.33 -> 53
        assertEq(_token(COMMON).balanceOf(users.investor), 53, "minted, rounded down");

        // it should keep issued plus convertible reserve within authorised in both classes
        // The reserve falls by ceil(1,000,000 * 2) - ceil(999,960 * 2) = 80.
        assertEq(captable.convertibleReserved(COMMON), reserveBefore - 80, "reserve released");
        ICaptable.Class memory source = captable.getClass(SERIES_A);
        ICaptable.Class memory target = captable.getClass(COMMON);
        assertLe(_token(SERIES_A).totalSupply() + captable.convertibleReserved(SERIES_A), source.authorised, "E1 src");
        assertLe(_token(COMMON).totalSupply() + captable.convertibleReserved(COMMON), target.authorised, "E1 target");
    }

    function test_GivenTheSourceClassIsFrozen() external whenTheCallerConvertsUnlockedShares {
        _freeze(SERIES_A);

        // it should still convert and lower the frozen class's authorised
        vm.prank(users.investor);
        captable.convert(SERIES_A, 25);
        assertEq(_token(SERIES_A).balanceOf(users.investor), 75, "converted");
        assertEq(_token(COMMON).balanceOf(users.investor), 25, "ratio 1 at the issue price");
        assertEq(captable.getClass(SERIES_A).authorised, SERIES_A_AUTHORISED - 25, "frozen authorised lowered");
        assertTrue(captable.getClass(SERIES_A).frozen, "still frozen");
    }

    function test_GivenAProposalIsPendingInTheTargetClass() external whenTheCallerConvertsUnlockedShares {
        governor.setPendingUntil(uint48(vm.getBlockTimestamp() + 3 days));
        vm.prank(address(governor));
        captable.setClassGovernor(COMMON, address(classGovernor));
        classGovernor.setPendingUntil(uint48(vm.getBlockTimestamp() + 3 days));

        // it should still convert
        vm.prank(users.investor);
        captable.convert(SERIES_A, 10);
        assertEq(_token(COMMON).balanceOf(users.investor), 10, "converted while pending");
    }
}
