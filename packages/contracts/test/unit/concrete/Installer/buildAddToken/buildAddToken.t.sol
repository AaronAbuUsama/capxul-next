// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { Addresses } from "../../../../fork/Addresses.sol";
import { IInstaller } from "../../../../../src/interfaces/IInstaller.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";
import { IHats } from "../../../../../src/interfaces/external/IHats.sol";
import { IRoles } from "../../../../../src/interfaces/external/IRoles.sol";
import { Installer_Fork_Base } from "../../../../utils/Installer/Installer_Fork_Base.sol";
import { MockBudgets } from "../../../../utils/Installer/MoneyMocks.sol";

/// @notice J12 and B10: a company that pays in USDC adds DAI later. The scope of `send` is rebuilt over both tokens;
/// DAI gets its own allowance; USDC's allowance and what was spent of it are left as they were.
contract BuildAddToken_Installer_Unit_Concrete_Test is Installer_Fork_Base {
    IInstaller.MoneyDeployment internal d;
    IInstaller.Token[] internal existing;

    function _refused(IInstaller.InstallRefusal reason) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IInstaller.InvalidInstall.selector, reason);
    }

    /// @dev Money installed with USDC (10,000 a month, Operations' budget); Jordan runs Operations and has spent 4,000.
    modifier installed() {
        d = _deployMoney();
        IInstaller.MoneyInstall memory p = _moneyInstall(d);
        // Top budgets far above the ceilings, so Roles' ceiling is what refuses a spend.
        p.tokens[0] = _token(address(usdc), 10_000e6, BUDGET_MONTH, d.officerHats[1]);
        p.tokens[0].topAmount = 1_000_000e6;
        existing.push(p.tokens[0]);
        _ownersBatch(installer.buildMoney(p));
        Call[] memory mint = new Call[](1);
        mint[0] = Call(Addresses.HATS, 0, abi.encodeCall(IHats.mintHat, (d.officerHats[1], users.jordan)));
        _execApproved(address(companySafe), Addresses.MULTI_SEND_CALL_ONLY_141, _multiSend(mint), DELEGATECALL);
        vm.prank(users.jordan);
        budgetsMock.spend(0, users.alice, 4000e6, 0, keccak256("usdc invoice"), bytes32(uint256(1)));
        _;
    }

    function _addDai(uint128 ceiling, uint8 period) internal view returns (IInstaller.AddToken memory p) {
        p = IInstaller.AddToken({
            safe: address(companySafe),
            roles: d.roles,
            existing: existing,
            token: _token(address(dai), ceiling, period, d.officerHats[1])
        });
        p.token.topAmount = 1_000_000 ether;
    }

    function test_WhenTheSafeIsZeroOrHasNoCode() external installed {
        // it should revert with InvalidInstall
        IInstaller.AddToken memory p = _addDai(5000 ether, BUDGET_MONTH);
        p.safe = address(0);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.SafeInvalid));
        installer.buildAddToken(p);
        p.safe = makeAddr("no code");
        vm.expectRevert(_refused(IInstaller.InstallRefusal.SafeInvalid));
        installer.buildAddToken(p);
    }

    function test_WhenTheRolesDoesNotNameTheSafe() external installed {
        // it should revert with InvalidInstall
        IInstaller.MoneyDeploy memory other = _moneyDeploy();
        other.safe = address(jordanSafe);
        other.salt = bytes32(uint256(2));
        IInstaller.MoneyDeployment memory o = installer.deployMoney(other);
        IInstaller.AddToken memory p = _addDai(5000 ether, BUDGET_MONTH);
        p.roles = o.roles;
        vm.expectRevert(_refused(IInstaller.InstallRefusal.RolesNotForSafe));
        installer.buildAddToken(p);
        p.roles = address(0);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.RolesNotForSafe));
        installer.buildAddToken(p);
    }

    function test_WhenTheNewTokenIsAlreadyGivenOrItsHatIs0OrItsPeriodIsAboveBUDGET_YEAR() external installed {
        // it should revert with InvalidInstall
        IInstaller.AddToken memory p = _addDai(5000 ether, BUDGET_MONTH);
        p.token.token = address(usdc);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.DuplicateToken));
        installer.buildAddToken(p);

        // USDC already pays on the role even when the caller leaves it out of `existing`: adding it again would
        // rewrite its allowance and hand back the 4,000 spent this period (B10). Its ceiling moves only through
        // buildSetCeiling.
        p = _addDai(5000 ether, BUDGET_MONTH);
        p.existing = new IInstaller.Token[](0);
        p.token.token = address(usdc);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.DuplicateToken));
        installer.buildAddToken(p);

        // The same when USDC's ceiling has been set to zero: Roles stores a zero max refill as type(uint128).max, so
        // the allowance still reads as installed.
        _ownersBatch(
            installer.buildSetCeiling(
                IInstaller.SetCeiling({ safe: address(companySafe), roles: d.roles, token: address(usdc), ceiling: 0 })
            )
        );
        vm.expectRevert(_refused(IInstaller.InstallRefusal.DuplicateToken));
        installer.buildAddToken(p);

        p = _addDai(5000 ether, BUDGET_MONTH);
        p.token.topHat = 0;
        vm.expectRevert(_refused(IInstaller.InstallRefusal.ZeroTopHat));
        installer.buildAddToken(p);

        p = _addDai(5000 ether, BUDGET_YEAR + 1);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.BudgetPeriodInvalid));
        installer.buildAddToken(p);
    }

    modifier whenTheInputsAreValid() {
        _;
    }

    function test_WhenTheInputsAreValid() external whenTheInputsAreValid installed {
        IInstaller.Call[] memory calls = installer.buildAddToken(_addDai(5000 ether, BUDGET_QUARTER));
        assertEq(calls.length, 6, "approve scope x2, send scope x2, allowance, top budget");

        // it should scope approve on the new token and rebuild the send scope over every token
        assertEq(calls[0].data, abi.encodeCall(IRoles.scopeTarget, (PAYOUT_ROLE_KEY, address(dai))), "dai scoped");
        assertEq(bytes4(calls[1].data), IRoles.scopeFunction.selector, "dai approve");
        assertEq(calls[2].data, abi.encodeCall(IRoles.scopeTarget, (PAYOUT_ROLE_KEY, address(paymentsMock))), "send");
        assertEq(bytes4(calls[3].data), IRoles.scopeFunction.selector, "send rebuilt");
        assertTrue(
            _contains(calls[3].data, abi.encode(address(usdc))) && _contains(calls[3].data, abi.encode(address(dai))),
            "the send scope names both tokens"
        );

        // it should set the new token's allowance at its ceiling for its budget period
        assertEq(
            calls[4].data,
            abi.encodeCall(
                IRoles.setAllowance,
                (_allowanceKey(address(dai)), 5000 ether, 5000 ether, 5000 ether, uint64(92 days), uint64(0))
            ),
            "DAI: 92 days, quarterly"
        );

        // it should create the new token's top budget
        assertEq(
            calls[5].data,
            abi.encodeCall(
                MockBudgets.createTopBudget, (address(dai), BUDGET_QUARTER, 1_000_000 ether, d.officerHats[1])
            ),
            "DAI top budget"
        );
        for (uint256 i; i < calls.length; ++i) {
            assertEq(calls[i].value, 0, "no ETH");
            assertTrue(calls[i].to != address(installer), "never the Installer");
        }
    }

    function test_GivenTheSafeExecutesTheCalls() external whenTheInputsAreValid installed {
        (,,, uint128 usdcBefore,) = _rolesView().allowances(_allowanceKey(address(usdc)));
        assertEq(usdcBefore, 6000e6, "4,000 of USDC spent");
        _ownersBatch(installer.buildAddToken(_addDai(5000 ether, BUDGET_MONTH)));

        // it should let the new token be paid within its ceiling
        (uint128 refill, uint128 maxRefill, uint64 period, uint128 balance,) =
            _rolesView().allowances(_allowanceKey(address(dai)));
        assertTrue(refill == 5000 ether && maxRefill == 5000 ether && balance == 5000 ether, "DAI at its ceiling");
        assertEq(period, 31 days, "monthly");
        assertEq(budgetsMock.budgetCount(), 2, "the DAI top budget exists");
        uint256 before = dai.balanceOf(users.alice);
        vm.prank(users.jordan);
        budgetsMock.spend(1, users.alice, 5000 ether, 0, keccak256("dai invoice"), bytes32(uint256(2)));
        assertEq(dai.balanceOf(users.alice), before + 5000 ether, "DAI paid");
        vm.prank(users.jordan);
        vm.expectPartialRevert(ROLES_CONDITION_VIOLATION);
        budgetsMock.spend(1, users.alice, 1, 0, keccak256("over"), bytes32(uint256(3)));

        // it should leave the other token's allowance and what was spent as they were
        (,,, uint128 usdcAfter,) = _rolesView().allowances(_allowanceKey(address(usdc)));
        assertEq(usdcAfter, usdcBefore, "USDC balance untouched by adding DAI and spending it");

        // it should still let the other token be paid
        vm.prank(users.jordan);
        budgetsMock.spend(0, users.bob, 6000e6, 0, keccak256("usdc again"), bytes32(uint256(4)));
        vm.prank(users.jordan);
        vm.expectPartialRevert(ROLES_CONDITION_VIOLATION);
        budgetsMock.spend(0, users.bob, 1, 0, keccak256("usdc over"), bytes32(uint256(5)));
    }

    function _allowanceKey(address token) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("v4-payout-ceiling:", token));
    }

    /// @dev Whether `needle` occurs in `haystack` at any offset.
    function _contains(bytes memory haystack, bytes memory needle) internal pure returns (bool) {
        for (uint256 i; i + needle.length <= haystack.length; ++i) {
            bool same = true;
            for (uint256 j; same && j < needle.length; ++j) {
                same = haystack[i + j] == needle[j];
            }
            if (same) return true;
        }
        return false;
    }
}
