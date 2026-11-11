// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";
import { MockShareClass } from "../../../../utils/Captable/CaptableMocks.sol";

contract CreateClass_Captable_Unit_Concrete_Test is Captable_Test {
    modifier whenTheCallerIsNotTheCompanyGovernor() {
        _;
    }

    function test_GivenTheCallerIsTheSafe() external whenTheCallerIsNotTheCompanyGovernor {
        // it should revert with OnlyGovernor
        vm.prank(address(safe));
        vm.expectRevert(ICaptable.OnlyGovernor.selector);
        captable.createClass(_params(1, 1000, 0, 0));
    }

    function test_GivenTheCallerIsAnyoneElse() external whenTheCallerIsNotTheCompanyGovernor {
        // it should revert with OnlyGovernor
        vm.prank(users.eve);
        vm.expectRevert(ICaptable.OnlyGovernor.selector);
        captable.createClass(_params(1, 1000, 0, 0));
    }

    modifier whenTheCallerIsTheCompanyGovernor() {
        _;
    }

    function test_WhenTheCompanyAlreadyHas32Classes() external whenTheCallerIsTheCompanyGovernor {
        _fillClassesTo(MAX_CLASSES);
        assertEq(captable.numberOfClasses(), MAX_CLASSES, "32 classes");

        // it should revert with TooManyClasses
        vm.prank(address(governor));
        vm.expectRevert(ICaptable.TooManyClasses.selector);
        captable.createClass(_params(1, 1000, 0, 0));
    }

    function test_GivenTheCompanyHas31Classes() external whenTheCallerIsTheCompanyGovernor {
        _fillClassesTo(MAX_CLASSES - 1);

        // it should create the 32nd class
        uint8 id = _createClass(_params(1, 1000, 0, 0));
        assertEq(id, MAX_CLASSES - 1, "the 32nd class has id 31");
        assertEq(captable.numberOfClasses(), MAX_CLASSES, "32 classes");
    }

    function test_WhenTheAuthorisedAmountIs0() external whenTheCallerIsTheCompanyGovernor {
        // it should revert with InvalidClass
        vm.prank(address(governor));
        vm.expectPartialRevert(ICaptable.InvalidClass.selector);
        captable.createClass(_params(1, 0, 0, 0));
    }

    function test_WhenConvertsIntoNamesAMissingClassOrTheClassItself() external whenTheCallerIsTheCompanyGovernor {
        ICaptable.ClassParams memory p = _params(1, 1000, 1e6, 1e6);

        // it should revert with InvalidClass
        p.convertsInto = 5; // missing
        vm.prank(address(governor));
        vm.expectPartialRevert(ICaptable.InvalidClass.selector);
        captable.createClass(p);

        p.convertsInto = 2; // the id the new class would take
        vm.prank(address(governor));
        vm.expectPartialRevert(ICaptable.InvalidClass.selector);
        captable.createClass(p);
    }

    function test_WhenAClassWithNoIssuePriceHasAPreference() external whenTheCallerIsTheCompanyGovernor {
        ICaptable.ClassParams memory p = _params(1, 1000, 0, 0);
        p.preferenceMultipleBps = 10_000;

        // it should revert with InvalidClass
        vm.prank(address(governor));
        vm.expectPartialRevert(ICaptable.InvalidClass.selector);
        captable.createClass(p);
    }

    function test_WhenAPricedClassHasAFloorOf0OrAboveItsIssuePrice() external whenTheCallerIsTheCompanyGovernor {
        // it should revert with InvalidClass
        vm.prank(address(governor));
        vm.expectPartialRevert(ICaptable.InvalidClass.selector);
        captable.createClass(_params(1, 1000, 1e6, 0));

        vm.prank(address(governor));
        vm.expectPartialRevert(ICaptable.InvalidClass.selector);
        captable.createClass(_params(1, 1000, 1e6, 1e6 + 1));
    }

    function test_WhenTheRuleIsCustomAndTheRuleContractIsTheZeroAddress() external whenTheCallerIsTheCompanyGovernor {
        ICaptable.ClassParams memory p = _params(1, 1000, 0, 0);
        p.rule = ICaptable.TransferRule.Custom;
        p.customRule = address(0);

        // it should revert with InvalidClass
        vm.prank(address(governor));
        vm.expectPartialRevert(ICaptable.InvalidClass.selector);
        captable.createClass(p);
    }

    function test_WhenWeightTimesAuthorisedTimesTheHighestRatioIsAboveTheVoteBound()
        external
        whenTheCallerIsTheCompanyGovernor
    {
        // 2^15 * 2^127 * (2^58 + 1) / 1 > 2^200; the same with a ratio of exactly 2^58 is at the bound.
        ICaptable.ClassParams memory over = _params(2 ** 15, 2 ** 127, 2 ** 58 + 1, 1);

        // it should revert with VotesBoundExceeded
        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.VotesBoundExceeded.selector, uint8(2)));
        captable.createClass(over);

        uint8 atBound = _createClass(_params(2 ** 15, 2 ** 127, 2 ** 58, 1));
        assertEq(atBound, 2, "exactly at the bound is allowed");
    }

    function test_WhenTheAuthorisedAmountWouldBreakTheTargetClasssReserve() external whenTheCallerIsTheCompanyGovernor {
        // Common has 10,000,000 authorised and 2,000,000 reserved for Series A: 8,000,000 left. A class
        // of 4,000,001 shares at 2x its floor reserves 8,000,002.
        ICaptable.ClassParams memory p = _params(1, 4_000_001, 2e6, 1e6);
        p.convertsInto = COMMON;

        // it should revert with AuthorisedExceeded
        vm.prank(address(governor));
        vm.expectPartialRevert(ICaptable.AuthorisedExceeded.selector);
        captable.createClass(p);
    }

    modifier whenTheClassIsValid() {
        _;
    }

    function _seriesB() internal pure returns (ICaptable.ClassParams memory p) {
        p = ICaptable.ClassParams({
            name: "Series B",
            ticker: "ACME-B",
            weight: 3,
            convertsInto: COMMON,
            rule: ICaptable.TransferRule.ToClassShareholders,
            customRule: address(0),
            authorised: 3,
            originalIssuePrice: 1e6,
            conversionFloorPrice: 7e5,
            preferenceMultipleBps: 15_000,
            participating: true,
            seniority: 0,
            termsHash: keccak256("series b terms")
        });
    }

    function test_WhenTheClassIsValid() external whenTheCallerIsTheCompanyGovernor whenTheClassIsValid {
        ICaptable.ClassParams memory p = _seriesB();

        // it should emit ClassCreated
        vm.expectEmit(true, false, false, true, address(captable));
        emit ICaptable.ClassCreated(2, address(0), p);
        uint8 id = _createClass(p);

        // it should return the next class id
        assertEq(id, 2, "next id");
        assertEq(captable.numberOfClasses(), 3, "three classes");

        // it should deploy a ShareClass clone with the name and ticker
        ICaptable.Class memory c = captable.getClass(id);
        MockShareClass token = MockShareClass(address(c.token));
        assertGt(address(token).code.length, 0, "token deployed");
        assertNotEq(address(token), address(shareClassImpl), "a clone, not the implementation");
        assertEq(token.name(), "Acme Series B", "name");
        assertEq(token.symbol(), "ACME-B", "ticker");
        assertEq(token.captable(), address(captable), "owned by the Captable");
        assertEq(token.classId(), id, "class id");

        // it should store the weight and terms and transfer rule
        assertEq(c.weight, 3, "weight");
        assertEq(c.convertsInto, COMMON, "convertsInto");
        assertEq(uint8(c.rule), uint8(ICaptable.TransferRule.ToClassShareholders), "rule");
        assertEq(c.customRule, address(0), "customRule");
        assertEq(c.classGovernor, address(0), "no class Governor");
        assertFalse(c.frozen, "not frozen");
        assertEq(c.authorised, 3, "authorised");
        assertEq(c.originalIssuePrice, 1e6, "oip");
        assertEq(c.conversionFloorPrice, 7e5, "floor");
        assertEq(c.preferenceMultipleBps, 15_000, "preference");
        assertTrue(c.participating, "participating");
        assertEq(c.seniority, 0, "seniority");
        assertEq(c.termsHash, keccak256("series b terms"), "terms hash");

        // it should set the first conversion price to the original issue price
        assertEq(captable.conversionPriceAt(id, vm.getBlockTimestamp()), 1e6, "first conversion price");
    }

    function test_GivenTheClassConvertsIntoAnother() external whenTheCallerIsTheCompanyGovernor whenTheClassIsValid {
        _createClass(_seriesB());

        // it should add its reserve rounded up to the target's convertible reserve
        // ceil(3 * 1.00 / 0.70) = ceil(4.28...) = 5
        assertEq(captable.convertibleReserved(COMMON), SERIES_A_RESERVE + 5, "reserve rounded up");
    }

    function test_GivenTheConvertibleClassHasNoIssuePrice()
        external
        whenTheCallerIsTheCompanyGovernor
        whenTheClassIsValid
    {
        // it should reserve one target share per authorised share
        ICaptable.ClassParams memory p = _params(1, 1000, 0, 0);
        p.convertsInto = COMMON;
        _createClass(p);
        assertEq(captable.convertibleReserved(COMMON), SERIES_A_RESERVE + 1000, "one-for-one reserve");
    }
}
