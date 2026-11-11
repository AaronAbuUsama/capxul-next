// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { ICaptable } from "../../../src/interfaces/ICaptable.sol";
import { MockCaptableGovernor, MockShareClass } from "../../utils/Captable/CaptableMocks.sol";
import { CaptableHandler } from "./CaptableHandler.sol";

/// @notice Eve, who wears nothing and holds no shares, calls every guarded Captable function; and the Board
/// tries what it may not do alone: a forced transfer without consent (D3), lowering a price (F8), and issuing
/// into a voting class while a proposal is pending (D6). Every attempt is a `try`; a success sets a flag the
/// invariants read (E2, E7, E11).
contract CaptableAttackerHandler is Test {
    ICaptable public immutable captable;
    CaptableHandler public immutable honest;
    MockCaptableGovernor public immutable governor;
    address public immutable eve;
    address public immutable safe;

    bool public eveWon;
    bool public forcedWithoutConsent;
    bool public boardLoweredPrice;
    bool public issuedWhilePending;
    bool public pendingWrongRefusal;
    mapping(bytes32 name => uint256) public calls;

    constructor(ICaptable captable_, CaptableHandler honest_, MockCaptableGovernor governor_, address eve_) {
        captable = captable_;
        honest = honest_;
        governor = governor_;
        eve = eve_;
        safe = honest_.safe();
    }

    function eveIssue(uint256 classSeed, uint128 amount) external {
        ++calls["eveIssue"];
        vm.prank(eve);
        try captable.issue(_class(classSeed), eve, amount, keccak256("eve")) {
            eveWon = true;
        } catch { }
    }

    function eveForcedTransfer(uint256 classSeed, uint256 fromSeed, uint128 amount) external {
        ++calls["eveForcedTransfer"];
        vm.prank(eve);
        try captable.forcedTransfer(_class(classSeed), _victim(fromSeed), eve, amount, keccak256("eve")) {
            eveWon = true;
        } catch { }
    }

    function eveReservedMatter(uint256 which, uint256 classSeed, uint128 amount) external {
        ++calls["eveReservedMatter"];
        uint8 c = _class(classSeed);
        bool ok;
        vm.startPrank(eve);
        which = bound(which, 0, 7);
        if (which == 0) ok = _try(abi.encodeCall(ICaptable.setAuthorised, (c, amount)));
        if (which == 1) ok = _try(abi.encodeCall(ICaptable.freeze, (c)));
        if (which == 2) {
            ok = _try(abi.encodeCall(ICaptable.setTransferRule, (c, ICaptable.TransferRule.AllowAll, address(0))));
        }
        if (which == 3) ok = _try(abi.encodeCall(ICaptable.setClassGovernor, (c, eve)));
        if (which == 4) ok = _try(abi.encodeCall(ICaptable.setConversionPrice, (c, amount)));
        if (which == 5) ok = _try(abi.encodeCall(ICaptable.setIssuerAllowance, (eve, c, amount)));
        if (which == 6) ok = _try(abi.encodeCall(ICaptable.burnUnvested, (c, _victim(amount), amount)));
        if (which == 7) ok = _try(abi.encodeCall(ICaptable.closeForExit, ()));
        vm.stopPrank();
        if (ok) eveWon = true;
    }

    function eveTakesShares(uint256 classSeed, uint256 fromSeed, uint256 amount) external {
        ++calls["eveTakesShares"];
        MockShareClass token = MockShareClass(address(captable.getClass(_class(classSeed)).token));
        amount = bound(amount, 1, type(uint128).max); // a transfer of 0 moves nothing
        vm.prank(eve);
        try token.transferFrom(_victim(fromSeed), eve, amount) {
            eveWon = true;
        } catch { }
    }

    /// @dev D3: the Safe alone, with no consent recorded for Eve as receiver.
    function safeForcesWithoutConsent(uint256 classSeed, uint256 fromSeed, uint128 amount) external {
        ++calls["safeForcesWithoutConsent"];
        vm.prank(safe);
        try captable.forcedTransfer(_class(classSeed), _victim(fromSeed), eve, amount, keccak256("no consent")) {
            forcedWithoutConsent = true;
        } catch { }
    }

    /// @dev F8: the Board alone never lowers a conversion price.
    function safeLowersPrice(uint256 classSeed, uint128 price) external {
        ++calls["safeLowersPrice"];
        vm.prank(safe);
        try captable.setConversionPrice(_class(classSeed), price) {
            boardLoweredPrice = true;
        } catch { }
    }

    /// @dev D6: with a proposal pending, the Safe tries to issue into a voting class.
    function issueWhilePending(uint256 classSeed, uint256 delay) external {
        ++calls["issueWhilePending"];
        uint8 c = _class(classSeed);
        if (captable.getClass(c).weight == 0) return;
        uint48 until = uint48(vm.getBlockTimestamp() + bound(delay, 0, 3 days));
        governor.setPendingUntil(until);
        vm.prank(safe);
        try captable.issue(c, eve, 1, keccak256("pending")) {
            issuedWhilePending = true;
        } catch (bytes memory reason) {
            // Amount 1, an open Captable and a known voting class: D6 (step 3) is the first check that can fail.
            if (keccak256(reason) != keccak256(abi.encodeWithSelector(ICaptable.ProposalPending.selector, c, until))) {
                pendingWrongRefusal = true;
            }
        }
    }

    function _try(bytes memory data) internal returns (bool ok) {
        (ok,) = address(captable).call(data);
    }

    function _class(uint256 seed) internal view returns (uint8) {
        return uint8(bound(seed, 0, captable.numberOfClasses() - 1));
    }

    function _victim(uint256 seed) internal view returns (address) {
        address[] memory all = honest.holders();
        return all[bound(seed, 0, all.length - 1)];
    }
}
