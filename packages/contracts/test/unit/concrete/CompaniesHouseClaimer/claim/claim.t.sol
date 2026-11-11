// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { CompaniesHouseClaimer } from "../../../../../src/companies-house/CompaniesHouseClaimer.sol";
import { MockPersonalSafe } from "../../../../utils/CompaniesHouseClaimer/ClaimMocks.sol";
import { CompaniesHouseClaimer_Test } from "../../../../utils/CompaniesHouseClaimer/CompaniesHouseClaimer_Test.sol";

contract Claim_CompaniesHouseClaimer_Unit_Concrete_Test is CompaniesHouseClaimer_Test {
    function test_WhenTheClaimerIsCalledDirectlyAndNotByDelegatecall() external {
        // it should revert with NotDelegateCall
        vm.expectRevert(CompaniesHouseClaimer.NotDelegateCall.selector);
        claimer.claim(NAMESPACE, EMAIL, signer);
    }

    function test_WhenTheNamespaceIsEmpty() external {
        // it should revert with EmptyNamespace
        vm.expectRevert(CompaniesHouseClaimer.EmptyNamespace.selector);
        _claim("", EMAIL, signer);
    }

    function test_WhenTheEmailIsEmpty() external {
        // it should revert with EmailNotNormalized
        vm.expectRevert(CompaniesHouseClaimer.EmailNotNormalized.selector);
        _claim(NAMESPACE, "", signer);
    }

    function test_WhenTheEmailStartsWithASpaceOrAControlByte() external {
        // it should revert with EmailNotNormalized
        vm.expectRevert(CompaniesHouseClaimer.EmailNotNormalized.selector);
        _claim(NAMESPACE, " alice@example.com", signer);
        vm.expectRevert(CompaniesHouseClaimer.EmailNotNormalized.selector);
        _claim(NAMESPACE, "\talice@example.com", signer);
    }

    function test_WhenTheEmailEndsWithASpaceOrAControlByte() external {
        // it should revert with EmailNotNormalized
        vm.expectRevert(CompaniesHouseClaimer.EmailNotNormalized.selector);
        _claim(NAMESPACE, "alice@example.com ", signer);
        vm.expectRevert(CompaniesHouseClaimer.EmailNotNormalized.selector);
        _claim(NAMESPACE, "alice@example.com\n", signer);
    }

    function test_WhenTheEmailHasAnUpperCaseASCIILetter() external {
        // it should revert with EmailNotNormalized
        vm.expectRevert(CompaniesHouseClaimer.EmailNotNormalized.selector);
        _claim(NAMESPACE, "Alice@example.com", signer);
        // Both ends of the A to Z range.
        vm.expectRevert(CompaniesHouseClaimer.EmailNotNormalized.selector);
        _claim(NAMESPACE, "alice@exampleZ.com", signer);
    }

    function test_WhenTheEmailHasAByteThatIsNotASCII() external {
        // it should revert with EmailNotNormalized
        vm.expectRevert(CompaniesHouseClaimer.EmailNotNormalized.selector);
        _claim(NAMESPACE, unicode"aä@example.com", signer);
        // The lowest non-ASCII byte, 0x80, is the boundary.
        vm.expectRevert(CompaniesHouseClaimer.EmailNotNormalized.selector);
        _claim(NAMESPACE, string(abi.encodePacked("a", hex"80", "@example.com")), signer);
    }

    function test_WhenTheSignerIsTheZeroAddress() external {
        // it should revert with InvalidSigner
        vm.expectRevert(CompaniesHouseClaimer.InvalidSigner.selector);
        _claim(NAMESPACE, EMAIL, address(0));
    }

    function test_WhenTheSignerIsTheOwnersSentinel() external {
        // it should revert with InvalidSigner
        vm.expectRevert(CompaniesHouseClaimer.InvalidSigner.selector);
        _claim(NAMESPACE, EMAIL, SENTINEL_OWNERS);
    }

    function test_WhenTheSignerIsCompaniesHouse() external {
        // it should revert with InvalidSigner
        vm.expectRevert(CompaniesHouseClaimer.InvalidSigner.selector);
        _claim(NAMESPACE, EMAIL, address(house));
    }

    function test_WhenTheFactoryDeploysAtAnotherAddressThanTheDerivedOne() external {
        address elsewhere = makeAddr("elsewhere");
        factory.setLanding(elsewhere);

        // it should revert with DerivedAddressMismatch
        vm.expectRevert(
            abi.encodeWithSelector(CompaniesHouseClaimer.DerivedAddressMismatch.selector, derived, elsewhere)
        );
        _claim(NAMESPACE, EMAIL, signer);
    }

    function test_GivenTheDerivedSafeHasNoCode() external {
        assertEq(derived.code.length, 0, "no Safe before the claim");

        // it should swap Companies House for the signer through a v 1 approved signature
        vm.expectCall(
            derived,
            abi.encodeCall(
                MockPersonalSafe.execTransaction,
                (
                    derived,
                    0,
                    abi.encodeCall(MockPersonalSafe.swapOwner, (SENTINEL_OWNERS, address(house), signer)),
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
        // it should emit CapxulSafeClaimed with deployed true
        vm.expectEmit(address(house));
        emit CompaniesHouseClaimer.CapxulSafeClaimed(derived, signer, true);
        vm.record();
        address safe = _claim(NAMESPACE, EMAIL, signer);
        (, bytes32[] memory houseWrites) = vm.accesses(address(house));

        // it should deploy it through the Safe proxy factory with the Safe L2 singleton and the 4337 module setup
        // and the namespace and email salt
        assertEq(factory.calls(), 1, "one deployment");
        assertEq(factory.lastSingleton(), SAFE_L2_SINGLETON, "Safe L2 1.4.1 singleton");
        assertEq(factory.lastInitializer(), _expectedInitializer(address(house)), "4337 module setup");
        assertEq(factory.lastSaltNonce(), uint256(keccak256(bytes("capxul:devnet:email:v1:alice@example.com"))));
        assertEq(MockPersonalSafe(derived).owner(), signer, "the signer is the sole owner");
        // it should write no storage of Companies House
        assertEq(houseWrites.length, 0, "a claim wrote Companies House storage");
        // it should return the Safe
        assertEq(safe, derived, "returns the derived Safe");
    }

    function test_GivenTheDerivedSafeIsAlreadyDeployed() external {
        _deployDerived();

        // it should emit CapxulSafeClaimed with deployed false
        vm.expectEmit(address(house));
        emit CompaniesHouseClaimer.CapxulSafeClaimed(derived, signer, false);
        address safe = _claim(NAMESPACE, EMAIL, signer);

        // it should deploy nothing
        assertEq(factory.calls(), 0, "no deployment");
        // it should swap Companies House for the signer
        assertEq(MockPersonalSafe(derived).owner(), signer, "the signer is the sole owner");
        assertEq(safe, derived);
    }

    function test_GivenTheSafeWasAlreadyClaimed() external {
        _claim(NAMESPACE, EMAIL, signer);

        // it should revert because Companies House is no longer an owner
        vm.expectRevert(abi.encodeWithSelector(MockPersonalSafe.NotOwnerSignature.selector, address(house)));
        _claim(NAMESPACE, EMAIL, makeAddr("thief"));
        assertEq(MockPersonalSafe(derived).owner(), signer, "the first signer keeps the Safe");
    }

    function test_WhenTheSafeRefusesTheSwapWithoutReverting() external {
        _deployDerived();
        MockPersonalSafe(derived).setRefusesSwap(true);

        // it should revert with SwapRefused
        vm.expectRevert(CompaniesHouseClaimer.SwapRefused.selector);
        _claim(NAMESPACE, EMAIL, signer);
    }
}
