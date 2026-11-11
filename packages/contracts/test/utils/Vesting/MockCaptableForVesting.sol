// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { ICaptable } from "../../../src/interfaces/ICaptable.sol";
import { IShareClass } from "../../../src/interfaces/IShareClass.sol";
import { IVesting } from "../../../src/interfaces/IVesting.sol";
import { MockShareClass } from "../Captable/CaptableMocks.sol";

/// @notice The Captable as Vesting sees it (spec/captable.md), small enough to trust: `safe`, `exits`,
/// `getClass` (each class a real ERC20Votes `MockShareClass` clone, so votes are real), `issue` with E1, ruling
/// D6 and the issuer allowance, `burnUnvested` (only Vesting, back into the headroom), and `checkTransfer`,
/// which refuses a transfer that would dip into `Vesting.lockedOf` (V2, `SharesLocked`) and allows the rest.
contract MockCaptableForVesting {
    address public immutable safe;
    address public immutable exits;
    address public immutable vesting;
    address public immutable shareClassImpl;

    uint8 public numberOfClasses;
    mapping(uint8 classId => ICaptable.Class) internal _classes;
    mapping(uint8 classId => uint128) public issued;
    /// @dev Ruling D6 stand-in: a proposal in the class is pending until this time (0: none).
    mapping(uint8 classId => uint48) public pendingUntil;
    mapping(address module => mapping(uint8 classId => uint128)) public issuerAllowance;

    constructor(address safe_, address exits_, address vesting_) {
        safe = safe_;
        exits = exits_;
        vesting = vesting_;
        shareClassImpl = address(new MockShareClass());
    }

    /// @dev Test setup: a class with `authorised` shares and its token.
    function createClass(uint128 authorised) external returns (uint8 classId) {
        classId = numberOfClasses++;
        MockShareClass token = MockShareClass(Clones.clone(shareClassImpl));
        token.initialize("Acme Ltd Class", "ACME", address(this), classId);
        _classes[classId].token = IShareClass(address(token));
        _classes[classId].weight = 1;
        _classes[classId].authorised = authorised;
    }

    /// @dev Test setup: a proposal pending in the class until `until`.
    function setPendingUntil(uint8 classId, uint48 until) external {
        pendingUntil[classId] = until;
    }

    function getClass(uint8 classId) external view returns (ICaptable.Class memory) {
        if (classId >= numberOfClasses) revert ICaptable.UnknownClass(classId);
        return _classes[classId];
    }

    function setIssuerAllowance(address module, uint8 classId, uint128 amount) external {
        if (msg.sender != safe) revert ICaptable.OnlyBoard();
        issuerAllowance[module][classId] = amount;
    }

    function issue(uint8 classId, address to, uint128 amount, bytes32) external {
        if (classId >= numberOfClasses) revert ICaptable.UnknownClass(classId);
        if (amount == 0) revert ICaptable.ZeroAmount();
        if (msg.sender != safe) {
            uint128 left = issuerAllowance[msg.sender][classId];
            if (left < amount) revert ICaptable.IssuerAllowanceExceeded(msg.sender, classId, left, amount);
            issuerAllowance[msg.sender][classId] = left - amount;
        }
        uint48 until = pendingUntil[classId];
        if (until != 0 && block.timestamp <= until) revert ICaptable.ProposalPending(classId, until);
        ICaptable.Class storage c = _classes[classId];
        if (uint256(issued[classId]) + amount > c.authorised) {
            revert ICaptable.AuthorisedExceeded(classId, c.authorised, issued[classId], amount);
        }
        issued[classId] += amount;
        MockShareClass(address(c.token)).mint(to, amount);
    }

    function burnUnvested(uint8 classId, address from, uint128 amount) external {
        if (msg.sender != vesting) revert ICaptable.OnlyModule();
        issued[classId] -= amount;
        MockShareClass(address(_classes[classId].token)).burn(from, amount);
    }

    /// @dev V2 as the real Captable enforces it: never below the locked amount; every class rule allows.
    function checkTransfer(uint8 classId, address from, address, uint256 amount) external view {
        uint256 balance = _classes[classId].token.balanceOf(from);
        uint128 locked = IVesting(vesting).lockedOf(address(this), classId, from, uint64(block.timestamp));
        if (amount > balance || balance - amount < locked) revert ICaptable.SharesLocked(from, locked);
    }
}
