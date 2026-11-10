// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { StdUtils } from "forge-std/StdUtils.sol";
import { Vm } from "forge-std/Vm.sol";

import { IVesting } from "../../../src/interfaces/IVesting.sol";
import { VestingHandler } from "./VestingHandler.sol";

/// @notice Eve, who wears nothing and owns no shares, calls every Board, Exits and shareholder function of
/// Vesting on the honest handler's grants and shareholders. Each call must fail; one that succeeds sets
/// `breach`. Calls are caught, so the attacker never reverts the run (fail_on_revert).
contract VestingAttackerHandler is StdUtils {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    VestingHandler public immutable honest;
    IVesting public immutable vesting;
    address public immutable eve;

    bool public breach;
    string public breachedBy;

    constructor(VestingHandler honest_, address eve_) {
        honest = honest_;
        vesting = honest_.vesting();
        eve = eve_;
    }

    function _target(uint256 seed) internal view returns (address) {
        address[] memory s = honest.shareholders();
        return s[seed % s.length];
    }

    function _id(uint256 seed) internal view returns (uint256) {
        uint256 n = honest.idCount();
        return n == 0 ? 1 : honest.ids(seed % n);
    }

    function _flag(string memory what) internal {
        breach = true;
        breachedBy = what;
    }

    /// @dev V4: Eve cannot put a grant on a shareholder's shares.
    function grantAndIssue(uint256 who, uint128 amount) external {
        address captable = address(honest.captable());
        address target = _target(who); // read before the prank: an external call would consume it
        uint128 shares = uint128(_bound(amount, 1, 1e6));
        vm.prank(eve);
        try vesting.grantAndIssue(
            captable, 0, target, shares, 1_767_225_600, 1_798_761_600, 1_893_456_000, false, 0
        ) returns (
            uint256
        ) {
            _flag("grantAndIssue");
        } catch { }
    }

    /// @dev V4: nor offer one.
    function offerGrant(uint256 who) external {
        address captable = address(honest.captable());
        address target = _target(who); // read before the prank: an external call would consume it
        vm.prank(eve);
        try vesting.offerGrant(
            captable, 0, target, 1, 1_767_225_600, 1_798_761_600, 1_893_456_000, type(uint64).max, false, 0
        ) returns (
            uint256
        ) {
            _flag("offerGrant");
        } catch { }
    }

    /// @dev V4: nor accept a shareholder's offer for them.
    function acceptGrant(uint256 idSeed, bytes32 terms) external {
        uint256 id = _id(idSeed);
        vm.prank(eve);
        try vesting.acceptGrant(id, terms) {
            _flag("acceptGrant");
        } catch { }
    }

    function revoke(uint256 idSeed, uint64 effectiveAt) external {
        uint256 id = _id(idSeed);
        vm.prank(eve);
        try vesting.revoke(id, uint64(_bound(effectiveAt, vm.getBlockTimestamp(), vm.getBlockTimestamp() + 365 days))) {
            _flag("revoke");
        } catch { }
    }

    function accelerate(uint256 idSeed, uint64 newEnd) external {
        uint256 id = _id(idSeed);
        vm.prank(eve);
        try vesting.accelerate(id, newEnd, keccak256("eve")) {
            _flag("accelerate");
        } catch { }
    }

    function accelerateForExit(uint256 idSeed) external {
        uint256 id = _id(idSeed);
        vm.prank(eve);
        try vesting.accelerateForExit(id) {
            _flag("accelerateForExit");
        } catch { }
    }
}
