// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { IShareClass } from "../../../src/interfaces/IShareClass.sol";

/// @notice The honest actors of one share class. The Captable (standing in for the Board's issuance and the
/// shareholders' forced transfers) mints, burns and force-moves, the Safe included; shareholders and the Safe
/// transfer; shareholders approve, transferFrom and delegate among themselves. Every input is bounded so every
/// call is valid (`fail_on_revert = true`). Ghosts record the Safe's balance history for E8.
contract ShareClassHandler is Test {
    IShareClass internal immutable token;
    address internal immutable captable;
    address internal immutable safe;
    /// @dev Shareholders: founders, hires (payees), an investor. The Safe is the last entry of `holders`.
    address[] internal holders;

    uint256[] public ghostTimes;
    uint256[] public ghostSafeBalances;
    mapping(bytes32 call => uint256 count) public calls;

    constructor(IShareClass token_, address captable_, address safe_, address[] memory shareholders) {
        token = token_;
        captable = captable_;
        safe = safe_;
        holders = shareholders;
        holders.push(safe_);
    }

    function holderCount() external view returns (uint256) {
        return holders.length;
    }

    function holderAt(uint256 i) external view returns (address) {
        return holders[i];
    }

    function ghostCount() external view returns (uint256) {
        return ghostTimes.length;
    }

    function _pick(uint256 seed) internal view returns (address) {
        return holders[bound(seed, 0, holders.length - 1)];
    }

    function _pickShareholder(uint256 seed) internal view returns (address) {
        return holders[bound(seed, 0, holders.length - 2)];
    }

    function _record(string memory name) internal {
        calls[keccak256(bytes(name))]++;
        uint256 t = vm.getBlockTimestamp();
        uint256 n = ghostTimes.length;
        uint256 b = token.balanceOf(safe);
        if (n > 0 && ghostTimes[n - 1] == t) {
            ghostSafeBalances[n - 1] = b;
        } else {
            ghostTimes.push(t);
            ghostSafeBalances.push(b);
        }
    }

    // The Captable (Board issuance, Governor or consented forced transfers, exits).

    function mint(uint256 toSeed, uint256 amount) external {
        address to = _pick(toSeed);
        amount = bound(amount, 1, 1e12);
        vm.prank(captable);
        token.mint(to, amount);
        _record("mint");
    }

    function burn(uint256 fromSeed, uint256 amount) external {
        address from = _pick(fromSeed);
        amount = bound(amount, 0, token.balanceOf(from));
        vm.prank(captable);
        token.burn(from, amount);
        _record("burn");
    }

    function forcedMove(uint256 fromSeed, uint256 toSeed, uint256 amount) external {
        address from = _pick(fromSeed);
        address to = _pick(toSeed);
        amount = bound(amount, 0, token.balanceOf(from));
        vm.prank(captable);
        token.forcedMove(from, to, amount);
        _record("forcedMove");
    }

    // Shareholders.

    /// @dev Any holder, the Safe included: the Safe's own ERC-20 transfer must lower its checkpoint too.
    function transfer(uint256 fromSeed, uint256 toSeed, uint256 amount) external {
        address from = _pick(fromSeed);
        address to = _pick(toSeed);
        amount = bound(amount, 0, token.balanceOf(from));
        vm.prank(from);
        token.transfer(to, amount);
        _record("transfer");
    }

    function transferFrom(uint256 ownerSeed, uint256 spenderSeed, uint256 toSeed, uint256 amount) external {
        address owner = _pickShareholder(ownerSeed);
        address spender = _pickShareholder(spenderSeed);
        address to = _pick(toSeed);
        amount = bound(amount, 0, token.balanceOf(owner));
        vm.prank(owner);
        token.approve(spender, amount);
        vm.prank(spender);
        token.transferFrom(owner, to, amount);
        _record("transferFrom");
    }

    function delegate(uint256 fromSeed, uint256 toSeed) external {
        address from = _pickShareholder(fromSeed);
        address to = _pickShareholder(toSeed);
        vm.prank(from);
        token.delegate(to);
        _record("delegate");
    }

    function warp(uint256 dt) external {
        vm.warp(vm.getBlockTimestamp() + bound(dt, 1, 30 days));
        _record("warp");
    }
}
