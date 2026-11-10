// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { IRounds } from "../../../../../src/interfaces/IRounds.sol";
import { Vm } from "forge-std/Vm.sol";
import { Rounds_Shared_Test } from "../../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev spec/rounds.md `convertSafes`; invariant R4. The numbers are scenarios/capxul-vectors.json's seed round:
/// the pre-seed SAFEs ($250,000 and $750,000 at a $10M post-money cap, company capitalization 10,000,000) convert
/// at the cap price $1.00 (below the seed price $1.1413) into 250,000 and 750,000 Series Seed. With a 20% discount
/// the discounted price $0.91304 is the lower one: the angel's $250,000 buys 273,810 shares and the $0.5176 dust
/// stays with the company. The Board's batch raises the issuer allowance for the conversions.
contract ConvertSafes_Rounds_Unit_Concrete_Test is Rounds_Shared_Test {
    uint256 internal seedRound;

    function test_WhenTheCompanyCapitalizationIsZero() external {
        // it should reject the conversion
        uint256[] memory notes = new uint256[](0);
        vm.expectRevert(abi.encodeWithSelector(IRounds.InvalidRound.selector, "zero capitalization"));
        vm.prank(address(safe));
        rounds.convertSafes(notes, seedRound, 0);
    }

    function test_WhenANoteDoesNotExist() external {
        // it should reject the conversion
        uint256[] memory notes = new uint256[](1);
        notes[0] = 99;
        vm.expectRevert(abi.encodeWithSelector(IRounds.InvalidRound.selector, "unknown note"));
        vm.prank(address(safe));
        rounds.convertSafes(notes, seedRound, CAPITALIZATION);
    }

    function test_WhenTheConversionPriceRoundsToZero() external {
        // it should reject the conversion without consuming the note
        (, uint256[] memory notes) = _preSeedNotes(DISCOUNT);
        vm.expectRevert(abi.encodeWithSelector(IRounds.InvalidRound.selector, "zero conversion price"));
        vm.prank(address(safe));
        rounds.convertSafes(notes, seedRound, type(uint256).max);
        assertFalse(rounds.safeNote(notes[0]).converted, "note remains open");
    }

    function setUp() public override {
        super.setUp();
        // `try` keeps a stub's NotImplemented in each test rather than failing the suite once in setUp.
        vm.prank(address(safe));
        try rounds.createPricedRound(
            SEED, address(usdc), SEED_PRICE, MAX_SHARES, _now() + PAY_WINDOW, ROUND_DOC
        ) returns (
            uint256 id
        ) {
            seedRound = id;
        } catch { }
    }

    function _allow(uint128 shares) internal {
        vm.prank(address(safe));
        captable.setIssuerAllowance(address(rounds), SEED, shares);
    }

    function test_WhenTheCallerIsNotTheSafe() external {
        // it should revert with OnlyBoard
        (, uint256[] memory notes) = _preSeedNotes(DISCOUNT);
        _allow(1_000_000);
        vm.expectRevert(IRounds.OnlyBoard.selector);
        vm.prank(users.eve);
        rounds.convertSafes(notes, seedRound, CAPITALIZATION);
        vm.expectRevert(IRounds.OnlyBoard.selector);
        vm.prank(angel);
        rounds.convertSafes(notes, seedRound, CAPITALIZATION);
        assertEq(_token(SEED).balanceOf(angel), 0, "nothing issued");
    }

    function test_WhenANoteWasAlreadyConverted() external {
        // it should revert with InvalidRound
        (, uint256[] memory notes) = _preSeedNotes(DISCOUNT);
        _allow(2_000_000);
        uint256[] memory first = new uint256[](1);
        first[0] = notes[0];
        _convert(first, seedRound, CAPITALIZATION);

        // Again, alone or with an open note: the whole call reverts, the open note stays open.
        vm.prank(address(safe));
        _expectInvalidRound(abi.encodeCall(IRounds.convertSafes, (first, seedRound, CAPITALIZATION)));
        vm.prank(address(safe));
        _expectInvalidRound(abi.encodeCall(IRounds.convertSafes, (notes, seedRound, CAPITALIZATION)));
        assertFalse(rounds.safeNote(notes[1]).converted, "the open note is untouched");
        assertEq(_token(SEED).balanceOf(fund), 0, "nothing issued to the fund");
        assertEq(_token(SEED).balanceOf(angel), 250_000, "the angel's shares issued once");

        // The same note twice in one call.
        uint256[] memory twice = new uint256[](2);
        twice[0] = notes[1];
        twice[1] = notes[1];
        vm.prank(address(safe));
        _expectInvalidRound(abi.encodeCall(IRounds.convertSafes, (twice, seedRound, CAPITALIZATION)));
        assertEq(_token(SEED).balanceOf(fund), 0, "nothing issued to the fund");
    }

    function test_WhenThePricedRoundIsPastItsPayByDate() external {
        // it should revert with PayByPassed
        (, uint256[] memory notes) = _preSeedNotes(DISCOUNT);
        _allow(1_000_000);
        uint64 payBy = rounds.pricedRound(seedRound).payBy;
        vm.warp(payBy + 1);
        vm.expectRevert(abi.encodeWithSelector(IRounds.PayByPassed.selector, payBy));
        vm.prank(address(safe));
        rounds.convertSafes(notes, seedRound, CAPITALIZATION);
        assertFalse(rounds.safeNote(notes[0]).converted, "the note stays open");
        assertEq(_token(SEED).balanceOf(angel), 0, "nothing issued after the pay-by date (R3)");

        // At exactly the pay-by date the same batch converts.
        vm.warp(payBy);
        _convert(notes, seedRound, CAPITALIZATION);
        assertEq(_token(SEED).balanceOf(angel), 250_000, "converted at the last valid second");
    }

    modifier whenEveryNoteIsOpen() {
        _;
    }

    function test_WhenEveryNoteIsOpen() external whenEveryNoteIsOpen {
        // it should take the lower of the cap price and the discounted round price rounded down to the price unit
        // it should issue the amount divided by that price rounded down in the round's class
        // it should leave the dust with the company
        // it should mark each note converted
        // it should emit SafesConverted
        (, uint256[] memory notes) = _preSeedNotes(DISCOUNT);
        _allow(1_000_000);
        uint256 safeBefore = usdc.balanceOf(address(safe));
        uint128[] memory expected = new uint128[](2);
        expected[0] = 250_000;
        expected[1] = 750_000;

        vm.expectEmit(true, true, true, true, address(rounds));
        emit IRounds.SafesConverted(seedRound, notes, expected);
        _convert(notes, seedRound, CAPITALIZATION);

        // The cap price $1.00 is below the seed price: the vectors' conversion.
        assertEq(_token(SEED).balanceOf(angel), 250_000, "angel: $250,000 / $1.00");
        assertEq(_token(SEED).balanceOf(fund), 750_000, "fund: $750,000 / $1.00");
        assertEq(_token(COMMON).balanceOf(angel), 0, "only the round's class");
        assertTrue(rounds.safeNote(notes[0]).converted && rounds.safeNote(notes[1]).converted, "converted");
        assertEq(usdc.balanceOf(address(safe)), safeBefore, "conversion moves no money");
        assertEq(rounds.pricedRound(seedRound).issuedShares, 0, "conversions are not round sales");

        // A 20% discount: the discounted price is the lower; the shares round down and the dust stays.
        (uint256 id2, uint256[] memory notes2) = _preSeedNotes(2000);
        id2;
        uint256 conversionPrice = _modelConversionPrice(CAP, CAPITALIZATION, SEED_PRICE, 2000);
        assertEq(conversionPrice, 913_040, "the model: $1.1413 x 80% = $0.91304");
        _allow(2_000_000);
        uint256 angelUsdc = usdc.balanceOf(angel);
        uint256[] memory one = new uint256[](1);
        one[0] = notes2[0];
        vm.recordLogs();
        _convert(one, seedRound, CAPITALIZATION);
        assertEq(_token(SEED).balanceOf(angel), 250_000 + 273_810, "floor($250,000 / $0.91304)");
        assertEq(uint256(ANGEL) - 273_810 * conversionPrice, 517_600, "the dust is $0.5176");
        assertEq(usdc.balanceOf(angel), angelUsdc, "no dust refunded");
        assertEq(usdc.balanceOf(address(safe)), safeBefore + ANGEL + FUND, "the dust stays with the company");
        Vm.Log memory log = _oneLog(IRounds.SafesConverted.selector);
        assertEq(uint256(log.topics[1]), seedRound, "event round");
        (uint256[] memory loggedNotes, uint128[] memory loggedShares) = abi.decode(log.data, (uint256[], uint128[]));
        assertEq(loggedNotes.length, 1, "one note");
        assertEq(loggedNotes[0], notes2[0], "event note");
        assertEq(loggedShares[0], 273_810, "event shares");
        _assertHoldsNothing();
    }

    function test_WhenAProposalIsPendingInTheRoundsClass() external whenEveryNoteIsOpen {
        // it should revert whole with ProposalPending
        (, uint256[] memory notes) = _preSeedNotes(DISCOUNT);
        _allow(1_000_000);
        uint48 until = uint48(_now() + 1 days);
        captable.setPendingUntil(SEED, until);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.ProposalPending.selector, SEED, until));
        _convert(notes, seedRound, CAPITALIZATION);
        assertFalse(rounds.safeNote(notes[0]).converted || rounds.safeNote(notes[1]).converted, "nothing converted");
        assertEq(_token(SEED).totalSupply(), 0, "nothing issued");

        // After the snapshot the Board converts again.
        vm.warp(until + 1);
        _convert(notes, seedRound, CAPITALIZATION);
        assertEq(_token(SEED).totalSupply(), 1_000_000, "converted after the snapshot");
    }
}
