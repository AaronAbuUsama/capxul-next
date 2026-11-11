// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { Addresses } from "../../../../fork/Addresses.sol";
import { IInstaller } from "../../../../../src/interfaces/IInstaller.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";
import { IHats } from "../../../../../src/interfaces/external/IHats.sol";
import { IHatsSignerGate } from "../../../../../src/interfaces/external/IHatsSignerGate.sol";
import { IRoles } from "../../../../../src/interfaces/external/IRoles.sol";
import { ISafe } from "../../../../../src/interfaces/external/ISafe.sol";
import { Installer_Fork_Base } from "../../../../utils/Installer/Installer_Fork_Base.sol";
import { IHatsExtra, ISafeLike } from "../../../../utils/Installer/ExternalViews.sol";
import { FaultyInstallerGate, MockBudgets } from "../../../../utils/Installer/MoneyMocks.sol";

/// @notice spec/installer.md step 2: the batch the company Safe's current owners sign, run on the real Safe 1.4.1,
/// MultiSendCallOnly 1.4.1, Roles 2.1, Hats and Hats Signer Gate v2.
contract BuildMoney_Installer_Unit_Concrete_Test is Installer_Fork_Base {
    IInstaller.MoneyDeployment internal d;

    /// @dev Each test deploys first, so against the stub every test fails on its own (no setUp failure).
    modifier deployed() {
        d = _deployMoney();
        _;
    }

    function _refused(IInstaller.InstallRefusal reason) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IInstaller.InvalidInstall.selector, reason);
    }

    function test_WhenTheSafeOrTheFoundersSafeIsZeroOrHasNoCode() external deployed {
        // it should revert with InvalidInstall
        address noCode = makeAddr("no code");
        IInstaller.MoneyInstall memory p = _moneyInstall(d);

        p.safe = address(0);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.SafeInvalid));
        installer.buildMoney(p);
        p.safe = noCode;
        vm.expectRevert(_refused(IInstaller.InstallRefusal.SafeInvalid));
        installer.buildMoney(p);

        p = _moneyInstall(d);
        p.founderSafe = address(0);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.FounderSafeInvalid));
        installer.buildMoney(p);
        p.founderSafe = noCode;
        vm.expectRevert(_refused(IInstaller.InstallRefusal.FounderSafeInvalid));
        installer.buildMoney(p);
    }

    function test_WhenTheDeploymentsRolesOrGateDoesNotNameTheSafe() external deployed {
        // it should revert with InvalidInstall
        // Another company's deployment, made for Jordan's Safe.
        IInstaller.MoneyDeploy memory other = _moneyDeploy();
        other.safe = address(jordanSafe);
        other.salt = bytes32(uint256(2));
        vm.prank(users.eve);
        IInstaller.MoneyDeployment memory o = installer.deployMoney(other);

        IInstaller.MoneyInstall memory p = _moneyInstall(d);
        p.deployment.roles = o.roles;
        vm.expectRevert(_refused(IInstaller.InstallRefusal.RolesNotForSafe));
        installer.buildMoney(p);

        p = _moneyInstall(d);
        p.deployment.gate = o.gate;
        vm.expectRevert(_refused(IInstaller.InstallRefusal.GateNotForSafe));
        installer.buildMoney(p);
    }

    function test_WhenTheFoundersSafeOrACo_DirectorsSafeDoesNotWearTheDirectorHat() external deployed {
        // it should revert with InvalidInstall
        IInstaller.MoneyInstall memory p = _moneyInstall(d);
        p.founderSafe = address(jordanSafe);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.FounderNotDirector));
        installer.buildMoney(p);

        p = _moneyInstall(d);
        p.coDirectors[0] = address(jordanSafe);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.FounderNotDirector));
        installer.buildMoney(p);

        // A Director whose hat lapsed no longer wears it.
        p = _moneyInstall(d);
        _lapse(address(benSafe));
        vm.expectRevert(_refused(IInstaller.InstallRefusal.FounderNotDirector));
        installer.buildMoney(p);
    }

    function test_WhenTheFoundersSafeOrACo_DirectorsSafeIsTheCompanySafe() external deployed {
        // it should revert with InvalidInstall
        IInstaller.MoneyInstall memory p = _moneyInstall(d);
        p.founderSafe = address(companySafe);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.FounderSafeInvalid));
        installer.buildMoney(p);

        p = _moneyInstall(d);
        p.coDirectors[0] = address(companySafe);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.CoDirectorInvalid));
        installer.buildMoney(p);
    }

    function test_WhenACo_DirectorsSafeIsZeroOrHasNoCodeOrIsRepeatedOrIsTheFoundersSafe() external deployed {
        // it should revert with InvalidInstall (before any call is built: a repeated Director would make the second
        // claimSignerFor revert ReregistrationNotAllowed inside the batch, and miscount the founding Directors)
        IInstaller.MoneyInstall memory p = _moneyInstall(d);
        p.coDirectors[0] = address(0);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.CoDirectorInvalid));
        installer.buildMoney(p);

        p.coDirectors[0] = makeAddr("no code");
        vm.expectRevert(_refused(IInstaller.InstallRefusal.CoDirectorInvalid));
        installer.buildMoney(p);

        p.coDirectors[0] = address(founderSafe);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.CoDirectorInvalid));
        installer.buildMoney(p);

        p.coDirectors = new address[](2);
        p.coDirectors[0] = address(benSafe);
        p.coDirectors[1] = address(benSafe);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.CoDirectorInvalid));
        installer.buildMoney(p);
    }

    function test_WhenTheGatesThresholdMinIsAboveTheNumberOfFoundingDirectors() external deployed {
        // it should revert with InvalidInstall
        // The Gate is 2-of-2 (Amira and Ben). A batch naming Amira alone would remove Ben's unregistered owner
        // slot and leave one owner under a minimum of two: the Gate then refuses every Safe transaction with
        // ThresholdTooLow (HatsSignerGate.sol:484), so the Board could never sign again.
        IInstaller.MoneyInstall memory p = _moneyInstall(d);
        p.coDirectors = new address[](0);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.ThresholdInvalid));
        installer.buildMoney(p);
    }

    function test_WhenNoTokenIsGivenOrATokenIsGivenTwice() external deployed {
        // it should revert with InvalidInstall
        IInstaller.MoneyInstall memory p = _moneyInstall(d);
        p.tokens = new IInstaller.Token[](0);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.NoToken));
        installer.buildMoney(p);

        p.tokens = new IInstaller.Token[](3);
        p.tokens[0] = _token(address(usdc), CEILING, BUDGET_MONTH, d.boardTopHat);
        p.tokens[1] = _token(address(dai), 1000 ether, BUDGET_YEAR, d.boardTopHat);
        p.tokens[2] = _token(address(usdc), 1, BUDGET_QUARTER, d.officerHats[0]);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.DuplicateToken));
        installer.buildMoney(p);
    }

    function test_WhenATopBudgetsHatIs0() external deployed {
        // it should revert with InvalidInstall
        IInstaller.MoneyInstall memory p = _moneyInstall(d);
        p.tokens = new IInstaller.Token[](2);
        p.tokens[0] = _token(address(usdc), CEILING, BUDGET_MONTH, d.boardTopHat);
        p.tokens[1] = _token(address(dai), 1000 ether, BUDGET_YEAR, 0);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.ZeroTopHat));
        installer.buildMoney(p);
    }

    function test_WhenATopBudgetsPeriodIsAboveBUDGET_YEAR() external deployed {
        // it should revert with InvalidInstall (J11), before any call is built
        IInstaller.MoneyInstall memory p = _moneyInstall(d);
        p.tokens[0].budgetPeriod = BUDGET_YEAR + 1;
        vm.expectRevert(_refused(IInstaller.InstallRefusal.BudgetPeriodInvalid));
        installer.buildMoney(p);
        p.tokens[0].budgetPeriod = type(uint8).max;
        vm.expectRevert(_refused(IInstaller.InstallRefusal.BudgetPeriodInvalid));
        installer.buildMoney(p);
    }

    function test_WhenAFaultyGateReturnsAnInvalidOrChangingThreshold() external {
        // it should cap the generated Safe threshold at the number of founding Directors
        address[] memory owners = new address[](2);
        owners[0] = address(founderSafe);
        owners[1] = address(benSafe);
        address own = address(_newCapxulSafe(owners, 1, 11));
        IInstaller.MoneyDeploy memory dp = _moneyDeploy();
        dp.safe = own;
        IInstaller.MoneyInstall memory p = _moneyInstall(_deployMoney(dp));
        p.safe = own;

        for (uint256 i; i < 2; ++i) {
            FaultyInstallerGate faulty = new FaultyInstallerGate(own, i == 1);
            p.deployment.gate = address(faulty);
            if (i == 1) {
                vm.coolSlot(address(faulty), bytes32(0));
                assertEq(faulty.thresholdConfig().min, 1, "cold read: minimum accepted by validation");
                vm.coolSlot(address(faulty), bytes32(0));
            }
            IInstaller.Call[] memory calls = installer.buildMoney(p);
            _assertHas(calls, own, abi.encodeWithSignature("changeThreshold(uint256)", 2), "capped threshold");
        }
    }

    modifier whenTheInstallIsValid() {
        _;
    }

    function test_WhenTheInstallIsValid() external whenTheInstallIsValid deployed {
        IInstaller.MoneyInstall memory p = _moneyInstall(d);
        p.tokens = new IInstaller.Token[](2);
        p.tokens[0] = _token(address(usdc), CEILING, BUDGET_MONTH, d.boardTopHat);
        p.tokens[1] = _token(address(dai), 2000 ether, BUDGET_QUARTER, d.officerHats[1]);
        IInstaller.Call[] memory calls = installer.buildMoney(p);
        address safe = address(companySafe);

        // it should first disable every module the Safe has now including the 4337 module
        assertEq(calls[0].to, safe, "first call is to the Safe");
        assertEq(calls[0].data, abi.encodeCall(ISafe.disableModule, (SENTINEL, SAFE_4337_MODULE)), "4337 module first");
        assertEq(_countSelector(calls, safe, ISafe.disableModule.selector), 1, "one module to disable");

        // it should point Roles at the Gate
        uint256 setTarget = _find(calls, d.roles, abi.encodeCall(IRoles.setTarget, (d.gate)));
        assertTrue(setTarget != type(uint256).max, "roles.setTarget(gate)");

        // it should assign Budgets as the only member of the payout role
        bytes32[] memory keys = new bytes32[](1);
        keys[0] = PAYOUT_ROLE_KEY;
        bool[] memory on = new bool[](1);
        on[0] = true;
        _assertHas(
            calls, d.roles, abi.encodeCall(IRoles.assignRoles, (address(budgetsMock), keys, on)), "Budgets assigned"
        );
        assertEq(_countSelector(calls, d.roles, IRoles.assignRoles.selector), 1, "no other member");

        // it should scope approve to Payments and send to each token's item
        _assertHas(calls, d.roles, abi.encodeCall(IRoles.scopeTarget, (PAYOUT_ROLE_KEY, address(usdc))), "usdc scoped");
        _assertHas(calls, d.roles, abi.encodeCall(IRoles.scopeTarget, (PAYOUT_ROLE_KEY, address(dai))), "dai scoped");
        _assertHas(
            calls, d.roles, abi.encodeCall(IRoles.scopeTarget, (PAYOUT_ROLE_KEY, address(paymentsMock))), "Payments"
        );
        _assertScoped(calls, address(usdc), IERC20.approve.selector);
        _assertScoped(calls, address(dai), IERC20.approve.selector);
        _assertScoped(calls, address(paymentsMock), IPayments.send.selector);
        assertEq(_countSelector(calls, d.roles, IRoles.scopeFunction.selector), 3, "approve x2, send x1");

        // it should set one allowance per token at its ceiling for its budget period
        _assertHas(
            calls,
            d.roles,
            abi.encodeCall(
                IRoles.setAllowance,
                (installerKey(address(usdc)), CEILING, CEILING, CEILING, uint64(31 days), uint64(0))
            ),
            "USDC ceiling, monthly budget: 31 days"
        );
        _assertHas(
            calls,
            d.roles,
            abi.encodeCall(
                IRoles.setAllowance,
                (installerKey(address(dai)), 2000 ether, 2000 ether, 2000 ether, uint64(92 days), uint64(0))
            ),
            "DAI ceiling, quarterly budget: 92 days"
        );
        assertEq(_countSelector(calls, d.roles, IRoles.setAllowance.selector), 2, "one allowance per token");

        // it should configure Budgets for the Safe
        uint256 configure =
            _find(calls, address(budgetsMock), abi.encodeCall(MockBudgets.configure, (d.roles, PAYOUT_ROLE_KEY)));
        assertTrue(configure != type(uint256).max, "budgets.configure(roles, key)");
        assertGt(configure, setTarget, "configure after Roles points at the Gate (Budgets checks the target)");

        // it should create one top budget per token with its hat
        uint256 usdcBudget = _find(
            calls,
            address(budgetsMock),
            abi.encodeCall(MockBudgets.createTopBudget, (address(usdc), BUDGET_MONTH, CEILING, d.boardTopHat))
        );
        uint256 daiBudget = _find(
            calls,
            address(budgetsMock),
            abi.encodeCall(MockBudgets.createTopBudget, (address(dai), BUDGET_QUARTER, 2000 ether, d.officerHats[1]))
        );
        assertTrue(usdcBudget != type(uint256).max && daiBudget != type(uint256).max, "both top budgets");
        assertGt(usdcBudget, configure, "top budgets after configure");

        // it should enable the Gate as module and then set it as guard
        uint256 enable = _find(calls, safe, abi.encodeCall(ISafe.enableModule, (d.gate)));
        uint256 guard = _find(calls, safe, abi.encodeCall(ISafe.setGuard, (d.gate)));
        assertTrue(enable != type(uint256).max && guard != type(uint256).max, "enableModule and setGuard");
        assertEq(guard, enable + 1, "setGuard right after enableModule");
        assertGt(enable, 0, "after the old modules are gone");

        // it should claim every founding Director's Safe as signer and remove every other owner
        uint256 claimAmira =
            _find(calls, d.gate, abi.encodeCall(IHatsSignerGate.claimSignerFor, (d.directorHat, address(founderSafe))));
        uint256 claimBen =
            _find(calls, d.gate, abi.encodeCall(IHatsSignerGate.claimSignerFor, (d.directorHat, address(benSafe))));
        uint256 remove = _find(calls, d.gate, abi.encodeCall(IHatsSignerGate.removeSigner, (strayOwner)));
        assertTrue(claimAmira != type(uint256).max && claimBen != type(uint256).max, "both founders claimed");
        assertTrue(remove != type(uint256).max, "the stray owner removed");
        assertGt(claimAmira, guard, "claims after the Gate is attached");
        assertGt(remove, claimBen, "removal after the claims");
        assertEq(_countSelector(calls, d.gate, IHatsSignerGate.removeSigner.selector), 1, "only the stray owner");

        // it should never enable Roles on the Safe
        assertEq(_find(calls, safe, abi.encodeCall(ISafe.enableModule, (d.roles))), type(uint256).max, "no Roles");
        assertEq(_countSelector(calls, safe, ISafe.enableModule.selector), 1, "the Gate is the only module enabled");

        // it should hold no funds and no role itself
        for (uint256 i; i < calls.length; ++i) {
            assertEq(calls[i].value, 0, "no call moves ETH");
            assertTrue(calls[i].to != address(installer), "no call reaches the Installer");
            assertFalse(_mentions(calls[i].data, address(installer)), "no call names the Installer");
        }
    }

    function test_GivenAYearlyTopBudget() external whenTheInstallIsValid deployed {
        // it should set the allowance period to 366 days
        IInstaller.MoneyInstall memory p = _moneyInstall(d);
        p.tokens = new IInstaller.Token[](1);
        p.tokens[0] = _token(address(usdc), CEILING, BUDGET_YEAR, d.boardTopHat);
        IInstaller.Call[] memory calls = installer.buildMoney(p);
        _assertHas(
            calls,
            d.roles,
            abi.encodeCall(
                IRoles.setAllowance,
                (installerKey(address(usdc)), CEILING, CEILING, CEILING, uint64(366 days), uint64(0))
            ),
            "yearly allowance"
        );
    }

    function test_GivenTheGateHasDifferentThresholdConfigurations() external whenTheInstallIsValid {
        // it should build the Safe threshold change for the founding Directors
        address[] memory owners = new address[](2);
        owners[0] = address(founderSafe);
        owners[1] = address(benSafe);
        ISafeLike own = ISafeLike(address(_newCapxulSafe(owners, 1, 10)));
        IInstaller.MoneyDeploy memory dp = _moneyDeploy();
        dp.safe = address(own);
        IHatsSignerGate.ThresholdConfig[2] memory configs = [
            _threshold(1, 1), IHatsSignerGate.ThresholdConfig(IHatsSignerGate.TargetThresholdType.PROPORTIONAL, 2, 1000)
        ];
        for (uint256 i; i < configs.length; ++i) {
            dp.threshold = configs[i];
            dp.salt = bytes32(uint256(100 + i));
            IInstaller.MoneyDeployment memory dd = _deployMoney(dp);
            IInstaller.MoneyInstall memory p = _moneyInstall(dd);
            p.safe = address(own);
            IInstaller.Call[] memory calls = installer.buildMoney(p);
            uint256 change = _findSelector(calls, address(own), ISafeLike.changeThreshold.selector);
            if (i == 0) {
                assertEq(change, type(uint256).max, "one signer already matches");
            } else {
                _assertHas(calls, address(own), abi.encodeWithSignature("changeThreshold(uint256)", 2), "two signers");
            }
        }
    }

    function test_GivenTheFallbackHandlerIsThe4337Module() external whenTheInstallIsValid deployed {
        assertEq(_fallbackHandler(address(companySafe)), SAFE_4337_MODULE, "a Capxul Safe's handler");
        IInstaller.Call[] memory calls = installer.buildMoney(_moneyInstall(d));

        // it should set the CompatibilityFallbackHandler
        uint256 handler = _find(
            calls,
            address(companySafe),
            abi.encodeCall(ISafe.setFallbackHandler, (Addresses.COMPATIBILITY_FALLBACK_HANDLER_150))
        );
        assertTrue(handler != type(uint256).max, "setFallbackHandler(CompatibilityFallbackHandler)");
        uint256 guard = _find(calls, address(companySafe), abi.encodeCall(ISafe.setGuard, (d.gate)));
        assertLt(handler, guard, "before the Gate guards the Safe");

        _ownersBatch(calls);
        assertEq(
            _fallbackHandler(address(companySafe)), Addresses.COMPATIBILITY_FALLBACK_HANDLER_150, "handler replaced"
        );
    }

    function test_GivenNoOwnerIsRemovedAndTheSafesThresholdDiffersFromTheConfigs() external whenTheInstallIsValid {
        // A Capxul Safe owned by exactly the two founding Directors at threshold 1: no stray owner to remove, so
        // the claims alone would leave the threshold at 1 and the Gate (2-of-2) would refuse every transaction.
        address[] memory owners = new address[](2);
        owners[0] = address(founderSafe);
        owners[1] = address(benSafe);
        ISafeLike own = ISafeLike(address(_newCapxulSafe(owners, 1, 8)));
        IInstaller.MoneyDeploy memory dp = _moneyDeploy();
        dp.safe = address(own);
        IInstaller.MoneyDeployment memory dd = _deployMoney(dp);
        IInstaller.MoneyInstall memory p = _moneyInstall(dd);
        p.safe = address(own);
        IInstaller.Call[] memory calls = installer.buildMoney(p);

        // it should set the Safe's threshold to what the config gives
        _assertHas(calls, address(own), abi.encodeWithSignature("changeThreshold(uint256)", 2), "changeThreshold(2)");
        assertEq(_countSelector(calls, dd.gate, IHatsSignerGate.removeSigner.selector), 0, "nothing to remove");
        _execApproved(address(own), Addresses.MULTI_SEND_CALL_ONLY_141, _multiSend(_toForkCalls(calls)), DELEGATECALL);
        assertEq(own.getThreshold(), _required(_threshold(2, 2), 2), "threshold from the config");
        assertEq(own.getOwners().length, 2, "the founders only");

        // A Safe whose threshold already matches gets no changeThreshold.
        ISafeLike fine = ISafeLike(address(_newCapxulSafe(owners, 2, 9)));
        dp.safe = address(fine);
        dp.salt = bytes32(uint256(3));
        dd = _deployMoney(dp);
        p = _moneyInstall(dd);
        p.safe = address(fine);
        calls = installer.buildMoney(p);
        assertEq(_findSelector(calls, address(fine), ISafeLike.changeThreshold.selector), type(uint256).max, "none");
    }

    function test_GivenTheSafeExecutesTheCallsInOneMultiSend() external whenTheInstallIsValid deployed {
        // Operations spends from the USDC top budget; its ceiling is 10,000 a month under a 50,000 budget.
        uint128 ceiling = 10_000e6;
        IInstaller.MoneyInstall memory p = _moneyInstall(d);
        p.tokens[0] = IInstaller.Token({
            token: address(usdc),
            ceiling: ceiling,
            budgetPeriod: BUDGET_MONTH,
            topAmount: 50_000e6,
            topHat: d.officerHats[1]
        });
        _ownersBatch(installer.buildMoney(p));

        // it should leave the Gate as the Safe's only module and its guard
        _assertGateIsOnlyModuleAndGuard();
        assertEq(_rolesView().target(), d.gate, "Roles sends through the Gate");

        // it should leave the founding Directors' Safes as the only owners at the threshold the config gives
        address[] memory owners = companySafe.getOwners();
        assertEq(owners.length, 2, "two owners");
        assertTrue(companySafe.isOwner(address(founderSafe)) && companySafe.isOwner(address(benSafe)), "founders");
        assertFalse(companySafe.isOwner(strayOwner), "stray owner gone");
        assertEq(companySafe.getThreshold(), _required(_threshold(2, 2), 2), "threshold from the config");
        assertTrue(gate.isValidSigner(address(founderSafe)) && gate.isValidSigner(address(benSafe)), "valid signers");

        // it should let a top budget's hat wearer spend within the budget
        Call[] memory mint = new Call[](1);
        mint[0] = Call(Addresses.HATS, 0, abi.encodeCall(IHats.mintHat, (d.officerHats[1], users.jordan)));
        _execApproved(address(companySafe), Addresses.MULTI_SEND_CALL_ONLY_141, _multiSend(mint), DELEGATECALL);
        uint256 aliceBefore = usdc.balanceOf(users.alice);
        vm.prank(users.jordan);
        budgetsMock.spend(0, users.alice, ceiling, 0, keccak256("invoice 1"), bytes32(uint256(1)));
        assertEq(usdc.balanceOf(users.alice), aliceBefore + ceiling, "paid through Budgets, Roles, the Gate, the Safe");

        // it should let Roles refuse a spend above the ceiling
        vm.prank(users.jordan);
        vm.expectPartialRevert(ROLES_CONDITION_VIOLATION);
        budgetsMock.spend(0, users.alice, 1, 0, keccak256("invoice 2"), bytes32(uint256(2)));

        // it should let the Gate refuse a later addOwner or disableModule batch
        Call[] memory sneak = new Call[](1);
        // The threshold is kept at 2 so the Gate's post-check reaches the owners (`HatsSignerGate.sol:962-965`).
        sneak[0] = Call(address(companySafe), 0, abi.encodeCall(ISafeLike.addOwnerWithThreshold, (users.eve, 2)));
        _assertBatchRefused(_multiSend(sneak), bytes4(keccak256("CannotChangeOwners()")));
        sneak[0] = Call(address(companySafe), 0, abi.encodeCall(ISafe.disableModule, (SENTINEL, d.gate)));
        _assertBatchRefused(_multiSend(sneak), IHatsSignerGate.CannotChangeModules.selector);
        assertFalse(companySafe.isOwner(users.eve), "Eve is not an owner");
        _assertGateIsOnlyModuleAndGuard();
    }

    // ------------------------------------------------------------------ helpers

    function installerKey(address token) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("v4-payout-ceiling:", token));
    }

    /// @dev `roles.scopeFunction(PAYOUT_ROLE_KEY, target, selector, ...)` is in the batch.
    function _assertScoped(IInstaller.Call[] memory calls, address target, bytes4 selector) internal view {
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].to != d.roles || bytes4(calls[i].data) != IRoles.scopeFunction.selector) continue;
            (bytes32 key, address to, bytes4 fn,,) = abi.decode(
                _args(calls[i].data), (bytes32, address, bytes4, IRoles.ConditionFlat[], IRoles.ExecutionOptions)
            );
            if (key == PAYOUT_ROLE_KEY && to == target && fn == selector) return;
        }
        assertTrue(false, "payout role function not scoped");
    }

    function _args(bytes memory data) internal pure returns (bytes memory out) {
        out = new bytes(data.length - 4);
        for (uint256 i; i < out.length; ++i) {
            out[i] = data[i + 4];
        }
    }

    /// @dev Whether any 32-byte argument word of `data` is `who`.
    function _mentions(bytes memory data, address who) internal pure returns (bool) {
        for (uint256 offset = 4; offset + 32 <= data.length; offset += 32) {
            bytes32 word;
            assembly ("memory-safe") {
                word := mload(add(add(data, 32), offset))
            }
            if (word == bytes32(uint256(uint160(who)))) return true;
        }
        return false;
    }

    /// @dev Amira's Safe, the Director hat's eligibility until the equity install, rules `director` ineligible.
    function _lapse(address director) internal {
        vm.prank(address(founderSafe));
        IHatsExtra(Addresses.HATS).setHatWearerStatus(d.directorHat, director, false, true);
    }

    /// @dev Both Directors approve the batch; the Gate refuses it with `expected`.
    function _assertBatchRefused(bytes memory batch, bytes4 expected) internal {
        bytes memory sig = _approveBoth(address(companySafe), Addresses.MULTI_SEND_CALL_ONLY_141, batch, DELEGATECALL);
        vm.expectRevert(expected);
        companySafe.execTransaction(
            Addresses.MULTI_SEND_CALL_ONLY_141, 0, batch, DELEGATECALL, 0, 0, 0, address(0), payable(address(0)), sig
        );
    }
}
