// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../src/interfaces/ICaptable.sol";
import { IShareClass } from "../../../src/interfaces/IShareClass.sol";
import { MockERC20 } from "../../mocks/MockERC20.sol";

/// @notice The Captable as Rounds sees it (spec/captable.md), small enough to trust: `safe`, `rounds`,
/// `PRICE_DECIMALS`, `NONE`, the classes (`numberOfClasses`, `getClass` with the economic terms and the class
/// Governor), `conversionPriceAt` (the current price only), `issue` with the issuer allowance spent by a module's
/// issue, invariant E1 (`issued <= authorised`) and ruling D6 (`ProposalPending` while a proposal in the class is
/// pending), and `setConversionPrice` as the Captable guards it (only Rounds here, ruling F8; only lower,
/// `ConversionPriceNotLower`; never below the floor, `BelowFloor`; `NotConvertible` without an issue price).
/// Each class's shares are a plain 0-decimal `MockERC20`, because Rounds only needs the shares to arrive.
contract MockCaptableForRounds {
    uint8 public constant PRICE_DECIMALS = 6;
    uint8 public constant NONE = type(uint8).max;

    address public immutable safe;
    address public immutable rounds;

    mapping(uint8 classId => ICaptable.Class) internal _classes;
    mapping(uint8 classId => uint128) public conversionPrice;
    mapping(uint8 classId => uint128) public issued;
    /// @dev Ruling D6 stand-in: a proposal in the class is pending until this time (0: none).
    mapping(uint8 classId => uint48) public pendingUntil;
    mapping(address module => mapping(uint8 classId => uint128)) public issuerAllowance;
    uint8 public numberOfClasses;
    /// @dev When set, `issue` refuses with `CaptableClosed` (a refusal other than D6).
    bool public closedForExit;

    constructor(address safe_, address rounds_) {
        safe = safe_;
        rounds = rounds_;
    }

    // ------------------------------------------------------------------------------------- test setup

    /// @dev A class with `authorised_` shares, an original issue price (0 for Common) that is also its starting
    /// conversion price, a floor, and an optional class Governor.
    function createClass(
        string memory name,
        uint128 authorised_,
        uint128 originalIssuePrice,
        uint128 floor,
        address classGovernor
    )
        external
        returns (uint8 classId)
    {
        classId = numberOfClasses++;
        MockERC20 shareToken = new MockERC20(name, name, 0);
        ICaptable.Class storage c = _classes[classId];
        c.token = IShareClass(address(shareToken));
        c.weight = 1;
        c.convertsInto = originalIssuePrice == 0 ? NONE : 0;
        c.authorised = authorised_;
        c.originalIssuePrice = originalIssuePrice;
        c.conversionFloorPrice = floor;
        c.preferenceMultipleBps = originalIssuePrice == 0 ? 0 : 10_000;
        c.classGovernor = classGovernor;
        conversionPrice[classId] = originalIssuePrice;
    }

    function setPendingUntil(uint8 classId, uint48 until) external {
        pendingUntil[classId] = until;
    }

    function setClosedForExit(bool closed) external {
        closedForExit = closed;
    }

    function token(uint8 classId) external view returns (MockERC20) {
        return MockERC20(address(_classes[classId].token));
    }

    // ------------------------------------------------------------------------------- the Captable

    function getClass(uint8 classId) external view returns (ICaptable.Class memory) {
        if (classId >= numberOfClasses) revert ICaptable.UnknownClass(classId);
        return _classes[classId];
    }

    function conversionPriceAt(uint8 classId, uint256) external view returns (uint128) {
        if (classId >= numberOfClasses) revert ICaptable.UnknownClass(classId);
        return conversionPrice[classId];
    }

    function setIssuerAllowance(address module, uint8 classId, uint128 amount) external {
        if (msg.sender != safe) revert ICaptable.OnlyBoard();
        if (module != rounds) revert ICaptable.OnlyModule();
        issuerAllowance[module][classId] = amount;
    }

    function issue(uint8 classId, address to, uint128 amount, bytes32 reason) external {
        if (classId >= numberOfClasses) revert ICaptable.UnknownClass(classId);
        if (amount == 0) revert ICaptable.ZeroAmount();
        if (reason == bytes32(0)) revert ICaptable.ZeroReason();
        if (closedForExit) revert ICaptable.CaptableClosed();
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
        MockERC20(address(c.token)).mint(to, amount);
    }

    function setConversionPrice(uint8 classId, uint128 price) external {
        if (msg.sender != rounds) revert ICaptable.OnlyGovernor();
        if (classId >= numberOfClasses) revert ICaptable.UnknownClass(classId);
        ICaptable.Class storage c = _classes[classId];
        if (c.originalIssuePrice == 0) revert ICaptable.NotConvertible(classId);
        uint128 current = conversionPrice[classId];
        if (price >= current) revert ICaptable.ConversionPriceNotLower(current, price);
        if (price < c.conversionFloorPrice) revert ICaptable.BelowFloor(c.conversionFloorPrice, price);
        conversionPrice[classId] = price;
        emit ICaptable.ConversionPriceSet(classId, price);
    }
}
