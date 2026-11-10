// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20Errors } from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { IOptions } from "../../../../../src/interfaces/IOptions.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";
import { Options_Shared_Test } from "../../../../utils/Options/Options_Shared_Test.sol";

/// @dev spec/options.md `exercise`; invariants O1 (`exercised <= vested`), O2 (the pool shrinks, ruling F9) and the
/// payment invariants for the strike (kind 7, one way money leaves). Ruling D6: a pending proposal in the class
/// refuses the issue, so the whole exercise reverts. The leaver numbers are slices/W4.md's.
contract Exercise_Options_Unit_Concrete_Test is Options_Shared_Test {
    uint64 internal leaves; // 2029-01-01: 36 of 48 months, 112,500 vested
    uint128 internal constant VESTED_36 = 112_500;
    uint256 internal constant STRIKE_36 = 5625 * USDC_UNIT; // 112,500 x $0.05

    function setUp() public override {
        super.setUp();
        leaves = _date(2029, 1, 1);
    }

    function test_WhenTheCallerIsNotTheGrantee() external {
        // it should revert with OnlyGrantee
        uint256 id = _acceptedGrant();
        vm.warp(leaves);
        vm.prank(users.eve);
        usdc.approve(address(options), type(uint256).max);
        vm.expectRevert(IOptions.OnlyGrantee.selector);
        vm.prank(users.eve);
        options.exercise(id, 1);
        vm.expectRevert(IOptions.OnlyGrantee.selector);
        vm.prank(address(safe));
        options.exercise(id, 1);
        assertEq(options.getGrant(id).exercised, 0, "nothing exercised");
    }

    function test_WhenTheGrantWasNotAccepted() external {
        // it should revert with NotAccepted
        uint256 id = _defaultGrant();
        vm.warp(gCliff);
        vm.expectRevert(IOptions.NotAccepted.selector);
        vm.prank(users.alice);
        options.exercise(id, 1);
    }

    function test_WhenTheGrantExpiredOrItsExerciseWindowClosed() external {
        // it should revert with ExerciseWindowClosed
        // Ended: the window runs WINDOW_DAYS from the end date, inclusive.
        uint256 leaver = _acceptedGrant();
        vm.warp(leaves);
        _end(leaver, leaves);
        vm.warp(leaves + uint64(WINDOW_DAYS) * 1 days);
        _exercise(leaver, 1); // the last second of the window
        vm.warp(leaves + uint64(WINDOW_DAYS) * 1 days + 1);
        vm.expectRevert(IOptions.ExerciseWindowClosed.selector);
        vm.prank(users.alice);
        options.exercise(leaver, 1);

        // Not ended: exercisable through `expiresAt`, inclusive.
        uint256 stayer = _grant(users.bob, SHARES, gStart, gCliff, gEnd, gExpires);
        _accept(stayer);
        vm.warp(gExpires);
        _exercise(stayer, 1);
        vm.warp(gExpires + 1);
        vm.expectRevert(IOptions.ExerciseWindowClosed.selector);
        vm.prank(users.bob);
        options.exercise(stayer, 1);
    }

    function test_WhenExercisedPlusTheSharesIsMoreThanVested() external {
        // it should revert with NotVested
        uint256 id = _acceptedGrant();
        vm.warp(gCliff - 1);
        vm.expectRevert(abi.encodeWithSelector(IOptions.NotVested.selector, 0, 0, 1));
        vm.prank(users.alice);
        options.exercise(id, 1);

        vm.warp(leaves);
        vm.expectRevert(abi.encodeWithSelector(IOptions.NotVested.selector, VESTED_36, 0, VESTED_36 + 1));
        vm.prank(users.alice);
        options.exercise(id, VESTED_36 + 1);

        _exercise(id, 100_000);
        vm.expectRevert(abi.encodeWithSelector(IOptions.NotVested.selector, VESTED_36, 100_000, 12_501));
        vm.prank(users.alice);
        options.exercise(id, 12_501);
        assertEq(options.getGrant(id).exercised, 100_000, "only the first exercise");
    }

    modifier whenTheSharesAreVestedAndExercisable() {
        _;
    }

    function test_WhenTheSharesAreVestedAndExercisable() external whenTheSharesAreVestedAndExercisable {
        // it should pull the strike times the shares from the grantee
        // it should pay it to the Safe through Payments with kind 7
        // it should hold no balance afterwards
        // it should issue the shares to the grantee in the same transaction
        // it should add the shares to exercised
        // it should take the shares out of the pool and out of allocated
        // it should emit Exercised
        uint256 id = _acceptedGrant();
        vm.warp(leaves);
        uint256 aliceBefore = usdc.balanceOf(users.alice);
        uint256 safeBefore = usdc.balanceOf(address(safe));

        // Two sends in this test: this exercise and the later one below (expectCall counts to the end of the test).
        vm.expectCall(address(payments), abi.encodeWithSelector(IPayments.send.selector), 2);
        vm.expectEmit(false, true, true, true, address(payments));
        emit IPayments.PaymentSent(
            bytes32(0), address(options), address(safe), address(usdc), STRIKE_36, KIND_OPTION_EXERCISE, DOC
        );
        vm.recordLogs();
        _exercise(id, VESTED_36);

        assertEq(usdc.balanceOf(users.alice), aliceBefore - STRIKE_36, "strike pulled from the grantee");
        assertEq(usdc.balanceOf(address(safe)), safeBefore + STRIKE_36, "strike paid to the Safe");
        _assertHoldsNothing();
        assertEq(common.balanceOf(users.alice), VESTED_36, "shares issued to the grantee");
        assertEq(captable.issued(COMMON), VESTED_36, "issued through the Captable");
        assertEq(captable.issuerAllowance(address(options), COMMON), POOL - VESTED_36, "issuer allowance spent");
        assertEq(options.getGrant(id).exercised, VESTED_36, "exercised");
        assertEq(options.pool(), POOL - VESTED_36, "the pool shrinks (F9)");
        assertEq(options.allocated(), SHARES - VESTED_36, "allocated falls");

        (uint256 loggedId, uint128 shares, uint256 paid, bytes32 paymentId) = _exercisedLog();
        assertEq(loggedId, id, "event id");
        assertEq(shares, VESTED_36, "event shares");
        assertEq(paid, STRIKE_36, "event paid");
        assertTrue(paymentId != bytes32(0) && payments.paid(paymentId), "event names the consumed payment");

        // A second exercise of the next month's step is a new payment.
        vm.warp(_date(2029, 2, 1));
        vm.recordLogs();
        _exercise(id, 3125);
        (,,, bytes32 secondId) = _exercisedLog();
        assertTrue(secondId != paymentId && payments.paid(secondId), "a fresh payment id");
        _assertHoldsNothing();
    }

    function test_WhenTheGranteesPaymentFails() external whenTheSharesAreVestedAndExercisable {
        // it should revert and issue nothing
        uint256 id = _acceptedGrant();
        vm.warp(leaves);
        vm.prank(users.alice);
        usdc.approve(address(options), 0);
        uint256 aliceBefore = usdc.balanceOf(users.alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(options), 0, STRIKE_36)
        );
        vm.prank(users.alice);
        options.exercise(id, VESTED_36);
        assertEq(common.balanceOf(users.alice), 0, "nothing issued");
        assertEq(usdc.balanceOf(users.alice), aliceBefore, "nothing paid");
        assertEq(options.getGrant(id).exercised, 0, "nothing exercised");
        assertEq(options.pool(), POOL, "pool kept");
        assertEq(options.allocated(), SHARES, "allocated kept");
    }

    function test_WhenAProposalIsPendingInTheClass() external whenTheSharesAreVestedAndExercisable {
        // it should revert with ProposalPending and pay nothing
        uint256 id = _acceptedGrant();
        vm.warp(leaves);
        uint48 until = uint48(leaves + 3 days);
        captable.setPendingUntil(COMMON, until);
        uint256 aliceBefore = usdc.balanceOf(users.alice);
        uint256 safeBefore = usdc.balanceOf(address(safe));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.ProposalPending.selector, COMMON, until));
        vm.prank(users.alice);
        options.exercise(id, VESTED_36);
        assertEq(usdc.balanceOf(users.alice), aliceBefore, "grantee paid nothing");
        assertEq(usdc.balanceOf(address(safe)), safeBefore, "Safe received nothing");
        assertEq(common.balanceOf(users.alice), 0, "nothing issued");
        assertEq(options.getGrant(id).exercised, 0, "nothing exercised");

        // After the pending period the same exercise goes through.
        vm.warp(uint256(until) + 1);
        _exercise(id, VESTED_36);
        assertEq(common.balanceOf(users.alice), VESTED_36, "issued after the vote opened");
    }
}
