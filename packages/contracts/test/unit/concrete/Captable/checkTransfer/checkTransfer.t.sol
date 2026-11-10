// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";
import { MockShareClass, MockTransferRule } from "../../../../utils/Captable/CaptableMocks.sol";

/// @dev The lock first (C-25: compare without subtracting), then the rule (Firm `BouncerChecker`, BC-1 to BC-4,
/// ported from Firm `Captable.t.sol:741-857`). Calls come from the class token, as on every ordinary transfer.
contract CheckTransfer_Captable_Unit_Concrete_Test is Captable_Test {
    address internal token;

    function setUp() public override {
        super.setUp();
        try this.fixture() { } catch { } // red stub: each test fails on its own call
    }

    /// @dev Amira holds 1,000 Common; Ben holds 10 Series A; Bob holds nothing.
    function fixture() external {
        _issue(COMMON, users.amira, 1000);
        _issue(SERIES_A, users.ben, 10);
        token = address(_token(COMMON));
    }

    function _check(address from, address to, uint256 amount) internal view {
        captable.checkTransfer(COMMON, from, to, amount);
    }

    function _expectNotAllowed(address from, address to) internal {
        vm.expectRevert(abi.encodeWithSelector(ICaptable.TransferNotAllowed.selector, COMMON, from, to));
    }

    function test_WhenTheCallerIsNotTheClasssToken() external {
        _setRule(COMMON, ICaptable.TransferRule.AllowAll, address(0));

        // it should revert with OnlyModule
        vm.prank(users.eve);
        vm.expectRevert(ICaptable.OnlyModule.selector);
        captable.checkTransfer(COMMON, users.amira, users.bob, 1);

        // Another class's token is not this class's token either.
        vm.prank(address(_token(SERIES_A)));
        vm.expectRevert(ICaptable.OnlyModule.selector);
        captable.checkTransfer(COMMON, users.amira, users.bob, 1);
    }

    function test_WhenTheAmountWouldDipIntoTheSendersLockedShares() external {
        _setRule(COMMON, ICaptable.TransferRule.AllowAll, address(0));
        _lock(COMMON, users.amira, 600);

        // it should revert with SharesLocked
        vm.prank(token);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.SharesLocked.selector, users.amira, uint128(600)));
        _check(users.amira, users.bob, 401);

        // Through the token, the refusal is bubbled.
        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.SharesLocked.selector, users.amira, uint128(600)));
        MockShareClass(token).transfer(users.bob, 401);

        vm.prank(token);
        _check(users.amira, users.bob, 400); // exactly the unlocked shares
    }

    function test_WhenTheAmountIsMoreThanTheSendersBalance() external {
        _setRule(COMMON, ICaptable.TransferRule.AllowAll, address(0));
        _lock(COMMON, users.amira, 600);

        // it should revert with SharesLocked and never panic
        vm.prank(token);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.SharesLocked.selector, users.amira, uint128(600)));
        _check(users.amira, users.bob, 1001);

        vm.prank(token);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.SharesLocked.selector, users.amira, uint128(600)));
        _check(users.amira, users.bob, type(uint256).max);

        _lock(COMMON, users.amira, 0);
        vm.prank(token);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.SharesLocked.selector, users.amira, uint128(0)));
        _check(users.amira, users.bob, 1001);
    }

    function test_GivenTheSenderHasNoGrant() external {
        // it should go on to the rule with nothing locked
        vm.prank(token);
        _expectNotAllowed(users.amira, users.bob); // deny all decides, not the lock
        _check(users.amira, users.bob, 1000);

        _setRule(COMMON, ICaptable.TransferRule.AllowAll, address(0));
        vm.prank(token);
        _check(users.amira, users.bob, 1000); // the whole balance
    }

    function test_WhenTheRuleIsDenyAll() external {
        // it should revert with TransferNotAllowed
        vm.prank(token);
        _expectNotAllowed(users.amira, users.ben);
        _check(users.amira, users.ben, 1);

        vm.prank(users.amira);
        _expectNotAllowed(users.amira, users.ben);
        MockShareClass(token).transfer(users.ben, 1);
    }

    function test_WhenTheRuleIsAllowAll() external {
        _setRule(COMMON, ICaptable.TransferRule.AllowAll, address(0));

        // it should allow it
        vm.prank(token);
        _check(users.amira, users.bob, 1);
        vm.prank(users.amira);
        MockShareClass(token).transfer(users.bob, 250);
        assertEq(_token(COMMON).balanceOf(users.bob), 250, "moved");
    }

    modifier whenTheRuleIsToClassShareholders() {
        _setRule(COMMON, ICaptable.TransferRule.ToClassShareholders, address(0));
        _;
    }

    function test_WhenTheReceiverAlreadyHoldsThisClass() external whenTheRuleIsToClassShareholders {
        _issue(COMMON, users.bob, 1);

        // it should allow it
        vm.prank(token);
        _check(users.amira, users.bob, 10);
    }

    function test_WhenTheReceiverDoesNot() external whenTheRuleIsToClassShareholders {
        // it should revert with TransferNotAllowed
        vm.prank(token);
        _expectNotAllowed(users.amira, users.ben); // Ben holds Series A, not Common
        _check(users.amira, users.ben, 10);
    }

    modifier whenTheRuleIsToAnyShareholder() {
        _setRule(COMMON, ICaptable.TransferRule.ToAnyShareholder, address(0));
        _;
    }

    function test_WhenTheReceiverHoldsAnyClass() external whenTheRuleIsToAnyShareholder {
        // it should allow it
        vm.prank(token);
        _check(users.amira, users.ben, 10); // Ben holds Series A
    }

    function test_WhenTheReceiverHoldsNone() external whenTheRuleIsToAnyShareholder {
        // it should revert with TransferNotAllowed
        vm.prank(token);
        _expectNotAllowed(users.amira, users.bob);
        _check(users.amira, users.bob, 10);
    }

    modifier whenTheRuleIsCustom() {
        _setRule(COMMON, ICaptable.TransferRule.Custom, address(rule));
        _;
    }

    function test_WhenTheRuleContractReturnsTrue() external whenTheRuleIsCustom {
        rule.setMode(MockTransferRule.Mode.Allow);

        // it should allow it
        vm.prank(token);
        _check(users.amira, users.bob, 10);
    }

    function test_WhenTheRuleContractReturnsFalse() external whenTheRuleIsCustom {
        rule.setMode(MockTransferRule.Mode.Deny);

        // it should revert with TransferNotAllowed
        vm.prank(token);
        _expectNotAllowed(users.amira, users.bob);
        _check(users.amira, users.bob, 10);
    }

    function test_WhenTheRuleContractReverts() external whenTheRuleIsCustom {
        rule.setMode(MockTransferRule.Mode.Revert);

        // it should revert with TransferNotAllowed
        vm.prank(token);
        _expectNotAllowed(users.amira, users.bob);
        _check(users.amira, users.bob, 10);
    }

    function test_WhenTheRuleContractReturnsMalformedData() external whenTheRuleIsCustom {
        rule.setMode(MockTransferRule.Mode.Malformed);

        // it should revert with TransferNotAllowed
        vm.prank(token);
        _expectNotAllowed(users.amira, users.bob);
        _check(users.amira, users.bob, 10);

        // A rule address with no code returns nothing: also refused.
        _setRule(COMMON, ICaptable.TransferRule.Custom, makeAddr("no code"));
        vm.prank(token);
        _expectNotAllowed(users.amira, users.bob);
        _check(users.amira, users.bob, 10);
    }

    function test_WhenTheRuleContractBurnsAllTheGasItIsGiven() external whenTheRuleIsCustom {
        rule.setMode(MockTransferRule.Mode.BurnGas);
        uint256 cap = captable.CUSTOM_RULE_GAS();

        // it should stop it at the gas cap and revert with TransferNotAllowed
        uint256 gasBefore = gasleft();
        vm.prank(token);
        _expectNotAllowed(users.amira, users.bob);
        captable.checkTransfer{ gas: 5_000_000 }(COMMON, users.amira, users.bob, 10);
        uint256 used = gasBefore - gasleft();
        assertLt(used, cap + 200_000, "the rule got at most the cap");
        assertGt(5_000_000, cap + 200_000, "the caller had more gas than the cap");
    }
}
