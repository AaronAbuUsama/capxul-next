// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { MockERC20 } from "./mocks/MockERC20.sol";
import { MockFalseReturnToken } from "./mocks/MockFalseReturnToken.sol";
import { MockFeeOnTransferToken } from "./mocks/MockFeeOnTransferToken.sol";
import { MockHats } from "./mocks/MockHats.sol";
import { MockNoReturnToken } from "./mocks/MockNoReturnToken.sol";
import { MockRebasingToken } from "./mocks/MockRebasingToken.sol";
import { MockReentrantERC20 } from "./mocks/MockReentrantERC20.sol";
import { MockRoles } from "./mocks/MockRoles.sol";
import { MockSafe } from "./mocks/MockSafe.sol";

/// @notice The hermetic base: the people, the tokens and a company made of mocks. Every unit, fuzz
/// and invariant test inherits it. Each slice adds its contracts to `_deployProtocol`.
abstract contract Base_Test is Test {
    /// @dev The startup story's people (docs/planning/protocol-v4, startup scenario) plus an attacker.
    struct Users {
        address payable amira; // founder; her personal Safe wears the Director hat on the fork
        address payable ben; // founder
        address payable jordan; // runs Operations
        address payable alice; // hire, payee
        address payable bob; // hire, payee
        address payable investor;
        address payable eve; // wears nothing, holds tokens, calls everything
    }

    /// @dev Hat ids in Hats Protocol v1's layout: top hat 1, and its first child.
    uint256 internal constant TOP_HAT = uint256(1) << 224;
    uint256 internal constant DIRECTOR_HAT = TOP_HAT | (uint256(1) << 208);

    /// @dev 1 January 2026 00:00 UTC: calendar maths needs a real date.
    uint256 internal constant START = 1_767_225_600;
    uint256 internal constant USDC_UNIT = 1e6;

    Users internal users;
    MockERC20 internal usdc; // 6 decimals
    MockERC20 internal dai; // 18 decimals
    // The odd tokens (R5 section 3), all 6 decimals: each one must be refused or handled.
    MockNoReturnToken internal usdt; // transfer returns nothing
    MockFalseReturnToken internal falseToken; // transfer returns false and moves nothing
    MockFeeOnTransferToken internal feeToken; // 1% burnt from every transfer
    MockRebasingToken internal rebasingToken; // balances scale with an index, transfers round down
    MockReentrantERC20 internal reentrantToken; // calls back into an armed target mid-transfer

    MockSafe internal safe;
    MockRoles internal roles;
    MockHats internal hats;

    function setUp() public virtual {
        // A fork already starts later; never move its clock back.
        if (block.timestamp < START) vm.warp(START);
        _deployTokens();
        users = Users({
            amira: _user("amira"),
            ben: _user("ben"),
            jordan: _user("jordan"),
            alice: _user("alice"),
            bob: _user("bob"),
            investor: _user("investor"),
            eve: _user("eve")
        });
        _deployCompany();
        _deployProtocol();
    }

    function _deployTokens() internal virtual {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        dai = new MockERC20("Dai", "DAI", 18);
        usdt = new MockNoReturnToken();
        falseToken = new MockFalseReturnToken();
        feeToken = new MockFeeOnTransferToken();
        rebasingToken = new MockRebasingToken();
        reentrantToken = new MockReentrantERC20();
        vm.label(address(usdc), "USDC");
        vm.label(address(dai), "DAI");
        vm.label(address(usdt), "USDT (no return)");
        vm.label(address(falseToken), "False-returning token");
        vm.label(address(feeToken), "Fee-on-transfer token");
        vm.label(address(rebasingToken), "Rebasing token");
        vm.label(address(reentrantToken), "Re-entrant token");
    }

    /// @dev The company: a Safe the test owns, Roles, and Hats with Amira as Director. MockSafe stands
    /// for the company Safe behind its Hats Signer Gate: on chain Roles is a module of the Gate, which
    /// forwards to the Safe (D1), never a module of the Safe. Fork_Test wires the real path.
    function _deployCompany() internal virtual {
        safe = new MockSafe(address(this));
        roles = new MockRoles(safe);
        hats = new MockHats();
        safe.enableModule(address(roles));
        hats.setWearer(DIRECTOR_HAT, users.amira, true);
        usdc.mint(address(safe), 1_000_000 * USDC_UNIT);
        vm.label(address(safe), "Company Safe");
        vm.label(address(roles), "Roles");
        vm.label(address(hats), "Hats");
    }

    /// @dev Each slice deploys its contracts here.
    function _deployProtocol() internal virtual { }

    /// @dev A labelled account holding 100 ether and 1,000,000 of each token.
    function _user(string memory name) internal returns (address payable account) {
        account = payable(makeAddr(name));
        vm.deal(account, 100 ether);
        usdc.mint(account, 1_000_000 * USDC_UNIT);
        dai.mint(account, 1_000_000 ether);
        usdt.mint(account, 1_000_000 * USDC_UNIT);
        falseToken.mint(account, 1_000_000 * USDC_UNIT);
        feeToken.mint(account, 1_000_000 * USDC_UNIT);
        rebasingToken.mint(account, 1_000_000 * USDC_UNIT);
        reentrantToken.mint(account, 1_000_000 * USDC_UNIT);
    }
}
