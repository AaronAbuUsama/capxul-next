// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Addresses } from "./Addresses.sol";
import { Installer, InstallerConfig } from "../../src/authority/Installer.sol";
import { Budgets } from "../../src/money/Budgets.sol";
import { Payments } from "../../src/money/Payments.sol";
import { IInstaller } from "../../src/interfaces/IInstaller.sol";
import { IHats } from "../../src/interfaces/external/IHats.sol";
import { IHatsSignerGate } from "../../src/interfaces/external/IHatsSignerGate.sol";
import { Installer_Fork_Base } from "../utils/Installer/Installer_Fork_Base.sol";
import { IHatsExtra } from "../utils/Installer/ExternalViews.sol";

/// @notice The installed company on Base Sepolia (spec/installer.md "Proof"; invariants I1, I2, H7, H8, B10): a
/// Capxul Safe owned by Amira's and Ben's Safes at 2-of-2 (and a stray key), `deployMoney`, then the `buildMoney`
/// batch both founders approve. Real Safe 1.4.1, MultiSendCallOnly 1.4.1, Roles 2.1, Hats, Hats Signer Gate v2,
/// HatsModuleFactory and Hats Elections; Payments, Budgets and the equity implementations are stand-ins.
contract Installer_Fork_Test is Installer_Fork_Base {
    function test_RealBudgetPaysThroughInstalledRoles() external {
        Payments payments = new Payments();
        Budgets budgets = new Budgets(address(payments), Addresses.HATS);
        InstallerConfig memory config = _config();
        config.payments = address(payments);
        config.budgets = address(budgets);
        installer = new Installer(config);
        IInstaller.MoneyDeployment memory d = _deployMoney();
        IInstaller.MoneyInstall memory p = _moneyInstall(d);
        p.tokens[0].topHat = d.officerHats[1];
        _ownersBatch(installer.buildMoney(p));
        _mintOfficer(d.officerHats[1], users.jordan);
        uint256 before = usdc.balanceOf(users.alice);
        vm.prank(users.jordan);
        budgets.spend(1, users.alice, 1000e6, 1, keccak256("invoice"), bytes32(uint256(1)));
        assertEq(usdc.balanceOf(users.alice), before + 1000e6);
    }

    /// @dev I1 and H7: the whole installed shape, read from the real contracts after the batch.
    function test_I1_H7_MoneyInstallShape() external {
        IInstaller.MoneyInstall memory p;
        IInstaller.MoneyDeployment memory d = _deployMoney();
        p = _moneyInstall(d);
        p.tokens = new IInstaller.Token[](2);
        p.tokens[0] = _token(address(usdc), CEILING, BUDGET_MONTH, d.boardTopHat);
        p.tokens[1] = _token(address(dai), 3000 ether, BUDGET_YEAR, d.officerHats[0]);
        _ownersBatch(installer.buildMoney(p));

        // I1: the Gate is the only module and the guard; no 4337 module; Roles on the Gate, aimed at it.
        _assertGateIsOnlyModuleAndGuard();
        assertFalse(companySafe.isModuleEnabled(SAFE_4337_MODULE), "no 4337 module");
        assertEq(_fallbackHandler(address(companySafe)), Addresses.COMPATIBILITY_FALLBACK_HANDLER_150, "handler");
        assertEq(_rolesView().avatar(), address(companySafe), "Roles avatar");
        assertEq(_rolesView().target(), d.gate, "Roles target");
        assertEq(_rolesView().owner(), address(companySafe), "Roles owner");

        // I1: Budgets is the payout role's only member; each token's allowance equals its ceiling.
        assertTrue(_rolesView().isModuleEnabled(address(budgetsMock)), "Budgets is a Roles member");
        assertFalse(_rolesView().isModuleEnabled(address(installer)), "the Installer is not");
        _assertAllowance(address(usdc), CEILING, 31 days);
        _assertAllowance(address(dai), 3000 ether, 366 days);
        vm.prank(users.eve);
        vm.expectPartialRevert(ROLES_NOT_AUTHORIZED);
        _rolesView()
            .execTransactionWithRole(
                address(usdc),
                0,
                abi.encodeWithSignature("transfer(address,uint256)", users.eve, 1),
                0,
                PAYOUT_ROLE_KEY,
                true
            );

        // I1: the role is scoped to `approve(Payments, _)` and `Payments.send`: Budgets itself can do nothing else.
        vm.startPrank(address(budgetsMock));
        vm.expectPartialRevert(ROLES_CONDITION_VIOLATION);
        _rolesView()
            .execTransactionWithRole(
                address(usdc),
                0,
                abi.encodeWithSignature("transfer(address,uint256)", users.eve, 1),
                0,
                PAYOUT_ROLE_KEY,
                true
            );
        vm.expectPartialRevert(ROLES_CONDITION_VIOLATION);
        _rolesView()
            .execTransactionWithRole(
                address(usdc),
                0,
                abi.encodeWithSignature("approve(address,uint256)", users.eve, 1),
                0,
                PAYOUT_ROLE_KEY,
                true
            );
        vm.stopPrank();

        // I1: the owners are exactly the founding Directors' Safes, each wearing the Director hat, at the threshold
        // the chosen config gives.
        address[] memory owners = companySafe.getOwners();
        assertEq(owners.length, 2, "two owners");
        for (uint256 i; i < owners.length; ++i) {
            assertTrue(owners[i] == address(founderSafe) || owners[i] == address(benSafe), "a founding Director");
            assertTrue(_isWearer(owners[i], d.directorHat), "wearing the Director hat");
            assertTrue(gate.isValidSigner(owners[i]), "a valid signer");
        }
        IHatsSignerGate.ThresholdConfig memory c = _gateView().thresholdConfig();
        assertEq(c.min, 2, "config min");
        assertEq(c.target, 2, "config target");
        assertEq(companySafe.getThreshold(), _required(c, owners.length), "Safe threshold from the config");

        // H7: the trees.
        assertTrue(_isWearer(address(companySafe), d.boardTopHat), "the Safe wears the Board's top hat");
        for (uint256 i; i < d.officerHats.length; ++i) {
            assertEq(_hatAdmin(d.officerHats[i]), d.boardTopHat, "officer hats are direct children");
        }
        assertTrue(_isWearer(address(founderSafe), d.shareholdersTopHat), "Amira's Safe wears the Shareholders' hat");
        (, uint32 maxSupply,, address eligibility, address toggle,,, bool mutable_,) = HATS_V1.viewHat(d.directorHat);
        assertTrue(mutable_, "Director hat mutable");
        assertEq(maxSupply, 2, "1 + co-Directors");
        assertTrue(eligibility != address(companySafe) && toggle != address(companySafe), "not the Safe's to rule");
        assertFalse(HATS_V1.isAdminOfHat(address(companySafe), d.directorHat), "the Safe is not its admin");
        _assertInstallerHoldsNothing(d);
    }

    /// @dev H8: no company Safe transaction moves the Shareholders' top hat: the Board's batch is refused by Hats.
    function test_H8_BoardCannotMoveTheShareholdersTopHat() external {
        (IInstaller.MoneyDeployment memory d,) = _installMoney();
        Call[] memory grab = new Call[](1);
        grab[0] = Call(
            Addresses.HATS,
            0,
            abi.encodeCall(IHats.transferHat, (d.shareholdersTopHat, address(founderSafe), address(companySafe)))
        );
        bytes memory batch = _multiSend(grab);
        bytes memory sig = _approveBoth(address(companySafe), Addresses.MULTI_SEND_CALL_ONLY_141, batch, DELEGATECALL);
        // The Gate lets the batch run; Hats refuses the transfer inside it. MultiSendCallOnly reverts with no data
        // and Safe 1.5 passes that through (1.4.1 said GS013), so it is not a signature or guard error.
        vm.expectRevert(bytes(""));
        companySafe.execTransaction(
            Addresses.MULTI_SEND_CALL_ONLY_141, 0, batch, DELEGATECALL, 0, 0, 0, address(0), payable(address(0)), sig
        );
        assertTrue(_isWearer(address(founderSafe), d.shareholdersTopHat), "Amira's Safe still wears it");
        assertTrue(_isWearer(address(companySafe), d.boardTopHat), "the Safe still wears the Board's top hat");
    }

    /// @dev B10: each token's ceiling is its own allowance: spending one never touches another.
    function test_B10_TokenAllowancesAreIndependent() external {
        IInstaller.MoneyDeployment memory d = _deployMoney();
        IInstaller.MoneyInstall memory p = _moneyInstall(d);
        p.tokens = new IInstaller.Token[](2);
        p.tokens[0] = _token(address(usdc), 10_000e6, BUDGET_MONTH, d.officerHats[1]);
        p.tokens[1] = _token(address(dai), 5000 ether, BUDGET_MONTH, d.officerHats[1]);
        _ownersBatch(installer.buildMoney(p));
        _mintOfficer(d.officerHats[1], users.jordan);

        vm.prank(users.jordan);
        budgetsMock.spend(0, users.alice, 4000e6, 0, keccak256("usdc invoice"), bytes32(uint256(1)));
        (,,, uint128 usdcLeft,) = _rolesView().allowances(_key(address(usdc)));
        (,,, uint128 daiLeft,) = _rolesView().allowances(_key(address(dai)));
        assertEq(usdcLeft, 6000e6, "USDC ceiling spent");
        assertEq(daiLeft, 5000 ether, "DAI ceiling untouched");

        vm.prank(users.jordan);
        budgetsMock.spend(1, users.alice, 5000 ether, 0, keccak256("dai invoice"), bytes32(uint256(2)));
        (,,, usdcLeft,) = _rolesView().allowances(_key(address(usdc)));
        assertEq(usdcLeft, 6000e6, "USDC ceiling untouched by a DAI spend");
    }

    /// @dev I2 across every install: the Installer never holds a token or a hat, and is never a module or member.
    function test_I2_InstallerHoldsNothingAfterEveryInstall() external {
        (IInstaller.MoneyDeployment memory d, IInstaller.EquityDeployment memory e) = _deployEquity();
        _assertInstallerHoldsNothing(d);

        (IInstaller.Call[] memory safeCalls, IInstaller.Call[] memory founderCalls) =
            installer.buildEquity(_equityInstall(d, e));
        _ownersBatch(safeCalls);
        for (uint256 i; i < founderCalls.length; ++i) {
            _personalExec(founderSafe, amiraKey, founderCalls[i].to, founderCalls[i].data);
        }
        address elections = installer.deployElections(
            IInstaller.ElectionsDeploy({
                safe: address(companySafe),
                money: d,
                directorHat: d.directorHat,
                firstTermEnd: uint128(block.timestamp + 365 days)
            })
        );
        assertEq(elections, e.elections, "the clone deployEquity predicted");
        _assertInstallerHoldsNothing(d);
        assertEq(usdc.balanceOf(e.governor), 0, "nothing moved through the Installer");
    }

    /// @dev The proof journey (spec/installer.md "Proof"): a Board batch by approveHash, a hat wearer spending, the
    /// Roles ceiling, the Gate refusing owner and module changes, and payouts working while the Board cannot sign.
    function test_Proof_StartupMoneyJourney() external {
        IInstaller.MoneyDeployment memory d = _deployMoney();
        IInstaller.MoneyInstall memory p = _moneyInstall(d);
        p.tokens[0] = IInstaller.Token({
            token: address(usdc),
            ceiling: 20_000e6,
            budgetPeriod: BUDGET_MONTH,
            topAmount: 100_000e6,
            topHat: d.officerHats[1]
        });
        _ownersBatch(installer.buildMoney(p));

        // The Board, by approveHash from both founders' Safes, appoints Jordan to Operations.
        _mintOfficer(d.officerHats[1], users.jordan);

        // Jordan pays Alice from the Operations budget: Budgets -> Roles -> the Gate -> the Safe -> Payments.
        uint256 start = vm.getBlockTimestamp();
        uint256 before = usdc.balanceOf(users.alice);
        vm.prank(users.jordan);
        budgetsMock.spend(0, users.alice, 15_000e6, 2, keccak256("March payroll"), bytes32(uint256(1)));
        assertEq(usdc.balanceOf(users.alice), before + 15_000e6, "Alice paid");

        // The budget allows more, the Roles ceiling does not.
        vm.prank(users.jordan);
        vm.expectPartialRevert(ROLES_CONDITION_VIOLATION);
        budgetsMock.spend(0, users.alice, 5000e6 + 1, 0, keccak256("over the ceiling"), bytes32(uint256(2)));

        // The ceiling refills with the next period (31 days for a monthly budget).
        vm.warp(start + 31 days);
        vm.prank(users.jordan);
        budgetsMock.spend(0, users.bob, 20_000e6, 0, keccak256("April"), bytes32(uint256(3)));

        // Ben's Director hat lapses: the Board cannot sign 2-of-2, and Jordan's payouts still work (D15, R3 Q2).
        vm.prank(address(founderSafe));
        IHatsExtra(Addresses.HATS).setHatWearerStatus(d.directorHat, address(benSafe), false, true);
        Call[] memory pay = new Call[](1);
        pay[0] = Call(address(usdc), 0, abi.encodeWithSignature("transfer(address,uint256)", users.eve, 1));
        bytes memory batch = _multiSend(pay);
        bytes memory sig = _approveBoth(address(companySafe), Addresses.MULTI_SEND_CALL_ONLY_141, batch, DELEGATECALL);
        vm.expectRevert(IHatsSignerGate.InsufficientValidSignatures.selector);
        companySafe.execTransaction(
            Addresses.MULTI_SEND_CALL_ONLY_141, 0, batch, DELEGATECALL, 0, 0, 0, address(0), payable(address(0)), sig
        );
        vm.warp(start + 62 days);
        vm.prank(users.jordan);
        budgetsMock.spend(0, users.alice, 1000e6, 0, keccak256("May"), bytes32(uint256(4)));
        _assertGateIsOnlyModuleAndGuard();
    }

    // ------------------------------------------------------------------ helpers

    function _key(address token) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("v4-payout-ceiling:", token));
    }

    function _assertAllowance(address token, uint128 ceiling, uint64 period) internal view {
        (uint128 refill, uint128 maxRefill, uint64 p, uint128 balance,) = _rolesView().allowances(_key(token));
        assertEq(refill, ceiling, "refill is the ceiling");
        assertEq(maxRefill, ceiling, "max refill is the ceiling");
        assertEq(balance, ceiling, "balance is the ceiling");
        assertEq(p, period, "the budget period, rounded up");
    }

    /// @dev The Board (both founders, through the Gate) mints an officer hat.
    function _mintOfficer(uint256 hat, address wearer) internal {
        Call[] memory mint = new Call[](1);
        mint[0] = Call(Addresses.HATS, 0, abi.encodeCall(IHats.mintHat, (hat, wearer)));
        _execApproved(address(companySafe), Addresses.MULTI_SEND_CALL_ONLY_141, _multiSend(mint), DELEGATECALL);
        assertTrue(_isWearer(wearer, hat), "officer appointed");
    }

    function _assertInstallerHoldsNothing(IInstaller.MoneyDeployment memory d) internal view {
        address self = address(installer);
        assertFalse(_isWearer(self, d.boardTopHat), "no Board top hat");
        assertFalse(_isWearer(self, d.shareholdersTopHat), "no Shareholders' top hat");
        assertFalse(_isWearer(self, d.directorHat), "no Director hat");
        for (uint256 i; i < d.officerHats.length; ++i) {
            assertFalse(_isWearer(self, d.officerHats[i]), "no officer hat");
        }
        assertEq(usdc.balanceOf(self), 0, "no USDC");
        assertEq(dai.balanceOf(self), 0, "no DAI");
        assertEq(self.balance, 0, "no ETH");
        assertFalse(companySafe.isModuleEnabled(self), "not a Safe module");
        assertFalse(_gateView().isModuleEnabled(self), "not a Gate module");
        assertFalse(_rolesView().isModuleEnabled(self), "not a Roles member");
    }
}
