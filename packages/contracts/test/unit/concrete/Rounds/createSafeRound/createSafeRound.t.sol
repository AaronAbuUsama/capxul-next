// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IRounds } from "../../../../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev spec/rounds.md `createSafeRound` (Board only, H4); the token must carry `PRICE_DECIMALS` (6) decimals
/// (IRounds NatSpec). Round ids start at 1.
contract CreateSafeRound_Rounds_Unit_Concrete_Test is Rounds_Shared_Test {
    function test_WhenTheTokenHasNoCodeOrItsDecimalsCallReverts() external {
        // it should reject the token
        address[2] memory invalid = [makeAddr("no token code"), address(new RevertingDecimals())];
        for (uint256 i; i < invalid.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(IRounds.InvalidRound.selector, "token decimals"));
            vm.prank(address(safe));
            rounds.createSafeRound(invalid[i], CAP, DISCOUNT, _now() + SAFE_WINDOW, SAFE_FORM);
        }
    }

    function test_WhenTheCallerIsNotTheSafe() external {
        // it should revert with OnlyBoard
        uint64 closesAt = _now() + SAFE_WINDOW;
        vm.expectRevert(IRounds.OnlyBoard.selector);
        vm.prank(users.eve);
        rounds.createSafeRound(address(usdc), CAP, DISCOUNT, closesAt, SAFE_FORM);
        vm.expectRevert(IRounds.OnlyBoard.selector);
        vm.prank(users.amira); // a Director acting alone is not the Board
        rounds.createSafeRound(address(usdc), CAP, DISCOUNT, closesAt, SAFE_FORM);
    }

    function test_WhenTheCapIs0OrTheDiscountIs10000OrMoreOrTheCloseDateIsPast() external {
        // it should revert with InvalidRound
        uint64 closesAt = _now() + SAFE_WINDOW;
        bytes4 sel = IRounds.createSafeRound.selector;
        vm.prank(address(safe));
        _expectInvalidRound(abi.encodeWithSelector(sel, address(usdc), 0, DISCOUNT, closesAt, SAFE_FORM));
        vm.prank(address(safe));
        _expectInvalidRound(abi.encodeWithSelector(sel, address(usdc), CAP, 10_000, closesAt, SAFE_FORM));
        vm.prank(address(safe));
        _expectInvalidRound(abi.encodeWithSelector(sel, address(usdc), CAP, 12_000, closesAt, SAFE_FORM));
        vm.prank(address(safe));
        _expectInvalidRound(abi.encodeWithSelector(sel, address(usdc), CAP, DISCOUNT, _now() - 1, SAFE_FORM));
        // A token in other units than the price unit (IRounds NatSpec).
        vm.prank(address(safe));
        _expectInvalidRound(abi.encodeWithSelector(sel, address(dai), CAP, DISCOUNT, closesAt, SAFE_FORM));

        // The boundaries are valid: a 99.99% discount, and a round that closes this second.
        vm.prank(address(safe));
        uint256 id = rounds.createSafeRound(address(usdc), CAP, 9999, _now(), SAFE_FORM);
        assertEq(id, 1, "first SAFE round");
    }

    function test_WhenTheTermsAreValid() external {
        // it should record the SAFE round
        // it should emit SafeRoundCreated
        uint64 closesAt = _now() + SAFE_WINDOW;
        vm.expectEmit(true, true, true, true, address(rounds));
        emit IRounds.SafeRoundCreated(1, address(usdc), CAP, 2000, closesAt, SAFE_FORM);
        vm.prank(address(safe));
        uint256 id = rounds.createSafeRound(address(usdc), CAP, 2000, closesAt, SAFE_FORM);
        assertEq(id, 1, "round id");

        IRounds.SafeRound memory r = rounds.safeRound(id);
        assertEq(r.token, address(usdc), "token");
        assertEq(r.valuationCap, CAP, "cap");
        assertEq(r.discountBps, 2000, "discount");
        assertEq(r.closesAt, closesAt, "closes at");
        assertEq(r.documentHash, SAFE_FORM, "document");
        assertFalse(r.closed, "open");

        assertEq(_createSafeRound(DISCOUNT), 2, "ids count up");
        assertEq(rounds.safeRound(1).discountBps, 2000, "the first round is unchanged");
        _assertHoldsNothing();
    }
}

contract RevertingDecimals {
    function decimals() external pure returns (uint8) {
        revert("decimals unavailable");
    }
}
