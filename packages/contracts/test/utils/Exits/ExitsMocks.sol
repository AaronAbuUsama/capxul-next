// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import { ICaptable } from "../../../src/interfaces/ICaptable.sol";
import { IOptions } from "../../../src/interfaces/IOptions.sol";
import { IShareClass } from "../../../src/interfaces/IShareClass.sol";

import { MockERC20 } from "../../mocks/MockERC20.sol";

/// @dev Mocks of Exits' Captable, ShareClass, Options and Vesting neighbours for focused unit tests.

/// @dev A class token: 0 decimals, open mint and burn (the Captable mock and the tests drive it).
contract MockShareToken is ERC20 {
    constructor(string memory name_) ERC20(name_, name_) { }

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function move(address from, address to, uint256 amount) external {
        _transfer(from, to, amount);
    }
}

/// @dev The Captable as Exits sees it (spec/captable.md): classes with their economic terms, consent to a
/// forced transfer used once (D3), locked shares never moved, and the exit burn and close only for Exits.
contract MockCaptableForExits {
    address public immutable safe;
    address public immutable exits;
    ICaptable.Class[] internal _classes;
    mapping(uint8 classId => uint128) internal _conversionPrice;
    mapping(bytes32 consentId => bool) public transferConsent;
    mapping(uint8 classId => mapping(address account => uint128)) public locked;
    bool public closedForExit;
    uint256 public burnCalls;

    constructor(address safe_, address exits_) {
        safe = safe_;
        exits = exits_;
    }

    // ---------------------------------------------------------------- test setup

    function addClass(
        string memory name_,
        uint128 originalIssuePrice,
        uint128 conversionPrice,
        uint128 preferenceMultipleBps,
        bool participating,
        uint8 seniority
    )
        external
        returns (uint8 classId)
    {
        classId = uint8(_classes.length);
        ICaptable.Class memory c;
        c.token = IShareClass(address(new MockShareToken(name_)));
        c.weight = 1;
        c.convertsInto = type(uint8).max;
        c.originalIssuePrice = originalIssuePrice;
        c.conversionFloorPrice = originalIssuePrice;
        c.preferenceMultipleBps = preferenceMultipleBps;
        c.participating = participating;
        c.seniority = seniority;
        c.authorised = type(uint128).max;
        _classes.push(c);
        _conversionPrice[classId] = conversionPrice;
    }

    function mintTo(uint8 classId, address to, uint256 amount) external {
        MockShareToken(address(_classes[classId].token)).mint(to, amount);
    }

    function setLocked(uint8 classId, address account, uint128 amount) external {
        locked[classId][account] = amount;
    }

    function tokenOf(uint8 classId) external view returns (MockShareToken) {
        return MockShareToken(address(_classes[classId].token));
    }

    // ---------------------------------------------------------------- ICaptable as Exits uses it

    function numberOfClasses() external view returns (uint8) {
        return uint8(_classes.length);
    }

    function getClass(uint8 classId) external view returns (ICaptable.Class memory) {
        if (classId >= _classes.length) revert ICaptable.UnknownClass(classId);
        return _classes[classId];
    }

    function conversionPriceAt(uint8 classId, uint256) external view returns (uint128) {
        if (classId >= _classes.length) revert ICaptable.UnknownClass(classId);
        return _conversionPrice[classId];
    }

    function consentToTransfer(uint8 classId, address to, uint128 amount, bytes32 reason) external {
        transferConsent[keccak256(abi.encode(classId, msg.sender, to, amount, reason))] = true;
    }

    function forcedTransfer(uint8 classId, address from, address to, uint128 amount, bytes32 reason) external {
        if (msg.sender != safe && msg.sender != exits) revert ICaptable.OnlyBoard();
        bytes32 id = keccak256(abi.encode(classId, from, to, amount, reason));
        if (!transferConsent[id]) revert ICaptable.ConsentMissing();
        MockShareToken token = MockShareToken(address(_classes[classId].token));
        uint128 lockedNow = locked[classId][from];
        if (lockedNow != 0 && token.balanceOf(from) < uint256(lockedNow) + amount) {
            revert ICaptable.SharesLocked(from, lockedNow);
        }
        transferConsent[id] = false;
        token.move(from, to, amount);
    }

    function burnForExit(uint8 classId, address from, uint128 amount) external {
        if (msg.sender != exits) revert ICaptable.OnlyModule();
        ++burnCalls;
        MockShareToken(address(_classes[classId].token)).burn(from, amount);
    }

    function closeForExit() external {
        if (msg.sender != exits) revert ICaptable.OnlyModule();
        closedForExit = true;
    }
}

/// @dev Options as Exits sees it (spec/options.md): grants, `allocated` as the live grants' unexercised
/// options, and `endAllForExit` only for Exits.
contract MockOptionsForExits {
    address public immutable captable;
    address public immutable exits;
    uint8 public immutable classId;
    uint128 public allocated;
    uint256 public nextId = 1;
    bool public endedForExit;
    mapping(uint256 id => IOptions.OptionGrant) internal _grants;
    mapping(uint256 id => uint128) internal _vestedAtEnd;

    constructor(address captable_, address exits_, uint8 classId_) {
        captable = captable_;
        exits = exits_;
        classId = classId_;
    }

    function addGrant(
        address grantee,
        uint128 shares,
        uint128 exercised,
        uint128 strikePrice,
        address strikeToken
    )
        external
        returns (uint256 id)
    {
        id = nextId++;
        IOptions.OptionGrant storage g = _grants[id];
        g.grantee = grantee;
        g.shares = shares;
        g.exercised = exercised;
        g.strikePrice = strikePrice;
        g.strikeToken = strikeToken;
        g.accepted = true;
        allocated += shares - exercised;
    }

    /// @dev `Options.end`: vesting stops at `endedAt` with `vested` options vested; the rest go back to the pool.
    function endGrant(uint256 id, uint64 endedAt, uint128 vested) external {
        IOptions.OptionGrant storage g = _grants[id];
        g.endedAt = endedAt;
        _vestedAtEnd[id] = vested;
        allocated -= g.shares - vested;
    }

    /// @dev Only for an ended grant, at its end (all Exits asks).
    function vestedOf(uint256 id, uint64 t) external view returns (uint128) {
        require(t == _grants[id].endedAt && t != 0, "vestedOf: only at an ended grant's end");
        return _vestedAtEnd[id];
    }

    function getGrant(uint256 id) external view returns (IOptions.OptionGrant memory) {
        return _grants[id];
    }

    function endAllForExit() external {
        if (msg.sender != exits) revert IOptions.OnlyExits();
        for (uint256 id = 1; id < nextId; ++id) {
            _grants[id].cancelled = true;
        }
        allocated = 0;
        endedForExit = true;
    }
}

/// @dev Vesting as Exits sees it (spec/vesting.md): `grantOf` and `accelerateForExit`, which only Exits may call
/// and which does nothing, never reverting, for a grant that does not accelerate on exit.
contract MockVestingForExits {
    address public immutable exits;
    mapping(address captable => mapping(uint8 classId => mapping(address shareholder => uint256))) public grantOf;
    mapping(uint256 id => bool) public acceleratesOnExit;
    mapping(uint256 id => bool) public accelerated;
    mapping(uint256 id => bool) public asked;

    constructor(address exits_) {
        exits = exits_;
    }

    function setGrant(address captable, uint8 classId, address shareholder, uint256 id, bool onExit) external {
        grantOf[captable][classId][shareholder] = id;
        acceleratesOnExit[id] = onExit;
    }

    function accelerateForExit(uint256 id) external {
        if (msg.sender != exits) revert("only Exits");
        asked[id] = true;
        if (acceleratesOnExit[id]) accelerated[id] = true;
    }
}

/// @dev A 6-decimal token that refuses every transfer to or from a blocked address, as USDC's blacklist does.
contract MockBlacklistToken is MockERC20 {
    error Blacklisted(address account);

    mapping(address account => bool) public blocked;

    constructor() MockERC20("Blacklisting USD", "BUSD", 6) { }

    function setBlocked(address account, bool value) external {
        blocked[account] = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blocked[from]) revert Blacklisted(from);
        if (blocked[to]) revert Blacklisted(to);
        super._update(from, to, value);
    }
}

/// @dev Credits the recipient in full but charges Exits an extra sender fee.
contract MockExitSenderFeeToken is MockERC20 {
    address private immutable _exits;

    constructor(address exits_) MockERC20("Sender Fee USD", "SFUSD", 6) {
        _exits = exits_;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == _exits && to != address(0)) super._update(from, address(0), value / 100);
        super._update(from, to, value);
    }
}
