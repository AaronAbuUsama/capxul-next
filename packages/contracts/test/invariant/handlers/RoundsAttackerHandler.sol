// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { IRounds } from "../../../src/interfaces/IRounds.sol";
import { RoundsHandler } from "./RoundsHandler.sol";

/// @notice Eve the attacker, who wears nothing and holds USDC, tries every Board function of Rounds (H4), pays and
/// consents without standing, and re-initialises the clone and the implementation (I3). A late investor tries to
/// pay an allocation after the round's pay-by date, or once it is closed or cancelled (R3). Every call here must
/// be refused; a success sets `ghostEveWon` or `ghostR3Broken`. Calls are wrapped in try so the expected refusals
/// do not trip `fail_on_revert`.
contract RoundsAttackerHandler is Test {
    IRounds internal immutable rounds;
    IRounds internal immutable implementation;
    RoundsHandler internal immutable honest;
    address internal immutable eve;
    address internal immutable usdc;
    address[] internal investors;

    bool public ghostEveWon;
    bool public ghostR3Broken;
    uint256 public attempts;

    constructor(
        IRounds rounds_,
        IRounds implementation_,
        RoundsHandler honest_,
        address eve_,
        address usdc_,
        address[] memory investors_
    ) {
        rounds = rounds_;
        implementation = implementation_;
        honest = honest_;
        eve = eve_;
        usdc = usdc_;
        investors = investors_;
    }

    function _priced(uint256 seed) internal view returns (uint256) {
        uint256 n = honest.pricedIdsLength();
        return n == 0 ? 1 : honest.pricedIds(bound(seed, 0, n - 1));
    }

    function _safeRound(uint256 seed) internal view returns (uint256) {
        uint256 n = honest.safeIdsLength();
        return n == 0 ? 1 : honest.safeIds(bound(seed, 0, n - 1));
    }

    /// @dev One entry point for eve, so her attempts do not crowd out the honest actors: `which` picks the call.
    function attack(uint256 which, uint256 seed, uint128 x) external {
        attempts++;
        uint256 priced = _priced(seed);
        uint256 safeRound = _safeRound(seed);
        bytes memory data;
        which = which % 14;
        if (which == 0) {
            data = abi.encodeCall(IRounds.createSafeRound, (usdc, x, 0, uint64(block.timestamp + 1 days), bytes32("x")));
        } else if (which == 1) {
            data = abi.encodeCall(IRounds.inviteSafe, (safeRound, eve, x));
        } else if (which == 2) {
            data = abi.encodeCall(IRounds.signSafe, (safeRound, uint128(bound(x, 1, 1e12)), bytes32("x")));
        } else if (which == 3) {
            data = abi.encodeCall(IRounds.closeSafeRound, (safeRound));
        } else if (which == 4) {
            uint256 n = honest.noteIdsLength();
            uint256[] memory ids = new uint256[](1);
            ids[0] = n == 0 ? 1 : honest.noteIds(seed % n);
            data = abi.encodeCall(IRounds.convertSafes, (ids, priced, bound(x, 1, 1e7)));
        } else if (which == 5) {
            data = abi.encodeCall(
                IRounds.createPricedRound, (3, usdc, x, 1e6, uint64(block.timestamp + 1 days), bytes32("x"))
            );
        } else if (which == 6) {
            data = abi.encodeCall(IRounds.invite, (priced, eve, x));
        } else if (which == 7) {
            data = abi.encodeCall(IRounds.allocate, (priced, eve, x));
        } else if (which == 8) {
            data = abi.encodeCall(IRounds.pay, (priced));
        } else if (which == 9) {
            data = abi.encodeCall(IRounds.consent, (priced));
        } else if (which == 10) {
            data = abi.encodeCall(IRounds.close, (priced, x));
        } else if (which == 11) {
            data = abi.encodeCall(IRounds.cancel, (priced));
        } else {
            address target = which == 12 ? address(implementation) : address(rounds);
            vm.prank(eve);
            (bool reinit,) = target.call(abi.encodeCall(IRounds.initialize, (eve, eve, eve)));
            if (reinit) ghostEveWon = true;
            return;
        }
        vm.prank(eve);
        (bool ok,) = address(rounds).call(data);
        if (ok) ghostEveWon = true;
    }

    /// @dev R3: an allocated, unpaid investor pays a round that is past its pay-by date, closed or cancelled.
    function payLate(uint256 seed, uint256 who) external {
        if (honest.pricedIdsLength() == 0) return;
        uint256 id = _priced(seed);
        IRounds.PricedRound memory r = rounds.pricedRound(id);
        if (!r.closed && !r.cancelled && block.timestamp <= r.payBy) return;
        address investor = investors[bound(who, 0, investors.length - 1)];
        IRounds.Position memory p = rounds.position(id, investor);
        if (p.shares == 0 || p.paid) return;
        attempts++;
        vm.prank(investor);
        try rounds.pay(id) {
            ghostR3Broken = true;
        } catch { }
    }
}
