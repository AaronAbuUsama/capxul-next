// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { Options } from "../../src/equity/Options.sol";
import { IOptions } from "../../src/interfaces/IOptions.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import { CalendarModel } from "../utils/Calendar/CalendarModel.sol";
import { Payments } from "../../src/money/Payments.sol";
import { MockCaptableForOptions } from "../utils/Options/MockCaptableForOptions.sol";
import { Fork_Test } from "./Fork_Test.t.sol";

/// @notice slices/W4.md proof: an option grant's whole life with the real company Safe behind Hats Signer Gate v2
/// on the pinned Base Sepolia fork. The Board (Amira's Safe approving the hash, D1) sets the pool and the
/// Captable issuer allowance in one batch, grants and ends; Alice accepts, exercises, leaves and exercises in her
/// window; the strike lands in the company Safe. The engineer leaver numbers: 150,000 options at $0.05 over 48
/// months with a one-year cliff; leaving after 36 months keeps 112,500, whose strike is $5,625.
/// @dev The Captable is the Options unit-test mock; Payments, Safe, Gate and multisend are real.
contract Options_Fork_Test is Fork_Test {
    uint8 internal constant COMMON = 0;
    uint128 internal constant POOL = 1_000_000;
    uint128 internal constant SHARES = 150_000;
    uint128 internal constant STRIKE = 50_000; // $0.05
    uint32 internal constant WINDOW_DAYS = 90;
    bytes32 internal constant DOC = keccak256("option agreement: Alice, 150,000 Common at $0.05");

    Options internal options;
    MockCaptableForOptions internal captable;
    Payments internal payments;
    MockERC20 internal common;

    uint64 internal start;

    function _deployProtocol() internal override {
        captable = new MockCaptableForOptions(address(companySafe), makeAddr("exits"));
        captable.createClass(100_000_000);
        common = captable.token(COMMON);
        payments = new Payments();
        options = Options(Clones.clone(address(new Options())));
        try options.initialize(address(companySafe), address(captable), address(payments), COMMON) { } catch { }
        start = uint64(block.timestamp);
        vm.prank(users.alice);
        usdc.approve(address(options), type(uint256).max);
    }

    function test_LeaverExercisesEveryVestedOptionAndPaysTheStrikeToTheSafe() external {
        uint256 id = _poolAndGrant();
        _accept(id);

        // Past the cliff: 13 of 48 months have vested; Alice exercises them.
        vm.warp(_month(13));
        _exercise(id, 40_625);

        // She leaves after 36 months: the Board ends the grant now; 37,500 unvested return to the pool.
        uint64 leaves = _month(36);
        vm.warp(leaves);
        _board(abi.encodeCall(IOptions.end, (id, leaves)));
        assertEq(options.vestedOf(id, _month(48)), 112_500, "36 of 48 months vested, frozen");
        assertEq(options.allocated(), 112_500 - 40_625, "only the vested, unexercised part stays allocated");

        // She exercises the rest on the last day of her window.
        vm.warp(leaves + uint64(WINDOW_DAYS) * 1 days);
        _exercise(id, 112_500 - 40_625);

        assertEq(common.balanceOf(users.alice), 112_500, "Alice holds her vested shares");
        assertEq(usdc.balanceOf(address(companySafe)), 1_000_000 * USDC_UNIT + 5625 * USDC_UNIT, "$5,625 strike");
        assertEq(usdc.balanceOf(address(options)), 0, "Options holds nothing");
        assertEq(options.pool(), POOL - 112_500, "the pool shrank by the exercises (F9)");
        assertEq(options.allocated(), 0, "nothing left allocated");
    }

    function test_LeaverLapsesTheUnexercisedRestAfterTheWindow() external {
        uint256 id = _poolAndGrant();
        _accept(id);
        uint64 leaves = _month(36);
        vm.warp(leaves);
        _exercise(id, 100_000);
        _board(abi.encodeCall(IOptions.end, (id, leaves)));

        vm.warp(leaves + uint64(WINDOW_DAYS) * 1 days + 1);
        vm.expectRevert(IOptions.ExerciseWindowClosed.selector);
        vm.prank(users.alice);
        options.exercise(id, 1);

        vm.expectEmit(address(options));
        emit IOptions.OptionsLapsed(id, 12_500);
        vm.prank(users.eve); // anyone
        options.lapse(id);
        assertEq(options.allocated(), 0, "the rest returned to the pool");
        assertEq(options.pool(), POOL - 100_000, "only the exercise left the pool");
        assertEq(usdc.balanceOf(address(companySafe)), 1_000_000 * USDC_UNIT + 5000 * USDC_UNIT, "$5,000 strike");
    }

    // ---------------------------------------------------------------------------------------------------

    /// @dev One Board batch through the real Safe and Gate: the pool, the same issuer allowance, and the grant.
    function _poolAndGrant() internal returns (uint256 id) {
        assertEq(options.safe(), address(companySafe), "wired to the company Safe");
        Call[] memory calls = new Call[](3);
        calls[0] = Call(address(options), 0, abi.encodeCall(IOptions.setPool, (POOL)));
        calls[1] = Call(
            address(captable),
            0,
            abi.encodeCall(MockCaptableForOptions.setIssuerAllowance, (address(options), COMMON, POOL))
        );
        calls[2] = Call(
            address(options),
            0,
            abi.encodeCall(
                IOptions.grant,
                (
                    users.alice,
                    SHARES,
                    address(usdc),
                    STRIKE,
                    start,
                    _month(12),
                    _month(48),
                    start + 30 days,
                    _month(48) + 365 days,
                    WINDOW_DAYS,
                    DOC
                )
            )
        );
        _boardBatch(calls);
        id = 1; // grant ids start at 1
        assertEq(options.getGrant(id).grantee, users.alice, "granted");
        assertEq(options.allocated(), SHARES, "allocated");
    }

    function _board(bytes memory data) internal {
        Call[] memory calls = new Call[](1);
        calls[0] = Call(address(options), 0, data);
        _boardBatch(calls);
    }

    function _accept(uint256 id) internal {
        vm.prank(users.alice);
        options.accept(id, DOC);
    }

    function _exercise(uint256 id, uint128 shares) internal {
        vm.prank(users.alice);
        options.exercise(id, shares);
    }

    function _month(uint256 k) internal view returns (uint64) {
        return uint64(CalendarModel.stepAt(start, k));
    }
}
