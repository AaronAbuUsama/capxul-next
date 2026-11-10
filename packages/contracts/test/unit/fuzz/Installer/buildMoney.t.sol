// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IInstaller } from "../../../../src/interfaces/IInstaller.sol";
import { IHatsSignerGate } from "../../../../src/interfaces/external/IHatsSignerGate.sol";
import { IRoles } from "../../../../src/interfaces/external/IRoles.sol";
import { ISafe } from "../../../../src/interfaces/external/ISafe.sol";
import { Installer_Hermetic_Base } from "../../../utils/Installer/Installer_Hermetic_Base.sol";

/// @notice buildMoney over its input ranges (trees/Installer/buildMoney.tree): token lists, ceilings and budget
/// periods, the Safe's modules and its owners. The batch's effect on the real Safe is the fork test's.
contract BuildMoney_Installer_Unit_Fuzz_Test is Installer_Hermetic_Base {
    /// @dev Any token list with one token twice is refused.
    function testFuzz_RevertWhen_ATokenIsGivenTwice(uint8 count, uint256 at, uint256 other) external {
        uint256 n = bound(count, 2, 8);
        IInstaller.Token[] memory tokens = _tokens(n, 1e6, 0);
        uint256 i = bound(at, 0, n - 1);
        uint256 j = bound(other, 0, n - 1);
        if (j == i) j = (i + 1) % n;
        tokens[i].token = tokens[j].token;
        IInstaller.MoneyInstall memory p = _moneyInstall(_coDirectors(0, 0), tokens);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.DuplicateToken));
        installer.buildMoney(p);
    }

    /// @dev Any token list with one top budget's hat 0 is refused.
    function testFuzz_RevertWhen_ATopBudgetsHatIsZero(uint8 count, uint256 at) external {
        uint256 n = bound(count, 1, 8);
        IInstaller.Token[] memory tokens = _tokens(n, 1e6, 0);
        tokens[bound(at, 0, n - 1)].topHat = 0;
        IInstaller.MoneyInstall memory p = _moneyInstall(_coDirectors(0, 0), tokens);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.ZeroTopHat));
        installer.buildMoney(p);
    }

    /// @dev Any token list with one top budget's period above `BUDGET_YEAR` is refused before any call is built (J11).
    function testFuzz_RevertWhen_ATopBudgetsPeriodIsAboveBudgetYear(uint8 count, uint256 at, uint8 period) external {
        uint256 n = bound(count, 1, 8);
        IInstaller.Token[] memory tokens = _tokens(n, 1e6, 0);
        tokens[bound(at, 0, n - 1)].budgetPeriod = uint8(bound(period, 3, type(uint8).max));
        IInstaller.MoneyInstall memory p = _moneyInstall(_coDirectors(0, 0), tokens);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.BudgetPeriodInvalid));
        installer.buildMoney(p);
    }

    /// @dev Each token gets exactly one allowance: key from the token, balance, max refill and refill all the
    /// ceiling, period the budget period rounded up (31, 92 or 366 days), starting now.
    function testFuzz_SetsEachTokensAllowanceAtItsCeilingForItsPeriod(
        uint8 count,
        uint128 ceiling,
        uint8 periodSeed
    )
        external
    {
        uint256 n = bound(count, 1, 6);
        IInstaller.Token[] memory tokens = _tokens(n, ceiling, periodSeed);
        IInstaller.Call[] memory calls = installer.buildMoney(_moneyInstall(_coDirectors(0, 0), tokens));
        assertEq(_countSelector(calls, address(rolesStub), IRoles.setAllowance.selector), n, "one allowance per token");
        for (uint256 i; i < n; ++i) {
            bytes32 key = keccak256(abi.encodePacked("v4-payout-ceiling:", tokens[i].token));
            assertEq(installer.payoutAllowanceKey(tokens[i].token), key, "the token's allowance key");
            assertTrue(
                _has(
                    calls,
                    address(rolesStub),
                    abi.encodeCall(
                        IRoles.setAllowance,
                        (key, ceiling, ceiling, ceiling, _periodSeconds(tokens[i].budgetPeriod), uint64(0))
                    )
                ),
                "setAllowance at the ceiling for the budget period"
            );
        }
    }

    /// @dev Whatever modules the Safe has, the batch disables each one first, every `prev` correct for the list
    /// at that point, and never enables anything but the Gate.
    function testFuzz_DisablesEveryModuleFirst(uint8 count) external {
        uint256 n = bound(count, 1, 12);
        address[] memory modules = new address[](n);
        for (uint256 i; i < n; ++i) {
            modules[i] = makeAddr(string.concat("module ", vm.toString(i)));
        }
        companySafe.setModules(modules);
        IInstaller.Call[] memory calls = installer.buildMoney(_moneyInstall(_coDirectors(0, 0), _tokens(1, 1e6, 0)));

        address[] memory live = modules;
        uint256 liveCount = n;
        for (uint256 c; c < n; ++c) {
            assertEq(calls[c].to, address(companySafe), "a Safe call");
            assertEq(bytes4(calls[c].data), ISafe.disableModule.selector, "a disableModule");
            (address prev, address module) = abi.decode(_args(calls[c].data), (address, address));
            uint256 at = type(uint256).max;
            for (uint256 k; k < liveCount; ++k) {
                if (live[k] == module) at = k;
            }
            assertTrue(at != type(uint256).max, "an enabled module");
            assertEq(prev, at == 0 ? SENTINEL : live[at - 1], "its predecessor in the list");
            for (uint256 k = at; k + 1 < liveCount; ++k) {
                live[k] = live[k + 1];
            }
            --liveCount;
        }
        assertEq(liveCount, 0, "every module disabled");
        assertEq(_countSelector(calls, address(companySafe), ISafe.disableModule.selector), n, "nothing else");
        assertEq(_countSelector(calls, address(companySafe), ISafe.enableModule.selector), 1, "only the Gate");
    }

    /// @dev Whatever the number of co-Directors and stray owners, every founding Director is claimed and every
    /// other owner removed.
    function testFuzz_ClaimsEveryDirectorAndRemovesEveryOtherOwner(uint8 coCount, uint8 strayCount) external {
        uint256 n = bound(coCount, 0, MAX_CO_DIRECTORS);
        uint256 strays = bound(strayCount, 0, 5);
        address[] memory co = _coDirectors(n, strays);
        IInstaller.Call[] memory calls = installer.buildMoney(_moneyInstall(co, _tokens(1, 1e6, 0)));

        assertEq(
            _countSelector(calls, address(gateStub), IHatsSignerGate.claimSignerFor.selector), 1 + n, "one claim each"
        );
        assertTrue(
            _has(
                calls,
                address(gateStub),
                abi.encodeCall(IHatsSignerGate.claimSignerFor, (DIRECTOR, address(founderSafe)))
            ),
            "the founder claimed"
        );
        for (uint256 i; i < n; ++i) {
            assertTrue(
                _has(calls, address(gateStub), abi.encodeCall(IHatsSignerGate.claimSignerFor, (DIRECTOR, co[i]))),
                "each co-Director claimed"
            );
        }
        assertEq(
            _countSelector(calls, address(gateStub), IHatsSignerGate.removeSigner.selector), strays, "one removal each"
        );
        address[] memory owners = companySafe.getOwners();
        for (uint256 i = 1 + n; i < owners.length; ++i) {
            assertTrue(
                _has(calls, address(gateStub), abi.encodeCall(IHatsSignerGate.removeSigner, (owners[i]))),
                "each stray owner removed"
            );
        }
    }

    /// @dev The allowance key is `keccak256("v4-payout-ceiling:" ++ token)` for every token (B10's per-token keys).
    function testFuzz_PayoutAllowanceKey(address token) external view {
        assertEq(
            installer.payoutAllowanceKey(token), keccak256(abi.encodePacked("v4-payout-ceiling:", token)), "the key"
        );
        assertEq(installer.PAYOUT_ROLE_KEY(), PAYOUT_ROLE_KEY, "the payout role");
    }

    function _args(bytes memory data) internal pure returns (bytes memory out) {
        out = new bytes(data.length - 4);
        for (uint256 i; i < out.length; ++i) {
            out[i] = data[i + 4];
        }
    }
}
