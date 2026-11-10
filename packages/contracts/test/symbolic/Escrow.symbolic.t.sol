// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { Escrow } from "../../src/money/Escrow.sol";
import { IEscrow } from "../../src/interfaces/IEscrow.sol";

import { PayeeSafeMock } from "../utils/Escrow/PayeeSafeMock.sol";
import { Payments } from "../../src/money/Payments.sol";

/// @notice Halmos checks for Escrow (gate 10). fv/halmos.md lists no Escrow row; this proves D11's
/// fail-closed read (invariant S8) for every `isOwner` answer at once: the claim condition is met exactly
/// when the payee answers with the 32-byte word 0, and a revert, a short or long answer, or any other word
/// reads as "not claimed".
/// Halmos 0.3.3 needs Foundry's dynamic test linking off (`FOUNDRY_DYNAMIC_TEST_LINKING=false`): with it on,
/// `new Escrow` in a test compiles to `vm.deployCode`, which Halmos does not support.
contract Escrow_Symbolic is Test {
    address internal constant COMPANIES_HOUSE = address(0xC0FFEE);
    address internal constant ALICE = address(0xA11CE);

    Payments internal payments;

    function setUp() public {
        payments = new Payments();
    }

    function check_S8_claimConditionFailsClosed(uint8 mode, uint256 word, bool listsCompaniesHouse) public {
        vm.assume(mode <= uint8(PayeeSafeMock.Answer.Word));
        address[] memory owners = new address[](1);
        owners[0] = listsCompaniesHouse ? COMPANIES_HOUSE : ALICE;
        PayeeSafeMock payee = new PayeeSafeMock(owners);
        payee.setAnswer(PayeeSafeMock.Answer(mode), word);
        IEscrow.Terms memory terms = IEscrow.Terms({
            ownerSafe: address(0xB0A4D),
            payeeSafe: address(payee),
            token: address(0x70CE),
            amount: 1,
            jobNonce: bytes32(uint256(1)),
            kind: 1,
            documentHash: bytes32(uint256(2)),
            condition: 1
        });
        IEscrow escrow = IEscrow(address(new Escrow(terms, address(payments), COMPANIES_HOUSE)));

        bool expected;
        if (mode == uint8(PayeeSafeMock.Answer.Owners)) expected = !listsCompaniesHouse;
        else if (mode == uint8(PayeeSafeMock.Answer.Word)) expected = word == 0;

        // Vacuity guard (fv/halmos.md): a revert is a counterexample, so the reverting stub fails.
        try escrow.conditionMet() returns (bool met) {
            assert(met == expected);
        } catch {
            assert(false);
        }
    }
}
