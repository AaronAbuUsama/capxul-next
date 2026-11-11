// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";

/// @dev C-1 and N-6 (I3). Ports Firm `Captable.t.sol:59-79` (initial state, cannot re-initialise).
contract Initialize_Captable_Unit_Concrete_Test is Captable_Test {
    ICaptable internal fresh;

    function setUp() public override {
        super.setUp();
        fresh = ICaptable(Clones.clone(address(captableImpl)));
    }

    function test_WhenItIsTheImplementation() external {
        // it should revert with the initializer error
        vm.expectRevert(ICaptable.AlreadyInitialized.selector);
        captableImpl.initialize(COMPANY, _wiring(), _templateClasses());
    }

    function test_WhenItWasAlreadyInitialized() external {
        assertEq(captable.safe(), address(safe), "initialised in setUp");

        // it should revert with AlreadyInitialized
        vm.expectRevert(ICaptable.AlreadyInitialized.selector);
        captable.initialize(COMPANY, _wiring(), _templateClasses());

        vm.prank(users.eve);
        vm.expectRevert(ICaptable.AlreadyInitialized.selector);
        captable.initialize("Eve Corp", _wiring(), new ICaptable.ClassParams[](0));
    }

    modifier whenItIsAFreshClone() {
        _;
    }

    function test_WhenAnyWiringAddressIsZero() external whenItIsAFreshClone {
        // it should revert with InvalidClass
        for (uint256 i; i < 7; ++i) {
            ICaptable.Wiring memory w = _wiring();
            if (i == 0) w.safe = address(0);
            if (i == 1) w.governor = address(0);
            if (i == 2) w.vesting = address(0);
            if (i == 3) w.options = address(0);
            if (i == 4) w.rounds = address(0);
            if (i == 5) w.exits = address(0);
            if (i == 6) w.shareClassImpl = address(0);
            vm.expectPartialRevert(ICaptable.InvalidClass.selector);
            fresh.initialize(COMPANY, w, _templateClasses());
        }
    }

    modifier whenEveryAddressIsSet() {
        _;
    }

    function test_WhenEveryAddressIsSet() external whenItIsAFreshClone whenEveryAddressIsSet {
        fresh.initialize("Beta", _wiring(), _templateClasses());

        // it should store the Safe and the Governor and every module address
        assertEq(fresh.name(), "Beta", "company name");
        assertEq(fresh.safe(), address(safe), "safe");
        assertEq(fresh.governor(), address(governor), "governor");
        assertEq(fresh.vesting(), address(vesting), "vesting");
        assertEq(fresh.options(), options, "options");
        assertEq(fresh.rounds(), rounds, "rounds");
        assertEq(fresh.exits(), exits, "exits");
        assertEq(fresh.shareClassImpl(), address(shareClassImpl), "share class implementation");

        // it should create the template's initial classes with the same checks as createClass
        assertEq(fresh.numberOfClasses(), 2, "two classes");
        assertEq(fresh.getClass(COMMON).authorised, COMMON_AUTHORISED, "Common");
        assertEq(fresh.getClass(SERIES_A).convertsInto, COMMON, "Series A converts into Common");
        assertEq(fresh.convertibleReserved(COMMON), SERIES_A_RESERVE, "reserve");
        assertEq(fresh.conversionPriceAt(SERIES_A, vm.getBlockTimestamp()), SERIES_A_OIP, "first conversion price");

        ICaptable.ClassParams[] memory bad = _templateClasses();
        bad[0].authorised = 8_000_001; // Common
        bad[1].authorised = 4_000_001; // Series A reserves 8,000,002 of it
        ICaptable other = ICaptable(Clones.clone(address(captableImpl)));
        vm.expectPartialRevert(ICaptable.AuthorisedExceeded.selector);
        other.initialize(COMPANY, _wiring(), bad);

        bad = _templateClasses();
        bad[0].authorised = 0;
        vm.expectPartialRevert(ICaptable.InvalidClass.selector);
        other.initialize(COMPANY, _wiring(), bad);

        ICaptable.ClassParams[] memory tooMany = new ICaptable.ClassParams[](MAX_CLASSES + 1);
        for (uint256 i; i < tooMany.length; ++i) {
            tooMany[i] = _params(1, 1, 0, 0);
        }
        vm.expectRevert(ICaptable.TooManyClasses.selector);
        other.initialize(COMPANY, _wiring(), tooMany);
    }

    function test_GivenNoInitialClassesAreGiven() external whenItIsAFreshClone whenEveryAddressIsSet {
        fresh.initialize(COMPANY, _wiring(), new ICaptable.ClassParams[](0));

        // it should start with no classes
        assertEq(fresh.numberOfClasses(), 0, "no classes");
        vm.expectRevert(abi.encodeWithSelector(ICaptable.UnknownClass.selector, uint8(0)));
        fresh.getClass(0);
    }

    function test_ItShouldLeaveOnlyTheGovernorAbleToCreateClassesAfterwards()
        external
        whenItIsAFreshClone
        whenEveryAddressIsSet
    {
        // it should leave only the Governor able to create classes afterwards
        vm.prank(address(safe));
        vm.expectRevert(ICaptable.OnlyGovernor.selector);
        captable.createClass(_params(1, 1000, 0, 0));

        uint8 id = _createClass(_params(1, 1000, 0, 0));
        assertEq(id, 2, "the Governor creates the third class");
    }
}
