// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { IRounds } from "../../../../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev spec/rounds.md `createPricedRound` (Board only, H4). The class must exist in the Captable (its
/// `UnknownClass` bubbles); the token must carry `PRICE_DECIMALS` decimals. Priced round ids start at 1.
contract CreatePricedRound_Rounds_Unit_Concrete_Test is Rounds_Shared_Test {
    function test_WhenTheCallerIsNotTheSafe() external {
        // it should revert with OnlyBoard
        uint64 payBy = _now() + PAY_WINDOW;
        vm.expectRevert(IRounds.OnlyBoard.selector);
        vm.prank(users.eve);
        rounds.createPricedRound(SERIES_C, address(usdc), PRICE, MAX_SHARES, payBy, ROUND_DOC);
        vm.expectRevert(IRounds.OnlyBoard.selector);
        vm.prank(seedGovernor); // a class Governor is not the Board either
        rounds.createPricedRound(SERIES_C, address(usdc), PRICE, MAX_SHARES, payBy, ROUND_DOC);
    }

    function test_WhenThePriceOrTheMaximumSharesIs0OrThePayByDateIsPast() external {
        // it should revert with InvalidRound
        uint64 payBy = _now() + PAY_WINDOW;
        bytes4 sel = IRounds.createPricedRound.selector;
        vm.prank(address(safe));
        _expectInvalidRound(abi.encodeWithSelector(sel, SERIES_C, address(usdc), 0, MAX_SHARES, payBy, ROUND_DOC));
        vm.prank(address(safe));
        _expectInvalidRound(abi.encodeWithSelector(sel, SERIES_C, address(usdc), PRICE, 0, payBy, ROUND_DOC));
        vm.prank(address(safe));
        _expectInvalidRound(
            abi.encodeWithSelector(sel, SERIES_C, address(usdc), PRICE, MAX_SHARES, _now() - 1, ROUND_DOC)
        );
        vm.prank(address(safe));
        _expectInvalidRound(abi.encodeWithSelector(sel, SERIES_C, address(dai), PRICE, MAX_SHARES, payBy, ROUND_DOC));

        // Paying by this very second is valid.
        vm.prank(address(safe));
        assertEq(rounds.createPricedRound(SERIES_C, address(usdc), PRICE, MAX_SHARES, _now(), ROUND_DOC), 1, "id");
    }

    function test_WhenTheClassDoesNotExist() external {
        // it should revert with UnknownClass
        uint64 payBy = _now() + PAY_WINDOW;
        vm.expectRevert(abi.encodeWithSelector(ICaptable.UnknownClass.selector, uint8(4)));
        vm.prank(address(safe));
        rounds.createPricedRound(4, address(usdc), PRICE, MAX_SHARES, payBy, ROUND_DOC);
    }

    function test_WhenTheRoundIsValid() external {
        // it should record the priced round
        // it should emit PricedRoundCreated
        uint64 payBy = _now() + PAY_WINDOW;
        vm.expectEmit(true, true, true, true, address(rounds));
        emit IRounds.PricedRoundCreated(1, SERIES_C, address(usdc), PRICE, MAX_SHARES, payBy, ROUND_DOC);
        uint256 id = _createPricedRound(SERIES_C, PRICE, MAX_SHARES);
        assertEq(id, 1, "round id");

        IRounds.PricedRound memory r = rounds.pricedRound(id);
        assertEq(r.classId, SERIES_C, "class");
        assertEq(r.token, address(usdc), "token");
        assertEq(r.price, PRICE, "price");
        assertEq(r.maxShares, MAX_SHARES, "maximum");
        assertEq(r.payBy, payBy, "pay by");
        assertEq(r.documentHash, ROUND_DOC, "document");
        assertEq(r.allocatedShares, 0, "nothing allocated");
        assertEq(r.issuedShares, 0, "nothing issued");
        assertFalse(r.closed || r.cancelled, "open");
        assertEq(_createPricedRound(SERIES_A, A_PRICE, 1), 2, "ids count up");
        _assertHoldsNothing();
    }
}
