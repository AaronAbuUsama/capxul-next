// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { CompanySafeMinter } from "../../../../../src/companies-house/CompanySafeMinter.sol";
import { MockPersonalSafe } from "../../../../utils/CompaniesHouseClaimer/ClaimMocks.sol";
import { CompanySafeMinter_Test } from "../../../../utils/CompanySafeMinter/CompanySafeMinter_Test.sol";

contract Mint_CompanySafeMinter_Unit_Concrete_Test is CompanySafeMinter_Test {
    function test_WhenTheMinterIsCalledDirectlyAndNotByDelegatecall() external {
        // it should revert with NotDelegateCall
        vm.expectRevert(CompanySafeMinter.NotDelegateCall.selector);
        minter.mint(NAMESPACE, COMPANY, founder);
    }

    function test_WhenTheNamespaceIsEmpty() external {
        // it should revert with EmptyNamespace
        vm.expectRevert(CompanySafeMinter.EmptyNamespace.selector);
        _mint("", COMPANY, founder);
    }

    function test_WhenTheCompanyIsEmpty() external {
        // it should revert with EmptyCompany
        vm.expectRevert(CompanySafeMinter.EmptyCompany.selector);
        _mint(NAMESPACE, "", founder);
    }

    function test_WhenTheFoundersSafeIsTheZeroAddress() external {
        // it should revert with InvalidFounderSafe
        vm.expectRevert(CompanySafeMinter.InvalidFounderSafe.selector);
        _mint(NAMESPACE, COMPANY, address(0));
    }

    function test_WhenTheFoundersSafeIsTheOwnersSentinel() external {
        // it should revert with InvalidFounderSafe
        vm.expectRevert(CompanySafeMinter.InvalidFounderSafe.selector);
        _mint(NAMESPACE, COMPANY, SENTINEL_OWNERS);
    }

    function test_WhenTheFoundersSafeIsCompaniesHouse() external {
        // it should revert with InvalidFounderSafe
        vm.expectRevert(CompanySafeMinter.InvalidFounderSafe.selector);
        _mint(NAMESPACE, COMPANY, address(house));
    }

    function test_WhenTheFoundersSafeHasNoCode() external {
        // it should revert with InvalidFounderSafe
        vm.expectRevert(CompanySafeMinter.InvalidFounderSafe.selector);
        _mint(NAMESPACE, COMPANY, users.amira);
    }

    function test_WhenTheFactoryDeploysAtAnotherAddressThanTheDerivedOne() external {
        address elsewhere = makeAddr("elsewhere");
        factory.setLanding(elsewhere);

        // it should revert with DerivedAddressMismatch
        vm.expectRevert(abi.encodeWithSelector(CompanySafeMinter.DerivedAddressMismatch.selector, derived, elsewhere));
        _mint(NAMESPACE, COMPANY, founder);
    }

    function test_GivenTheDerivedSafeHasNoCode() external {
        assertEq(derived.code.length, 0, "no Safe before the mint");

        // it should swap Companies House for the founder's Safe through a v 1 approved signature
        vm.expectCall(
            derived,
            abi.encodeCall(
                MockPersonalSafe.execTransaction,
                (
                    derived,
                    0,
                    abi.encodeCall(MockPersonalSafe.swapOwner, (SENTINEL_OWNERS, address(house), founder)),
                    0,
                    0,
                    0,
                    0,
                    address(0),
                    payable(address(0)),
                    abi.encodePacked(uint256(uint160(address(house))), bytes32(0), uint8(1))
                )
            )
        );
        // it should emit CompanySafeMinted with deployed true
        vm.expectEmit(address(house));
        emit CompanySafeMinter.CompanySafeMinted(derived, founder, COMPANY, true);
        vm.record();
        address safe = _mint(NAMESPACE, COMPANY, founder);
        (, bytes32[] memory houseWrites) = vm.accesses(address(house));

        // it should deploy it through the Safe proxy factory with the Safe L2 singleton and no module
        // and the namespace and company and founder salt
        assertEq(factory.calls(), 1, "one deployment");
        assertEq(factory.lastSingleton(), SAFE_L2_SINGLETON, "Safe L2 1.4.1 singleton");
        assertEq(factory.lastInitializer(), _expectedInitializer(address(house)), "no module, fallback handler");
        assertEq(factory.lastSaltNonce(), uint256(keccak256(abi.encode(NAMESPACE, COMPANY, founder))));
        assertEq(MockPersonalSafe(derived).owner(), founder, "the founder's Safe is the sole owner");
        // it should write no storage of Companies House
        assertEq(houseWrites.length, 0, "a mint wrote Companies House storage");
        // it should return the Safe
        assertEq(safe, derived, "returns the derived Safe");
    }

    function test_GivenTheDerivedSafeIsAlreadyDeployed() external {
        _deployDerived();

        // it should emit CompanySafeMinted with deployed false
        vm.expectEmit(address(house));
        emit CompanySafeMinter.CompanySafeMinted(derived, founder, COMPANY, false);
        address safe = _mint(NAMESPACE, COMPANY, founder);

        // it should deploy nothing
        assertEq(factory.calls(), 0, "no deployment");
        // it should swap Companies House for the founder's Safe
        assertEq(MockPersonalSafe(derived).owner(), founder, "the founder's Safe is the sole owner");
        assertEq(safe, derived);
    }

    function test_GivenTheSafeWasAlreadyMinted() external {
        _mint(NAMESPACE, COMPANY, founder);

        // it should revert because Companies House is no longer an owner
        vm.expectRevert(abi.encodeWithSelector(MockPersonalSafe.NotOwnerSignature.selector, address(house)));
        _mint(NAMESPACE, COMPANY, founder);
        assertEq(MockPersonalSafe(derived).owner(), founder, "the founder's Safe keeps the company Safe");
    }

    function test_WhenTheSafeRefusesTheSwapWithoutReverting() external {
        _deployDerived();
        MockPersonalSafe(derived).setRefusesSwap(true);

        // it should revert with SwapRefused
        vm.expectRevert(CompanySafeMinter.SwapRefused.selector);
        _mint(NAMESPACE, COMPANY, founder);
    }
}
