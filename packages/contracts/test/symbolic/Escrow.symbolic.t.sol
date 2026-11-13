// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { Escrow } from "../../src/money/Escrow.sol";
import { IEscrow } from "../../src/interfaces/IEscrow.sol";

import { AuthorityMock } from "../utils/Escrow/AuthorityMock.sol";
import { OwnerSafeMock } from "../utils/Escrow/OwnerSafeMock.sol";
import { Payments } from "../../src/money/Payments.sol";

/// @notice Halmos checks for the general Escrow (gate 10). They prove both fail-closed reads for every answer at
/// once. G5 (D11): the owner-collects condition is met exactly when the owner answers `isOwner(bootstrapOwner)`
/// with the 32-byte word 0; a revert, a short or long answer, or any other word reads as "cannot act yet". G6: a
/// caller other than the sender may refund exactly when the authority answers `authorised(key, caller)` with the
/// 32-byte word 1.
/// Halmos 0.3.3 needs Foundry's dynamic test linking off (`FOUNDRY_DYNAMIC_TEST_LINKING=false`): with it on,
/// `new Escrow` in a test compiles to `vm.deployCode`, which Halmos does not support.
contract Escrow_Symbolic is Test {
    address internal constant COMPANIES_HOUSE = address(0xC0FFEE);
    address internal constant ALICE = address(0xA11CE);
    address internal constant SENDER = address(0xB0A4D);
    uint256 internal constant KEY = 7;

    Payments internal payments;

    function setUp() public {
        payments = new Payments();
    }

    function check_G5_ownerCanActFailsClosed(uint8 mode, uint256 word, bool listsCompaniesHouse) public {
        vm.assume(mode <= uint8(OwnerSafeMock.Answer.Word));
        address[] memory owners = new address[](1);
        owners[0] = listsCompaniesHouse ? COMPANIES_HOUSE : ALICE;
        OwnerSafeMock owner = new OwnerSafeMock(owners);
        owner.setAnswer(OwnerSafeMock.Answer(mode), word);
        IEscrow escrow = IEscrow(address(new Escrow(_terms(address(owner), address(0)), address(payments))));

        bool expected;
        if (mode == uint8(OwnerSafeMock.Answer.Owners)) expected = !listsCompaniesHouse;
        else if (mode == uint8(OwnerSafeMock.Answer.Word)) expected = word == 0;

        // Vacuity guard (fv/halmos.md): a revert is a counterexample, so the reverting stub fails.
        try escrow.conditionMet() returns (bool met) {
            assert(met == expected);
        } catch {
            assert(false);
        }
    }

    function check_G6_authorityFailsClosed(uint8 mode, uint256 word, bool admitted, address caller) public {
        vm.assume(mode <= uint8(AuthorityMock.Answer.Word));
        vm.assume(caller != SENDER);
        AuthorityMock authority = new AuthorityMock();
        if (admitted) authority.admit(KEY, caller);
        authority.setAnswer(AuthorityMock.Answer(mode), word);
        IEscrow escrow = IEscrow(address(new Escrow(_terms(ALICE, address(authority)), address(payments))));

        bool expected;
        if (mode == uint8(AuthorityMock.Answer.Honest)) expected = admitted;
        else if (mode == uint8(AuthorityMock.Answer.Word)) expected = word == 1;

        try escrow.canRefund(caller) returns (bool may) {
            assert(may == expected);
        } catch {
            assert(false);
        }
    }

    function _terms(address owner, address authority) internal pure returns (IEscrow.Terms memory) {
        return IEscrow.Terms({
            owner: owner,
            sender: SENDER,
            authority: authority,
            authorityKey: KEY,
            bootstrapOwner: COMPANIES_HOUSE,
            token: address(0x70CE),
            amount: 1,
            jobNonce: bytes32(uint256(1)),
            kind: 1,
            documentHash: bytes32(uint256(2)),
            condition: 1,
            ownerTakesSurplus: false
        });
    }
}
